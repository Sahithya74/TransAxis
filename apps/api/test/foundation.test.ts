import express from 'express';
import { pino } from 'pino';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { type ROLE_KEYS, DEFAULT_ROLE_PERMISSIONS } from '@transaxis/shared';
import { createApp } from '../src/app.js';
import { loadConfig } from '../src/config/env.js';
import type { RequestContext } from '../src/lib/context.js';
import { AppError, createErrorHandler } from '../src/lib/errors.js';
import { signAccessToken, verifyAccessToken } from '../src/lib/tokens.js';
import { authenticate, requireContext, requirePermission } from '../src/middleware/auth.js';

const SECRET = 'test-secret-test-secret-test-secret-0123456789';
const silent = pino({ level: 'silent' });
const config = loadConfig({ NODE_ENV: 'test', JWT_ACCESS_SECRET: SECRET, LOG_LEVEL: 'silent' });

function ctxFor(role: (typeof ROLE_KEYS)[number], overrides: Partial<RequestContext> = {}): RequestContext {
  return {
    userId: 7,
    orgId: 1,
    roles: [role],
    permissions: new Set(DEFAULT_ROLE_PERMISSIONS[role]),
    workerId: null,
    customerId: null,
    ...overrides,
  };
}

describe('config', () => {
  it('rejects a missing or short JWT secret with a readable message', () => {
    expect(() => loadConfig({ NODE_ENV: 'test' })).toThrow(/JWT_ACCESS_SECRET/);
    expect(() => loadConfig({ JWT_ACCESS_SECRET: 'short' })).toThrow(/at least 32/);
  });

  it('treats blank optional values as unset', () => {
    const c = loadConfig({ JWT_ACCESS_SECRET: SECRET, DATABASE_URL: '' });
    expect(c.DATABASE_URL).toBeUndefined();
    expect(c.API_PORT).toBe(4000);
  });
});

describe('app shell', () => {
  it('reports health without a database configured', async () => {
    const res = await request(createApp({ config, logger: silent })).get('/api/v1/health');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'ok', checks: { database: 'not_configured' } });
    expect(res.headers['x-request-id']).toBeTruthy();
  });

  it('returns 503 when the database check fails', async () => {
    const app = createApp({ config, logger: silent, checkDatabase: async () => false });
    const res = await request(app).get('/api/v1/health');
    expect(res.status).toBe(503);
    expect(res.body.checks.database).toBe('down');
  });

  it('uses the predictable error envelope for unknown routes', async () => {
    const res = await request(createApp({ config, logger: silent })).get('/api/v1/nope');
    expect(res.status).toBe(404);
    expect(res.body.error).toMatchObject({ code: 'NOT_FOUND' });
    expect(res.body.error.requestId).toBe(res.headers['x-request-id']);
  });

  it('rejects malformed JSON with a 400 and no stack trace', async () => {
    const res = await request(createApp({ config, logger: silent }))
      .post('/api/v1/health')
      .set('content-type', 'application/json')
      .send('{"broken":');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(JSON.stringify(res.body)).not.toMatch(/at .*\.ts|node_modules/);
  });

  it('sets security headers and does not advertise Express', async () => {
    const res = await request(createApp({ config, logger: silent })).get('/api/v1/health');
    expect(res.headers['x-powered-by']).toBeUndefined();
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });
});

describe('API reference', () => {
  it('serves an OpenAPI 3.1 document generated from the validation schemas', async () => {
    const res = await request(createApp({ config, logger: silent })).get('/api/v1/openapi.json');
    expect(res.status).toBe(200);
    expect(res.body.openapi).toBe('3.1.0');
    const createVehicle = res.body.paths['/vehicles'].post;
    expect(createVehicle.description).toContain('`vehicles:write`');
    const props = createVehicle.requestBody.content['application/json'].schema.properties;
    expect(Object.keys(props)).toEqual(expect.arrayContaining(['registrationNo', 'vehicleTypeId', 'payloadCapacityKg']));
    const list = res.body.paths['/vehicles'].get.parameters.map((p: { name: string }) => p.name);
    expect(list).toEqual(expect.arrayContaining(['page', 'pageSize', 'sort', 'status', 'compliance']));
  });

  it('can be disabled', async () => {
    const off = loadConfig({ NODE_ENV: 'production', JWT_ACCESS_SECRET: SECRET, LOG_LEVEL: 'silent' });
    const res = await request(createApp({ config: off, logger: silent })).get('/api/v1/openapi.json');
    expect(res.status).toBe(404);
  });
});

describe('access tokens', () => {
  it('round-trips the request context', async () => {
    const original = ctxFor('driver', { workerId: 42 });
    const token = await signAccessToken(original, SECRET, 15);
    const verified = await verifyAccessToken(token, SECRET);
    expect(verified.userId).toBe(7);
    expect(verified.orgId).toBe(1);
    expect(verified.workerId).toBe(42);
    expect(verified.roles).toEqual(['driver']);
    expect(verified.permissions.has('trips:update_own')).toBe(true);
    expect(verified.permissions.has('finance:post')).toBe(false);
  });

  it('rejects a token signed with a different secret', async () => {
    const token = await signAccessToken(ctxFor('owner'), 'another-secret-another-secret-another-0123', 15);
    await expect(verifyAccessToken(token, SECRET)).rejects.toThrow();
  });

  it('rejects an expired token', async () => {
    const token = await signAccessToken(ctxFor('owner'), SECRET, -5);
    await expect(verifyAccessToken(token, SECRET)).rejects.toThrow();
  });

  it('drops unknown permission strings instead of trusting them', async () => {
    const { SignJWT } = await import('jose');
    const token = await new SignJWT({ org: 1, roles: ['owner'], perms: ['finance:read', 'root:everything'] })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject('9')
      .setIssuer('transaxis-api')
      .setAudience('transaxis-web')
      .setExpirationTime('5m')
      .sign(new TextEncoder().encode(SECRET));
    const ctx = await verifyAccessToken(token, SECRET);
    expect([...ctx.permissions]).toEqual(['finance:read']);
  });
});

describe('authenticate + requirePermission', () => {
  const app = express();
  app.get('/finance', authenticate(SECRET), requirePermission('finance:read'), (req, res) => {
    res.json({ org: requireContext(req).orgId });
  });
  app.use(createErrorHandler(silent));

  it('401 without a token', async () => {
    const res = await request(app).get('/finance');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('401 for a garbage token', async () => {
    const res = await request(app).get('/finance').set('authorization', 'Bearer not.a.jwt');
    expect(res.status).toBe(401);
  });

  it('403 when the role lacks the permission', async () => {
    const token = await signAccessToken(ctxFor('driver'), SECRET, 15);
    const res = await request(app).get('/finance').set('authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('200 when the role holds the permission', async () => {
    const token = await signAccessToken(ctxFor('accountant'), SECRET, 15);
    const res = await request(app).get('/finance').set('authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.org).toBe(1);
  });
});

describe('AppError helpers', () => {
  it('maps to the expected statuses', () => {
    expect(AppError.notFound('Vehicle').status).toBe(404);
    expect(AppError.forbidden().status).toBe(403);
    expect(AppError.conflict('x').status).toBe(409);
    expect(AppError.businessRule('x').status).toBe(422);
  });
});
