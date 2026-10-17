import { and, eq } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { auditLogs, organizations, trips, users, vehicles } from '@transaxis/database';
import { totpCode } from '../src/lib/totp.js';
import { bearer, createTestApp, hasDb, login, refreshCookie, type LoggedIn, type TestApp } from './helpers.js';

const NEW_PASSWORD = 'Fresh-Start-2026';

describe.skipIf(!hasDb)('administration and two-step sign-in (integration)', () => {
  let t: TestApp;
  let owner: LoggedIn;
  let roleIds: Record<string, number>;

  const get = (path: string, token = owner.token) => request(t.app).get(`/api/v1${path}`).set(bearer(token));
  const post = (path: string, body: object, token = owner.token) => request(t.app).post(`/api/v1${path}`).set(bearer(token)).send(body);
  const patch = (path: string, body: object, token = owner.token) => request(t.app).patch(`/api/v1${path}`).set(bearer(token)).send(body);
  const put = (path: string, body: object, token = owner.token) => request(t.app).put(`/api/v1${path}`).set(bearer(token)).send(body);
  const del = (path: string, token = owner.token) => request(t.app).delete(`/api/v1${path}`).set(bearer(token));

  /** Signs in with a temporary password and replaces it, as a new user would. Returns the new access token. */
  async function firstSignIn(email: string, temporaryPassword: string): Promise<string> {
    const first = await login(t.app, email, temporaryPassword);
    expect(first.body.user).toMatchObject({ mustChangePassword: true });
    const changed = await post('/auth/change-password', { currentPassword: temporaryPassword, newPassword: NEW_PASSWORD }, first.token);
    expect(changed.status).toBe(200);
    expect(changed.body.user.mustChangePassword).toBe(false);
    return changed.body.accessToken as string;
  }

  async function createUser(body: object, token = owner.token) {
    const res = await post('/admin/users', body, token);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return res.body as { user: { id: number; email: string }; temporaryPassword: string };
  }

  beforeAll(async () => {
    t = createTestApp();
    owner = await login(t.app, 'owner@kaveri.demo');
    const roles = await get('/admin/roles');
    roleIds = Object.fromEntries((roles.body.data as { key: string; id: number }[]).map((r) => [r.key, r.id]));
  });
  afterAll(async () => {
    await t.close();
  });

  // ------------------------------------------------------------------ people

  it('keeps administration to people with the permission, inside their own organisation', async () => {
    const dispatcher = await login(t.app, 'dispatch@kaveri.demo');
    for (const path of ['/admin/users', '/admin/audit', '/admin/health', '/admin/tenants']) {
      expect((await get(path, dispatcher.token)).status, path).toBe(403);
    }

    const list = await get('/admin/users?pageSize=100');
    expect(list.status).toBe(200);
    const emails = (list.body.data as { email: string }[]).map((u) => u.email);
    expect(emails).toContain('dispatch@kaveri.demo');
    expect(emails.every((e) => e.endsWith('@kaveri.demo'))).toBe(true);
    const driver = (list.body.data as { email: string; worker: unknown }[]).find((u) => u.email === 'driver@kaveri.demo')!;
    expect(driver.worker).toMatchObject({ id: expect.any(Number), fullName: expect.any(String) });

    const sahyadri = await login(t.app, 'owner@sahyadri.demo');
    const kaveriUser = (list.body.data as { id: number }[])[0]!;
    expect((await get(`/admin/users/${kaveriUser.id}`, sahyadri.token)).status).toBe(404);
    expect((await patch(`/admin/users/${kaveriUser.id}`, { status: 'disabled' }, sahyadri.token)).status).toBe(404);
  });

  it('creates a login whose temporary password must be changed before anything else works', async () => {
    const created = await createUser({ email: 'New.Dispatcher@kaveri.demo', fullName: 'Nisha Rajan', roleIds: [roleIds.dispatcher] });
    expect(created.user).toMatchObject({ email: 'new.dispatcher@kaveri.demo', mustChangePassword: true, status: 'active', roles: [{ key: 'dispatcher' }] });
    expect(created.temporaryPassword).toMatch(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{14}$/);

    const dup = await post('/admin/users', { email: 'new.dispatcher@kaveri.demo', fullName: 'Someone Else', roleIds: [roleIds.dispatcher] });
    expect(dup.status).toBe(409);

    const first = await login(t.app, 'new.dispatcher@kaveri.demo', created.temporaryPassword);
    const blocked = await get('/vehicles', first.token);
    expect(blocked.status).toBe(403);
    expect(blocked.body.error.code).toBe('PASSWORD_CHANGE_REQUIRED');
    expect((await get('/auth/me', first.token)).status).toBe(200);

    const weak = await post('/auth/change-password', { currentPassword: created.temporaryPassword, newPassword: 'short' }, first.token);
    expect(weak.status).toBe(400);
    expect(weak.body.error.details[0].path).toBe('newPassword');

    const changed = await post('/auth/change-password', { currentPassword: created.temporaryPassword, newPassword: NEW_PASSWORD }, first.token);
    expect(changed.status).toBe(200);
    expect((await get('/vehicles', changed.body.accessToken)).status).toBe(200);

    const [row] = await t.handle.db
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.action, 'user.created'), eq(auditLogs.entityId, String(created.user.id))));
    expect(row).toMatchObject({ orgId: owner.body.organization.id, userId: owner.body.user.id });
  });

  it('links driver and portal logins to their worker or customer', async () => {
    const options = await get('/admin/users/link-options');
    expect(options.status).toBe(200);
    const free = (options.body.workers as { id: number; workerType: string; linkedUserId: number | null }[]).find((w) => w.workerType === 'driver' && w.linkedUserId === null)!;
    const taken = (options.body.workers as { linkedUserId: number | null }[]).find((w) => w.linkedUserId !== null);
    expect(free).toBeDefined();
    expect(taken).toBeDefined();

    const unlinked = await post('/admin/users', { email: 'driver2@kaveri.demo', fullName: 'Selvam K', roleIds: [roleIds.driver] });
    expect(unlinked.status).toBe(400);
    expect(unlinked.body.error.details[0].path).toBe('workerId');

    const linked = await createUser({ email: 'driver2@kaveri.demo', fullName: 'Selvam K', roleIds: [roleIds.driver], workerId: free.id });
    expect(linked.user).toMatchObject({ worker: { id: free.id } });
    const again = await post('/admin/users', { email: 'driver3@kaveri.demo', fullName: 'Selvam K', roleIds: [roleIds.driver], workerId: free.id });
    expect(again.status).toBe(409);

    const customer = (options.body.customers as { id: number }[])[0]!;
    expect((await post('/admin/users', { email: 'buyer@kaveri.demo', fullName: 'Portal Buyer', roleIds: [roleIds.customer] })).status).toBe(400);
    const portal = await createUser({ email: 'buyer@kaveri.demo', fullName: 'Portal Buyer', roleIds: [roleIds.customer], customerId: customer.id });
    expect(portal.user).toMatchObject({ customer: { id: customer.id } });
  });

  it('refuses changes that would lock the organisation out of administration', async () => {
    const me = owner.body.user.id;
    const selfDisable = await patch(`/admin/users/${me}`, { status: 'disabled' });
    expect(selfDisable.status).toBe(403);
    expect((await patch(`/admin/users/${me}`, { roleIds: [roleIds.dispatcher] })).status).toBe(403);
    // Re-sending the roles you already have is not a change.
    const rename = await patch(`/admin/users/${me}`, { roleIds: [roleIds.owner], phone: '+91 98400 11001' });
    expect(rename.status).toBe(200);
    expect((await post(`/admin/users/${me}/reset-password`, {})).status).toBe(422);

    // The owner is the only person who can manage users, so the owner role must keep that permission.
    const ownerRole = (await get('/admin/roles')).body.data.find((r: { key: string }) => r.key === 'owner') as { permissions: string[] };
    const stripped = await put(`/admin/roles/${roleIds.owner}/permissions`, { permissions: ownerRole.permissions.filter((p) => p !== 'users:manage') });
    expect(stripped.status).toBe(422);
    expect(stripped.body.error.code).toBe('BUSINESS_RULE');
    const after = (await get('/admin/roles')).body.data.find((r: { key: string }) => r.key === 'owner') as { permissions: string[] };
    expect(after.permissions).toContain('users:manage');
  });

  it("won't let anyone raise their own level or act on someone above them", async () => {
    expect((await post('/admin/roles', { name: 'Tenant manager', permissions: ['orgs:manage'] })).status).toBe(403);

    const role = await post('/admin/roles', { name: 'User administrator', permissions: ['users:read', 'users:manage'] });
    expect(role.status).toBe(201);
    expect(role.body).toMatchObject({ key: 'custom_user_administrator', isSystem: false, permissions: ['users:manage', 'users:read'], userCount: 0 });
    expect((await post('/admin/roles', { name: 'User administrator', permissions: [] })).status).toBe(409);

    const admin = await createUser({ email: 'useradmin@kaveri.demo', fullName: 'Usha Admin', roleIds: [role.body.id] });
    const token = await firstSignIn('useradmin@kaveri.demo', admin.temporaryPassword);

    // Operational roles can be handed out by anyone who manages users...
    const clerk = await createUser({ email: 'books@kaveri.demo', fullName: 'Book Keeper', roleIds: [roleIds.accountant] }, token);
    // ...administration access only by someone who has it.
    const asOwner = await post('/admin/users', { email: 'boss2@kaveri.demo', fullName: 'Second Boss', roleIds: [roleIds.owner] }, token);
    expect(asOwner.status).toBe(403);
    expect(asOwner.body.error.message).toMatch(/settings:manage/);
    expect((await put(`/admin/roles/${role.body.id}/permissions`, { permissions: ['users:read', 'users:manage', 'settings:manage'] }, token)).status).toBe(403);

    // The owner has more administration access, so the user administrator can't touch the owner's role or account.
    const ownerId = owner.body.user.id;
    expect((await put(`/admin/roles/${roleIds.owner}/permissions`, { permissions: ['users:read'] }, token)).status).toBe(403);
    const takeover = await post(`/admin/users/${ownerId}/reset-password`, {}, token);
    expect(takeover.status).toBe(403);
    expect(takeover.body.temporaryPassword).toBeUndefined();
    expect((await patch(`/admin/users/${ownerId}`, { status: 'disabled' }, token)).status).toBe(403);
    expect((await post(`/admin/users/${ownerId}/reset-two-step`, {}, token)).status).toBe(403);

    // Within their own level they work normally.
    const peer = await createUser({ email: 'useradmin2@kaveri.demo', fullName: 'Second Admin', roleIds: [role.body.id] }, token);
    expect(peer.user.email).toBe('useradmin2@kaveri.demo');
    expect((await post(`/admin/users/${clerk.user.id}/reset-password`, {}, token)).status).toBe(200);
  });

  it('edits roles but keeps built-in and in-use roles', async () => {
    const catalogue = await get('/admin/permissions');
    expect(catalogue.body.data).toContainEqual({ key: 'vehicles:read', description: 'View vehicles', group: 'vehicles' });

    expect((await del(`/admin/roles/${roleIds.dispatcher}`)).status).toBe(422);
    const custom = (await get('/admin/roles')).body.data.find((r: { key: string }) => r.key === 'custom_user_administrator') as { id: number; userCount: number };
    expect(custom.userCount).toBe(2);
    expect((await del(`/admin/roles/${custom.id}`)).status).toBe(422);

    const clerk = await post('/admin/roles', { name: 'Yard clerk', permissions: ['vehicles:read'] });
    const widened = await put(`/admin/roles/${clerk.body.id}/permissions`, { permissions: ['vehicles:read', 'fuel:read'] });
    expect(widened.body.permissions).toEqual(['fuel:read', 'vehicles:read']);
    expect((await del(`/admin/roles/${clerk.body.id}`)).status).toBe(204);
    expect((await get('/admin/roles')).body.data.some((r: { id: number }) => r.id === clerk.body.id)).toBe(false);
  });

  it('resets passwords, unlocks accounts and signs the person out', async () => {
    const target = (await get('/admin/users?q=new.dispatcher')).body.data[0] as { id: number };
    const before = await login(t.app, 'new.dispatcher@kaveri.demo', NEW_PASSWORD);

    await t.handle.db.update(users).set({ lockedUntil: new Date(Date.now() + 10 * 60_000) }).where(eq(users.id, target.id));
    expect((await get(`/admin/users/${target.id}`)).body.lockedUntil).not.toBeNull();
    const unlocked = await post(`/admin/users/${target.id}/unlock`, {});
    expect(unlocked.body.lockedUntil).toBeNull();

    const reset = await post(`/admin/users/${target.id}/reset-password`, {});
    expect(reset.status).toBe(200);
    expect(reset.body.user.mustChangePassword).toBe(true);
    const refresh = await request(t.app).post('/api/v1/auth/refresh').set('cookie', before.cookie).set('origin', 'http://localhost:5173');
    expect(refresh.status).toBe(401);
    expect((await request(t.app).post('/api/v1/auth/login').send({ email: 'new.dispatcher@kaveri.demo', password: NEW_PASSWORD })).status).toBe(401);
    await firstSignIn('new.dispatcher@kaveri.demo', reset.body.temporaryPassword);
  });

  it('disables a login and ends its sessions', async () => {
    const target = (await get('/admin/users?q=driver2')).body.data[0] as { id: number };
    const session = await login(t.app, 'driver2@kaveri.demo', (await post(`/admin/users/${target.id}/reset-password`, {})).body.temporaryPassword);
    const off = await patch(`/admin/users/${target.id}`, { status: 'disabled' });
    expect(off.body.status).toBe('disabled');
    expect((await request(t.app).post('/api/v1/auth/refresh').set('cookie', session.cookie).set('origin', 'http://localhost:5173')).status).toBe(401);
    expect((await get('/admin/users?status=disabled')).body.data.map((u: { id: number }) => u.id)).toContain(target.id);
  });

  // ------------------------------------------------------------------ settings and configuration

  it('changes settings within their limits', async () => {
    const before = await get('/admin/settings');
    expect(before.status).toBe(200);
    expect(before.body.profile).toMatchObject({ code: 'KRL', timezone: 'Asia/Kolkata', currency: 'INR' });
    expect(before.body.settings).toEqual({ 'compliance.expiry_warning_days': 15, 'dispatch.min_rest_hours': 8, 'dispatch.max_duty_hours': 12 });

    expect((await patch('/admin/settings', { settings: { 'dispatch.min_rest_hours': 30 } })).status).toBe(400);
    expect((await patch('/admin/settings', { profile: { timezone: 'Mars/Olympus' } })).status).toBe(400);
    expect((await patch('/admin/settings', { settings: { 'unknown.key': 3 } })).body.settings?.['unknown.key']).toBeUndefined();

    try {
      const saved = await patch('/admin/settings', { settings: { 'dispatch.min_rest_hours': 10 }, profile: { city: 'Coimbatore' } });
      expect(saved.status).toBe(200);
      expect(saved.body.settings['dispatch.min_rest_hours']).toBe(10);
      expect(saved.body.profile.city).toBe('Coimbatore');
      const [row] = await t.handle.db.select().from(auditLogs).where(and(eq(auditLogs.action, 'settings.updated'), eq(auditLogs.orgId, owner.body.organization.id)));
      expect(row).toBeDefined();
    } finally {
      await patch('/admin/settings', { settings: { 'dispatch.min_rest_hours': 8 }, profile: { city: before.body.profile.city } });
    }
  });

  it('manages expense categories', async () => {
    const list = await get('/admin/expense-categories');
    expect(list.status).toBe(200);
    expect((list.body.data as { used: number }[]).some((c) => c.used > 0)).toBe(true);

    const created = await post('/admin/expense-categories', { name: 'Weighbridge fees', accountKey: 'trip_expense', requiresReceiptAbove: 500 });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ name: 'Weighbridge fees', accountKey: 'trip_expense', requiresReceiptAbove: '500.00', isActive: true, used: 0 });
    expect((await post('/admin/expense-categories', { name: 'Weighbridge fees', accountKey: 'trip_expense' })).status).toBe(409);
    expect((await post('/admin/expense-categories', { name: 'Petty cash', accountKey: 'cash' })).status).toBe(400);

    const retired = await put(`/admin/expense-categories/${created.body.id}`, { name: 'Weighbridge fees', accountKey: 'trip_expense', isActive: false, requiresReceiptAbove: null });
    expect(retired.body).toMatchObject({ isActive: false, requiresReceiptAbove: null });
    const sahyadri = await login(t.app, 'owner@sahyadri.demo');
    expect((await put(`/admin/expense-categories/${created.body.id}`, { name: 'Taken over', accountKey: 'trip_expense' }, sahyadri.token)).status).toBe(404);
  });

  // ------------------------------------------------------------------ oversight

  it('shows the audit trail of the organisation only, with filters', async () => {
    const res = await get('/admin/audit?action=user.&pageSize=100');
    expect(res.status).toBe(200);
    const actions = new Set((res.body.data as { action: string }[]).map((a) => a.action));
    expect(actions.has('user.created')).toBe(true);
    expect([...actions].every((a) => a.startsWith('user.'))).toBe(true);
    const created = (res.body.data as { action: string; summary: string; user: { email: string } | null }[]).find((a) => a.summary?.includes('new.dispatcher@kaveri.demo'))!;
    expect(created.user?.email).toBe('owner@kaveri.demo');

    const sahyadri = await login(t.app, 'owner@sahyadri.demo');
    const theirs = await get('/admin/audit?q=new.dispatcher', sahyadri.token);
    expect(theirs.body.meta.total).toBe(0);
  });

  it('reports system health', async () => {
    const res = await get('/admin/health');
    expect(res.status).toBe(200);
    expect(res.body.database.ok).toBe(true);
    expect(res.body.database.migrations).toBeGreaterThanOrEqual(9);
    expect(res.body.storage.uploadsWritable).toBe(true);
    expect(typeof res.body.documentService.ok).toBe('boolean');
    expect(res.body.api.node).toBe(process.version);
  });

  it('lets only the platform administrator suspend and reactivate a company', async () => {
    expect((await get('/admin/tenants')).status).toBe(403);
    const platform = await login(t.app, 'admin@transaxis.demo');
    const tenants = await get('/admin/tenants', platform.token);
    expect(tenants.status).toBe(200);
    const sfc = (tenants.body.data as { id: number; code: string; users: number }[]).find((o) => o.code === 'SFC')!;
    expect(sfc.users).toBeGreaterThan(0);
    expect((await post(`/admin/tenants/${platform.body.organization.id}/status`, { status: 'suspended', reason: 'Testing self' }, platform.token)).status).toBe(422);

    const sahyadri = await login(t.app, 'owner@sahyadri.demo');
    try {
      const off = await post(`/admin/tenants/${sfc.id}/status`, { status: 'suspended', reason: 'Subscription unpaid' }, platform.token);
      expect(off.body.status).toBe('suspended');
      // Existing access tokens stop working at once, not when they expire.
      expect((await get('/vehicles', sahyadri.token)).status).toBe(401);
      expect((await request(t.app).post('/api/v1/auth/login').send({ email: 'owner@sahyadri.demo', password: 'Demo@12345' })).status).toBe(401);
    } finally {
      const on = await post(`/admin/tenants/${sfc.id}/status`, { status: 'active', reason: 'Payment received' }, platform.token);
      expect(on.body.status).toBe('active');
    }
    const back = await login(t.app, 'owner@sahyadri.demo');
    const trail = await get('/admin/audit?action=tenant.', back.token);
    expect((trail.body.data as { action: string }[]).map((a) => a.action)).toEqual(['tenant.reactivated', 'tenant.suspended']);
    const [org] = await t.handle.db.select().from(organizations).where(eq(organizations.id, sfc.id));
    expect(org!.status).toBe('active');
  });

  // ------------------------------------------------------------------ two-step sign-in

  describe('two-step sign-in', () => {
    let userId: number;
    let token: string;
    let secret: string;

    beforeAll(async () => {
      const created = await createUser({ email: 'twostep@kaveri.demo', fullName: 'Tara Two-Step', roleIds: [roleIds.dispatcher] });
      userId = created.user.id;
      token = await firstSignIn('twostep@kaveri.demo', created.temporaryPassword);
    });

    const challenge = async () => {
      const res = await request(t.app).post('/api/v1/auth/login').send({ email: 'twostep@kaveri.demo', password: NEW_PASSWORD });
      expect(res.status).toBe(200);
      return res;
    };

    it('sets up an authenticator app with a QR code and an encrypted secret', async () => {
      const setup = await post('/auth/totp/setup', {}, token);
      expect(setup.status).toBe(200);
      secret = setup.body.secret;
      expect(secret).toMatch(/^[A-Z2-7]{32}$/);
      expect(setup.body.otpauthUrl).toMatch(/^otpauth:\/\/totp\/TransAxis:twostep%40kaveri\.demo\?secret=/);
      expect(setup.body.qrDataUrl).toMatch(/^data:image\/png;base64,/);
      const [row] = await t.handle.db.select().from(users).where(eq(users.id, userId));
      expect(row!.totpSecretEnc).toMatch(/^v1\./);
      expect(row!.totpSecretEnc).not.toContain(secret);
      expect(row!.totpEnabled).toBe(false);

      expect((await post('/auth/totp/enable', { code: '000000' }, token)).status).toBe(400);
      expect((await post('/auth/totp/enable', { code: totpCode(secret) }, token)).status).toBe(204);
      expect((await post('/auth/totp/setup', {}, token)).status).toBe(422);
      expect((await get('/auth/me', token)).body.user.totpEnabled).toBe(true);
    });

    it('asks for a code after the password, and accepts each code only once', async () => {
      const first = await challenge();
      expect(first.body).toEqual({ mfaRequired: true, mfaToken: expect.any(String) });
      expect(first.headers['set-cookie']).toBeUndefined();

      const wrong = await request(t.app).post('/api/v1/auth/login/totp').send({ mfaToken: first.body.mfaToken, code: '123456' });
      expect(wrong.status).toBe(401);
      // An ordinary access token is not a challenge.
      expect((await request(t.app).post('/api/v1/auth/login/totp').send({ mfaToken: token, code: totpCode(secret) })).status).toBe(401);

      // Two sign-ins racing with the same code: exactly one wins.
      const second = await challenge();
      const code = totpCode(secret, Date.now() + 30_000);
      const results = await Promise.all(
        [first.body.mfaToken, second.body.mfaToken].map((mfaToken) => request(t.app).post('/api/v1/auth/login/totp').send({ mfaToken, code })),
      );
      expect(results.map((r) => r.status).sort()).toEqual([200, 401]);
      const won = results.find((r) => r.status === 200)!;
      expect(won.body.accessToken).toMatch(/^ey/);
      expect(refreshCookie(won.headers['set-cookie'])).toMatch(/^tx_rt=/);

      const replay = await request(t.app).post('/api/v1/auth/login/totp').send({ mfaToken: (await challenge()).body.mfaToken, code });
      expect(replay.status).toBe(401);
      const [failures] = await t.handle.db.select({ n: users.failedLoginCount }).from(users).where(eq(users.id, userId));
      expect(failures!.n).toBeGreaterThan(0);
    });

    it('turns off with the password, or by an administrator for a lost phone', async () => {
      expect((await post('/auth/totp/disable', { password: 'not-my-password' }, token)).status).toBe(400);
      expect((await post('/auth/totp/disable', { password: NEW_PASSWORD }, token)).status).toBe(204);
      const direct = await challenge();
      expect(direct.body.accessToken).toMatch(/^ey/);

      // On again, then the administrator resets it.
      const setup = await post('/auth/totp/setup', {}, direct.body.accessToken);
      expect((await post('/auth/totp/enable', { code: totpCode(setup.body.secret) }, direct.body.accessToken)).status).toBe(204);
      expect((await challenge()).body.mfaRequired).toBe(true);
      const reset = await post(`/admin/users/${userId}/reset-two-step`, {});
      expect(reset.body.totpEnabled).toBe(false);
      expect((await challenge()).body.accessToken).toMatch(/^ey/);
    });
  });

  // ------------------------------------------------------------------ search

  describe('global search', () => {
    it('finds vehicles, trips and people the person may see, and nothing from other companies', async () => {
      const orgId = owner.body.organization.id;
      const [vehicle] = await t.handle.db.select().from(vehicles).where(eq(vehicles.orgId, orgId)).limit(1);
      const spaced = vehicle!.registrationNo.replace(/^([A-Z]{2})(\d{2})/, '$1 $2 ');
      const byPlate = await get(`/search?q=${encodeURIComponent(spaced)}`);
      expect(byPlate.status).toBe(200);
      expect(byPlate.body.data[0]).toMatchObject({ type: 'vehicle', id: vehicle!.id, link: `/vehicles/${vehicle!.id}` });

      const [trip] = await t.handle.db.select().from(trips).where(eq(trips.orgId, orgId)).limit(1);
      const byTrip = await get(`/search?q=${trip!.tripNo}`);
      expect(byTrip.body.data[0]).toMatchObject({ type: 'trip', title: trip!.tripNo, link: `/trips/${trip!.id}` });

      const sahyadri = await login(t.app, 'owner@sahyadri.demo');
      const foreign = await get(`/search?q=${trip!.tripNo}`, sahyadri.token);
      expect((foreign.body.data as { type: string; id: number }[]).some((r) => r.type === 'trip' && r.id === trip!.id)).toBe(false);
    });

    it('respects permissions and document classifications', async () => {
      const driver = await login(t.app, 'driver@kaveri.demo');
      expect((await get('/search?q=TN', driver.token)).body.data).toEqual([]);

      // The board notes are management-only; the dispatcher can search operations documents but not those.
      const dispatcher = await login(t.app, 'dispatch@kaveri.demo');
      const board = await get('/search?q=board', dispatcher.token);
      expect((board.body.data as { type: string }[]).filter((r) => r.type === 'document')).toEqual([]);
      const ownerBoard = await get('/search?q=board');
      expect((ownerBoard.body.data as { type: string }[]).some((r) => r.type === 'document')).toBe(true);

      expect((await get('/search?q=a')).body.data).toEqual([]);
      expect((await get(`/search?q=${'x'.repeat(81)}`)).status).toBe(400);
      // LIKE wildcards are matched literally.
      expect((await get('/search?q=%25%25')).body.data).toEqual([]);
    });
  });
});
