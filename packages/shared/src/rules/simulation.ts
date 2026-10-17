import { haversineKm, pointAlong, polylineKm, type LatLng } from '../geo.js';

/**
 * Demo GPS simulation. A simulated vehicle's position is a pure function of time since dispatch, so
 * restarts never make it jump. Some trips follow a scripted scenario so every alert type can be seen
 * in the demo; all simulated data is labelled SIMULATED in the UI.
 */
export const SIM_SCENARIOS = ['normal', 'unplanned_stop', 'detour', 'gps_gap', 'speeding'] as const;
export type SimScenario = (typeof SIM_SCENARIOS)[number];

export const scenarioFor = (tripId: number): SimScenario => SIM_SCENARIOS[tripId % SIM_SCENARIOS.length]!;

/**
 * Journey time the simulator plays for a trip: the trip's own planned duration, kept within a believable
 * range of the route's driving time (an unrealistic plan simply makes the truck early or late).
 */
export function simDurationMin(plannedMin: number, routeMin: number | null): number {
  if (!routeMin) return plannedMin > 30 ? plannedMin : 600;
  return Math.min(routeMin * 1.6, Math.max(routeMin * 0.9, plannedMin));
}

/** Fractions of the journey (by time) where scripted behaviour happens. */
const STOP = [0.35, 0.45] as const;
const DETOUR = [0.5, 0.6] as const;
const GAP = [0.6, 0.68] as const;
const SPEEDING = [0.2, 0.26] as const;
const DETOUR_KM = 9;

export interface SimTrip {
  id: number;
  dispatchedAt: number;
  /** Expected journey time in minutes (route duration plus breaks). */
  durationMin: number;
  path: LatLng[];
}

export interface SimFix {
  lat: number;
  lng: number;
  speedKmph: number;
  headingDeg: number;
  /** 0..1 share of the route covered. */
  progress: number;
  arrived: boolean;
}

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const inside = (p: number, [a, b]: readonly [number, number]) => p > a && p < b;

/** Share of the route covered at time-fraction `p`. An unplanned stop freezes it, then catches up. */
function covered(s: SimScenario, p: number): number {
  if (s !== 'unplanned_stop') return p;
  if (p <= STOP[0]) return p;
  if (p <= STOP[1]) return STOP[0];
  return STOP[0] + (p - STOP[1]) * ((1 - STOP[0]) / (1 - STOP[1]));
}

/** Small deterministic wobble so speeds look like real traffic rather than a constant. */
const wobble = (t: number, id: number) => 1 + 0.12 * Math.sin(t / 97_000 + id) + 0.05 * Math.sin(t / 13_000 + id * 3);

/** Where a simulated vehicle is at `now`, or null during a scripted signal gap. */
export function simulateFix(trip: SimTrip, now: number): SimFix | null {
  if (trip.path.length < 2) return null;
  const s = scenarioFor(trip.id);
  const span = trip.durationMin * 60_000;
  const p = clamp01((now - trip.dispatchedAt) / span);
  if (s === 'gps_gap' && inside(p, GAP)) return null;

  const m = covered(s, p);
  const { point, headingDeg } = pointAlong(trip.path, m);
  let [lat, lng] = point;
  if (s === 'detour' && inside(p, DETOUR)) {
    const away = Math.sin((Math.PI * (p - DETOUR[0])) / (DETOUR[1] - DETOUR[0])) * DETOUR_KM;
    const side = ((headingDeg + 90) * Math.PI) / 180;
    lat += (away / 110.574) * Math.cos(side);
    lng += (away / (111.32 * Math.cos((lat * Math.PI) / 180))) * Math.sin(side);
  }

  const totalKm = polylineKm(trip.path);
  const ahead = covered(s, clamp01(p + 60_000 / span));
  let speed = m >= 1 ? 0 : ((ahead - m) * totalKm) / (1 / 60);
  if (speed > 0) speed *= wobble(now, trip.id);
  if (s === 'speeding' && inside(p, SPEEDING)) speed = 86 + 4 * Math.sin(now / 20_000);
  return { lat, lng, speedKmph: Math.round(speed * 10) / 10, headingDeg: Math.round(headingDeg), progress: m, arrived: m >= 1 };
}

/** A straight path with intermediate points, for trips without a saved route. */
export function straightPath(a: LatLng, b: LatLng, points = 12): LatLng[] {
  return Array.from({ length: points }, (_, i) => [a[0] + ((b[0] - a[0]) * i) / (points - 1), a[1] + ((b[1] - a[1]) * i) / (points - 1)] as LatLng);
}

/** Road distance still to go, given how much of the path is covered (planned distance when known). */
export const remainingKm = (path: LatLng[], progress: number, plannedKm: number | null) =>
  Math.max(0, (plannedKm ?? polylineKm(path) * 1.2) * (1 - progress));

export const nearestKm = (p: LatLng, places: LatLng[]) => Math.min(...places.map((q) => haversineKm(p, q)));
