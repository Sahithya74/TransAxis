/**
 * One-off local setup. Uses the MySQL *admin* account from .env to create:
 *   - databases `transaxis` and `transaxis_test` (utf8mb4)
 *   - a least-privilege user `transaxis_app` with rights on those two schemas only
 * then writes DATABASE_URL / DATABASE_URL_TEST into .env.
 *
 * The admin credentials are used only here; the running app never sees them.
 */
import { randomBytes } from 'node:crypto';
import mysql from 'mysql2/promise';
import { loadEnv, writeEnvValue } from './env.js';

loadEnv();

const host = process.env.MYSQL_HOST || '127.0.0.1';
const port = Number(process.env.MYSQL_PORT || 3306);
const adminUser = process.env.MYSQL_ADMIN_USER || 'root';
const adminPassword = process.env.MYSQL_ADMIN_PASSWORD ?? '';

const APP_USER = 'transaxis_app';
const DATABASES = ['transaxis', 'transaxis_test'] as const;

async function main() {
  if (!adminPassword) {
    console.warn(
      'MYSQL_ADMIN_PASSWORD is empty in .env. Trying an empty password; fill it in if this fails.',
    );
  }

  let conn: mysql.Connection;
  try {
    conn = await mysql.createConnection({ host, port, user: adminUser, password: adminPassword });
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    if (e.code === 'ECONNREFUSED') {
      console.error(
        `Cannot reach MySQL at ${host}:${port}. Start the service first (admin shell): net start MySQL80`,
      );
    } else if (e.code === 'ER_ACCESS_DENIED_ERROR') {
      console.error(`MySQL rejected the admin login for "${adminUser}". Check MYSQL_ADMIN_PASSWORD in .env.`);
    } else {
      console.error(`MySQL connection failed: ${e.message}`);
    }
    process.exit(1);
  }

  const [rows] = await conn.query('SELECT VERSION() AS v');
  console.log(`Connected to MySQL ${(rows as { v: string }[])[0]?.v}`);

  for (const db of DATABASES) {
    await conn.query(
      `CREATE DATABASE IF NOT EXISTS \`${db}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci`,
    );
    console.log(`Database ready: ${db}`);
  }

  // Only (re)generate the app password when .env doesn't already hold a working URL.
  const existingUrl = process.env.DATABASE_URL;
  let password: string | undefined;
  if (existingUrl) {
    try {
      password = decodeURIComponent(new URL(existingUrl).password) || undefined;
    } catch {
      password = undefined;
    }
  }
  const generated = !password;
  password ??= randomBytes(24).toString('hex');

  await conn.query(`CREATE USER IF NOT EXISTS '${APP_USER}'@'localhost' IDENTIFIED BY ?`, [password]);
  await conn.query(`CREATE USER IF NOT EXISTS '${APP_USER}'@'127.0.0.1' IDENTIFIED BY ?`, [password]);
  if (generated) {
    await conn.query(`ALTER USER '${APP_USER}'@'localhost' IDENTIFIED BY ?`, [password]);
    await conn.query(`ALTER USER '${APP_USER}'@'127.0.0.1' IDENTIFIED BY ?`, [password]);
  }
  for (const db of DATABASES) {
    for (const h of ['localhost', '127.0.0.1']) {
      await conn.query(`GRANT ALL PRIVILEGES ON \`${db}\`.* TO '${APP_USER}'@'${h}'`);
    }
  }
  await conn.query('FLUSH PRIVILEGES');
  console.log(`App user ready: ${APP_USER} (rights limited to ${DATABASES.join(', ')})`);

  // Migrations create triggers (append-only audit/ledger). With binary logging on, MySQL requires
  // this flag for non-SUPER users. It is a runtime setting and resets on server restart.
  try {
    await conn.query('SET GLOBAL log_bin_trust_function_creators = 1');
    console.log('Enabled log_bin_trust_function_creators (runtime only) so migrations can add triggers.');
  } catch {
    console.warn(
      'Could not set log_bin_trust_function_creators. If trigger migrations fail, run it as admin or add it to my.ini.',
    );
  }
  await conn.end();

  const enc = encodeURIComponent(password);
  writeEnvValue('DATABASE_URL', `mysql://${APP_USER}:${enc}@${host}:${port}/transaxis`);
  writeEnvValue('DATABASE_URL_TEST', `mysql://${APP_USER}:${enc}@${host}:${port}/transaxis_test`);
  console.log('Wrote DATABASE_URL and DATABASE_URL_TEST to .env');
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
