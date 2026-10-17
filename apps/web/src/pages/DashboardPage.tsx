import { Link } from 'react-router';
import { ROLE_LABELS, todayIn, type ComplianceState, type VehicleStatus } from '@transaxis/shared';
import { useAuth } from '../auth/AuthProvider';
import { Card, ErrorState, PageHeader, Skeleton } from '../components/ui/Layout';
import { StatCard } from '../components/ui/Stat';
import { useBookings } from '../features/bookings/api';
import { useFinanceSummary } from '../features/finance/api';
import { useLiveSummary } from '../features/live/api';
import { useSchedules, useWorkOrders } from '../features/maintenance/api';
import { useTrips } from '../features/trips/api';
import { useFleetSummary } from '../features/vehicles/api';
import { VEHICLE_STATUS_LABEL } from '../features/vehicles/badges';
import { fmtDate, fmtMoney, fmtNumber } from '../lib/format';
import { useOrgTimezone } from '../lib/useOrgTimezone';

const statusOrder: VehicleStatus[] = ['available', 'assigned', 'on_trip', 'under_maintenance', 'unavailable', 'retired'];
const statusBar: Record<VehicleStatus, string> = {
  available: 'bg-ok',
  assigned: 'bg-primary',
  on_trip: 'bg-primary-strong',
  under_maintenance: 'bg-warn',
  unavailable: 'bg-warn-strong',
  retired: 'bg-line-strong',
};
const complianceMeta: { key: ComplianceState; label: string; tone: string; filter?: string }[] = [
  { key: 'expired', label: 'Expired document', tone: 'text-crit-strong', filter: 'expired' },
  { key: 'missing', label: 'Missing documents', tone: 'text-crit-strong' },
  { key: 'expiring', label: 'Expiring soon', tone: 'text-warn-strong', filter: 'expiring' },
  { key: 'ok', label: 'Fully compliant', tone: 'text-ok-strong', filter: 'ok' },
];

export function DashboardPage() {
  const { user, organization, can } = useAuth();
  const canFleet = can('vehicles:read');
  const summary = useFleetSummary(canFleet);

  return (
    <div>
      <PageHeader
        title={`Welcome, ${user?.fullName?.split(' ')[0] ?? ''}`}
        subtitle={`${organization?.name} · ${user?.roles.map((r) => ROLE_LABELS[r]).join(', ')}`}
      />

      <Highlights />

      {canFleet ? (
        <div className="grid gap-5 lg:grid-cols-2">
          <Card className="p-5">
            <div className="mb-3 flex items-baseline justify-between">
              <h2 className="text-base">Fleet status</h2>
              {summary.data && <span className="text-xs text-muted">{summary.data.total} vehicles</span>}
            </div>
            {summary.isError ? (
              <ErrorState message={(summary.error as Error).message} onRetry={() => void summary.refetch()} />
            ) : !summary.data ? (
              <Skeleton className="h-24 w-full" />
            ) : (
              <>
                <div className="mb-4 flex h-2.5 overflow-hidden rounded-full bg-subtle" role="img" aria-label="Fleet status distribution">
                  {statusOrder.map((s) =>
                    summary.data.byStatus[s] ? (
                      <span key={s} className={statusBar[s]} style={{ width: `${(summary.data.byStatus[s] / summary.data.total) * 100}%` }} />
                    ) : null,
                  )}
                </div>
                <ul className="grid grid-cols-2 gap-x-4 gap-y-2 text-[13px] sm:grid-cols-3">
                  {statusOrder.map((s) => (
                    <li key={s}>
                      <Link to={`/vehicles?status=${s}`} className="group flex items-center gap-2">
                        <span className={`size-2 rounded-full ${statusBar[s]}`} aria-hidden />
                        <span className="text-muted group-hover:text-ink">{VEHICLE_STATUS_LABEL[s]}</span>
                        <span className="ml-auto font-semibold tabular-nums">{summary.data.byStatus[s]}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </Card>

          <Card className="p-5">
            <div className="mb-3 flex items-baseline justify-between">
              <h2 className="text-base">Vehicle compliance</h2>
              {summary.data && (
                <span className="text-xs text-muted">
                  As of {fmtDate(summary.data.asOf)} · warning window {summary.data.expiryWarningDays} days
                </span>
              )}
            </div>
            {!summary.data ? (
              <Skeleton className="h-24 w-full" />
            ) : (
              <ul className="grid grid-cols-2 gap-3">
                {complianceMeta.map((c) => {
                  const body = (
                    <>
                      <div className={`text-2xl font-semibold tabular-nums ${c.tone}`}>{summary.data.compliance[c.key]}</div>
                      <div className="text-[13px] text-muted">{c.label}</div>
                    </>
                  );
                  return (
                    <li key={c.key} className="rounded border border-line p-3">
                      {c.filter ? <Link to={`/vehicles?compliance=${c.filter}`} className="block hover:opacity-80">{body}</Link> : body}
                    </li>
                  );
                })}
              </ul>
            )}
            <p className="mt-3 text-xs text-muted">
              Counts exclude retired vehicles. Mandatory: RC, insurance, fitness, permit and PUC.
            </p>
          </Card>
        </div>
      ) : (
        <Card className="p-5 text-[13px] text-muted">
          Your workspace will show your assigned trips and tasks as those modules come online.
        </Card>
      )}
    </div>
  );
}

/** The few numbers each role acts on first, each linking to where the work is done. */
function Highlights() {
  const { can } = useAuth();
  const today = todayIn(useOrgTimezone());
  const ops = can('trips:read');
  const safety = can('alerts:read', 'tracking:read');
  const finance = can('finance:read');
  const workshop = can('maintenance:read');
  const onRoad = useTrips({ status: 'in_transit', pageSize: 1 }, { enabled: ops });
  const waiting = useBookings({ unassigned: 'true', pageSize: 1 }, ops && can('bookings:read'));
  const live = useLiveSummary(safety);
  const money = useFinanceSummary(`${today.slice(0, 7)}-01`, today, finance);
  const jobs = useWorkOrders({ status: 'in_progress', pageSize: 1 }, workshop);
  const due = useSchedules({ due: 'due' }, workshop);
  if (!ops && !safety && !finance && !workshop) return null;

  const s = money.data;
  const alerts = live.data ? live.data.openAlerts.critical + live.data.openAlerts.warning : undefined;
  const overdueServices = due.data?.filter((x) => x.due.status === 'overdue').length;
  return (
    <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
      {ops && <StatCard label="Trips on the road" loading={!onRoad.data} value={fmtNumber(onRoad.data?.meta.total)} to="/trips?status=in_transit" />}
      {ops && can('bookings:read') && (
        <StatCard label="Bookings waiting for a trip" loading={!waiting.data} value={fmtNumber(waiting.data?.meta.total)} tone={waiting.data?.meta.total ? 'warn' : undefined} to="/dispatch" />
      )}
      {safety && (
        <StatCard
          label="Open safety alerts"
          loading={!live.data}
          value={fmtNumber(alerts)}
          tone={live.data?.openAlerts.critical ? 'crit' : alerts ? 'warn' : undefined}
          sub={live.data && (live.data.openAlerts.critical ? `${live.data.openAlerts.critical} critical` : 'None critical')}
          to="/control-room"
        />
      )}
      {finance && <StatCard label="Collected this month" loading={!s} value={fmtMoney(s?.collected)} sub={s && `Revenue earned ${fmtMoney(s.revenueEarned)}`} to="/finance" />}
      {finance && (
        <StatCard label="Overdue from customers" loading={!s} value={fmtMoney(s?.overdue)} tone={s && Number(s.overdue) > 0 ? 'crit' : undefined} sub={s && `${fmtMoney(s.outstanding)} outstanding`} to="/invoices?status=overdue" />
      )}
      {finance && can('finance:post') && (
        <StatCard label="Expense claims to approve" loading={!s} value={fmtNumber(s?.pending.expenses)} tone={s?.pending.expenses ? 'warn' : undefined} sub={s && fmtMoney(s.pending.expenseAmount)} to="/expenses" />
      )}
      {workshop && <StatCard label="Vehicles in the workshop" loading={!jobs.data} value={fmtNumber(jobs.data?.meta.total)} to="/maintenance?status=in_progress" />}
      {workshop && (
        <StatCard label="Services overdue" loading={!due.data} value={fmtNumber(overdueServices)} tone={overdueServices ? 'crit' : undefined} sub={due.data && `${due.data.length - (overdueServices ?? 0)} due soon`} to="/maintenance?tab=schedule" />
      )}
    </div>
  );
}
