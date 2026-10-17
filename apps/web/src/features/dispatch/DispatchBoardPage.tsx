import { useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { RefreshCw, Truck } from 'lucide-react';
import type { BookingListItemDto, TripListItemDto, TripStatus } from '@transaxis/shared';
import { useAuth } from '../../auth/AuthProvider';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { ErrorState, PageHeader, Skeleton } from '../../components/ui/Layout';
import { fmtDateTime, fmtRelative, fmtWeight } from '../../lib/format';
import { useOrgTimezone } from '../../lib/useOrgTimezone';
import { useBookings } from '../bookings/api';
import { PlanTripDrawer } from '../trips/PlanTripDrawer';
import { useTrips } from '../trips/api';

const COLUMNS: { status: TripStatus; title: string; hint: string }[] = [
  { status: 'planned', title: 'Planned', hint: 'Needs a pre-trip inspection' },
  { status: 'ready', title: 'Ready', hint: 'Inspected; dispatch when loaded' },
  { status: 'in_transit', title: 'In transit', hint: 'Delivery confirmed by consignee OTP' },
  { status: 'delivered', title: 'Delivered', hint: 'Close with the odometer on return' },
  { status: 'on_hold', title: 'On hold', hint: 'Waiting on an issue' },
];

/** Lateness relative to the plan, so the board shows what needs attention first. */
function lateness(t: TripListItemDto, now: number): { tone: 'crit' | 'warn'; text: string } | null {
  if ((t.status === 'planned' || t.status === 'ready') && Date.parse(t.plannedStart) < now) return { tone: 'warn', text: `Start overdue ${fmtRelative(t.plannedStart, now).replace(' ago', '')}` };
  if (t.status === 'in_transit' && Date.parse(t.plannedEnd) < now) return { tone: 'crit', text: `Arrival overdue ${fmtRelative(t.plannedEnd, now).replace(' ago', '')}` };
  return null;
}

export function DispatchBoardPage() {
  const { can } = useAuth();
  const tz = useOrgTimezone();
  const trips = useTrips({ active: 'true', pageSize: 100, sort: 'plannedStart' }, { refetchInterval: 30_000 });
  const queue = useBookings({ unassigned: 'true', pageSize: 100, sort: 'loadingWindowStart' }, can('bookings:read'));
  const [planning, setPlanning] = useState<BookingListItemDto | null>(null);
  const now = Date.now();

  const byStatus = useMemo(() => {
    const m = new Map<TripStatus, TripListItemDto[]>();
    for (const t of trips.data?.data ?? []) m.set(t.status, [...(m.get(t.status) ?? []), t]);
    return m;
  }, [trips.data]);
  const overdue = (trips.data?.data ?? []).filter((t) => lateness(t, now)).length;

  return (
    <div>
      <PageHeader
        title="Dispatch board"
        subtitle={
          trips.data ? (
            <span>
              {trips.data.meta.total} active trips · {queue.data?.meta.total ?? 0} bookings waiting{overdue ? <span className="text-crit-strong"> · {overdue} running late</span> : ''}
            </span>
          ) : 'Live view of planning and trips'
        }
        actions={
          <Button onClick={() => { void trips.refetch(); void queue.refetch(); }} loading={trips.isFetching && !trips.isPending}>
            <RefreshCw className="size-4" aria-hidden /> Refresh
          </Button>
        }
      />
      {trips.isError ? (
        <ErrorState message={(trips.error as Error).message} onRetry={() => void trips.refetch()} />
      ) : (
        <div className="flex gap-4 overflow-x-auto pb-4">
          {can('bookings:read') && (
            <Column title="To plan" hint="Approved bookings without a trip" count={queue.data?.meta.total} loading={queue.isPending} accent="border-t-warn">
              {queue.data?.data.map((b) => (
                <Tile key={b.id}>
                  <Link to={`/bookings/${b.id}`} className="font-mono text-[13px] text-primary hover:underline">{b.bookingNo}</Link>
                  {Date.parse(b.loadingWindowStart) < now && <div className="mt-1"><Badge tone="crit">Loading overdue</Badge></div>}
                  <div className="mt-1 font-medium">{b.customer.name}</div>
                  <div className="text-muted">{b.originCity} → {b.destinationCity} · {fmtWeight(b.totalWeightKg)}</div>
                  <div className="text-xs text-muted">Load {fmtDateTime(b.loadingWindowStart, tz)}</div>
                  {can('trips:assign') && (
                    <Button size="sm" variant="primary" className="mt-2 w-full" onClick={() => setPlanning(b)}>
                      <Truck className="size-3.5" aria-hidden /> Plan trip
                    </Button>
                  )}
                </Tile>
              ))}
              {queue.data?.data.length === 0 && <p className="px-1 text-xs text-muted">Nothing waiting.</p>}
            </Column>
          )}
          {COLUMNS.map((c) => {
            const items = byStatus.get(c.status) ?? [];
            if (c.status === 'on_hold' && items.length === 0) return null;
            return (
              <Column key={c.status} title={c.title} hint={c.hint} count={items.length} loading={trips.isPending} accent={c.status === 'in_transit' ? 'border-t-primary' : c.status === 'on_hold' ? 'border-t-warn' : c.status === 'delivered' ? 'border-t-ok' : 'border-t-line-strong'}>
                {items.map((t) => {
                  const late = lateness(t, now);
                  return (
                    <Tile key={t.id} to={`/trips/${t.id}`}>
                      <span className="font-mono text-[13px] text-primary">{t.tripNo}</span>
                      {late && <div className="mt-1"><Badge tone={late.tone}>{late.text}</Badge></div>}
                      <div className="mt-1 font-medium">{t.booking?.customerName ?? `${t.tripType} run`}</div>
                      <div className="text-muted">{t.originCity} → {t.destinationCity}</div>
                      <div className="mt-1 flex items-center justify-between gap-2 text-xs text-muted">
                        <span className="font-mono">{t.vehicle.registrationNo}</span>
                        <span className="truncate">{t.driver.fullName}</span>
                      </div>
                      <div className="text-xs text-muted">
                        {t.status === 'in_transit' ? `Due ${fmtDateTime(t.plannedEnd, tz)}` : t.status === 'delivered' ? `Delivered ${fmtDateTime(t.deliveredAt, tz)}` : `Starts ${fmtDateTime(t.plannedStart, tz)}`}
                      </div>
                    </Tile>
                  );
                })}
                {items.length === 0 && <p className="px-1 text-xs text-muted">None.</p>}
              </Column>
            );
          })}
        </div>
      )}
      {planning && <PlanTripDrawer open onClose={() => setPlanning(null)} booking={planning} />}
    </div>
  );
}

function Column({ title, hint, count, loading, accent, children }: { title: string; hint: string; count?: number; loading: boolean; accent: string; children: ReactNode }) {
  return (
    <section className={`flex w-72 shrink-0 flex-col rounded-lg border border-t-4 border-line bg-subtle/60 ${accent}`} aria-label={title}>
      <header className="px-3 pb-2 pt-3">
        <h2 className="flex items-center justify-between text-[13px]">
          {title}
          <span className="rounded bg-surface px-1.5 text-xs tabular-nums text-muted">{count ?? '…'}</span>
        </h2>
        <p className="text-xs text-muted">{hint}</p>
      </header>
      <div className="flex max-h-[70vh] flex-col gap-2 overflow-y-auto px-2 pb-2">
        {loading ? Array.from({ length: 3 }, (_, i) => <Skeleton key={i} className="h-24 w-full" />) : children}
      </div>
    </section>
  );
}

function Tile({ to, children }: { to?: string; children: ReactNode }) {
  const cls = 'block rounded border border-line bg-surface p-2.5 text-[13px] shadow-card';
  return to ? <Link to={to} className={`${cls} hover:border-line-strong`}>{children}</Link> : <div className={cls}>{children}</div>;
}
