import { Link, useSearchParams } from 'react-router';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { addDays, todayIn, type TripStatus } from '@transaxis/shared';
import { useAuth } from '../../auth/AuthProvider';
import { Button } from '../../components/ui/Button';
import { ErrorState, PageHeader, Skeleton } from '../../components/ui/Layout';
import { TRIP_STATUS_LABEL } from '../../components/StatusBadges';
import { fmtDateTime } from '../../lib/format';
import { useOrgTimezone } from '../../lib/useOrgTimezone';
import { useBookings } from '../bookings/api';
import { useTrips } from '../trips/api';

const chip: Record<TripStatus, string> = {
  planned: 'border-line-strong bg-surface',
  ready: 'border-primary/40 bg-primary-soft',
  in_transit: 'border-primary bg-primary-soft',
  delivered: 'border-ok/50 bg-ok-soft',
  completed: 'border-ok/50 bg-ok-soft',
  reconciled: 'border-line bg-subtle',
  closed: 'border-line bg-subtle',
  on_hold: 'border-warn bg-warn-soft',
  cancelled: 'border-crit/40 bg-crit-soft line-through',
};

/** Monday of the week containing `date` (YYYY-MM-DD). */
function weekStart(date: string): string {
  const dow = new Date(`${date}T00:00:00Z`).getUTCDay(); // 0 = Sunday
  return addDays(date, dow === 0 ? -6 : 1 - dow);
}

const dayLabel = new Intl.DateTimeFormat('en-IN', { weekday: 'short', day: '2-digit', month: 'short', timeZone: 'UTC' });
const timeOnly = (iso: string, tz: string) => new Intl.DateTimeFormat('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: tz }).format(new Date(iso));

export function CalendarPage() {
  const tz = useOrgTimezone();
  const { can } = useAuth();
  const [params, setParams] = useSearchParams();
  const today = todayIn(tz);
  const start = weekStart(params.get('week') ?? today);
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));
  const end = days[6]!;
  const go = (week: string | null) => setParams(week ? { week } : {}, { replace: true });

  const trips = useTrips({ from: start, to: end, pageSize: 100, sort: 'plannedStart' });
  const waiting = useBookings({ unassigned: 'true', from: start, to: end, pageSize: 100, sort: 'loadingWindowStart' }, can('bookings:read'));
  const dayOf = (iso: string) => todayIn(tz, new Date(iso));

  return (
    <div>
      <PageHeader
        title="Calendar"
        subtitle={`Trips by planned start, ${dayLabel.format(new Date(`${start}T00:00:00Z`))} to ${dayLabel.format(new Date(`${end}T00:00:00Z`))}`}
        actions={
          <>
            <Button aria-label="Previous week" onClick={() => go(addDays(start, -7))}><ChevronLeft className="size-4" aria-hidden /></Button>
            <Button onClick={() => go(null)}>This week</Button>
            <Button aria-label="Next week" onClick={() => go(addDays(start, 7))}><ChevronRight className="size-4" aria-hidden /></Button>
          </>
        }
      />
      {trips.isError ? (
        <ErrorState message={(trips.error as Error).message} onRetry={() => void trips.refetch()} />
      ) : (
        <div className="overflow-x-auto">
          <div className="grid min-w-[980px] grid-cols-7 overflow-hidden rounded-lg border border-line bg-surface shadow-card">
            {days.map((d) => {
              const dayTrips = (trips.data?.data ?? []).filter((t) => dayOf(t.plannedStart) === d);
              const dayWaiting = (waiting.data?.data ?? []).filter((b) => dayOf(b.loadingWindowStart) === d);
              return (
                <section key={d} className={`min-h-64 border-r border-line last:border-r-0 ${d === today ? 'bg-primary-soft/40' : ''}`} aria-label={dayLabel.format(new Date(`${d}T00:00:00Z`))}>
                  <h2 className={`border-b border-line px-2 py-2 text-[13px] ${d === today ? 'text-primary-strong' : ''}`}>
                    {dayLabel.format(new Date(`${d}T00:00:00Z`))}
                    {(dayTrips.length > 0 || dayWaiting.length > 0) && <span className="ml-1 text-xs font-normal text-muted">({dayTrips.length})</span>}
                  </h2>
                  <ul className="space-y-1.5 p-1.5">
                    {trips.isPending && <li><Skeleton className="h-12 w-full" /></li>}
                    {dayTrips.map((t) => (
                      <li key={t.id}>
                        <Link
                          to={`/trips/${t.id}`}
                          title={`${t.tripNo} · ${TRIP_STATUS_LABEL[t.status]} · ${t.vehicle.registrationNo} · ${t.driver.fullName}\n${fmtDateTime(t.plannedStart, tz)} → ${fmtDateTime(t.plannedEnd, tz)}`}
                          className={`block rounded border px-1.5 py-1 text-xs hover:shadow-raised ${chip[t.status]}`}
                        >
                          <span className="font-semibold tabular-nums">{timeOnly(t.plannedStart, tz)}</span> <span className="font-mono">{t.tripNo.slice(-6)}</span>
                          <span className="block truncate text-muted">{t.originCity} → {t.destinationCity}</span>
                          <span className="block truncate">{t.vehicle.registrationNo}</span>
                        </Link>
                      </li>
                    ))}
                    {dayWaiting.map((b) => (
                      <li key={`b${b.id}`}>
                        <Link to={`/bookings/${b.id}`} title="Approved booking without a trip" className="block rounded border border-dashed border-warn px-1.5 py-1 text-xs hover:shadow-raised">
                          <span className="font-semibold tabular-nums">{timeOnly(b.loadingWindowStart, tz)}</span> <span className="font-mono">{b.bookingNo.slice(-6)}</span>
                          <span className="block truncate text-warn-strong">Needs a trip</span>
                          <span className="block truncate text-muted">{b.originCity} → {b.destinationCity}</span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                </section>
              );
            })}
          </div>
        </div>
      )}
      <p className="mt-2 text-xs text-muted">
        Times in {tz}. Dashed cards are approved bookings loading that day that still need a vehicle and driver.
        {trips.data && trips.data.meta.total > 100 ? ' Showing the first 100 trips of this week.' : ''}
      </p>
    </div>
  );
}
