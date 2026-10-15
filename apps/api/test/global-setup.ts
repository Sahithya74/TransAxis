import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { createDb } from '@transaxis/database';
import { resetTestDatabase, seedDatabase } from '@transaxis/database/testing';
import { todayIn } from '@transaxis/shared';

/** Rebuilds transaxis_test from migrations and loads the demo seed once per test run. */
export default async function setup() {
  const env = resolve(import.meta.dirname, '..', '..', '..', '.env');
  if (existsSync(env)) process.loadEnvFile(env);
  const url = process.env.DATABASE_URL_TEST;
  if (!url) {
    console.warn('[api tests] DATABASE_URL_TEST not set: integration tests will be skipped');
    return;
  }
  await resetTestDatabase(url);
  const handle = createDb(url, 2);
  try {
    await seedDatabase(handle.db, { anchorDate: todayIn('Asia/Kolkata') });
  } finally {
    await handle.close();
  }
}
