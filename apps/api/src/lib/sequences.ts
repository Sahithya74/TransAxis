import { sql } from 'drizzle-orm';
import type { Tx } from '@transaxis/database';

export type SequenceScope = 'BKG' | 'TRP' | 'LR' | 'INC' | 'JV' | 'INV' | 'CN' | 'RCP' | 'EXP' | 'ADV' | 'STL' | 'WO';

/**
 * Next human-readable number for an org, e.g. TRP-2026-000123.
 *
 * One atomic statement takes an exclusive lock on the counter row (inserting it on first use) and
 * stashes the new value in LAST_INSERT_ID, which is per-connection. A separate INSERT IGNORE +
 * SELECT … FOR UPDATE deadlocks under concurrency (two shared locks both upgrading to exclusive).
 * Must run inside a transaction so both statements use the same connection.
 */
export async function nextNumber(tx: Tx, orgId: number, scope: SequenceScope, year: number): Promise<string> {
  await tx.execute(
    sql`INSERT INTO number_sequences (org_id, scope, year, next_value) VALUES (${orgId}, ${scope}, ${year}, LAST_INSERT_ID(2))
        ON DUPLICATE KEY UPDATE next_value = LAST_INSERT_ID(next_value + 1)`,
  );
  const [rows] = (await tx.execute(sql`SELECT LAST_INSERT_ID() AS v`)) as unknown as [{ v: number | string }[]];
  const value = Number(rows[0]!.v) - 1;
  return `${scope}-${year}-${String(value).padStart(6, '0')}`;
}
