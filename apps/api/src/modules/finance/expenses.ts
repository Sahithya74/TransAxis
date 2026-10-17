import type { Request } from 'express';
import { aliasedTable, and, asc, count, desc, eq, gte, inArray, isNull, lte, or, type SQL } from 'drizzle-orm';
import type { z } from 'zod';
import { expenseCategories, expenses, files, trips, users, vehicles, vendors, workers, type Db } from '@transaxis/database';
import { PAYMENT_ACCOUNT, type ExpenseCategoryDto, type ExpenseDto, type ExpenseInput, type Paginated, type SystemAccount } from '@transaxis/shared';
import type { expenseDecisionSchema, expenseListQuerySchema } from '@transaxis/shared';
import { audit } from '../../lib/audit.js';
import type { RequestContext } from '../../lib/context.js';
import { AppError } from '../../lib/errors.js';
import { paginated, parseSort } from '../../lib/http.js';
import { isOwnTrip } from '../../lib/trip-access.js';
import type { NotificationService } from '../notifications/service.js';
import type { LedgerService } from './ledger.js';

export class ExpenseService {
  constructor(
    private readonly db: Db,
    private readonly ledger: LedgerService,
    private readonly notifier: NotificationService,
  ) {}

  async categories(ctx: RequestContext): Promise<ExpenseCategoryDto[]> {
    const rows = await this.db.select().from(expenseCategories).where(and(eq(expenseCategories.orgId, ctx.orgId), eq(expenseCategories.isActive, true))).orderBy(asc(expenseCategories.name));
    return rows.map((c) => ({ id: c.id, name: c.name, accountKey: c.accountKey, isTripExpense: c.isTripExpense, requiresReceiptAbove: c.requiresReceiptAbove }));
  }

  /** Finance sees everything; crew see only what they submitted or were reimbursed for. */
  private scope(ctx: RequestContext): SQL[] {
    const conds: SQL[] = [eq(expenses.orgId, ctx.orgId)];
    if (!ctx.permissions.has('finance:read') && !ctx.permissions.has('finance:post')) {
      if (!ctx.permissions.has('expenses:submit')) throw AppError.forbidden();
      conds.push(or(eq(expenses.submittedBy, ctx.userId), ...(ctx.workerId ? [eq(expenses.workerId, ctx.workerId)] : []))!);
    }
    return conds;
  }

  async list(ctx: RequestContext, q: z.infer<typeof expenseListQuerySchema>): Promise<Paginated<ExpenseDto>> {
    const conds = this.scope(ctx);
    if (q.status) conds.push(eq(expenses.status, q.status));
    if (q.tripId) conds.push(eq(expenses.tripId, q.tripId));
    if (q.workerId) conds.push(eq(expenses.workerId, q.workerId));
    if (q.vehicleId) conds.push(eq(expenses.vehicleId, q.vehicleId));
    if (q.categoryId) conds.push(eq(expenses.categoryId, q.categoryId));
    if (q.from) conds.push(gte(expenses.expenseDate, q.from));
    if (q.to) conds.push(lte(expenses.expenseDate, q.to));
    const where = and(...conds);
    const sort = parseSort<'expenseDate' | 'amount'>(q.sort, 'expenseDate');
    const col = sort.field === 'amount' ? expenses.amount : expenses.expenseDate;
    const descending = q.sort ? sort.desc : true;
    const [[total], rows] = await Promise.all([
      this.db.select({ n: count() }).from(expenses).where(where),
      this.select().where(where).orderBy(descending ? desc(col) : asc(col), desc(expenses.id)).limit(q.pageSize).offset((q.page - 1) * q.pageSize),
    ]);
    return paginated(rows.map(toDto), q.page, q.pageSize, Number(total?.n ?? 0));
  }

  async get(ctx: RequestContext, id: number): Promise<ExpenseDto> {
    const [row] = await this.select().where(and(eq(expenses.id, id), ...this.scope(ctx)));
    if (!row) throw AppError.notFound('Expense');
    return toDto(row);
  }

  async create(ctx: RequestContext, input: ExpenseInput, req: Request): Promise<ExpenseDto> {
    const finance = ctx.permissions.has('finance:post');
    const [cat] = await this.db.select().from(expenseCategories).where(and(eq(expenseCategories.id, input.categoryId), eq(expenseCategories.orgId, ctx.orgId)));
    if (!cat) throw AppError.validation('Unknown category', [{ path: 'categoryId', message: 'Choose a category' }]);
    let { vehicleId = null, workerId = null } = input;
    const tripId = input.tripId ?? null;
    if (tripId) {
      const [t] = await this.db.select().from(trips).where(and(eq(trips.id, tripId), eq(trips.orgId, ctx.orgId)));
      if (!t) throw AppError.validation('Unknown trip', [{ path: 'tripId', message: 'Trip not found' }]);
      if (!finance && !(await isOwnTrip(this.db, ctx, t.id, t.driverId))) throw AppError.forbidden('You can only claim expenses on your own trips');
      if (['reconciled', 'closed', 'cancelled'].includes(t.status)) throw AppError.businessRule(`Trip ${t.tripNo} is ${t.status}; expenses can no longer be added`);
      vehicleId ??= t.vehicleId;
    } else if (!finance) {
      throw AppError.validation('Choose the trip', [{ path: 'tripId', message: 'Required' }]);
    } else if (cat.isTripExpense && !vehicleId) {
      throw AppError.validation('Choose the trip or vehicle', [{ path: 'tripId', message: 'A trip expense needs a trip or vehicle' }]);
    }
    if (!finance) workerId = ctx.workerId; // crew always claim for themselves
    if (input.paymentMode === 'driver_paid' && !workerId) throw AppError.validation('Who paid?', [{ path: 'workerId', message: 'Choose who paid, so they can be reimbursed' }]);
    if (vehicleId && !(await this.db.select({ id: vehicles.id }).from(vehicles).where(and(eq(vehicles.id, vehicleId), eq(vehicles.orgId, ctx.orgId))))[0]) {
      throw AppError.validation('Unknown vehicle', [{ path: 'vehicleId', message: 'Vehicle not found' }]);
    }
    if (workerId && !(await this.db.select({ id: workers.id }).from(workers).where(and(eq(workers.id, workerId), eq(workers.orgId, ctx.orgId))))[0]) {
      throw AppError.validation('Unknown person', [{ path: 'workerId', message: 'Not found' }]);
    }
    if (input.vendorId && !(await this.db.select({ id: vendors.id }).from(vendors).where(and(eq(vendors.id, input.vendorId), eq(vendors.orgId, ctx.orgId))))[0]) {
      throw AppError.validation('Unknown vendor', [{ path: 'vendorId', message: 'Vendor not found' }]);
    }
    if (input.receiptFileId && !(await this.db.select({ id: files.id }).from(files).where(and(eq(files.id, input.receiptFileId), eq(files.orgId, ctx.orgId))))[0]) {
      throw AppError.validation('Unknown file', [{ path: 'receiptFileId', message: 'Upload the receipt again' }]);
    }
    if (cat.requiresReceiptAbove && input.amount > Number(cat.requiresReceiptAbove) && !input.receiptFileId) {
      throw AppError.validation(`Attach a receipt for ${cat.name} above ₹${Number(cat.requiresReceiptAbove).toLocaleString('en-IN')}`, [{ path: 'receiptFileId', message: 'Receipt required' }]);
    }
    const id = await this.db.transaction(async (tx) => {
      const [row] = await tx
        .insert(expenses)
        .values({
          orgId: ctx.orgId,
          categoryId: cat.id,
          tripId,
          vehicleId,
          workerId,
          vendorId: input.vendorId ?? null,
          expenseDate: input.expenseDate,
          amount: input.amount.toFixed(2),
          paymentMode: input.paymentMode,
          description: input.description,
          receiptFileId: input.receiptFileId ?? null,
          submittedBy: ctx.userId,
        })
        .$returningId();
      await this.notifier.notify(tx, {
        orgId: ctx.orgId,
        permission: 'finance:post',
        category: 'trip',
        priority: 'normal',
        title: `Expense to approve: ₹${input.amount.toLocaleString('en-IN')} ${cat.name}`,
        body: input.description,
        link: `/expenses?status=submitted`,
        entityType: 'expense',
        entityId: row!.id,
        dedupeKey: `expense:${row!.id}:submitted`,
      });
      await audit(tx, req, { action: 'expense.submitted', entityType: 'expense', entityId: row!.id, summary: `${cat.name} ₹${input.amount}` });
      return row!.id;
    });
    return this.get(ctx, id);
  }

  async decide(ctx: RequestContext, id: number, input: z.infer<typeof expenseDecisionSchema>, req: Request): Promise<ExpenseDto> {
    await this.db.transaction(async (tx) => {
      const [e] = await tx.select().from(expenses).where(and(eq(expenses.id, id), eq(expenses.orgId, ctx.orgId))).for('update');
      if (!e) throw AppError.notFound('Expense');
      if (e.status !== 'submitted') throw AppError.businessRule(`This expense is already ${e.status}`);
      const [cat] = await tx.select().from(expenseCategories).where(eq(expenseCategories.id, e.categoryId));
      if (input.decision === 'approve') {
        const credit = PAYMENT_ACCOUNT[e.paymentMode];
        const entry = await this.ledger.post(tx, {
          orgId: ctx.orgId,
          date: e.expenseDate,
          memo: `${cat!.name}: ${e.description}`,
          source: 'expense',
          sourceId: e.id,
          idempotencyKey: `expense:${e.id}`,
          userId: ctx.userId,
          lines: [
            { account: cat!.accountKey as SystemAccount, debit: e.amount, tripId: e.tripId, vehicleId: e.vehicleId, workerId: e.workerId, vendorId: e.vendorId },
            {
              account: credit,
              credit: e.amount,
              workerId: credit === 'driver_payable' ? e.workerId : null,
              vendorId: credit === 'payables' ? e.vendorId : null,
              tripId: e.tripId,
            },
          ],
        });
        await tx.update(expenses).set({ status: 'approved', decidedBy: ctx.userId, decidedAt: new Date(), journalEntryId: entry }).where(eq(expenses.id, id));
      } else {
        await tx.update(expenses).set({ status: 'rejected', decidedBy: ctx.userId, decidedAt: new Date(), rejectionReason: input.reason ?? null }).where(eq(expenses.id, id));
      }
      if (e.submittedBy && e.submittedBy !== ctx.userId) {
        await this.notifier.notify(tx, {
          orgId: ctx.orgId,
          userIds: [e.submittedBy],
          category: 'trip',
          priority: input.decision === 'reject' ? 'high' : 'low',
          title: `Expense ${input.decision === 'approve' ? 'approved' : 'rejected'}: ₹${Number(e.amount).toLocaleString('en-IN')} ${cat!.name}`,
          body: input.reason ?? e.description,
          // Crew are sent on from /expenses to their own claims in the driver app.
          link: `/expenses?status=${input.decision === 'approve' ? 'approved' : 'rejected'}`,
          entityType: 'expense',
          entityId: e.id,
          dedupeKey: `expense:${e.id}:${input.decision}`,
        });
      }
      await audit(tx, req, { action: `expense.${input.decision === 'approve' ? 'approved' : 'rejected'}`, entityType: 'expense', entityId: id, summary: `₹${e.amount} ${e.description}${input.reason ? `: ${input.reason}` : ''}` });
    });
    return this.get(ctx, id);
  }

  /** Approved, unsettled expenses paid by a person (owed back to them in their settlement). */
  async reimbursable(orgId: number, workerId: number, upTo: string) {
    return this.db
      .select()
      .from(expenses)
      .where(and(eq(expenses.orgId, orgId), eq(expenses.workerId, workerId), eq(expenses.paymentMode, 'driver_paid'), eq(expenses.status, 'approved'), isNull(expenses.settlementId), lte(expenses.expenseDate, upTo)))
      .orderBy(asc(expenses.expenseDate));
  }

  async pendingCount(orgId: number) {
    const [r] = await this.db.select({ n: count(), sum: expenses.amount }).from(expenses).where(and(eq(expenses.orgId, orgId), eq(expenses.status, 'submitted')));
    return Number(r?.n ?? 0);
  }

  async idsByTrip(orgId: number, tripIds: number[]) {
    if (!tripIds.length) return [];
    return this.db.select().from(expenses).where(and(eq(expenses.orgId, orgId), inArray(expenses.tripId, tripIds)));
  }

  private select() {
    const submitter = aliasedTable(users, 'submitter');
    const decider = aliasedTable(users, 'decider');
    return this.db
      .select({
        e: expenses,
        c: { id: expenseCategories.id, name: expenseCategories.name },
        t: { id: trips.id, tripNo: trips.tripNo },
        v: { id: vehicles.id, registrationNo: vehicles.registrationNo },
        w: { id: workers.id, fullName: workers.fullName },
        vd: { id: vendors.id, name: vendors.name },
        submitter: submitter.fullName,
        decider: decider.fullName,
      })
      .from(expenses)
      .innerJoin(expenseCategories, eq(expenseCategories.id, expenses.categoryId))
      .leftJoin(trips, eq(trips.id, expenses.tripId))
      .leftJoin(vehicles, eq(vehicles.id, expenses.vehicleId))
      .leftJoin(workers, eq(workers.id, expenses.workerId))
      .leftJoin(vendors, eq(vendors.id, expenses.vendorId))
      .leftJoin(submitter, eq(submitter.id, expenses.submittedBy))
      .leftJoin(decider, eq(decider.id, expenses.decidedBy))
      .$dynamic();
  }
}

type Row = {
  e: typeof expenses.$inferSelect;
  c: { id: number; name: string };
  t: { id: number; tripNo: string } | null;
  v: { id: number; registrationNo: string } | null;
  w: { id: number; fullName: string } | null;
  vd: { id: number; name: string } | null;
  submitter: string | null;
  decider: string | null;
};

function toDto({ e, c, t, v, w, vd, submitter, decider }: Row): ExpenseDto {
  return {
    id: e.id,
    category: c,
    trip: t?.id ? t : null,
    vehicle: v?.id ? v : null,
    worker: w?.id ? w : null,
    vendor: vd?.id ? vd : null,
    expenseDate: e.expenseDate,
    amount: e.amount,
    paymentMode: e.paymentMode,
    description: e.description,
    receiptFileId: e.receiptFileId,
    status: e.status,
    submittedBy: submitter,
    decidedBy: decider,
    decidedAt: e.decidedAt?.toISOString() ?? null,
    rejectionReason: e.rejectionReason,
    settled: e.settlementId !== null,
    createdAt: e.createdAt.toISOString(),
  };
}
