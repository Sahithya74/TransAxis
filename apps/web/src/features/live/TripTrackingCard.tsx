import { Link } from 'react-router';
import { MapView } from '../../components/map/MapView';
import { Card, Skeleton } from '../../components/ui/Layout';
import { fmtRelative } from '../../lib/format';
import { useOrgTimezone } from '../../lib/useOrgTimezone';
import { useAlerts, useTripTrack } from './api';
import { ALERT_TYPE_LABEL, AlertStatusBadge, SeverityBadge, SimulatedBadge } from './badges';
import { EtaLine } from './LiveMapPage';

/** Map, ETA and alerts for one trip, shown on the trip page while it is on the road. */
export function TripTrackingCard({ tripId, vehicleId }: { tripId: number; vehicleId: number }) {
  const tz = useOrgTimezone();
  const track = useTripTrack(tripId);
  const alerts = useAlerts({ tripId, pageSize: 10 });
  const t = track.data;
  return (
    <Card>
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-5 py-3">
        <h2 className="text-base">Live tracking</h2>
        {t?.position?.isSimulated && <SimulatedBadge />}
        {t?.position && <span className="text-xs text-muted">last position {fmtRelative(t.position.recordedAt)} · {t.position.speedKmph ?? 0} km/h</span>}
        <Link to={`/tracking?vehicle=${vehicleId}`} className="ml-auto text-[13px] text-primary hover:underline">Open live map</Link>
      </div>
      <div className="space-y-3 p-4">
        {!t ? (
          <Skeleton className="h-64 w-full" />
        ) : (
          <>
            <MapView
              className="h-72"
              vehicles={t.position ? [{ id: vehicleId, position: [t.position.lat, t.position.lng], headingDeg: t.position.speedKmph ? t.position.headingDeg : null, label: t.tripNo, tone: 'ok', selected: true }] : []}
              plannedPath={t.plannedPath}
              breadcrumb={t.breadcrumb.map((b) => [b.lat, b.lng])}
              stops={t.stops.filter((s) => s.lat !== null).map((s) => ({ position: [s.lat!, s.lng!], label: `${s.seq}. ${s.name}`, done: s.status !== 'pending' }))}
              fitKey={`trip-${tripId}`}
            />
            {t.eta ? <EtaLine eta={t.eta} tz={tz} /> : !t.position && <p className="text-[13px] text-muted">No position received for this trip yet.</p>}
          </>
        )}
        {alerts.data && alerts.data.data.length > 0 && (
          <div>
            <h3 className="mb-1.5 text-[13px] font-semibold">Alerts on this trip</h3>
            <ul className="space-y-1.5 text-[13px]">
              {alerts.data.data.map((a) => (
                <li key={a.id} className="flex flex-wrap items-center gap-2">
                  <SeverityBadge severity={a.severity} />
                  <span>{ALERT_TYPE_LABEL[a.alertType]}</span>
                  <AlertStatusBadge status={a.status} />
                  <span className="text-xs text-muted">{fmtRelative(a.raisedAt)}</span>
                  {a.status !== 'resolved' && <Link to={`/control-room?alert=${a.id}`} className="text-xs text-primary hover:underline">Handle</Link>}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </Card>
  );
}
