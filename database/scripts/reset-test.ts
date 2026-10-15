/**
 * Drops every table in the TEST database and re-applies migrations.
 * Refuses to touch any database whose name does not end in `_test`.
 */
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDb } from '../src/client.js';
import { loadEnv, requireEnv } from './env.js';
import { runMigrations } from './migrate.js';

export async function resetTestDatabase(url: string): Promise<void> {
  const dbName = new URL(url).pathname.replace(/^\//, '');
  if (!dbName.endsWith('_test')) {
    throw new Error(`Refusing to reset "${dbName}": database name must end with _test`);
  }

  const handle = createDb(url, 1);
  try {
    const conn = await handle.pool.getConnection();
    try {
      await conn.query('SET FOREIGN_KEY_CHECKS = 0');
      const [rows] = await conn.query(
        'SELECT table_name AS t FROM information_schema.tables WHERE table_schema = ?',
        [dbName],
      );
      for (const r of rows as { t: string }[]) {
        await conn.query(`DROP TABLE IF EXISTS \`${dbName}\`.\`${r.t}\``);
      }
      await conn.query('SET FOREIGN_KEY_CHECKS = 1');
    } finally {
      conn.release();
    }
  } finally {
    await handle.close();
  }
  await runMigrations(url);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  loadEnv();
  const url = requireEnv('DATABASE_URL_TEST');
  resetTestDatabase(url)
    .then(() => console.log('Test database reset and migrated'))
    .catch((err) => {
      console.error(err instanceof Error ? err.message : err);
      process.exit(1);
    });
}
