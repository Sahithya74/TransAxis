/** Applies pending SQL migrations from database/migrations to DATABASE_URL (or DATABASE_URL_TEST). */
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/mysql2/migrator';
import { createDb } from '../src/client.js';
import { loadEnv, requireEnv } from './env.js';

loadEnv();

const here = dirname(fileURLToPath(import.meta.url));
export const MIGRATIONS_FOLDER = resolve(here, '..', 'migrations');

export async function runMigrations(url: string): Promise<void> {
  const handle = createDb(url, 2);
  try {
    await migrate(handle.db, { migrationsFolder: MIGRATIONS_FOLDER });
  } finally {
    await handle.close();
  }
}

// Only run when invoked directly (`npm run db:migrate`), not when imported by reset-test.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const target = process.argv.includes('--test') ? 'DATABASE_URL_TEST' : 'DATABASE_URL';
  runMigrations(requireEnv(target))
    .then(() => console.log(`Migrations applied to ${target}`))
    .catch((err) => {
      console.error('Migration failed:', err instanceof Error ? err.message : err);
      process.exit(1);
    });
}
