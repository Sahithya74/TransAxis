import { useState, type FormEvent, type ReactNode } from 'react';
import { Link, useParams } from 'react-router';
import { Ban, FileMinus, Printer, Wallet } from 'lucide-react';
import { computeInvoiceTax, type InvoiceDto } from '@transaxis/shared';
import { useAuth } from '../../auth/AuthProvider';
import { ReasonDialog } from '../../components/ReasonDialog';
import { Banner } from '../../components/ui/Banner';
import { Button } from '../../components/ui/Button';
import { Dialog } from '../../components/ui/Dialog';
import { Field, Input, Textarea } from '../../components/ui/Field';
import { Card, ErrorState, PageHeader, Skeleton } from '../../components/ui/Layout';
import { Table, THead, Th } from '../../components/ui/Table';
import { useToast } from '../../components/ui/Toast';
import { apiFieldErrors, type FieldErrors } from '../../lib/forms';
import { fmtDate, fmtMoney } from '../../lib/format';
import { post, useFinanceMutation, useInvoice } from './api';
import { ReceivePaymentDialog } from './InvoicesPage';
import { AGEING_LABEL, GST_MODE_LABEL, InvoiceStatusBadge } from './labels';

export function InvoiceDetailPage() {
  const id = Number(useParams().id);
  const { can } = useAuth();
  const toast = useToast();
  const q = useInvoice(id);
  const [dialog, setDialog] = useState<'pay' | 'credit' | 'cancel' | null>(null);
  const cancel = useFinanceMutation((reason: string) => post<InvoiceDto>(`/finance/invoices/${id}/cancel`, { reason }));

  if (q.isError) return <Card><ErrorState message={(q.error as Error).message} onRetry={() => void q.refetch()} /></Card>;
  if (!q.data) return <Skeleton className="h-64 w-full" />;
  const inv = q.data;
  const open = inv.status === 'issued' || inv.status === 'partially_paid';
  const canPost = can('finance:post');
  const hasPayments = Number(inv.paid) > 0;

  return (
    <div>
      <PageHeader
        title={<span className="flex flex-wrap items-center gap-3">Invoice <span className="font-mono">{inv.invoiceNo}</span> <InvoiceStatusBadge invoice={inv} /></span>}
        subtitle={
          <>
            <Link to={`/parties/customers/${inv.customer.id}`} className="text-primary hover:underline">{inv.customer.name}</Link> · issued {fmtDate(inv.invoiceDate)} · due {fmtDate(inv.dueDate)}
          </>
        }
        actions={
          <>
            <Button onClick={() => window.open(`/print/invoice/${inv.id}`, '_blank', 'noopener')}><Printer className="size-4" aria-hidden /> Print</Button>
            {canPost && open && <Button onClick={() => setDialog('credit')}><FileMinus className="size-4" aria-hidden /> Credit note</Button>}
            {canPost && inv.status !== 'cancelled' && !hasPayments && <Button variant="ghost" onClick={() => setDialog('cancel')}><Ban className="size-4" aria-hidden /> Cancel</Button>}
            {canPost && open && <Button variant="primary" onClick={() => setDialog('pay')}><Wallet className="size-4" aria-hidden /> Record payment</Button>}
          </>
        }
      />
      {inv.status === 'cancelled' && <Banner tone="warn" title="Cancelled">{inv.cancelReason ?? ''} The bookings on it can be invoiced again; the ledger entry was reversed.</Banner>}
      {open && inv.ageing.daysOverdue > 0 && (
        <Banner tone="crit" title={`Overdue by ${inv.ageing.daysOverdue} days`}>{fmtMoney(inv.outstanding, true)} is still unpaid ({AGEING_LABEL[inv.ageing.bucket]} past due).</Banner>
      )}

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <Card>
            <h2 className="border-b border-line px-5 py-3 text-base">Lines</h2>
            <Table minWidth={560}>
              <THead>
                <Th>Description</Th>
                <Th>SAC</Th>
                <Th className="text-right">Amount</Th>
              </THead>
              <tbody>
                {inv.lines.map((l) => (
                  <tr key={l.id} className="border-b border-subtle">
                    <td className="px-4 py-2.5">
                      {l.description}
                      {l.bookingId && (
                        <div className="mt-0.5 flex gap-3 text-xs">
                          <Link to={`/bookings/${l.bookingId}`} className="font-mono text-primary hover:underline">{l.bookingNo}</Link>
                          {l.tripId && <Link to={`/trips/${l.tripId}`} className="text-primary hover:underline">Trip</Link>}
                        </div>
                      )}
                    </td>
                    <td className="px-4 font-mono text-xs">{l.sac}</td>
                    <td className="px-4 text-right tabular-nums">{fmtMoney(l.amount, true)}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </Card>

          <Card>
            <h2 className="border-b border-line px-5 py-3 text-base">Payments and credits</h2>
            {inv.allocations.length === 0 && inv.creditNotes.length === 0 ? (
              <p className="px-5 py-6 text-[13px] text-muted">Nothing received against this invoice yet.</p>
            ) : (
              <ul className="divide-y divide-line text-[13px]">
                {inv.allocations.map((a) => (
                  <li key={`r${a.receiptId}`} className="flex items-center gap-3 px-5 py-2.5">
                    <span className="font-mono text-xs">{a.receiptNo}</span>
                    <span className="text-muted">Payment received {fmtDate(a.receivedOn)}</span>
                    <span className="ml-auto tabular-nums">{fmtMoney(a.amount, true)}</span>
                  </li>
                ))}
                {inv.creditNotes.map((c) => (
                  <li key={`c${c.id}`} className="flex items-center gap-3 px-5 py-2.5">
                    <span className="font-mono text-xs">{c.noteNo}</span>
                    <span className="min-w-0 text-muted">Credit note {fmtDate(c.noteDate)}: {c.reason}</span>
                    <span className="ml-auto tabular-nums">{fmtMoney(c.total, true)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <div className="space-y-5">
          <Card className="p-5">
            <h2 className="mb-3 text-base">Amounts</h2>
            <dl className="space-y-1.5 text-[13px]">
              <Line label="Taxable value" value={fmtMoney(inv.taxable, true)} />
              {inv.gstMode === 'rcm_5' ? (
                <Line label="GST (reverse charge, paid by customer)" value={fmtMoney(inv.reverseChargeTax, true)} muted />
              ) : inv.intraState ? (
                <>
                  <Line label="CGST" value={fmtMoney(inv.cgst, true)} />
                  <Line label="SGST" value={fmtMoney(inv.sgst, true)} />
                </>
              ) : (
                <Line label="IGST" value={fmtMoney(inv.igst, true)} />
              )}
              <Line label="Invoice total" value={fmtMoney(inv.total, true)} strong />
              <Line label="Received" value={`− ${fmtMoney(inv.paid, true)}`} />
              {Number(inv.credited) > 0 && <Line label="Credit notes" value={`− ${fmtMoney(inv.credited, true)}`} />}
              <div className="border-t border-line pt-1.5">
                <Line label="Outstanding" value={inv.status === 'cancelled' ? '—' : fmtMoney(inv.outstanding, true)} strong />
              </div>
            </dl>
          </Card>
          <Card className="p-5 text-[13px]">
            <h2 className="mb-3 text-base">Billing</h2>
            <Detail label="Bill to">
              {inv.customer.name}
              {inv.customer.billingAddress && <div className="text-muted">{inv.customer.billingAddress}</div>}
              <div className="text-muted">{[inv.customer.city, inv.customer.state].filter(Boolean).join(', ')}</div>
            </Detail>
            <Detail label="Customer GSTIN"><span className="font-mono">{inv.customer.gstin ?? 'Not registered'}</span></Detail>
            <Detail label="GST treatment">{GST_MODE_LABEL[inv.gstMode]}</Detail>
            <Detail label="Place of supply">{inv.placeOfSupply ?? '—'} ({inv.intraState ? 'intra-state' : 'inter-state'})</Detail>
            {inv.notes && <Detail label="Notes">{inv.notes}</Detail>}
          </Card>
        </div>
      </div>

      <ReceivePaymentDialog open={dialog === 'pay'} onClose={() => setDialog(null)} invoice={inv} />
      <CreditNoteDialog open={dialog === 'credit'} onClose={() => setDialog(null)} invoice={inv} />
      <ReasonDialog
        open={dialog === 'cancel'}
        onClose={() => setDialog(null)}
        title={`Cancel invoice ${inv.invoiceNo}?`}
        description="Use this for an invoice raised in error before any payment. Its bookings go back to “Ready to invoice” and the ledger entry is reversed. The number is not reused."
        confirmLabel="Cancel invoice"
        danger
        minLength={5}
        onConfirm={async (reason) => {
          await cancel.mutateAsync(reason);
          toast.success(`Invoice ${inv.invoiceNo} cancelled`);
        }}
      />
    </div>
  );
}

function Line({ label, value, strong, muted }: { label: string; value: string; strong?: boolean; muted?: boolean }) {
  return (
    <div className={`flex justify-between gap-4 ${strong ? 'font-semibold' : ''} ${muted ? 'text-muted' : ''}`}>
      <dt>{label}</dt>
      <dd className="tabular-nums">{value}</dd>
    </div>
  );
}

function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="mb-2.5">
      <div className="text-xs text-muted">{label}</div>
      <div>{children}</div>
    </div>
  );
}

function CreditNoteDialog({ open, onClose, invoice }: { open: boolean; onClose: () => void; invoice: InvoiceDto }) {
  const toast = useToast();
  const [taxable, setTaxable] = useState('');
  const [reason, setReason] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [message, setMessage] = useState<string | null>(null);
  const create = useFinanceMutation((body: unknown) => post<InvoiceDto>(`/finance/invoices/${invoice.id}/credit-notes`, body));
  const tax = computeInvoiceTax(Number(taxable) > 0 ? Number(taxable).toFixed(2) : '0', invoice.gstMode, invoice.intraState);

  const close = () => {
    setTaxable('');
    setReason('');
    setErrors({});
    setMessage(null);
    onClose();
  };
  async function submit(e: FormEvent) {
    e.preventDefault();
    setErrors({});
    setMessage(null);
    try {
      await create.mutateAsync({ taxable: Number(taxable), reason: reason.trim() });
      toast.success(`Credit note for ${fmtMoney(tax.total, true)} issued`);
      close();
    } catch (err) {
      const r = apiFieldErrors(err);
      setErrors(r.fields);
      setMessage(r.message);
    }
  }

  return (
    <Dialog
      open={open}
      onClose={close}
      title={`Credit note against ${invoice.invoiceNo}`}
      description="Reduces what the customer owes, for example for short delivery or an agreed discount. GST is reversed in the same proportion."
      footer={
        <>
          <Button onClick={close}>Cancel</Button>
          <Button variant="primary" type="submit" form="credit-form" loading={create.isPending}>Issue credit note</Button>
        </>
      }
    >
      <form id="credit-form" onSubmit={submit} noValidate className="space-y-4">
        {message && <Banner tone="crit" title="Couldn’t issue the credit note">{message}</Banner>}
        <Field label="Credit on the taxable value" required error={errors.taxable} hint={`Up to the outstanding ${fmtMoney(invoice.outstanding, true)} including GST`}>
          {(p) => <Input {...p} type="number" min="0" step="0.01" inputMode="decimal" value={taxable} onChange={(e) => setTaxable(e.target.value)} />}
        </Field>
        <Field label="Reason" required error={errors.reason}>
          {(p) => <Textarea {...p} value={reason} maxLength={255} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Short delivery of 2 cartons, agreed with the customer on 12 Oct" />}
        </Field>
        <p className="rounded bg-canvas px-3 py-2 text-[13px]">
          Credit total <span className="font-semibold tabular-nums">{fmtMoney(tax.total, true)}</span>
          {invoice.gstMode !== 'rcm_5' && <span className="text-muted"> (includes {fmtMoney(Number(tax.total) - Number(tax.taxable), true)} GST)</span>}
        </p>
      </form>
    </Dialog>
  );
}
