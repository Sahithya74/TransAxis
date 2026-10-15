import type { Rng } from './prng.js';

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

/** Format-valid but fictional GSTIN: state code + PAN-like block + entity digit + 'Z' + check char. */
export function fakeGstin(stateCode: string, rng: Rng): string {
  const pan = Array.from({ length: 5 }, () => LETTERS[rng.int(0, 25)]).join('') + String(rng.int(1000, 9999)) + LETTERS[rng.int(0, 25)];
  return `${stateCode}${pan}${rng.int(1, 9)}Z${LETTERS[rng.int(0, 25)]}`;
}

export const fakePan = (gstin: string) => gstin.slice(2, 12);

export function fakeMobile(rng: Rng): string {
  return `+91 9${rng.int(1000, 9999)} ${rng.int(10000, 99999)}`;
}

export const addMinutes = (d: Date, m: number) => new Date(d.getTime() + m * 60_000);
export const addHours = (d: Date, h: number) => addMinutes(d, h * 60);
export const addDaysTo = (d: Date, days: number) => addMinutes(d, days * 1440);

/** A wall-clock time in India (UTC+05:30) on `isoDate` shifted by `dayOffset`, as a UTC Date. */
export function istAt(isoDate: string, dayOffset: number, hour: number, minute = 0): Date {
  const base = Date.parse(`${isoDate}T00:00:00Z`) + dayOffset * 86_400_000;
  return new Date(base + (hour * 60 + minute - 330) * 60_000);
}

export const isoDay = (d: Date) => d.toISOString().slice(0, 10);

/** Rounds to the nearest 5 minutes so seeded times look like human input. */
export const round5 = (d: Date) => new Date(Math.round(d.getTime() / 300_000) * 300_000);

export class Sequences {
  private next = new Map<string, number>();
  take(scope: string, prefix: string, at: Date): string {
    const year = at.getUTCFullYear();
    const key = `${scope}|${year}`;
    const n = this.next.get(key) ?? 1;
    this.next.set(key, n + 1);
    return `${prefix}-${year}-${String(n).padStart(6, '0')}`;
  }
  /** Rows for number_sequences so the API continues numbering after the seed. */
  rows(orgId: number) {
    return [...this.next.entries()].map(([key, nextValue]) => {
      const [scope, year] = key.split('|');
      return { orgId, scope: scope!, year: Number(year), nextValue };
    });
  }
}
