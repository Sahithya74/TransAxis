import { useEffect, useMemo, type ReactNode } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { CircleMarker, MapContainer, Marker, Polyline, TileLayer, Tooltip, useMap } from 'react-leaflet';

/** Tile server; override with VITE_MAP_TILE_URL (e.g. a commercial provider) in production. */
const TILE_URL = (import.meta.env.VITE_MAP_TILE_URL as string | undefined) ?? 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

export type LatLngTuple = [number, number];

export interface VehicleMarker {
  id: number;
  position: LatLngTuple;
  headingDeg: number | null;
  label: string;
  /** ok: moving and fresh; warn: stale or warning alerts; crit: critical alerts; idle: no trip. */
  tone: 'ok' | 'warn' | 'crit' | 'idle';
  selected?: boolean;
  tooltip?: ReactNode;
}

const TONE: Record<VehicleMarker['tone'], string> = { ok: '#2563eb', warn: '#f59e0b', crit: '#ef4444', idle: '#64748b' };

function vehicleIcon(m: VehicleMarker) {
  const c = TONE[m.tone];
  const size = m.selected ? 34 : 26;
  const arrow = m.headingDeg === null ? '' : `<path d="M12 3 L16 11 L12 9 L8 11 Z" fill="white" transform="rotate(${m.headingDeg} 12 12)"/>`;
  return L.divIcon({
    className: '',
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    html: `<svg width="${size}" height="${size}" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10" fill="${c}" stroke="white" stroke-width="${m.selected ? 3 : 2}"/>${arrow}</svg>`,
  });
}

/** Fits the view to the given points whenever the set (identified by `fitKey`) changes. */
function FitBounds({ points, fitKey }: { points: LatLngTuple[]; fitKey: string }) {
  const map = useMap();
  useEffect(() => {
    if (!points.length) return;
    if (points.length === 1) map.setView(points[0]!, 11);
    else map.fitBounds(L.latLngBounds(points), { padding: [40, 40], maxZoom: 12 });
    // Only refit when the key changes, not on every position update.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitKey, map]);
  return null;
}

export function MapView({
  vehicles = [],
  plannedPath,
  breadcrumb,
  stops = [],
  fitKey,
  fitPoints,
  onSelect,
  className = 'h-[520px]',
}: {
  vehicles?: VehicleMarker[];
  plannedPath?: LatLngTuple[];
  breadcrumb?: LatLngTuple[];
  stops?: { position: LatLngTuple; label: string; done: boolean }[];
  fitKey: string;
  fitPoints?: LatLngTuple[];
  onSelect?: (id: number) => void;
  className?: string;
}) {
  const icons = useMemo(() => new Map(vehicles.map((v) => [v.id, vehicleIcon(v)])), [vehicles]);
  const points = fitPoints ?? [...vehicles.map((v) => v.position), ...(plannedPath ?? []), ...stops.map((s) => s.position)];
  return (
    <div className={`overflow-hidden rounded-lg border border-line ${className}`}>
      <MapContainer center={[20.5, 78.9]} zoom={5} scrollWheelZoom className="h-full w-full" attributionControl>
        <TileLayer url={TILE_URL} attribution={ATTRIBUTION} maxZoom={18} />
        <FitBounds points={points} fitKey={fitKey} />
        {plannedPath && plannedPath.length > 1 && <Polyline positions={plannedPath} pathOptions={{ color: '#94a3b8', weight: 4, dashArray: '6 8' }} />}
        {breadcrumb && breadcrumb.length > 1 && <Polyline positions={breadcrumb} pathOptions={{ color: '#2563eb', weight: 4 }} />}
        {stops.map((s, i) => (
          <CircleMarker key={i} center={s.position} radius={7} pathOptions={{ color: 'white', weight: 2, fillColor: s.done ? '#10b981' : '#1e293b', fillOpacity: 1 }}>
            <Tooltip>{s.label}</Tooltip>
          </CircleMarker>
        ))}
        {vehicles.map((v) => (
          <Marker key={v.id} position={v.position} icon={icons.get(v.id)!} eventHandlers={onSelect ? { click: () => onSelect(v.id) } : undefined} zIndexOffset={v.selected ? 1000 : 0}>
            <Tooltip direction="top" offset={[0, -12]}>{v.tooltip ?? v.label}</Tooltip>
          </Marker>
        ))}
      </MapContainer>
    </div>
  );
}
