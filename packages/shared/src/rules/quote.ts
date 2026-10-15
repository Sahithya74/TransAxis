import Big from 'big.js';
import type { RateBasis } from '../enums-ops.js';

export interface QuoteInput {
  rateBasis: RateBasis;
  rate: string | number;
  totalWeightKg: number;
  distanceKm: number | null;
  extraCharges?: { label: string; amount: string | number }[];
}

export interface QuoteLine {
  label: string;
  formula: string;
  amount: string;
}

export interface QuoteResult {
  /** Freight + extra charges, before tax, rounded to the rupee. */
  total: string;
  lines: QuoteLine[];
}

/**
 * Freight quotation from a rate card. Pure and explainable: every line says how it was computed.
 * Money uses Big.js decimals and is rounded half-up to whole rupees only at line level.
 */
export function computeQuote(q: QuoteInput): QuoteResult {
  const rate = new Big(q.rate);
  let freight: Big;
  let formula: string;
  switch (q.rateBasis) {
    case 'per_trip':
      freight = rate;
      formula = `Flat rate ₹${rate.toFixed(2)} per trip`;
      break;
    case 'per_tonne': {
      const tonnes = new Big(q.totalWeightKg).div(1000);
      freight = rate.times(tonnes);
      formula = `₹${rate.toFixed(2)}/t × ${tonnes.toFixed(3)} t`;
      break;
    }
    case 'per_km': {
      if (q.distanceKm === null) throw new Error('Distance is required for a per-km rate');
      freight = rate.times(q.distanceKm);
      formula = `₹${rate.toFixed(2)}/km × ${q.distanceKm} km`;
      break;
    }
  }
  const lines: QuoteLine[] = [{ label: 'Freight', formula, amount: freight.round(0, Big.roundHalfUp).toFixed(2) }];
  for (const c of q.extraCharges ?? []) {
    lines.push({ label: c.label, formula: 'Fixed charge', amount: new Big(c.amount).round(0, Big.roundHalfUp).toFixed(2) });
  }
  const total = lines.reduce((sum, l) => sum.plus(l.amount), new Big(0));
  return { total: total.toFixed(2), lines };
}
