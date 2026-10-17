import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { HandCoins, MinusCircle } from 'lucide-react';
import { DEDUCTION_TYPES, SETTLEMENT_STATUSES, addDays, todayIn, type CrewBalanceDto, type DeductionType, type SettlementDto } from '@transaxis/shared';
import { useAuth } from '../../auth/AuthProvider';
import { Banner } from '../../components/ui/Banner';
import { Button } from '../../components/ui/Button';
import { Dialog } from '../../components/ui/Dialog';
import { Drawer } from '../../components/ui/Drawer';
import { Field, Input, Select, Textarea } from '../../components/ui/Field';
import { Card, EmptyState, ErrorState, PageHeader, Pagination, Skeleton } from '../../components/ui/Layout';
import { Table, THead, Th } from '../../components/ui/Table';
import { Tabs } from '../../components/ui/Tabs';
import { useToast } from '../../components/ui/Toast';
import { apiFieldErrors, type FieldErrors } from '../../lib/forms';
import { fmtDate, fmtMoney, titleCase } from '../../lib/format';
import { useListParams } from '../../lib/useListParams';
import { useOrgTimezone } from '../../lib/useOrgTimezone';
import { useTrips } from '../trips/api';
import { useWorkers } from '../workers/api';
import { post, useAdvances, useCrewBalances, useDeductions, useFinanceMutation, useSettlementPreview, useSettlements } from './api';
import { DEDUCTION_TYPE_LABEL, SETTLEMENT_STATUS_LABEL, SettlementStatusBadge } from './labels';
import { SettlementBreakdownView } from './SettlementBreakdown';

export function SettlementsPage() {
  const { can } = useAuth();
  const lp = useListParams(['tab', 'status', 'workerId'] as const);
  const tab = lp.values.tab ?? 'balances';
  const manage = can('settlements:manage');
  const [settle, setSettle] = useState<CrewBalanceDto | null>(null);
  const [dialog, setDialog] = useState<'advance' | 'deduction' | null>(null);

  return (
    <div>
      <PageHeader
        title="Crew settlements"
        subtitle="Trip pay, allowances, reimbursed expenses, advances and deductions, settled per person"
        actions={
          (manage || can('finance:post')) && (
            <>
              {manage && <Button onClick={() => setDialog('deduction')}><MinusCircle className="size-4" aria-hidden /> Add deduction</Button>}
              <Button onClick={() => setDialog('advance')}><HandCoins className="size-4" aria-hidden /> Give advance</Button>
            </>
          )
        }
      />
      <Tabs
        className="mb-4"
        active={tab}
        onChange={(t) => lp.update({ tab: t === 'balances' ? undefined : t, status: undefined })}
        tabs={[
          { id: 'balances', label: 'Balances' },
          { id: 'settlements', label: 'Settlements' },
          { id: 'advances', label: 'Advances' },
          { id: 'deductions', label: 'Deductions' },
        ]}
      />
      {tab === 'settlements' ? (
        <SettlementList status={lp.values.status} page={lp.page} onStatus={(s) => lp.update({ status: s })} onPage={(p) => lp.update({ page: String(p) })} />
      ) : tab === 'advances' ? (
        <AdvanceList />
      ) : tab === 'deductions' ? (
        <DeductionList />
      ) : (
        <Balances canSettle={manage} onSettle={setSettle} />
      )}
      <SettleDrawer balance={settle} onClose={() => setSettle(null)} />
      <AdvanceDialog open={dialog === 'advance'} onClose={() => setDialog(null)} />
      <DeductionDialog open={dialog === 'deduction'} onClose={() => setDialog(null)} />
    </div>
  );
}

function Balances({ canSettle, onSettle }: { canSettle: boolean; onSettle: (b: CrewBalanceDto) => void }) {
  const q = useCrewBalances();
  return (
    <Card>
      {q.isError ? (
        <ErrorState message={(q.error as Error).message} onRetry={() => void q.refetch()} />
      ) : (
        <Table minWidth={1000}>
          <THead>
            <Th>Person</Th>
            <Th className="text-right">Unsettled pay</Th>
            <Th className="text-right">Expenses to repay</Th>
            <Th className="text-right">Deductions</Th>
            <Th className="text-right">Advances outstanding</Th>
            <Th className="text-right">Estimated net</Th>
            <Th>Settled up to</Th>
            {canSettle && <Th><span className="sr-only">Actions</span></Th>}
          </THead>
          <tbody>
            {q.isPending &&
              Array.from({ length: 8 }, (_, i) => (
                <tr key={i} className="border-b border-subtle">
                  {Array.from({ length: 7 }, (__, j) => <td key={j} className="h-11 px-4"><Skeleton className="h-3.5 w-20" /></td>)}
                </tr>
              ))}
            {q.data?.map((b) => {
              const nothing = Number(b.unsettledEarnings) === 0 && Number(b.pendingReimbursements) === 0;
              return (
                <tr key={b.worker.id} className="border-b border-subtle">
                  <td className="h-11 px-4">
                    <Link to={`/workers/${b.worker.id}`} className="text-primary hover:underline">{b.worker.fullName}</Link>
                    <div className="text-xs text-muted">{b.worker.employeeCode} · {titleCase(b.worker.workerType)}</div>
                  </td>
                  <td className="px-4 text-right tabular-nums">{fmtMoney(b.unsettledEarnings, true)}</td>
                  <td className="px-4 text-right tabular-nums">{fmtMoney(b.pendingReimbursements, true)}</td>
                  <td className="px-4 text-right tabular-nums">{Number(b.unsettledDeductions) ? `− ${fmtMoney(b.unsettledDeductions, true)}` : '—'}</td>
                  <td className="px-4 text-right tabular-nums">{Number(b.outstandingAdvances) ? fmtMoney(b.outstandingAdvances, true) : '—'}</td>
                  <td className="px-4 text-right font-semibold tabular-nums">{fmtMoney(b.estimatedNet, true)}</td>
                  <td className="px-4 tabular-nums">{b.lastSettledTo ? fmtDate(b.lastSettledTo) : <span className="text-muted">Never</span>}</td>
                  {canSettle && (
                    <td className="px-4 text-right">
                      <Button size="sm" disabled={nothing} onClick={() => onSettle(b)} title={nothing ? 'Nothing to settle' : undefined}>Settle</Button>
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </Table>
      )}
      {q.data && q.data.length === 0 && <EmptyState title="No crew yet" body="Drivers and helpers with a pay policy appear here once they complete trips." />}
      <p className="border-t border-line px-4 py-3 text-xs text-muted">
        Pay is worked out from each person’s pay policy when a trip is completed. Advances are recovered from the next settlement, never taking net pay below zero.
      </p>
    </Card>
  );
}

function SettlementList({ status, page, onStatus, onPage }: { status?: string; page: number; onStatus: (s?: string) => void; onPage: (p: number) => void }) {
  const navigate = useNavigate();
  const q = useSettlements({ status, page, pageSize: 25 });
  return (
    <Card>
      <div className="flex flex-wrap items-center gap-2 border-b border-line p-3">
        <Select aria-label="Status" className="w-auto" value={status ?? ''} onChange={(e) => onStatus(e.target.value || undefined)}>
          <option value="">Any status</option>
          {SETTLEMENT_STATUSES.map((s) => <option key={s} value={s}>{SETTLEMENT_STATUS_LABEL[s]}</option>)}
        </Select>
      </div>
      {q.isError ? (
        <ErrorState message={(q.error as Error).message} onRetry={() => void q.refetch()} />
      ) : (
        <Table minWidth={900}>
          <THead>
            <Th>Settlement</Th>
            <Th>Person</Th>
            <Th>Period</Th>
            <Th className="text-right">Earnings</Th>
            <Th className="text-right">Recovered</Th>
            <Th className="text-right">Net</Th>
            <Th>Status</Th>
          </THead>
          <tbody aria-busy={q.isFetching}>
            {q.isPending &&
              Array.from({ length: 6 }, (_, i) => (
                <tr key={i} className="border-b border-subtle">
                  {Array.from({ length: 7 }, (__, j) => <td key={j} className="h-11 px-4"><Skeleton className="h-3.5 w-20" /></td>)}
                </tr>
              ))}
            {q.data?.data.map((s: SettlementDto) => (
              <tr key={s.id} className="cursor-pointer border-b border-subtle hover:bg-canvas" onClick={() => navigate(`/settlements/${s.id}`)}>
                <td className="h-11 px-4">
                  <Link to={`/settlements/${s.id}`} onClick={(e) => e.stopPropagation()} className="font-mono text-primary hover:underline">{s.settlementNo}</Link>
                </td>
                <td className="px-4">{s.worker.fullName}</td>
                <td className="px-4 tabular-nums">{fmtDate(s.periodFrom)} – {fmtDate(s.periodTo)}</td>
                <td className="px-4 text-right tabular-nums">{fmtMoney(Number(s.earnings) + Number(s.reimbursements), true)}</td>
                <td className="px-4 text-right tabular-nums">{fmtMoney(Number(s.deductions) + Number(s.advancesRecovered), true)}</td>
                <td className="px-4 text-right font-semibold tabular-nums">{fmtMoney(s.net, true)}</td>
                <td className="px-4"><SettlementStatusBadge status={s.status} /></td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      {q.data && q.data.data.length === 0 && <EmptyState title="No settlements" body="Settle a person’s balance from the Balances tab." />}
      {q.data && q.data.meta.total > 0 && <Pagination page={q.data.meta.page} totalPages={q.data.meta.totalPages} total={q.data.meta.total} pageSize={q.data.meta.pageSize} onPage={onPage} />}
    </Card>
  );
}

function AdvanceList() {
  const [outstanding, setOutstanding] = useState(true);
  const q = useAdvances({ outstanding: outstanding ? 'true' : undefined });
  return (
    <Card>
      <div className="flex items-center gap-2 border-b border-line p-3 text-[13px]">
        <label className="flex items-center gap-2"><input type="checkbox" className="size-4 accent-primary" checked={outstanding} onChange={(e) => setOutstanding(e.target.checked)} /> Only advances still to recover</label>
      </div>
      {q.isError ? (
        <ErrorState message={(q.error as Error).message} onRetry={() => void q.refetch()} />
      ) : (
        <Table minWidth={800}>
          <THead>
            <Th>Given</Th>
            <Th>Person</Th>
            <Th>Purpose</Th>
            <Th className="text-right">Amount</Th>
            <Th className="text-right">Recovered</Th>
            <Th className="text-right">Outstanding</Th>
          </THead>
          <tbody>
            {q.isPending && <tr><td colSpan={6} className="p-4"><Skeleton className="h-24 w-full" /></td></tr>}
            {q.data?.map((a) => (
              <tr key={a.id} className="border-b border-subtle">
                <td className="h-11 px-4 tabular-nums">{fmtDate(a.givenOn)}</td>
                <td className="px-4">{a.worker.fullName}</td>
                <td className="px-4">
                  {a.purpose ?? <span className="text-muted">—</span>}
                  {a.trip && <Link to={`/trips/${a.trip.id}`} className="ml-2 font-mono text-xs text-primary hover:underline">{a.trip.tripNo}</Link>}
                </td>
                <td className="px-4 text-right tabular-nums">{fmtMoney(a.amount, true)}</td>
                <td className="px-4 text-right tabular-nums">{fmtMoney(a.recovered, true)}</td>
                <td className="px-4 text-right font-semibold tabular-nums">{fmtMoney(a.outstanding, true)}</td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      {q.data && q.data.length === 0 && <EmptyState title={outstanding ? 'No advances to recover' : 'No advances given'} />}
    </Card>
  );
}

function DeductionList() {
  const q = useDeductions({});
  return (
    <Card>
      {q.isError ? (
        <ErrorState message={(q.error as Error).message} onRetry={() => void q.refetch()} />
      ) : (
        <Table minWidth={800}>
          <THead>
            <Th>Date</Th>
            <Th>Person</Th>
            <Th>Type</Th>
            <Th>Reason</Th>
            <Th className="text-right">Amount</Th>
            <Th>Settled</Th>
          </THead>
          <tbody>
            {q.isPending && <tr><td colSpan={6} className="p-4"><Skeleton className="h-24 w-full" /></td></tr>}
            {q.data?.map((d) => (
              <tr key={d.id} className="border-b border-subtle">
                <td className="h-11 px-4 tabular-nums">{fmtDate(d.deductedOn)}</td>
                <td className="px-4">{d.worker.fullName}</td>
                <td className="px-4">{DEDUCTION_TYPE_LABEL[d.deductionType]}</td>
                <td className="px-4">{d.reason}</td>
                <td className="px-4 text-right tabular-nums">{fmtMoney(d.amount, true)}</td>
                <td className="px-4">{d.settled ? 'Yes' : <span className="text-muted">Next settlement</span>}</td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      {q.data && q.data.length === 0 && <EmptyState title="No deductions" body="Deductions such as damage or fines are taken from the next settlement, with the reason shown on the payslip." />}
    </Card>
  );
}

// ------------------------------------------------------------------ settle

function SettleDrawer({ balance, onClose }: { balance: CrewBalanceDto | null; onClose: () => void }) {
  const tz = useOrgTimezone();
  const toast = useToast();
  const navigate = useNavigate();
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  useEffect(() => {
    if (!balance) return;
    const today = todayIn(tz);
    setFrom(balance.lastSettledTo ? addDays(balance.lastSettledTo, 1) : `${today.slice(0, 7)}-01`);
    setTo(today);
    setMessage(null);
  }, [balance, tz]);

  const preview = useSettlementPreview(balance && from && to ? { workerId: balance.worker.id, periodFrom: from, periodTo: to } : null);
  const create = useFinanceMutation((body: unknown) => post<SettlementDto>('/finance/settlements', body));
  async function submit() {
    setMessage(null);
    try {
      const s = await create.mutateAsync({ workerId: balance!.worker.id, periodFrom: from, periodTo: to });
      toast.success(`Draft settlement ${s.settlementNo} created for ${fmtMoney(s.net, true)}`);
      onClose();
      navigate(`/settlements/${s.id}`);
    } catch (err) {
      setMessage(apiFieldErrors(err).message);
    }
  }

  return (
    <Drawer
      open={!!balance}
      onClose={onClose}
      title={`Settle ${balance?.worker.fullName ?? ''}`}
      description="Everything unsettled up to the end date is included. The draft is checked and approved before it is paid."
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={() => void submit()} loading={create.isPending} disabled={!preview.data || to < from}>
            Create draft{preview.data ? ` for ${fmtMoney(preview.data.net, true)}` : ''}
          </Button>
        </>
      }
    >
      {message && <Banner tone="crit" title="Couldn’t create the settlement">{message}</Banner>}
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <Field label="From">{(p) => <Input {...p} type="date" className="w-auto" value={from} max={to} onChange={(e) => setFrom(e.target.value)} />}</Field>
        <Field label="Up to">{(p) => <Input {...p} type="date" className="w-auto" value={to} min={from} max={todayIn(tz)} onChange={(e) => setTo(e.target.value)} />}</Field>
      </div>
      {preview.isError ? (
        <ErrorState message={(preview.error as Error).message} onRetry={() => void preview.refetch()} />
      ) : !preview.data ? (
        <Skeleton className="h-48 w-full" />
      ) : (
        <div aria-busy={preview.isFetching}>
          <SettlementBreakdownView s={preview.data} />
        </div>
      )}
    </Drawer>
  );
}

// ------------------------------------------------------------------ advances and deductions

function useCrewOptions(enabled: boolean) {
  return useWorkers({ pageSize: 100, sort: 'fullName', status: 'active' }, enabled);
}

function AdvanceDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const tz = useOrgTimezone();
  const toast = useToast();
  const [v, setV] = useState({ workerId: '', tripId: '', givenOn: '', amount: '', mode: 'cash', purpose: '' });
  const [errors, setErrors] = useState<FieldErrors>({});
  const [message, setMessage] = useState<string | null>(null);
  const wasOpen = useRef(false);
  useEffect(() => {
    const opening = open && !wasOpen.current;
    wasOpen.current = open;
    if (!opening) return;
    setV({ workerId: '', tripId: '', givenOn: todayIn(tz), amount: '', mode: 'cash', purpose: '' });
    setErrors({});
    setMessage(null);
  }, [open, tz]);
  const workers = useCrewOptions(open);
  const trips = useTrips({ pageSize: 50, active: 'true', sort: 'plannedStart' }, { enabled: open });
  const give = useFinanceMutation((body: unknown) => post('/finance/crew/advances', body));
  const set = (k: keyof typeof v) => (e: { target: { value: string } }) => setV((x) => ({ ...x, [k]: e.target.value }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    setErrors({});
    setMessage(null);
    try {
      await give.mutateAsync({ workerId: Number(v.workerId) || undefined, tripId: v.tripId ? Number(v.tripId) : null, givenOn: v.givenOn, amount: v.amount === '' ? undefined : Number(v.amount), mode: v.mode, purpose: v.purpose.trim() || null });
      toast.success(`Advance of ${fmtMoney(v.amount, true)} recorded`);
      onClose();
    } catch (err) {
      const r = apiFieldErrors(err);
      setErrors(r.fields);
      setMessage(Object.keys(r.fields).length ? null : r.message);
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Give an advance"
      description="Cash or a transfer for trip costs such as diesel top-ups, tolls and food. It is recovered from the person’s next settlement."
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" form="advance-form" loading={give.isPending}>Record advance</Button>
        </>
      }
    >
      <form id="advance-form" onSubmit={submit} noValidate className="grid gap-4 sm:grid-cols-2">
        {message && <div className="sm:col-span-2"><Banner tone="crit" title="Couldn’t record the advance">{message}</Banner></div>}
        <Field label="Person" required error={errors.workerId} className="sm:col-span-2">
          {(p) => (
            <Select {...p} value={v.workerId} onChange={set('workerId')}>
              <option value="">Choose…</option>
              {workers.data?.data.map((w) => <option key={w.id} value={w.id}>{w.fullName} ({w.employeeCode})</option>)}
            </Select>
          )}
        </Field>
        <Field label="For trip" error={errors.tripId} className="sm:col-span-2">
          {(p) => (
            <Select {...p} value={v.tripId} onChange={set('tripId')}>
              <option value="">Not for a specific trip</option>
              {trips.data?.data.map((t) => <option key={t.id} value={t.id}>{t.tripNo} · {t.originCity} → {t.destinationCity} · {t.driver.fullName}</option>)}
            </Select>
          )}
        </Field>
        <Field label="Date" required error={errors.givenOn}>{(p) => <Input {...p} type="date" value={v.givenOn} max={todayIn(tz)} onChange={set('givenOn')} />}</Field>
        <Field label="Amount (₹)" required error={errors.amount}>{(p) => <Input {...p} type="number" min="0" step="1" inputMode="decimal" value={v.amount} onChange={set('amount')} />}</Field>
        <Field label="Paid by" required error={errors.mode}>
          {(p) => (
            <Select {...p} value={v.mode} onChange={set('mode')}>
              <option value="cash">Cash</option>
              <option value="bank">Bank transfer</option>
              <option value="upi">UPI</option>
            </Select>
          )}
        </Field>
        <Field label="Purpose" error={errors.purpose}>{(p) => <Input {...p} value={v.purpose} maxLength={255} onChange={set('purpose')} placeholder="e.g. Tolls and food" />}</Field>
      </form>
    </Dialog>
  );
}

function DeductionDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const tz = useOrgTimezone();
  const toast = useToast();
  const [v, setV] = useState({ workerId: '', deductionType: 'other' as DeductionType, amount: '', reason: '', deductedOn: '' });
  const [errors, setErrors] = useState<FieldErrors>({});
  const [message, setMessage] = useState<string | null>(null);
  const wasOpen = useRef(false);
  useEffect(() => {
    const opening = open && !wasOpen.current;
    wasOpen.current = open;
    if (!opening) return;
    setV({ workerId: '', deductionType: 'other', amount: '', reason: '', deductedOn: todayIn(tz) });
    setErrors({});
    setMessage(null);
  }, [open, tz]);
  const workers = useCrewOptions(open);
  const add = useFinanceMutation((body: unknown) => post('/finance/crew/deductions', body));
  const set = (k: keyof typeof v) => (e: { target: { value: string } }) => setV((x) => ({ ...x, [k]: e.target.value }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    setErrors({});
    setMessage(null);
    try {
      await add.mutateAsync({ workerId: Number(v.workerId) || undefined, deductionType: v.deductionType, amount: v.amount === '' ? undefined : Number(v.amount), reason: v.reason.trim(), deductedOn: v.deductedOn });
      toast.success('Deduction recorded; it is taken from the next settlement');
      onClose();
    } catch (err) {
      const r = apiFieldErrors(err);
      setErrors(r.fields);
      setMessage(Object.keys(r.fields).length ? null : r.message);
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Add a deduction"
      description="Taken from the person’s next settlement. The reason is printed on their pay statement."
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" form="deduction-form" loading={add.isPending}>Add deduction</Button>
        </>
      }
    >
      <form id="deduction-form" onSubmit={submit} noValidate className="grid gap-4 sm:grid-cols-2">
        {message && <div className="sm:col-span-2"><Banner tone="crit" title="Couldn’t add the deduction">{message}</Banner></div>}
        <Field label="Person" required error={errors.workerId} className="sm:col-span-2">
          {(p) => (
            <Select {...p} value={v.workerId} onChange={set('workerId')}>
              <option value="">Choose…</option>
              {workers.data?.data.map((w) => <option key={w.id} value={w.id}>{w.fullName} ({w.employeeCode})</option>)}
            </Select>
          )}
        </Field>
        <Field label="Type" required error={errors.deductionType}>
          {(p) => (
            <Select {...p} value={v.deductionType} onChange={set('deductionType')}>
              {DEDUCTION_TYPES.map((t) => <option key={t} value={t}>{DEDUCTION_TYPE_LABEL[t]}</option>)}
            </Select>
          )}
        </Field>
        <Field label="Amount (₹)" required error={errors.amount}>{(p) => <Input {...p} type="number" min="0" step="1" value={v.amount} onChange={set('amount')} />}</Field>
        <Field label="Date" required error={errors.deductedOn}>{(p) => <Input {...p} type="date" value={v.deductedOn} max={todayIn(tz)} onChange={set('deductedOn')} />}</Field>
        <div />
        <Field label="Reason" required error={errors.reason} className="sm:col-span-2">
          {(p) => <Textarea {...p} value={v.reason} maxLength={255} onChange={set('reason')} placeholder="e.g. Challan for overloading at Attibele, 3 Oct" />}
        </Field>
      </form>
    </Dialog>
  );
}
