import { drizzle, type MySql2Database } from 'drizzle-orm/mysql2';
import { createPool, type Pool } from 'mysql2/promise';
import * as schema from './schema/index.js';

export type Db = MySql2Database<typeof schema>;
/** A transaction handle; accepted anywhere a `Db` is, so helpers can join an outer transaction. */
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
export type DbOrTx = Db | Tx;

export interface DbHandle {
  db: Db;
  pool: Pool;
  close(): Promise<void>;
}

/**
 * Creates a pooled connection. Dates are exchanged as UTC; decimals come back as strings so money
 * math can use Big.js instead of floats.
 */
export function createDb(databaseUrl: string, connectionLimit = 10): DbHandle {
  const pool = createPool({
    uri: databaseUrl,
    connectionLimit,
    timezone: 'Z',
    dateStrings: false,
    decimalNumbers: false,
    namedPlaceholders: false,
  });
  const db = drizzle(pool, { schema, mode: 'default' });
  return { db, pool, close: () => pool.end() };
}

/** True for MySQL duplicate-key errors (ER_DUP_ENTRY), including when wrapped by Drizzle. */
export function isDuplicateKeyError(err: unknown): boolean {
  let e: unknown = err;
  for (let i = 0; i < 3 && e; i++) {
    if ((e as { code?: string }).code === 'ER_DUP_ENTRY') return true;
    e = (e as { cause?: unknown }).cause;
  }
  return false;
}
