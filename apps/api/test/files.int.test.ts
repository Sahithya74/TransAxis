import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { VehicleDto } from '@transaxis/shared';
import { sanitiseName } from '../src/modules/files/service.js';
import { bearer, createTestApp, hasDb, login, type TestApp } from './helpers.js';

// Smallest valid-looking PDF and PNG headers; file-type detects by magic bytes.
const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');
const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d6a4d70000000049454e44ae426082', 'hex');
const EXE = Buffer.concat([Buffer.from('MZ'), Buffer.alloc(200, 0x90)]);

describe('sanitiseName', () => {
  it('strips paths and forces the detected extension', () => {
    expect(sanitiseName('..\\..\\windows\\evil.exe', 'pdf')).toBe('evil.pdf');
    expect(sanitiseName('insurance "2026".PDF', 'pdf')).toBe('insurance 2026.pdf');
    expect(sanitiseName('', 'png')).toBe('file.png');
  });
});

describe.skipIf(!hasDb)('files (integration)', () => {
  let t: TestApp;
  let maintenance: string;
  let dispatcher: string;
  let driver: string;
  let otherOrg: string;

  beforeAll(async () => {
    t = createTestApp();
    [maintenance, dispatcher, driver, otherOrg] = (
      await Promise.all(
        ['maintenance@kaveri.demo', 'dispatch@kaveri.demo', 'driver@kaveri.demo', 'owner@sahyadri.demo'].map((e) => login(t.app, e)),
      )
    ).map((s) => s.token) as [string, string, string, string];
  });
  afterAll(async () => {
    await t.close();
  });

  const upload = (token: string, buf: Buffer, name: string, category = 'vehicle_document') =>
    request(t.app).post('/api/v1/files').set(bearer(token)).field('category', category).attach('file', buf, name);

  it('stores an allowed file and serves it back to authorised users only', async () => {
    const res = await upload(maintenance, PDF, 'insurance-scan.pdf');
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ originalName: 'insurance-scan.pdf', mime: 'application/pdf', sizeBytes: PDF.length });

    const dl = await request(t.app).get(`/api/v1/files/${res.body.id}/download`).set(bearer(dispatcher)).buffer(true);
    expect(dl.status).toBe(200);
    expect(dl.headers['content-type']).toBe('application/pdf');
    expect(dl.headers['content-disposition']).toMatch(/^attachment;/);
    expect(dl.headers['x-content-type-options']).toBe('nosniff');
    expect(Buffer.from(dl.body).equals(PDF)).toBe(true);

    // Another organisation cannot see it; a driver lacks vehicles:read.
    expect((await request(t.app).get(`/api/v1/files/${res.body.id}/download`).set(bearer(otherOrg))).status).toBe(404);
    expect((await request(t.app).get(`/api/v1/files/${res.body.id}/download`).set(bearer(driver))).status).toBe(404);
  });

  it('detects the real type and ignores a misleading name', async () => {
    const png = await upload(maintenance, PNG, 'photo.pdf');
    expect(png.status).toBe(201);
    expect(png.body).toMatchObject({ mime: 'image/png', originalName: 'photo.png' });

    const exe = await upload(maintenance, EXE, 'invoice.pdf');
    expect(exe.status).toBe(415);
    expect(exe.body.error.code).toBe('UNSUPPORTED_MEDIA_TYPE');
  });

  it('enforces size limits, required fields and upload permission', async () => {
    const big = await upload(maintenance, Buffer.concat([PDF, Buffer.alloc(1024 * 1024 + 10)]), 'big.pdf');
    expect(big.status).toBe(413);

    const noFile = await request(t.app).post('/api/v1/files').set(bearer(maintenance)).field('category', 'vehicle_document');
    expect(noFile.status).toBe(400);

    const badCategory = await upload(maintenance, PDF, 'x.pdf', 'anything');
    expect(badCategory.status).toBe(400);

    // Dispatchers can read vehicle documents but not upload them.
    expect((await upload(dispatcher, PDF, 'x.pdf')).status).toBe(403);
    expect((await request(t.app).post('/api/v1/files').attach('file', PDF, 'x.pdf')).status).toBe(401);
  });

  it('links an uploaded scan to a vehicle document, but not another org\'s file', async () => {
    const vehicles = await request(t.app).get('/api/v1/vehicles').set(bearer(maintenance));
    const v = vehicles.body.data[0] as VehicleDto;
    const file = await upload(maintenance, PDF, 'permit.pdf');
    const doc = await request(t.app)
      .post(`/api/v1/vehicles/${v.id}/documents`)
      .set(bearer(maintenance))
      .send({ docType: 'other', documentNo: 'SCAN-1', fileId: file.body.id });
    expect(doc.status).toBe(201);
    expect(doc.body.fileId).toBe(file.body.id);

    // Sahyadri's owner (documents:write) stores a general file in their own organisation…
    const foreign = await upload(otherOrg, PDF, 'foreign.pdf', 'general');
    expect(foreign.status).toBe(201);
    // …which Kaveri cannot attach to its vehicle by guessing the id.
    const steal = await request(t.app)
      .post(`/api/v1/vehicles/${v.id}/documents`)
      .set(bearer(maintenance))
      .send({ docType: 'other', fileId: foreign.body.id });
    expect(steal.status).toBe(400);
  });
});
