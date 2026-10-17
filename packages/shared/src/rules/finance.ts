import Big from 'big.js';
import type { CompensationBasis } from '../enums-ops.js';
import { GST_RATE, type GstMode } from '../enums-finance.js';

const money = (v: Big | number | string) => new Big(v).round(2, Big.roundHalfUp);
const fmt = (v: Big | number | string) => money(v).toFixed(2);

// ------------------------------------------------------------------ GST

export interface InvoiceTax {
  taxable: string;
  rate: number;
  cgst: string;
  sgst: string;
  igst: string;
  /** Tax added to the invoice total (zero under reverse charge). */
  taxOnInvoice: string;
  /** Tax the customer must pay themselves under reverse charge (shown on the invoice). */
  reverseChargeTax: string;
  total: string;
}

/**
 * GST for a goods transport agency invoice. Intra-state supplies split the rate into CGST and SGST;
 * inter-state supplies use IGST. Under reverse charge the invoice carries no tax.
 */
export function computeInvoiceTax(taxableAmount: string | number, mode: GstMode, intraState: boolean): InvoiceTax {
  const taxable = money(taxableAmount);
  const rate = GST_RATE[mode];
  const tax = taxable.times(rate).div(100);
  const half = money(tax.div(2));
  const split = intraState ? { cgst: half, sgst: money(tax).minus(half), igst: new Big(0) } : { cgst: new Big(0), sgst: new Big(0), igst: money(tax) };
  const rcm = mode === 'rcm_5';
  const onInvoice = rcm ? new Big(0) : split.cgst.plus(split.sgst).plus(split.igst);
  return {
    taxable: fmt(taxable),
    rate,
    cgst: fmt(rcm ? 0 : split.cgst),
    sgst: fmt(rcm ? 0 : split.sgst),
    igst: fmt(rcm ? 0 : split.igst),
    taxOnInvoice: fmt(onInvoice),
    reverseChargeTax: fmt(rcm ? split.cgst.plus(split.sgst).plus(split.igst) : 0),
    total: fmt(taxable.plus(onInvoice)),
  };
}

/** GSTINs begin with the two-digit state code; same code means an intra-state supply. */
export const sameGstState = (a: string | null | undefined, b: string | null | undefined) => !!a && !!b && a.slice(0, 2) === b.slice(0, 2);

// ------------------------------------------------------------------ receivables

export const AGEING_BUCKETS = ['current', '1_30', '31_60', '61_90', '90_plus'] as const;
export type AgeingBucket = (typeof AGEING_BUCKETS)[number];

/** Days past the due date decide the bucket; not yet due is "current". Dates are YYYY-MM-DD. */
export function ageingBucket(dueDate: string, asOf: string): { bucket: AgeingBucket; daysOverdue: number } {
  const days = Math.round((Date.parse(`${asOf}T00:00:00Z`) - Date.parse(`${dueDate}T00:00:00Z`)) / 86_400_000);
  const bucket: AgeingBucket = days <= 0 ? 'current' : days <= 30 ? '1_30' : days <= 60 ? '31_60' : days <= 90 ? '61_90' : '90_plus';
  return { bucket, daysOverdue: Math.max(0, days) };
}

// ------------------------------------------------------------------ crew pay

export interface PayPolicy {
  basis: CompensationBasis;
  rate: string | number;
  dailyAllowance: string | number;
  onTimeBonus: string | number;
  minPerTrip: string | number | null;
}

export interface EarningLine {
  type: 'trip_pay' | 'daily_allowance' | 'on_time_bonus';
  label: string;
  formula: string;
  amount: string;
}

/**
 * Crew pay for one completed trip under a compensation policy. Rule-based and explainable: every
 * line states its formula. Salaried staff get only the daily allowance and bonus per trip.
 */
export function computeTripEarnings(i: { policy: PayPolicy; distanceKm: number; weightKg: number; freightAmount: string | number | null; tripDays: number; onTime: boolean }): { total: string; lines: EarningLine[] } {
  const p = i.policy;
  const rate = new Big(p.rate);
  const lines: EarningLine[] = [];
  let pay: Big | null = null;
  let formula = '';
  switch (p.basis) {
    case 'fixed_per_trip':
      pay = rate;
      formula = `Fixed ₹${fmt(rate)} per trip`;
      break;
    case 'per_km':
      pay = rate.times(i.distanceKm);
      formula = `₹${rate.toFixed(2)}/km × ${i.distanceKm} km`;
      break;
    case 'per_tonne': {
      const t = new Big(i.weightKg).div(1000);
      pay = rate.times(t);
      formula = `₹${rate.toFixed(2)}/t × ${t.toFixed(3)} t`;
      break;
    }
    case 'percent_of_freight':
      pay = rate.times(i.freightAmount ?? 0).div(100);
      formula = `${rate.toFixed(2)}% of freight ₹${fmt(i.freightAmount ?? 0)}`;
      break;
    case 'monthly_salary':
      pay = null; // paid through payroll, not per trip
      break;
  }
  if (pay !== null) {
    if (p.minPerTrip != null && pay.lt(p.minPerTrip)) {
      formula += `, raised to the minimum ₹${fmt(p.minPerTrip)}`;
      pay = new Big(p.minPerTrip);
    }
    lines.push({ type: 'trip_pay', label: 'Trip pay', formula, amount: fmt(pay) });
  }
  const da = new Big(p.dailyAllowance);
  if (da.gt(0) && i.tripDays > 0) lines.push({ type: 'daily_allowance', label: 'Daily allowance (bhatta)', formula: `₹${fmt(da)} × ${i.tripDays} day(s)`, amount: fmt(da.times(i.tripDays)) });
  const bonus = new Big(p.onTimeBonus);
  if (bonus.gt(0) && i.onTime) lines.push({ type: 'on_time_bonus', label: 'On-time delivery bonus', formula: 'Delivered by the planned time', amount: fmt(bonus) });
  return { total: fmt(lines.reduce((s, l) => s.plus(l.amount), new Big(0))), lines };
}

/** Calendar days a trip spanned (dispatch to completion), at least one. */
export const tripDays = (startIso: string, endIso: string, tz = 'Asia/Kolkata') => {
  const d = (iso: string) => new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date(iso));
  return Math.max(1, Math.round((Date.parse(`${d(endIso)}T00:00:00Z`) - Date.parse(`${d(startIso)}T00:00:00Z`)) / 86_400_000) + 1);
};

// ------------------------------------------------------------------ settlements

export interface SettlementInput {
  earnings: { id: number; amount: string }[];
  reimbursements: { id: number; amount: string }[];
  advances: { id: number; outstanding: string }[];
  deductions: { id: number; amount: string }[];
}

export interface SettlementResult {
  earnings: string;
  reimbursements: string;
  deductions: string;
  /** Advances recovered in this settlement (never more than what is owed). */
  advancesRecovered: string;
  /** Advance left to recover in a later settlement. */
  advanceCarriedForward: string;
  net: string;
  /** How much of each advance is recovered now. */
  recoveries: { id: number; amount: string }[];
}

/**
 * Net pay = earnings + approved reimbursements − deductions − advances. Advances are recovered oldest
 * first, only up to what is owed, so net pay is never negative; the rest carries forward.
 */
export function computeSettlement(i: SettlementInput): SettlementResult {
  const sum = (xs: { amount: string }[]) => xs.reduce((s, x) => s.plus(x.amount), new Big(0));
  const earnings = sum(i.earnings);
  const reimb = sum(i.reimbursements);
  const deductions = sum(i.deductions);
  let room = earnings.plus(reimb).minus(deductions);
  if (room.lt(0)) room = new Big(0);
  const recoveries: { id: number; amount: string }[] = [];
  let recovered = new Big(0);
  let carried = new Big(0);
  for (const a of i.advances) {
    const take = Big(a.outstanding).gt(room) ? room : new Big(a.outstanding);
    if (take.gt(0)) recoveries.push({ id: a.id, amount: fmt(take) });
    recovered = recovered.plus(take);
    room = room.minus(take);
    carried = carried.plus(new Big(a.outstanding).minus(take));
  }
  const net = earnings.plus(reimb).minus(deductions).minus(recovered);
  return {
    earnings: fmt(earnings),
    reimbursements: fmt(reimb),
    deductions: fmt(deductions),
    advancesRecovered: fmt(recovered),
    advanceCarriedForward: fmt(carried),
    net: fmt(net.lt(0) ? 0 : net),
    recoveries,
  };
}

// ------------------------------------------------------------------ fuel

export interface FuelCheckInput {
  litres: number;
  odometerKm: number;
  previousOdometerKm: number | null;
  /** Litres since the previous full tank (this fill included), for full-to-full mileage. */
  litresSinceFull: number | null;
  kmSinceFull: number | null;
  tankLitres: number | null;
  /** Typical mileage for the vehicle: its own history, else the declared figure. */
  typicalKmpl: number | null;
}

export interface FuelCheck {
  kmpl: number | null;
  anomalies: string[];
}

/** Mileage for a full-to-full fill and the reasons a fill looks wrong (pilferage, data errors). */
export function checkFuelFill(i: FuelCheckInput): FuelCheck {
  const anomalies: string[] = [];
  if (i.previousOdometerKm !== null && i.odometerKm < i.previousOdometerKm) anomalies.push(`Odometer ${i.odometerKm} km is below the previous fill’s ${i.previousOdometerKm} km`);
  if (i.tankLitres && i.litres > i.tankLitres * 1.05) anomalies.push(`${i.litres} L is more than the ${i.tankLitres} L tank`);
  let kmpl: number | null = null;
  if (i.kmSinceFull !== null && i.litresSinceFull && i.kmSinceFull > 0) {
    kmpl = Math.round((i.kmSinceFull / i.litresSinceFull) * 100) / 100;
    if (i.typicalKmpl) {
      if (kmpl < i.typicalKmpl * 0.75) anomalies.push(`Mileage ${kmpl} km/L is ${Math.round((1 - kmpl / i.typicalKmpl) * 100)}% below the usual ${i.typicalKmpl} km/L: check for pilferage or a leak`);
      else if (kmpl > i.typicalKmpl * 1.5) anomalies.push(`Mileage ${kmpl} km/L is implausibly high against the usual ${i.typicalKmpl} km/L: check the odometer reading or a missed fill`);
    }
  }
  return { kmpl, anomalies };
}

/** Median of a list (used for a vehicle's typical mileage). */
export function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : Math.round(((s[m - 1]! + s[m]!) / 2) * 100) / 100;
}

// ------------------------------------------------------------------ maintenance

export interface ServiceDue {
  status: 'ok' | 'due_soon' | 'overdue';
  nextKm: number | null;
  nextOn: string | null;
  kmLeft: number | null;
  daysLeft: number | null;
}

/** Whichever comes first, distance or time, decides when a scheduled service is due. */
export function serviceDue(i: { everyKm: number | null; everyDays: number | null; lastKm: number | null; lastOn: string | null; odometerKm: number; today: string; soonKm?: number; soonDays?: number }): ServiceDue {
  const soonKm = i.soonKm ?? 1000;
  const soonDays = i.soonDays ?? 7;
  const nextKm = i.everyKm ? (i.lastKm ?? 0) + i.everyKm : null;
  const nextOn = i.everyDays && i.lastOn ? new Date(Date.parse(`${i.lastOn}T00:00:00Z`) + i.everyDays * 86_400_000).toISOString().slice(0, 10) : null;
  const kmLeft = nextKm !== null ? Math.round(nextKm - i.odometerKm) : null;
  const daysLeft = nextOn ? Math.round((Date.parse(`${nextOn}T00:00:00Z`) - Date.parse(`${i.today}T00:00:00Z`)) / 86_400_000) : null;
  const overdue = (kmLeft !== null && kmLeft <= 0) || (daysLeft !== null && daysLeft <= 0);
  const soon = (kmLeft !== null && kmLeft <= soonKm) || (daysLeft !== null && daysLeft <= soonDays);
  return { status: overdue ? 'overdue' : soon ? 'due_soon' : 'ok', nextKm, nextOn, kmLeft, daysLeft };
}

// ------------------------------------------------------------------ journal balance

/** A journal entry must balance to the paisa. */
export function isBalanced(lines: { debit?: string | number; credit?: string | number }[]): boolean {
  const d = lines.reduce((s, l) => s.plus(l.debit ?? 0), new Big(0));
  const c = lines.reduce((s, l) => s.plus(l.credit ?? 0), new Big(0));
  return d.eq(c) && d.gt(0);
}
