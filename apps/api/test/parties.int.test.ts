import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { CustomerDto, RouteDto } from '@transaxis/shared';
import { bearer, createTestApp, hasDb, login, type TestApp } from './helpers.js';

describe.skipIf(!hasDb)('customers, vendors, quotes and routes (integration)', () => {
  let t: TestApp;
  let dispatcher: string;
  let finance: string;
  let otherOrg: string;

  beforeAll(async () => {
    t = createTestApp();
    [dispatcher, finance, otherOrg] = (await Promise.all(['dispatch@kaveri.demo', 'finance@kaveri.demo', 'owner@sahyadri.demo'].map((e) => login(t.app, e)))).map(
      (s) => s.token,
    ) as [string, string, string];
  });
  afterAll(async () => {
    await t.close();
  });

  const customerByCode = async (code: string) =>
    ((await request(t.app).get('/api/v1/customers').query({ q: code }).set(bearer(dispatcher))).body.data as CustomerDto[]).find((c) => c.code === code)!;

  it('lists customers per organisation with open-booking counts', async () => {
    const res = await request(t.app).get('/api/v1/customers').query({ pageSize: 100 }).set(bearer(dispatcher));
    expect(res.body.meta.total).toBe(15);
    const ccw = (res.body.data as CustomerDto[]).find((c) => c.code === 'CCW')!;
    expect(ccw.openBookings).toBeGreaterThan(0);
    expect((await request(t.app).get(`/api/v1/customers/${ccw.id}`).set(bearer(otherOrg))).status).toBe(404);
  });

  it('returns contacts, rate cards and sites on the customer detail', async () => {
    const ccw = await customerByCode('CCW');
    const res = await request(t.app).get(`/api/v1/customers/${ccw.id}`).set(bearer(dispatcher));
    expect(res.body.contacts.some((c: { isPrimary: boolean }) => c.isPrimary)).toBe(true);
    expect(res.body.rateCards.length).toBeGreaterThan(0);
    expect(res.body.locations[0].lat).toBeTypeOf('number');
  });

  it('validates GSTIN and rejects duplicate codes', async () => {
    const bad = await request(t.app).post('/api/v1/customers').set(bearer(dispatcher)).send({ code: 'NEW1', name: 'New Co', gstin: '33ABC' });
    expect(bad.status).toBe(400);
    const ok = await request(t.app).post('/api/v1/customers').set(bearer(dispatcher)).send({ code: 'new1', name: 'New Co', gstin: '33aakck4821m1z5', city: 'Chennai' });
    expect(ok.status).toBe(201);
    expect(ok.body).toMatchObject({ code: 'NEW1', gstin: '33AAKCK4821M1Z5', paymentTermsDays: 30, status: 'active' });
    expect((await request(t.app).post('/api/v1/customers').set(bearer(dispatcher)).send({ code: 'NEW1', name: 'Again' })).status).toBe(409);
  });

  it('quotes a lane from the rate card with an explanation', async () => {
    const ccw = await customerByCode('CCW');
    const res = await request(t.app)
      .post('/api/v1/quotes')
      .set(bearer(dispatcher))
      .send({ customerId: ccw.id, originCity: 'Chennai', destinationCity: 'Bengaluru', totalWeightKg: 14000 });
    expect(res.status).toBe(200);
    // 346 km × ₹4.2/t-km ≈ ₹1,450/t → 14 t = ₹20,300 + loading 1,500 + unloading 1,200
    expect(res.body.quote.total).toBe('23000.00');
    expect(res.body.quote.lines[0].formula).toBe('₹1450.00/t × 14.000 t');
  });

  it('says so when no rate card applies instead of inventing a price', async () => {
    const ccw = await customerByCode('CCW');
    const res = await request(t.app)
      .post('/api/v1/quotes')
      .set(bearer(dispatcher))
      .send({ customerId: ccw.id, originCity: 'Chennai', destinationCity: 'Kolkata', totalWeightKg: 1000 });
    expect(res.body.quote).toBeNull();
    expect(res.body.message).toMatch(/No active rate card/);
  });

  it('manages vendors (finance can write, dispatch can only read)', async () => {
    const created = await request(t.app).post('/api/v1/vendors').set(bearer(finance)).send({ code: 'v-new', name: 'New Workshop', vendorType: 'workshop' });
    expect(created.status).toBe(201);
    expect((await request(t.app).post('/api/v1/vendors').set(bearer(dispatcher)).send({ code: 'V-X', name: 'X', vendorType: 'other' })).status).toBe(403);
    const list = await request(t.app).get('/api/v1/vendors').query({ vendorType: 'workshop' }).set(bearer(dispatcher));
    expect(list.body.data.every((v: { vendorType: string }) => v.vendorType === 'workshop')).toBe(true);
  });

  it('serves route polylines per organisation', async () => {
    const mine = (await request(t.app).get('/api/v1/routes').set(bearer(dispatcher))).body.data as RouteDto[];
    expect(mine.length).toBe(10);
    expect(mine[0]!.polyline.length).toBeGreaterThan(2);
    const theirs = (await request(t.app).get('/api/v1/routes').set(bearer(otherOrg))).body.data as RouteDto[];
    expect(theirs.every((r) => !mine.some((m) => m.id === r.id))).toBe(true);
  });
});
