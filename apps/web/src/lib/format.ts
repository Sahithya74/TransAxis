const num = new Intl.NumberFormat('en-IN');
const dateFmt = new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });

export const fmtNumber = (n: number | null | undefined) => (n === null || n === undefined ? '—' : num.format(n));

/** Weights are stored in kg; show tonnes for anything ≥ 1 t because that's how freight is quoted. */
export function fmtWeight(kg: number | null | undefined): string {
  if (kg === null || kg === undefined) return '—';
  return kg >= 1000 ? `${num.format(Math.round(kg / 100) / 10)} t` : `${num.format(kg)} kg`;
}

/** Formats a YYYY-MM-DD calendar date without shifting it through the local timezone. */
export function fmtDate(isoDate: string | null | undefined): string {
  if (!isoDate) return '—';
  return dateFmt.format(new Date(`${isoDate.slice(0, 10)}T00:00:00Z`));
}

/** Whole days from `from` to `to` (both YYYY-MM-DD). Negative when `to` is in the past. */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

export const titleCase = (s: string) => s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
