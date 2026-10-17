import Big from 'big.js';
import { and, asc, count, eq, gte, inArray, isNotNull, lt, lte, ne, sql } from 'drizzle-orm';
import {
  bookings,
  customers,
  driverEarnings,
  expenseCategories,
  expenses,
  incidents,
  invoices,
  journalEntries,
  journalLines,
  ledgerAccounts,
  receipts,
  safetyAlerts,
  trips,
  vehicles,
  vehicleTypes,
  workOrders,
  workers,
  creditNotes,
  type Db,
} from '@transaxis/database';
import {
  AGEING_BUCKETS,
  addDays,
  ageingBucket,
  startOfDayIn,
  todayIn,
  type AgeingBucket,
  type FinanceSummaryDto,
  type ReportTableDto,
  type TripProfitDto,
} from '@transaxis/shared';
import type { RequestContext } from '../../lib/context.js';
import { AppError } from '../../lib/errors.js';
import { getOrgInfo, orgToday } from '../../lib/org.js';
import { toCsvText } from '../../lib/csv.js';
import type { CrewPayService } from './crew-pay.js';
import type { FuelService } from './fuel.js';
import type { InvoiceService } from './invoices.js';

const money = (v: Big | string | number) => new Big(v).round(2, Big.roundHalfUp).toFixed(2);
const pct = (part: Big, whole: Big) => (whole.gt(0) ? Math.round(part.div(whole).times(1000).toNumber()) / 10 : null);
const COST_KEYS = ['fuel_expense', 'trip_expense', 'maintenance_expense', 'crew_wages', 'hire_charges', 'office_expense'] as const;

export const REPORT_KEYS = ['revenue-by-customer', 'receivables-ageing', 'vehicle-performance', 'driver-performance', 'fuel-efficiency', 'expenses-by-category', 'maintenance-cost'] as const;
export type ReportKey = (typeof REPORT_KEYS)[number];

/**
 * Management reporting. Revenue is accrual-based (freight earned on delivery, before tax); costs come
 * from the ledger, so every figure here agrees with the books. Definitions are returned with the data.
 */
export class ReportService {
  constructor(
    private readonly db: Db,
    private readonly invoices: InvoiceService,
    private readonly fuel: FuelService,
    private readonly crew: CrewPayService,
  ) {}

  private async range(ctx: RequestContext, from: string, to: string) {
    const org = await getOrgInfo(this.db, ctx.orgId);
    return { tz: org.timezone, start: startOfDayIn(from, org.timezone), end: startOfDayIn(addDays(to, 1), org.timezone), today: orgToday(org) };
  }

  /** Ledger balances (debit − credit) per account key for a date range, optionally per dimension. */
  private async ledgerCosts(orgId: number, from: string, to: string, by?: 'vehicleId' | 'tripId' | 'workerId') {
    // MySQL reads a bare number in GROUP BY as a column position, so only group by a real dimension.
    const dim = by ? journalLines[by] : null;
    return this.db
      .select({ key: ledgerAccounts.systemKey, dim: dim ? sql<number | null>`${dim}` : sql<number | null>`NULL`, amount: sql<string>`COALESCE(SUM(${journalLines.debit} - ${journalLines.credit}), 0)` })
      .from(journalLines)
      .innerJoin(journalEntries, eq(journalEntries.id, journalLines.entryId))
      .innerJoin(ledgerAccounts, eq(ledgerAccounts.id, journalLines.accountId))
      .where(and(eq(journalLines.orgId, orgId), gte(journalEntries.entryDate, from), lte(journalEntries.entryDate, to), inArray(ledgerAccounts.systemKey, [...COST_KEYS])))
      .groupBy(...(dim ? [ledgerAccounts.systemKey, dim] : [ledgerAccounts.systemKey]));
  }

  /** Loaded trips delivered in the window, with the freight they earned. */
  private async deliveredTrips(orgId: number, start: Date, end: Date) {
    return this.db
      .select({ t: trips, amount: bookings.approvedAmount, customer: customers.name, customerId: customers.id })
      .from(trips)
      .leftJoin(bookings, eq(bookings.id, trips.bookingId))
      .leftJoin(customers, eq(customers.id, bookings.customerId))
      .where(and(eq(trips.orgId, orgId), isNotNull(trips.deliveredAt), gte(trips.deliveredAt, start), lt(trips.deliveredAt, end), ne(trips.status, 'cancelled')));
  }

  private async openInvoices(orgId: number) {
    return this.db
      .select({ i: invoices, c: { id: customers.id, name: customers.name } })
      .from(invoices)
      .innerJoin(customers, eq(customers.id, invoices.customerId))
      .where(and(eq(invoices.orgId, orgId), inArray(invoices.status, ['issued', 'partially_paid'])));
  }

  async financeSummary(ctx: RequestContext, from: string, to: string): Promise<FinanceSummaryDto> {
    const r = await this.range(ctx, from, to);
    const [delivered, costs, collectedRows, invoicedRows, creditedRows, open, uninvoiced, pendingExp, anomalies, drafts] = await Promise.all([
      this.deliveredTrips(ctx.orgId, r.start, r.end),
      this.ledgerCosts(ctx.orgId, from, to),
      this.db.select({ s: sql<string>`COALESCE(SUM(${receipts.amount} + ${receipts.tdsAmount}), 0)` }).from(receipts).where(and(eq(receipts.orgId, ctx.orgId), gte(receipts.receivedOn, from), lte(receipts.receivedOn, to))),
      this.db.select({ s: sql<string>`COALESCE(SUM(${invoices.taxable}), 0)` }).from(invoices).where(and(eq(invoices.orgId, ctx.orgId), ne(invoices.status, 'cancelled'), gte(invoices.invoiceDate, from), lte(invoices.invoiceDate, to))),
      this.db.select({ s: sql<string>`COALESCE(SUM(${creditNotes.taxable}), 0)` }).from(creditNotes).where(and(eq(creditNotes.orgId, ctx.orgId), gte(creditNotes.noteDate, from), lte(creditNotes.noteDate, to))),
      this.openInvoices(ctx.orgId),
      this.invoices.uninvoiced(ctx),
      this.db.select({ n: count(), s: sql<string>`COALESCE(SUM(${expenses.amount}), 0)` }).from(expenses).where(and(eq(expenses.orgId, ctx.orgId), eq(expenses.status, 'submitted'))),
      this.fuel.anomalyCount(ctx.orgId),
      this.crew.draftCount(ctx.orgId),
    ]);
    const revenue = delivered.reduce((s, d) => s.plus(d.amount ?? 0), new Big(0));
    const cost = (k: string) => new Big(costs.find((c) => c.key === k)?.amount ?? 0);
    const totalCost = COST_KEYS.reduce((s, k) => s.plus(cost(k)), new Big(0));
    const ageing = Object.fromEntries(AGEING_BUCKETS.map((b) => [b, new Big(0)])) as Record<AgeingBucket, Big>;
    let outstanding = new Big(0);
    let overdue = new Big(0);
    for (const { i } of open) {
      const due = new Big(i.total).minus(i.paid).minus(i.credited);
      const { bucket } = ageingBucket(i.dueDate, r.today);
      ageing[bucket] = ageing[bucket].plus(due);
      outstanding = outstanding.plus(due);
      if (bucket !== 'current') overdue = overdue.plus(due);
    }

    // Six-month trend ending with the period's last month.
    const months: string[] = [];
    const last = new Date(`${to.slice(0, 7)}-01T00:00:00Z`);
    for (let k = 5; k >= 0; k--) months.push(new Date(Date.UTC(last.getUTCFullYear(), last.getUTCMonth() - k, 1)).toISOString().slice(0, 7));
    const trendFrom = `${months[0]}-01`;
    const [trendTrips, trendCosts, trendReceipts] = await Promise.all([
      this.deliveredTrips(ctx.orgId, startOfDayIn(trendFrom, r.tz), r.end),
      this.db
        .select({ month: sql<string>`DATE_FORMAT(${journalEntries.entryDate}, '%Y-%m')`, amount: sql<string>`COALESCE(SUM(${journalLines.debit} - ${journalLines.credit}), 0)` })
        .from(journalLines)
        .innerJoin(journalEntries, eq(journalEntries.id, journalLines.entryId))
        .innerJoin(ledgerAccounts, eq(ledgerAccounts.id, journalLines.accountId))
        .where(and(eq(journalLines.orgId, ctx.orgId), gte(journalEntries.entryDate, trendFrom), lte(journalEntries.entryDate, to), inArray(ledgerAccounts.systemKey, [...COST_KEYS])))
        .groupBy(sql`DATE_FORMAT(${journalEntries.entryDate}, '%Y-%m')`),
      this.db
        .select({ month: sql<string>`DATE_FORMAT(${receipts.receivedOn}, '%Y-%m')`, amount: sql<string>`COALESCE(SUM(${receipts.amount} + ${receipts.tdsAmount}), 0)` })
        .from(receipts)
        .where(and(eq(receipts.orgId, ctx.orgId), gte(receipts.receivedOn, trendFrom), lte(receipts.receivedOn, to)))
        .groupBy(sql`DATE_FORMAT(${receipts.receivedOn}, '%Y-%m')`),
    ]);
    const revByMonth = new Map<string, Big>();
    for (const d of trendTrips) {
      const m = todayIn(r.tz, d.t.deliveredAt!).slice(0, 7);
      revByMonth.set(m, (revByMonth.get(m) ?? new Big(0)).plus(d.amount ?? 0));
    }
    return {
      from,
      to,
      revenueEarned: money(revenue),
      invoiced: money(new Big(invoicedRows[0]?.s ?? 0).minus(creditedRows[0]?.s ?? 0)),
      collected: money(collectedRows[0]?.s ?? 0),
      outstanding: money(outstanding),
      overdue: money(overdue),
      ageing: Object.fromEntries(AGEING_BUCKETS.map((b) => [b, money(ageing[b])])) as Record<AgeingBucket, string>,
      costs: {
        fuel: money(cost('fuel_expense')),
        tripExpenses: money(cost('trip_expense')),
        maintenance: money(cost('maintenance_expense')),
        crew: money(cost('crew_wages')),
        other: money(cost('hire_charges').plus(cost('office_expense'))),
        total: money(totalCost),
      },
      grossProfit: money(revenue.minus(totalCost)),
      marginPct: pct(revenue.minus(totalCost), revenue),
      pending: {
        expenses: Number(pendingExp[0]?.n ?? 0),
        expenseAmount: money(pendingExp[0]?.s ?? 0),
        uninvoicedBookings: uninvoiced.length,
        uninvoicedAmount: money(uninvoiced.reduce((s, u) => s.plus(u.amount), new Big(0))),
        fuelAnomalies: anomalies,
        draftSettlements: drafts,
      },
      monthly: months.map((m) => ({
        month: m,
        revenue: money(revByMonth.get(m) ?? 0),
        costs: money(trendCosts.find((c) => c.month === m)?.amount ?? 0),
        collected: money(trendReceipts.find((c) => c.month === m)?.amount ?? 0),
      })),
    };
  }

  async tripProfitability(ctx: RequestContext, from: string, to: string, f: { vehicleId?: number; customerId?: number } = {}): Promise<TripProfitDto[]> {
    const r = await this.range(ctx, from, to);
    let list = await this.deliveredTrips(ctx.orgId, r.start, r.end);
    if (f.vehicleId) list = list.filter((x) => x.t.vehicleId === f.vehicleId);
    if (f.customerId) list = list.filter((x) => x.customerId === f.customerId);
    if (!list.length) return [];
    const ids = list.map((x) => x.t.id);
    const [byTrip, pending, vrows] = await Promise.all([
      this.db
        .select({ tripId: journalLines.tripId, key: ledgerAccounts.systemKey, amount: sql<string>`COALESCE(SUM(${journalLines.debit} - ${journalLines.credit}), 0)` })
        .from(journalLines)
        .innerJoin(ledgerAccounts, eq(ledgerAccounts.id, journalLines.accountId))
        .where(and(inArray(journalLines.tripId, ids), inArray(ledgerAccounts.systemKey, ['fuel_expense', 'trip_expense', 'crew_wages', 'hire_charges'])))
        .groupBy(journalLines.tripId, ledgerAccounts.systemKey),
      this.db.select({ tripId: expenses.tripId, n: count() }).from(expenses).where(and(inArray(expenses.tripId, ids), eq(expenses.status, 'submitted'))).groupBy(expenses.tripId),
      this.db.select({ id: vehicles.id, registrationNo: vehicles.registrationNo }).from(vehicles).where(inArray(vehicles.id, [...new Set(list.map((x) => x.t.vehicleId))])),
    ]);
    const amt = (tripId: number, key: string) => new Big(byTrip.find((b) => b.tripId === tripId && b.key === key)?.amount ?? 0);
    return list
      .map(({ t, amount, customer }) => {
        const revenue = new Big(amount ?? 0);
        const fuel = amt(t.id, 'fuel_expense');
        const exp = amt(t.id, 'trip_expense').plus(amt(t.id, 'hire_charges'));
        const crew = amt(t.id, 'crew_wages');
        const totalCost = fuel.plus(exp).plus(crew);
        const reasons: string[] = [];
        const km = t.startOdometer && t.endOdometer ? Number(t.endOdometer) - Number(t.startOdometer) : Number(t.plannedDistanceKm ?? 0);
        if (fuel.eq(0) && km > 50) reasons.push('No fuel recorded for this trip');
        const p = Number(pending.find((x) => x.tripId === t.id)?.n ?? 0);
        if (p) reasons.push(`${p} expense(s) awaiting approval`);
        if (t.status === 'delivered') reasons.push('Crew pay accrues when the trip is completed');
        if (t.status === 'delivered' || t.status === 'completed') reasons.push('Not reconciled yet');
        return {
          trip: { id: t.id, tripNo: t.tripNo, status: t.status, originCity: t.originCity, destinationCity: t.destinationCity, deliveredAt: t.deliveredAt?.toISOString() ?? null },
          vehicle: vrows.find((v) => v.id === t.vehicleId)!,
          customer,
          revenue: money(revenue),
          fuel: money(fuel),
          expenses: money(exp),
          crew: money(crew),
          totalCost: money(totalCost),
          profit: money(revenue.minus(totalCost)),
          marginPct: pct(revenue.minus(totalCost), revenue),
          provisional: reasons.length > 0,
          provisionalReasons: reasons,
        };
      })
      .sort((a, b) => (b.trip.deliveredAt ?? '').localeCompare(a.trip.deliveredAt ?? ''));
  }

  async table(ctx: RequestContext, key: string, from: string, to: string): Promise<ReportTableDto> {
    const r = await this.range(ctx, from, to);
    switch (key as ReportKey) {
      case 'revenue-by-customer': {
        const [delivered, inv, rec, open] = await Promise.all([
          this.deliveredTrips(ctx.orgId, r.start, r.end),
          this.db.select({ c: invoices.customerId, s: sql<string>`COALESCE(SUM(${invoices.taxable}), 0)` }).from(invoices).where(and(eq(invoices.orgId, ctx.orgId), ne(invoices.status, 'cancelled'), gte(invoices.invoiceDate, from), lte(invoices.invoiceDate, to))).groupBy(invoices.customerId),
          this.db.select({ c: receipts.customerId, s: sql<string>`COALESCE(SUM(${receipts.amount} + ${receipts.tdsAmount}), 0)` }).from(receipts).where(and(eq(receipts.orgId, ctx.orgId), gte(receipts.receivedOn, from), lte(receipts.receivedOn, to))).groupBy(receipts.customerId),
          this.openInvoices(ctx.orgId),
        ]);
        const names = await this.db.select({ id: customers.id, name: customers.name }).from(customers).where(eq(customers.orgId, ctx.orgId)).orderBy(asc(customers.name));
        const rows = names
          .map((c) => {
            const mine = delivered.filter((d) => d.customerId === c.id);
            const rev = mine.reduce((s, d) => s.plus(d.amount ?? 0), new Big(0));
            const out = open.filter((o) => o.c.id === c.id).reduce((s, o) => s.plus(new Big(o.i.total).minus(o.i.paid).minus(o.i.credited)), new Big(0));
            return { customer: c.name, trips: mine.length, revenue: money(rev), invoiced: money(inv.find((x) => x.c === c.id)?.s ?? 0), collected: money(rec.find((x) => x.c === c.id)?.s ?? 0), outstanding: money(out) };
          })
          .filter((x) => x.trips || x.invoiced !== '0.00' || x.collected !== '0.00' || x.outstanding !== '0.00')
          .sort((a, b) => Number(b.revenue) - Number(a.revenue));
        return {
          title: 'Revenue by customer',
          description: `Freight earned on trips delivered ${from} to ${to}, with invoicing and collections in the same period.`,
          columns: [
            { key: 'customer', label: 'Customer', type: 'text' },
            { key: 'trips', label: 'Trips', type: 'number' },
            { key: 'revenue', label: 'Revenue earned', type: 'money' },
            { key: 'invoiced', label: 'Invoiced', type: 'money' },
            { key: 'collected', label: 'Collected', type: 'money' },
            { key: 'outstanding', label: 'Outstanding now', type: 'money' },
          ],
          rows,
          totals: sumRow(rows, ['trips', 'revenue', 'invoiced', 'collected', 'outstanding'], { customer: 'Total' }),
          notes: ['Revenue earned is the approved freight of delivered trips, before GST (accrual basis).', 'Collected includes TDS deducted by customers.'],
        };
      }
      case 'receivables-ageing': {
        const open = await this.openInvoices(ctx.orgId);
        const byCustomer = new Map<string, Record<string, Big>>();
        for (const { i, c } of open) {
          const due = new Big(i.total).minus(i.paid).minus(i.credited);
          const row = byCustomer.get(c.name) ?? Object.fromEntries([...AGEING_BUCKETS, 'total'].map((b) => [b, new Big(0)]));
          const { bucket } = ageingBucket(i.dueDate, r.today);
          row[bucket] = row[bucket]!.plus(due);
          row.total = row.total!.plus(due);
          byCustomer.set(c.name, row);
        }
        const rows: Record<string, string>[] = [...byCustomer.entries()]
          .map(([customer, b]) => ({ customer, ...Object.fromEntries(Object.entries(b).map(([k, v]) => [k, money(v)])) }))
          .sort((a, b) => Number((b as Record<string, string>).total) - Number((a as Record<string, string>).total));
        return {
          title: 'Receivables ageing',
          description: `Unpaid invoice balances as of ${r.today}, by days past the due date.`,
          columns: [
            { key: 'customer', label: 'Customer', type: 'text' },
            { key: 'current', label: 'Not yet due', type: 'money' },
            { key: '1_30', label: '1–30 days', type: 'money' },
            { key: '31_60', label: '31–60 days', type: 'money' },
            { key: '61_90', label: '61–90 days', type: 'money' },
            { key: '90_plus', label: 'Over 90 days', type: 'money' },
            { key: 'total', label: 'Total', type: 'money' },
          ],
          rows,
          totals: sumRow(rows, ['current', '1_30', '31_60', '61_90', '90_plus', 'total'], { customer: 'Total' }),
          notes: ['Due dates come from each customer’s payment terms.'],
        };
      }
      case 'vehicle-performance': {
        const [list, costs, delivered, active] = await Promise.all([
          this.db.select({ id: vehicles.id, reg: vehicles.registrationNo, type: vehicleTypes.name }).from(vehicles).innerJoin(vehicleTypes, eq(vehicleTypes.id, vehicles.vehicleTypeId)).where(and(eq(vehicles.orgId, ctx.orgId), ne(vehicles.status, 'retired'))).orderBy(asc(vehicles.registrationNo)),
          this.ledgerCosts(ctx.orgId, from, to, 'vehicleId'),
          this.deliveredTrips(ctx.orgId, r.start, r.end),
          this.db
            .select({ vehicleId: trips.vehicleId, s: trips.actualStart, e: sql<Date | null>`COALESCE(${trips.completedAt}, ${trips.deliveredAt})` })
            .from(trips)
            .where(and(eq(trips.orgId, ctx.orgId), isNotNull(trips.actualStart), lt(trips.actualStart, r.end), sql`COALESCE(${trips.completedAt}, ${trips.deliveredAt}, NOW(3)) >= ${r.start}`)),
        ]);
        const periodMs = r.end.getTime() - r.start.getTime();
        const rows = list.map((v) => {
          const mine = delivered.filter((d) => d.t.vehicleId === v.id);
          const rev = mine.reduce((s, d) => s.plus(d.amount ?? 0), new Big(0));
          const km = mine.reduce((s, d) => s + (d.t.startOdometer && d.t.endOdometer ? Number(d.t.endOdometer) - Number(d.t.startOdometer) : Number(d.t.plannedDistanceKm ?? 0)), 0);
          const c = (k: string) => new Big(costs.find((x) => x.dim === v.id && x.key === k)?.amount ?? 0);
          const fuel = c('fuel_expense');
          const maint = c('maintenance_expense');
          const other = c('trip_expense').plus(c('crew_wages')).plus(c('hire_charges'));
          const busyMs = active.filter((a) => a.vehicleId === v.id).reduce((s, a) => s + Math.max(0, Math.min(r.end.getTime(), (a.e ? new Date(a.e) : new Date()).getTime()) - Math.max(r.start.getTime(), a.s!.getTime())), 0);
          return {
            vehicle: v.reg,
            type: v.type,
            trips: mine.length,
            km: Math.round(km),
            revenue: money(rev),
            fuel: money(fuel),
            maintenance: money(maint),
            otherCosts: money(other),
            profit: money(rev.minus(fuel).minus(maint).minus(other)),
            costPerKm: km > 0 ? money(fuel.plus(maint).plus(other).div(km)) : null,
            utilisation: Math.round((busyMs / periodMs) * 1000) / 10,
          };
        });
        return {
          title: 'Vehicle performance',
          description: `Per vehicle, ${from} to ${to}.`,
          columns: [
            { key: 'vehicle', label: 'Vehicle', type: 'text' },
            { key: 'type', label: 'Type', type: 'text' },
            { key: 'trips', label: 'Trips delivered', type: 'number' },
            { key: 'km', label: 'Km', type: 'number' },
            { key: 'revenue', label: 'Revenue', type: 'money' },
            { key: 'fuel', label: 'Fuel', type: 'money' },
            { key: 'maintenance', label: 'Maintenance', type: 'money' },
            { key: 'otherCosts', label: 'Crew and trip costs', type: 'money' },
            { key: 'profit', label: 'Contribution', type: 'money' },
            { key: 'costPerKm', label: 'Cost per km', type: 'money' },
            { key: 'utilisation', label: 'Utilisation', type: 'percent' },
          ],
          rows,
          totals: sumRow(rows, ['trips', 'km', 'revenue', 'fuel', 'maintenance', 'otherCosts', 'profit'], { vehicle: 'Fleet' }),
          notes: ['Utilisation is the share of the period the vehicle spent on a trip (dispatch to completion).', 'Contribution excludes overheads such as office costs, insurance and EMIs.'],
        };
      }
      case 'driver-performance': {
        const [staff, done, earned, alerts, incs] = await Promise.all([
          this.db.select({ id: workers.id, name: workers.fullName, code: workers.employeeCode }).from(workers).where(and(eq(workers.orgId, ctx.orgId), eq(workers.workerType, 'driver'))).orderBy(asc(workers.fullName)),
          this.deliveredTrips(ctx.orgId, r.start, r.end),
          this.db.select({ w: driverEarnings.workerId, s: sql<string>`COALESCE(SUM(${driverEarnings.amount}), 0)` }).from(driverEarnings).where(and(eq(driverEarnings.orgId, ctx.orgId), gte(driverEarnings.earnedOn, from), lte(driverEarnings.earnedOn, to))).groupBy(driverEarnings.workerId),
          this.db.select({ w: safetyAlerts.driverId, n: count() }).from(safetyAlerts).where(and(eq(safetyAlerts.orgId, ctx.orgId), gte(safetyAlerts.raisedAt, r.start), lt(safetyAlerts.raisedAt, r.end))).groupBy(safetyAlerts.driverId),
          this.db.select({ w: incidents.driverId, n: count() }).from(incidents).where(and(eq(incidents.orgId, ctx.orgId), gte(incidents.reportedAt, r.start), lt(incidents.reportedAt, r.end))).groupBy(incidents.driverId),
        ]);
        const rows = staff
          .map((w) => {
            const mine = done.filter((d) => d.t.driverId === w.id);
            const onTime = mine.filter((d) => d.t.deliveredAt && d.t.deliveredAt.getTime() <= d.t.plannedEnd.getTime() + 30 * 60_000).length;
            return {
              driver: w.name,
              code: w.code,
              trips: mine.length,
              km: Math.round(mine.reduce((s, d) => s + (d.t.startOdometer && d.t.endOdometer ? Number(d.t.endOdometer) - Number(d.t.startOdometer) : Number(d.t.plannedDistanceKm ?? 0)), 0)),
              onTime: mine.length ? Math.round((onTime / mine.length) * 1000) / 10 : null,
              earnings: money(earned.find((e) => e.w === w.id)?.s ?? 0),
              alerts: Number(alerts.find((a) => a.w === w.id)?.n ?? 0),
              incidents: Number(incs.find((a) => a.w === w.id)?.n ?? 0),
            };
          })
          .filter((x) => x.trips || x.earnings !== '0.00' || x.alerts || x.incidents);
        return {
          title: 'Driver performance',
          description: `Trips delivered ${from} to ${to}.`,
          columns: [
            { key: 'driver', label: 'Driver', type: 'text' },
            { key: 'code', label: 'Code', type: 'text' },
            { key: 'trips', label: 'Trips', type: 'number' },
            { key: 'km', label: 'Km', type: 'number' },
            { key: 'onTime', label: 'On time', type: 'percent' },
            { key: 'earnings', label: 'Pay earned', type: 'money' },
            { key: 'alerts', label: 'Safety alerts', type: 'number' },
            { key: 'incidents', label: 'Incidents', type: 'number' },
          ],
          rows,
          totals: sumRow(rows, ['trips', 'km', 'earnings', 'alerts', 'incidents'], { driver: 'All drivers' }),
          notes: ['On time means delivered no more than 30 minutes after the planned end.', 'Alerts include simulated GPS alerts in the demo.'],
        };
      }
      case 'fuel-efficiency': {
        const s = await this.fuel.summary(ctx, from, to);
        const rows = s.map((x) => ({ vehicle: x.vehicle.registrationNo, type: x.vehicle.vehicleType, fills: x.fills, litres: x.litres, amount: x.amount, kmpl: x.kmpl, declared: x.declaredKmpl, anomalies: x.anomalies }));
        return {
          title: 'Fuel efficiency',
          description: `Fills ${from} to ${to}.`,
          columns: [
            { key: 'vehicle', label: 'Vehicle', type: 'text' },
            { key: 'type', label: 'Type', type: 'text' },
            { key: 'fills', label: 'Fills', type: 'number' },
            { key: 'litres', label: 'Litres', type: 'number' },
            { key: 'amount', label: 'Spend', type: 'money' },
            { key: 'kmpl', label: 'Km/L (full to full)', type: 'number' },
            { key: 'declared', label: 'Expected km/L', type: 'number' },
            { key: 'anomalies', label: 'Flagged fills', type: 'number' },
          ],
          rows,
          totals: sumRow(rows, ['fills', 'litres', 'amount', 'anomalies'], { vehicle: 'Fleet' }),
          notes: ['Mileage is measured between full-tank fills, so partial fills do not distort it.'],
        };
      }
      case 'expenses-by-category': {
        const rows0 = await this.db
          .select({ name: expenseCategories.name, status: expenses.status, n: count(), s: sql<string>`COALESCE(SUM(${expenses.amount}), 0)` })
          .from(expenses)
          .innerJoin(expenseCategories, eq(expenseCategories.id, expenses.categoryId))
          .where(and(eq(expenses.orgId, ctx.orgId), gte(expenses.expenseDate, from), lte(expenses.expenseDate, to)))
          .groupBy(expenseCategories.name, expenses.status);
        const names = [...new Set(rows0.map((x) => x.name))].sort();
        const rows = names.map((name) => {
          const g = (st: string) => rows0.find((x) => x.name === name && x.status === st);
          return { category: name, count: rows0.filter((x) => x.name === name).reduce((s, x) => s + Number(x.n), 0), approved: money(g('approved')?.s ?? 0), pending: money(g('submitted')?.s ?? 0), rejected: money(g('rejected')?.s ?? 0) };
        });
        return {
          title: 'Expenses by category',
          description: `Expense claims dated ${from} to ${to}.`,
          columns: [
            { key: 'category', label: 'Category', type: 'text' },
            { key: 'count', label: 'Claims', type: 'number' },
            { key: 'approved', label: 'Approved', type: 'money' },
            { key: 'pending', label: 'Awaiting approval', type: 'money' },
            { key: 'rejected', label: 'Rejected', type: 'money' },
          ],
          rows,
          totals: sumRow(rows, ['count', 'approved', 'pending', 'rejected'], { category: 'Total' }),
          notes: ['Fuel bought with fuel cards or cash is recorded in fuel logs, not here.'],
        };
      }
      case 'maintenance-cost': {
        const wos = await this.db
          .select({ w: workOrders, reg: vehicles.registrationNo })
          .from(workOrders)
          .innerJoin(vehicles, eq(vehicles.id, workOrders.vehicleId))
          .where(and(eq(workOrders.orgId, ctx.orgId), eq(workOrders.status, 'completed'), gte(workOrders.completedAt, r.start), lt(workOrders.completedAt, r.end)));
        const regs = [...new Set(wos.map((x) => x.reg))].sort();
        const rows = regs.map((reg) => {
          const mine = wos.filter((x) => x.reg === reg).map((x) => x.w);
          const sum = (k: 'partsCost' | 'labourCost' | 'otherCost' | 'total') => money(mine.reduce((s, w) => s.plus(w[k]), new Big(0)));
          const down = mine.reduce((s, w) => s + (w.startedAt && w.completedAt ? (w.completedAt.getTime() - w.startedAt.getTime()) / 3_600_000 : 0), 0);
          return { vehicle: reg, jobs: mine.length, breakdowns: mine.filter((w) => w.woType === 'breakdown').length, downtime: Math.round(down * 10) / 10, parts: sum('partsCost'), labour: sum('labourCost'), other: sum('otherCost'), total: sum('total') };
        });
        return {
          title: 'Maintenance cost',
          description: `Work orders completed ${from} to ${to}.`,
          columns: [
            { key: 'vehicle', label: 'Vehicle', type: 'text' },
            { key: 'jobs', label: 'Jobs', type: 'number' },
            { key: 'breakdowns', label: 'Breakdowns', type: 'number' },
            { key: 'downtime', label: 'Downtime (h)', type: 'number' },
            { key: 'parts', label: 'Parts', type: 'money' },
            { key: 'labour', label: 'Labour', type: 'money' },
            { key: 'other', label: 'Other', type: 'money' },
            { key: 'total', label: 'Total', type: 'money' },
          ],
          rows,
          totals: sumRow(rows, ['jobs', 'breakdowns', 'downtime', 'parts', 'labour', 'other', 'total'], { vehicle: 'Fleet' }),
          notes: ['Downtime is from the start of work to completion.'],
        };
      }
      default:
        throw AppError.notFound('Report');
    }
  }
}

function sumRow(rows: Record<string, string | number | null>[], keys: string[], label: Record<string, string>) {
  const out: Record<string, string | number | null> = { ...label };
  for (const k of keys) {
    const isMoney = rows.some((r) => typeof r[k] === 'string');
    const total = rows.reduce((s, r) => s.plus(r[k] ?? 0), new Big(0));
    out[k] = isMoney ? money(total) : Math.round(total.toNumber() * 10) / 10;
  }
  return out;
}

/** CSV with a header row (and a totals row when the report has one). */
export function toCsv(t: ReportTableDto): string {
  const rows = t.rows.map((r) => t.columns.map((c) => r[c.key]));
  if (t.totals) rows.push(t.columns.map((c) => t.totals![c.key]));
  return toCsvText(
    t.columns.map((c) => c.label),
    rows,
  );
}
