import { fmtMoneyCompact } from '../lib/format';

export interface TrendSeries {
  name: string;
  /** A CSS colour, e.g. a theme variable. */
  color: string;
  kind: 'bar' | 'line';
}

const W = 640;
const H = 220;
const PAD = { top: 12, right: 8, bottom: 26, left: 52 };

function niceCeil(v: number) {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  const n = v / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p;
}

/** Monthly money trend: grouped bars plus optional line series, scaled together. */
export function TrendChart({ label, groups, series }: { label: string; groups: { label: string; values: number[] }[]; series: TrendSeries[] }) {
  const max = niceCeil(Math.max(0, ...groups.flatMap((g) => g.values)));
  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;
  const groupW = innerW / Math.max(1, groups.length);
  const bars = series.map((s, i) => ({ ...s, i })).filter((s) => s.kind === 'bar');
  const barW = (groupW * 0.64) / Math.max(1, bars.length);
  const y = (v: number) => PAD.top + innerH - (v / max) * innerH;
  const cx = (gi: number) => PAD.left + groupW * gi + groupW / 2;

  return (
    <figure>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label} className="h-auto w-full">
        {[0, 0.25, 0.5, 0.75, 1].map((t) => (
          <g key={t}>
            <line x1={PAD.left} x2={W - PAD.right} y1={y(max * t)} y2={y(max * t)} stroke="var(--color-line)" strokeDasharray={t === 0 ? undefined : '3 3'} />
            <text x={PAD.left - 6} y={y(max * t) + 4} textAnchor="end" fontSize="11" fill="var(--color-muted)">{fmtMoneyCompact(max * t)}</text>
          </g>
        ))}
        {groups.map((g, gi) => (
          <g key={g.label}>
            {bars.map((s, bi) => {
              const v = g.values[s.i] ?? 0;
              const x = cx(gi) - (barW * bars.length) / 2 + bi * barW;
              return (
                <rect key={s.name} x={x + 1} width={Math.max(1, barW - 2)} y={y(v)} height={Math.max(0, y(0) - y(v))} rx="2" fill={s.color}>
                  <title>{`${g.label} · ${s.name}: ${fmtMoneyCompact(v)}`}</title>
                </rect>
              );
            })}
            <text x={cx(gi)} y={H - 8} textAnchor="middle" fontSize="11" fill="var(--color-muted)">{g.label}</text>
          </g>
        ))}
        {series.map((s, si) =>
          s.kind === 'line' ? (
            <g key={s.name}>
              <polyline fill="none" stroke={s.color} strokeWidth="2" points={groups.map((g, gi) => `${cx(gi)},${y(g.values[si] ?? 0)}`).join(' ')} />
              {groups.map((g, gi) => (
                <circle key={g.label} cx={cx(gi)} cy={y(g.values[si] ?? 0)} r="3.5" fill="var(--color-surface)" stroke={s.color} strokeWidth="2">
                  <title>{`${g.label} · ${s.name}: ${fmtMoneyCompact(g.values[si] ?? 0)}`}</title>
                </circle>
              ))}
            </g>
          ) : null,
        )}
      </svg>
      <figcaption className="mt-2 flex flex-wrap gap-4 text-xs text-muted">
        {series.map((s) => (
          <span key={s.name} className="inline-flex items-center gap-1.5">
            <span className={s.kind === 'bar' ? 'size-2.5 rounded-sm' : 'h-0.5 w-3'} style={{ background: s.color }} aria-hidden />
            {s.name}
          </span>
        ))}
      </figcaption>
    </figure>
  );
}

/** "2026-10" → "Oct ’26". */
export const monthLabel = (ym: string) =>
  `${new Intl.DateTimeFormat('en-IN', { month: 'short', timeZone: 'UTC' }).format(new Date(`${ym}-01T00:00:00Z`))} ’${ym.slice(2, 4)}`;
