import { and, eq, sql } from 'drizzle-orm';
import { numberSequences, type Tx } from '@transaxis/database';

export type SequenceScope = 'BKG' | 'TRP' | 'LR';

/**
 * Next human-readable number for an org, e.g. TRP-2026-000123. Must run inside a transaction: the
 * counter row is locked with SELECT … FOR UPDATE, so concurrent requests never get the same number.
 */
export async function nextNumber(tx: Tx, orgId: number, scope: SequenceScope, year: number): Promise<string> {
  await tx.execute(sql`INSERT IGNORE INTO number_sequences (org_id, scope, year, next_value) VALUES (${orgId}, ${scope}, ${year}, 1)`);
  const [row] = await tx
    .select({ next: numberSequences.nextValue })
    .from(numberSequences)
    .where(and(eq(numberSequences.orgId, orgId), eq(numberSequences.scope, scope), eq(numberSequences.year, year)))
    .for('update');
  const value = row!.next;
  await tx
    .update(numberSequences)
    .set({ nextValue: value + 1 })
    .where(and(eq(numberSequences.orgId, orgId), eq(numberSequences.scope, scope), eq(numberSequences.year, year)));
  return `${scope}-${year}-${String(value).padStart(6, '0')}`;
}
