import { useSearchParams } from 'react-router';
import { addDays, todayIn } from '@transaxis/shared';
import { useOrgTimezone } from '../lib/useOrgTimezone';
import { Input, Select } from './ui/Field';

export const PERIOD_PRESETS = {
  this_month: 'This month',
  last_month: 'Last month',
  this_quarter: 'This quarter',
  this_fy: 'This financial year',
  last_fy: 'Last financial year',
  last_90: 'Last 90 days',
  custom: 'Custom dates',
} as const;
export type PeriodPreset = keyof typeof PERIOD_PRESETS;
type Preset = Exclude<PeriodPreset, 'custom'>;

const pad = (n: number) => String(n).padStart(2, '0');
const monthStart = (y: number, m: number) => `${y}-${pad(m)}-01`;
const monthEnd = (y: number, m: number) => addDays(m === 12 ? monthStart(y + 1, 1) : monthStart(y, m + 1), -1);

/** Date ranges for the presets. The Indian financial year runs from April to March. */
export function presetRange(p: Preset, today: string): { from: string; to: string } {
  const y = Number(today.slice(0, 4));
  const m = Number(today.slice(5, 7));
  const fy = m >= 4 ? y : y - 1;
  switch (p) {
    case 'this_month':
      return { from: monthStart(y, m), to: today };
    case 'last_month': {
      const [ly, lm] = m === 1 ? [y - 1, 12] : [y, m - 1];
      return { from: monthStart(ly, lm), to: monthEnd(ly, lm) };
    }
    case 'this_quarter':
      return { from: monthStart(y, m - ((m - 1) % 3)), to: today };
    case 'this_fy':
      return { from: `${fy}-04-01`, to: today };
    case 'last_fy':
      return { from: `${fy - 1}-04-01`, to: `${fy}-03-31` };
    case 'last_90':
      return { from: addDays(today, -89), to: today };
  }
}

export interface Period {
  from: string;
  to: string;
  preset: PeriodPreset;
  today: string;
  set: (preset: PeriodPreset, range?: { from: string; to: string }) => void;
}

/** Reporting period kept in the URL (`period`, or `from`/`to` for custom dates) so views can be shared. */
export function usePeriod(fallback: Preset = 'this_month'): Period {
  const today = todayIn(useOrgTimezone());
  const [params, setParams] = useSearchParams();
  const raw = params.get('period');
  const preset: PeriodPreset = raw && raw in PERIOD_PRESETS ? (raw as PeriodPreset) : params.get('from') ? 'custom' : fallback;
  const base = presetRange(fallback, today);
  const range = preset === 'custom' ? { from: params.get('from') ?? base.from, to: params.get('to') ?? base.to } : presetRange(preset, today);

  const set: Period['set'] = (p, r) => {
    const next = new URLSearchParams(params);
    next.delete('page');
    if (p === fallback) next.delete('period');
    else next.set('period', p);
    if (p === 'custom') {
      next.set('from', (r ?? range).from);
      next.set('to', (r ?? range).to);
    } else {
      next.delete('from');
      next.delete('to');
    }
    setParams(next, { replace: true });
  };
  return { ...range, preset, today, set };
}

export function PeriodPicker({ period }: { period: Period }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select aria-label="Period" className="w-auto" value={period.preset} onChange={(e) => period.set(e.target.value as PeriodPreset)}>
        {Object.entries(PERIOD_PRESETS).map(([k, v]) => (
          <option key={k} value={k}>{v}</option>
        ))}
      </Select>
      <Input
        type="date"
        aria-label="From"
        className="w-auto"
        value={period.from}
        max={period.to}
        onChange={(e) => e.target.value && period.set('custom', { from: e.target.value, to: period.to })}
      />
      <span className="text-[13px] text-muted">to</span>
      <Input
        type="date"
        aria-label="To"
        className="w-auto"
        value={period.to}
        min={period.from}
        onChange={(e) => e.target.value && period.set('custom', { from: period.from, to: e.target.value })}
      />
    </div>
  );
}
