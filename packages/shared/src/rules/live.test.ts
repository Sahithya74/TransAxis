import { describe, expect, it } from 'vitest';
import type { LatLng } from '../geo.js';
import { estimateEta } from './eta.js';
import { scenarioFor, simulateFix, straightPath } from './simulation.js';
import { evaluateTracking, type Fix } from './tracking.js';

const NOW = new Date('2026-10-15T10:00:00Z');
const minsAgo = (m: number) => new Date(NOW.getTime() - m * 60_000).toISOString();
const ROUTE: LatLng[] = [
  [13.0827, 80.2707],
  [12.9165, 79.1325],
  [12.9716, 77.5946],
];

describe('ETA strategy chain', () => {
  const base = { now: NOW, plannedEnd: '2026-10-15T16:00:00Z', remainingKm: 210, fixAgeMin: 1, historicalKmph: null, historicalSamples: 0, remainingStops: 1, drivenHours: 1 };

  it('uses route history when there are enough past trips', () => {
    const e = estimateEta({ ...base, historicalKmph: 52.5, historicalSamples: 12 });
    expect(e.method).toBe('historical');
    expect(e.confidence).toBe('high');
    // 210 km / 52.5 km/h = 4 h, + 45 min dwell, + one 30-min rest (passes 4.5 h of driving).
    expect(e.eta).toBe('2026-10-15T15:15:00.000Z');
    expect(e.lateByMin).toBe(0);
    expect(e.basisNote).toContain('12 past trips');
  });

  it('falls back to a standard speed without enough history', () => {
    const e = estimateEta({ ...base, historicalKmph: 60, historicalSamples: 2 });
    expect(e.method).toBe('fallback');
    expect(e.confidence).toBe('low');
    expect(e.basisNote).toContain('not enough route history');
  });

  it('uses the planned schedule, flagged as low confidence, when there is no GPS fix', () => {
    const e = estimateEta({ ...base, remainingKm: null, fixAgeMin: null });
    expect(e).toMatchObject({ method: 'schedule', confidence: 'low', eta: base.plannedEnd, remainingKm: null });
    expect(e.basisNote).toMatch(/No GPS position/);
  });

  it('reports how late a trip will be and lowers confidence for an old fix', () => {
    const e = estimateEta({ ...base, plannedEnd: '2026-10-15T11:00:00Z', fixAgeMin: 40, historicalKmph: 50, historicalSamples: 20 });
    expect(e.lateByMin).toBeGreaterThan(200);
    expect(e.confidence).toBe('low');
    expect(e.basisNote).toContain('40 min old');
  });

  it('prefers a routing provider when one answers', () => {
    expect(estimateEta({ ...base, provider: { eta: '2026-10-15T14:00:00Z', note: 'Live traffic' } }).method).toBe('provider');
  });
});

describe('tracking evaluation', () => {
  const moving = (n: number, kmph = 45): Fix[] =>
    Array.from({ length: n }, (_, i) => ({ lat: 12.95 - i * 0.004, lng: 79.4 - i * 0.004, speedKmph: kmph, recordedAt: minsAgo(i) }));
  const input = { now: NOW, route: ROUTE, knownPlaces: [ROUTE[0]!, ROUTE[2]!], restrictedZones: [], lateByMin: 0, dispatchedAt: minsAgo(120) };

  it('raises nothing for a vehicle moving normally near its route', () => {
    expect(evaluateTracking({ ...input, fixes: [{ lat: 12.92, lng: 79.13, speedKmph: 45, recordedAt: minsAgo(0) }, ...moving(5).slice(1)] })).toEqual([]);
  });

  it('flags a missing signal and skips the other checks', () => {
    const c = evaluateTracking({ ...input, fixes: [{ lat: 12.92, lng: 79.13, speedKmph: 45, recordedAt: minsAgo(25) }] });
    expect(c.map((x) => x.type)).toEqual(['gps_stale']);
    expect(c[0]!.detail).toContain('25 min');
  });

  it('flags a trip that never reported a position', () => {
    expect(evaluateTracking({ ...input, fixes: [] }).map((x) => x.type)).toEqual(['gps_stale']);
  });

  it('flags standing still away from known places, but not at a stop', () => {
    const still = (lat: number, lng: number): Fix[] => Array.from({ length: 17 }, (_, i) => ({ lat, lng, speedKmph: 0, recordedAt: minsAgo(i) }));
    expect(evaluateTracking({ ...input, fixes: still(12.9165, 79.1325) }).map((x) => x.type)).toContain('unexpected_stop');
    expect(evaluateTracking({ ...input, fixes: still(13.0827, 80.2707) }).map((x) => x.type)).not.toContain('unexpected_stop');
  });

  it('does not call a short pause a stop', () => {
    const fixes = [...Array.from({ length: 5 }, (_, i) => ({ lat: 12.9165, lng: 79.1325, speedKmph: 0, recordedAt: minsAgo(i) })), ...moving(10).map((f, i) => ({ ...f, recordedAt: minsAgo(5 + i) }))];
    expect(evaluateTracking({ ...input, fixes }).map((x) => x.type)).not.toContain('unexpected_stop');
  });

  it('flags deviation, overspeed, restricted zones and lateness', () => {
    const far: Fix = { lat: 13.6, lng: 79.4, speedKmph: 92, recordedAt: minsAgo(0) };
    const c = evaluateTracking({ ...input, fixes: [far], restrictedZones: [{ name: 'Forest checkpost', center: [13.6, 79.4], radiusKm: 2 }], lateByMin: 95 });
    expect(c.map((x) => x.type).sort()).toEqual(['geofence_breach', 'late_arrival', 'overspeed', 'route_deviation']);
    expect(c.find((x) => x.type === 'route_deviation')!.severity).toBe('critical');
    expect(c.find((x) => x.type === 'late_arrival')!.detail).toContain('1 h 35 min');
    expect(c.find((x) => x.type === 'geofence_breach')!.key).toBe('geofence:Forest checkpost');
  });
});

describe('GPS simulation', () => {
  const trip = (id: number) => ({ id, dispatchedAt: NOW.getTime(), durationMin: 600, path: ROUTE });
  const at = (id: number, fraction: number) => simulateFix(trip(id), NOW.getTime() + fraction * 600 * 60_000);

  it('is deterministic and ends at the destination', () => {
    expect(at(10, 0.3)).toEqual(at(10, 0.3));
    const end = at(10, 1)!;
    expect(end.arrived).toBe(true);
    expect(end.speedKmph).toBe(0);
    expect([end.lat, end.lng]).toEqual(ROUTE[2]);
  });

  it('plays the scripted scenarios', () => {
    const ids = { stop: 1, detour: 2, gap: 3, speeding: 4 };
    expect(scenarioFor(ids.stop)).toBe('unplanned_stop');
    const a = at(ids.stop, 0.37)!;
    const b = at(ids.stop, 0.43)!;
    expect([a.lat, a.lng]).toEqual([b.lat, b.lng]);
    expect(b.speedKmph).toBe(0);
    expect(at(ids.gap, 0.64)).toBeNull();
    expect(at(ids.speeding, 0.23)!.speedKmph).toBeGreaterThan(80);
    expect(at(ids.detour, 0.55)!.progress).toBeCloseTo(0.55, 5);
  });

  it('interpolates a straight path for trips without a route', () => {
    const p = straightPath([13, 80], [12, 78], 5);
    expect(p).toHaveLength(5);
    expect(p[2]).toEqual([12.5, 79]);
  });
});

describe('simulated journey length', () => {
  it('follows the plan within a believable range of the route time', async () => {
    const { simDurationMin } = await import('./simulation.js');
    expect(simDurationMin(500, 480)).toBe(500);
    expect(simDurationMin(60, 480)).toBe(432); // a 1-hour plan for an 8-hour route runs late
    expect(simDurationMin(2000, 480)).toBe(768); // a slack plan arrives early and waits
    expect(simDurationMin(300, null)).toBe(300);
  });
});
