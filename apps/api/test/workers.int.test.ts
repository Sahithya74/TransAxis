import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addDays, todayIn, type WorkerDto } from '@transaxis/shared';
import { bearer, createTestApp, hasDb, login, type TestApp } from './helpers.js';

describe.skipIf(!hasDb)('workforce (integration)', () => {
  let t: TestApp;
  let hr: string;
  let dispatcher: string;
  let driver: string;
  let otherOrg: string;
  const today = todayIn('Asia/Kolkata');

  beforeAll(async () => {
    t = createTestApp();
    [hr, dispatcher, driver, otherOrg] = (
      await Promise.all(['hr@kaveri.demo', 'dispatch@kaveri.demo', 'driver@kaveri.demo', 'owner@sahyadri.demo'].map((e) => login(t.app, e)))
    ).map((s) => s.token) as [string, string, string, string];
  });
  afterAll(async () => {
    await t.close();
  });

  const list = (token: string, q: Record<string, string | number> = {}) => request(t.app).get('/api/v1/workers').query(q).set(bearer(token));
  const findByName = async (name: string) => ((await list(hr, { q: name })).body.data as WorkerDto[])[0]!;

  it('shows sensitive data and full licence numbers only to HR', async () => {
    const asHr = ((await list(hr, { workerType: 'driver', pageSize: 5 })).body.data as WorkerDto[])[0]!;
    expect(asHr.sensitive).toBeDefined();
    expect(asHr.licence!.licenceNo).not.toContain('•');

    const asDispatch = ((await list(dispatcher, { workerType: 'driver', pageSize: 5 })).body.data as WorkerDto[])[0]!;
    expect(asDispatch.sensitive).toBeUndefined();
    expect(asDispatch.licence!.licenceNo).toMatch(/^•+\w{4}$/);
    expect(asDispatch.licence!.classes.length).toBeGreaterThan(0);
  });

  it('scopes to the organisation and refuses drivers', async () => {
    const kaveri = await list(dispatcher, { pageSize: 100 });
    expect(kaveri.body.meta.total).toBe(40);
    const sahyadri = await list(otherOrg, { pageSize: 100 });
    expect(sahyadri.body.meta.total).toBe(10);
    const someKaveri = kaveri.body.data[0] as WorkerDto;
    expect((await request(t.app).get(`/api/v1/workers/${someKaveri.id}`).set(bearer(otherOrg))).status).toBe(404);
    expect((await list(driver)).status).toBe(403);
  });

  it('filters by licence state and flags leave and live trips', async () => {
    const expired = (await list(dispatcher, { licence: 'expired' })).body.data as WorkerDto[];
    expect(expired.map((w) => w.fullName)).toContain('Ramesh Naidu');
    expect(expired.every((w) => w.licenceState === 'expired')).toBe(true);

    const murugan = await findByName('Murugan');
    expect(murugan.currentTrip?.status).toBe('in_transit');
    expect(murugan.hasLogin).toBe(true);
    const onLeave = await findByName('Mohan Das');
    expect(onLeave.onLeaveToday).toBe(true);
    const hazmat = await findByName('Senthil Nathan');
    expect(hazmat.hazmatCertified).toBe(true);
  });

  it('creates workers with unique codes; only HR changes pay details', async () => {
    const created = await request(t.app)
      .post('/api/v1/workers')
      .set(bearer(hr))
      .send({ employeeCode: 'krl-drv-900', workerType: 'driver', fullName: 'Test Driver', phone: '+91 90000 00001', baseMonthlySalary: 21000 });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ employeeCode: 'KRL-DRV-900', licenceState: 'missing', employmentStatus: 'active' });

    const dup = await request(t.app).post('/api/v1/workers').set(bearer(hr)).send({ employeeCode: 'KRL-DRV-900', workerType: 'driver', fullName: 'Dup', phone: '9000000002' });
    expect(dup.status).toBe(409);
    expect((await request(t.app).patch(`/api/v1/workers/${created.body.id}`).set(bearer(dispatcher)).send({ phone: '9000000003' })).status).toBe(403);
  });

  it('records a licence as current and unverified, then verifies it', async () => {
    const w = await findByName('Test Driver');
    const lic = await request(t.app)
      .post(`/api/v1/workers/${w.id}/licences`)
      .set(bearer(hr))
      .send({ licenceNo: 'tn01 2020 0001234', validUntil: addDays(today, 900), classes: ['HGMV'], issuingState: 'Tamil Nadu' });
    expect(lic.status).toBe(201);
    expect(lic.body).toMatchObject({ verification: 'unverified', classes: ['HGMV'] });
    const ver = await request(t.app).post(`/api/v1/workers/${w.id}/licences/${lic.body.id}/verification`).set(bearer(hr)).send({ verification: 'verified' });
    expect(ver.body.verification).toBe('verified');

    const renewal = await request(t.app)
      .post(`/api/v1/workers/${w.id}/licences`)
      .set(bearer(hr))
      .send({ licenceNo: 'TN0120200001234', validUntil: addDays(today, 2000), classes: ['HTV', 'TRAILER'] });
    expect(renewal.body.verification).toBe('unverified');
    const all = await request(t.app).get(`/api/v1/workers/${w.id}/licences`).set(bearer(hr));
    expect(all.body.data).toHaveLength(2);
    expect((await request(t.app).get(`/api/v1/workers/${w.id}`).set(bearer(hr))).body.licence.id).toBe(renewal.body.id);
  });

  it('refuses approving leave that clashes with an assigned trip, and overlapping requests', async () => {
    const murugan = await findByName('Murugan');
    const req1 = await request(t.app).post('/api/v1/leave').set(bearer(hr)).send({ workerId: murugan.id, leaveType: 'casual', fromDate: today, toDate: today });
    expect(req1.status).toBe(201);
    const dup = await request(t.app).post('/api/v1/leave').set(bearer(hr)).send({ workerId: murugan.id, leaveType: 'sick', fromDate: today, toDate: addDays(today, 1) });
    expect(dup.status).toBe(409);

    const pending = (await request(t.app).get('/api/v1/leave').query({ workerId: murugan.id, status: 'pending' }).set(bearer(hr))).body.data;
    const decision = await request(t.app).post(`/api/v1/leave/${pending[0].id}/decision`).set(bearer(hr)).send({ decision: 'approved' });
    expect(decision.status).toBe(422);
    expect(decision.body.error.message).toMatch(/TRP-/);
    expect((await request(t.app).post(`/api/v1/leave/${pending[0].id}/decision`).set(bearer(hr)).send({ decision: 'rejected', note: 'On trip' })).status).toBe(204);
  });

  it('records attendance for a day, HR only', async () => {
    const w = await findByName('Test Driver');
    const put = await request(t.app).put('/api/v1/attendance').set(bearer(hr)).send({ workDate: today, entries: [{ workerId: w.id, status: 'present' }] });
    expect(put.status).toBe(204);
    const day = await request(t.app).get('/api/v1/attendance').query({ date: today }).set(bearer(hr));
    expect(day.body.data.find((r: { worker: { id: number } }) => r.worker.id === w.id).status).toBe('present');
    expect((await request(t.app).get('/api/v1/attendance').query({ date: today }).set(bearer(dispatcher))).status).toBe(403);
  });

  it('keeps personal documents behind workers:sensitive', async () => {
    const w = await findByName('Murugan');
    expect((await request(t.app).get(`/api/v1/workers/${w.id}/documents`).set(bearer(hr))).body.data.length).toBeGreaterThan(0);
    expect((await request(t.app).get(`/api/v1/workers/${w.id}/documents`).set(bearer(dispatcher))).status).toBe(403);
  });
});
