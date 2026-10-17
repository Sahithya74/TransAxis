import { useState } from 'react';
import { Link } from 'react-router';
import { Download, Info } from 'lucide-react';
import type { ReportTableDto, TripProfitDto } from '@transaxis/shared';
import { useAuth } from '../../auth/AuthProvider';
import { PeriodPicker, usePeriod } from '../../components/PeriodPicker';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Select } from '../../components/ui/Field';
import { Card, EmptyState, ErrorState, PageHeader, Skeleton } from '../../components/ui/Layout';
import { Table, THead, Th } from '../../components/ui/Table';
import { useToast } from '../../components/ui/Toast';
import { download } from '../../lib/api';
import { fmtDate, fmtDateTime, fmtMoney, fmtNumber } from '../../lib/format';
import { useListParams } from '../../lib/useListParams';
import { useOrgTimezone } from '../../lib/useOrgTimezone';
import { useReport, useTripProfitability } from '../finance/api';
import { useVehicles } from '../vehicles/api';

const REPORTS = [
  { key: 'trip-profitability', title: 'Trip profitability', blurb: 'Revenue against fuel, expenses and crew pay for each delivered trip' },
  { key: 'revenue-by-customer', title: 'Revenue by customer', blurb: 'Earned, invoiced, collected and outstanding per customer' },
  { key: 'receivables-ageing', title: 'Receivables ageing', blurb: 'Unpaid invoices by days past due' },
  { key: 'vehicle-performance', title: 'Vehicle performance', blurb: 'Trips, km, costs, contribution and utilisation per vehicle' },
  { key: 'driver-performance', title: 'Driver performance', blurb: 'Trips, on-time delivery, pay and safety per driver' },
  { key: 'fuel-efficiency', title: 'Fuel efficiency', blurb: 'Litres, spend and km/L per vehicle, with flagged fills' },
  { key: 'expenses-by-category', title: 'Expenses by category', blurb: 'Claims approved, pending and rejected' },
  { key: 'maintenance-cost', title: 'Maintenance cost', blurb: 'Jobs, breakdowns, downtime and cost per vehicle' },
] as const;

export function ReportsPage() {
  const lp = useListParams(['report'] as const);
  const period = usePeriod('this_month');
  const current = REPORTS.find((r) => r.key === lp.values.report) ?? REPORTS[0];
  return (
    <div>
      <PageHeader title="Reports" subtitle="Operational and financial reports from the same records as the books" />
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Select aria-label="Report" className="w-auto min-w-64" value={current.key} onChange={(e) => lp.update({ report: e.target.value === REPORTS[0].key ? undefined : e.target.value })}>
          {REPORTS.map((r) => <option key={r.key} value={r.key}>{r.title}</option>)}
        </Select>
        <PeriodPicker period={period} />
        <span className="basis-full text-[13px] text-muted">{current.blurb}.</span>
      </div>
      {current.key === 'trip-profitability' ? <TripProfitability from={period.from} to={period.to} /> : <TableReport reportKey={current.key} from={period.from} to={period.to} />}
    </div>
  );
}

function Cell({ type, value }: { type: ReportTableDto['columns'][number]['type']; value: string | number | null | undefined }) {
  if (value === null || value === undefined || value === '') return <span className="text-muted">—</span>;
  switch (type) {
    case 'money':
      return <>{fmtMoney(value)}</>;
    case 'number':
      return <>{fmtNumber(Number(value))}</>;
    case 'percent':
      return <>{value}%</>;
    case 'date':
      return <>{fmtDate(String(value))}</>;
    default:
      return <>{value}</>;
  }
}

const numeric = (t: string) => t === 'money' || t === 'number' || t === 'percent';

function TableReport({ reportKey, from, to }: { reportKey: string; from: string; to: string }) {
  const { can } = useAuth();
  const toast = useToast();
  const q = useReport(reportKey, from, to);
  const [busy, setBusy] = useState(false);
  const exportCsv = async () => {
    setBusy(true);
    try {
      await download(`/reports/${reportKey}.csv`, { from, to }, `${reportKey}.csv`);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (q.isError) return <Card><ErrorState message={(q.error as Error).message} onRetry={() => void q.refetch()} /></Card>;
  if (!q.data) return <Card className="p-4"><Skeleton className="h-64 w-full" /></Card>;
  const t = q.data;
  return (
    <Card>
      <div className="flex flex-wrap items-start gap-3 border-b border-line px-5 py-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-base">{t.title}</h2>
          <p className="text-[13px] text-muted">{t.description}</p>
        </div>
        {can('reports:export') && <Button size="sm" onClick={() => void exportCsv()} loading={busy}><Download className="size-4" aria-hidden /> CSV</Button>}
      </div>
      <div aria-busy={q.isFetching}>
        <Table minWidth={Math.max(640, t.columns.length * 120)}>
          <THead>
            {t.columns.map((c) => <Th key={c.key} className={numeric(c.type) ? 'text-right' : ''}>{c.label}</Th>)}
          </THead>
          <tbody>
            {t.rows.map((r, i) => (
              <tr key={i} className="border-b border-subtle">
                {t.columns.map((c) => (
                  <td key={c.key} className={`h-10 px-4 ${numeric(c.type) ? 'text-right tabular-nums' : ''}`}>
                    <Cell type={c.type} value={r[c.key]} />
                  </td>
                ))}
              </tr>
            ))}
            {t.totals && t.rows.length > 0 && (
              <tr className="bg-canvas font-semibold">
                {t.columns.map((c) => (
                  <td key={c.key} className={`h-10 px-4 ${numeric(c.type) ? 'text-right tabular-nums' : ''}`}>
                    {t.totals![c.key] !== undefined ? <Cell type={c.type} value={t.totals![c.key]} /> : null}
                  </td>
                ))}
              </tr>
            )}
          </tbody>
        </Table>
      </div>
      {t.rows.length === 0 && <EmptyState title="Nothing in this period" body="Try a longer period." />}
      {t.notes.length > 0 && (
        <ul className="space-y-1 border-t border-line px-5 py-3 text-xs text-muted">
          {t.notes.map((n) => <li key={n} className="flex gap-1.5"><Info className="mt-0.5 size-3 shrink-0" aria-hidden />{n}</li>)}
        </ul>
      )}
    </Card>
  );
}

function toCsv(rows: TripProfitDto[]) {
  const head = ['Trip', 'Delivered', 'From', 'To', 'Customer', 'Vehicle', 'Revenue', 'Fuel', 'Expenses', 'Crew', 'Total cost', 'Profit', 'Margin %', 'Provisional', 'Why provisional'];
  const esc = (v: string | number | null) => {
    const s = v === null ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = rows.map((r) =>
    [r.trip.tripNo, r.trip.deliveredAt, r.trip.originCity, r.trip.destinationCity, r.customer, r.vehicle.registrationNo, r.revenue, r.fuel, r.expenses, r.crew, r.totalCost, r.profit, r.marginPct, r.provisional ? 'Yes' : 'No', r.provisionalReasons.join('; ')].map(esc).join(','),
  );
  return `${String.fromCharCode(0xfeff)}${[head.join(','), ...lines].join('\r\n')}\r\n`;
}

function TripProfitability({ from, to }: { from: string; to: string }) {
  const { can } = useAuth();
  const tz = useOrgTimezone();
  const [vehicleId, setVehicleId] = useState('');
  const vehicles = useVehicles({ page: 1, pageSize: 100, sort: 'registrationNo' }, can('vehicles:read'));
  const q = useTripProfitability({ from, to, vehicleId: Number(vehicleId) || undefined });
  const rows = q.data ?? [];
  const sum = (k: 'revenue' | 'totalCost' | 'profit') => rows.reduce((s, r) => s + Number(r[k]), 0);
  const save = () => {
    const href = URL.createObjectURL(new Blob([toCsv(rows)], { type: 'text/csv;charset=utf-8' }));
    const a = Object.assign(document.createElement('a'), { href, download: `trip-profitability-${from}-to-${to}.csv` });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(href), 10_000);
  };

  return (
    <Card>
      <div className="flex flex-wrap items-start gap-3 border-b border-line px-5 py-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-base">Trip profitability</h2>
          <p className="text-[13px] text-muted">Trips delivered {fmtDate(from)} to {fmtDate(to)}. Costs are what has been posted against each trip so far.</p>
        </div>
        {vehicles.data && (
          <Select aria-label="Vehicle" className="w-auto" value={vehicleId} onChange={(e) => setVehicleId(e.target.value)}>
            <option value="">All vehicles</option>
            {vehicles.data.data.map((v) => <option key={v.id} value={v.id}>{v.registrationNo}</option>)}
          </Select>
        )}
        {can('reports:export') && <Button size="sm" onClick={save} disabled={!rows.length}><Download className="size-4" aria-hidden /> CSV</Button>}
      </div>
      {q.isError ? (
        <ErrorState message={(q.error as Error).message} onRetry={() => void q.refetch()} />
      ) : (
        <div aria-busy={q.isFetching}>
          <Table minWidth={1100}>
            <THead>
              <Th>Trip</Th>
              <Th>Customer</Th>
              <Th className="text-right">Revenue</Th>
              <Th className="text-right">Fuel</Th>
              <Th className="text-right">Expenses</Th>
              <Th className="text-right">Crew</Th>
              <Th className="text-right">Profit</Th>
              <Th className="text-right">Margin</Th>
              <Th>Status</Th>
            </THead>
            <tbody>
              {q.isPending && <tr><td colSpan={9} className="p-4"><Skeleton className="h-40 w-full" /></td></tr>}
              {rows.map((r) => (
                <tr key={r.trip.id} className="border-b border-subtle align-top">
                  <td className="px-4 py-2.5">
                    <Link to={`/trips/${r.trip.id}`} className="font-mono text-primary hover:underline">{r.trip.tripNo}</Link>
                    <div className="text-xs text-muted">{r.trip.originCity} → {r.trip.destinationCity} · {r.vehicle.registrationNo}</div>
                    <div className="text-xs text-muted">Delivered {fmtDateTime(r.trip.deliveredAt, tz)}</div>
                  </td>
                  <td className="px-4 py-2.5">{r.customer ?? '—'}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{fmtMoney(r.revenue)}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{fmtMoney(r.fuel)}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{fmtMoney(r.expenses)}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{fmtMoney(r.crew)}</td>
                  <td className={`px-4 py-2.5 text-right font-semibold tabular-nums ${Number(r.profit) < 0 ? 'text-crit-strong' : ''}`}>{fmtMoney(r.profit)}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{r.marginPct === null ? '—' : `${r.marginPct}%`}</td>
                  <td className="px-4 py-2.5">
                    {r.provisional ? (
                      <div className="max-w-56">
                        <Badge tone="warn">Provisional</Badge>
                        <ul className="mt-1 space-y-0.5 text-xs text-muted">{r.provisionalReasons.map((x) => <li key={x}>{x}</li>)}</ul>
                      </div>
                    ) : (
                      <Badge tone="ok">Final</Badge>
                    )}
                  </td>
                </tr>
              ))}
              {rows.length > 0 && (
                <tr className="bg-canvas font-semibold">
                  <td className="h-10 px-4" colSpan={2}>{rows.length} trips</td>
                  <td className="px-4 text-right tabular-nums">{fmtMoney(sum('revenue'))}</td>
                  <td className="px-4 text-right tabular-nums" colSpan={3}>Costs {fmtMoney(sum('totalCost'))}</td>
                  <td className="px-4 text-right tabular-nums">{fmtMoney(sum('profit'))}</td>
                  <td className="px-4 text-right tabular-nums">{sum('revenue') > 0 ? `${Math.round((sum('profit') / sum('revenue')) * 1000) / 10}%` : '—'}</td>
                  <td />
                </tr>
              )}
            </tbody>
          </Table>
        </div>
      )}
      {q.data && rows.length === 0 && <EmptyState title="No trips delivered in this period" />}
      <p className="border-t border-line px-4 py-3 text-xs text-muted">
        A trip stays provisional until its costs are complete: fuel recorded, expenses approved, crew pay accrued on completion, and the trip reconciled.
        Maintenance and overheads are not allocated to trips; see Vehicle performance.
      </p>
    </Card>
  );
}
