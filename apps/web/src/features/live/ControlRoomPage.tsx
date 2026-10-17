import { useEffect, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router';
import { MapPin, Phone, Siren } from 'lucide-react';
import type { SafetyAlertDto } from '@transaxis/shared';
import { Badge } from '../../components/ui/Badge';
import { Card, EmptyState, ErrorState, PageHeader, Skeleton } from '../../components/ui/Layout';
import { fmtDateTime, fmtRelative } from '../../lib/format';
import { useOrgTimezone } from '../../lib/useOrgTimezone';
import { useAlerts, useCheckins, useIncidents, useLiveSummary } from './api';
import { AlertActions } from './AlertActions';
import { ALERT_TYPE_LABEL, AlertStatusBadge, IncidentStatusBadge, SeverityBadge, SimulatedBadge } from './badges';

export function ControlRoomPage() {
  const tz = useOrgTimezone();
  const [params] = useSearchParams();
  const focus = Number(params.get('alert')) || null;
  const summary = useLiveSummary();
  const alerts = useAlerts({ status: 'active', sort: 'severity', pageSize: 50 });
  const missed = useCheckins({ status: 'missed' });
  const incidents = useIncidents({ status: 'active', sort: 'severity', pageSize: 20 });

  useEffect(() => {
    if (focus && alerts.data) document.getElementById(`alert-${focus}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [focus, alerts.data]);

  const s = summary.data;
  return (
    <div>
      <PageHeader
        title={<span className="flex items-center gap-3">Control room {s?.simulated && <SimulatedBadge />}</span>}
        subtitle="Safety alerts, missed check-ins and open incidents across the fleet. Refreshes automatically."
      />
      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Tile label="Critical alerts" value={s?.openAlerts.critical} tone={s?.openAlerts.critical ? 'text-crit-strong' : undefined} />
        <Tile label="Warnings" value={s?.openAlerts.warning} tone={s?.openAlerts.warning ? 'text-warn-strong' : undefined} />
        <Tile label="Active incidents" value={s?.activeIncidents} tone={s?.activeIncidents ? 'text-crit-strong' : undefined} />
        <Tile label="Missed check-ins" value={s?.missedCheckins} tone={s?.missedCheckins ? 'text-warn-strong' : undefined} />
        <Tile label="Vehicles reporting" value={s?.live} />
        <Tile label="No recent position" value={s?.stale} tone={s?.stale ? 'text-warn-strong' : undefined} />
      </div>

      <div className="grid gap-5 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <div className="flex items-center justify-between border-b border-line px-5 py-3">
            <h2 className="text-base">Alert queue</h2>
            <Link to="/alerts" className="text-[13px] text-primary hover:underline">All alerts</Link>
          </div>
          {alerts.isError ? (
            <ErrorState message={(alerts.error as Error).message} onRetry={() => void alerts.refetch()} />
          ) : alerts.isPending ? (
            <div className="space-y-2 p-4">{Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-16 w-full" />)}</div>
          ) : alerts.data.data.length === 0 ? (
            <EmptyState title="No active alerts" body="New alerts appear here as soon as the tracking rules raise them." />
          ) : (
            <ul className="divide-y divide-line">
              {alerts.data.data.map((a) => <AlertRow key={a.id} a={a} tz={tz} focused={a.id === focus} />)}
            </ul>
          )}
        </Card>

        <div className="space-y-5">
          <Card>
            <div className="border-b border-line px-5 py-3"><h2 className="text-base">Missed check-ins</h2></div>
            {missed.data?.length ? (
              <ul className="divide-y divide-line">
                {missed.data.map((c) => (
                  <li key={c.id} className="px-5 py-3 text-[13px]">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium">{c.worker.fullName}</span>
                      <a href={`tel:${c.worker.phone.replace(/\s/g, '')}`} className="inline-flex items-center gap-1 text-primary hover:underline"><Phone className="size-3.5" aria-hidden /> {c.worker.phone}</a>
                    </div>
                    <div className="text-muted">
                      <Link to={`/trips/${c.trip.id}`} className="font-mono text-primary hover:underline">{c.trip.tripNo}</Link> · due {fmtDateTime(c.dueAt, tz)} ({fmtRelative(c.dueAt)})
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="px-5 py-4 text-[13px] text-muted">{missed.isPending ? 'Loading…' : 'Every driver on the road has checked in.'}</p>
            )}
          </Card>

          <Card>
            <div className="flex items-center justify-between border-b border-line px-5 py-3">
              <h2 className="text-base">Active incidents</h2>
              <Link to="/incidents" className="text-[13px] text-primary hover:underline">All incidents</Link>
            </div>
            {incidents.data?.data.length ? (
              <ul className="divide-y divide-line">
                {incidents.data.data.map((i) => (
                  <li key={i.id}>
                    <Link to={`/incidents/${i.id}`} className="block px-5 py-3 text-[13px] hover:bg-canvas">
                      <div className="flex flex-wrap items-center gap-2">
                        {i.incidentType === 'sos' && <Siren className="size-4 text-crit" aria-label="SOS" />}
                        <span className="font-mono text-primary">{i.incidentNo}</span>
                        <SeverityBadge severity={i.severity} />
                        <IncidentStatusBadge status={i.status} />
                      </div>
                      <div className="mt-0.5 font-medium">{i.title}</div>
                      <div className="text-xs text-muted">{fmtRelative(i.reportedAt)}{i.assignedTo ? ` · ${i.assignedTo.fullName}` : ' · unassigned'}</div>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="px-5 py-4 text-[13px] text-muted">{incidents.isPending ? 'Loading…' : 'No open incidents.'}</p>
            )}
          </Card>
          <p className="px-1 text-xs text-muted">SOS alerts reach this room only. TransAxis never contacts emergency services; the driver app tells drivers to call 112.</p>
        </div>
      </div>
    </div>
  );
}

function AlertRow({ a, tz, focused }: { a: SafetyAlertDto; tz: string; focused: boolean }) {
  return (
    <li id={`alert-${a.id}`} className={`px-5 py-3 text-[13px] ${focused ? 'bg-primary-soft' : a.alertType === 'sos' ? 'bg-crit-soft' : ''}`}>
      <div className="flex flex-wrap items-center gap-2">
        <SeverityBadge severity={a.severity} />
        <span className="font-semibold">{ALERT_TYPE_LABEL[a.alertType]}</span>
        <AlertStatusBadge status={a.status} />
        {a.isSimulated && <Badge tone="neutral">simulated</Badge>}
        {a.occurrences > 1 && <span className="text-xs text-muted">seen {a.occurrences}×</span>}
        <span className="ml-auto text-xs text-muted" title={fmtDateTime(a.raisedAt, tz)}>{fmtRelative(a.raisedAt)}</span>
      </div>
      <div className="mt-1">{a.title}</div>
      {a.detail && <div className="text-muted">{a.detail}</div>}
      <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
        {a.trip && <Link to={`/trips/${a.trip.id}`} className="font-mono text-primary hover:underline">{a.trip.tripNo}</Link>}
        {a.vehicle && <Link to={`/tracking?vehicle=${a.vehicle.id}`} className="inline-flex items-center gap-1 text-primary hover:underline"><MapPin className="size-3" aria-hidden />{a.vehicle.registrationNo}</Link>}
        {a.driver && <a href={`tel:${a.driver.phone.replace(/\s/g, '')}`} className="inline-flex items-center gap-1 text-primary hover:underline"><Phone className="size-3" aria-hidden />{a.driver.fullName}</a>}
        {a.incidentId && <Link to={`/incidents/${a.incidentId}`} className="text-primary hover:underline">Incident</Link>}
        {a.acknowledgedBy && <span>Acknowledged by {a.acknowledgedBy}</span>}
      </div>
      <div className="mt-2"><AlertActions alert={a} /></div>
    </li>
  );
}

function Tile({ label, value, tone }: { label: string; value: number | undefined; tone?: string }): ReactNode {
  return (
    <Card className="p-4">
      <div className={`text-2xl font-semibold tabular-nums ${tone ?? ''}`}>{value ?? '…'}</div>
      <div className="text-[13px] text-muted">{label}</div>
    </Card>
  );
}
