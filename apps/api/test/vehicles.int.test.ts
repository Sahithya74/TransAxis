import { and, eq } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { auditLogs, organizations, vehicles, vehicleTypes } from '@transaxis/database';
import { addDays, todayIn, type VehicleDto } from '@transaxis/shared';
import { bearer, createTestApp, hasDb, login, type TestApp } from './helpers.js';

describe.skipIf(!hasDb)('vehicles (integration)', () => {
  let t: TestApp;
  let dispatcher: string;
  let maintenance: string;
  let driver: string;
  let otherOrgOwner: string;
  let kaveriTypeId: number;
  let sahyadriTypeId: number;

  beforeAll(async () => {
    t = createTestApp();
    [dispatcher, maintenance, driver, otherOrgOwner] = (
      await Promise.all([
        login(t.app, 'dispatch@kaveri.demo'),
        login(t.app, 'maintenance@kaveri.demo'),
        login(t.app, 'driver@kaveri.demo'),
        login(t.app, 'owner@sahyadri.demo'),
      ])
    ).map((s) => s.token) as [string, string, string, string];

    const db = t.handle.db;
    const [krl] = await db.select().from(organizations).where(eq(organizations.code, 'KRL'));
    const [sfc] = await db.select().from(organizations).where(eq(organizations.code, 'SFC'));
    kaveriTypeId = (await db.select().from(vehicleTypes).where(and(eq(vehicleTypes.orgId, krl!.id), eq(vehicleTypes.name, '6-Wheeler 9T Open'))))[0]!.id;
    sahyadriTypeId = (await db.select().from(vehicleTypes).where(eq(vehicleTypes.orgId, sfc!.id)))[0]!.id;
  });
  afterAll(async () => {
    await t.close();
  });

  const list = (token: string, query: Record<string, string | number> = {}) =>
    request(t.app).get('/api/v1/vehicles').query(query).set(bearer(token));

  it('lists only the caller organisation\'s vehicles, paginated', async () => {
    const res = await list(dispatcher, { pageSize: 10 });
    expect(res.status).toBe(200);
    expect(res.body.meta).toMatchObject({ page: 1, pageSize: 10, total: 25, totalPages: 3 });
    expect(res.body.data).toHaveLength(10);
    expect(res.body.data.every((v: VehicleDto) => !v.registrationNo.startsWith('MH'))).toBe(true);

    const other = await list(otherOrgOwner, { pageSize: 100 });
    expect(other.body.meta.total).toBe(6);
    expect(other.body.data.every((v: VehicleDto) => v.registrationNo.startsWith('MH'))).toBe(true);
  });

  it('hides another organisation\'s vehicle behind 404 for read, update and documents', async () => {
    const theirs = (await list(otherOrgOwner)).body.data[0] as VehicleDto;
    expect((await request(t.app).get(`/api/v1/vehicles/${theirs.id}`).set(bearer(dispatcher))).status).toBe(404);
    expect(
      (await request(t.app).patch(`/api/v1/vehicles/${theirs.id}`).set(bearer(maintenance)).send({ notes: 'x' })).status,
    ).toBe(404);
    expect((await request(t.app).get(`/api/v1/vehicles/${theirs.id}/documents`).set(bearer(dispatcher))).status).toBe(404);
  });

  it('denies drivers fleet-wide vehicle access', async () => {
    expect((await list(driver)).status).toBe(403);
  });

  it('lets maintenance create a vehicle with a normalised registration and audits it', async () => {
    const res = await request(t.app)
      .post('/api/v1/vehicles')
      .set(bearer(maintenance))
      .send({ registrationNo: 'tn-22 zz 4321', vehicleTypeId: kaveriTypeId, payloadCapacityKg: 9100, make: 'Tata', model: 'LPT 1412', year: 2024 });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ registrationNo: 'TN22ZZ4321', status: 'available', payloadCapacityKg: 9100 });
    expect(res.body.compliance.state).toBe('missing');

    const [entry] = await t.handle.db
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.action, 'vehicle.created'), eq(auditLogs.entityId, String(res.body.id))));
    expect(entry).toBeDefined();
    expect(entry!.userId).not.toBeNull();
  });

  it('rejects duplicates, invalid payloads, foreign references and missing permission', async () => {
    const dup = await request(t.app)
      .post('/api/v1/vehicles')
      .set(bearer(maintenance))
      .send({ registrationNo: 'TN22ZZ4321', vehicleTypeId: kaveriTypeId, payloadCapacityKg: 9000 });
    expect(dup.status).toBe(409);

    const invalid = await request(t.app)
      .post('/api/v1/vehicles')
      .set(bearer(maintenance))
      .send({ registrationNo: '!', vehicleTypeId: 'abc', payloadCapacityKg: -5 });
    expect(invalid.status).toBe(400);
    expect(invalid.body.error.details.map((d: { path: string }) => d.path)).toEqual(
      expect.arrayContaining(['registrationNo', 'vehicleTypeId', 'payloadCapacityKg']),
    );

    const foreignType = await request(t.app)
      .post('/api/v1/vehicles')
      .set(bearer(maintenance))
      .send({ registrationNo: 'TN22ZZ9999', vehicleTypeId: sahyadriTypeId, payloadCapacityKg: 9000 });
    expect(foreignType.status).toBe(400);

    const forbidden = await request(t.app)
      .post('/api/v1/vehicles')
      .set(bearer(dispatcher))
      .send({ registrationNo: 'TN22ZZ8888', vehicleTypeId: kaveriTypeId, payloadCapacityKg: 9000 });
    expect(forbidden.status).toBe(403);
  });

  it('enforces manual status rules and a monotonic odometer', async () => {
    const created = await request(t.app)
      .post('/api/v1/vehicles')
      .set(bearer(maintenance))
      .send({ registrationNo: 'TN22ST0001', vehicleTypeId: kaveriTypeId, payloadCapacityKg: 9000, odometerKm: 120000 });
    const id = created.body.id as number;

    const ok = await request(t.app).patch(`/api/v1/vehicles/${id}`).set(bearer(maintenance)).send({ status: 'under_maintenance' });
    expect(ok.status).toBe(200);
    expect(ok.body.status).toBe('under_maintenance');
    // A partial update leaves every other field untouched.
    expect(ok.body).toMatchObject({ odometerKm: 120000, ownership: 'owned', fuelType: 'diesel', payloadCapacityKg: 9000 });

    // Lifecycle statuses cannot be set by hand.
    const lifecycle = await request(t.app).patch(`/api/v1/vehicles/${id}`).set(bearer(maintenance)).send({ status: 'on_trip' });
    expect(lifecycle.status).toBe(400);

    // While the trip owns the vehicle, manual status changes are refused.
    await t.handle.db.update(vehicles).set({ status: 'on_trip' }).where(eq(vehicles.id, id));
    const locked = await request(t.app).patch(`/api/v1/vehicles/${id}`).set(bearer(maintenance)).send({ status: 'available' });
    expect(locked.status).toBe(422);

    const backwards = await request(t.app).patch(`/api/v1/vehicles/${id}`).set(bearer(maintenance)).send({ odometerKm: 1000 });
    expect(backwards.status).toBe(422);
  });

  it('filters by compliance using org-local dates', async () => {
    const today = todayIn('Asia/Kolkata');
    const expired = await list(dispatcher, { compliance: 'expired', pageSize: 100 });
    expect(expired.status).toBe(200);
    expect(expired.body.meta.total).toBeGreaterThanOrEqual(1);
    for (const v of expired.body.data as VehicleDto[]) {
      expect(v.compliance.state).toBe('expired');
      expect(v.compliance.nextExpiry! < today).toBe(true);
    }

    const expiring = await list(dispatcher, { compliance: 'expiring', pageSize: 100 });
    expect(expiring.body.meta.total).toBeGreaterThanOrEqual(1);
    for (const v of expiring.body.data as VehicleDto[]) {
      expect(v.compliance.nextExpiry! >= today && v.compliance.nextExpiry! <= addDays(today, 15)).toBe(true);
    }

    const ok = await list(dispatcher, { compliance: 'ok', pageSize: 100 });
    for (const v of ok.body.data as VehicleDto[]) expect(v.compliance.state).toBe('ok');
  });

  it('sorts, searches and filters by status', async () => {
    const sorted = await list(dispatcher, { sort: '-payloadCapacityKg', pageSize: 100 });
    const caps = (sorted.body.data as VehicleDto[]).map((v) => v.payloadCapacityKg);
    expect(caps).toEqual([...caps].sort((a, b) => b - a));

    const maint = await list(dispatcher, { status: 'under_maintenance', pageSize: 100 });
    expect((maint.body.data as VehicleDto[]).every((v) => v.status === 'under_maintenance')).toBe(true);

    const search = await list(dispatcher, { q: 'TN22ZZ' });
    expect(search.body.data.map((v: VehicleDto) => v.registrationNo)).toContain('TN22ZZ4321');

    const badSort = await list(dispatcher, { sort: 'password' });
    expect(badSort.status).toBe(400);

    // LIKE wildcards in user input are matched literally.
    const wildcard = await list(dispatcher, { q: '%' });
    expect(wildcard.body.meta.total).toBe(0);
  });

  it('manages compliance documents and reflects them in the summary', async () => {
    const created = await request(t.app)
      .post('/api/v1/vehicles')
      .set(bearer(maintenance))
      .send({ registrationNo: 'TN22DC0001', vehicleTypeId: kaveriTypeId, payloadCapacityKg: 9000 });
    const id = created.body.id as number;
    const today = todayIn('Asia/Kolkata');

    const ids: number[] = [];
    for (const docType of ['registration', 'insurance', 'fitness', 'permit', 'pollution']) {
      const r = await request(t.app)
        .post(`/api/v1/vehicles/${id}/documents`)
        .set(bearer(maintenance))
        .send({ docType, documentNo: `${docType}-1`, issuedOn: addDays(today, -30), expiresOn: addDays(today, 200) });
      expect(r.status).toBe(201);
      ids.push(r.body.id);
    }
    expect((await request(t.app).get(`/api/v1/vehicles/${id}`).set(bearer(dispatcher))).body.compliance.state).toBe('ok');

    // Insurance lapses -> expired.
    const upd = await request(t.app)
      .put(`/api/v1/vehicles/${id}/documents/${ids[1]}`)
      .set(bearer(maintenance))
      .send({ docType: 'insurance', documentNo: 'insurance-1', issuedOn: addDays(today, -400), expiresOn: addDays(today, -1) });
    expect(upd.status).toBe(200);
    const after = (await request(t.app).get(`/api/v1/vehicles/${id}`).set(bearer(dispatcher))).body as VehicleDto;
    expect(after.compliance).toMatchObject({ state: 'expired', expired: ['insurance'] });

    const badDates = await request(t.app)
      .post(`/api/v1/vehicles/${id}/documents`)
      .set(bearer(maintenance))
      .send({ docType: 'other', issuedOn: today, expiresOn: addDays(today, -1) });
    expect(badDates.status).toBe(400);

    // Dispatchers can read documents but not change them.
    expect((await request(t.app).get(`/api/v1/vehicles/${id}/documents`).set(bearer(dispatcher))).body.data).toHaveLength(5);
    expect((await request(t.app).delete(`/api/v1/vehicles/${id}/documents/${ids[0]}`).set(bearer(dispatcher))).status).toBe(403);
    expect((await request(t.app).delete(`/api/v1/vehicles/${id}/documents/${ids[0]}`).set(bearer(maintenance))).status).toBe(204);
    expect((await request(t.app).get(`/api/v1/vehicles/${id}`).set(bearer(dispatcher))).body.compliance.missing).toEqual(['registration']);
  });

  it('summarises the fleet for dashboards, per organisation', async () => {
    const res = await request(t.app).get('/api/v1/vehicles/summary').set(bearer(dispatcher));
    expect(res.status).toBe(200);
    const s = res.body;
    const statusTotal = Object.values(s.byStatus as Record<string, number>).reduce((a, b) => a + b, 0);
    expect(statusTotal).toBe(s.total);
    const complianceTotal = Object.values(s.compliance as Record<string, number>).reduce((a, b) => a + b, 0);
    expect(complianceTotal).toBe(s.total - s.byStatus.retired);
    expect(s.compliance.expired).toBeGreaterThanOrEqual(1);

    const other = await request(t.app).get('/api/v1/vehicles/summary').set(bearer(otherOrgOwner));
    expect(other.body.total).toBe(6);
  });

  it('serves vehicle types and branches scoped to the organisation', async () => {
    const types = await request(t.app).get('/api/v1/vehicle-types').set(bearer(dispatcher));
    expect(types.status).toBe(200);
    expect(types.body.data.map((x: { id: number }) => x.id)).not.toContain(sahyadriTypeId);
    const branches = await request(t.app).get('/api/v1/reference/branches').set(bearer(otherOrgOwner));
    expect(branches.body.data.map((b: { name: string }) => b.name)).toEqual(['Bhiwandi Hub', 'Pune HQ']);
  });
});
