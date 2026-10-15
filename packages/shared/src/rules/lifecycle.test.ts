import { describe, expect, it } from 'vitest';
import { availableBookingActions, checkBookingTransition } from './booking-state.js';
import { computeQuote } from './quote.js';
import { availableTripActions, bookingStatusForTrip, checkTripTransition } from './trip-state.js';
import { distanceToPolyline, haversineKm, pointAlong, polylineKm, type LatLng } from '../geo.js';

describe('trip state machine', () => {
  it('follows the happy path', () => {
    const path: [Parameters<typeof checkTripTransition>[1], string][] = [
      ['mark_ready', 'ready'],
      ['dispatch', 'in_transit'],
      ['deliver', 'delivered'],
      ['complete', 'completed'],
      ['reconcile', 'reconciled'],
      ['close', 'closed'],
    ];
    let status = 'planned' as Parameters<typeof checkTripTransition>[0];
    for (const [action, expected] of path) {
      const r = checkTripTransition(status, action);
      expect(r, `${action} from ${status}`).toMatchObject({ allowed: true, to: expected });
      status = r.to!;
    }
  });

  it('refuses skipping steps and acting on terminal trips', () => {
    expect(checkTripTransition('planned', 'dispatch').allowed).toBe(false);
    expect(checkTripTransition('in_transit', 'cancel').allowed).toBe(false);
    expect(checkTripTransition('closed', 'hold').allowed).toBe(false);
    expect(availableTripActions('cancelled')).toEqual([]);
    expect(availableTripActions('closed')).toEqual([]);
  });

  it('resumes to the status recorded before the hold', () => {
    expect(checkTripTransition('on_hold', 'resume', 'in_transit')).toMatchObject({ allowed: true, to: 'in_transit' });
    expect(checkTripTransition('on_hold', 'resume', null).allowed).toBe(false);
  });

  it('does not cancel a trip that was held mid-journey', () => {
    expect(checkTripTransition('on_hold', 'cancel', 'ready').allowed).toBe(true);
    expect(checkTripTransition('on_hold', 'cancel', 'in_transit').allowed).toBe(false);
  });

  it('maps trip status onto the booking', () => {
    expect(bookingStatusForTrip('ready')).toBe('planned');
    expect(bookingStatusForTrip('in_transit')).toBe('in_transit');
    expect(bookingStatusForTrip('completed')).toBe('delivered');
    expect(bookingStatusForTrip('cancelled')).toBe('approved');
    expect(bookingStatusForTrip('on_hold')).toBeNull();
  });
});

describe('booking state machine', () => {
  it('quotes, approves and cancels', () => {
    expect(checkBookingTransition('draft', 'quote')).toMatchObject({ allowed: true, to: 'quoted' });
    expect(checkBookingTransition('quoted', 'approve')).toMatchObject({ allowed: true, to: 'approved' });
    expect(checkBookingTransition('draft', 'approve').allowed).toBe(false);
    expect(checkBookingTransition('in_transit', 'cancel').allowed).toBe(false);
    expect(availableBookingActions('planned')).toEqual(['cancel']);
  });
});

describe('computeQuote', () => {
  it('prices per tonne with rupee rounding and explains the line', () => {
    const q = computeQuote({ rateBasis: 'per_tonne', rate: '1850.50', totalWeightKg: 12345, distanceKm: null, extraCharges: [{ label: 'Loading', amount: 1500 }] });
    // 1850.50 × 12.345 = 22844.42 → 22844
    expect(q.lines[0]).toMatchObject({ amount: '22844.00', formula: '₹1850.50/t × 12.345 t' });
    expect(q.total).toBe('24344.00');
  });

  it('prices per km and per trip', () => {
    expect(computeQuote({ rateBasis: 'per_km', rate: 48, totalWeightKg: 0, distanceKm: 346 }).total).toBe('16608.00');
    expect(computeQuote({ rateBasis: 'per_trip', rate: '42000', totalWeightKg: 0, distanceKm: null }).total).toBe('42000.00');
  });

  it('refuses a per-km quote without distance', () => {
    expect(() => computeQuote({ rateBasis: 'per_km', rate: 48, totalWeightKg: 0, distanceKm: null })).toThrow();
  });
});

describe('geo', () => {
  const chennai: LatLng = [13.0827, 80.2707];
  const bengaluru: LatLng = [12.9716, 77.5946];

  it('measures great-circle distance', () => {
    expect(haversineKm(chennai, bengaluru)).toBeGreaterThan(285);
    expect(haversineKm(chennai, bengaluru)).toBeLessThan(295);
  });

  it('walks along a polyline', () => {
    const line: LatLng[] = [chennai, [12.9165, 79.1325], bengaluru];
    expect(pointAlong(line, 0).point).toEqual(chennai);
    expect(pointAlong(line, 1).point).toEqual(bengaluru);
    const mid = pointAlong(line, 0.5);
    expect(haversineKm(line[0]!, mid.point)).toBeCloseTo(polylineKm(line) / 2, 0);
  });

  it('measures off-route distance', () => {
    const line: LatLng[] = [chennai, bengaluru];
    expect(distanceToPolyline(chennai, line).distanceKm).toBeLessThan(0.01);
    const off = distanceToPolyline([13.6, 79.0], line);
    expect(off.distanceKm).toBeGreaterThan(50);
  });
});
