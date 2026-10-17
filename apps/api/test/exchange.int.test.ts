import { and, eq, inArray } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { auditLogs, customers, vehicles, workers } from '@transaxis/database';
import { parseCsv } from '../src/lib/csv.js';
import { bearer, createTestApp, hasDb, login, type LoggedIn, type TestApp } from './helpers.js';

describe.skipIf(!hasDb)('CSV export and import (integration)', () => {
  let t: TestApp;
  let owner: LoggedIn;
  let dispatcher: LoggedIn;
  let hr: LoggedIn;
  let maintenance: LoggedIn;

  const csvOf = (res: request.Response) => parseCsv(res.text).map((r) => r.cells);
  const importCsv = (token: string, entity: string, csv: string, commit = false) =>
    request(t.app).post(`/api/v1/exchange/${entity}/import`).set(bearer(token)).send({ csv, commit });

  beforeAll(async () => {
    t = createTestApp();
    [owner, dispatcher, hr, maintenance] = await Promise.all([
      login(t.app, 'owner@kaveri.demo'),
      login(t.app, 'dispatch@kaveri.demo'),
      login(t.app, 'hr@kaveri.demo'),
      login(t.app, 'maintenance@kaveri.demo'),
    ]);
  });
  afterAll(async () => {
    // Later test files count the seeded vehicles, workers and customers, so remove what the imports added.
    const db = t.handle.db;
    await db.delete(customers).where(eq(customers.code, 'IMP-001'));
    await db.delete(vehicles).where(eq(vehicles.registrationNo, 'TN22ZZ9001'));
    await db.delete(workers).where(inArray(workers.employeeCode, ['IMP-DRV-1', 'IMP-HLP-1', 'IMP-HLP-2']));
    await t.close();
  });

  it('exports the organisation’s vehicles as a spreadsheet-ready CSV', async () => {
    const res = await request(t.app).get('/api/v1/exchange/vehicles/export.csv').set(bearer(owner.token));
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/csv/);
    expect(res.headers['content-disposition']).toMatch(/attachment; filename="vehicles-krl-\d{4}-\d{2}-\d{2}\.csv"/);
    expect(res.text.charCodeAt(0)).toBe(0xfeff);
    const [header, ...rows] = csvOf(res);
    expect(header!.slice(0, 3)).toEqual(['registration_no', 'vehicle_type', 'branch']);
    const count = await t.handle.db.select({ id: vehicles.id }).from(vehicles).where(eq(vehicles.orgId, owner.body.organization.id));
    expect(rows).toHaveLength(count.length);
    expect(rows.every((r) => /^[A-Z0-9]+$/.test(r[0]!))).toBe(true);
    const [audit] = await t.handle.db.select().from(auditLogs).where(and(eq(auditLogs.action, 'export.vehicles'), eq(auditLogs.userId, owner.body.user.id)));
    expect(audit).toBeDefined();
  });

  it('leaves personal and pay columns out of worker exports for people without HR access', async () => {
    const plain = csvOf(await request(t.app).get('/api/v1/exchange/workers/export.csv').set(bearer(dispatcher.token)))[0]!;
    expect(plain).toContain('employee_code');
    expect(plain).not.toContain('base_monthly_salary');
    expect(plain).not.toContain('emergency_contact_phone');
    const full = csvOf(await request(t.app).get('/api/v1/exchange/workers/export.csv').set(bearer(hr.token)))[0]!;
    expect(full).toEqual(expect.arrayContaining(['base_monthly_salary', 'emergency_contact_phone', 'date_of_birth']));
  });

  it('checks permissions per kind of record', async () => {
    const driver = await login(t.app, 'driver@kaveri.demo');
    expect((await request(t.app).get('/api/v1/exchange/vehicles/export.csv').set(bearer(driver.token))).status).toBe(403);
    expect((await request(t.app).get('/api/v1/exchange/vehicles/template.csv').set(bearer(dispatcher.token))).status).toBe(403);
    expect((await importCsv(dispatcher.token, 'workers', 'employee_code\nX')).status).toBe(403);
    expect((await request(t.app).get('/api/v1/exchange/invoices/export.csv').set(bearer(owner.token))).status).toBe(404);
  });

  it('checks a customer file first and writes nothing while any row is wrong', async () => {
    const [existing] = await t.handle.db.select().from(customers).where(eq(customers.orgId, dispatcher.body.organization.id)).limit(1);
    const csv = [
      'Code,Name,GSTIN,Payment Terms Days,Colour',
      'IMP-001,Imported Traders,,45,red',
      `${existing!.code},Should Be Skipped,,30,`,
      'IMP-002,Bad Gst Ltd,NOT-A-GSTIN,30,',
      'imp-001,Same Code Again,,30,',
      ',No Code,,30,',
    ].join('\r\n');
    const check = await importCsv(dispatcher.token, 'customers', csv);
    expect(check.status).toBe(200);
    expect(check.body).toMatchObject({ committed: false, total: 5, toCreate: 1, skipped: 1, errors: 3, created: 0 });
    expect(check.body.warnings[0]).toMatch(/colour/);
    const byLine = Object.fromEntries((check.body.rows as { line: number; status: string; messages: string[] }[]).map((r) => [r.line, r]));
    expect(byLine[2]).toMatchObject({ status: 'create' });
    expect(byLine[3]).toMatchObject({ status: 'skip' });
    expect(byLine[4]!.messages[0]).toMatch(/^gstin: /);
    expect(byLine[5]!.messages.join()).toMatch(/also appears on line 2/);
    expect(byLine[6]!.messages.join()).toMatch(/code: required/);

    const refused = await importCsv(dispatcher.token, 'customers', csv, true);
    expect(refused.body).toMatchObject({ committed: false, created: 0 });
    expect(refused.body.warnings.join()).toMatch(/Nothing was imported/);
    expect(await t.handle.db.select().from(customers).where(eq(customers.code, 'IMP-001'))).toHaveLength(0);

    const good = ['code,name,payment_terms_days,notes', 'IMP-001,Imported Traders,45,"=HYPERLINK(""x"")"', `${existing!.code},Skipped,30,`].join('\n');
    const done = await importCsv(dispatcher.token, 'customers', good, true);
    expect(done.body).toMatchObject({ committed: true, created: 1, skipped: 1, errors: 0 });
    const [row] = await t.handle.db.select().from(customers).where(and(eq(customers.code, 'IMP-001'), eq(customers.orgId, dispatcher.body.organization.id)));
    expect(row).toMatchObject({ name: 'Imported Traders', paymentTermsDays: 45, notes: '=HYPERLINK("x")' });
    // Exported again, the formula is defused for spreadsheets.
    const out = await request(t.app).get('/api/v1/exchange/customers/export.csv').set(bearer(dispatcher.token));
    expect(out.text).toContain(`"'=HYPERLINK(""x"")"`);
    const [audit] = await t.handle.db.select().from(auditLogs).where(eq(auditLogs.action, 'import.customers'));
    expect(audit!.summary).toMatch(/Imported 1 customers/);
  });

  it('imports vehicles by type name and refuses unknown types', async () => {
    const template = await request(t.app).get('/api/v1/exchange/vehicles/template.csv').set(bearer(maintenance.token));
    expect(template.status).toBe(200);
    const header = csvOf(template)[0]!;
    expect(header).not.toContain('status');

    const csv = [
      'registration_no,vehicle_type,branch,payload_capacity_kg,fuel_type,status',
      'tn 22 zz 9001,10-Wheeler 16T Open,Chennai HQ,16000,Diesel,available',
      'TN22ZZ9002,Flying Carpet,,1000,,',
      'TN22ZZ9003,LCV 3.5T Closed,Nowhere Hub,3500,,',
    ].join('\n');
    const check = await importCsv(maintenance.token, 'vehicles', csv);
    expect(check.body).toMatchObject({ toCreate: 1, errors: 2 });
    expect(check.body.warnings.join()).toMatch(/status/);
    expect(check.body.rows[0]).toMatchObject({ key: 'TN22ZZ9001', status: 'create' });
    expect(check.body.rows[1].messages[0]).toMatch(/unknown vehicle type "Flying Carpet"/);
    expect(check.body.rows[2].messages[0]).toMatch(/unknown branch "Nowhere Hub"/);

    const done = await importCsv(maintenance.token, 'vehicles', csv.split('\n').slice(0, 2).join('\n'), true);
    expect(done.body).toMatchObject({ committed: true, created: 1 });
    const [v] = await t.handle.db.select().from(vehicles).where(eq(vehicles.registrationNo, 'TN22ZZ9001'));
    expect(v).toMatchObject({ fuelType: 'diesel', status: 'available' });
  });

  it('imports workers with Indian-style dates, and pay only with HR access', async () => {
    const csv = ['employee_code,worker_type,full_name,phone,joined_on,base_monthly_salary', 'IMP-DRV-1,Driver,Imported Driver,+91 90000 00001,01/04/2025,23000'].join('\n');
    const done = await importCsv(hr.token, 'workers', csv, true);
    expect(done.body, JSON.stringify(done.body)).toMatchObject({ committed: true, created: 1 });
    const [w] = await t.handle.db.select().from(workers).where(eq(workers.employeeCode, 'IMP-DRV-1'));
    expect(w).toMatchObject({ workerType: 'driver', joinedOn: '2025-04-01', baseMonthlySalary: '23000.00' });

    // A roster clerk who may add workers but not see pay: the pay column is ignored, with a warning.
    const role = await request(t.app).post('/api/v1/admin/roles').set(bearer(owner.token)).send({ name: 'Roster clerk', permissions: ['workers:read', 'workers:write'] });
    const created = await request(t.app)
      .post('/api/v1/admin/users')
      .set(bearer(owner.token))
      .send({ email: 'roster@kaveri.demo', fullName: 'Roster Clerk', roleIds: [role.body.id] });
    const first = await login(t.app, 'roster@kaveri.demo', created.body.temporaryPassword);
    const changed = await request(t.app)
      .post('/api/v1/auth/change-password')
      .set(bearer(first.token))
      .send({ currentPassword: created.body.temporaryPassword, newPassword: 'Roster-Clerk-2026' });
    const clerk = changed.body.accessToken as string;

    const clerkCsv = ['employee_code,worker_type,full_name,phone,base_monthly_salary', 'IMP-HLP-1,helper,Imported Helper,+91 90000 00002,99000'].join('\n');
    const res = await importCsv(clerk, 'workers', clerkCsv, true);
    expect(res.body.warnings.join()).toMatch(/personal and pay columns/);
    expect(res.body.created).toBe(1);
    const [h] = await t.handle.db.select().from(workers).where(eq(workers.employeeCode, 'IMP-HLP-1'));
    expect(h!.baseMonthlySalary).toBeNull();

    // The same rule holds for the form: setting pay on a new worker needs HR access.
    const direct = await request(t.app)
      .post('/api/v1/workers')
      .set(bearer(clerk))
      .send({ employeeCode: 'IMP-HLP-2', workerType: 'helper', fullName: 'Direct Helper', phone: '+91 90000 00003', baseMonthlySalary: 50000 });
    expect(direct.status).toBe(403);
  });

  it('rejects malformed files clearly', async () => {
    const unclosed = await importCsv(dispatcher.token, 'customers', 'code,name\n"C-9,Broken');
    expect(unclosed.status).toBe(400);
    expect(unclosed.body.error.message).toMatch(/never closed/);
    const noKey = await importCsv(dispatcher.token, 'customers', 'name\nOnly Names');
    expect(noKey.status).toBe(400);
    expect(noKey.body.error.message).toMatch(/Required columns are missing: code/);
  });
});
