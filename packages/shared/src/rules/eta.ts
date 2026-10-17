import type { EtaMethod } from '../enums-live.js';

export interface EtaDto {
  /** ISO instant, or null when it cannot be estimated at all. */
  eta: string | null;
  method: EtaMethod;
  confidence: 'high' | 'medium' | 'low';
  /** Plain-language explanation shown next to the ETA. */
  basisNote: string;
  remainingKm: number | null;
  /** Minutes past the planned end (0 when on time). */
  lateByMin: number;
}

export interface EtaSettings {
  /** Average loaded-truck speed used when there is no route history (km/h). */
  fallbackKmph: number;
  /** Completed trips on the same route needed before history is trusted. */
  minHistorySamples: number;
  /** Time spent at each remaining stop (minutes). */
  dwellMin: number;
  /** Mandatory rest after this many hours of driving, and how long it lasts. */
  restEveryHours: number;
  restMin: number;
  /** A fix older than this lowers confidence (minutes). */
  staleFixMin: number;
}

export const DEFAULT_ETA_SETTINGS: EtaSettings = {
  fallbackKmph: 42,
  minHistorySamples: 3,
  dwellMin: 45,
  restEveryHours: 4.5,
  restMin: 30,
  staleFixMin: 15,
};

export interface EtaInput {
  now: Date;
  plannedEnd: string;
  /** Road distance still to cover; null without a GPS fix. */
  remainingKm: number | null;
  /** Age of the latest fix in minutes; null when there is none. */
  fixAgeMin: number | null;
  /** Average speed of completed trips on the same route, and how many trips it is based on. */
  historicalKmph: number | null;
  historicalSamples: number;
  remainingStops: number;
  /** Hours driven since dispatch, for working out mandatory rests. */
  drivenHours: number;
  /** A routing/traffic provider's answer, when one is configured (future integration). */
  provider?: { eta: string; note: string } | null;
}

const lateBy = (eta: number, plannedEnd: string) => Math.max(0, Math.round((eta - Date.parse(plannedEnd)) / 60_000));

/**
 * ETA strategy chain: (1) routing provider, (2) this route's historical speed, (3) a configured
 * average speed. Each adds dwell time at remaining stops and mandatory rests. Without a usable fix
 * it falls back to the planned schedule and says so.
 */
export function estimateEta(i: EtaInput, s: EtaSettings = DEFAULT_ETA_SETTINGS): EtaDto {
  if (i.provider) {
    return { eta: i.provider.eta, method: 'provider', confidence: 'high', basisNote: i.provider.note, remainingKm: i.remainingKm, lateByMin: lateBy(Date.parse(i.provider.eta), i.plannedEnd) };
  }
  if (i.remainingKm === null || i.fixAgeMin === null) {
    return {
      eta: i.plannedEnd,
      method: 'schedule',
      confidence: 'low',
      basisNote: 'No GPS position yet, so this is the planned arrival time.',
      remainingKm: null,
      lateByMin: lateBy(Math.max(Date.parse(i.plannedEnd), i.now.getTime()), i.plannedEnd),
    };
  }

  const useHistory = i.historicalKmph !== null && i.historicalKmph > 5 && i.historicalSamples >= s.minHistorySamples;
  const kmph = useHistory ? i.historicalKmph! : s.fallbackKmph;
  const driveMin = (i.remainingKm / kmph) * 60;
  const dwell = i.remainingStops * s.dwellMin;
  const restsBefore = Math.floor(i.drivenHours / s.restEveryHours);
  const restsAfter = Math.floor((i.drivenHours + driveMin / 60) / s.restEveryHours);
  const rests = Math.max(0, restsAfter - restsBefore) * s.restMin;
  const eta = i.now.getTime() + (driveMin + dwell + rests) * 60_000;

  let confidence: EtaDto['confidence'] = useHistory ? (i.historicalSamples >= 10 ? 'high' : 'medium') : 'low';
  const stale = i.fixAgeMin > s.staleFixMin;
  if (stale) confidence = 'low';

  const parts = [
    useHistory
      ? `${Math.round(i.remainingKm)} km at this route’s average ${Math.round(kmph)} km/h from ${i.historicalSamples} past trips`
      : `${Math.round(i.remainingKm)} km at a standard ${kmph} km/h (not enough route history)`,
    dwell ? `${i.remainingStops} stop(s) × ${s.dwellMin} min` : '',
    rests ? `${rests} min of mandatory rest` : '',
  ].filter(Boolean);
  return {
    eta: new Date(Math.round(eta / 60_000) * 60_000).toISOString(),
    method: useHistory ? 'historical' : 'fallback',
    confidence,
    basisNote: `${parts.join(', plus ')}.${stale ? ` Last position is ${Math.round(i.fixAgeMin)} min old.` : ''}`,
    remainingKm: Math.round(i.remainingKm * 10) / 10,
    lateByMin: lateBy(eta, i.plannedEnd),
  };
}
