/** Small geodesy helpers shared by route planning, simulation and ETA. Coordinates are [lat, lng]. */
export type LatLng = [number, number];

const R_KM = 6371.0088;
const rad = (d: number) => (d * Math.PI) / 180;

/** Great-circle distance in km. */
export function haversineKm(a: LatLng, b: LatLng): number {
  const dLat = rad(b[0] - a[0]);
  const dLng = rad(b[1] - a[1]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[0])) * Math.cos(rad(b[0])) * Math.sin(dLng / 2) ** 2;
  return 2 * R_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Length of a polyline in km. */
export function polylineKm(points: LatLng[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) total += haversineKm(points[i - 1]!, points[i]!);
  return total;
}

/**
 * Point at `fraction` (0..1) of the way along a polyline, plus the heading of that segment in degrees.
 * Used by the GPS simulator to move vehicles along planned routes.
 */
export function pointAlong(points: LatLng[], fraction: number): { point: LatLng; headingDeg: number } {
  if (points.length === 0) throw new Error('Empty polyline');
  if (points.length === 1) return { point: points[0]!, headingDeg: 0 };
  const target = Math.max(0, Math.min(1, fraction)) * polylineKm(points);
  let walked = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!;
    const b = points[i]!;
    const seg = haversineKm(a, b);
    if (walked + seg >= target || i === points.length - 1) {
      const t = seg === 0 ? 0 : Math.min(1, (target - walked) / seg);
      return { point: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t], headingDeg: bearingDeg(a, b) };
    }
    walked += seg;
  }
  return { point: points[points.length - 1]!, headingDeg: 0 };
}

export function bearingDeg(a: LatLng, b: LatLng): number {
  const y = Math.sin(rad(b[1] - a[1])) * Math.cos(rad(b[0]));
  const x = Math.cos(rad(a[0])) * Math.sin(rad(b[0])) - Math.sin(rad(a[0])) * Math.cos(rad(b[0])) * Math.cos(rad(b[1] - a[1]));
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

/**
 * Shortest distance in km from a point to a polyline, and how far along the route (km) the closest
 * point is. Uses a local equirectangular projection per segment, accurate enough for deviation alerts
 * at highway scale.
 */
export function distanceToPolyline(p: LatLng, points: LatLng[]): { distanceKm: number; alongKm: number } {
  let best = { distanceKm: Number.POSITIVE_INFINITY, alongKm: 0 };
  let walked = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!;
    const b = points[i]!;
    const kx = 111.32 * Math.cos(rad((a[0] + b[0]) / 2));
    const ky = 110.574;
    const ax = a[1] * kx, ay = a[0] * ky, bx = b[1] * kx, by = b[0] * ky, px = p[1] * kx, py = p[0] * ky;
    const dx = bx - ax, dy = by - ay;
    const len2 = dx * dx + dy * dy;
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
    const cx = ax + t * dx, cy = ay + t * dy;
    const d = Math.hypot(px - cx, py - cy);
    const seg = haversineKm(a, b);
    if (d < best.distanceKm) best = { distanceKm: d, alongKm: walked + seg * t };
    walked += seg;
  }
  if (points.length === 1) best = { distanceKm: haversineKm(p, points[0]!), alongKm: 0 };
  return best;
}
