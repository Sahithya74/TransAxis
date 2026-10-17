import Big from 'big.js';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { journalEntries, journalLines, ledgerAccounts, type Db, type DbOrTx, type Tx } from '@transaxis/database';
import { SYSTEM_ACCOUNTS, isBalanced, type JournalSource, type SystemAccount } from '@transaxis/shared';
import { AppError } from '../../lib/errors.js';
import { getOrgInfo, orgToday, orgYear } from '../../lib/org.js';
import { nextNumber } from '../../lib/sequences.js';

export interface PostingLine {
  account: SystemAccount;
  debit?: Big | string | number;
  credit?: Big | string | number;
  tripId?: number | null;
  vehicleId?: number | null;
  customerId?: number | null;
  vendorId?: number | null;
  workerId?: number | null;
  memo?: string | null;
}

export interface Posting {
  orgId: number;
  date?: string;
  memo: string;
  source: JournalSource;
  sourceId?: number | null;
  /** Same key, same entry: a retried posting returns the original instead of booking twice. */
  idempotencyKey: string;
  userId?: number | null;
  lines: PostingLine[];
}

const toStr = (v: Big | string | number | undefined) => (v === undefined ? '0.00' : new Big(v).round(2, Big.roundHalfUp).toFixed(2));

/**
 * Double-entry postings. Every financial event creates one balanced journal entry inside the caller's
 * transaction. Lines are append-only (database triggers); mistakes are corrected with reversals.
 */
export class LedgerService {
  constructor(private readonly db: Db) {}

  /** Creates the standard chart of accounts for an organisation if it is missing (idempotent). */
  async ensureAccounts(db: DbOrTx, orgId: number): Promise<Map<SystemAccount, number>> {
    const existing = await db.select().from(ledgerAccounts).where(eq(ledgerAccounts.orgId, orgId));
    const have = new Set(existing.map((a) => a.systemKey));
    const missing = (Object.keys(SYSTEM_ACCOUNTS) as SystemAccount[]).filter((k) => !have.has(k));
    if (missing.length) {
      await db
        .insert(ledgerAccounts)
        .ignore()
        .values(missing.map((k) => ({ orgId, code: SYSTEM_ACCOUNTS[k].code, name: SYSTEM_ACCOUNTS[k].name, accountType: SYSTEM_ACCOUNTS[k].type, systemKey: k })));
    }
    const rows = missing.length ? await db.select().from(ledgerAccounts).where(eq(ledgerAccounts.orgId, orgId)) : existing;
    return new Map(rows.filter((a) => a.systemKey).map((a) => [a.systemKey as SystemAccount, a.id]));
  }

  async post(tx: Tx, p: Posting): Promise<number> {
    const lines = p.lines.filter((l) => new Big(l.debit ?? 0).gt(0) || new Big(l.credit ?? 0).gt(0));
    if (!isBalanced(lines.map((l) => ({ debit: toStr(l.debit), credit: toStr(l.credit) })))) {
      throw new AppError(500, 'INTERNAL_ERROR', `Journal entry for ${p.memo} does not balance`);
    }
    const [dup] = await tx.select({ id: journalEntries.id }).from(journalEntries).where(and(eq(journalEntries.orgId, p.orgId), eq(journalEntries.idempotencyKey, p.idempotencyKey)));
    if (dup) return dup.id;
    const accounts = await this.ensureAccounts(tx, p.orgId);
    const org = await getOrgInfo(this.db, p.orgId);
    const date = p.date ?? orgToday(org);
    const entryNo = await nextNumber(tx, p.orgId, 'JV', orgYear(org, new Date(`${date}T12:00:00Z`)));
    const [row] = await tx
      .insert(journalEntries)
      .values({ orgId: p.orgId, entryNo, entryDate: date, memo: p.memo.slice(0, 255), sourceType: p.source, sourceId: p.sourceId ?? null, idempotencyKey: p.idempotencyKey.slice(0, 120), createdBy: p.userId ?? null })
      .$returningId();
    await tx.insert(journalLines).values(
      lines.map((l) => ({
        orgId: p.orgId,
        entryId: row!.id,
        accountId: accounts.get(l.account)!,
        debit: toStr(l.debit),
        credit: toStr(l.credit),
        tripId: l.tripId ?? null,
        vehicleId: l.vehicleId ?? null,
        customerId: l.customerId ?? null,
        vendorId: l.vendorId ?? null,
        workerId: l.workerId ?? null,
        memo: l.memo?.slice(0, 255) ?? null,
      })),
    );
    return row!.id;
  }

  /** Posts the mirror image of an entry (debits become credits). The original stays untouched. */
  async reverse(tx: Tx, orgId: number, entryId: number, memo: string, userId: number | null): Promise<number> {
    const [orig] = await tx.select().from(journalEntries).where(and(eq(journalEntries.id, entryId), eq(journalEntries.orgId, orgId)));
    if (!orig) throw AppError.notFound('Journal entry');
    const [already] = await tx.select({ id: journalEntries.id }).from(journalEntries).where(eq(journalEntries.reversalOfId, entryId));
    if (already) return already.id;
    const lines = await tx.select({ l: journalLines, key: ledgerAccounts.systemKey }).from(journalLines).innerJoin(ledgerAccounts, eq(ledgerAccounts.id, journalLines.accountId)).where(eq(journalLines.entryId, entryId));
    const id = await this.post(tx, {
      orgId,
      memo: `Reversal of ${orig.entryNo}: ${memo}`,
      source: 'reversal',
      sourceId: entryId,
      idempotencyKey: `reversal:${entryId}`,
      userId,
      lines: lines.map(({ l, key }) => ({
        account: key as SystemAccount,
        debit: l.credit,
        credit: l.debit,
        tripId: l.tripId,
        vehicleId: l.vehicleId,
        customerId: l.customerId,
        vendorId: l.vendorId,
        workerId: l.workerId,
        memo: l.memo,
      })),
    });
    await tx.update(journalEntries).set({ reversalOfId: entryId }).where(eq(journalEntries.id, id));
    return id;
  }

  /** Balances per account for a date range (trial balance). */
  async trialBalance(orgId: number, from?: string, to?: string) {
    const conds = [eq(journalLines.orgId, orgId)];
    if (from) conds.push(sql`${journalEntries.entryDate} >= ${from}`);
    if (to) conds.push(sql`${journalEntries.entryDate} <= ${to}`);
    const rows = await this.db
      .select({
        id: ledgerAccounts.id,
        code: ledgerAccounts.code,
        name: ledgerAccounts.name,
        type: ledgerAccounts.accountType,
        key: ledgerAccounts.systemKey,
        debit: sql<string>`COALESCE(SUM(${journalLines.debit}), 0)`,
        credit: sql<string>`COALESCE(SUM(${journalLines.credit}), 0)`,
      })
      .from(journalLines)
      .innerJoin(journalEntries, eq(journalEntries.id, journalLines.entryId))
      .innerJoin(ledgerAccounts, eq(ledgerAccounts.id, journalLines.accountId))
      .where(and(...conds))
      .groupBy(ledgerAccounts.id)
      .orderBy(asc(ledgerAccounts.code));
    return rows.map((r) => {
      const balance = new Big(r.debit).minus(r.credit);
      return { ...r, debit: toStr(r.debit), credit: toStr(r.credit), balance: toStr(balance) };
    });
  }

  async entriesFor(orgId: number, source: JournalSource, sourceIds: number[]) {
    if (!sourceIds.length) return [];
    return this.db.select().from(journalEntries).where(and(eq(journalEntries.orgId, orgId), eq(journalEntries.sourceType, source), inArray(journalEntries.sourceId, sourceIds)));
  }
}
