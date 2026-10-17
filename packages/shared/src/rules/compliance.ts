import { MANDATORY_VEHICLE_DOCS, type VehicleDocType } from '../enums.js';
import type { VehicleComplianceSummary } from '../schemas/vehicles.js';

export const DEFAULT_EXPIRY_WARNING_DAYS = 15;

export interface DocValidity {
  docType: VehicleDocType;
  expiresOn: string | null;
}

/**
 * Summarises a vehicle's mandatory document status as of `asOf` (YYYY-MM-DD, org-local date).
 * A document expiring *on* `asOf` is still valid that day. When several documents of one type exist
 * (renewals), the one with the latest expiry counts. A document with no expiry date (e.g. a lifetime
 * RC) is treated as valid.
 */
export function summariseCompliance(
  docs: DocValidity[],
  asOf: string,
  warningDays = DEFAULT_EXPIRY_WARNING_DAYS,
): VehicleComplianceSummary {
  const latest = new Map<VehicleDocType, string | null>();
  for (const d of docs) {
    if (!latest.has(d.docType)) {
      latest.set(d.docType, d.expiresOn);
      continue;
    }
    const current = latest.get(d.docType) ?? null;
    if (current === null) continue; // no-expiry document already wins
    if (d.expiresOn === null || d.expiresOn > current) latest.set(d.docType, d.expiresOn);
  }

  const warnLimit = addDays(asOf, warningDays);
  const expired: VehicleDocType[] = [];
  const expiringSoon: VehicleDocType[] = [];
  const missing: VehicleDocType[] = [];
  let nextExpiry: string | null = null;

  for (const type of MANDATORY_VEHICLE_DOCS) {
    if (!latest.has(type)) {
      missing.push(type);
      continue;
    }
    const exp = latest.get(type) ?? null;
    if (exp === null) continue;
    if (nextExpiry === null || exp < nextExpiry) nextExpiry = exp;
    if (exp < asOf) expired.push(type);
    else if (exp <= warnLimit) expiringSoon.push(type);
  }

  const state = expired.length ? 'expired' : missing.length ? 'missing' : expiringSoon.length ? 'expiring' : 'ok';
  return { state, nextExpiry, expired, expiringSoon, missing };
}

/** Adds whole days to a YYYY-MM-DD date without timezone drift. */
export function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Today's calendar date in an IANA timezone, as YYYY-MM-DD. */
export function todayIn(timeZone: string, now: Date = new Date()): string {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

/** Offset of an IANA timezone from UTC at an instant, in minutes (Asia/Kolkata: +330). */
export function tzOffsetMinutes(timeZone: string, at: Date): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(at);
  const get = (t: string) => Number(parts.find((p) => p.type === t)!.value);
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  return Math.round((asUtc - Math.floor(at.getTime() / 1000) * 1000) / 60_000);
}

/** The instant a calendar day (YYYY-MM-DD) begins in an IANA timezone. Use it for "from/to date" filters. */
export function startOfDayIn(isoDate: string, timeZone: string): Date {
  const midnightUtc = Date.parse(`${isoDate}T00:00:00Z`);
  const first = midnightUtc - tzOffsetMinutes(timeZone, new Date(midnightUtc)) * 60_000;
  // Re-read the offset at the candidate instant in case a DST change falls between the two.
  return new Date(midnightUtc - tzOffsetMinutes(timeZone, new Date(first)) * 60_000);
}
