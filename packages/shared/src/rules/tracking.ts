import type { AlertSeverity, AlertType } from '../enums-live.js';
import { distanceToPolyline, haversineKm, type LatLng } from '../geo.js';

export interface Fix {
  lat: number;
  lng: number;
  speedKmph: number;
  recordedAt: string;
}

export interface TrackingThresholds {
  /** No fix for this long raises "no GPS signal" (minutes). */
  staleMin: number;
  /** Standing still this long away from a known place is an unplanned stop (minutes). */
  stopMin: number;
  stopSpeedKmph: number;
  /** Within this distance of a stop, depot or fuel station, standing still is expected (km). */
  stopRadiusKm: number;
  /** Further than this from the planned route is a deviation (km). */
  deviationKm: number;
  /** Speed limit used for loaded trucks (km/h). */
  maxKmph: number;
  /** Raise "running late" once the ETA is this far past the planned arrival (minutes). */
  lateMin: number;
}

export const DEFAULT_TRACKING_THRESHOLDS: TrackingThresholds = {
  staleMin: 10,
  stopMin: 15,
  stopSpeedKmph: 3,
  stopRadiusKm: 2,
  deviationKm: 5,
  maxKmph: 80,
  lateMin: 60,
};

export interface TripTrackingInput {
  now: Date;
  /** Recent fixes for the trip, newest first, covering at least the last `stopMin` minutes. */
  fixes: Fix[];
  /** Planned route as [lat, lng] waypoints, when the trip has one. */
  route: LatLng[] | null;
  /** Places where standing still is expected: the trip's stops, depots, fuel stations. */
  knownPlaces: LatLng[];
  restrictedZones: { name: string; center: LatLng; radiusKm: number }[];
  /** From the ETA; null when unknown. */
  lateByMin: number | null;
  dispatchedAt: string;
}

export interface Condition {
  /** Stable identity used to de-duplicate alerts (one open alert per trip and key). */
  key: string;
  type: AlertType;
  severity: AlertSeverity;
  title: string;
  detail: string;
  at: LatLng | null;
}

export const formatMinutes = (min: number) => (min < 60 ? `${Math.round(min)} min` : `${Math.floor(min / 60)} h${Math.round(min % 60) ? ` ${Math.round(min % 60)} min` : ''}`);

/**
 * Which alert conditions hold for a trip right now. Pure: the caller raises alerts for new
 * conditions and resolves open alerts whose condition no longer holds.
 */
export function evaluateTracking(i: TripTrackingInput, t: TrackingThresholds = DEFAULT_TRACKING_THRESHOLDS): Condition[] {
  const last = i.fixes[0];
  const sinceMin = (iso: string) => (i.now.getTime() - Date.parse(iso)) / 60_000;
  const ageMin = sinceMin(last?.recordedAt ?? i.dispatchedAt);
  if (ageMin > t.staleMin) {
    return [
      {
        key: 'gps_stale',
        type: 'gps_stale',
        severity: 'warning',
        title: 'No GPS signal',
        detail: last ? `Last position ${formatMinutes(ageMin)} ago.` : `No position received in the ${formatMinutes(ageMin)} since dispatch.`,
        at: last ? [last.lat, last.lng] : null,
      },
    ];
  }
  if (!last) return [];

  const out: Condition[] = [];
  const here: LatLng = [last.lat, last.lng];

  const windowStart = Date.parse(last.recordedAt) - t.stopMin * 60_000;
  const recent = i.fixes.filter((f) => Date.parse(f.recordedAt) >= windowStart);
  const oldest = recent[recent.length - 1]!;
  const spanMin = (Date.parse(last.recordedAt) - Date.parse(oldest.recordedAt)) / 60_000;
  const still =
    recent.length >= 3 &&
    spanMin >= t.stopMin * 0.9 &&
    recent.every((f) => f.speedKmph < t.stopSpeedKmph && haversineKm([f.lat, f.lng], here) < 0.3);
  if (still && !i.knownPlaces.some((p) => haversineKm(p, here) <= t.stopRadiusKm)) {
    out.push({ key: 'unexpected_stop', type: 'unexpected_stop', severity: 'warning', title: 'Unplanned stop', detail: `Stationary for ${formatMinutes(spanMin)} away from any stop or depot.`, at: here });
  }

  if (i.route && i.route.length > 1) {
    const off = distanceToPolyline(here, i.route).distanceKm;
    if (off > t.deviationKm) {
      out.push({ key: 'route_deviation', type: 'route_deviation', severity: 'critical', title: 'Off the planned route', detail: `${off.toFixed(1)} km from the planned route.`, at: here });
    }
  }

  if (last.speedKmph > t.maxKmph) {
    out.push({ key: 'overspeed', type: 'overspeed', severity: 'warning', title: 'Overspeeding', detail: `${Math.round(last.speedKmph)} km/h; the limit for loaded trucks is ${t.maxKmph} km/h.`, at: here });
  }

  for (const z of i.restrictedZones) {
    if (haversineKm(z.center, here) <= z.radiusKm) {
      out.push({ key: `geofence:${z.name}`, type: 'geofence_breach', severity: 'critical', title: `Entered restricted zone: ${z.name}`, detail: 'The vehicle is inside a zone it must avoid.', at: here });
    }
  }

  if (i.lateByMin !== null && i.lateByMin > t.lateMin) {
    out.push({ key: 'late_arrival', type: 'late_arrival', severity: 'warning', title: 'Running late', detail: `Expected about ${formatMinutes(i.lateByMin)} after the planned arrival.`, at: here });
  }
  return out;
}
