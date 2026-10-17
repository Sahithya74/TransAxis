import { describe, expect, it } from 'vitest';
import { ageingBucket, checkFuelFill, computeInvoiceTax, computeSettlement, computeTripEarnings, isBalanced, median, sameGstState, serviceDue, tripDays } from './finance.js';

describe('GST on freight invoices', () => {
  it('splits intra-state forward-charge GST into CGST and SGST', () => {
    expect(computeInvoiceTax('40700', 'forward_12', true)).toEqual({
      taxable: '40700.00',
      rate: 12,
      cgst: '2442.00',
      sgst: '2442.00',
      igst: '0.00',
      taxOnInvoice: '4884.00',
      reverseChargeTax: '0.00',
      total: '45584.00',
    });
  });

  it('uses IGST across states and keeps paise exact', () => {
    const t = computeInvoiceTax('10000.55', 'forward_5', false);
    expect(t).toMatchObject({ igst: '500.03', cgst: '0.00', total: '10500.58' });
  });

  it('charges no tax on the invoice under reverse charge but states the customer’s liability', () => {
    expect(computeInvoiceTax('20000', 'rcm_5', true)).toMatchObject({ taxOnInvoice: '0.00', reverseChargeTax: '1000.00', total: '20000.00', cgst: '0.00' });
  });

  it('detects intra-state supplies from GSTIN state codes', () => {
    expect(sameGstState('33AAKCK4821M1Z5', '33TLWAL3360D4ZY')).toBe(true);
    expect(sameGstState('33AAKCK4821M1Z5', '29ECVQU6640J1Z0')).toBe(false);
    expect(sameGstState('33AAKCK4821M1Z5', null)).toBe(false);
  });
});

describe('receivables ageing', () => {
  it('buckets by days past due', () => {
    expect(ageingBucket('2026-10-20', '2026-10-15')).toEqual({ bucket: 'current', daysOverdue: 0 });
    expect(ageingBucket('2026-10-15', '2026-10-15').bucket).toBe('current');
    expect(ageingBucket('2026-09-30', '2026-10-15')).toEqual({ bucket: '1_30', daysOverdue: 15 });
    expect(ageingBucket('2026-08-01', '2026-10-15').bucket).toBe('61_90');
    expect(ageingBucket('2026-01-01', '2026-10-15').bucket).toBe('90_plus');
  });
});

describe('crew pay', () => {
  const base = { distanceKm: 346, weightKg: 12500, freightAmount: '40000', tripDays: 2, onTime: true };
  it('explains a per-km policy with allowance and bonus', () => {
    const r = computeTripEarnings({ ...base, policy: { basis: 'per_km', rate: '3.5', dailyAllowance: '400', onTimeBonus: '250', minPerTrip: null } });
    expect(r.lines).toEqual([
      { type: 'trip_pay', label: 'Trip pay', formula: '₹3.50/km × 346 km', amount: '1211.00' },
      { type: 'daily_allowance', label: 'Daily allowance (bhatta)', formula: '₹400.00 × 2 day(s)', amount: '800.00' },
      { type: 'on_time_bonus', label: 'On-time delivery bonus', formula: 'Delivered by the planned time', amount: '250.00' },
    ]);
    expect(r.total).toBe('2261.00');
  });

  it('applies the minimum per trip and skips the bonus when late', () => {
    const r = computeTripEarnings({ ...base, onTime: false, policy: { basis: 'per_tonne', rate: '50', dailyAllowance: '0', onTimeBonus: '300', minPerTrip: '1000' } });
    expect(r.lines).toHaveLength(1);
    expect(r.lines[0]).toMatchObject({ amount: '1000.00' });
    expect(r.lines[0]!.formula).toContain('raised to the minimum');
  });

  it('pays salaried staff only allowances per trip', () => {
    const r = computeTripEarnings({ ...base, policy: { basis: 'monthly_salary', rate: '18000', dailyAllowance: '300', onTimeBonus: '0', minPerTrip: null } });
    expect(r.lines.map((l) => l.type)).toEqual(['daily_allowance']);
    expect(r.total).toBe('600.00');
  });

  it('counts trip days in the organisation timezone', () => {
    expect(tripDays('2026-10-15T15:00:00Z', '2026-10-15T20:00:00Z')).toBe(2); // 20:30 IST to 01:30 IST next day
    expect(tripDays('2026-10-15T03:00:00Z', '2026-10-15T10:00:00Z')).toBe(1);
  });
});

describe('settlements', () => {
  it('nets earnings and reimbursements against deductions and advances', () => {
    const r = computeSettlement({
      earnings: [{ id: 1, amount: '2261.00' }, { id: 2, amount: '1800.00' }],
      reimbursements: [{ id: 7, amount: '450.00' }],
      advances: [{ id: 3, outstanding: '2000.00' }],
      deductions: [{ id: 4, amount: '150.00' }],
    });
    expect(r).toMatchObject({ earnings: '4061.00', reimbursements: '450.00', deductions: '150.00', advancesRecovered: '2000.00', advanceCarriedForward: '0.00', net: '2361.00' });
  });

  it('never pays a negative amount and carries the remaining advance forward', () => {
    const r = computeSettlement({
      earnings: [{ id: 1, amount: '1000.00' }],
      reimbursements: [],
      advances: [{ id: 3, outstanding: '700.00' }, { id: 5, outstanding: '900.00' }],
      deductions: [],
    });
    expect(r).toMatchObject({ advancesRecovered: '1000.00', advanceCarriedForward: '600.00', net: '0.00' });
    expect(r.recoveries).toEqual([{ id: 3, amount: '700.00' }, { id: 5, amount: '300.00' }]);
  });
});

describe('fuel checks', () => {
  const fill = { litres: 180, odometerKm: 120_600, previousOdometerKm: 120_000, litresSinceFull: 180, kmSinceFull: 600, tankLitres: 300, typicalKmpl: 4.2 };
  it('computes full-to-full mileage and flags pilferage', () => {
    const r = checkFuelFill(fill);
    expect(r.kmpl).toBe(3.33);
    expect(r.anomalies).toEqual([]);
    const low = checkFuelFill({ ...fill, kmSinceFull: 400 });
    expect(low.kmpl).toBe(2.22);
    expect(low.anomalies[0]).toMatch(/below the usual/);
  });

  it('flags impossible data', () => {
    const r = checkFuelFill({ ...fill, litres: 350, odometerKm: 119_000, kmSinceFull: null });
    expect(r.anomalies).toHaveLength(2);
    expect(r.kmpl).toBeNull();
  });

  it('takes the median of past mileage', () => {
    expect(median([4.1, 3.9, 4.4, 2.0])).toBe(4);
    expect(median([])).toBeNull();
  });
});

describe('service schedules', () => {
  it('is due by whichever of distance or time comes first', () => {
    expect(serviceDue({ everyKm: 15000, everyDays: 180, lastKm: 100_000, lastOn: '2026-06-01', odometerKm: 114_500, today: '2026-10-15' })).toMatchObject({ status: 'due_soon', kmLeft: 500 });
    expect(serviceDue({ everyKm: 15000, everyDays: 90, lastKm: 100_000, lastOn: '2026-06-01', odometerKm: 101_000, today: '2026-10-15' })).toMatchObject({ status: 'overdue', nextOn: '2026-08-30' });
    expect(serviceDue({ everyKm: 15000, everyDays: null, lastKm: 100_000, lastOn: null, odometerKm: 101_000, today: '2026-10-15' }).status).toBe('ok');
  });
});

describe('journal balance', () => {
  it('requires equal, non-zero debits and credits', () => {
    expect(isBalanced([{ debit: '100.10' }, { credit: '60.05' }, { credit: '40.05' }])).toBe(true);
    expect(isBalanced([{ debit: '100' }, { credit: '99.99' }])).toBe(false);
    expect(isBalanced([{ debit: 0 }, { credit: 0 }])).toBe(false);
  });
});
