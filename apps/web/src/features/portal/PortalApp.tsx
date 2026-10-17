import { useState, type FormEvent, type ReactNode } from 'react';
import { Link, NavLink, Outlet, useNavigate, useParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { ChevronLeft, LogOut, Printer, Search } from 'lucide-react';
import {
  BOOKING_STATUSES,
  CARGO_CATEGORIES,
  portalRequestSchema,
  type BookingDto,
  type PortalSummaryDto,
  type PortalTrackingDto,
} from '@transaxis/shared';
import { useAuth } from '../../auth/AuthProvider';
import { MapView } from '../../components/map/MapView';
import { BOOKING_STATUS_LABEL, BookingStatusBadge, TripStatusBadge } from '../../components/StatusBadges';
import { Banner } from '../../components/ui/Banner';
import { Button } from '../../components/ui/Button';
import { Field, Input, Select, Textarea } from '../../components/ui/Field';
import { Card, EmptyState, ErrorState, PageHeader, Pagination, Skeleton } from '../../components/ui/Layout';
import { StatCard } from '../../components/ui/Stat';
import { Table, THead, Th } from '../../components/ui/Table';
import { Timeline } from '../../components/ui/Timeline';
import { useToast } from '../../components/ui/Toast';
import { api } from '../../lib/api';
import { apiFieldErrors, zodFieldErrors, type FieldErrors } from '../../lib/forms';
import { fmtDate, fmtDateTime, fmtMoney, fmtRelative, fmtWeight, fromLocalInput, titleCase } from '../../lib/format';
import { useListParams } from '../../lib/useListParams';
import { useOrgTimezone } from '../../lib/useOrgTimezone';
import { useBookings } from '../bookings/api';
import { useInvoices } from '../finance/api';
import { InvoiceStatusBadge } from '../finance/labels';
import { EtaLine } from '../live/LiveMapPage';

const usePortalSummary = () => useQuery({ queryKey: ['portal', 'summary'], queryFn: ({ signal }) => api<PortalSummaryDto>('/portal/summary', { signal }) });

const useTracking = (bookingId: number) =>
  useQuery({
    queryKey: ['portal', 'tracking', bookingId],
    queryFn: ({ signal }) => api<PortalTrackingDto>(`/portal/bookings/${bookingId}/tracking`, { signal }),
    // The position moves while the goods are on the road.
    refetchInterval: (q) => (q.state.data?.position ? 30_000 : false),
  });

const NAV = [
  { to: '/portal', label: 'Overview', end: true },
  { to: '/portal/shipments', label: 'Shipments', end: false },
  { to: '/portal/invoices', label: 'Invoices', end: false },
  { to: '/portal/request', label: 'Request a shipment', end: false },
];

/** A separate, simpler shell for customers: their shipments, invoices and new requests. */
export function PortalShell() {
  const { user, organization, logout } = useAuth();
  const summary = usePortalSummary();
  return (
    <div className="min-h-screen bg-canvas">
      <header className="bg-chrome text-white">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-3 px-4">
          <span className="grid size-8 place-items-center rounded bg-primary font-display text-sm font-bold">TX</span>
          <div className="min-w-0 flex-1 leading-tight">
            <div className="truncate font-display text-sm font-semibold">{summary.data?.customer.name ?? 'Customer portal'}</div>
            <div className="truncate text-[11px] text-chrome-text">{organization?.name} · {user?.fullName}</div>
          </div>
          <button onClick={() => void logout()} className="flex items-center gap-1.5 rounded px-2 py-1.5 text-[13px] hover:bg-chrome-2">
            <LogOut className="size-4" aria-hidden /> Sign out
          </button>
        </div>
        <nav aria-label="Portal" className="mx-auto flex max-w-6xl gap-1 overflow-x-auto px-4">
          {NAV.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.end}
              className={({ isActive }) => `shrink-0 border-b-2 px-3 py-2.5 text-[13px] font-medium ${isActive ? 'border-white text-white' : 'border-transparent text-chrome-text hover:text-white'}`}
            >
              {n.label}
            </NavLink>
          ))}
        </nav>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6">
        <Outlet />
      </main>
    </div>
  );
}

export function PortalHome() {
  const tz = useOrgTimezone();
  const summary = usePortalSummary();
  const recent = useBookings({ pageSize: 8, sort: '-createdAt' });
  const s = summary.data;
  if (summary.isError) return <Card><ErrorState message={(summary.error as Error).message} onRetry={() => void summary.refetch()} /></Card>;
  return (
    <div className="space-y-5">
      <PageHeader title="Overview" subtitle="Your shipments and account at a glance" actions={<Link to="/portal/request"><Button variant="primary">Request a shipment</Button></Link>} />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Open shipments" loading={!s} value={s?.activeBookings} to="/portal/shipments" />
        <StatCard label="On the road now" loading={!s} value={s?.inTransit} to="/portal/shipments?status=in_transit" />
        <StatCard label="Delivered in the last 30 days" loading={!s} value={s?.deliveredLast30Days} />
        <StatCard label="Amount due" loading={!s} value={fmtMoney(s?.outstanding)} tone={s && Number(s.overdue) > 0 ? 'crit' : undefined} sub={s && Number(s.overdue) > 0 ? `${fmtMoney(s.overdue)} overdue` : 'Nothing overdue'} to="/portal/invoices" />
      </div>
      <Card>
        <div className="flex items-center justify-between border-b border-line px-5 py-3">
          <h2 className="text-base">Recent shipments</h2>
          <Link to="/portal/shipments" className="text-[13px] text-primary hover:underline">All shipments</Link>
        </div>
        {recent.isPending ? (
          <div className="p-4"><Skeleton className="h-32 w-full" /></div>
        ) : !recent.data?.data.length ? (
          <EmptyState title="No shipments yet" body="Request your first shipment and track it here." />
        ) : (
          <ul className="divide-y divide-line">
            {recent.data.data.map((b) => (
              <li key={b.id}>
                <Link to={`/portal/shipments/${b.id}`} className="flex flex-wrap items-center gap-3 px-5 py-3 text-[13px] hover:bg-canvas">
                  <span className="w-36 font-mono">{b.bookingNo}</span>
                  <span className="min-w-0 flex-1">{b.originCity} → {b.destinationCity}<span className="block text-xs text-muted">Loading {fmtDateTime(b.loadingWindowStart, tz)}{b.customerRef ? ` · your ref ${b.customerRef}` : ''}</span></span>
                  <BookingStatusBadge status={b.status} />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

export function PortalShipments() {
  const tz = useOrgTimezone();
  const navigate = useNavigate();
  const lp = useListParams(['status', 'q'] as const);
  const [search, setSearch] = useState(lp.values.q ?? '');
  const list = useBookings({ page: lp.page, pageSize: 20, sort: '-createdAt', status: lp.values.status, q: lp.values.q });
  return (
    <div>
      <PageHeader title="Shipments" subtitle="Track a shipment, see its proof of delivery, or print its lorry receipt" />
      <Card>
        <form
          role="search"
          className="flex flex-wrap items-center gap-2 border-b border-line p-3"
          onSubmit={(e) => {
            e.preventDefault();
            lp.update({ q: search.trim() || undefined });
          }}
        >
          <div className="relative min-w-52 flex-1 basis-64">
            <Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-muted" aria-hidden />
            <Input aria-label="Search shipments" placeholder="Booking, LR or your reference…" className="pl-8" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <Select aria-label="Status" className="w-auto" value={lp.values.status ?? ''} onChange={(e) => lp.update({ status: e.target.value || undefined })}>
            <option value="">Any status</option>
            {BOOKING_STATUSES.map((s) => <option key={s} value={s}>{BOOKING_STATUS_LABEL[s]}</option>)}
          </Select>
        </form>
        {list.isError ? (
          <ErrorState message={(list.error as Error).message} onRetry={() => void list.refetch()} />
        ) : (
          <Table minWidth={760}>
            <THead>
              <Th>Booking</Th>
              <Th>Route</Th>
              <Th>Loading</Th>
              <Th>Deliver by</Th>
              <Th>Status</Th>
            </THead>
            <tbody aria-busy={list.isFetching}>
              {list.isPending && <tr><td colSpan={5} className="p-4"><Skeleton className="h-32 w-full" /></td></tr>}
              {list.data?.data.map((b) => (
                <tr key={b.id} className="cursor-pointer border-b border-subtle hover:bg-canvas" onClick={() => navigate(`/portal/shipments/${b.id}`)}>
                  <td className="h-11 px-4">
                    <Link to={`/portal/shipments/${b.id}`} onClick={(e) => e.stopPropagation()} className="font-mono text-primary hover:underline">{b.bookingNo}</Link>
                    <div className="text-xs text-muted">{b.lrNumber ? `LR ${b.lrNumber}` : ''}{b.customerRef ? ` · ref ${b.customerRef}` : ''}</div>
                  </td>
                  <td className="px-4">{b.originCity} → {b.destinationCity}</td>
                  <td className="px-4 tabular-nums">{fmtDateTime(b.loadingWindowStart, tz)}</td>
                  <td className="px-4 tabular-nums">{fmtDateTime(b.deliveryDeadline, tz)}</td>
                  <td className="px-4"><BookingStatusBadge status={b.status} /></td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
        {list.data && list.data.data.length === 0 && <EmptyState title="No shipments match" />}
        {list.data && list.data.meta.total > 0 && (
          <Pagination page={list.data.meta.page} totalPages={list.data.meta.totalPages} total={list.data.meta.total} pageSize={list.data.meta.pageSize} onPage={(p) => lp.update({ page: String(p) })} />
        )}
      </Card>
    </div>
  );
}

export function PortalShipmentPage() {
  const id = Number(useParams().id);
  const tz = useOrgTimezone();
  const tracking = useTracking(id);
  const booking = useQuery({ queryKey: ['bookings', 'detail', id], queryFn: ({ signal }) => api<BookingDto>(`/bookings/${id}`, { signal }) });
  if (tracking.isError) return <Card><ErrorState message={(tracking.error as Error).message} onRetry={() => void tracking.refetch()} /></Card>;
  const t = tracking.data;
  const b = booking.data;
  if (!t) return <Skeleton className="h-64 w-full" />;
  const steps = [
    { id: 'req', title: 'Booked', meta: b ? fmtDateTime(b.createdAt, tz) : undefined, tone: 'ok' as const },
    ...t.milestones.map((m, i) => ({ id: `m${i}`, title: m.label, meta: fmtDateTime(m.at, tz), tone: 'ok' as const })),
    ...(t.pod ? [{ id: 'pod', title: `Delivered to ${t.pod.recipientName}`, meta: `${fmtDateTime(t.pod.deliveredAt, tz)} · ${t.pod.method === 'otp' ? 'confirmed with your one-time code' : 'confirmed by the carrier'}`, tone: 'ok' as const }] : []),
  ];

  return (
    <div>
      <Link to="/portal/shipments" className="mb-3 inline-flex items-center gap-1 text-[13px] text-primary hover:underline"><ChevronLeft className="size-4" aria-hidden /> Shipments</Link>
      <PageHeader
        title={<span className="flex flex-wrap items-center gap-3"><span className="font-mono">{t.bookingNo}</span> <BookingStatusBadge status={t.status} /></span>}
        subtitle={b ? `${b.originCity} → ${b.destinationCity}${t.lrNumber ? ` · LR ${t.lrNumber}` : ''}${b.customerRef ? ` · your ref ${b.customerRef}` : ''}` : undefined}
        actions={t.lrNumber && <Button onClick={() => window.open(`/print/lr/${id}`, '_blank', 'noopener')}><Printer className="size-4" aria-hidden /> Lorry receipt</Button>}
      />
      {t.status === 'draft' && <Banner tone="info" title="Request received">The transport team will confirm the price and plan a vehicle. You’ll see the vehicle and driver here once it is assigned.</Banner>}
      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          {t.position ? (
            <Card className="space-y-3 p-4">
              <div className="flex flex-wrap items-center gap-2 text-[13px]">
                <h2 className="text-base">Where it is now</h2>
                <span className="text-xs text-muted">updated {fmtRelative(t.position.recordedAt)}{t.position.isSimulated ? ' · demo position (simulated)' : ''}</span>
              </div>
              <MapView className="h-72" fitKey={`portal-${id}`} vehicles={[{ id, position: [t.position.lat, t.position.lng], headingDeg: null, label: t.trip?.vehicleNo ?? '', tone: 'ok', selected: true }]} />
              {t.eta && <EtaLine eta={t.eta} tz={tz} />}
            </Card>
          ) : (
            t.trip && t.trip.status !== 'delivered' && t.trip.status !== 'completed' && (
              <Card className="p-4 text-[13px] text-muted">The live position is shown once the vehicle has left with your goods.</Card>
            )
          )}
          <Card className="p-5">
            <h2 className="mb-3 text-base">Progress</h2>
            <Timeline items={steps} />
          </Card>
        </div>
        <div className="space-y-5">
          {t.trip && (
            <Card className="p-5 text-[13px]">
              <h2 className="mb-3 text-base">Vehicle</h2>
              <Detail label="Trip"><span className="font-mono">{t.trip.tripNo}</span> <TripStatusBadge status={t.trip.status} /></Detail>
              <Detail label="Vehicle number"><span className="font-mono">{t.trip.vehicleNo}</span></Detail>
              <Detail label="Driver">{t.trip.driverName}</Detail>
              <Detail label="Planned arrival">{fmtDateTime(t.trip.plannedEnd, tz)}</Detail>
              {t.trip.actualStart && <Detail label="Left at">{fmtDateTime(t.trip.actualStart, tz)}</Detail>}
              {t.trip.deliveredAt && <Detail label="Delivered">{fmtDateTime(t.trip.deliveredAt, tz)}</Detail>}
            </Card>
          )}
          {b && (
            <Card className="p-5 text-[13px]">
              <h2 className="mb-3 text-base">Goods</h2>
              {b.cargo.map((c) => (
                <Detail key={c.id} label={titleCase(c.category)}>{c.description} · {c.quantity} {c.unit} · {fmtWeight(c.weightKg)}</Detail>
              ))}
              <Detail label="Loading from">{fmtDateTime(b.loadingWindowStart, tz)}</Detail>
              <Detail label="Deliver by">{fmtDateTime(b.deliveryDeadline, tz)}</Detail>
              {b.approvedAmount && <Detail label="Agreed freight">{fmtMoney(b.approvedAmount)} plus GST</Detail>}
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="mb-2.5">
      <div className="text-xs text-muted">{label}</div>
      <div className="flex flex-wrap items-center gap-2">{children}</div>
    </div>
  );
}

export function PortalInvoices() {
  const lp = useListParams(['status'] as const);
  const status = lp.values.status ?? 'open';
  const list = useInvoices({ page: lp.page, pageSize: 20, status: status === 'all' ? undefined : status });
  return (
    <div>
      <PageHeader title="Invoices" subtitle="Tax invoices for your shipments. Quote the invoice number when you pay." />
      <Card>
        <div className="flex flex-wrap gap-1 border-b border-line p-3" role="group" aria-label="Invoice status">
          {[{ id: 'open', label: 'To pay' }, { id: 'overdue', label: 'Overdue' }, { id: 'paid', label: 'Paid' }, { id: 'all', label: 'All' }].map((f) => (
            <Button key={f.id} size="sm" variant={status === f.id ? 'primary' : 'ghost'} aria-pressed={status === f.id} onClick={() => lp.update({ status: f.id === 'open' ? undefined : f.id })}>{f.label}</Button>
          ))}
        </div>
        {list.isError ? (
          <ErrorState message={(list.error as Error).message} onRetry={() => void list.refetch()} />
        ) : (
          <Table minWidth={720}>
            <THead>
              <Th>Invoice</Th>
              <Th>Date</Th>
              <Th>Due</Th>
              <Th className="text-right">Total</Th>
              <Th className="text-right">To pay</Th>
              <Th>Status</Th>
              <Th><span className="sr-only">Print</span></Th>
            </THead>
            <tbody aria-busy={list.isFetching}>
              {list.isPending && <tr><td colSpan={7} className="p-4"><Skeleton className="h-32 w-full" /></td></tr>}
              {list.data?.data.map((i) => (
                <tr key={i.id} className="border-b border-subtle">
                  <td className="h-11 px-4 font-mono">{i.invoiceNo}</td>
                  <td className="px-4 tabular-nums">{fmtDate(i.invoiceDate)}</td>
                  <td className="px-4 tabular-nums">{fmtDate(i.dueDate)}</td>
                  <td className="px-4 text-right tabular-nums">{fmtMoney(i.total, true)}</td>
                  <td className="px-4 text-right tabular-nums">{i.status === 'cancelled' ? '—' : fmtMoney(i.outstanding, true)}</td>
                  <td className="px-4"><InvoiceStatusBadge invoice={i} /></td>
                  <td className="px-4 text-right">
                    <Button size="sm" variant="ghost" onClick={() => window.open(`/print/invoice/${i.id}`, '_blank', 'noopener')}><Printer className="size-4" aria-hidden /> View</Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
        {list.data && list.data.data.length === 0 && <EmptyState title={status === 'open' ? 'Nothing to pay' : 'No invoices'} />}
        {list.data && list.data.meta.total > 0 && (
          <>
            <Pagination page={list.data.meta.page} totalPages={list.data.meta.totalPages} total={list.data.meta.total} pageSize={list.data.meta.pageSize} onPage={(p) => lp.update({ page: String(p) })} />
            {status !== 'paid' && <p className="px-4 pb-3 text-xs text-muted">Total to pay {fmtMoney(list.data.totals.outstanding, true)}</p>}
          </>
        )}
      </Card>
    </div>
  );
}

// ------------------------------------------------------------------ shipment request

const emptyPlace = { name: '', addressLine: '', city: '', pincode: '', contactName: '', contactPhone: '' };

export function PortalRequestPage() {
  const tz = useOrgTimezone();
  const toast = useToast();
  const navigate = useNavigate();
  const [pickup, setPickup] = useState(emptyPlace);
  const [drop, setDrop] = useState(emptyPlace);
  const [v, setV] = useState({ customerRef: '', loadingWindowStart: '', deliveryDeadline: '', cargoDescription: '', category: 'general', quantity: '', unit: 'packages', weightKg: '', declaredValue: '', specialInstructions: '' });
  const [errors, setErrors] = useState<FieldErrors>({});
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof v) => (e: { target: { value: string } }) => setV((x) => ({ ...x, [k]: e.target.value }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    setMessage(null);
    const body = {
      customerRef: v.customerRef,
      pickup,
      drop,
      loadingWindowStart: fromLocalInput(v.loadingWindowStart, tz),
      deliveryDeadline: fromLocalInput(v.deliveryDeadline, tz),
      cargoDescription: v.cargoDescription,
      category: v.category,
      quantity: v.quantity,
      unit: v.unit,
      weightKg: v.weightKg,
      declaredValue: v.declaredValue === '' ? null : v.declaredValue,
      specialInstructions: v.specialInstructions,
    };
    const parsed = portalRequestSchema.safeParse(body);
    if (!parsed.success) {
      setErrors(zodFieldErrors(parsed.error));
      return;
    }
    setErrors({});
    setBusy(true);
    try {
      const b = await api<BookingDto>('/portal/requests', { method: 'POST', body: parsed.data });
      toast.success(`Request ${b.bookingNo} sent. We’ll confirm the price and vehicle.`);
      navigate(`/portal/shipments/${b.id}`);
    } catch (err) {
      const r = apiFieldErrors(err);
      setErrors(r.fields);
      setMessage(r.message);
    } finally {
      setBusy(false);
    }
  }

  const place = (title: string, prefix: 'pickup' | 'drop', value: typeof emptyPlace, onChange: (p: typeof emptyPlace) => void) => (
    <Card className="p-5">
      <h2 className="mb-3 text-base">{title}</h2>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Place name" required error={errors[`${prefix}.name`]} className="sm:col-span-2">
          {(p) => <Input {...p} value={value.name} maxLength={140} onChange={(e) => onChange({ ...value, name: e.target.value })} placeholder={prefix === 'pickup' ? 'e.g. Hosur plant, gate 2' : 'e.g. Pune distribution centre'} />}
        </Field>
        <Field label="Address" error={errors[`${prefix}.addressLine`]} className="sm:col-span-2">
          {(p) => <Input {...p} value={value.addressLine} maxLength={255} onChange={(e) => onChange({ ...value, addressLine: e.target.value })} />}
        </Field>
        <Field label="City" required error={errors[`${prefix}.city`]}>{(p) => <Input {...p} value={value.city} maxLength={80} onChange={(e) => onChange({ ...value, city: e.target.value })} />}</Field>
        <Field label="PIN code" error={errors[`${prefix}.pincode`]}>{(p) => <Input {...p} value={value.pincode} inputMode="numeric" maxLength={6} onChange={(e) => onChange({ ...value, pincode: e.target.value })} />}</Field>
        <Field label="Contact name" error={errors[`${prefix}.contactName`]}>{(p) => <Input {...p} value={value.contactName} maxLength={120} onChange={(e) => onChange({ ...value, contactName: e.target.value })} />}</Field>
        <Field label="Contact phone" error={errors[`${prefix}.contactPhone`]}>{(p) => <Input {...p} type="tel" value={value.contactPhone} onChange={(e) => onChange({ ...value, contactPhone: e.target.value })} />}</Field>
      </div>
    </Card>
  );

  return (
    <form onSubmit={submit} noValidate>
      <PageHeader title="Request a shipment" subtitle="Tell us what to move and when. The transport team confirms the price and vehicle, usually within the day." />
      {message && <Banner tone="crit" title="Couldn’t send the request">{message}</Banner>}
      <div className="grid gap-5 lg:grid-cols-2">
        {place('Pick up from', 'pickup', pickup, setPickup)}
        {place('Deliver to', 'drop', drop, setDrop)}
        <Card className="p-5 lg:col-span-2">
          <h2 className="mb-3 text-base">Goods and timing</h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="Ready for loading from" required error={errors.loadingWindowStart}>{(p) => <Input {...p} type="datetime-local" value={v.loadingWindowStart} onChange={set('loadingWindowStart')} />}</Field>
            <Field label="Deliver by" required error={errors.deliveryDeadline}>{(p) => <Input {...p} type="datetime-local" value={v.deliveryDeadline} onChange={set('deliveryDeadline')} />}</Field>
            <Field label="Your reference" error={errors.customerRef} hint="PO or indent number">{(p) => <Input {...p} value={v.customerRef} maxLength={60} onChange={set('customerRef')} />}</Field>
            <Field label="Type of goods" required error={errors.category}>
              {(p) => (
                <Select {...p} value={v.category} onChange={set('category')}>
                  {CARGO_CATEGORIES.map((c) => <option key={c} value={c}>{titleCase(c)}</option>)}
                </Select>
              )}
            </Field>
            <Field label="Description" required error={errors.cargoDescription} className="sm:col-span-2">{(p) => <Input {...p} value={v.cargoDescription} maxLength={200} onChange={set('cargoDescription')} placeholder="e.g. Auto parts in wooden crates" />}</Field>
            <Field label="Quantity" required error={errors.quantity}>{(p) => <Input {...p} type="number" min="0" value={v.quantity} onChange={set('quantity')} />}</Field>
            <Field label="Unit" required error={errors.unit}>{(p) => <Input {...p} value={v.unit} maxLength={16} onChange={set('unit')} />}</Field>
            <Field label="Total weight (kg)" required error={errors.weightKg}>{(p) => <Input {...p} type="number" min="0" value={v.weightKg} onChange={set('weightKg')} />}</Field>
            <Field label="Declared value (₹)" error={errors.declaredValue} hint="For the e-way bill and insurance">{(p) => <Input {...p} type="number" min="0" value={v.declaredValue} onChange={set('declaredValue')} />}</Field>
            <Field label="Special instructions" error={errors.specialInstructions} className="sm:col-span-2">{(p) => <Textarea {...p} value={v.specialInstructions} maxLength={2000} onChange={set('specialInstructions')} placeholder="Loading dock timings, handling, documents to carry…" />}</Field>
          </div>
        </Card>
      </div>
      <div className="mt-5 flex justify-end gap-2">
        <Link to="/portal"><Button>Cancel</Button></Link>
        <Button variant="primary" type="submit" loading={busy}>Send request</Button>
      </div>
    </form>
  );
}
