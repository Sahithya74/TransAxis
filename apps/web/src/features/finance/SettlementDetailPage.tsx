import { useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router';
import { Ban, CheckCircle2, Printer, Wallet } from 'lucide-react';
import { todayIn, type SettlementDto } from '@transaxis/shared';
import { useAuth } from '../../auth/AuthProvider';
import { ReasonDialog } from '../../components/ReasonDialog';
import { Banner } from '../../components/ui/Banner';
import { Button } from '../../components/ui/Button';
import { Dialog } from '../../components/ui/Dialog';
import { Field, Input, Select } from '../../components/ui/Field';
import { Card, ErrorState, PageHeader, Skeleton } from '../../components/ui/Layout';
import { useToast } from '../../components/ui/Toast';
import { apiFieldErrors, type FieldErrors } from '../../lib/forms';
import { fmtDate, fmtDateTime, fmtMoney } from '../../lib/format';
import { useOrgTimezone } from '../../lib/useOrgTimezone';
import { post, useFinanceMutation, useSettlement } from './api';
import { PAYMENT_MODE_LABEL, SettlementStatusBadge } from './labels';
import { SettlementBreakdownView } from './SettlementBreakdown';

export function SettlementDetailPage() {
  const id = Number(useParams().id);
  const { can } = useAuth();
  const tz = useOrgTimezone();
  const toast = useToast();
  const q = useSettlement(id);
  const [dialog, setDialog] = useState<'pay' | 'cancel' | null>(null);
  const approve = useFinanceMutation(() => post<SettlementDto>(`/finance/settlements/${id}/approve`));
  const cancel = useFinanceMutation((reason: string) => post<SettlementDto>(`/finance/settlements/${id}/cancel`, { reason }));

  if (q.isError) return <Card><ErrorState message={(q.error as Error).message} onRetry={() => void q.refetch()} /></Card>;
  if (!q.data) return <Skeleton className="h-64 w-full" />;
  const s = q.data;
  const manage = can('settlements:manage');

  return (
    <div>
      <PageHeader
        title={<span className="flex flex-wrap items-center gap-3">Settlement <span className="font-mono">{s.settlementNo}</span> <SettlementStatusBadge status={s.status} /></span>}
        subtitle={
          <>
            <Link to={`/workers/${s.worker.id}`} className="text-primary hover:underline">{s.worker.fullName}</Link> ({s.worker.employeeCode}) · {fmtDate(s.periodFrom)} to {fmtDate(s.periodTo)}
          </>
        }
        actions={
          <>
            <Button onClick={() => window.open(`/print/payslip/${s.id}`, '_blank', 'noopener')}><Printer className="size-4" aria-hidden /> Pay statement</Button>
            {manage && (s.status === 'draft' || s.status === 'approved') && <Button variant="ghost" onClick={() => setDialog('cancel')}><Ban className="size-4" aria-hidden /> Cancel</Button>}
            {s.status === 'draft' && can('settlements:manage', 'finance:approve') && (
              <Button
                variant="primary"
                loading={approve.isPending}
                onClick={() =>
                  approve.mutateAsync(undefined).then(
                    () => toast.success('Settlement approved; it can now be paid'),
                    (e: Error) => toast.error(e.message),
                  )
                }
              >
                <CheckCircle2 className="size-4" aria-hidden /> Approve
              </Button>
            )}
            {s.status === 'approved' && manage && <Button variant="primary" onClick={() => setDialog('pay')}><Wallet className="size-4" aria-hidden /> Mark as paid</Button>}
          </>
        }
      />
      {s.status === 'draft' && <Banner tone="info" title="Draft">Check the lines below. Once approved, the settlement can be paid; until then it can be cancelled and the items go back to unsettled.</Banner>}
      {s.status === 'paid' && (
        <Banner tone="info" title={`Paid ${fmtDate(s.paidOn)}`}>
          {s.paidMode ? PAYMENT_MODE_LABEL[s.paidMode] : ''}{s.paymentReference ? `, reference ${s.paymentReference}` : ''}. The payment is posted to the ledger.
        </Banner>
      )}
      <div className="grid gap-5 lg:grid-cols-3">
        <Card className="p-5 lg:col-span-2">
          <SettlementBreakdownView s={s} />
        </Card>
        <Card className="p-5 text-[13px]">
          <h2 className="mb-3 text-base">Summary</h2>
          <dl className="space-y-1.5">
            <Row label="Earnings" value={fmtMoney(s.earnings, true)} />
            <Row label="Reimbursements" value={fmtMoney(s.reimbursements, true)} />
            <Row label="Deductions" value={`− ${fmtMoney(s.deductions, true)}`} />
            <Row label="Advances recovered" value={`− ${fmtMoney(s.advancesRecovered, true)}`} />
            <div className="border-t border-line pt-1.5"><Row label="Net pay" value={fmtMoney(s.net, true)} strong /></div>
            {Number(s.advanceCarriedForward) > 0 && <Row label="Advance carried forward" value={fmtMoney(s.advanceCarriedForward, true)} />}
          </dl>
          {s.approvedBy && <p className="mt-4 text-xs text-muted">Approved by {s.approvedBy} {fmtDateTime(s.approvedAt, tz)}</p>}
        </Card>
      </div>
      <PayDialog open={dialog === 'pay'} onClose={() => setDialog(null)} settlement={s} />
      <ReasonDialog
        open={dialog === 'cancel'}
        onClose={() => setDialog(null)}
        title="Cancel this settlement?"
        description="Its earnings, expenses, deductions and advance recoveries go back to unsettled, so they can be settled again."
        confirmLabel="Cancel settlement"
        danger
        minLength={5}
        onConfirm={async (reason) => {
          await cancel.mutateAsync(reason);
          toast.success('Settlement cancelled');
        }}
      />
    </div>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={`flex justify-between gap-4 ${strong ? 'font-semibold' : ''}`}>
      <dt className={strong ? '' : 'text-muted'}>{label}</dt>
      <dd className="tabular-nums">{value}</dd>
    </div>
  );
}

function PayDialog({ open, onClose, settlement }: { open: boolean; onClose: () => void; settlement: SettlementDto }) {
  const tz = useOrgTimezone();
  const toast = useToast();
  const [paidOn, setPaidOn] = useState(() => todayIn(tz));
  const [mode, setMode] = useState<'bank' | 'upi' | 'cash'>('bank');
  const [reference, setReference] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [message, setMessage] = useState<string | null>(null);
  const pay = useFinanceMutation((body: unknown) => post<SettlementDto>(`/finance/settlements/${settlement.id}/pay`, body));

  async function submit(e: FormEvent) {
    e.preventDefault();
    setErrors({});
    setMessage(null);
    try {
      await pay.mutateAsync({ paidOn, mode, reference: reference.trim() || null });
      toast.success(`${fmtMoney(settlement.net, true)} paid to ${settlement.worker.fullName}`);
      onClose();
    } catch (err) {
      const r = apiFieldErrors(err);
      setErrors(r.fields);
      setMessage(r.message);
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={`Pay ${fmtMoney(settlement.net, true)} to ${settlement.worker.fullName}`}
      description="Record the payment once the money has been sent. The person gets a notification with their pay statement."
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" form="pay-form" loading={pay.isPending}>Mark as paid</Button>
        </>
      }
    >
      <form id="pay-form" onSubmit={submit} noValidate className="grid gap-4 sm:grid-cols-2">
        {message && <div className="sm:col-span-2"><Banner tone="crit" title="Couldn’t record the payment">{message}</Banner></div>}
        <Field label="Paid on" required error={errors.paidOn}>{(p) => <Input {...p} type="date" value={paidOn} max={todayIn(tz)} onChange={(e) => setPaidOn(e.target.value)} />}</Field>
        <Field label="Mode" required error={errors.mode}>
          {(p) => (
            <Select {...p} value={mode} onChange={(e) => setMode(e.target.value as typeof mode)}>
              <option value="bank">Bank transfer</option>
              <option value="upi">UPI</option>
              <option value="cash">Cash</option>
            </Select>
          )}
        </Field>
        <Field label="Reference" error={errors.reference} className="sm:col-span-2" hint="UTR or UPI reference, if any">
          {(p) => <Input {...p} value={reference} maxLength={80} onChange={(e) => setReference(e.target.value)} />}
        </Field>
      </form>
    </Dialog>
  );
}
