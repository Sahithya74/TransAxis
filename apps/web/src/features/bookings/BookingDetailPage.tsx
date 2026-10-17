import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { ChevronLeft, FileText, Pencil, Printer, Route as RouteIcon, Truck } from 'lucide-react';
import { RATE_BASES, bookingQuoteSchema, type BookingAction, type BookingDto } from '@transaxis/shared';
import { useAuth } from '../../auth/AuthProvider';
import { ReasonDialog } from '../../components/ReasonDialog';
import { BookingStatusBadge, TripStatusBadge } from '../../components/StatusBadges';
import { Badge } from '../../components/ui/Badge';
import { Banner } from '../../components/ui/Banner';
import { Button } from '../../components/ui/Button';
import { Dialog } from '../../components/ui/Dialog';
import { Field, Input, Select } from '../../components/ui/Field';
import { Card, EmptyState, ErrorState, PageHeader, Skeleton } from '../../components/ui/Layout';
import { Table, THead, Th } from '../../components/ui/Table';
import { useToast } from '../../components/ui/Toast';
import { ApiError } from '../../lib/api';
import { apiFieldErrors, zodFieldErrors, type FieldErrors } from '../../lib/forms';
import { fmtDateTime, fmtMoney, fmtNumber, fmtWeight, titleCase } from '../../lib/format';
import { useOrgTimezone } from '../../lib/useOrgTimezone';
import { fetchQuote } from '../parties/api';
import { PlanTripDrawer } from '../trips/PlanTripDrawer';
import { useBooking, useBookingMutations } from './api';

const ACTION_LABEL: Record<Exclude<BookingAction, 'quote' | 'approve'>, string> = {
  hold: 'Put on hold',
  resume: 'Resume',
  cancel: 'Cancel booking',
  close: 'Close booking',
};

export function BookingDetailPage() {
  const id = Number(useParams().id);
  const { can } = useAuth();
  const tz = useOrgTimezone();
  const navigate = useNavigate();
  const q = useBooking(id);
  const { act } = useBookingMutations();
  const toast = useToast();
  const [dialog, setDialog] = useState<null | 'quote' | 'approve' | 'plan' | Exclude<BookingAction, 'quote' | 'approve'>>(null);

  if (q.isError) {
    const nf = q.error instanceof ApiError && q.error.status === 404;
    return (
      <Card>
        {nf ? <EmptyState title="Booking not found" action={<Link className="text-primary hover:underline" to="/bookings">Back to bookings</Link>} /> : <ErrorState message={(q.error as Error).message} />}
      </Card>
    );
  }
  const b = q.data;
  const has = (a: BookingAction) => !!b?.availableActions.includes(a);
  const canWrite = can('bookings:write');
  const canApprove = can('bookings:approve');
  const runAction = async (action: BookingAction, reason?: string) => {
    await act.mutateAsync({ id, body: { action, ...(reason ? { reason } : {}) } });
    toast.success(`${b!.bookingNo}: ${action === 'resume' ? 'resumed' : action === 'close' ? 'closed' : action === 'hold' ? 'on hold' : 'cancelled'}`);
  };

  return (
    <div>
      <Link to="/bookings" className="mb-2 inline-flex items-center gap-1 text-[13px] text-muted hover:text-ink">
        <ChevronLeft className="size-4" aria-hidden /> Bookings
      </Link>
      <PageHeader
        title={b ? <span className="font-mono">{b.bookingNo}</span> : <Skeleton className="h-7 w-56" />}
        subtitle={b && (
          <span className="flex flex-wrap items-center gap-2">
            <BookingStatusBadge status={b.status} />
            <Link to={`/parties/customers/${b.customer.id}`} className="text-primary hover:underline">{b.customer.name}</Link>
            {b.customerRef && <span>· Ref {b.customerRef}</span>}
            {b.lrNumber && <span className="font-mono">· LR {b.lrNumber}</span>}
            {b.isHazardous && <Badge tone="crit">Hazardous</Badge>}
            {b.requiresTemperatureControl && <Badge tone="info">Temperature controlled</Badge>}
          </span>
        )}
        actions={b && (
          <>
            {b.editable && canWrite && <Button onClick={() => navigate(`/bookings/${id}/edit`)}><Pencil className="size-4" aria-hidden /> Edit</Button>}
            {has('quote') && canWrite && <Button onClick={() => setDialog('quote')}>{b.status === 'quoted' ? 'Re-quote' : 'Quote'}</Button>}
            {has('approve') && canApprove && <Button variant="primary" onClick={() => setDialog('approve')}>Approve</Button>}
            {b.status === 'approved' && !b.trip && can('trips:assign') && (
              <Button variant="primary" onClick={() => setDialog('plan')}><Truck className="size-4" aria-hidden /> Plan trip</Button>
            )}
            {has('resume') && canWrite && <Button onClick={() => setDialog('resume')}>Resume</Button>}
            {has('hold') && canWrite && <Button onClick={() => setDialog('hold')}>Hold</Button>}
            {has('close') && canApprove && <Button onClick={() => setDialog('close')}>Close</Button>}
            {has('cancel') && canWrite && <Button variant="danger" onClick={() => setDialog('cancel')}>Cancel</Button>}
            {b.lrNumber && (
              <Button onClick={() => window.open(`/print/lr/${id}`, '_blank', 'noopener')}><Printer className="size-4" aria-hidden /> Lorry receipt</Button>
            )}
          </>
        )}
      />

      {b?.status === 'on_hold' && b.holdReason && <Banner tone="warn" title="On hold">{b.holdReason}</Banner>}
      {b?.status === 'cancelled' && b.cancelReason && <Banner tone="crit" title="Cancelled">{b.cancelReason}</Banner>}

      {!b ? (
        <Skeleton className="h-72 w-full" />
      ) : (
        <div className="grid gap-5 lg:grid-cols-3">
          <div className="space-y-5 lg:col-span-2">
            <Card className="p-5">
              <h2 className="mb-3 text-base">Schedule and requirements</h2>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-[13px] sm:grid-cols-3">
                <Item label="Loading from">{fmtDateTime(b.loadingWindowStart, tz)}</Item>
                <Item label="Loading until">{fmtDateTime(b.loadingWindowEnd, tz)}</Item>
                <Item label="Deliver by">{fmtDateTime(b.deliveryDeadline, tz)}</Item>
                <Item label="Vehicle type">{b.requiredVehicleType?.name ?? 'Any'}</Item>
                <Item label="Body type">{b.requiredBodyType ? titleCase(b.requiredBodyType) : 'Any'}</Item>
                <Item label="Payment terms">{b.paymentTermsDays != null ? `${b.paymentTermsDays} days` : 'Customer default'}</Item>
                <Item label="E-way bill">{b.ewayBillNo ? <span className="font-mono">{b.ewayBillNo}</span> : '—'}</Item>
                <Item label="E-way bill expires">{fmtDateTime(b.ewayBillExpiresAt, tz)}</Item>
                <Item label="Total weight">{fmtWeight(b.totalWeightKg)}{b.totalVolumeCbm ? ` · ${fmtNumber(b.totalVolumeCbm)} m³` : ''}</Item>
              </dl>
            </Card>

            <Card>
              <div className="border-b border-line px-5 py-3"><h2 className="text-base">Stops</h2></div>
              <ol className="divide-y divide-line">
                {b.stops.map((s) => (
                  <li key={s.id} className="flex gap-3 px-5 py-3 text-[13px]">
                    <span className={`mt-0.5 h-5 shrink-0 rounded px-1.5 text-xs font-semibold uppercase leading-5 ${s.stopType === 'pickup' ? 'bg-primary-soft text-primary-strong' : s.stopType === 'drop' ? 'bg-ok-soft text-ok-strong' : 'bg-subtle text-muted'}`}>
                      {s.stopType}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="font-medium">{s.name}</div>
                      <div className="text-muted">{[s.addressLine, s.city, s.state, s.pincode].filter(Boolean).join(', ')}</div>
                      {(s.contactName || s.contactPhone) && <div className="text-muted">Contact: {[s.contactName, s.contactPhone].filter(Boolean).join(' · ')}</div>}
                      {s.instructions && <div className="mt-1 text-ink/80">{s.instructions}</div>}
                    </div>
                    {(s.windowStart || s.windowEnd) && (
                      <div className="shrink-0 text-right text-xs text-muted">
                        {s.windowStart && <div>{s.windowEnd ? '' : 'from '}{fmtDateTime(s.windowStart, tz)}</div>}
                        {s.windowEnd && <div>{s.windowStart ? 'to' : 'by'} {fmtDateTime(s.windowEnd, tz)}</div>}
                      </div>
                    )}
                  </li>
                ))}
              </ol>
            </Card>

            <Card>
              <div className="border-b border-line px-5 py-3"><h2 className="text-base">Cargo</h2></div>
              <Table minWidth={640}>
                <THead><Th>Description</Th><Th>Category</Th><Th className="text-right">Quantity</Th><Th className="text-right">Weight</Th><Th className="text-right">Declared value</Th></THead>
                <tbody>
                  {b.cargo.map((c) => (
                    <tr key={c.id} className="border-b border-subtle align-top">
                      <td className="px-4 py-2.5">
                        <div className="font-medium">{c.description}</div>
                        <div className="text-xs text-muted">{[c.hsnCode && `HSN ${c.hsnCode}`, c.packaging, c.handling].filter(Boolean).join(' · ')}</div>
                      </td>
                      <td className="px-4 py-2.5">{c.category === 'hazardous' ? <Badge tone="crit">Hazardous</Badge> : titleCase(c.category)}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums">{fmtNumber(c.quantity)} {c.unit}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums">{fmtWeight(c.weightKg)}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums">{fmtMoney(c.declaredValue)}</td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </Card>

            {(b.specialInstructions || b.notes) && (
              <Card className="p-5 text-[13px]">
                {b.specialInstructions && (
                  <>
                    <h2 className="mb-1 text-base">Special instructions</h2>
                    <p className="whitespace-pre-line">{b.specialInstructions}</p>
                  </>
                )}
                {b.notes && (
                  <>
                    <h2 className={`mb-1 text-base ${b.specialInstructions ? 'mt-4' : ''}`}>Internal notes</h2>
                    <p className="whitespace-pre-line text-muted">{b.notes}</p>
                  </>
                )}
              </Card>
            )}
          </div>

          <div className="space-y-5">
            <Card className="p-5">
              <h2 className="mb-3 text-base">Trip</h2>
              {b.trip ? (
                <Link to={`/trips/${b.trip.id}`} className="flex items-center justify-between rounded border border-line p-3 hover:bg-canvas">
                  <span className="flex items-center gap-2"><RouteIcon className="size-4 text-muted" aria-hidden /><span className="font-mono text-primary">{b.trip.tripNo}</span></span>
                  <TripStatusBadge status={b.trip.status} />
                </Link>
              ) : b.status === 'approved' ? (
                <div className="text-[13px]">
                  <p className="text-warn-strong">Approved and waiting for a vehicle and driver.</p>
                  {can('trips:assign') && <Button className="mt-3 w-full" variant="primary" onClick={() => setDialog('plan')}><Truck className="size-4" aria-hidden /> Plan trip</Button>}
                </div>
              ) : (
                <p className="text-[13px] text-muted">{['draft', 'quoted'].includes(b.status) ? 'A trip can be planned once the booking is approved.' : 'No trip.'}</p>
              )}
            </Card>

            <Card>
              <div className="border-b border-line px-5 py-3"><h2 className="text-base">Pricing</h2></div>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-3 px-5 py-4 text-[13px]">
                <Item label="Rate">{b.rateBasis && b.rate ? `${fmtMoney(b.rate, true)} ${titleCase(b.rateBasis)}` : '—'}</Item>
                <Item label="Quoted">{fmtMoney(b.quotedAmount)}</Item>
                <Item label="Approved"><span className={b.approvedAmount ? 'text-ok-strong' : ''}>{fmtMoney(b.approvedAmount)}</span></Item>
                <Item label="Approved on">{fmtDateTime(b.approvedAt, tz)}</Item>
              </dl>
              {b.charges.length > 0 && (
                <ul className="divide-y divide-line border-t border-line text-[13px]">
                  {b.charges.map((c) => (
                    <li key={c.id} className="flex items-start justify-between gap-3 px-5 py-2">
                      <span>
                        {titleCase(c.chargeType)}
                        {c.description && c.description.toLowerCase() !== titleCase(c.chargeType).toLowerCase() && <span className="block text-xs text-muted">{c.description}</span>}
                      </span>
                      <span className="tabular-nums">{fmtMoney(c.amount)}</span>
                    </li>
                  ))}
                </ul>
              )}
              <p className="border-t border-line px-5 py-2 text-xs text-muted">Amounts exclude GST, which is added on the invoice.</p>
            </Card>

            <Card className="p-5 text-[13px]">
              <h2 className="mb-2 text-base">Documents</h2>
              {b.lrNumber ? (
                <a href={`/print/lr/${id}`} target="_blank" rel="noopener" className="flex items-center gap-2 text-primary hover:underline">
                  <FileText className="size-4" aria-hidden /> Lorry receipt {b.lrNumber}
                </a>
              ) : (
                <p className="text-muted">The lorry receipt number is issued when a trip is planned.</p>
              )}
              {b.trip && (
                <a href={`/print/trip/${b.trip.id}`} target="_blank" rel="noopener" className="mt-2 flex items-center gap-2 text-primary hover:underline">
                  <FileText className="size-4" aria-hidden /> Trip sheet {b.trip.tripNo}
                </a>
              )}
            </Card>
          </div>
        </div>
      )}

      {b && <QuoteDialog open={dialog === 'quote'} onClose={() => setDialog(null)} booking={b} />}
      {b && <ApproveDialog open={dialog === 'approve'} onClose={() => setDialog(null)} booking={b} />}
      {b && dialog === 'plan' && <PlanTripDrawer open onClose={() => setDialog(null)} booking={b} />}
      {b && (['hold', 'resume', 'cancel', 'close'] as const).map((a) => (
        <ReasonDialog
          key={a}
          open={dialog === a}
          onClose={() => setDialog(null)}
          title={`${ACTION_LABEL[a]}: ${b.bookingNo}`}
          description={
            a === 'cancel'
              ? b.trip ? `Trip ${b.trip.tripNo} has not left yet and will be cancelled too.` : 'The booking stays on record as cancelled.'
              : a === 'hold' ? 'Held bookings cannot be planned until resumed.' : undefined
          }
          confirmLabel={ACTION_LABEL[a]}
          danger={a === 'cancel'}
          reasonRequired={a === 'hold' || a === 'cancel'}
          onConfirm={(reason) => runAction(a, reason || undefined)}
        />
      ))}
    </div>
  );
}

function Item({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="mt-0.5 font-medium">{children}</dd>
    </div>
  );
}

function QuoteDialog({ open, onClose, booking }: { open: boolean; onClose: () => void; booking: BookingDto }) {
  const [form, setForm] = useState({ rateBasis: booking.rateBasis ?? 'per_tonne', rate: booking.rate ?? '', distanceKm: '' });
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const [looking, setLooking] = useState(false);
  const { quote } = useBookingMutations();
  const toast = useToast();
  useEffect(() => {
    if (open) {
      setForm({ rateBasis: booking.rateBasis ?? 'per_tonne', rate: booking.rate ?? '', distanceKm: '' });
      setErrors({});
      setFormError(null);
      setHint(null);
    }
  }, [open, booking]);

  // Pre-fills from the customer's active rate card for this lane, when one exists.
  async function applyRateCard() {
    setLooking(true);
    try {
      const r = await fetchQuote({
        customerId: booking.customer.id,
        originCity: booking.originCity,
        destinationCity: booking.destinationCity,
        totalWeightKg: booking.totalWeightKg,
        vehicleTypeId: booking.requiredVehicleType?.id,
      });
      if (r.rateCard) {
        setForm((f) => ({ ...f, rateBasis: r.rateCard!.rateBasis, rate: r.rateCard!.rate }));
        setHint(`${r.message}${r.quote ? ` Estimated total ${fmtMoney(r.quote.total)}.` : ''}`);
      } else {
        setHint(r.message);
      }
    } catch (err) {
      setHint(apiFieldErrors(err).message);
    } finally {
      setLooking(false);
    }
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const parsed = bookingQuoteSchema.safeParse({ ...form, distanceKm: form.distanceKm || undefined });
    if (!parsed.success) return setErrors(zodFieldErrors(parsed.error));
    setErrors({});
    try {
      const saved = await quote.mutateAsync({ id: booking.id, body: parsed.data });
      toast.success(`Quoted ${fmtMoney(saved.quotedAmount)} for ${saved.bookingNo}`);
      onClose();
    } catch (err) {
      const r = apiFieldErrors(err);
      setErrors(r.fields);
      setFormError(r.message);
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={`Quote ${booking.bookingNo}`}
      description={`${booking.originCity} → ${booking.destinationCity} · ${fmtWeight(booking.totalWeightKg)}. Loading and other charges on the booking are added to the freight.`}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" type="submit" form="quote-form" loading={quote.isPending}>Save quote</Button></>}
    >
      <form id="quote-form" onSubmit={onSubmit} noValidate className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {formError && <div role="alert" className="rounded border border-crit/30 bg-crit-soft px-3 py-2 text-[13px] text-crit-strong sm:col-span-2">{formError}</div>}
        <div className="flex items-center justify-between gap-3 rounded border border-line bg-canvas px-3 py-2 text-[13px] sm:col-span-2">
          <span className="text-muted">{hint ?? 'Use the customer’s rate card for this lane, or enter a rate.'}</span>
          <Button size="sm" onClick={() => void applyRateCard()} loading={looking}>Use rate card</Button>
        </div>
        <Field label="Rate basis" required error={errors.rateBasis}>
          {(p) => (
            <Select {...p} value={form.rateBasis} onChange={(e) => setForm({ ...form, rateBasis: e.target.value as typeof form.rateBasis })}>
              {RATE_BASES.map((r) => <option key={r} value={r}>{titleCase(r)}</option>)}
            </Select>
          )}
        </Field>
        <Field label="Rate (₹)" required error={errors.rate}>{(p) => <Input {...p} inputMode="decimal" value={form.rate} onChange={(e) => setForm({ ...form, rate: e.target.value })} />}</Field>
        {form.rateBasis === 'per_km' && (
          <Field label="Distance (km)" error={errors.distanceKm} hint="Leave blank to use the booking’s route distance." className="sm:col-span-2">
            {(p) => <Input {...p} inputMode="decimal" value={form.distanceKm} onChange={(e) => setForm({ ...form, distanceKm: e.target.value })} />}
          </Field>
        )}
      </form>
    </Dialog>
  );
}

function ApproveDialog({ open, onClose, booking }: { open: boolean; onClose: () => void; booking: BookingDto }) {
  const [amount, setAmount] = useState(booking.quotedAmount ?? '');
  const [error, setError] = useState<string | null>(null);
  const { act } = useBookingMutations();
  const toast = useToast();
  useEffect(() => {
    if (open) {
      setAmount(booking.quotedAmount ?? '');
      setError(null);
    }
  }, [open, booking]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const n = Number(amount);
    if (!Number.isFinite(n) || n <= 0) return setError('Enter the agreed amount');
    try {
      await act.mutateAsync({ id: booking.id, body: { action: 'approve', approvedAmount: n } });
      toast.success(`${booking.bookingNo} approved for ${fmtMoney(n)}. It is now waiting for a trip.`);
      onClose();
    } catch (err) {
      const r = apiFieldErrors(err);
      setError(r.fields.approvedAmount ?? r.message);
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={`Approve ${booking.bookingNo}`}
      description="Approval fixes the freight amount agreed with the customer and releases the booking for trip planning."
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" type="submit" form="approve-form" loading={act.isPending}>Approve</Button></>}
    >
      <form id="approve-form" onSubmit={onSubmit} noValidate>
        <Field label="Agreed amount (₹, before GST)" required error={error ?? undefined} hint={booking.quotedAmount ? `Quoted: ${fmtMoney(booking.quotedAmount)}` : undefined}>
          {(p) => <Input {...p} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />}
        </Field>
      </form>
    </Dialog>
  );
}
