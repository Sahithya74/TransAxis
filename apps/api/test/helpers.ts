import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { Express } from 'express';
import { pino } from 'pino';
import request from 'supertest';
import { createDb, type DbHandle } from '@transaxis/database';
import { createApp } from '../src/app.js';
import { loadConfig, type Env } from '../src/config/env.js';
import { CapturingProvider } from '../src/providers/messaging.js';

const envFile = resolve(import.meta.dirname, '..', '..', '..', '.env');
if (existsSync(envFile)) process.loadEnvFile(envFile);

export const TEST_DB_URL = process.env.DATABASE_URL_TEST;
export const hasDb = Boolean(TEST_DB_URL);
export const DEMO_PASSWORD = 'Demo@12345';

export interface TestApp {
  app: Express;
  config: Env;
  handle: DbHandle;
  messenger: CapturingProvider;
  close(): Promise<void>;
}

export function createTestApp(env: NodeJS.ProcessEnv = {}): TestApp {
  const handle = createDb(TEST_DB_URL!, 5);
  const messenger = new CapturingProvider();
  const config = loadConfig({
    ...process.env,
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    DATABASE_URL: TEST_DB_URL,
    WEB_ORIGIN: 'http://localhost:5173',
    EXTRA_WEB_ORIGINS: '',
    UPLOAD_DIR: mkdtempSync(join(tmpdir(), 'transaxis-uploads-')),
    MAX_UPLOAD_MB: '1',
    ...env,
  });
  const app = createApp({ config, logger: pino({ level: 'silent' }), db: handle.db, messenger });
  return { app, config, handle, messenger, close: () => handle.close() };
}

export interface LoggedIn {
  token: string;
  cookie: string;
  body: { user: { id: number; permissions: string[]; roles: string[] }; organization: { id: number } };
}

/** Extracts the `tx_rt=...` pair from Set-Cookie for replaying in later requests. */
export function refreshCookie(setCookie: string[] | string | undefined): string {
  const list = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];
  const c = list.find((x) => x.startsWith('tx_rt='));
  if (!c) throw new Error('No refresh cookie in response');
  return c.split(';')[0]!;
}

export async function login(app: Express, email: string, password = DEMO_PASSWORD): Promise<LoggedIn> {
  const res = await request(app).post('/api/v1/auth/login').send({ email, password });
  if (res.status !== 200) throw new Error(`login ${email} failed: ${res.status} ${JSON.stringify(res.body)}`);
  return { token: res.body.accessToken, cookie: refreshCookie(res.headers['set-cookie']), body: res.body };
}

export const bearer = (token: string) => ({ authorization: `Bearer ${token}` });
