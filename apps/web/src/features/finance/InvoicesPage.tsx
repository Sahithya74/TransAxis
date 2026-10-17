import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { Plus, Search, Trash2, Wallet } from 'lucide-react';
import {
  GST_MODES,
  RECEIPT_MODES,
  computeInvoiceTax,
  sameGstState,
  todayIn,
  type GstMode,
  type InvoiceDto,
  type ReceiptDto,
  type ReceiptMode,
  type UninvoicedBookingDto,
} from '@transaxis/shared';
import { useAuth } from '../../auth/AuthProvider';
import { Banner } from '../../components/ui/Banner';
import { Button } from '../../components/ui/Button';
import { Dialog } from '../../components/ui/Dialog';
import { Drawer } from '../../components/ui/Drawer';
import { Field, Input, Select, Textarea } from '../../components/ui/Field';
import { Card, EmptyState, ErrorState, PageHeader, Pagination, Skeleton } from '../../components/ui/Layout';
import { SortTh, Table, THead, Th, nextSort } from '../../components/ui/Table';
import { Tabs } from '../../components/ui/Tabs';
import { useToast } from '../../components/ui/Toast';
import { apiFieldErrors, type FieldErrors } from '../../lib/forms';
import { fmtDate, fmtDateTime, fmtMoney, fmtNumber } from '../../lib/format';
import { useListParams } from '../../lib/useListParams';
import { useOrgProfile } from '../../lib/useOrgProfile';
import { useOrgTimezone } from '../../lib/useOrgTimezone';
import { useCustomer, useCustomers } from '../parties/api';
import { post, useFinanceMutation, useInvoices, useReceipts, useUninvoiced } from './api';
import { GST_MODE_LABEL, INVOICE_FILTERS, InvoiceStatusBadge, RECEIPT_MODE_LABEL } from './labels';

export function InvoicesPage() {
  const { can } = useAuth();
  const lp = useListParams(['tab', 'status', 'customerId', 'q'] as const);
  const tab = lp.values.tab ?? 'invoices';
  const [newInvoice, setNewInvoice] = useState<{ customerId?: number; bookingIds?: number[] } | null>(null);
  const [receive, setReceive] = useState(false);
  const canPost = can('finance:post');

  return (
    <div>
      <PageHeader
        title="Invoices & collections"
        subtitle="Bill delivered bookings, record what customers pay and follow up what’s overdue"
        actions={
          canPost && (
            <>
              <Button onClick={() => setReceive(true)}><Wallet className="size-4" aria-hidden /> Record payment</Button>
              <Button variant="primary" onClick={() => setNewInvoice({})}><Plus className="size-4" aria-hidden /> New invoice</Button>
            </>
          )
        }
      />
      <Tabs
        className="mb-4"
        active={tab}
        onChange={(t) => lp.update({ tab: t === 'invoices' ? undefined : t, status: undefined, q: undefined })}
        tabs={[{ id: 'invoices', label: 'Invoices' }, { id: 'ready', label: 'Ready to invoice' }, { id: 'receipts', label: 'Receipts' }]}
      />
      {tab === 'ready' ? (
        <ReadyToInvoice canPost={canPost} onInvoice={(customerId, bookingIds) => setNewInvoice({ customerId, bookingIds })} />
      ) : tab === 'receipts' ? (
        <ReceiptsTab customerId={lp.values.customerId} />
      ) : (
        <InvoiceList lp={lp} />
      )}
      <NewInvoiceDrawer open={!!newInvoice} initial={newInvoice ?? {}} onClose={() => setNewInvoice(null)} />
      <ReceivePaymentDialog open={receive} onClose={() => setReceive(false)} />
    </div>
  );
}

function CustomerFilter({ value, onChange }: { value?: string; onChange: (v: string | undefined) => void }) {
  const customers = useCustomers({ pageSize: 100, sort: 'name' });
  return (
    <Select aria-label="Customer" className="w-auto max-w-64" value={value ?? ''} onChange={(e) => onChange(e.target.value || undefined)}>
      <option value="">All customers</option>
      {customers.data?.data.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
    </Select>
  );
}

function InvoiceList({ lp }: { lp: ReturnType<typeof useListParams<'tab' | 'status' | 'customerId' | 'q'>> }) {
  const navigate = useNavigate();
  const [search, setSearch] = useState(lp.values.q ?? '');
  const status = lp.values.status ?? 'open';
  const list = useInvoices({ page: lp.page, pageSize: 25, sort: lp.sort, status: status === 'all' ? undefined : status, customerId: lp.values.customerId, q: lp.values.q });
  const sortBy = (f: string) => lp.update({ sort: nextSort(lp.sort, f) });

  return (
    <Card>
      <form
        role="search"
        className="flex flex-wrap items-center gap-2 border-b border-line p-3"
        onSubmit={(e) => {
          e.preventDefault();
          lp.update({ q: search.trim() || undefined });
        }}
      >
        <div className="flex flex-wrap gap-1" role="group" aria-label="Invoice status">
          {INVOICE_FILTERS.map((f) => (
            <Button key={f.id} size="sm" variant={status === f.id ? 'primary' : 'ghost'} aria-pressed={status === f.id} onClick={() => lp.update({ status: f.id === 'open' ? undefined : f.id })}>
              {f.label}
            </Button>
          ))}
        </div>
        <CustomerFilter value={lp.values.customerId} onChange={(v) => lp.update({ customerId: v })} />
        <div className="relative min-w-52 flex-1 basis-56">
          <Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-muted" aria-hidden />
          <Input aria-label="Search invoices" placeholder="Invoice number or customer…" className="pl-8" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
      </form>
      {list.isError ? (
        <ErrorState message={(list.error as Error).message} onRetry={() => void list.refetch()} />
      ) : (
        <Table minWidth={900}>
          <THead>
            <SortTh field="invoiceNo" label="Invoice" sort={lp.sort} onSort={sortBy} />
            <Th>Customer</Th>
            <SortTh field="invoiceDate" label="Date" sort={lp.sort} onSort={sortBy} />
            <SortTh field="dueDate" label="Due" sort={lp.sort} onSort={sortBy} />
            <SortTh field="total" label="Total" sort={lp.sort} onSort={sortBy} align="right" />
            <Th className="text-right">Outstanding</Th>
            <Th>Status</Th>
          </THead>
          <tbody aria-busy={list.isFetching}>
            {list.isPending &&
              Array.from({ length: 8 }, (_, i) => (
                <tr key={i} className="border-b border-subtle">
                  {Array.from({ length: 7 }, (__, j) => <td key={j} className="h-11 px-4"><Skeleton className="h-3.5 w-20" /></td>)}
                </tr>
              ))}
            {list.data?.data.map((i: InvoiceDto) => (
              <tr key={i.id} className="cursor-pointer border-b border-subtle hover:bg-canvas" onClick={() => navigate(`/invoices/${i.id}`)}>
                <td className="h-11 px-4">
                  <Link to={`/invoices/${i.id}`} onClick={(e) => e.stopPropagation()} className="font-mono text-primary hover:underline">{i.invoiceNo}</Link>
                </td>
                <td className="px-4">{i.customer.name}</td>
                <td className="px-4 tabular-nums">{fmtDate(i.invoiceDate)}</td>
                <td className="px-4 tabular-nums">{fmtDate(i.dueDate)}</td>
                <td className="px-4 text-right tabular-nums">{fmtMoney(i.total, true)}</td>
                <td className="px-4 text-right tabular-nums">{i.status === 'cancelled' ? '—' : fmtMoney(i.outstanding, true)}</td>
                <td className="px-4"><InvoiceStatusBadge invoice={i} /></td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      {list.data && list.data.data.length === 0 && <EmptyState title="No invoices match" body="Delivered bookings waiting to be billed are under “Ready to invoice”." />}
      {list.data && list.data.meta.total > 0 && (
        <>
          <Pagination page={list.data.meta.page} totalPages={list.data.meta.totalPages} total={list.data.meta.total} pageSize={list.data.meta.pageSize} onPage={(p) => lp.update({ page: String(p) })} />
          <p className="px-4 pb-3 text-xs text-muted">
            {fmtNumber(list.data.meta.total)} invoices · total {fmtMoney(list.data.totals.total)} · outstanding {fmtMoney(list.data.totals.outstanding)}
          </p>
        </>
      )}
    </Card>
  );
}

function ReadyToInvoice({ canPost, onInvoice }: { canPost: boolean; onInvoice: (customerId: number, bookingIds: number[]) => void }) {
  const tz = useOrgTimezone();
  const q = useUninvoiced();
  const groups = useMemo(() => {
    const by = new Map<number, { customer: UninvoicedBookingDto['customer']; rows: UninvoicedBookingDto[] }>();
    for (const b of q.data ?? []) {
      const g = by.get(b.customer.id) ?? { customer: b.customer, rows: [] };
      g.rows.push(b);
      by.set(b.customer.id, g);
    }
    return [...by.values()].sort((a, b) => a.customer.name.localeCompare(b.customer.name));
  }, [q.data]);

  if (q.isError) return <Card><ErrorState message={(q.error as Error).message} onRetry={() => void q.refetch()} /></Card>;
  if (q.isPending) return <Card className="p-4"><Skeleton className="h-40 w-full" /></Card>;
  if (groups.length === 0) return <Card><EmptyState title="Everything delivered has been invoiced" body="Bookings appear here once their trip is delivered." /></Card>;
  return (
    <div className="space-y-4">
      {groups.map((g) => {
        const total = g.rows.reduce((s, r) => s + Number(r.amount), 0);
        return (
          <Card key={g.customer.id}>
            <div className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-3">
              <h2 className="flex-1 text-base">{g.customer.name}</h2>
              <span className="text-[13px] text-muted">{g.rows.length} booking{g.rows.length === 1 ? '' : 's'} · {fmtMoney(total)} before GST</span>
              {canPost && <Button size="sm" variant="primary" onClick={() => onInvoice(g.customer.id, g.rows.map((r) => r.bookingId))}>Invoice these</Button>}
            </div>
            <Table minWidth={720}>
              <THead>
                <Th>Booking</Th>
                <Th>Route</Th>
                <Th>Customer ref.</Th>
                <Th>Delivered</Th>
                <Th className="text-right">Freight</Th>
              </THead>
              <tbody>
                {g.rows.map((r) => (
                  <tr key={r.bookingId} className="border-b border-subtle">
                    <td className="h-10 px-4">
                      <Link to={`/bookings/${r.bookingId}`} className="font-mono text-primary hover:underline">{r.bookingNo}</Link>
                      {r.lrNumber && <span className="ml-2 font-mono text-xs text-muted">LR {r.lrNumber}</span>}
                    </td>
                    <td className="px-4">{r.originCity} → {r.destinationCity}</td>
                    <td className="px-4 text-muted">{r.customerRef ?? '—'}</td>
                    <td className="px-4 tabular-nums">{fmtDateTime(r.deliveredAt, tz)}</td>
                    <td className="px-4 text-right tabular-nums">{fmtMoney(r.amount, true)}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </Card>
        );
      })}
    </div>
  );
}

function ReceiptsTab({ customerId }: { customerId?: string }) {
  const lp = useListParams(['tab', 'customerId'] as const);
  const list = useReceipts({ page: lp.page, pageSize: 25, customerId });
  return (
    <Card>
      <div className="flex flex-wrap items-center gap-2 border-b border-line p-3">
        <CustomerFilter value={customerId} onChange={(v) => lp.update({ customerId: v })} />
      </div>
      {list.isError ? (
        <ErrorState message={(list.error as Error).message} onRetry={() => void list.refetch()} />
      ) : (
        <Table minWidth={900}>
          <THead>
            <Th>Receipt</Th>
            <Th>Customer</Th>
            <Th>Received</Th>
            <Th>Mode</Th>
            <Th className="text-right">Amount</Th>
            <Th className="text-right">TDS</Th>
            <Th>Applied to</Th>
          </THead>
          <tbody aria-busy={list.isFetching}>
            {list.isPending &&
              Array.from({ length: 6 }, (_, i) => (
                <tr key={i} className="border-b border-subtle">
                  {Array.from({ length: 7 }, (__, j) => <td key={j} className="h-11 px-4"><Skeleton className="h-3.5 w-20" /></td>)}
                </tr>
              ))}
            {list.data?.data.map((r: ReceiptDto) => (
              <tr key={r.id} className="border-b border-subtle align-top">
                <td className="h-11 px-4 py-3 font-mono text-xs">{r.receiptNo}</td>
                <td className="px-4 py-3">{r.customer.name}</td>
                <td className="px-4 py-3 tabular-nums">{fmtDate(r.receivedOn)}</td>
                <td className="px-4 py-3">
                  {RECEIPT_MODE_LABEL[r.mode]}
                  {r.reference && <div className="font-mono text-xs text-muted">{r.reference}</div>}
                </td>
                <td className="px-4 py-3 text-right tabular-nums">{fmtMoney(r.amount, true)}</td>
                <td className="px-4 py-3 text-right tabular-nums">{Number(r.tdsAmount) > 0 ? fmtMoney(r.tdsAmount, true) : '—'}</td>
                <td className="px-4 py-3">
                  <div className="flex flex-wrap gap-x-3 gap-y-1">
                    {r.allocations.map((a) => (
                      <Link key={a.invoiceId} to={`/invoices/${a.invoiceId}`} className="font-mono text-xs text-primary hover:underline">
                        {a.invoiceNo} <span className="text-muted">({fmtMoney(a.amount)})</span>
                      </Link>
                    ))}
                  </div>
                  {Number(r.unallocated) > 0 && <div className="mt-1 text-xs text-warn-strong">{fmtMoney(r.unallocated, true)} on account, not applied yet</div>}
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      {list.data && list.data.data.length === 0 && <EmptyState title="No receipts yet" body="Payments recorded against invoices are listed here." />}
      {list.data && list.data.meta.total > 0 && (
        <Pagination page={list.data.meta.page} totalPages={list.data.meta.totalPages} total={list.data.meta.total} pageSize={list.data.meta.pageSize} onPage={(p) => lp.update({ page: String(p) })} />
      )}
    </Card>
  );
}

// ------------------------------------------------------------------ new invoice

interface ExtraLine {
  description: string;
  amount: string;
}

export function NewInvoiceDrawer({ open, onClose, initial }: { open: boolean; onClose: () => void; initial: { customerId?: number; bookingIds?: number[] } }) {
  const tz = useOrgTimezone();
  const toast = useToast();
  const navigate = useNavigate();
  const [customerId, setCustomerId] = useState<number | null>(null);
  const [mode, setMode] = useState<GstMode | null>(null);
  const [invoiceDate, setInvoiceDate] = useState('');
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [extras, setExtras] = useState<ExtraLine[]>([]);
  const [notes, setNotes] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [message, setMessage] = useState<string | null>(null);

  // Reset only when the drawer opens, so a background refetch never wipes what is being typed.
  const wasOpen = useRef(false);
  useEffect(() => {
    const opening = open && !wasOpen.current;
    wasOpen.current = open;
    if (!opening) return;
    setCustomerId(initial.customerId ?? null);
    setSelected(new Set(initial.bookingIds ?? []));
    setMode(null);
    setInvoiceDate(todayIn(tz));
    setExtras([]);
    setNotes('');
    setErrors({});
    setMessage(null);
  }, [open, initial, tz]);

  const customers = useCustomers({ pageSize: 100, sort: 'name', status: 'active' });
  const customer = useCustomer(customerId);
  const org = useOrgProfile();
  const bookings = useUninvoiced(customerId ?? undefined, open && !!customerId);
  // Default to the GST treatment used on this customer's last invoice.
  const last = useInvoices({ customerId: customerId ?? undefined, pageSize: 1 }, open && !!customerId);
  const gstMode: GstMode = mode ?? last.data?.data[0]?.gstMode ?? 'rcm_5';

  const rows = bookings.data ?? [];
  const taxable = rows.filter((r) => selected.has(r.bookingId)).reduce((s, r) => s + Number(r.amount), 0) + extras.reduce((s, x) => s + (Number(x.amount) || 0), 0);
  const c = customer.data;
  const intra = c ? (c.gstin ? sameGstState(org.data?.gstin, c.gstin) : !!c.state && c.state === org.data?.state) : false;
  const tax = computeInvoiceTax(taxable.toFixed(2), gstMode, intra);

  const create = useFinanceMutation((body: unknown) => post<InvoiceDto>('/finance/invoices', body));
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!customerId) return setErrors({ customerId: 'Choose the customer' });
    setErrors({});
    setMessage(null);
    try {
      const inv = await create.mutateAsync({
        customerId,
        invoiceDate,
        gstMode,
        bookingIds: rows.filter((r) => selected.has(r.bookingId)).map((r) => r.bookingId),
        extraLines: extras.filter((x) => x.description.trim() || x.amount).map((x) => ({ description: x.description.trim(), amount: Number(x.amount) })),
        notes: notes.trim() || null,
      });
      toast.success(`Invoice ${inv.invoiceNo} raised for ${fmtMoney(inv.total, true)}`);
      onClose();
      navigate(`/invoices/${inv.id}`);
    } catch (err) {
      const r = apiFieldErrors(err);
      setErrors(r.fields);
      setMessage(r.message);
    }
  }

  const toggle = (id: number) =>
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title="New tax invoice"
      description="Bill one customer’s delivered bookings, plus any extra charges such as detention."
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" form="invoice-form" loading={create.isPending} disabled={!customerId || taxable <= 0}>
            Raise invoice{taxable > 0 ? ` for ${fmtMoney(tax.total, true)}` : ''}
          </Button>
        </>
      }
    >
      <form id="invoice-form" onSubmit={submit} noValidate className="space-y-5">
        {message && <Banner tone="crit" title="Couldn’t raise the invoice">{message}</Banner>}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Customer" required error={errors.customerId} className="sm:col-span-2">
            {(p) => (
              <Select {...p} value={customerId ?? ''} onChange={(e) => { setCustomerId(Number(e.target.value) || null); setSelected(new Set()); setMode(null); }}>
                <option value="">Choose…</option>
                {customers.data?.data.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
              </Select>
            )}
          </Field>
          <Field label="Invoice date" required error={errors.invoiceDate}>
            {(p) => <Input {...p} type="date" value={invoiceDate} max={todayIn(tz)} onChange={(e) => setInvoiceDate(e.target.value)} />}
          </Field>
          <Field label="GST treatment" required error={errors.gstMode} hint={c ? (c.gstin ? `Customer GSTIN ${c.gstin}` : 'Customer has no GSTIN on file') : undefined}>
            {(p) => (
              <Select {...p} value={gstMode} onChange={(e) => setMode(e.target.value as GstMode)}>
                {GST_MODES.map((m) => <option key={m} value={m}>{GST_MODE_LABEL[m]}</option>)}
              </Select>
            )}
          </Field>
        </div>

        {customerId && (
          <section>
            <h3 className="mb-2 text-[13px] font-semibold">Delivered bookings</h3>
            {errors.bookingIds && <p className="mb-2 text-xs text-crit-strong">{errors.bookingIds}</p>}
            {bookings.isPending ? (
              <Skeleton className="h-20 w-full" />
            ) : rows.length === 0 ? (
              <p className="rounded border border-dashed border-line px-3 py-4 text-center text-[13px] text-muted">No delivered bookings waiting for an invoice. You can still bill extra charges below.</p>
            ) : (
              <ul className="divide-y divide-line rounded border border-line">
                {rows.map((r) => (
                  <li key={r.bookingId}>
                    <label className="flex cursor-pointer items-center gap-3 px-3 py-2 text-[13px] hover:bg-canvas">
                      <input type="checkbox" className="size-4 accent-primary" checked={selected.has(r.bookingId)} onChange={() => toggle(r.bookingId)} />
                      <span className="min-w-0 flex-1">
                        <span className="font-mono">{r.bookingNo}</span>
                        {r.lrNumber && <span className="ml-2 font-mono text-xs text-muted">LR {r.lrNumber}</span>}
                        <span className="block text-xs text-muted">{r.originCity} → {r.destinationCity} · delivered {fmtDateTime(r.deliveredAt, tz)}</span>
                      </span>
                      <span className="tabular-nums">{fmtMoney(r.amount, true)}</span>
                    </label>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}

        <section>
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-[13px] font-semibold">Extra charges</h3>
            <Button size="sm" variant="ghost" onClick={() => setExtras((x) => [...x, { description: '', amount: '' }])} disabled={extras.length >= 10}>
              <Plus className="size-4" aria-hidden /> Add charge
            </Button>
          </div>
          {extras.length === 0 ? (
            <p className="text-xs text-muted">Detention, loading or other charges agreed with the customer.</p>
          ) : (
            <ul className="space-y-2">
              {extras.map((x, i) => (
                <li key={i} className="flex items-start gap-2">
                  <Input aria-label={`Charge ${i + 1} description`} placeholder="e.g. Detention, 6 hours at Hosur" value={x.description} onChange={(e) => setExtras((all) => all.map((y, j) => (j === i ? { ...y, description: e.target.value } : y)))} />
                  <Input aria-label={`Charge ${i + 1} amount`} type="number" min="0" step="0.01" placeholder="Amount" className="w-36" value={x.amount} onChange={(e) => setExtras((all) => all.map((y, j) => (j === i ? { ...y, amount: e.target.value } : y)))} />
                  <Button variant="ghost" aria-label={`Remove charge ${i + 1}`} onClick={() => setExtras((all) => all.filter((_, j) => j !== i))}><Trash2 className="size-4" /></Button>
                </li>
              ))}
            </ul>
          )}
          {Object.entries(errors).filter(([k]) => k.startsWith('extraLines')).map(([k, v]) => <p key={k} className="mt-1 text-xs text-crit-strong">{v}</p>)}
        </section>

        <Field label="Notes on the invoice" error={errors.notes}>
          {(p) => <Textarea {...p} value={notes} maxLength={500} onChange={(e) => setNotes(e.target.value)} placeholder="Optional, e.g. the purchase order or bank details" />}
        </Field>

        <section className="rounded border border-line bg-canvas p-3 text-[13px]">
          <dl className="space-y-1">
            <Row label="Taxable value (SAC 9965)" value={fmtMoney(tax.taxable, true)} />
            {gstMode === 'rcm_5' ? (
              <Row label="GST under reverse charge, paid by the customer" value={fmtMoney(tax.reverseChargeTax, true)} muted />
            ) : intra ? (
              <>
                <Row label={`CGST ${tax.rate / 2}%`} value={fmtMoney(tax.cgst, true)} />
                <Row label={`SGST ${tax.rate / 2}%`} value={fmtMoney(tax.sgst, true)} />
              </>
            ) : (
              <Row label={`IGST ${tax.rate}%`} value={fmtMoney(tax.igst, true)} />
            )}
            <div className="border-t border-line pt-1"><Row label="Invoice total" value={fmtMoney(tax.total, true)} strong /></div>
          </dl>
          {c && <p className="mt-2 text-xs text-muted">{intra ? 'Same state as your GSTIN: CGST and SGST.' : 'Different state: IGST.'} The server works out the tax again when the invoice is saved.</p>}
        </section>
      </form>
    </Drawer>
  );
}

function Row({ label, value, strong, muted }: { label: string; value: string; strong?: boolean; muted?: boolean }) {
  return (
    <div className={`flex justify-between gap-4 ${strong ? 'font-semibold' : ''} ${muted ? 'text-muted' : ''}`}>
      <dt>{label}</dt>
      <dd className="tabular-nums">{value}</dd>
    </div>
  );
}

// ------------------------------------------------------------------ receive payment

/** Records a customer payment. Opened from an invoice it settles that invoice; otherwise oldest invoices first. */
export function ReceivePaymentDialog({ open, onClose, invoice }: { open: boolean; onClose: () => void; invoice?: InvoiceDto }) {
  const tz = useOrgTimezone();
  const toast = useToast();
  const [customerId, setCustomerId] = useState<number | null>(null);
  const [receivedOn, setReceivedOn] = useState('');
  const [mode, setMode] = useState<ReceiptMode>('bank');
  const [reference, setReference] = useState('');
  const [amount, setAmount] = useState('');
  const [tds, setTds] = useState('');
  const [manual, setManual] = useState(false);
  const [alloc, setAlloc] = useState<Record<number, string>>({});
  const [errors, setErrors] = useState<FieldErrors>({});
  const [message, setMessage] = useState<string | null>(null);

  const wasOpen = useRef(false);
  useEffect(() => {
    const opening = open && !wasOpen.current;
    wasOpen.current = open;
    if (!opening) return;
    setCustomerId(invoice?.customer.id ?? null);
    setReceivedOn(todayIn(tz));
    setMode('bank');
    setReference('');
    setAmount(invoice ? invoice.outstanding : '');
    setTds('');
    setManual(!!invoice);
    setAlloc(invoice ? { [invoice.id]: invoice.outstanding } : {});
    setErrors({});
    setMessage(null);
  }, [open, invoice, tz]);

  const customers = useCustomers({ pageSize: 100, sort: 'name' });
  const openInvoices = useInvoices({ customerId: customerId ?? undefined, status: 'open', sort: 'dueDate', pageSize: 100 }, open && !!customerId);
  const outstanding = openInvoices.data?.totals.outstanding;
  const settled = (Number(amount) || 0) + (Number(tds) || 0);
  const allocated = Object.values(alloc).reduce((s, v) => s + (Number(v) || 0), 0);

  const receive = useFinanceMutation((body: unknown) => post<ReceiptDto>('/finance/receipts', body));
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!customerId) return setErrors({ customerId: 'Choose the customer' });
    setErrors({});
    setMessage(null);
    try {
      const r = await receive.mutateAsync({
        customerId,
        receivedOn,
        mode,
        reference: reference.trim() || null,
        amount: Number(amount),
        tdsAmount: Number(tds) || 0,
        allocations: manual ? Object.entries(alloc).filter(([, v]) => Number(v) > 0).map(([id, v]) => ({ invoiceId: Number(id), amount: Number(v) })) : undefined,
      });
      toast.success(`Receipt ${r.receiptNo} recorded${Number(r.unallocated) > 0 ? `; ${fmtMoney(r.unallocated, true)} kept on account` : ''}`);
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
      width="lg"
      title={invoice ? `Record payment for ${invoice.invoiceNo}` : 'Record a customer payment'}
      description="Enter the amount that reached your account. TDS the customer deducted is recorded separately and still settles the invoice."
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" form="receipt-form" loading={receive.isPending}>Record payment</Button>
        </>
      }
    >
      <form id="receipt-form" onSubmit={submit} noValidate className="space-y-4">
        {message && <Banner tone="crit" title="Couldn’t record the payment">{message}</Banner>}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Customer" required error={errors.customerId} className="sm:col-span-2" hint={outstanding !== undefined ? `Outstanding ${fmtMoney(outstanding, true)} on ${openInvoices.data?.meta.total ?? 0} open invoice(s)` : undefined}>
            {(p) => (
              <Select {...p} value={customerId ?? ''} disabled={!!invoice} onChange={(e) => { setCustomerId(Number(e.target.value) || null); setAlloc({}); }}>
                <option value="">Choose…</option>
                {customers.data?.data.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
              </Select>
            )}
          </Field>
          <Field label="Received on" required error={errors.receivedOn}>
            {(p) => <Input {...p} type="date" value={receivedOn} max={todayIn(tz)} onChange={(e) => setReceivedOn(e.target.value)} />}
          </Field>
          <Field label="Mode" required error={errors.mode}>
            {(p) => (
              <Select {...p} value={mode} onChange={(e) => setMode(e.target.value as ReceiptMode)}>
                {RECEIPT_MODES.map((m) => <option key={m} value={m}>{RECEIPT_MODE_LABEL[m]}</option>)}
              </Select>
            )}
          </Field>
          <Field label="Amount received" required error={errors.amount}>
            {(p) => <Input {...p} type="number" min="0" step="0.01" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />}
          </Field>
          <Field label="TDS deducted" error={errors.tdsAmount} hint="Usually 1–2% of the freight, per the customer’s TDS certificate">
            {(p) => <Input {...p} type="number" min="0" step="0.01" inputMode="decimal" value={tds} onChange={(e) => setTds(e.target.value)} />}
          </Field>
          <Field label="Reference" error={errors.reference} className="sm:col-span-2" hint="UTR, UPI or cheque number">
            {(p) => <Input {...p} value={reference} maxLength={80} onChange={(e) => setReference(e.target.value)} />}
          </Field>
        </div>

        {customerId && (
          <section>
            <div className="mb-2 flex flex-wrap items-center gap-3 text-[13px]">
              <span className="font-semibold">Apply to</span>
              <label className="flex items-center gap-1.5"><input type="radio" className="accent-primary" checked={!manual} onChange={() => setManual(false)} /> Oldest invoices first</label>
              <label className="flex items-center gap-1.5"><input type="radio" className="accent-primary" checked={manual} onChange={() => setManual(true)} /> Choose invoices</label>
            </div>
            {manual && (
              <>
                {openInvoices.isPending ? (
                  <Skeleton className="h-16 w-full" />
                ) : (openInvoices.data?.data.length ?? 0) === 0 ? (
                  <p className="text-[13px] text-muted">This customer has no open invoices; the payment will be kept on account.</p>
                ) : (
                  <ul className="divide-y divide-line rounded border border-line">
                    {openInvoices.data!.data.map((i) => (
                      <li key={i.id} className="flex items-center gap-3 px-3 py-2 text-[13px]">
                        <span className="min-w-0 flex-1">
                          <span className="font-mono">{i.invoiceNo}</span>
                          <span className="block text-xs text-muted">Due {fmtDate(i.dueDate)} · outstanding {fmtMoney(i.outstanding, true)}</span>
                        </span>
                        <Input
                          aria-label={`Amount for ${i.invoiceNo}`}
                          type="number"
                          min="0"
                          step="0.01"
                          className="w-36"
                          value={alloc[i.id] ?? ''}
                          onChange={(e) => setAlloc((a) => ({ ...a, [i.id]: e.target.value }))}
                        />
                      </li>
                    ))}
                  </ul>
                )}
                <p className={`mt-2 text-xs ${allocated > settled + 0.001 ? 'text-crit-strong' : 'text-muted'}`}>
                  Applied {fmtMoney(allocated, true)} of {fmtMoney(settled, true)} (amount plus TDS){allocated < settled - 0.001 ? '; the rest stays on account' : ''}.
                </p>
              </>
            )}
            {errors.allocations && <p className="mt-1 text-xs text-crit-strong">{errors.allocations}</p>}
          </section>
        )}
      </form>
    </Dialog>
  );
}
