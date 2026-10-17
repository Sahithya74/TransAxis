import type { ReactNode } from 'react';
import type { SettlementDto } from '@transaxis/shared';
import { fmtDate, fmtMoney } from '../../lib/format';

/** Every line that makes up a settlement, so the person paid can check it. Used for previews and payslips. */
export function SettlementBreakdownView({ s }: { s: SettlementDto }) {
  const b = s.breakdown;
  const recovered = b.advances.filter((a) => Number(a.recoveredNow) > 0);
  return (
    <div className="space-y-4 text-[13px]">
      <Section title="Earnings" total={s.earnings} empty="No trip pay in this period.">
        {b.earnings.map((e) => (
          <Item key={`e${e.id}`} label={<>{e.label}{e.tripNo && <span className="ml-1.5 font-mono text-xs text-muted">{e.tripNo}</span>}</>} note={e.formula} amount={e.amount} />
        ))}
      </Section>
      <Section title="Reimbursements" total={s.reimbursements} empty="No approved expenses to pay back.">
        {b.reimbursements.map((r) => <Item key={`r${r.id}`} label={r.description} note={fmtDate(r.date)} amount={r.amount} />)}
      </Section>
      {b.deductions.length > 0 && (
        <Section title="Deductions" total={s.deductions} negative>
          {b.deductions.map((d) => <Item key={`d${d.id}`} label={d.reason} amount={d.amount} negative />)}
        </Section>
      )}
      {(recovered.length > 0 || Number(s.advanceCarriedForward) > 0) && (
        <Section title="Advances recovered" total={s.advancesRecovered} negative>
          {recovered.map((a) => <Item key={`a${a.id}`} label={`Advance given ${fmtDate(a.givenOn)}`} note={`${fmtMoney(a.outstanding, true)} was outstanding`} amount={a.recoveredNow} negative />)}
          {Number(s.advanceCarriedForward) > 0 && (
            <li className="px-3 py-2 text-xs text-warn-strong">{fmtMoney(s.advanceCarriedForward, true)} of advances is carried forward: pay can’t go below zero, so the rest is recovered next time.</li>
          )}
        </Section>
      )}
      <div className="flex items-baseline justify-between rounded border border-line bg-canvas px-3 py-2.5">
        <span className="font-semibold">Net pay</span>
        <span className="text-lg font-semibold tabular-nums">{fmtMoney(s.net, true)}</span>
      </div>
    </div>
  );
}

function Section({ title, total, empty, negative, children }: { title: string; total: string; empty?: string; negative?: boolean; children: ReactNode[] | ReactNode }) {
  const items = Array.isArray(children) ? children.filter(Boolean) : [children];
  return (
    <section>
      <div className="mb-1 flex items-baseline justify-between">
        <h3 className="text-[13px] font-semibold">{title}</h3>
        <span className="tabular-nums">{negative && Number(total) > 0 ? '− ' : ''}{fmtMoney(total, true)}</span>
      </div>
      {items.length === 0 ? <p className="text-xs text-muted">{empty}</p> : <ul className="divide-y divide-line rounded border border-line">{children}</ul>}
    </section>
  );
}

function Item({ label, note, amount, negative }: { label: ReactNode; note?: string; amount: string; negative?: boolean }) {
  return (
    <li className="flex items-start gap-3 px-3 py-2">
      <div className="min-w-0 flex-1">
        <div>{label}</div>
        {note && <div className="text-xs text-muted">{note}</div>}
      </div>
      <span className="tabular-nums">{negative ? '− ' : ''}{fmtMoney(amount, true)}</span>
    </li>
  );
}
