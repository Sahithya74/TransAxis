import { describe, expect, it } from 'vitest';
import { bookingInputSchema } from './bookings.js';
import { customerCreateSchema } from './parties.js';
import { podOtpSchema, tripCreateSchema } from './trips.js';
import { licenceInputSchema, workerCreateSchema, workerUpdateSchema } from './workers.js';

const stop = (stopType: 'pickup' | 'drop' | 'via', city: string) => ({ stopType, name: `${city} site`, city });
const booking = {
  customerId: 1,
  loadingWindowStart: '2026-10-20T03:30:00Z',
  deliveryDeadline: '2026-10-21T12:00:00Z',
  stops: [stop('pickup', 'Chennai'), stop('drop', 'Bengaluru')],
  cargo: [{ description: 'Cement bags', quantity: 400, unit: 'bags', weightKg: 20000 }],
};
const paths = (r: { success: boolean; error?: { issues: { path: PropertyKey[] }[] } }) =>
  r.error?.issues.map((i) => i.path.join('.')) ?? [];

describe('bookingInputSchema', () => {
  it('accepts a minimal valid booking and applies defaults', () => {
    const r = bookingInputSchema.parse(booking);
    expect(r.cargo[0]!.category).toBe('general');
    expect(r.charges).toEqual([]);
  });

  it('requires a pickup first and a drop last', () => {
    const r = bookingInputSchema.safeParse({ ...booking, stops: [stop('drop', 'Chennai'), stop('pickup', 'Bengaluru')] });
    expect(paths(r)).toEqual(expect.arrayContaining(['stops.0.stopType', 'stops.1.stopType']));
  });

  it('rejects a deadline before loading and a half-specified rate', () => {
    const r = bookingInputSchema.safeParse({ ...booking, deliveryDeadline: '2026-10-19T00:00:00Z', rateBasis: 'per_tonne' });
    expect(paths(r)).toEqual(expect.arrayContaining(['deliveryDeadline', 'rate']));
  });

  it('validates e-way bill numbers and cargo weight', () => {
    const r = bookingInputSchema.safeParse({ ...booking, ewayBillNo: '12345', cargo: [{ ...booking.cargo[0], weightKg: 0 }] });
    expect(paths(r)).toEqual(expect.arrayContaining(['ewayBillNo', 'cargo.0.weightKg']));
  });
});

describe('tripCreateSchema', () => {
  const base = { vehicleId: 1, driverId: 2, plannedStart: '2026-10-20T03:30:00Z', plannedEnd: '2026-10-20T15:30:00Z' };
  it('requires a booking for loaded trips and cities for empty trips', () => {
    expect(paths(tripCreateSchema.safeParse(base))).toContain('bookingId');
    expect(paths(tripCreateSchema.safeParse({ ...base, tripType: 'empty' }))).toContain('originCity');
    expect(tripCreateSchema.safeParse({ ...base, tripType: 'empty', originCity: 'Bengaluru', destinationCity: 'Chennai' }).success).toBe(true);
  });

  it('demands a real explanation for overrides', () => {
    expect(paths(tripCreateSchema.safeParse({ ...base, bookingId: 1, overrideReason: 'ok' }))).toContain('overrideReason');
    expect(tripCreateSchema.parse({ ...base, bookingId: 1, overrideReason: '' }).overrideReason).toBeUndefined();
  });
});

describe('workforce and party schemas', () => {
  it('normalises worker codes and keeps updates free of defaults', () => {
    expect(workerCreateSchema.parse({ employeeCode: 'drv-001', workerType: 'driver', fullName: 'Murugan S', phone: '+91 98400 11007' }).employeeCode).toBe('DRV-001');
    expect(workerUpdateSchema.parse({ phone: '9840011007' })).toEqual({ phone: '9840011007' });
  });

  it('needs at least one licence class and a sane validity', () => {
    expect(paths(licenceInputSchema.safeParse({ licenceNo: 'TN0120150012345', validUntil: '2030-01-01', classes: [] }))).toContain('classes');
    expect(paths(licenceInputSchema.safeParse({ licenceNo: 'TN0120150012345', issuedOn: '2031-01-01', validUntil: '2030-01-01', classes: ['HGMV'] }))).toContain('validUntil');
  });

  it('validates GSTIN format and treats blanks as empty', () => {
    expect(paths(customerCreateSchema.safeParse({ code: 'CUST1', name: 'Test Co', gstin: '33ABCDE1234F1Z' }))).toContain('gstin');
    expect(customerCreateSchema.parse({ code: 'cust1', name: 'Test Co', gstin: '33aakck4821m1z5', pan: '' })).toMatchObject({ code: 'CUST1', gstin: '33AAKCK4821M1Z5', pan: null });
  });

  it('requires a 6-digit OTP for proof of delivery', () => {
    expect(podOtpSchema.safeParse({ otp: '12345', recipientName: 'Store manager' }).success).toBe(false);
    expect(podOtpSchema.safeParse({ otp: '123456', recipientName: 'Store manager' }).success).toBe(true);
  });
});
