import Big from 'big.js';
import { and, asc, eq, inArray, isNotNull } from 'drizzle-orm';
import {
  SYSTEM_ACCOUNTS,
  TYRE_POSITIONS,
  ageingBucket,
  addDays,
  checkFuelFill,
  computeInvoiceTax,
  computeSettlement,
  computeTripEarnings,
  isBalanced,
  sameGstState,
  todayIn,
  tripDays,
  type GstMode,
  type JournalSource,
  type SystemAccount,
} from '@transaxis/shared';
import type { Db } from '../src/client.js';
import * as s from '../src/schema/index.js';
import { addMinutes, Sequences } from './helpers.js';
import type { Rng } from './prng.js';

export interface FinanceOptions {
  orgId: number;
  now: Date;
  tz: string;
  userIdByRole: Map<string, number>;
  /** Customers billed with forward-charge GST (the rest use reverse charge). */
  forwardChargeCustomers: string[];
  /** Customers that deduct TDS when paying. */
  tdsCustomers: string[];
}

interface PostingLine {
  account: SystemAccount;
  debit?: Big | string | number;
  credit?: Big | string | number;
  tripId?: number | null;
  vehicleId?: number | null;
  customerId?: number | null;
  vendorId?: number | null;
  workerId?: number | null;
  memo?: string;
}
interface Posting {
  date: string;
  memo: string;
  source: JournalSource;
  sourceId: number;
  key: string;
  lines: PostingLine[];
  link?: (entryId: number) => Promise<void>;
}

const money = (v: Big | string | number) => new Big(v).round(2, Big.roundHalfUp).toFixed(2);

/**
 * Finance and maintenance history for the demo: chart of accounts, expense claims, fuel with mileage
 * checks, crew pay and settlements, invoices with receipts (some overdue), and workshop jobs. Every
 * money movement is posted to the ledger exactly as the API would post it.
 */
export async function seedFinance(db: Db, rng: Rng, o: FinanceOptions) {
  const day = (d: Date) => todayIn(o.tz, d);
  const today = day(o.now);
  const accountant = o.userIdByRole.get('accountant') ?? o.userIdByRole.get('owner') ?? null;
  const dispatcher = o.userIdByRole.get('dispatcher') ?? null;
  const maintenanceUser = o.userIdByRole.get('maintenance_manager') ?? null;
  const seq = new Sequences();
  const postings: Posting[] = [];
  const counts = { journalEntries: 0, invoices: 0, receipts: 0, fuelLogs: 0, expenses: 0, earnings: 0, settlements: 0, workOrders: 0 };

  // ------------------------------------------------------------- chart of accounts and categories
  await db.insert(s.ledgerAccounts).values(
    (Object.keys(SYSTEM_ACCOUNTS) as SystemAccount[]).map((k) => ({ orgId: o.orgId, code: SYSTEM_ACCOUNTS[k].code, name: SYSTEM_ACCOUNTS[k].name, accountType: SYSTEM_ACCOUNTS[k].type, systemKey: k })),
  );
  const accountRows = await db.select().from(s.ledgerAccounts).where(eq(s.ledgerAccounts.orgId, o.orgId));
  const accountId = new Map(accountRows.map((a) => [a.systemKey as SystemAccount, a.id]));

  const catDefs = [
    { name: 'Tolls (FASTag)', accountKey: 'trip_expense', isTripExpense: true, requiresReceiptAbove: null },
    { name: 'Loading and unloading', accountKey: 'trip_expense', isTripExpense: true, requiresReceiptAbove: '1000.00' },
    { name: 'Driver food and stay', accountKey: 'trip_expense', isTripExpense: true, requiresReceiptAbove: '1500.00' },
    { name: 'Parking and entry fees', accountKey: 'trip_expense', isTripExpense: true, requiresReceiptAbove: null },
    { name: 'Fines and challans', accountKey: 'trip_expense', isTripExpense: true, requiresReceiptAbove: '0.00' },
    { name: 'Minor repairs on the road', accountKey: 'maintenance_expense', isTripExpense: true, requiresReceiptAbove: '2000.00' },
    { name: 'Fuel paid by driver', accountKey: 'fuel_expense', isTripExpense: true, requiresReceiptAbove: '0.00' },
    { name: 'Office expenses', accountKey: 'office_expense', isTripExpense: false, requiresReceiptAbove: '5000.00' },
  ];
  await db.insert(s.expenseCategories).values(catDefs.map((c) => ({ orgId: o.orgId, ...c })));
  const cats = new Map((await db.select().from(s.expenseCategories).where(eq(s.expenseCategories.orgId, o.orgId))).map((c) => [c.name, c]));

  // ------------------------------------------------------------- fleet facts
  const fleet = await db.select().from(s.vehicles).where(eq(s.vehicles.orgId, o.orgId));
  for (const v of fleet) {
    const payload = Number(v.payloadCapacityKg);
    await db.update(s.vehicles).set({ fuelTankLitres: payload < 10_000 ? 200 : payload < 20_000 ? 300 : 400 }).where(eq(s.vehicles.id, v.id));
  }
  const vendorRows = await db.select().from(s.vendors).where(eq(s.vendors.orgId, o.orgId));
  const vendorOf = (type: string) => vendorRows.filter((v) => v.vendorType === type);
  const fuelStations = vendorOf('fuel_station');
  const workshops = vendorOf('workshop');

  // ------------------------------------------------------------- trips with the money that hangs off them
  const tripRows = await db
    .select({ t: s.trips, b: s.bookings, r: s.routes })
    .from(s.trips)
    .leftJoin(s.bookings, eq(s.bookings.id, s.trips.bookingId))
    .leftJoin(s.routes, eq(s.routes.id, s.trips.routeId))
    .where(and(eq(s.trips.orgId, o.orgId), isNotNull(s.trips.actualStart)))
    .orderBy(asc(s.trips.actualStart));
  const vehicleById = new Map(fleet.map((v) => [v.id, v]));

  // Fuel: a full tank at the start of every trip and a top-up on long ones.
  const lastFull = new Map<number, { odo: number; litresSince: number }>();
  for (const { t, r } of tripRows) {
    if (t.startOdometer === null) continue;
    const v = vehicleById.get(t.vehicleId)!;
    const kmpl = Number(v.fuelEfficiencyKmpl ?? 4);
    const dist = Number(r?.distanceKm ?? t.plannedDistanceKm ?? 300);
    const fills: { at: Date; odo: number; litres: number }[] = [{ at: addMinutes(t.actualStart!, -35), odo: Number(t.startOdometer), litres: 0 }];
    if (dist > 400 && (t.endOdometer !== null || t.status === 'in_transit')) fills.push({ at: addMinutes(t.actualStart!, Math.round(dist * 0.55 * 1.4)), odo: Number(t.startOdometer) + Math.round(dist * 0.55), litres: 0 });
    for (const f of fills) {
      if (f.at > o.now) continue;
      const prev = lastFull.get(v.id);
      const kmSince = prev ? f.odo - prev.odo : null;
      // Litres to refill what the last leg burned; a few fills are deliberately suspicious.
      const suspicious = rng.chance(0.04);
      const burned = kmSince && kmSince > 0 ? (kmSince / kmpl) * (0.93 + rng.next() * 0.14) * (suspicious ? 1.45 : 1) : 120 + rng.int(0, 60);
      const litres = Math.min(Math.round(burned * 10) / 10, (v.fuelTankLitres ?? 300) * 1.04);
      const check = checkFuelFill({ litres, odometerKm: f.odo, previousOdometerKm: prev?.odo ?? null, litresSinceFull: prev ? prev.litresSince + litres : null, kmSinceFull: kmSince, tankLitres: v.fuelTankLitres ?? 300, typicalKmpl: kmpl });
      lastFull.set(v.id, { odo: f.odo, litresSince: 0 });
      const price = 88.4 + rng.int(0, 55) / 10;
      const amount = money(new Big(litres).times(price));
      const paidCash = rng.chance(0.08);
      const station = fuelStations.length ? rng.pick(fuelStations) : null;
      const [row] = await db
        .insert(s.fuelLogs)
        .values({
          orgId: o.orgId,
          vehicleId: v.id,
          tripId: t.id,
          workerId: t.driverId,
          vendorId: paidCash ? null : (station?.id ?? null),
          filledAt: f.at,
          odometerKm: f.odo.toFixed(1),
          litres: litres.toFixed(2),
          pricePerLitre: price.toFixed(2),
          amount,
          paymentMode: paidCash ? 'cash' : 'fuel_card',
          fullTank: true,
          stationName: paidCash ? 'Roadside pump' : (station?.name ?? null),
          kmpl: check.kmpl?.toFixed(2) ?? null,
          anomaly: check.anomalies.length > 0,
          anomalyReasons: check.anomalies.length ? check.anomalies : null,
          createdBy: dispatcher,
        })
        .$returningId();
      counts.fuelLogs++;
      const fuelId = row!.id;
      postings.push({
        date: day(f.at),
        memo: `Fuel ${litres} L for ${v.registrationNo}`,
        source: 'fuel',
        sourceId: fuelId,
        key: `fuel:${fuelId}`,
        lines: [
          { account: 'fuel_expense', debit: amount, tripId: t.id, vehicleId: v.id },
          paidCash ? { account: 'cash', credit: amount, tripId: t.id } : { account: 'payables', credit: amount, vendorId: station?.id ?? null, tripId: t.id },
        ],
        link: async (e) => void (await db.update(s.fuelLogs).set({ journalEntryId: e }).where(eq(s.fuelLogs.id, fuelId))),
      });
    }
  }

  // Trip expenses: FASTag tolls, loading charges, and driver-paid food and fines.
  const addExpense = async (x: { trip: typeof s.trips.$inferSelect; cat: string; amount: number; mode: 'fastag' | 'cash' | 'driver_paid'; description: string; at: Date }) => {
    const cat = cats.get(x.cat)!;
    const decided = addMinutes(x.at, rng.int(24, 72) * 60);
    const pending = decided > o.now;
    const [row] = await db
      .insert(s.expenses)
      .values({
        orgId: o.orgId,
        categoryId: cat.id,
        tripId: x.trip.id,
        vehicleId: x.trip.vehicleId,
        workerId: x.trip.driverId,
        expenseDate: day(x.at),
        amount: money(x.amount),
        paymentMode: x.mode,
        description: x.description,
        status: pending ? 'submitted' : 'approved',
        submittedBy: dispatcher,
        decidedBy: pending ? null : accountant,
        decidedAt: pending ? null : decided,
      })
      .$returningId();
    counts.expenses++;
    if (pending) return;
    const id = row!.id;
    const credit: SystemAccount = x.mode === 'driver_paid' ? 'driver_payable' : x.mode === 'cash' ? 'cash' : 'bank';
    postings.push({
      date: day(x.at),
      memo: `${cat.name}: ${x.description}`,
      source: 'expense',
      sourceId: id,
      key: `expense:${id}`,
      lines: [
        { account: cat.accountKey as SystemAccount, debit: money(x.amount), tripId: x.trip.id, vehicleId: x.trip.vehicleId, workerId: x.trip.driverId },
        { account: credit, credit: money(x.amount), workerId: credit === 'driver_payable' ? x.trip.driverId : null, tripId: x.trip.id },
      ],
      link: async (e) => void (await db.update(s.expenses).set({ journalEntryId: e }).where(eq(s.expenses.id, id))),
    });
  };
  for (const { t, r } of tripRows) {
    if (!t.deliveredAt && t.status !== 'in_transit') continue;
    const at = t.deliveredAt ?? o.now;
    if (r?.tollEstimate) await addExpense({ trip: t, cat: 'Tolls (FASTag)', amount: Math.round(Number(r.tollEstimate) * (0.95 + rng.next() * 0.1)), mode: 'fastag', description: `FASTag tolls ${t.originCity} to ${t.destinationCity}`, at: addMinutes(t.actualStart!, 120) });
    if (!t.deliveredAt) continue;
    if (rng.chance(0.4)) await addExpense({ trip: t, cat: 'Loading and unloading', amount: rng.int(8, 25) * 100, mode: 'cash', description: 'Hamali charges at unloading', at });
    if (rng.chance(0.5)) await addExpense({ trip: t, cat: 'Driver food and stay', amount: rng.int(3, 9) * 100, mode: 'driver_paid', description: 'Meals on the road', at });
    if (rng.chance(0.03)) await addExpense({ trip: t, cat: 'Fines and challans', amount: rng.int(5, 20) * 100, mode: 'driver_paid', description: 'Overloading check post challan', at });
    if (rng.chance(0.04)) await addExpense({ trip: t, cat: 'Fuel paid by driver', amount: rng.int(20, 50) * 100, mode: 'driver_paid', description: 'Diesel top-up paid by the driver', at: addMinutes(t.actualStart!, 300) });
  }

  // ------------------------------------------------------------- crew pay
  const staff = await db.select({ w: s.workers, p: s.compensationPolicies }).from(s.workers).leftJoin(s.compensationPolicies, eq(s.compensationPolicies.id, s.workers.compensationPolicyId)).where(eq(s.workers.orgId, o.orgId));
  const staffById = new Map(staff.map((x) => [x.w.id, x]));
  const crewRows = await db.select().from(s.tripCrew);
  for (const { t, b } of tripRows) {
    if (!t.completedAt) continue;
    const people = [t.driverId, ...crewRows.filter((c) => c.tripId === t.id).map((c) => c.workerId)];
    for (const pid of people) {
      const sp = staffById.get(pid);
      if (!sp?.p) continue;
      const distanceKm = t.startOdometer && t.endOdometer ? Math.round(Number(t.endOdometer) - Number(t.startOdometer)) : Math.round(Number(t.plannedDistanceKm ?? 0));
      const days = tripDays(t.actualStart!.toISOString(), t.completedAt.toISOString(), o.tz);
      const onTime = !!t.deliveredAt && t.deliveredAt.getTime() <= t.plannedEnd.getTime() + 30 * 60_000;
      const res = computeTripEarnings({ policy: { basis: sp.p.basis, rate: sp.p.rate, dailyAllowance: sp.p.dailyAllowance, onTimeBonus: sp.p.onTimeBonus, minPerTrip: sp.p.minPerTrip }, distanceKm, weightKg: Number(b?.totalWeightKg ?? 0), freightAmount: b?.approvedAmount ?? null, tripDays: days, onTime });
      if (!res.lines.length) continue;
      const earnedOn = day(t.completedAt);
      await db.insert(s.driverEarnings).values(
        res.lines.map((l) => ({ orgId: o.orgId, workerId: pid, tripId: t.id, earningType: l.type, amount: l.amount, explanation: { label: l.label, formula: l.formula, inputs: { policy: sp.p!.name, distanceKm, tripDays: days, onTime } }, earnedOn })),
      );
      counts.earnings += res.lines.length;
      postings.push({
        date: earnedOn,
        memo: `Pay for ${sp.w.fullName} on ${t.tripNo}`,
        source: 'earning',
        sourceId: t.id,
        key: `earning:${t.id}:${pid}`,
        lines: [
          { account: 'crew_wages', debit: res.total, tripId: t.id, workerId: pid, vehicleId: t.vehicleId },
          { account: 'driver_payable', credit: res.total, workerId: pid, tripId: t.id },
        ],
        link: async (e) => void (await db.update(s.driverEarnings).set({ journalEntryId: e }).where(and(eq(s.driverEarnings.tripId, t.id), eq(s.driverEarnings.workerId, pid)))),
      });
    }
  }

  // Trip advances for diesel and tolls on recent trips, in cash.
  const recentCut = addMinutes(o.now, -45 * 1440);
  for (const { t } of tripRows) {
    if (t.actualStart! < recentCut || !rng.chance(0.6)) continue;
    const amount = rng.int(20, 60) * 100;
    const [row] = await db
      .insert(s.driverAdvances)
      .values({ orgId: o.orgId, workerId: t.driverId, tripId: t.id, givenOn: day(t.actualStart!), amount: money(amount), mode: 'cash', purpose: `Trip advance for ${t.tripNo}`, createdBy: accountant })
      .$returningId();
    const id = row!.id;
    postings.push({
      date: day(t.actualStart!),
      memo: `Advance to driver for ${t.tripNo}`,
      source: 'advance',
      sourceId: id,
      key: `advance:${id}`,
      lines: [
        { account: 'driver_advances', debit: amount, workerId: t.driverId, tripId: t.id },
        { account: 'cash', credit: amount, workerId: t.driverId },
      ],
      link: async (e) => void (await db.update(s.driverAdvances).set({ journalEntryId: e }).where(eq(s.driverAdvances.id, id))),
    });
  }

  // Monthly settlements for completed months; last month's is approved, older ones paid.
  const monthStart = (d: string) => `${d.slice(0, 7)}-01`;
  const months: string[] = [];
  for (let k = 3; k >= 1; k--) {
    const d = new Date(`${monthStart(today)}T00:00:00Z`);
    d.setUTCMonth(d.getUTCMonth() - k);
    months.push(d.toISOString().slice(0, 10));
  }
  for (const from of months) {
    const next = new Date(`${from}T00:00:00Z`);
    next.setUTCMonth(next.getUTCMonth() + 1);
    const to = addDays(next.toISOString().slice(0, 10), -1);
    const payDay = addDays(next.toISOString().slice(0, 10), 4);
    const isLast = from === months[months.length - 1];
    for (const { w } of staff) {
      if (w.workerType !== 'driver' && w.workerType !== 'helper') continue;
      const earn = await db.select().from(s.driverEarnings).where(and(eq(s.driverEarnings.workerId, w.id), eq(s.driverEarnings.orgId, o.orgId)));
      const e = earn.filter((x) => !x.settlementId && x.earnedOn <= to);
      const reimb = (await db.select().from(s.expenses).where(and(eq(s.expenses.workerId, w.id), eq(s.expenses.paymentMode, 'driver_paid'), eq(s.expenses.status, 'approved')))).filter((x) => !x.settlementId && x.expenseDate <= to);
      const adv = (await db.select().from(s.driverAdvances).where(eq(s.driverAdvances.workerId, w.id))).filter((a) => a.givenOn <= to && new Big(a.amount).gt(a.recovered)).sort((a, b) => a.givenOn.localeCompare(b.givenOn));
      if (!e.length && !reimb.length) continue;
      const r = computeSettlement({ earnings: e.map((x) => ({ id: x.id, amount: x.amount })), reimbursements: reimb.map((x) => ({ id: x.id, amount: x.amount })), advances: adv.map((a) => ({ id: a.id, outstanding: money(new Big(a.amount).minus(a.recovered)) })), deductions: [] });
      const paid = !isLast && payDay <= today;
      const tripNoOf = new Map(tripRows.map(({ t }) => [t.id, t.tripNo]));
      const [row] = await db
        .insert(s.settlements)
        .values({
          orgId: o.orgId,
          settlementNo: seq.take('STL', 'STL', new Date(`${payDay}T06:00:00Z`)),
          workerId: w.id,
          periodFrom: from,
          periodTo: to,
          earnings: r.earnings,
          reimbursements: r.reimbursements,
          deductions: r.deductions,
          advancesRecovered: r.advancesRecovered,
          net: r.net,
          status: paid ? 'paid' : 'approved',
          breakdown: {
            earnings: e.map((x) => ({ id: x.id, tripNo: x.tripId ? (tripNoOf.get(x.tripId) ?? null) : null, label: x.explanation.label, formula: x.explanation.formula, amount: x.amount })),
            reimbursements: reimb.map((x) => ({ id: x.id, date: x.expenseDate, description: x.description, amount: x.amount })),
            deductions: [],
            advances: adv.map((a) => ({ id: a.id, givenOn: a.givenOn, outstanding: money(new Big(a.amount).minus(a.recovered)), recoveredNow: r.recoveries.find((x) => x.id === a.id)?.amount ?? '0.00' })),
            advanceCarriedForward: r.advanceCarriedForward,
          },
          approvedBy: accountant,
          approvedAt: new Date(`${payDay}T04:00:00Z`),
          paidOn: paid ? payDay : null,
          paidMode: paid ? 'bank' : null,
          paymentReference: paid ? `NEFT${rng.int(100000, 999999)}` : null,
          createdBy: accountant,
        })
        .$returningId();
      counts.settlements++;
      const sid = row!.id;
      if (e.length) await db.update(s.driverEarnings).set({ settlementId: sid }).where(inArray(s.driverEarnings.id, e.map((x) => x.id)));
      if (reimb.length) await db.update(s.expenses).set({ settlementId: sid }).where(inArray(s.expenses.id, reimb.map((x) => x.id)));
      for (const rec of r.recoveries) {
        await db.insert(s.advanceRecoveries).values({ settlementId: sid, advanceId: rec.id, amount: rec.amount });
        const a = adv.find((x) => x.id === rec.id)!;
        await db.update(s.driverAdvances).set({ recovered: money(new Big(a.recovered).plus(rec.amount)) }).where(eq(s.driverAdvances.id, rec.id));
      }
      if (paid) {
        postings.push({
          date: payDay,
          memo: `Settlement for ${w.fullName}, ${from} to ${to}`,
          source: 'settlement',
          sourceId: sid,
          key: `settlement:${sid}`,
          lines: [
            { account: 'driver_payable', debit: new Big(r.earnings).plus(r.reimbursements), workerId: w.id },
            { account: 'driver_advances', credit: r.advancesRecovered, workerId: w.id },
            { account: 'bank', credit: r.net, workerId: w.id },
          ],
          link: async (je) => void (await db.update(s.settlements).set({ journalEntryId: je }).where(eq(s.settlements.id, sid))),
        });
      }
    }
  }

  // ------------------------------------------------------------- invoices and receipts
  const [org] = await db.select().from(s.organizations).where(eq(s.organizations.id, o.orgId));
  const customerRows = await db.select().from(s.customers).where(eq(s.customers.orgId, o.orgId));
  const billable = tripRows.filter(({ t, b }) => b && b.approvedAmount && t.deliveredAt && t.deliveredAt < addMinutes(o.now, -5 * 1440) && b.status === 'delivered');
  const groups = new Map<string, typeof billable>();
  for (const x of billable) {
    const key = `${x.b!.customerId}|${day(x.t.deliveredAt!).slice(0, 7)}`;
    groups.set(key, [...(groups.get(key) ?? []), x]);
  }
  const plans = [...groups.entries()]
    .map(([key, items]) => {
      const last = items.map((i) => day(i.t.deliveredAt!)).sort().at(-1)!;
      const monthEnd = addDays(`${addDays(`${last.slice(0, 7)}-28`, 4).slice(0, 7)}-01`, -1);
      const invoiceDate = monthEnd < today ? monthEnd : addDays(last, 2);
      return { customerId: Number(key.split('|')[0]), items, invoiceDate: invoiceDate > today ? today : invoiceDate };
    })
    .sort((a, b) => a.invoiceDate.localeCompare(b.invoiceDate));
  for (const p of plans) {
    const c = customerRows.find((x) => x.id === p.customerId)!;
    const mode: GstMode = o.forwardChargeCustomers.includes(c.code) ? 'forward_12' : 'rcm_5';
    const intra = c.gstin ? sameGstState(org!.gstin, c.gstin) : c.state === org!.state;
    const taxable = p.items.reduce((sum, i) => sum.plus(i.b!.approvedAmount!), new Big(0));
    const tax = computeInvoiceTax(taxable.toFixed(2), mode, intra);
    const dueDate = addDays(p.invoiceDate, c.paymentTermsDays);
    const invoiceNo = seq.take('INV', 'INV', new Date(`${p.invoiceDate}T06:00:00Z`));
    const [row] = await db
      .insert(s.invoices)
      .values({ orgId: o.orgId, invoiceNo, customerId: c.id, invoiceDate: p.invoiceDate, dueDate, gstMode: mode, placeOfSupply: c.state, intraState: intra, taxable: tax.taxable, cgst: tax.cgst, sgst: tax.sgst, igst: tax.igst, reverseChargeTax: tax.reverseChargeTax, total: tax.total, createdBy: accountant })
      .$returningId();
    counts.invoices++;
    const invId = row!.id;
    await db.insert(s.invoiceLines).values(
      p.items.map((i) => ({ invoiceId: invId, bookingId: i.b!.id, tripId: i.t.id, description: `Freight ${i.b!.originCity} to ${i.b!.destinationCity}, ${i.b!.bookingNo}${i.b!.lrNumber ? `, LR ${i.b!.lrNumber}` : ''}`, amount: i.b!.approvedAmount! })),
    );
    await db.update(s.bookings).set({ status: 'invoiced' }).where(inArray(s.bookings.id, p.items.map((i) => i.b!.id)));
    postings.push({
      date: p.invoiceDate,
      memo: `Invoice ${invoiceNo} to ${c.name}`,
      source: 'invoice',
      sourceId: invId,
      key: `invoice:${invId}`,
      lines: [
        { account: 'receivables', debit: tax.total, customerId: c.id },
        ...p.items.map((i) => ({ account: 'freight_income' as const, credit: i.b!.approvedAmount!, tripId: i.t.id, customerId: c.id })),
        { account: 'gst_output', credit: tax.taxOnInvoice, customerId: c.id },
      ],
      link: async (e) => void (await db.update(s.invoices).set({ journalEntryId: e }).where(eq(s.invoices.id, invId))),
    });

    // Most customers pay around the due date; some are late, a few partly paid or unpaid.
    const { bucket } = ageingBucket(dueDate, today);
    const roll = rng.next();
    let receivedOn: string | null = null;
    let fraction = 1;
    if (bucket === 'current') {
      if (roll < 0.3) receivedOn = addDays(p.invoiceDate, rng.int(5, 15));
    } else if (roll < 0.78) {
      receivedOn = addDays(dueDate, rng.int(-6, 12));
    } else if (roll < 0.9) {
      receivedOn = addDays(dueDate, rng.int(0, 10));
      fraction = 0.5;
    }
    if (receivedOn && receivedOn > today) receivedOn = null;
    if (!receivedOn) continue;
    const settled = new Big(tax.total).times(fraction).round(2, Big.roundHalfUp);
    const tds = o.tdsCustomers.includes(c.code) ? new Big(tax.taxable).times(fraction).times(0.02).round(0, Big.roundHalfUp) : new Big(0);
    const cash = settled.minus(tds);
    const receiptNo = seq.take('RCP', 'RCP', new Date(`${receivedOn}T06:00:00Z`));
    const [rr] = await db
      .insert(s.receipts)
      .values({ orgId: o.orgId, receiptNo, customerId: c.id, receivedOn, mode: 'bank', reference: `UTR${rng.int(10_000_000, 99_999_999)}`, amount: money(cash), tdsAmount: money(tds), unallocated: '0.00', createdBy: accountant })
      .$returningId();
    counts.receipts++;
    const rid = rr!.id;
    await db.insert(s.receiptAllocations).values({ receiptId: rid, invoiceId: invId, amount: money(settled) });
    await db.update(s.invoices).set({ paid: money(settled), status: fraction === 1 ? 'paid' : 'partially_paid' }).where(eq(s.invoices.id, invId));
    postings.push({
      date: receivedOn,
      memo: `Receipt ${receiptNo} from ${c.name}`,
      source: 'receipt',
      sourceId: rid,
      key: `receipt:${rid}`,
      lines: [
        { account: 'bank', debit: cash, customerId: c.id },
        { account: 'tds_receivable', debit: tds, customerId: c.id },
        { account: 'receivables', credit: settled, customerId: c.id },
      ],
      link: async (e) => void (await db.update(s.receipts).set({ journalEntryId: e }).where(eq(s.receipts.id, rid))),
    });
  }

  // ------------------------------------------------------------- maintenance
  const partDefs = [
    { partNo: 'OF-1132', name: 'Engine oil filter', unit: 'pcs', reorderLevel: 6, unitCost: 640 },
    { partNo: 'EO-15W40', name: 'Engine oil 15W-40', unit: 'L', reorderLevel: 60, unitCost: 245 },
    { partNo: 'AF-2210', name: 'Air filter element', unit: 'pcs', reorderLevel: 4, unitCost: 1450 },
    { partNo: 'BP-3305', name: 'Brake lining set', unit: 'set', reorderLevel: 4, unitCost: 3800 },
    { partNo: 'FB-1180', name: 'Fan belt', unit: 'pcs', reorderLevel: 4, unitCost: 720 },
    { partNo: 'GR-EP2', name: 'Chassis grease EP2', unit: 'kg', reorderLevel: 10, unitCost: 210 },
    { partNo: 'FF-0451', name: 'Fuel filter', unit: 'pcs', reorderLevel: 6, unitCost: 980 },
    { partNo: 'BAT-150', name: 'Battery 150Ah', unit: 'pcs', reorderLevel: 1, unitCost: 11500 },
  ];
  await db.insert(s.spareParts).values(partDefs.map((p, i) => ({ orgId: o.orgId, partNo: p.partNo, name: p.name, unit: p.unit, reorderLevel: p.reorderLevel.toFixed(2), unitCost: p.unitCost.toFixed(2), stockQty: (i === 3 ? 2 : p.reorderLevel * 3).toFixed(2) })));
  const parts = new Map((await db.select().from(s.spareParts).where(eq(s.spareParts.orgId, o.orgId))).map((p) => [p.partNo, p]));

  const active = fleet.filter((v) => v.status !== 'retired');
  const scheduleDefs = [
    { task: 'Engine oil and filter change', everyKm: 15_000, everyDays: 180 },
    { task: 'Brake inspection', everyKm: 20_000, everyDays: 120 },
    { task: 'Greasing and chassis lubrication', everyKm: 5_000, everyDays: 30 },
    { task: 'Wheel alignment and tyre rotation', everyKm: 10_000, everyDays: null },
  ];
  for (const v of active) {
    const odo = Number(v.odometerKm);
    for (const d of scheduleDefs) {
      // Spread "last done" so some services are due soon and a few are overdue.
      const ago = rng.next();
      const lastKm = Math.max(0, Math.round(odo - d.everyKm * (ago < 0.12 ? 1.05 : ago * 0.9)));
      const lastOn = d.everyDays ? addDays(today, -Math.round(d.everyDays * (ago < 0.12 ? 1.1 : ago * 0.85))) : null;
      await db.insert(s.maintenanceSchedules).values({ orgId: o.orgId, vehicleId: v.id, task: d.task, everyKm: d.everyKm, everyDays: d.everyDays, lastDoneKm: lastKm.toFixed(1), lastDoneOn: lastOn });
    }
  }
  const schedules = await db.select().from(s.maintenanceSchedules).where(eq(s.maintenanceSchedules.orgId, o.orgId));

  const addWorkOrder = async (x: {
    v: typeof s.vehicles.$inferSelect;
    type: 'preventive' | 'breakdown' | 'tyre';
    title: string;
    openedAt: Date;
    status: 'completed' | 'in_progress';
    items: { kind: 'part' | 'labour' | 'other'; partNo?: string; description: string; qty: number; cost: number }[];
    scheduleTask?: string;
  }) => {
    const vendor = x.type === 'preventive' && rng.chance(0.5) ? null : rng.pick(workshops.length ? workshops : [null]);
    const startedAt = addMinutes(x.openedAt, rng.int(30, 240));
    const completedAt = x.status === 'completed' ? addMinutes(startedAt, rng.int(3, 30) * 60) : null;
    const items = x.items.map((i) => ({ ...i, amount: money(new Big(i.qty).times(i.cost)) }));
    const sum = (k: string) => items.filter((i) => i.kind === k).reduce((acc, i) => acc.plus(i.amount), new Big(0));
    const total = sum('part').plus(sum('labour')).plus(sum('other'));
    const schedule = x.scheduleTask ? schedules.find((sc) => sc.vehicleId === x.v.id && sc.task === x.scheduleTask) : undefined;
    const payMode = vendor ? 'vendor_credit' : 'cash';
    const [row] = await db
      .insert(s.workOrders)
      .values({
        orgId: o.orgId,
        woNo: seq.take('WO', 'WO', x.openedAt),
        vehicleId: x.v.id,
        scheduleId: schedule?.id ?? null,
        woType: x.type,
        priority: x.type === 'breakdown' ? 'high' : 'normal',
        status: x.status,
        title: x.title,
        description: x.type === 'breakdown' ? 'Reported by the driver on the road.' : null,
        vendorId: vendor?.id ?? null,
        odometerKm: x.v.odometerKm,
        openedAt: x.openedAt,
        startedAt,
        completedAt,
        vehicleStatusBefore: x.status === 'in_progress' ? 'available' : null,
        partsCost: money(sum('part')),
        labourCost: money(sum('labour')),
        otherCost: money(sum('other')),
        total: money(total),
        paymentMode: x.status === 'completed' ? payMode : null,
        createdBy: maintenanceUser,
      })
      .$returningId();
    counts.workOrders++;
    const woId = row!.id;
    await db.insert(s.workOrderItems).values(items.map((i) => ({ workOrderId: woId, kind: i.kind, partId: i.partNo ? (parts.get(i.partNo)?.id ?? null) : null, description: i.description, quantity: i.qty.toFixed(2), unitCost: i.cost.toFixed(2), amount: i.amount })));
    if (x.status !== 'completed' || total.eq(0)) return;
    const fromStock = items.filter((i) => i.partNo).reduce((acc, i) => acc.plus(i.amount), new Big(0));
    postings.push({
      date: day(completedAt!),
      memo: `${x.title}: ${x.v.registrationNo}`,
      source: 'work_order',
      sourceId: woId,
      key: `work_order:${woId}`,
      lines: [
        { account: 'maintenance_expense', debit: total, vehicleId: x.v.id, vendorId: vendor?.id ?? null },
        { account: 'spares_inventory', credit: fromStock, vehicleId: x.v.id },
        { account: payMode === 'cash' ? 'cash' : 'payables', credit: total.minus(fromStock), vendorId: vendor?.id ?? null, vehicleId: x.v.id },
      ],
      link: async (e) => void (await db.update(s.workOrders).set({ journalEntryId: e }).where(eq(s.workOrders.id, woId))),
    });
  };

  for (const v of active) {
    const jobs = rng.int(1, 3);
    for (let j = 0; j < jobs; j++) {
      const openedAt = addMinutes(o.now, -rng.int(5, 170) * 1440);
      if (rng.chance(0.7)) {
        await addWorkOrder({
          v,
          type: 'preventive',
          title: 'Engine oil and filter change',
          openedAt,
          status: 'completed',
          scheduleTask: 'Engine oil and filter change',
          items: [
            { kind: 'part', partNo: 'EO-15W40', description: 'Engine oil 15W-40', qty: 18, cost: 245 },
            { kind: 'part', partNo: 'OF-1132', description: 'Engine oil filter', qty: 1, cost: 640 },
            { kind: 'labour', description: 'Service labour', qty: 1, cost: rng.int(6, 12) * 100 },
          ],
        });
      } else {
        await addWorkOrder({
          v,
          type: rng.chance(0.5) ? 'tyre' : 'breakdown',
          title: rng.pick(['Clutch plate replacement', 'Radiator leak repair', 'Alternator repair', 'Tyre burst replacement', 'Brake air leak']),
          openedAt,
          status: 'completed',
          items: [
            { kind: 'other', description: 'Parts supplied by workshop', qty: 1, cost: rng.int(25, 140) * 100 },
            { kind: 'labour', description: 'Repair labour', qty: 1, cost: rng.int(8, 30) * 100 },
          ],
        });
      }
    }
  }
  for (const v of fleet.filter((x) => x.status === 'under_maintenance')) {
    await addWorkOrder({
      v,
      type: 'breakdown',
      title: rng.pick(['Gearbox overhaul', 'Turbocharger replacement']),
      openedAt: addMinutes(o.now, -rng.int(1, 3) * 1440),
      status: 'in_progress',
      items: [{ kind: 'labour', description: 'Diagnosis and dismantling', qty: 1, cost: 2500 }],
    });
  }

  // Tyres: six fitted on the first trucks, plus spares in stock.
  const brands = ['MRF', 'Apollo', 'JK Tyre', 'CEAT'];
  let serial = 1000;
  for (const v of active.slice(0, 6)) {
    for (const pos of TYRE_POSITIONS.slice(0, 6)) {
      const run = rng.int(8_000, 70_000);
      await db.insert(s.tyres).values({
        orgId: o.orgId,
        serialNo: `${v.registrationNo.slice(0, 2)}T${serial++}`,
        brand: rng.pick(brands),
        size: '295/80 R22.5',
        status: 'fitted',
        vehicleId: v.id,
        position: pos,
        fittedOn: addDays(today, -rng.int(30, 400)),
        fittedAtKm: Math.max(0, Number(v.odometerKm) - run).toFixed(1),
        purchaseCost: (rng.int(180, 240) * 100).toFixed(2),
        expectedLifeKm: 90_000,
      });
    }
  }
  for (let i = 0; i < 6; i++) {
    await db.insert(s.tyres).values({ orgId: o.orgId, serialNo: `STK${serial++}`, brand: rng.pick(brands), size: '295/80 R22.5', status: 'in_stock', purchaseCost: '21500.00', purchasedOn: addDays(today, -rng.int(5, 60)), expectedLifeKm: 90_000 });
  }

  // ------------------------------------------------------------- post everything in date order
  postings.sort((a, b) => a.date.localeCompare(b.date) || a.key.localeCompare(b.key));
  for (const p of postings) {
    const lines = p.lines.filter((l) => new Big(l.debit ?? 0).gt(0) || new Big(l.credit ?? 0).gt(0));
    const fmt = (v: Big | string | number | undefined) => (v === undefined ? '0.00' : money(v));
    if (!isBalanced(lines.map((l) => ({ debit: fmt(l.debit), credit: fmt(l.credit) })))) throw new Error(`Seed posting does not balance: ${p.memo}`);
    const [row] = await db
      .insert(s.journalEntries)
      .values({ orgId: o.orgId, entryNo: seq.take('JV', 'JV', new Date(`${p.date}T06:00:00Z`)), entryDate: p.date, memo: p.memo.slice(0, 255), sourceType: p.source, sourceId: p.sourceId, idempotencyKey: p.key, createdBy: accountant })
      .$returningId();
    await db.insert(s.journalLines).values(
      lines.map((l) => ({
        orgId: o.orgId,
        entryId: row!.id,
        accountId: accountId.get(l.account)!,
        debit: fmt(l.debit),
        credit: fmt(l.credit),
        tripId: l.tripId ?? null,
        vehicleId: l.vehicleId ?? null,
        customerId: l.customerId ?? null,
        vendorId: l.vendorId ?? null,
        workerId: l.workerId ?? null,
        memo: l.memo ?? null,
      })),
    );
    counts.journalEntries++;
    await p.link?.(row!.id);
  }
  await db.insert(s.numberSequences).values(seq.rows(o.orgId));
  return counts;
}
