import { Link } from 'react-router';
import { ROLE_LABELS, type ComplianceState, type VehicleStatus } from '@transaxis/shared';
import { useAuth } from '../auth/AuthProvider';
import { Card, ErrorState, PageHeader, Skeleton } from '../components/ui/Layout';
import { useFleetSummary } from '../features/vehicles/api';
import { VEHICLE_STATUS_LABEL } from '../features/vehicles/badges';
import { fmtDate } from '../lib/format';

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
