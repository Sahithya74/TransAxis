import type { Request } from 'express';
import Big from 'big.js';
import { aliasedTable, and, asc, count, desc, eq, gt, inArray, isNull, lte, ne, sql, type SQL } from 'drizzle-orm';
import type { z } from 'zod';
import {
  advanceRecoveries,
  bookings,
  compensationPolicies,
  driverAdvances,
  driverDeductions,
  driverEarnings,
  expenses,
  settlements,
  tripCrew,
  trips,
  users,
  workers,
  type Db,
  type Tx,
} from '@transaxis/database';
import {
  computeSettlement,
  computeTripEarnings,
  tripDays,
  type AdvanceDto,
  type CrewBalanceDto,
  type DeductionDto,
  type EarningDto,
  type Paginated,
  type SettlementBreakdown,
  type SettlementDto,
} from '@transaxis/shared';
import type { advanceCreateSchema, deductionCreateSchema, settlementCreateSchema, settlementListQuerySchema, settlementPaySchema } from '@transaxis/shared';
import { audit } from '../../lib/audit.js';
import type { RequestContext } from '../../lib/context.js';
import { AppError } from '../../lib/errors.js';
import { paginated } from '../../lib/http.js';
import { getOrgInfo, orgDate, orgYear } from '../../lib/org.js';
import { nextNumber } from '../../lib/sequences.js';
import type { NotificationService } from '../notifications/service.js';
import type { LedgerService } from './ledger.js';

const money = (v: Big | string | number) => new Big(v).round(2, Big.roundHalfUp).toFixed(2);
type TripRow = typeof trips.$inferSelect;

/**
 * Crew pay: earnings accrue by rule when a trip completes; advances and deductions are recorded as they
 * happen; a settlement nets everything for a period into one payslip and one payment.
 */
export class CrewPayService {
  constructor(
    private readonly db: Db,
    private readonly ledger: LedgerService,
    private readonly notifier: NotificationService,
  ) {}

  // ------------------------------------------------------------------ accrual

  /** Called inside the trip-completion transaction. Idempotent per trip, person and earning type. */
  async accrue(tx: Tx, trip: TripRow, completedAt: Date, endOdometer: number | null): Promise<void> {
    const org = await getOrgInfo(this.db, trip.orgId);
    const crew = await tx.select({ workerId: tripCrew.workerId }).from(tripCrew).where(eq(tripCrew.tripId, trip.id));
    const people = [trip.driverId, ...crew.map((c) => c.workerId)];
    const staff = await tx
      .select({ w: workers, p: compensationPolicies })
      .from(workers)
      .leftJoin(compensationPolicies, and(eq(compensationPolicies.id, workers.compensationPolicyId), eq(compensationPolicies.isActive, true)))
      .where(inArray(workers.id, people));
    const [b] = trip.bookingId ? await tx.select({ weight: bookings.totalWeightKg, freight: bookings.approvedAmount }).from(bookings).where(eq(bookings.id, trip.bookingId)) : [];
    const distanceKm = trip.startOdometer && endOdometer !== null ? Math.max(0, Math.round(endOdometer - Number(trip.startOdometer))) : Math.round(Number(trip.plannedDistanceKm ?? 0));
    const days = tripDays((trip.actualStart ?? trip.plannedStart).toISOString(), completedAt.toISOString(), org.timezone);
    const onTime = !!trip.deliveredAt && trip.deliveredAt.getTime() <= trip.plannedEnd.getTime() + 30 * 60_000;
    const earnedOn = orgDate(org, completedAt);
    for (const { w, p } of staff) {
      if (!p) continue; // no pay policy: paid outside TransAxis
      const r = computeTripEarnings({
        policy: { basis: p.basis, rate: p.rate, dailyAllowance: p.dailyAllowance, onTimeBonus: p.onTimeBonus, minPerTrip: p.minPerTrip },
        distanceKm,
        weightKg: Number(b?.weight ?? 0),
        freightAmount: b?.freight ?? null,
        tripDays: days,
        onTime,
      });
      if (!r.lines.length) continue;
      await tx
        .insert(driverEarnings)
        .ignore()
        .values(
          r.lines.map((l) => ({
            orgId: trip.orgId,
            workerId: w.id,
            tripId: trip.id,
            earningType: l.type,
            amount: l.amount,
            explanation: { label: l.label, formula: l.formula, inputs: { policy: p.name, distanceKm, weightKg: Number(b?.weight ?? 0), tripDays: days, onTime } },
            earnedOn,
          })),
        );
      const entry = await this.ledger.post(tx, {
        orgId: trip.orgId,
        date: earnedOn,
        memo: `Pay for ${w.fullName} on ${trip.tripNo}`,
        source: 'earning',
        sourceId: trip.id,
        idempotencyKey: `earning:${trip.id}:${w.id}`,
        lines: [
          { account: 'crew_wages', debit: r.total, tripId: trip.id, workerId: w.id, vehicleId: trip.vehicleId },
          { account: 'driver_payable', credit: r.total, workerId: w.id, tripId: trip.id },
        ],
      });
      await tx.update(driverEarnings).set({ journalEntryId: entry }).where(and(eq(driverEarnings.tripId, trip.id), eq(driverEarnings.workerId, w.id)));
    }
  }

  // ------------------------------------------------------------------ queries

  /** Everyone with something unsettled, and what a settlement today would pay them. */
  async balances(ctx: RequestContext): Promise<CrewBalanceDto[]> {
    const sumBy = async (q: Promise<{ w: number; s: string | null }[]>) => new Map((await q).map((r) => [r.w, new Big(r.s ?? 0)]));
    const [earn, reimb, adv, ded, last, staff] = await Promise.all([
      sumBy(this.db.select({ w: driverEarnings.workerId, s: sql<string>`SUM(${driverEarnings.amount})` }).from(driverEarnings).where(and(eq(driverEarnings.orgId, ctx.orgId), isNull(driverEarnings.settlementId))).groupBy(driverEarnings.workerId)),
      sumBy(
        this.db
          .select({ w: sql<number>`${expenses.workerId}`, s: sql<string>`SUM(${expenses.amount})` })
          .from(expenses)
          .where(and(eq(expenses.orgId, ctx.orgId), eq(expenses.paymentMode, 'driver_paid'), eq(expenses.status, 'approved'), isNull(expenses.settlementId)))
          .groupBy(expenses.workerId),
      ),
      sumBy(this.db.select({ w: driverAdvances.workerId, s: sql<string>`SUM(${driverAdvances.amount} - ${driverAdvances.recovered})` }).from(driverAdvances).where(eq(driverAdvances.orgId, ctx.orgId)).groupBy(driverAdvances.workerId)),
      sumBy(this.db.select({ w: driverDeductions.workerId, s: sql<string>`SUM(${driverDeductions.amount})` }).from(driverDeductions).where(and(eq(driverDeductions.orgId, ctx.orgId), isNull(driverDeductions.settlementId))).groupBy(driverDeductions.workerId)),
      // Settled up to the end of the latest settlement that isn't cancelled, paid or not, so the next one starts after it.
      this.db.select({ w: settlements.workerId, to: sql<string>`MAX(${settlements.periodTo})` }).from(settlements).where(and(eq(settlements.orgId, ctx.orgId), ne(settlements.status, 'cancelled'))).groupBy(settlements.workerId),
      this.db.select().from(workers).where(and(eq(workers.orgId, ctx.orgId), inArray(workers.workerType, ['driver', 'helper']))).orderBy(asc(workers.fullName)),
    ]);
    const lastTo = new Map(last.map((l) => [l.w, l.to]));
    return staff
      .map((w) => {
        const e = earn.get(w.id) ?? new Big(0);
        const r = reimb.get(w.id) ?? new Big(0);
        const a = adv.get(w.id) ?? new Big(0);
        const d = ded.get(w.id) ?? new Big(0);
        const room = e.plus(r).minus(d);
        const net = room.minus(a.gt(room) ? room : a);
        return {
          worker: { id: w.id, fullName: w.fullName, employeeCode: w.employeeCode, workerType: w.workerType },
          unsettledEarnings: money(e),
          pendingReimbursements: money(r),
          outstandingAdvances: money(a),
          unsettledDeductions: money(d),
          estimatedNet: money(net.lt(0) ? 0 : net),
          lastSettledTo: lastTo.get(w.id) ?? null,
        };
      })
      .filter((b) => b.unsettledEarnings !== '0.00' || b.pendingReimbursements !== '0.00' || b.outstandingAdvances !== '0.00' || b.unsettledDeductions !== '0.00');
  }

  /** Crew may only look at their own pay. */
  private ownScope(ctx: RequestContext, workerId?: number): number | undefined {
    if (ctx.permissions.has('settlements:read') || ctx.permissions.has('settlements:manage')) return workerId;
    if (ctx.permissions.has('settlements:read_own') && ctx.workerId) {
      if (workerId && workerId !== ctx.workerId) throw AppError.forbidden();
      return ctx.workerId;
    }
    throw AppError.forbidden();
  }

  async earnings(ctx: RequestContext, q: { workerId?: number; tripId?: number; unsettled?: boolean }): Promise<EarningDto[]> {
    const workerId = this.ownScope(ctx, q.workerId);
    const conds: SQL[] = [eq(driverEarnings.orgId, ctx.orgId)];
    if (workerId) conds.push(eq(driverEarnings.workerId, workerId));
    if (q.tripId) conds.push(eq(driverEarnings.tripId, q.tripId));
    if (q.unsettled) conds.push(isNull(driverEarnings.settlementId));
    const rows = await this.db
      .select({ e: driverEarnings, w: { id: workers.id, fullName: workers.fullName }, t: { id: trips.id, tripNo: trips.tripNo } })
      .from(driverEarnings)
      .innerJoin(workers, eq(workers.id, driverEarnings.workerId))
      .leftJoin(trips, eq(trips.id, driverEarnings.tripId))
      .where(and(...conds))
      .orderBy(desc(driverEarnings.earnedOn), desc(driverEarnings.id))
      .limit(500);
    return rows.map(({ e, w, t }) => ({ id: e.id, worker: w, trip: t?.id ? t : null, earningType: e.earningType, amount: e.amount, label: e.explanation.label, formula: e.explanation.formula, earnedOn: e.earnedOn, settled: e.settlementId !== null }));
  }

  async advances(ctx: RequestContext, q: { workerId?: number; outstanding?: boolean }): Promise<AdvanceDto[]> {
    const workerId = this.ownScope(ctx, q.workerId);
    const conds: SQL[] = [eq(driverAdvances.orgId, ctx.orgId)];
    if (workerId) conds.push(eq(driverAdvances.workerId, workerId));
    if (q.outstanding) conds.push(gt(driverAdvances.amount, driverAdvances.recovered));
    const rows = await this.db
      .select({ a: driverAdvances, w: { id: workers.id, fullName: workers.fullName }, t: { id: trips.id, tripNo: trips.tripNo } })
      .from(driverAdvances)
      .innerJoin(workers, eq(workers.id, driverAdvances.workerId))
      .leftJoin(trips, eq(trips.id, driverAdvances.tripId))
      .where(and(...conds))
      .orderBy(desc(driverAdvances.givenOn), desc(driverAdvances.id))
      .limit(500);
    return rows.map(({ a, w, t }) => ({ id: a.id, worker: w, trip: t?.id ? t : null, givenOn: a.givenOn, amount: a.amount, recovered: a.recovered, outstanding: money(new Big(a.amount).minus(a.recovered)), mode: a.mode, purpose: a.purpose }));
  }

  async deductions(ctx: RequestContext, q: { workerId?: number }): Promise<DeductionDto[]> {
    const workerId = this.ownScope(ctx, q.workerId);
    const conds: SQL[] = [eq(driverDeductions.orgId, ctx.orgId)];
    if (workerId) conds.push(eq(driverDeductions.workerId, workerId));
    const rows = await this.db
      .select({ d: driverDeductions, w: { id: workers.id, fullName: workers.fullName }, t: { id: trips.id, tripNo: trips.tripNo } })
      .from(driverDeductions)
      .innerJoin(workers, eq(workers.id, driverDeductions.workerId))
      .leftJoin(trips, eq(trips.id, driverDeductions.tripId))
      .where(and(...conds))
      .orderBy(desc(driverDeductions.deductedOn))
      .limit(500);
    return rows.map(({ d, w, t }) => ({ id: d.id, worker: w, trip: t?.id ? t : null, deductionType: d.deductionType, amount: d.amount, reason: d.reason, deductedOn: d.deductedOn, settled: d.settlementId !== null }));
  }

  // ------------------------------------------------------------------ advances and deductions

  async giveAdvance(ctx: RequestContext, input: z.infer<typeof advanceCreateSchema>, req: Request): Promise<AdvanceDto> {
    const w = await this.worker(ctx, input.workerId);
    if (input.tripId) {
      const [t] = await this.db.select({ id: trips.id }).from(trips).where(and(eq(trips.id, input.tripId), eq(trips.orgId, ctx.orgId)));
      if (!t) throw AppError.validation('Unknown trip', [{ path: 'tripId', message: 'Trip not found' }]);
    }
    const id = await this.db.transaction(async (tx) => {
      const [row] = await tx
        .insert(driverAdvances)
        .values({ orgId: ctx.orgId, workerId: w.id, tripId: input.tripId ?? null, givenOn: input.givenOn, amount: money(input.amount), mode: input.mode, purpose: input.purpose ?? null, createdBy: ctx.userId })
        .$returningId();
      const entry = await this.ledger.post(tx, {
        orgId: ctx.orgId,
        date: input.givenOn,
        memo: `Advance to ${w.fullName}${input.purpose ? `: ${input.purpose}` : ''}`,
        source: 'advance',
        sourceId: row!.id,
        idempotencyKey: `advance:${row!.id}`,
        userId: ctx.userId,
        lines: [
          { account: 'driver_advances', debit: input.amount, workerId: w.id, tripId: input.tripId ?? null },
          { account: input.mode === 'cash' ? 'cash' : 'bank', credit: input.amount, workerId: w.id },
        ],
      });
      await tx.update(driverAdvances).set({ journalEntryId: entry }).where(eq(driverAdvances.id, row!.id));
      await audit(tx, req, { action: 'crew.advance', entityType: 'worker', entityId: w.id, summary: `₹${money(input.amount)} to ${w.fullName}` });
      return row!.id;
    });
    return (await this.advances(ctx, { workerId: w.id })).find((a) => a.id === id)!;
  }

  async addDeduction(ctx: RequestContext, input: z.infer<typeof deductionCreateSchema>, req: Request): Promise<DeductionDto> {
    const w = await this.worker(ctx, input.workerId);
    const [row] = await this.db
      .insert(driverDeductions)
      .values({ orgId: ctx.orgId, workerId: w.id, tripId: input.tripId ?? null, deductionType: input.deductionType, amount: money(input.amount), reason: input.reason, deductedOn: input.deductedOn, createdBy: ctx.userId })
      .$returningId();
    await audit(this.db, req, { action: 'crew.deduction', entityType: 'worker', entityId: w.id, summary: `₹${money(input.amount)} from ${w.fullName}: ${input.reason}` });
    return (await this.deductions(ctx, { workerId: w.id })).find((d) => d.id === row!.id)!;
  }

  // ------------------------------------------------------------------ settlements

  /** What a settlement for the period would contain, without saving anything. */
  async preview(ctx: RequestContext, workerId: number, periodFrom: string, periodTo: string, db: Db | Tx = this.db): Promise<{ dto: SettlementDto; ids: { earnings: number[]; expenses: number[]; deductions: number[]; recoveries: { id: number; amount: string }[] } }> {
    const w = await this.worker(ctx, workerId);
    const [earn, reimb, ded, adv] = await Promise.all([
      db
        .select({ e: driverEarnings, tripNo: trips.tripNo })
        .from(driverEarnings)
        .leftJoin(trips, eq(trips.id, driverEarnings.tripId))
        .where(and(eq(driverEarnings.orgId, ctx.orgId), eq(driverEarnings.workerId, w.id), isNull(driverEarnings.settlementId), lte(driverEarnings.earnedOn, periodTo)))
        .orderBy(asc(driverEarnings.earnedOn)),
      db
        .select()
        .from(expenses)
        .where(and(eq(expenses.orgId, ctx.orgId), eq(expenses.workerId, w.id), eq(expenses.paymentMode, 'driver_paid'), eq(expenses.status, 'approved'), isNull(expenses.settlementId), lte(expenses.expenseDate, periodTo)))
        .orderBy(asc(expenses.expenseDate)),
      db.select().from(driverDeductions).where(and(eq(driverDeductions.orgId, ctx.orgId), eq(driverDeductions.workerId, w.id), isNull(driverDeductions.settlementId), lte(driverDeductions.deductedOn, periodTo))),
      db
        .select()
        .from(driverAdvances)
        .where(and(eq(driverAdvances.orgId, ctx.orgId), eq(driverAdvances.workerId, w.id), gt(driverAdvances.amount, driverAdvances.recovered), lte(driverAdvances.givenOn, periodTo)))
        .orderBy(asc(driverAdvances.givenOn), asc(driverAdvances.id)),
    ]);
    const r = computeSettlement({
      earnings: earn.map(({ e }) => ({ id: e.id, amount: e.amount })),
      reimbursements: reimb.map((x) => ({ id: x.id, amount: x.amount })),
      advances: adv.map((a) => ({ id: a.id, outstanding: money(new Big(a.amount).minus(a.recovered)) })),
      deductions: ded.map((d) => ({ id: d.id, amount: d.amount })),
    });
    const breakdown: SettlementBreakdown = {
      earnings: earn.map(({ e, tripNo }) => ({ id: e.id, tripNo, label: e.explanation.label, formula: e.explanation.formula, amount: e.amount })),
      reimbursements: reimb.map((x) => ({ id: x.id, date: x.expenseDate, description: x.description, amount: x.amount })),
      deductions: ded.map((d) => ({ id: d.id, reason: d.reason, amount: d.amount })),
      advances: adv.map((a) => ({ id: a.id, givenOn: a.givenOn, outstanding: money(new Big(a.amount).minus(a.recovered)), recoveredNow: r.recoveries.find((x) => x.id === a.id)?.amount ?? '0.00' })),
    };
    return {
      dto: {
        id: null,
        settlementNo: null,
        worker: { id: w.id, fullName: w.fullName, employeeCode: w.employeeCode },
        periodFrom,
        periodTo,
        earnings: r.earnings,
        reimbursements: r.reimbursements,
        deductions: r.deductions,
        advancesRecovered: r.advancesRecovered,
        advanceCarriedForward: r.advanceCarriedForward,
        net: r.net,
        status: 'preview',
        breakdown,
        approvedBy: null,
        approvedAt: null,
        paidOn: null,
        paidMode: null,
        paymentReference: null,
      },
      ids: { earnings: earn.map(({ e }) => e.id), expenses: reimb.map((x) => x.id), deductions: ded.map((d) => d.id), recoveries: r.recoveries },
    };
  }

  async create(ctx: RequestContext, input: z.infer<typeof settlementCreateSchema>, req: Request): Promise<SettlementDto> {
    const org = await getOrgInfo(this.db, ctx.orgId);
    const id = await this.db.transaction(async (tx) => {
      // Lock the worker row so two settlements for the same person cannot claim the same items.
      await tx.select({ id: workers.id }).from(workers).where(and(eq(workers.id, input.workerId), eq(workers.orgId, ctx.orgId))).for('update');
      const { dto, ids } = await this.preview(ctx, input.workerId, input.periodFrom, input.periodTo, tx as unknown as Db);
      if (!ids.earnings.length && !ids.expenses.length && !ids.deductions.length) throw AppError.businessRule(`Nothing to settle for ${dto.worker.fullName} up to ${input.periodTo}`);
      const settlementNo = await nextNumber(tx, ctx.orgId, 'STL', orgYear(org));
      const [row] = await tx
        .insert(settlements)
        .values({
          orgId: ctx.orgId,
          settlementNo,
          workerId: input.workerId,
          periodFrom: input.periodFrom,
          periodTo: input.periodTo,
          earnings: dto.earnings,
          reimbursements: dto.reimbursements,
          deductions: dto.deductions,
          advancesRecovered: dto.advancesRecovered,
          net: dto.net,
          breakdown: { ...dto.breakdown, advanceCarriedForward: dto.advanceCarriedForward },
          createdBy: ctx.userId,
        })
        .$returningId();
      const sid = row!.id;
      if (ids.earnings.length) await tx.update(driverEarnings).set({ settlementId: sid }).where(inArray(driverEarnings.id, ids.earnings));
      if (ids.expenses.length) await tx.update(expenses).set({ settlementId: sid }).where(inArray(expenses.id, ids.expenses));
      if (ids.deductions.length) await tx.update(driverDeductions).set({ settlementId: sid }).where(inArray(driverDeductions.id, ids.deductions));
      for (const r of ids.recoveries) {
        await tx.insert(advanceRecoveries).values({ settlementId: sid, advanceId: r.id, amount: r.amount });
        await tx.update(driverAdvances).set({ recovered: sql`${driverAdvances.recovered} + ${r.amount}` }).where(eq(driverAdvances.id, r.id));
      }
      await audit(tx, req, { action: 'settlement.drafted', entityType: 'settlement', entityId: sid, summary: `${settlementNo} ${dto.worker.fullName}: net ₹${dto.net}` });
      return sid;
    });
    return this.get(ctx, id);
  }

  async approve(ctx: RequestContext, id: number, req: Request): Promise<SettlementDto> {
    await this.db.transaction(async (tx) => {
      const s = await this.lock(tx, ctx, id);
      if (s.status !== 'draft') throw AppError.businessRule(`This settlement is ${s.status}`);
      await tx.update(settlements).set({ status: 'approved', approvedBy: ctx.userId, approvedAt: new Date() }).where(eq(settlements.id, id));
      await audit(tx, req, { action: 'settlement.approved', entityType: 'settlement', entityId: id, summary: s.settlementNo });
    });
    return this.get(ctx, id);
  }

  async pay(ctx: RequestContext, id: number, input: z.infer<typeof settlementPaySchema>, req: Request): Promise<SettlementDto> {
    await this.db.transaction(async (tx) => {
      const s = await this.lock(tx, ctx, id);
      if (s.status !== 'approved') throw AppError.businessRule(s.status === 'draft' ? 'Approve the settlement before paying it' : `This settlement is ${s.status}`);
      const owed = new Big(s.earnings).plus(s.reimbursements);
      const entry = await this.ledger.post(tx, {
        orgId: ctx.orgId,
        date: input.paidOn,
        memo: `Settlement ${s.settlementNo}`,
        source: 'settlement',
        sourceId: id,
        idempotencyKey: `settlement:${id}`,
        userId: ctx.userId,
        lines: [
          { account: 'driver_payable', debit: owed, workerId: s.workerId },
          { account: 'driver_advances', credit: s.advancesRecovered, workerId: s.workerId },
          { account: 'other_income', credit: s.deductions, workerId: s.workerId, memo: 'Deductions recovered' },
          { account: input.mode === 'cash' ? 'cash' : 'bank', credit: s.net, workerId: s.workerId },
        ],
      });
      await tx.update(settlements).set({ status: 'paid', paidOn: input.paidOn, paidMode: input.mode, paymentReference: input.reference ?? null, journalEntryId: entry }).where(eq(settlements.id, id));
      const [u] = await tx.select({ id: users.id }).from(users).where(eq(users.workerId, s.workerId));
      if (u) {
        await this.notifier.notify(tx, {
          orgId: ctx.orgId,
          userIds: [u.id],
          category: 'system',
          priority: 'normal',
          title: `Settlement ${s.settlementNo} paid: ₹${Number(s.net).toLocaleString('en-IN')}`,
          body: `Period ${s.periodFrom} to ${s.periodTo}, paid by ${input.mode}.`,
          link: '/driver/pay',
          entityType: 'settlement',
          entityId: id,
          dedupeKey: `settlement:${id}:paid`,
        });
      }
      await audit(tx, req, { action: 'settlement.paid', entityType: 'settlement', entityId: id, summary: `${s.settlementNo}: ₹${s.net} by ${input.mode}` });
    });
    return this.get(ctx, id);
  }

  /** Cancels an unpaid settlement and releases everything it claimed. */
  async cancel(ctx: RequestContext, id: number, reason: string, req: Request): Promise<SettlementDto> {
    await this.db.transaction(async (tx) => {
      const s = await this.lock(tx, ctx, id);
      if (s.status === 'paid' || s.status === 'cancelled') throw AppError.businessRule(`A ${s.status} settlement cannot be cancelled`);
      await tx.update(driverEarnings).set({ settlementId: null }).where(eq(driverEarnings.settlementId, id));
      await tx.update(expenses).set({ settlementId: null }).where(eq(expenses.settlementId, id));
      await tx.update(driverDeductions).set({ settlementId: null }).where(eq(driverDeductions.settlementId, id));
      const recs = await tx.select().from(advanceRecoveries).where(eq(advanceRecoveries.settlementId, id));
      for (const r of recs) await tx.update(driverAdvances).set({ recovered: sql`${driverAdvances.recovered} - ${r.amount}` }).where(eq(driverAdvances.id, r.advanceId));
      await tx.update(settlements).set({ status: 'cancelled' }).where(eq(settlements.id, id));
      await audit(tx, req, { action: 'settlement.cancelled', entityType: 'settlement', entityId: id, summary: `${s.settlementNo}: ${reason}` });
    });
    return this.get(ctx, id);
  }

  async list(ctx: RequestContext, q: z.infer<typeof settlementListQuerySchema>): Promise<Paginated<SettlementDto>> {
    const workerId = this.ownScope(ctx, q.workerId);
    const conds: SQL[] = [eq(settlements.orgId, ctx.orgId)];
    if (workerId) conds.push(eq(settlements.workerId, workerId));
    if (q.status) conds.push(eq(settlements.status, q.status));
    const where = and(...conds);
    const [[total], rows] = await Promise.all([
      this.db.select({ n: count() }).from(settlements).where(where),
      this.select().where(where).orderBy(desc(settlements.createdAt), desc(settlements.id)).limit(q.pageSize).offset((q.page - 1) * q.pageSize),
    ]);
    return paginated(rows.map(toDto), q.page, q.pageSize, Number(total?.n ?? 0));
  }

  async get(ctx: RequestContext, id: number): Promise<SettlementDto> {
    const [row] = await this.select().where(and(eq(settlements.id, id), eq(settlements.orgId, ctx.orgId)));
    if (!row) throw AppError.notFound('Settlement');
    this.ownScope(ctx, row.s.workerId);
    return toDto(row);
  }

  async draftCount(orgId: number) {
    const [r] = await this.db.select({ n: count() }).from(settlements).where(and(eq(settlements.orgId, orgId), inArray(settlements.status, ['draft', 'approved'])));
    return Number(r?.n ?? 0);
  }

  private async worker(ctx: RequestContext, workerId: number) {
    const [w] = await this.db.select().from(workers).where(and(eq(workers.id, workerId), eq(workers.orgId, ctx.orgId)));
    if (!w) throw AppError.validation('Unknown person', [{ path: 'workerId', message: 'Not found' }]);
    return w;
  }

  private async lock(tx: Tx, ctx: RequestContext, id: number) {
    const [s] = await tx.select().from(settlements).where(and(eq(settlements.id, id), eq(settlements.orgId, ctx.orgId))).for('update');
    if (!s) throw AppError.notFound('Settlement');
    return s;
  }

  private select() {
    const approver = aliasedTable(users, 'approver');
    return this.db
      .select({ s: settlements, w: { id: workers.id, fullName: workers.fullName, employeeCode: workers.employeeCode }, approver: approver.fullName })
      .from(settlements)
      .innerJoin(workers, eq(workers.id, settlements.workerId))
      .leftJoin(approver, eq(approver.id, settlements.approvedBy))
      .$dynamic();
  }
}

type Row = { s: typeof settlements.$inferSelect; w: { id: number; fullName: string; employeeCode: string }; approver: string | null };

function toDto({ s, w, approver }: Row): SettlementDto {
  const b = s.breakdown as SettlementBreakdown & { advanceCarriedForward?: string };
  return {
    id: s.id,
    settlementNo: s.settlementNo,
    worker: w,
    periodFrom: s.periodFrom,
    periodTo: s.periodTo,
    earnings: s.earnings,
    reimbursements: s.reimbursements,
    deductions: s.deductions,
    advancesRecovered: s.advancesRecovered,
    advanceCarriedForward: b.advanceCarriedForward ?? '0.00',
    net: s.net,
    status: s.status,
    breakdown: { earnings: b.earnings, reimbursements: b.reimbursements, deductions: b.deductions, advances: b.advances },
    approvedBy: approver,
    approvedAt: s.approvedAt?.toISOString() ?? null,
    paidOn: s.paidOn,
    paidMode: s.paidMode,
    paymentReference: s.paymentReference,
  };
}

