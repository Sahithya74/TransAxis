import { createHash } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { auditLogs, hashPassword, organizations, roles, userRoles, users, userSessions } from '@transaxis/database';
import { bearer, createTestApp, DEMO_PASSWORD, hasDb, login, refreshCookie, type TestApp } from './helpers.js';

const sha = (v: string) => createHash('sha256').update(v).digest('hex');

describe.skipIf(!hasDb)('auth (integration)', () => {
  let t: TestApp;

  /** Creates a throwaway dispatcher in Kaveri so destructive tests don't affect demo accounts. */
  async function makeUser(email: string, status: 'active' | 'disabled' = 'active') {
    const db = t.handle.db;
    const [org] = await db.select().from(organizations).where(eq(organizations.code, 'KRL'));
    const [role] = await db.select().from(roles).where(and(eq(roles.orgId, org!.id), eq(roles.key, 'dispatcher')));
    const [u] = await db
      .insert(users)
      .values({ orgId: org!.id, email, fullName: 'Test User', passwordHash: await hashPassword(DEMO_PASSWORD), status })
      .$returningId();
    await db.insert(userRoles).values({ userId: u!.id, roleId: role!.id });
    return u!.id;
  }

  beforeAll(() => {
    t = createTestApp();
  });
  afterAll(async () => {
    await t.close();
  });

  it('signs in and sets a hardened refresh cookie', async () => {
    const res = await request(t.app).post('/api/v1/auth/login').send({ email: 'DISPATCH@kaveri.demo ', password: DEMO_PASSWORD });
    expect(res.status).toBe(200);
    expect(res.body.accessToken).toMatch(/^ey/);
    expect(res.body.user).toMatchObject({ email: 'dispatch@kaveri.demo', roles: ['dispatcher'] });
    expect(res.body.user.permissions).toContain('trips:dispatch');
    expect(res.body.user.permissions).not.toContain('finance:post');
    expect(res.body.organization).toMatchObject({ name: 'Kaveri Roadlines', timezone: 'Asia/Kolkata', currency: 'INR' });
    expect(res.headers['cache-control']).toBe('no-store');

    const cookie = (res.headers['set-cookie'] as unknown as string[]).find((c) => c.startsWith('tx_rt='))!;
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Strict/i);
    expect(cookie).toMatch(/Path=\/api\/v1\/auth/);
    // Only the hash of the refresh token is stored.
    const raw = cookie.split(';')[0]!.slice('tx_rt='.length);
    const [stored] = await t.handle.db.select().from(userSessions).where(eq(userSessions.tokenHash, sha(raw)));
    expect(stored).toBeDefined();
    const [plain] = await t.handle.db.select().from(userSessions).where(eq(userSessions.tokenHash, raw));
    expect(plain).toBeUndefined();
  });

  it('gives the same answer for a wrong password and an unknown email', async () => {
    const wrong = await request(t.app).post('/api/v1/auth/login').send({ email: 'owner@kaveri.demo', password: 'nope-nope-1A' });
    const unknown = await request(t.app).post('/api/v1/auth/login').send({ email: 'ghost@kaveri.demo', password: 'nope-nope-1A' });
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(wrong.body.error.message).toBe(unknown.body.error.message);
    // Reset owner's counter so later tests aren't affected.
    await t.handle.db.update(users).set({ failedLoginCount: 0 }).where(eq(users.email, 'owner@kaveri.demo'));
  });

  it('validates the login payload', async () => {
    const res = await request(t.app).post('/api/v1/auth/login').send({ email: 'not-an-email' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details.map((d: { path: string }) => d.path)).toEqual(expect.arrayContaining(['email', 'password']));
  });

  it('locks the account after 5 failures, even for the right password', async () => {
    const userId = await makeUser('lockout@kaveri.demo');
    for (let i = 0; i < 5; i++) {
      const r = await request(t.app).post('/api/v1/auth/login').send({ email: 'lockout@kaveri.demo', password: 'Wrong-pass-1' });
      expect(r.status).toBe(401);
    }
    const blocked = await request(t.app).post('/api/v1/auth/login').send({ email: 'lockout@kaveri.demo', password: DEMO_PASSWORD });
    expect(blocked.status).toBe(401);

    const [u] = await t.handle.db.select().from(users).where(eq(users.id, userId));
    expect(u!.lockedUntil!.getTime()).toBeGreaterThan(Date.now() + 14 * 60_000);
    const locks = await t.handle.db
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.userId, userId), eq(auditLogs.action, 'auth.account_locked')));
    expect(locks).toHaveLength(1);
  });

  it('refuses disabled users', async () => {
    await makeUser('disabled@kaveri.demo', 'disabled');
    const res = await request(t.app).post('/api/v1/auth/login').send({ email: 'disabled@kaveri.demo', password: DEMO_PASSWORD });
    expect(res.status).toBe(401);
  });

  it('rotates the refresh token and returns a working access token', async () => {
    const s = await login(t.app, 'finance@kaveri.demo');
    const res = await request(t.app).post('/api/v1/auth/refresh').set('cookie', s.cookie);
    expect(res.status).toBe(200);
    const next = refreshCookie(res.headers['set-cookie']);
    expect(next).not.toBe(s.cookie);
    const me = await request(t.app).get('/api/v1/auth/me').set(bearer(res.body.accessToken));
    expect(me.status).toBe(200);
    expect(me.body.user.email).toBe('finance@kaveri.demo');
  });

  it('answers 409 (retry) when the same token is refreshed twice within the race window', async () => {
    const s = await login(t.app, 'finance@kaveri.demo');
    expect((await request(t.app).post('/api/v1/auth/refresh').set('cookie', s.cookie)).status).toBe(200);
    const again = await request(t.app).post('/api/v1/auth/refresh').set('cookie', s.cookie);
    expect(again.status).toBe(409);
  });

  it('revokes the whole session family when a rotated token is replayed later', async () => {
    const s = await login(t.app, 'maintenance@kaveri.demo');
    const first = await request(t.app).post('/api/v1/auth/refresh').set('cookie', s.cookie);
    const newCookie = refreshCookie(first.headers['set-cookie']);
    // Pretend the original token was rotated a minute ago (outside the race window).
    const oldHash = sha(s.cookie.slice('tx_rt='.length));
    await t.handle.db
      .update(userSessions)
      .set({ rotatedAt: sql`NOW(3) - INTERVAL 60 SECOND` })
      .where(eq(userSessions.tokenHash, oldHash));

    const replay = await request(t.app).post('/api/v1/auth/refresh').set('cookie', s.cookie);
    expect(replay.status).toBe(401);
    // The legitimate holder of the newer token is signed out too.
    const victim = await request(t.app).post('/api/v1/auth/refresh').set('cookie', newCookie);
    expect(victim.status).toBe(401);
    const [ev] = await t.handle.db.select().from(auditLogs).where(eq(auditLogs.action, 'auth.refresh_reuse_detected'));
    expect(ev).toBeDefined();
  });

  it('rejects refresh from a foreign origin', async () => {
    const s = await login(t.app, 'control@kaveri.demo');
    const res = await request(t.app).post('/api/v1/auth/refresh').set('cookie', s.cookie).set('origin', 'https://evil.example');
    expect(res.status).toBe(403);
  });

  it('logout revokes the session', async () => {
    const s = await login(t.app, 'control@kaveri.demo');
    expect((await request(t.app).post('/api/v1/auth/logout').set('cookie', s.cookie)).status).toBe(204);
    expect((await request(t.app).post('/api/v1/auth/refresh').set('cookie', s.cookie)).status).toBe(401);
  });

  it('runs the password reset flow end to end, single use', async () => {
    await makeUser('reset@kaveri.demo');
    const req1 = await request(t.app).post('/api/v1/auth/password-reset/request').send({ email: 'reset@kaveri.demo' });
    expect(req1.status).toBe(202);
    const unknown = await request(t.app).post('/api/v1/auth/password-reset/request').send({ email: 'nobody@kaveri.demo' });
    expect(unknown.status).toBe(202);
    expect(unknown.body.message).toBe(req1.body.message);

    const msgs = t.messenger.sent.filter((m) => m.to === 'reset@kaveri.demo');
    expect(msgs).toHaveLength(1);
    expect(t.messenger.sent.some((m) => m.to === 'nobody@kaveri.demo')).toBe(false);
    const token = decodeURIComponent(/token=([^\s]+)/.exec(msgs[0]!.body)![1]!);

    const weak = await request(t.app).post('/api/v1/auth/password-reset/confirm').send({ token, password: 'short' });
    expect(weak.status).toBe(400);

    const ok = await request(t.app).post('/api/v1/auth/password-reset/confirm').send({ token, password: 'NewSecret2026x' });
    expect(ok.status).toBe(204);
    const reuse = await request(t.app).post('/api/v1/auth/password-reset/confirm').send({ token, password: 'Another2026xx' });
    expect(reuse.status).toBe(400);

    expect((await request(t.app).post('/api/v1/auth/login').send({ email: 'reset@kaveri.demo', password: DEMO_PASSWORD })).status).toBe(401);
    expect((await request(t.app).post('/api/v1/auth/login').send({ email: 'reset@kaveri.demo', password: 'NewSecret2026x' })).status).toBe(200);
  });

  it('change-password requires the current password and signs out other sessions', async () => {
    await makeUser('change@kaveri.demo');
    const other = await login(t.app, 'change@kaveri.demo');
    const s = await login(t.app, 'change@kaveri.demo');
    const bad = await request(t.app)
      .post('/api/v1/auth/change-password')
      .set(bearer(s.token))
      .send({ currentPassword: 'wrong', newPassword: 'Changed2026Pass' });
    expect(bad.status).toBe(400);
    const ok = await request(t.app)
      .post('/api/v1/auth/change-password')
      .set(bearer(s.token))
      .send({ currentPassword: DEMO_PASSWORD, newPassword: 'Changed2026Pass' });
    expect(ok.status).toBe(200);
    expect((await request(t.app).post('/api/v1/auth/refresh').set('cookie', other.cookie)).status).toBe(401);
  });

  it('/me requires a bearer token', async () => {
    expect((await request(t.app).get('/api/v1/auth/me')).status).toBe(401);
  });
});
