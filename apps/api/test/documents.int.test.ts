import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { and, eq } from 'drizzle-orm';
import { jwtVerify } from 'jose';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { aiQueries, auditLogs, documents } from '@transaxis/database';
import type { DocumentDto } from '@transaxis/shared';
import { bearer, createTestApp, hasDb, login, type LoggedIn, type TestApp } from './helpers.js';

const SECRET = 'rag-test-secret-'.padEnd(48, 'z');

interface Call {
  method: string;
  path: string;
  claims: Record<string, unknown>;
  body: Record<string, unknown> | null;
}

/** Stands in for the RAG service: checks the API's signed token and records what it was asked. */
function fakeRag(): Promise<{ server: Server; url: string; calls: Call[] }> {
  const calls: Call[] = [];
  const server = createServer(async (req, res) => {
    const send = (status: number, body: unknown) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    if (req.url === '/health') return send(200, { status: 'ok', embedding: 'hashing-v1', llm: 'mock', model: null });
    let claims: Record<string, unknown>;
    try {
      const token = (req.headers.authorization ?? '').replace(/^Bearer /, '');
      ({ payload: claims } = await jwtVerify(token, new TextEncoder().encode(SECRET), { issuer: 'transaxis-api', audience: 'transaxis-rag' }));
    } catch {
      return send(401, { detail: 'bad token' });
    }
    let raw = '';
    for await (const chunk of req) raw += chunk;
    const body = raw ? (JSON.parse(raw) as Record<string, unknown>) : null;
    calls.push({ method: req.method!, path: req.url!, claims, body });
    if (req.url === '/internal/v1/status') return send(200, { documentsReady: 3, mode: 'mock', model: null, embedding: 'hashing-v1' });
    if (req.url === '/internal/v1/ask') {
      return send(200, {
        answer: `You asked: ${body?.question} [1]`,
        route: 'document',
        period: null,
        citations: [{ index: 1, chunkId: 1, documentId: 1, title: 'Policy', filename: 'p.txt', page: null, section: null, snippet: 'Rs 350 per day', score: 0.03 }],
        structured: [],
        clarification: null,
        mode: 'mock',
        model: null,
        warnings: [],
        latencyMs: 4,
      });
    }
    if (req.method === 'POST' && /\/ingest$/.test(req.url!)) return send(202, { accepted: true });
    if (req.method === 'DELETE') return send(200, { deleted: true });
    send(404, {});
  });
  return new Promise((ok) => server.listen(0, '127.0.0.1', () => ok({ server, url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, calls })));
}

describe.skipIf(!hasDb)('document library and assistant (integration)', () => {
  let t: TestApp;
  let rag: Awaited<ReturnType<typeof fakeRag>>;
  let owner: LoggedIn;
  let dispatch: LoggedIn;
  let hr: LoggedIn;
  let driver: LoggedIn;
  let otherOrg: LoggedIn;
  let uploadDir: string;

  beforeAll(async () => {
    rag = await fakeRag();
    t = createTestApp({ RAG_SERVICE_URL: rag.url, RAG_SERVICE_SECRET: SECRET });
    uploadDir = t.config.UPLOAD_DIR;
    [owner, dispatch, hr, driver, otherOrg] = (await Promise.all(
      ['owner@kaveri.demo', 'dispatch@kaveri.demo', 'hr@kaveri.demo', 'driver@kaveri.demo', 'owner@sahyadri.demo'].map((e) => login(t.app, e)),
    )) as [LoggedIn, LoggedIn, LoggedIn, LoggedIn, LoggedIn];
  });
  afterAll(async () => {
    await t.close();
    rag.server.close();
  });

  const list = async (who: LoggedIn, query: Record<string, string> = {}) =>
    (await request(t.app).get('/api/v1/documents').query({ pageSize: 100, ...query }).set(bearer(who.token))).body.data as DocumentDto[];
  const upload = (who: LoggedIn, name: string, content: Buffer | string, fields: Record<string, string> = {}, path = '/api/v1/documents') =>
    request(t.app)
      .post(path)
      .set(bearer(who.token))
      .field('title', fields.title ?? `Test ${name}`)
      .field('classification', fields.classification ?? 'general')
      .field('docType', fields.docType ?? 'policy')
      .attach('file', Buffer.isBuffer(content) ? content : Buffer.from(content), name);
  const settle = () => new Promise((r) => setTimeout(r, 150));

  it('shows each person only the classifications they may read', async () => {
    const titles = async (who: LoggedIn) => (await list(who)).map((d) => d.classification);
    expect(new Set(await titles(owner))).toEqual(new Set(['general', 'operations', 'finance', 'management']));
    expect(new Set(await titles(dispatch))).toEqual(new Set(['general', 'operations']));
    expect(new Set(await titles(hr))).toEqual(new Set(['general', 'operations', 'hr']));
    const board = (await list(owner)).find((d) => d.classification === 'management')!;
    expect((await request(t.app).get(`/api/v1/documents/${board.id}`).set(bearer(dispatch.token))).status).toBe(404);
    expect((await request(t.app).get(`/api/v1/documents/${board.id}`).set(bearer(otherOrg.token))).status).toBe(404);
    expect((await request(t.app).get('/api/v1/documents').set(bearer(driver.token))).status).toBe(403);
    expect((await list(otherOrg)).map((d) => d.title)).toEqual(['Notice to all systems (injection test)']);
  });

  it('checks the content, not just the file name', async () => {
    expect((await upload(owner, 'virus.exe', 'MZ binary')).status).toBe(415);
    expect((await upload(owner, 'fake.pdf', 'this is not a pdf')).status).toBe(415);
    expect((await upload(owner, 'binary.txt', Buffer.from([0x00, 0x01, 0x02, 0xff, 0xfe]))).status).toBe(415);
    expect((await upload(owner, 'empty.txt', '')).status).toBe(400);
    const res = await upload(dispatch, 'board.txt', 'Secret plans', { classification: 'management' });
    expect(res.status).toBe(403);
  });

  it('stores an upload, queues it and asks the RAG service to index it for that organisation', async () => {
    rag.calls.length = 0;
    const res = await upload(owner, 'detention.txt', 'Detention\nAfter 4 free hours, detention is Rs 1,500 per 6 hours.', { title: 'Detention rules' });
    expect(res.status).toBe(201);
    const doc = res.body as DocumentDto;
    expect(doc).toMatchObject({ title: 'Detention rules', status: 'queued', version: 1, mime: 'text/plain', originalName: 'detention.txt' });
    await settle();
    const call = rag.calls.find((c) => c.path === `/internal/v1/documents/${doc.id}/ingest`);
    expect(call?.claims.org).toBe(owner.body.organization.id);
    const dl = await request(t.app).get(`/api/v1/documents/${doc.id}/download`).set(bearer(dispatch.token)).buffer(true).parse((r, cb) => {
      let data = '';
      r.on('data', (c: Buffer) => (data += c.toString()));
      r.on('end', () => cb(null, data));
    });
    expect(dl.status).toBe(200);
    expect(dl.body).toContain('Rs 1,500 per 6 hours');
    const [logged] = await t.handle.db.select().from(auditLogs).where(and(eq(auditLogs.action, 'document.downloaded'), eq(auditLogs.entityId, String(doc.id))));
    expect(logged).toBeDefined();
  });

  it('keeps old versions out of search, reprocesses on request and deletes every version', async () => {
    const first = (await upload(owner, 'tolls-v1.txt', 'Tolls are paid by FASTag.', { title: 'Toll rules' })).body as DocumentDto;
    rag.calls.length = 0;
    const second = await upload(owner, 'tolls-v2.txt', 'Tolls are paid by FASTag. Cash tolls need a receipt.', { title: 'Toll rules' }, `/api/v1/documents/${first.id}/versions`);
    expect(second.status).toBe(201);
    expect(second.body).toMatchObject({ version: 2, replacesId: first.id });
    expect((await request(t.app).get(`/api/v1/documents/${first.id}`).set(bearer(owner.token))).body.status).toBe('superseded');
    expect((await list(owner)).some((d) => d.id === first.id)).toBe(false);
    expect((await list(owner, { includeSuperseded: 'true' })).some((d) => d.id === first.id)).toBe(true);
    await settle();
    expect(rag.calls.some((c) => c.method === 'DELETE' && c.path === `/internal/v1/documents/${first.id}`)).toBe(true);

    const re = await request(t.app).post(`/api/v1/documents/${second.body.id}/reprocess`).set(bearer(owner.token));
    expect(re.body.status).toBe('queued');

    const [row] = await t.handle.db.select().from(documents).where(eq(documents.id, second.body.id));
    expect((await request(t.app).delete(`/api/v1/documents/${second.body.id}`).set(bearer(dispatch.token))).status).toBe(204);
    expect((await request(t.app).get(`/api/v1/documents/${second.body.id}`).set(bearer(owner.token))).status).toBe(404);
    expect((await request(t.app).get(`/api/v1/documents/${first.id}`).set(bearer(owner.token))).status).toBe(404);
    expect(existsSync(join(uploadDir, row!.storageKey))).toBe(false);
  });

  it('answers through the RAG service with the asker’s own permissions, and keeps a record', async () => {
    rag.calls.length = 0;
    const res = await request(t.app).post('/api/v1/ai/ask').set(bearer(owner.token)).send({ question: 'What is the food allowance?' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ answer: 'You asked: What is the food allowance? [1]', mode: 'mock', route: 'document' });
    const call = rag.calls.find((c) => c.path === '/internal/v1/ask')!;
    expect(call.claims).toMatchObject({ org: owner.body.organization.id, sub: String(owner.body.user.id), tok: owner.token });
    expect(new Set(call.claims.cls as string[])).toEqual(new Set(['general', 'operations', 'finance', 'management']));
    expect((call.claims.exp as number) - (call.claims.iat as number)).toBeLessThanOrEqual(120);
    const [row] = await t.handle.db.select().from(aiQueries).where(eq(aiQueries.id, res.body.id));
    expect(row).toMatchObject({ userId: owner.body.user.id, question: 'What is the food allowance?', route: 'document', mode: 'mock' });
    expect(row!.citations).toHaveLength(1);

    const history = await request(t.app).get('/api/v1/ai/history').set(bearer(owner.token));
    expect(history.body.data[0]).toMatchObject({ question: 'What is the food allowance?' });
    const status = await request(t.app).get('/api/v1/ai/status').set(bearer(owner.token));
    expect(status.body).toMatchObject({ available: true, mode: 'mock', documentsReady: 3 });

    expect((await request(t.app).post('/api/v1/ai/ask').set(bearer(driver.token)).send({ question: 'hello there' })).status).toBe(403);
    expect((await request(t.app).post('/api/v1/ai/ask').set(bearer(owner.token)).send({ question: 'x'.repeat(1001) })).status).toBe(400);
  });

  it('hands queued documents to the RAG service from the background job', async () => {
    rag.calls.length = 0;
    const live = t.app.locals.live as { documents: { dispatchQueued(): Promise<number> } };
    const sent = await live.documents.dispatchQueued();
    expect(sent).toBeGreaterThan(0);
    expect(rag.calls.filter((c) => c.path.endsWith('/ingest')).length).toBe(sent);
  });

  it('says plainly when the RAG service is down', async () => {
    const down = createTestApp({ RAG_SERVICE_URL: 'http://127.0.0.1:9', RAG_SERVICE_SECRET: SECRET });
    try {
      const who = await login(down.app, 'owner@kaveri.demo');
      const res = await request(down.app).post('/api/v1/ai/ask').set(bearer(who.token)).send({ question: 'What is the food allowance?' });
      expect(res.status).toBe(503);
      expect(res.body.error.code).toBe('SERVICE_UNAVAILABLE');
      const status = await request(down.app).get('/api/v1/ai/status').set(bearer(who.token));
      expect(status.body).toMatchObject({ available: false });
      const up = await upload(who, 'still-works.txt', 'Uploads are kept even when search is down.');
      expect(up.status).toBe(201);
      expect(up.body.status).toBe('queued');
    } finally {
      await down.close();
    }
  });
});
