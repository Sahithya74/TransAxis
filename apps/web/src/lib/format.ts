const num = new Intl.NumberFormat('en-IN');
const money = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });
const money2 = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dateFmt = new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });

/** All timestamps are shown in the organisation's timezone (India by default), not the browser's. */
export const DEFAULT_TZ = 'Asia/Kolkata';

export const fmtNumber = (n: number | null | undefined) => (n === null || n === undefined ? '—' : num.format(n));

/** Money arrives from the API as decimal strings; format without float surprises for display. */
export function fmtMoney(v: string | number | null | undefined, paise = false): string {
  if (v === null || v === undefined || v === '') return '—';
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? (paise ? money2 : money).format(n) : '—';
}

const moneyCompact = new Intl.NumberFormat('en-IN', { notation: 'compact', style: 'currency', currency: 'INR', maximumFractionDigits: 1 });

/** Lakh/crore shorthand (₹12.3L) for chart labels and tight tiles; tables keep full amounts. */
export function fmtMoneyCompact(v: string | number | null | undefined): string {
  const n = typeof v === 'number' ? v : Number(v);
  return v === null || v === undefined || v === '' || !Number.isFinite(n) ? '—' : moneyCompact.format(n);
}

const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
const joinWords = (...w: string[]) => w.filter(Boolean).join(' ');
function words(n: number): string {
  if (n < 20) return ONES[n]!;
  if (n < 100) return joinWords(TENS[Math.floor(n / 10)]!, ONES[n % 10]!);
  if (n < 1000) return joinWords(`${ONES[Math.floor(n / 100)]} Hundred`, n % 100 ? words(n % 100) : '');
  if (n < 100_000) return joinWords(`${words(Math.floor(n / 1000))} Thousand`, n % 1000 ? words(n % 1000) : '');
  if (n < 10_000_000) return joinWords(`${words(Math.floor(n / 100_000))} Lakh`, n % 100_000 ? words(n % 100_000) : '');
  return joinWords(`${words(Math.floor(n / 10_000_000))} Crore`, n % 10_000_000 ? words(n % 10_000_000) : '');
}

/** Amount in words, Indian style, as printed on tax invoices: "Rupees One Lakh Five Thousand Only". */
export function inrInWords(v: string | number): string {
  const p = Math.round(Number(v) * 100);
  const rupees = Math.floor(p / 100);
  const paise = p % 100;
  return `Rupees ${rupees ? words(rupees) : 'Zero'}${paise ? ` and ${words(paise)} Paise` : ''} Only`;
}

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

const dtCache = new Map<string, Intl.DateTimeFormat>();
function dtf(tz: string, withYear: boolean) {
  const key = `${tz}|${withYear}`;
  let f = dtCache.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat('en-IN', {
      timeZone: tz,
      day: '2-digit',
      month: 'short',
      ...(withYear ? { year: 'numeric' } : {}),
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
    dtCache.set(key, f);
  }
  return f;
}

/** "15 Oct, 14:30" in the org timezone (year added when it differs from now). */
export function fmtDateTime(iso: string | null | undefined, tz = DEFAULT_TZ): string {
  if (!iso) return '—';
  const d = new Date(iso);
  const withYear = d.getUTCFullYear() !== new Date().getUTCFullYear();
  return dtf(tz, withYear).format(d);
}

/** Relative time such as "in 3 h" or "2 d ago", for quick scanning. */
export function fmtRelative(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return '—';
  const diffMin = Math.round((Date.parse(iso) - now) / 60_000);
  const abs = Math.abs(diffMin);
  const text = abs < 60 ? `${abs} min` : abs < 48 * 60 ? `${Math.round(abs / 60)} h` : `${Math.round(abs / 1440)} d`;
  return abs < 1 ? 'now' : diffMin > 0 ? `in ${text}` : `${text} ago`;
}

/** Whole days from `from` to `to` (both YYYY-MM-DD). Negative when `to` is in the past. */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

export const titleCase = (s: string) => s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

// ------------------------------------------------------------------ datetime-local <-> ISO in the org timezone

function offsetMinutes(tz: string, at: Date): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
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
  return Math.round((asUtc - at.getTime()) / 60_000);
}

/** ISO instant → value for <input type="datetime-local"> showing org wall-clock time. */
export function toLocalInput(iso: string | null | undefined, tz = DEFAULT_TZ): string {
  if (!iso) return '';
  const d = new Date(iso);
  const local = new Date(d.getTime() + offsetMinutes(tz, d) * 60_000);
  return local.toISOString().slice(0, 16);
}

/** <input type="datetime-local"> value (org wall-clock) → ISO instant with offset, or '' when empty. */
export function fromLocalInput(value: string, tz = DEFAULT_TZ): string {
  if (!value) return '';
  const guess = new Date(`${value}:00Z`);
  const off = offsetMinutes(tz, guess);
  return new Date(guess.getTime() - off * 60_000).toISOString();
}
