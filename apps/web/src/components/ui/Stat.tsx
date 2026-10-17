import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { Card, Skeleton } from './Layout';

const toneText = { ok: 'text-ok-strong', warn: 'text-warn-strong', crit: 'text-crit-strong' } as const;

/** Headline number with a label and an optional explanation; links through to the detail when given. */
export function StatCard({
  label,
  value,
  sub,
  tone,
  to,
  loading,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  tone?: keyof typeof toneText;
  to?: string;
  loading?: boolean;
}) {
  const body = (
    <>
      <div className="text-[13px] text-muted">{label}</div>
      {loading ? <Skeleton className="mt-1.5 h-7 w-28" /> : <div className={`mt-0.5 text-2xl font-semibold tabular-nums ${tone ? toneText[tone] : ''}`}>{value}</div>}
      {sub && !loading && <div className="mt-0.5 text-xs text-muted">{sub}</div>}
    </>
  );
  return <Card className="p-4">{to ? <Link to={to} className="block hover:opacity-80">{body}</Link> : body}</Card>;
}

export interface BarItem {
  label: ReactNode;
  value: number;
  display: ReactNode;
  color?: string;
  to?: string;
}

/** Labelled horizontal bars sharing one scale, for breakdowns such as costs or ageing. */
export function BarList({ items, total }: { items: BarItem[]; total?: number }) {
  const max = total ?? Math.max(0, ...items.map((i) => i.value));
  return (
    <ul className="space-y-2.5">
      {items.map((item, idx) => {
        const row = (
          <>
            <div className="flex items-baseline justify-between gap-3 text-[13px]">
              <span className="text-muted">{item.label}</span>
              <span className="font-medium tabular-nums">{item.display}</span>
            </div>
            <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-subtle" aria-hidden>
              <div className={`h-full rounded-full ${item.color ?? 'bg-primary'}`} style={{ width: `${max > 0 ? Math.max(0, (item.value / max) * 100) : 0}%` }} />
            </div>
          </>
        );
        return <li key={idx}>{item.to ? <Link to={item.to} className="block hover:opacity-80">{row}</Link> : row}</li>;
      })}
    </ul>
  );
}
