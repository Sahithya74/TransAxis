import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, Outlet, useParams } from 'react-router';
import { ChevronLeft, Fuel, LogOut, MapPin, Navigation, Phone, Receipt, ShieldCheck, Siren, Wallet } from 'lucide-react';
import type { TripDto, TripListItemDto } from '@transaxis/shared';
import { useAuth } from '../../auth/AuthProvider';
import { TripStatusBadge } from '../../components/StatusBadges';
import { Button } from '../../components/ui/Button';
import { Dialog } from '../../components/ui/Dialog';
import { Field, Textarea } from '../../components/ui/Field';
import { EmptyState, ErrorState, Skeleton } from '../../components/ui/Layout';
import { useToast } from '../../components/ui/Toast';
import { api } from '../../lib/api';
import { apiFieldErrors } from '../../lib/forms';
import { fmtDateTime, fmtMoney, fmtRelative } from '../../lib/format';
import { useOrgTimezone } from '../../lib/useOrgTimezone';
import { useExpenses } from '../finance/api';
import { ExpenseDialog } from '../finance/ExpenseDialog';
import { ExpenseStatusBadge } from '../finance/labels';
import { FuelDialog } from '../fuel/FuelDialog';
import { IncidentDialog } from '../live/AlertActions';
import { useSafetyMutations } from '../live/api';
import { NotificationBell } from '../live/NotificationBell';
import { useTrip, useTrips } from '../trips/api';
import { EVENT_LABEL } from '../trips/labels';
import { CompleteDialog, DeliverDialog, DispatchDialog, InspectionDialog, MilestoneDialog } from '../trips/TripDialogs';

/** Mobile-first shell for drivers and helpers. */
export function DriverShell() {
  const { user, logout } = useAuth();
  return (
    <div className="min-h-screen bg-canvas">
      <header className="sticky top-0 z-20 flex h-14 items-center gap-2 bg-chrome px-4 text-white">
        <span className="grid size-8 place-items-center rounded bg-primary font-display text-sm font-bold">TX</span>
        <Link to="/driver" className="min-w-0 flex-1 leading-tight">
          <div className="font-display text-sm font-semibold">My trips</div>
          <div className="truncate text-[11px] text-chrome-text">{user?.fullName}</div>
        </Link>
        <Link to="/driver/pay" aria-label="My pay" className="rounded p-2 hover:bg-chrome-2"><Wallet className="size-5" /></Link>
        <div className="rounded bg-white text-ink"><NotificationBell /></div>
        <button onClick={() => void logout()} aria-label="Sign out" className="rounded p-2 hover:bg-chrome-2"><LogOut className="size-5" /></button>
      </header>
      <main className="mx-auto max-w-xl px-4 py-5">
        <Outlet />
      </main>
    </div>
  );
}

const ACTIVE = ['planned', 'ready', 'in_transit', 'delivered', 'on_hold'];

export function DriverHome() {
  const tz = useOrgTimezone();
  const trips = useTrips({ pageSize: 30, sort: '-plannedStart' });
  if (trips.isError) return <ErrorState message={(trips.error as Error).message} onRetry={() => void trips.refetch()} />;
  if (trips.isPending) return <Skeleton className="h-48 w-full" />;
  const all = trips.data.data;
  const active = all.filter((t) => ACTIVE.includes(t.status)).sort((a, b) => Date.parse(a.plannedStart) - Date.parse(b.plannedStart));
  const past = all.filter((t) => !ACTIVE.includes(t.status)).slice(0, 10);
  return (
    <div className="space-y-5">
      <section>
        <h1 className="mb-2 text-lg">Current and upcoming</h1>
        {active.length === 0 ? (
          <div className="rounded-lg border border-line bg-surface"><EmptyState title="No trips assigned" body="New assignments appear here. Pull down or reopen the app to refresh." /></div>
        ) : (
          <ul className="space-y-3">{active.map((t) => <TripCard key={t.id} t={t} tz={tz} />)}</ul>
        )}
      </section>
      {past.length > 0 && (
        <section>
          <h2 className="mb-2 text-base">Recent</h2>
          <ul className="space-y-2">{past.map((t) => <TripCard key={t.id} t={t} tz={tz} compact />)}</ul>
        </section>
      )}
    </div>
  );
}

function TripCard({ t, tz, compact }: { t: TripListItemDto; tz: string; compact?: boolean }) {
  return (
    <li>
      <Link to={`/driver/trips/${t.id}`} className={`block rounded-lg border border-line bg-surface shadow-card hover:border-line-strong ${compact ? 'p-3' : 'p-4'}`}>
        <div className="flex items-center justify-between gap-2">
          <span className="font-mono text-[13px] text-muted">{t.tripNo}</span>
          <TripStatusBadge status={t.status} />
        </div>
        <div className={`mt-1 font-semibold ${compact ? 'text-sm' : 'text-base'}`}>{t.originCity} → {t.destinationCity}</div>
        <div className="text-[13px] text-muted">{t.booking?.customerName ?? `${t.tripType} run`} · {t.vehicle.registrationNo}</div>
        {!compact && <div className="mt-1 text-[13px]">Starts {fmtDateTime(t.plannedStart, tz)} · due {fmtDateTime(t.plannedEnd, tz)}</div>}
      </Link>
    </li>
  );
}

type DialogId = 'pre' | 'post' | 'dispatch' | 'deliver' | 'complete' | 'milestone' | 'checkin' | 'sos' | 'incident' | 'expense' | 'fuel';

/** Expenses and fuel can be added until the trip is reconciled. */
const CLAIMABLE = ['planned', 'ready', 'in_transit', 'delivered', 'completed', 'on_hold'];

export function DriverTripPage() {
  const id = Number(useParams().id);
  const tz = useOrgTimezone();
  const q = useTrip(id);
  const [dialog, setDialog] = useState<DialogId | null>(null);
  const claims = useExpenses({ tripId: id, pageSize: 20 }, id > 0);
  const t = q.data;
  if (q.isError) return <ErrorState message={(q.error as Error).message} />;
  if (!t) return <Skeleton className="h-64 w-full" />;
  const has = (a: string) => t.availableActions.includes(a as never);
  const nextStop = t.stops.find((s) => s.status === 'pending');

  return (
    <div className="space-y-4">
      <Link to="/driver" className="inline-flex items-center gap-1 text-[13px] text-muted"><ChevronLeft className="size-4" aria-hidden /> My trips</Link>
      <div className="rounded-lg border border-line bg-surface p-4 shadow-card">
        <div className="flex items-center justify-between gap-2">
          <span className="font-mono text-[13px] text-muted">{t.tripNo}</span>
          <TripStatusBadge status={t.status} />
        </div>
        <h1 className="mt-1 text-xl">{t.originCity} → {t.destinationCity}</h1>
        <p className="text-[13px] text-muted">{t.booking ? `${t.booking.customerName} · LR ${t.booking.lrNumber ?? '—'}` : 'No booking'} · {t.vehicle.registrationNo}</p>
        {t.status === 'on_hold' && <p className="mt-2 rounded bg-warn-soft px-3 py-2 text-[13px] text-warn-strong">On hold: {t.holdReason}</p>}
      </div>

      {nextStop && (
        <div className="rounded-lg border border-line bg-surface p-4 text-[13px] shadow-card">
          <div className="text-xs font-semibold uppercase text-muted">Next stop · {nextStop.stopType}</div>
          <div className="mt-1 text-base font-semibold">{nextStop.name}</div>
          <div className="text-muted">{[nextStop.addressLine, nextStop.city].filter(Boolean).join(', ')}</div>
          <div className="mt-3 flex flex-wrap gap-2">
            {nextStop.lat != null && (
              <a className="inline-flex h-10 items-center gap-2 rounded bg-primary px-4 font-medium text-white" href={`https://www.google.com/maps/dir/?api=1&destination=${nextStop.lat},${nextStop.lng}`} target="_blank" rel="noreferrer">
                <Navigation className="size-4" aria-hidden /> Navigate
              </a>
            )}
            {nextStop.contactPhone && (
              <a className="inline-flex h-10 items-center gap-2 rounded border border-line px-4 font-medium" href={`tel:${nextStop.contactPhone.replace(/\s/g, '')}`}>
                <Phone className="size-4" aria-hidden /> {nextStop.contactName ?? 'Call'}
              </a>
            )}
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        {(t.status === 'planned' || t.status === 'ready') && <Big onClick={() => setDialog('pre')} primary={t.status === 'planned'}>Pre-trip inspection</Big>}
        {has('dispatch') && <Big onClick={() => setDialog('dispatch')} primary>Start trip</Big>}
        {t.status === 'in_transit' && <Big onClick={() => setDialog('checkin')} primary><ShieldCheck className="size-5" aria-hidden /> Check in</Big>}
        {t.status === 'in_transit' && <Big onClick={() => setDialog('milestone')}>Record milestone</Big>}
        {t.status === 'in_transit' && t.podStatus === 'pending' && <Big onClick={() => setDialog('deliver')} primary>Deliver (enter OTP)</Big>}
        {has('complete') && <Big onClick={() => setDialog('complete')} primary>Complete trip</Big>}
        {(t.status === 'delivered' || t.status === 'completed') && <Big onClick={() => setDialog('post')}>Post-trip inspection</Big>}
        {ACTIVE.includes(t.status) && <Big onClick={() => setDialog('incident')}>Report a problem</Big>}
        {CLAIMABLE.includes(t.status) && <Big onClick={() => setDialog('expense')}><Receipt className="size-5" aria-hidden /> Add expense</Big>}
        {CLAIMABLE.includes(t.status) && <Big onClick={() => setDialog('fuel')}><Fuel className="size-5" aria-hidden /> Record fuel</Big>}
      </div>

      {t.status === 'in_transit' && <LocationSharing />}

      {ACTIVE.includes(t.status) && (
        <button onClick={() => setDialog('sos')} className="flex h-14 w-full items-center justify-center gap-2 rounded-lg bg-crit text-base font-bold text-white shadow-raised active:scale-[0.99]">
          <Siren className="size-6" aria-hidden /> SOS
        </button>
      )}

      {(claims.data?.data.length ?? 0) > 0 && (
        <div className="rounded-lg border border-line bg-surface p-4 shadow-card">
          <h2 className="mb-2 text-base">My expenses on this trip</h2>
          <ul className="space-y-2 text-[13px]">
            {claims.data!.data.map((e) => (
              <li key={e.id} className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{e.category.name}</span>
                <span className="tabular-nums">{fmtMoney(e.amount, true)}</span>
                <ExpenseStatusBadge status={e.status} />
                {e.rejectionReason && <span className="w-full text-xs text-crit-strong">{e.rejectionReason}</span>}
              </li>
            ))}
          </ul>
          <Link to="/driver/pay" className="mt-2 inline-block text-[13px] text-primary">See my pay</Link>
        </div>
      )}

      <div className="rounded-lg border border-line bg-surface p-4 shadow-card">
        <h2 className="mb-2 text-base">Recent activity</h2>
        <ul className="space-y-2 text-[13px]">
          {t.events.slice(0, 8).map((e) => (
            <li key={e.id}>
              <span className="font-medium">{EVENT_LABEL[e.eventType]}</span> <span className="text-muted">· {fmtRelative(e.occurredAt)}</span>
              {e.note && <div className="text-muted">{e.note}</div>}
            </li>
          ))}
        </ul>
      </div>

      <InspectionDialog open={dialog === 'pre'} onClose={() => setDialog(null)} trip={t} type="pre_trip" />
      <InspectionDialog open={dialog === 'post'} onClose={() => setDialog(null)} trip={t} type="post_trip" />
      <DispatchDialog open={dialog === 'dispatch'} onClose={() => setDialog(null)} trip={t} />
      <DeliverDialog open={dialog === 'deliver'} onClose={() => setDialog(null)} trip={t} />
      <CompleteDialog open={dialog === 'complete'} onClose={() => setDialog(null)} trip={t} />
      <MilestoneDialog open={dialog === 'milestone'} onClose={() => setDialog(null)} trip={t} />
      <CheckinDialog open={dialog === 'checkin'} onClose={() => setDialog(null)} trip={t} />
      <SosDialog open={dialog === 'sos'} onClose={() => setDialog(null)} trip={t} />
      {dialog === 'incident' && <IncidentDialog open onClose={() => setDialog(null)} tripId={t.id} stayOnPage />}
      <ExpenseDialog open={dialog === 'expense'} onClose={() => setDialog(null)} trip={{ id: t.id, tripNo: t.tripNo }} />
      <FuelDialog open={dialog === 'fuel'} onClose={() => setDialog(null)} trip={{ id: t.id, tripNo: t.tripNo, vehicleId: t.vehicle.id, registrationNo: t.vehicle.registrationNo }} />
      <p className="text-center text-xs text-muted">Times in {tz}</p>
    </div>
  );
}

function Big({ children, onClick, primary }: { children: ReactNode; onClick: () => void; primary?: boolean }) {
  return (
    <Button variant={primary ? 'primary' : 'secondary'} onClick={onClick} className="h-14 w-full whitespace-normal text-base">
      {children}
    </Button>
  );
}

/** Current phone position, when the driver allows it. */
function currentPosition(): Promise<{ lat: number; lng: number } | null> {
  return new Promise((resolve) => {
    if (!navigator.geolocation) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 60_000 },
    );
  });
}

function CheckinDialog({ open, onClose, trip }: { open: boolean; onClose: () => void; trip: TripDto }) {
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const { checkIn } = useSafetyMutations();
  const toast = useToast();
  useEffect(() => {
    if (open) {
      setNote('');
      setError(null);
    }
  }, [open]);
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Check in"
      description="Tell the control room you are safe. Your location is attached if you allow it."
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            loading={checkIn.isPending}
            onClick={async () => {
              try {
                const pos = await currentPosition();
                await checkIn.mutateAsync({ tripId: trip.id, body: { note: note || null, ...(pos ?? {}) } });
                toast.success('Checked in. Drive safe.');
                onClose();
              } catch (err) {
                setError(apiFieldErrors(err).message);
              }
            }}
          >
            I’m safe
          </Button>
        </>
      }
    >
      {error && <p className="mb-3 text-[13px] text-crit-strong">{error}</p>}
      <Field label="Note (optional)" hint="Traffic, rest stop, fuel stop…">{(p) => <Textarea {...p} value={note} onChange={(e) => setNote(e.target.value)} maxLength={255} />}</Field>
    </Dialog>
  );
}

function SosDialog({ open, onClose, trip }: { open: boolean; onClose: () => void; trip: TripDto }) {
  const [note, setNote] = useState('');
  const [sent, setSent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { sos } = useSafetyMutations();
  useEffect(() => {
    if (open) {
      setNote('');
      setSent(null);
      setError(null);
    }
  }, [open]);
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={sent ? 'Help is being arranged' : 'Send SOS to the control room?'}
      description={sent ? undefined : 'This alerts your control room and managers immediately. It does not call the police or an ambulance.'}
      footer={
        sent ? (
          <Button variant="primary" onClick={onClose}>Close</Button>
        ) : (
          <>
            <Button onClick={onClose}>Cancel</Button>
            <Button
              variant="danger"
              loading={sos.isPending}
              onClick={async () => {
                try {
                  const pos = await currentPosition();
                  const r = await sos.mutateAsync({ tripId: trip.id, body: { note: note || null, ...(pos ?? {}) } });
                  setSent(r.message);
                } catch (err) {
                  setError(apiFieldErrors(err).message);
                }
              }}
            >
              <Siren className="size-4" aria-hidden /> Send SOS
            </Button>
          </>
        )
      }
    >
      {sent ? (
        <div className="space-y-3 text-[13px]">
          <p>{sent}</p>
          <a href="tel:112" className="flex h-12 items-center justify-center gap-2 rounded-lg bg-crit text-base font-bold text-white"><Phone className="size-5" aria-hidden /> Call 112</a>
        </div>
      ) : (
        <>
          {error && <p className="mb-3 text-[13px] text-crit-strong">{error}</p>}
          <Field label="What is happening? (optional)">{(p) => <Textarea {...p} value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} />}</Field>
          <p className="mt-3 text-[13px] text-crit-strong">If anyone is hurt or in danger, call 112 now.</p>
        </>
      )}
    </Dialog>
  );
}

/** Sends the phone's position every 30 s while this screen is open and sharing is on. */
function LocationSharing() {
  const [on, setOn] = useState(false);
  const [status, setStatus] = useState<string>('Off');
  const timer = useRef<number | null>(null);
  useEffect(() => {
    if (!on) {
      setStatus('Off');
      return;
    }
    let stopped = false;
    const send = async () => {
      const pos = await currentPosition();
      if (stopped) return;
      if (!pos) return setStatus('Location permission denied or unavailable');
      try {
        await api('/tracking/positions', { method: 'POST', body: pos });
        setStatus(`Shared ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`);
      } catch (err) {
        setStatus(apiFieldErrors(err).message);
      }
    };
    void send();
    timer.current = window.setInterval(() => void send(), 30_000);
    return () => {
      stopped = true;
      if (timer.current) window.clearInterval(timer.current);
    };
  }, [on]);
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-line bg-surface p-4 text-[13px] shadow-card">
      <div>
        <div className="flex items-center gap-1.5 font-semibold"><MapPin className="size-4" aria-hidden /> Share my location</div>
        <div className="text-muted">{status}. Only while this trip is in transit.</div>
      </div>
      <label className="inline-flex cursor-pointer items-center gap-2">
        <input type="checkbox" className="size-5" checked={on} onChange={(e) => setOn(e.target.checked)} />
        <span className="sr-only">Share my location</span>
      </label>
    </div>
  );
}
