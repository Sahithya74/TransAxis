import { Link } from 'react-router';
import { ChevronLeft, Printer } from 'lucide-react';
import { ErrorState, Skeleton } from '../../components/ui/Layout';
import { fmtDate, fmtMoney } from '../../lib/format';
import { useAdvances, useEarnings, useExpenses, useSettlements } from '../finance/api';
import { ExpenseStatusBadge, SettlementStatusBadge } from '../finance/labels';

const sum = (rows: { amount: string }[]) => rows.reduce((s, r) => s + Number(r.amount), 0);

/** The driver's own pay: what has been earned since the last settlement, claims, advances and payslips. */
export function DriverPayPage() {
  const earnings = useEarnings({ unsettled: 'true' });
  const claims = useExpenses({ pageSize: 20 });
  const advances = useAdvances({ outstanding: 'true' });
  const settlements = useSettlements({ pageSize: 12 });
  if (earnings.isError) return <ErrorState message={(earnings.error as Error).message} onRetry={() => void earnings.refetch()} />;

  const earned = sum(earnings.data ?? []);
  const toRepay = (claims.data?.data ?? []).filter((e) => e.status === 'approved' && !e.settled && e.paymentMode === 'driver_paid');
  const owed = (advances.data ?? []).reduce((s, a) => s + Number(a.outstanding), 0);
  const estimate = Math.max(0, earned + sum(toRepay) - owed);

  return (
    <div className="space-y-4">
      <Link to="/driver" className="inline-flex items-center gap-1 text-[13px] text-muted"><ChevronLeft className="size-4" aria-hidden /> My trips</Link>
      <section className="rounded-lg border border-line bg-surface p-4 shadow-card">
        <h1 className="text-lg">My pay</h1>
        {!earnings.data || !claims.data || !advances.data ? (
          <Skeleton className="mt-2 h-16 w-full" />
        ) : (
          <>
            <div className="mt-1 text-3xl font-semibold tabular-nums">{fmtMoney(estimate)}</div>
            <p className="text-[13px] text-muted">Expected in your next settlement, before any deductions</p>
            <dl className="mt-3 space-y-1 text-[13px]">
              <Line label="Trip pay and allowances" value={fmtMoney(earned, true)} />
              <Line label="Expenses to be paid back" value={fmtMoney(sum(toRepay), true)} />
              <Line label="Advances to recover" value={owed ? `− ${fmtMoney(owed, true)}` : fmtMoney(0, true)} />
            </dl>
          </>
        )}
      </section>

      <Section title="Earned since your last settlement">
        {earnings.data?.length === 0 && <Empty>Nothing yet. Pay is added when a trip is completed.</Empty>}
        {earnings.data?.map((e) => (
          <li key={e.id} className="flex items-start gap-3 px-4 py-2.5 text-[13px]">
            <div className="min-w-0 flex-1">
              <div className="font-medium">{e.label}{e.trip && <span className="ml-1.5 font-mono text-xs text-muted">{e.trip.tripNo}</span>}</div>
              <div className="text-xs text-muted">{e.formula} · {fmtDate(e.earnedOn)}</div>
            </div>
            <span className="tabular-nums">{fmtMoney(e.amount, true)}</span>
          </li>
        ))}
      </Section>

      <Section title="My expense claims">
        {claims.data?.data.length === 0 && <Empty>Add expenses from a trip, such as tolls or food you paid for.</Empty>}
        {claims.data?.data.map((e) => (
          <li key={e.id} className="px-4 py-2.5 text-[13px]">
            <div className="flex items-start gap-3">
              <div className="min-w-0 flex-1">
                <div className="font-medium">{e.category.name}</div>
                <div className="text-xs text-muted">{e.description} · {fmtDate(e.expenseDate)}{e.trip ? ` · ${e.trip.tripNo}` : ''}</div>
              </div>
              <span className="tabular-nums">{fmtMoney(e.amount, true)}</span>
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <ExpenseStatusBadge status={e.status} />
              {e.settled && <span className="text-xs text-muted">Paid back</span>}
              {e.rejectionReason && <span className="text-xs text-crit-strong">{e.rejectionReason}</span>}
            </div>
          </li>
        ))}
      </Section>

      {(advances.data?.length ?? 0) > 0 && (
        <Section title="Advances to recover">
          {advances.data!.map((a) => (
            <li key={a.id} className="flex items-start gap-3 px-4 py-2.5 text-[13px]">
              <div className="min-w-0 flex-1">
                <div className="font-medium">Advance of {fmtMoney(a.amount)}</div>
                <div className="text-xs text-muted">Given {fmtDate(a.givenOn)}{a.purpose ? ` · ${a.purpose}` : ''}</div>
              </div>
              <span className="tabular-nums">{fmtMoney(a.outstanding, true)}</span>
            </li>
          ))}
        </Section>
      )}

      <Section title="Pay statements">
        {settlements.data?.data.length === 0 && <Empty>No settlements yet.</Empty>}
        {settlements.data?.data.map((s) => (
          <li key={s.id} className="flex items-center gap-3 px-4 py-2.5 text-[13px]">
            <div className="min-w-0 flex-1">
              <div className="font-medium">{fmtDate(s.periodFrom)} – {fmtDate(s.periodTo)}</div>
              <div className="mt-0.5 flex items-center gap-2"><SettlementStatusBadge status={s.status} />{s.paidOn && <span className="text-xs text-muted">paid {fmtDate(s.paidOn)}</span>}</div>
            </div>
            <span className="font-semibold tabular-nums">{fmtMoney(s.net, true)}</span>
            <button onClick={() => window.open(`/print/payslip/${s.id}`, '_blank', 'noopener')} className="rounded p-2 text-primary hover:bg-subtle" aria-label={`Pay statement ${s.settlementNo}`}>
              <Printer className="size-4" />
            </button>
          </li>
        ))}
      </Section>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-line bg-surface shadow-card">
      <h2 className="border-b border-line px-4 py-2.5 text-base">{title}</h2>
      <ul className="divide-y divide-line">{children}</ul>
    </section>
  );
}

const Empty = ({ children }: { children: React.ReactNode }) => <li className="px-4 py-4 text-[13px] text-muted">{children}</li>;

function Line({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-muted">{label}</dt>
      <dd className="tabular-nums">{value}</dd>
    </div>
  );
}
