import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { Gauge, Search, TriangleAlert, Wifi, WifiOff } from 'lucide-react';
import type { EtaDto, LiveVehicleDto } from '@transaxis/shared';
import { MapView, type VehicleMarker } from '../../components/map/MapView';
import { TripStatusBadge } from '../../components/StatusBadges';
import { Badge } from '../../components/ui/Badge';
import { Input } from '../../components/ui/Field';
import { Card, ErrorState, PageHeader, Skeleton } from '../../components/ui/Layout';
import { Tabs } from '../../components/ui/Tabs';
import { fmtDateTime, fmtNumber, fmtRelative } from '../../lib/format';
import { useOrgTimezone } from '../../lib/useOrgTimezone';
import { useRealtime } from '../../lib/realtime';
import { useAlerts, useLiveVehicles, useTripTrack } from './api';
import { ALERT_TYPE_LABEL, SeverityBadge, SimulatedBadge } from './badges';

const toneOf = (v: LiveVehicleDto): VehicleMarker['tone'] => (!v.trip ? 'idle' : v.openAlerts > 0 || v.freshness === 'stale' ? 'warn' : 'ok');

export function EtaLine({ eta, tz }: { eta: EtaDto; tz: string }) {
  return (
    <div className="text-[13px]">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold">ETA {fmtDateTime(eta.eta, tz)}</span>
        {eta.lateByMin > 0 ? <Badge tone={eta.lateByMin > 60 ? 'crit' : 'warn'}>{eta.lateByMin} min late</Badge> : <Badge tone="ok">On time</Badge>}
        <span className="text-xs text-muted">{eta.method} · {eta.confidence} confidence</span>
      </div>
      <p className="mt-0.5 text-xs text-muted">{eta.basisNote}</p>
    </div>
  );
}

export function LiveMapPage() {
  const tz = useOrgTimezone();
  const { connected } = useRealtime();
  const [params, setParams] = useSearchParams();
  const selectedId = Number(params.get('vehicle')) || null;
  const [scope, setScope] = useState<'trip' | 'all'>('trip');
  const [filter, setFilter] = useState('');
  const live = useLiveVehicles();
  const vehicles = live.vehicles ?? [];
  const shown = vehicles.filter((v) => (scope === 'all' || v.trip) && (!filter || `${v.registrationNo} ${v.trip?.tripNo ?? ''} ${v.trip?.driver.fullName ?? ''} ${v.trip?.destinationCity ?? ''}`.toLowerCase().includes(filter.toLowerCase())));
  const selected = vehicles.find((v) => v.vehicleId === selectedId) ?? null;
  const track = useTripTrack(selected?.trip?.id ?? 0, !!selected?.trip);
  const tripAlerts = useAlerts({ tripId: selected?.trip?.id, status: 'active', pageSize: 10 }, { enabled: !!selected?.trip });
  const select = (id: number | null) => setParams(id ? { vehicle: String(id) } : {}, { replace: true });

  const markers: VehicleMarker[] = useMemo(
    () =>
      shown
        .filter((v) => v.position)
        .map((v) => ({
          id: v.vehicleId,
          position: [v.position!.lat, v.position!.lng],
          headingDeg: v.position!.speedKmph ? v.position!.headingDeg : null,
          label: v.registrationNo,
          tone: toneOf(v),
          selected: v.vehicleId === selectedId,
          tooltip: (
            <span>
              <strong>{v.registrationNo}</strong>
              {v.trip ? ` · ${v.trip.tripNo} to ${v.trip.destinationCity}` : ''}
              <br />
              {v.position!.speedKmph ?? 0} km/h · {fmtRelative(v.position!.recordedAt)}
            </span>
          ),
        })),
    [shown, selectedId],
  );

  const liveCount = vehicles.filter((v) => v.position && v.freshness === 'live').length;
  const staleCount = vehicles.filter((v) => v.trip && v.freshness === 'stale').length;
  const fitKey = selected?.trip && track.data ? `trip-${selected.trip.id}` : `fleet-${markers.length}`;

  return (
    <div>
      <PageHeader
        title={<span className="flex items-center gap-3">Live fleet map {live.simulated && <SimulatedBadge />}</span>}
        subtitle={
          <span className="flex flex-wrap items-center gap-3">
            <span>{liveCount} reporting now · {staleCount} on trips without a recent position</span>
            <span className={`inline-flex items-center gap-1 ${connected ? 'text-ok-strong' : 'text-muted'}`}>
              {connected ? <Wifi className="size-3.5" aria-hidden /> : <WifiOff className="size-3.5" aria-hidden />}
              {connected ? 'Live updates on' : 'Updating every 30 s'}
            </span>
          </span>
        }
      />
      {live.isError ? (
        <ErrorState message={(live.error as Error).message} onRetry={() => void live.refetch()} />
      ) : (
        <div className="grid gap-4 lg:grid-cols-[22rem_1fr]">
          <Card className="flex max-h-[680px] flex-col">
            <div className="space-y-2 border-b border-line p-3">
              <Tabs active={scope} onChange={(s) => setScope(s as 'trip' | 'all')} tabs={[{ id: 'trip', label: 'On a trip', count: vehicles.filter((v) => v.trip).length }, { id: 'all', label: 'All vehicles', count: vehicles.length }]} />
              <div className="relative">
                <Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-muted" aria-hidden />
                <Input aria-label="Find a vehicle" placeholder="Vehicle, trip, driver or city…" className="pl-8" value={filter} onChange={(e) => setFilter(e.target.value)} />
              </div>
            </div>
            <ul className="flex-1 divide-y divide-line overflow-y-auto">
              {live.isPending && Array.from({ length: 6 }, (_, i) => <li key={i} className="p-3"><Skeleton className="h-10 w-full" /></li>)}
              {shown.map((v) => (
                <li key={v.vehicleId}>
                  <button
                    onClick={() => select(v.vehicleId === selectedId ? null : v.vehicleId)}
                    className={`w-full px-3 py-2.5 text-left text-[13px] ${v.vehicleId === selectedId ? 'bg-primary-soft' : 'hover:bg-canvas'}`}
                  >
                    <div className="flex items-center gap-2">
                      <span className={`size-2 shrink-0 rounded-full ${v.freshness === 'live' ? 'bg-ok' : v.freshness === 'recent' ? 'bg-warn' : 'bg-line-strong'}`} aria-label={v.freshness} />
                      <span className="font-mono font-medium">{v.registrationNo}</span>
                      {v.openAlerts > 0 && <Badge tone="crit">{v.openAlerts} alert{v.openAlerts > 1 ? 's' : ''}</Badge>}
                      <span className="ml-auto text-xs text-muted">{v.position ? `${fmtNumber(v.position.speedKmph ?? 0)} km/h` : 'no position'}</span>
                    </div>
                    {v.trip ? (
                      <div className="mt-0.5 pl-4 text-xs text-muted">
                        {v.trip.tripNo.slice(-6)} · {v.trip.originCity} → {v.trip.destinationCity} · {v.trip.driver.fullName}
                        {v.eta && v.eta.lateByMin > 0 && <span className="text-warn-strong"> · {v.eta.lateByMin} min late</span>}
                      </div>
                    ) : (
                      <div className="mt-0.5 pl-4 text-xs text-muted">{v.vehicleType} · not on a trip</div>
                    )}
                  </button>
                </li>
              ))}
              {live.data && shown.length === 0 && <li className="p-4 text-[13px] text-muted">No vehicles match.</li>}
            </ul>
          </Card>

          <div className="space-y-4">
            <MapView
              vehicles={markers}
              plannedPath={selected?.trip ? track.data?.plannedPath : undefined}
              breadcrumb={selected?.trip ? track.data?.breadcrumb.map((b) => [b.lat, b.lng]) : undefined}
              stops={selected?.trip ? (track.data?.stops ?? []).filter((s) => s.lat !== null).map((s) => ({ position: [s.lat!, s.lng!], label: `${s.seq}. ${s.name} (${s.status})`, done: s.status !== 'pending' })) : []}
              fitKey={fitKey}
              fitPoints={selected?.trip && track.data ? [...track.data.plannedPath, ...(selected.position ? [[selected.position.lat, selected.position.lng] as [number, number]] : [])] : undefined}
              onSelect={(id) => select(id)}
              className="h-[460px] lg:h-[520px]"
            />
            {selected && (
              <Card className="p-4">
                <div className="flex flex-wrap items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="font-mono text-base">{selected.registrationNo}</h2>
                      <span className="text-[13px] text-muted">{selected.vehicleType}</span>
                      {selected.position?.isSimulated && <SimulatedBadge />}
                    </div>
                    {selected.position && (
                      <p className="mt-1 flex flex-wrap items-center gap-3 text-[13px] text-muted">
                        <span className="inline-flex items-center gap-1"><Gauge className="size-3.5" aria-hidden /> {fmtNumber(selected.position.speedKmph ?? 0)} km/h</span>
                        <span>Last position {fmtRelative(selected.position.recordedAt)} ({fmtDateTime(selected.position.recordedAt, tz)})</span>
                        {selected.scenario && selected.scenario !== 'normal' && <span>Demo scenario: {selected.scenario.replace('_', ' ')}</span>}
                      </p>
                    )}
                  </div>
                  {selected.trip && <TripStatusBadge status={selected.trip.status} />}
                </div>
                {selected.trip ? (
                  <div className="mt-3 grid gap-3 border-t border-line pt-3 sm:grid-cols-2">
                    <div className="text-[13px]">
                      <Link to={`/trips/${selected.trip.id}`} className="font-mono text-primary hover:underline">{selected.trip.tripNo}</Link>
                      <div>{selected.trip.originCity} → {selected.trip.destinationCity}{selected.trip.customerName ? ` · ${selected.trip.customerName}` : ''}</div>
                      <div className="text-muted">{selected.trip.driver.fullName} · <a className="text-primary" href={`tel:${selected.trip.driver.phone.replace(/\s/g, '')}`}>{selected.trip.driver.phone}</a></div>
                      <div className="text-muted">Planned arrival {fmtDateTime(selected.trip.plannedEnd, tz)}</div>
                      {(track.data?.eta ?? selected.eta) && <div className="mt-2"><EtaLine eta={(track.data?.eta ?? selected.eta)!} tz={tz} /></div>}
                    </div>
                    <div>
                      <h3 className="mb-1.5 flex items-center gap-1.5 text-[13px] font-semibold"><TriangleAlert className="size-4 text-warn" aria-hidden /> Active alerts</h3>
                      {tripAlerts.data?.data.length ? (
                        <ul className="space-y-1.5 text-[13px]">
                          {tripAlerts.data.data.map((a) => (
                            <li key={a.id} className="flex items-start gap-2">
                              <SeverityBadge severity={a.severity} />
                              <Link to={`/control-room?alert=${a.id}`} className="hover:underline">{ALERT_TYPE_LABEL[a.alertType]}: <span className="text-muted">{a.detail}</span></Link>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className="text-[13px] text-muted">None.</p>
                      )}
                    </div>
                  </div>
                ) : (
                  <p className="mt-2 text-[13px] text-muted">Not on a trip. Positions are only collected during trips.</p>
                )}
              </Card>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
