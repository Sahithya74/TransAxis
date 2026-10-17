import { Link } from 'react-router';
import { AlertTriangle, ChevronRight } from 'lucide-react';
import { AGEING_BUCKETS } from '@transaxis/shared';
import { PeriodPicker, usePeriod } from '../../components/PeriodPicker';
import { monthLabel, TrendChart } from '../../components/TrendChart';
import { Badge } from '../../components/ui/Badge';
import { Card, ErrorState, PageHeader, Skeleton } from '../../components/ui/Layout';
import { BarList, StatCard } from '../../components/ui/Stat';
import { Table, THead, Th } from '../../components/ui/Table';
import { Tabs } from '../../components/ui/Tabs';
import { fmtDate, fmtMoney, fmtNumber } from '../../lib/format';
import { useListParams } from '../../lib/useListParams';
import { useFinanceSummary, useTrialBalance } from './api';
import { AGEING_LABEL } from './labels';

const AGEING_COLOR = { current: 'bg-primary', '1_30': 'bg-warn', '31_60': 'bg-warn', '61_90': 'bg-crit', '90_plus': 'bg-crit' } as const;

export function FinanceOverviewPage() {
  const period = usePeriod('this_month');
  const lp = useListParams(['tab'] as const);
  const tab = lp.values.tab === 'trial-balance' ? 'trial-balance' : 'overview';
  return (
    <div>
      <PageHeader title="Finance overview" subtitle="Revenue, collections and costs, straight from the books" actions={<PeriodPicker period={period} />} />
      <Tabs
        className="mb-5"
        active={tab}
        onChange={(t) => lp.update({ tab: t === 'overview' ? undefined : t })}
        tabs={[{ id: 'overview', label: 'Overview' }, { id: 'trial-balance', label: 'Trial balance' }]}
      />
      {tab === 'overview' ? <Overview from={period.from} to={period.to} /> : <TrialBalance from={period.from} to={period.to} />}
    </div>
  );
}

function Overview({ from, to }: { from: string; to: string }) {
  const q = useFinanceSummary(from, to);
  if (q.isError) return <Card><ErrorState message={(q.error as Error).message} onRetry={() => void q.refetch()} /></Card>;
  const s = q.data;
  const loading = !s;
  const n = (v: string | undefined) => Number(v ?? 0);
  const profit = n(s?.grossProfit);

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Revenue earned" loading={loading} value={fmtMoney(s?.revenueEarned)} sub={s && `Invoiced ${fmtMoney(s.invoiced)} in the period`} />
        <StatCard label="Collected" loading={loading} value={fmtMoney(s?.collected)} sub="Receipts, including TDS deducted" />
        <StatCard
          label="Outstanding now"
          loading={loading}
          value={fmtMoney(s?.outstanding)}
          tone={n(s?.overdue) > 0 ? 'crit' : undefined}
          sub={s && (n(s.overdue) > 0 ? `${fmtMoney(s.overdue)} overdue` : 'Nothing overdue')}
          to="/invoices"
        />
        <StatCard
          label="Gross profit"
          loading={loading}
          value={fmtMoney(s?.grossProfit)}
          tone={profit < 0 ? 'crit' : profit > 0 ? 'ok' : undefined}
          sub={s && (s.marginPct === null ? 'No revenue in the period' : `${s.marginPct}% of revenue`)}
        />
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        <Card className="p-5">
          <div className="mb-3 flex items-baseline justify-between">
            <h2 className="text-base">Costs</h2>
            {s && <span className="text-[13px] font-semibold tabular-nums">{fmtMoney(s.costs.total)}</span>}
          </div>
          {!s ? (
            <Skeleton className="h-36 w-full" />
          ) : (
            <BarList
              total={n(s.costs.total)}
              items={[
                { label: 'Fuel', value: n(s.costs.fuel), display: fmtMoney(s.costs.fuel), color: 'bg-primary', to: '/fuel' },
                { label: 'Driver and crew pay', value: n(s.costs.crew), display: fmtMoney(s.costs.crew), color: 'bg-primary-strong', to: '/settlements' },
                { label: 'Trip expenses', value: n(s.costs.tripExpenses), display: fmtMoney(s.costs.tripExpenses), color: 'bg-ai', to: '/expenses' },
                { label: 'Repairs and maintenance', value: n(s.costs.maintenance), display: fmtMoney(s.costs.maintenance), color: 'bg-warn', to: '/maintenance' },
                { label: 'Hire and office', value: n(s.costs.other), display: fmtMoney(s.costs.other), color: 'bg-line-strong' },
              ]}
            />
          )}
        </Card>

        <Card className="p-5">
          <div className="mb-3 flex items-baseline justify-between">
            <h2 className="text-base">Receivables ageing</h2>
            <Link to="/invoices?status=overdue" className="text-[13px] text-primary hover:underline">Overdue invoices</Link>
          </div>
          {!s ? (
            <Skeleton className="h-36 w-full" />
          ) : (
            <BarList
              total={n(s.outstanding)}
              items={AGEING_BUCKETS.map((b) => ({ label: AGEING_LABEL[b], value: n(s.ageing[b]), display: fmtMoney(s.ageing[b]), color: AGEING_COLOR[b] }))}
            />
          )}
          <p className="mt-3 text-xs text-muted">Unpaid balances today, by days past each invoice’s due date.</p>
        </Card>

        <Card className="p-5">
          <h2 className="mb-3 text-base">Needs attention</h2>
          {!s ? (
            <Skeleton className="h-36 w-full" />
          ) : (
            <ul className="divide-y divide-line text-[13px]">
              <Attention to="/expenses" count={s.pending.expenses} text={`expense claim${s.pending.expenses === 1 ? '' : 's'} awaiting approval`} amount={s.pending.expenseAmount} />
              <Attention to="/invoices?tab=ready" count={s.pending.uninvoicedBookings} text={`delivered booking${s.pending.uninvoicedBookings === 1 ? '' : 's'} not invoiced yet`} amount={s.pending.uninvoicedAmount} />
              <Attention to="/fuel?anomaly=true" count={s.pending.fuelAnomalies} text={`fuel fill${s.pending.fuelAnomalies === 1 ? '' : 's'} flagged for review`} />
              <Attention to="/settlements?tab=settlements" count={s.pending.draftSettlements} text={`crew settlement${s.pending.draftSettlements === 1 ? '' : 's'} to approve or pay`} />
            </ul>
          )}
        </Card>
      </div>

      <Card className="p-5">
        <h2 className="mb-1 text-base">Six-month trend</h2>
        <p className="mb-3 text-[13px] text-muted">Revenue earned and costs booked each month, with collections.</p>
        {!s ? (
          <Skeleton className="h-52 w-full" />
        ) : (
          <TrendChart
            label="Monthly revenue, costs and collections"
            series={[
              { name: 'Revenue earned', color: 'var(--color-primary)', kind: 'bar' },
              { name: 'Costs', color: 'var(--color-warn)', kind: 'bar' },
              { name: 'Collected', color: 'var(--color-ok)', kind: 'line' },
            ]}
            groups={s.monthly.map((m) => ({ label: monthLabel(m.month), values: [n(m.revenue), n(m.costs), n(m.collected)] }))}
          />
        )}
      </Card>

      <p className="text-xs text-muted">
        Revenue earned is the approved freight of trips delivered in the period, before GST. Costs come from posted journal entries, so they match
        the trial balance. Gross profit excludes overheads not yet booked, such as EMIs and insurance.
      </p>
    </div>
  );
}

function Attention({ to, count, text, amount }: { to: string; count: number; text: string; amount?: string }) {
  return (
    <li>
      <Link to={to} className="group flex items-center gap-2 py-2.5">
        {count > 0 ? <AlertTriangle className="size-4 shrink-0 text-warn" aria-hidden /> : <span className="size-4 shrink-0" aria-hidden />}
        <span className={count > 0 ? '' : 'text-muted'}>
          <span className="font-semibold tabular-nums">{fmtNumber(count)}</span> {text}
          {amount && count > 0 && <span className="text-muted"> · {fmtMoney(amount)}</span>}
        </span>
        <ChevronRight className="ml-auto size-4 text-muted group-hover:text-ink" aria-hidden />
      </Link>
    </li>
  );
}

const paise = (v: string) => Math.round(Number(v) * 100);

function TrialBalance({ from, to }: { from: string; to: string }) {
  const tb = useTrialBalance(from, to);
  if (tb.isError) return <Card><ErrorState message={(tb.error as Error).message} onRetry={() => void tb.refetch()} /></Card>;
  const rows = tb.data ?? [];
  const debit = rows.reduce((s, r) => s + paise(r.debit), 0);
  const credit = rows.reduce((s, r) => s + paise(r.credit), 0);
  return (
    <Card>
      <div className="flex flex-wrap items-center gap-3 border-b border-line px-5 py-3">
        <h2 className="text-base">Trial balance</h2>
        <span className="text-[13px] text-muted">Entries dated {fmtDate(from)} to {fmtDate(to)}</span>
        {tb.data && (debit === credit ? <Badge tone="ok">Balanced</Badge> : <Badge tone="crit">Out of balance by {fmtMoney((debit - credit) / 100, true)}</Badge>)}
      </div>
      <Table minWidth={720}>
        <THead>
          <Th>Code</Th>
          <Th>Account</Th>
          <Th>Type</Th>
          <Th className="text-right">Debits</Th>
          <Th className="text-right">Credits</Th>
          <Th className="text-right">Balance</Th>
        </THead>
        <tbody>
          {tb.isPending &&
            Array.from({ length: 8 }, (_, i) => (
              <tr key={i} className="border-b border-subtle">
                {Array.from({ length: 6 }, (__, j) => <td key={j} className="h-10 px-4"><Skeleton className="h-3.5 w-20" /></td>)}
              </tr>
            ))}
          {rows.map((r) => {
            const bal = paise(r.balance);
            return (
              <tr key={r.id} className="border-b border-subtle">
                <td className="h-10 px-4 font-mono text-xs">{r.code}</td>
                <td className="px-4">{r.name}</td>
                <td className="px-4 capitalize text-muted">{r.type}</td>
                <td className="px-4 text-right tabular-nums">{fmtMoney(r.debit, true)}</td>
                <td className="px-4 text-right tabular-nums">{fmtMoney(r.credit, true)}</td>
                <td className="px-4 text-right tabular-nums">{bal === 0 ? '—' : `${fmtMoney(Math.abs(bal) / 100, true)} ${bal > 0 ? 'Dr' : 'Cr'}`}</td>
              </tr>
            );
          })}
          {tb.data && rows.length > 0 && (
            <tr className="bg-canvas font-semibold">
              <td className="h-10 px-4" colSpan={3}>Total</td>
              <td className="px-4 text-right tabular-nums">{fmtMoney(debit / 100, true)}</td>
              <td className="px-4 text-right tabular-nums">{fmtMoney(credit / 100, true)}</td>
              <td />
            </tr>
          )}
        </tbody>
      </Table>
      {tb.data && rows.length === 0 && <p className="px-5 py-8 text-center text-[13px] text-muted">No entries were posted in this period.</p>}
      <p className="border-t border-line px-5 py-3 text-xs text-muted">
        Posted entries can’t be edited or deleted; mistakes are corrected with reversal entries, so the history stays complete.
      </p>
    </Card>
  );
}
