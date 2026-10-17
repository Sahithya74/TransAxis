import type { Request } from 'express';
import { and, asc, count, desc, eq, gte, inArray, isNotNull, ne, or, sql } from 'drizzle-orm';
import type { z } from 'zod';
import {
  customers,
  bookings,
  geofences,
  gpsEvents,
  routes,
  safetyAlerts,
  tripCrew,
  tripStops,
  trips,
  vehicleLastPositions,
  vehicles,
  vehicleTypes,
  workers,
  type Db,
} from '@transaxis/database';
import {
  DEFAULT_ETA_SETTINGS,
  simDurationMin,
  distanceToPolyline,
  estimateEta,
  evaluateTracking,
  polylineKm,
  remainingKm,
  scenarioFor,
  simulateFix,
  straightPath,
  type EtaDto,
  type GpsSource,
  type LatLng,
  type LiveSummaryDto,
  type LiveVehicleDto,
  type PositionDto,
  type TripTrackDto,
} from '@transaxis/shared';
import type { positionReportSchema } from '@transaxis/shared';
import type { Env } from '../../config/env.js';
import type { RequestContext } from '../../lib/context.js';
import { AppError } from '../../lib/errors.js';
import { toNumber } from '../../lib/http.js';
import { assertTripAccess } from '../../lib/trip-access.js';
import type { Realtime } from '../../realtime/socket.js';
import { AUTO_RESOLVABLE, type AlertService } from '../safety/alerts.js';
import { recordEvent } from '../trips/lifecycle.js';

const LIVE_MS = 2 * 60_000;
const RECENT_MS = 10 * 60_000;
const HISTORY_TTL_MS = 10 * 60_000;

type TripRow = typeof trips.$inferSelect;
interface Ctx {
  trip: TripRow;
  path: LatLng[];
  durationMin: number;
  stops: (typeof tripStops.$inferSelect)[];
}

export interface TrackingDeps {
  db: Db;
  config: Env;
  alerts: AlertService;
  realtime: Realtime;
}

export class TrackingService {
  private readonly db: Db;
  private readonly history = new Map<number, { kmph: number | null; samples: number; at: number }>();

  constructor(private readonly deps: TrackingDeps) {
    this.db = deps.db;
  }

  get simulated(): boolean {
    return this.deps.config.TELEMATICS_PROVIDER === 'simulated';
  }

  // ------------------------------------------------------------------ reads

  /** Every vehicle with its latest position and running trip (the live map). */
  async live(ctx: RequestContext, now = new Date()): Promise<LiveVehicleDto[]> {
    const rows = await this.db
      .select({ v: { id: vehicles.id, registrationNo: vehicles.registrationNo, status: vehicles.status }, type: vehicleTypes.name, p: vehicleLastPositions })
      .from(vehicles)
      .innerJoin(vehicleTypes, eq(vehicleTypes.id, vehicles.vehicleTypeId))
      .leftJoin(vehicleLastPositions, eq(vehicleLastPositions.vehicleId, vehicles.id))
      .where(and(eq(vehicles.orgId, ctx.orgId), ne(vehicles.status, 'retired')))
      .orderBy(asc(vehicles.registrationNo));

    const running = await this.db
      .select({ t: trips, d: { id: workers.id, fullName: workers.fullName, phone: workers.phone }, c: customers.name })
      .from(trips)
      .innerJoin(workers, eq(workers.id, trips.driverId))
      .leftJoin(bookings, eq(bookings.id, trips.bookingId))
      .leftJoin(customers, eq(customers.id, bookings.customerId))
      .where(and(eq(trips.orgId, ctx.orgId), inArray(trips.status, ['in_transit', 'delivered'])));
    const tripByVehicle = new Map(running.map((r) => [r.t.vehicleId, r]));

    const alertCounts = await this.db
      .select({ tripId: safetyAlerts.tripId, n: count() })
      .from(safetyAlerts)
      .where(and(eq(safetyAlerts.orgId, ctx.orgId), inArray(safetyAlerts.status, ['open', 'acknowledged']), isNotNull(safetyAlerts.tripId)))
      .groupBy(safetyAlerts.tripId);
    const alertsByTrip = new Map(alertCounts.map((a) => [a.tripId!, Number(a.n)]));

    const ctxs = await this.tripContexts(running.map((r) => r.t));
    const out: LiveVehicleDto[] = [];
    for (const { v, type, p } of rows) {
      const r = tripByVehicle.get(v.id);
      const position = p ? toPosition(p) : null;
      const age = position ? now.getTime() - Date.parse(position.recordedAt) : Number.POSITIVE_INFINITY;
      const tc = r ? ctxs.get(r.t.id) : undefined;
      out.push({
        vehicleId: v.id,
        registrationNo: v.registrationNo,
        vehicleType: type,
        position,
        freshness: age < LIVE_MS ? 'live' : age < RECENT_MS ? 'recent' : 'stale',
        trip: r
          ? {
              id: r.t.id,
              tripNo: r.t.tripNo,
              status: r.t.status,
              originCity: r.t.originCity,
              destinationCity: r.t.destinationCity,
              plannedEnd: r.t.plannedEnd.toISOString(),
              driver: r.d,
              customerName: r.c,
            }
          : null,
        eta: r && r.t.status === 'in_transit' && tc ? await this.eta(tc, position, now) : null,
        openAlerts: r ? (alertsByTrip.get(r.t.id) ?? 0) : 0,
        scenario: r && position?.isSimulated ? scenarioFor(r.t.id) : null,
      });
    }
    return out;
  }

  async summary(ctx: RequestContext, extra: { activeIncidents: number; missedCheckins: number; alerts: LiveSummaryDto['openAlerts'] }): Promise<LiveSummaryDto> {
    const now = Date.now();
    const pos = await this.db.select({ at: vehicleLastPositions.recordedAt }).from(vehicleLastPositions).where(eq(vehicleLastPositions.orgId, ctx.orgId));
    return {
      vehiclesTracked: pos.length,
      live: pos.filter((p) => now - p.at.getTime() < LIVE_MS).length,
      stale: pos.filter((p) => now - p.at.getTime() >= RECENT_MS).length,
      openAlerts: extra.alerts,
      activeIncidents: extra.activeIncidents,
      missedCheckins: extra.missedCheckins,
      simulated: this.simulated,
    };
  }

  /** Planned path, actual breadcrumb, stops and ETA for one trip. */
  async track(ctx: RequestContext, tripId: number, now = new Date()): Promise<TripTrackDto> {
    await assertTripAccess(this.db, ctx, tripId);
    const [t] = await this.db.select().from(trips).where(eq(trips.id, tripId));
    const tc = (await this.tripContexts([t!])).get(tripId);
    const crumbs = await this.db
      .select({ lat: gpsEvents.lat, lng: gpsEvents.lng, at: gpsEvents.recordedAt, speed: gpsEvents.speedKmph })
      .from(gpsEvents)
      .where(eq(gpsEvents.tripId, tripId))
      .orderBy(asc(gpsEvents.recordedAt))
      .limit(5000);
    // Thin long histories to at most ~600 points; keep the last fix exact.
    const step = Math.max(1, Math.ceil(crumbs.length / 600));
    const thinned = crumbs.filter((_, i) => i % step === 0 || i === crumbs.length - 1);
    const [last] = await this.db.select().from(gpsEvents).where(eq(gpsEvents.tripId, tripId)).orderBy(desc(gpsEvents.recordedAt)).limit(1);
    const position = last ? toPosition(last) : null;
    return {
      tripId,
      tripNo: t!.tripNo,
      status: t!.status,
      plannedPath: tc?.path ?? [],
      breadcrumb: thinned.map((c) => ({ lat: Number(c.lat), lng: Number(c.lng), at: c.at.toISOString(), speedKmph: toNumber(c.speed) })),
      stops: (tc?.stops ?? []).map((s) => ({ id: s.id, seq: s.seq, name: s.name, lat: toNumber(s.lat), lng: toNumber(s.lng), status: s.status })),
      position,
      eta: t!.status === 'in_transit' && tc ? await this.eta(tc, position, now) : null,
    };
  }

  /** Latest position and ETA for one trip, for callers that have already checked access (customer portal). */
  async positionAndEta(tripId: number, now = new Date()): Promise<{ position: PositionDto | null; eta: EtaDto | null }> {
    const [t] = await this.db.select().from(trips).where(eq(trips.id, tripId));
    if (!t || t.status !== 'in_transit') return { position: null, eta: null };
    const tc = (await this.tripContexts([t])).get(tripId);
    const [last] = await this.db.select().from(gpsEvents).where(eq(gpsEvents.tripId, tripId)).orderBy(desc(gpsEvents.recordedAt)).limit(1);
    const position = last ? toPosition(last) : null;
    return { position, eta: tc ? await this.eta(tc, position, now) : null };
  }

  // ------------------------------------------------------------------ writes

  /** A position from the driver's phone. Only accepted while the driver is on a trip in transit. */
  async report(ctx: RequestContext, input: z.infer<typeof positionReportSchema>, _req: Request): Promise<{ accepted: true; tripId: number }> {
    if (!ctx.workerId) throw AppError.forbidden('Only crew accounts report positions');
    const [t] = await this.db
      .select({ id: trips.id, vehicleId: trips.vehicleId })
      .from(trips)
      .where(
        and(
          eq(trips.orgId, ctx.orgId),
          eq(trips.status, 'in_transit'),
          or(eq(trips.driverId, ctx.workerId), sql`${trips.id} IN (SELECT ${tripCrew.tripId} FROM ${tripCrew} WHERE ${tripCrew.workerId} = ${ctx.workerId})`),
        ),
      )
      .limit(1);
    if (!t) throw AppError.businessRule('Positions are only recorded while you are on a trip in transit');
    await this.store([{ orgId: ctx.orgId, vehicleId: t.vehicleId, tripId: t.id, at: new Date(), lat: input.lat, lng: input.lng, speedKmph: input.speedKmph ?? null, headingDeg: input.headingDeg ?? null, accuracyM: input.accuracyM ?? null, source: 'device', isSimulated: false }]);
    return { accepted: true, tripId: t.id };
  }

  // ------------------------------------------------------------------ jobs

  /** Moves every simulated vehicle on a trip in transit one step along its route. */
  async simulate(now = new Date()): Promise<number> {
    if (!this.simulated) return 0;
    const running = await this.db.select().from(trips).where(and(eq(trips.status, 'in_transit'), isNotNull(trips.actualStart)));
    if (!running.length) return 0;
    const ctxs = await this.tripContexts(running);
    const fixes: StoredFix[] = [];
    for (const t of running) {
      const tc = ctxs.get(t.id);
      if (!tc || tc.path.length < 2) continue;
      const f = simulateFix({ id: t.id, dispatchedAt: t.actualStart!.getTime(), durationMin: tc.durationMin, path: tc.path }, now.getTime());
      if (!f) continue; // scripted signal gap
      fixes.push({ orgId: t.orgId, vehicleId: t.vehicleId, tripId: t.id, at: now, lat: f.lat, lng: f.lng, speedKmph: f.speedKmph, headingDeg: f.headingDeg, accuracyM: null, source: 'simulated', isSimulated: true });
      if (f.arrived) await this.markArrived(tc, now);
    }
    await this.store(fixes);
    return fixes.length;
  }

  /** Turns tracking data into alerts: raise new conditions, refresh ongoing ones, clear stale warnings. */
  async evaluate(now = new Date()): Promise<number> {
    const running = await this.db.select().from(trips).where(and(eq(trips.status, 'in_transit'), isNotNull(trips.actualStart)));
    const ctxs = await this.tripContexts(running);
    const zones = await this.db.select().from(geofences).where(eq(geofences.isActive, true));
    let raised = 0;
    for (const t of running) {
      const tc = ctxs.get(t.id);
      if (!tc) continue;
      const fixes = await this.db
        .select()
        .from(gpsEvents)
        .where(and(eq(gpsEvents.tripId, t.id), gte(gpsEvents.recordedAt, new Date(now.getTime() - 25 * 60_000))))
        .orderBy(desc(gpsEvents.recordedAt))
        .limit(400);
      const lastAny = fixes[0] ?? (await this.db.select().from(gpsEvents).where(eq(gpsEvents.tripId, t.id)).orderBy(desc(gpsEvents.recordedAt)).limit(1))[0];
      const position = lastAny ? toPosition(lastAny) : null;
      const eta = await this.eta(tc, position, now);
      const orgZones = zones.filter((z) => z.orgId === t.orgId);
      const conditions = evaluateTracking({
        now,
        fixes: (fixes.length ? fixes : lastAny ? [lastAny] : []).map((f) => ({ lat: Number(f.lat), lng: Number(f.lng), speedKmph: Number(f.speedKmph ?? 0), recordedAt: f.recordedAt.toISOString() })),
        route: tc.path.length > 1 ? tc.path : null,
        knownPlaces: [
          ...tc.stops.filter((s) => s.lat && s.lng).map((s) => [Number(s.lat), Number(s.lng)] as LatLng),
          ...orgZones.filter((z) => z.kind !== 'restricted').map((z) => [Number(z.lat), Number(z.lng)] as LatLng),
        ],
        restrictedZones: orgZones.filter((z) => z.kind === 'restricted').map((z) => ({ name: z.name, center: [Number(z.lat), Number(z.lng)] as LatLng, radiusKm: z.radiusM / 1000 })),
        lateByMin: eta.method === 'schedule' ? null : eta.lateByMin,
        dispatchedAt: t.actualStart!.toISOString(),
      });
      const active = new Set<string>();
      for (const c of conditions) {
        const key = `trip:${t.id}:${c.key}`;
        active.add(key);
        const r = await this.deps.alerts.raise(this.db, {
          orgId: t.orgId,
          type: c.type,
          severity: c.severity,
          title: `${c.title}: ${t.tripNo}`,
          detail: c.detail,
          tripId: t.id,
          vehicleId: t.vehicleId,
          driverId: t.driverId,
          lat: c.at?.[0] ?? null,
          lng: c.at?.[1] ?? null,
          isSimulated: position?.isSimulated ?? false,
          dedupeKey: key,
          now,
        });
        if (r.created) raised++;
      }
      for (const open of await this.deps.alerts.openKeys(this.db, t.orgId, t.id)) {
        if (AUTO_RESOLVABLE.has(open.type) && !active.has(open.key) && !open.key.endsWith('missed_checkin')) {
          await this.deps.alerts.autoResolve(this.db, t.orgId, open.key, 'Condition cleared', now);
        }
      }
    }
    // Warnings about trips that are no longer moving have nothing left to watch.
    const ended = await this.db
      .select({ orgId: safetyAlerts.orgId, key: safetyAlerts.dedupeKey, type: safetyAlerts.alertType })
      .from(safetyAlerts)
      .innerJoin(trips, eq(trips.id, safetyAlerts.tripId))
      .where(and(isNotNull(safetyAlerts.dedupeKey), ne(trips.status, 'in_transit'), inArray(safetyAlerts.alertType, [...AUTO_RESOLVABLE, 'missed_checkin'])));
    for (const e of ended) await this.deps.alerts.autoResolve(this.db, e.orgId, e.key!, 'Trip is no longer in transit', now);
    return raised;
  }

  /** Deletes position history older than the retention period, in batches. */
  async purge(now = new Date()): Promise<number> {
    const cutoff = new Date(now.getTime() - this.deps.config.GPS_RETENTION_DAYS * 86_400_000);
    let total = 0;
    for (let i = 0; i < 20; i++) {
      const [res] = await this.db.execute(sql`DELETE FROM ${gpsEvents} WHERE recorded_at < ${cutoff} LIMIT 5000`);
      const n = (res as unknown as { affectedRows: number }).affectedRows;
      total += n;
      if (n < 5000) break;
    }
    return total;
  }

  // ------------------------------------------------------------------ internals

  private async store(fixes: StoredFix[]): Promise<void> {
    if (!fixes.length) return;
    const rows = fixes.map((f) => ({
      orgId: f.orgId,
      vehicleId: f.vehicleId,
      tripId: f.tripId,
      recordedAt: f.at,
      lat: f.lat.toFixed(6),
      lng: f.lng.toFixed(6),
      speedKmph: f.speedKmph != null ? f.speedKmph.toFixed(1) : null,
      headingDeg: f.headingDeg != null ? Math.round(f.headingDeg) : null,
      source: f.source,
      isSimulated: f.isSimulated,
    }));
    await this.db.insert(gpsEvents).values(fixes.map((f, i) => ({ ...rows[i]!, accuracyM: f.accuracyM })));
    await this.db
      .insert(vehicleLastPositions)
      .values(rows)
      .onDuplicateKeyUpdate({
        set: {
          orgId: sql`VALUES(org_id)`,
          tripId: sql`VALUES(trip_id)`,
          recordedAt: sql`VALUES(recorded_at)`,
          lat: sql`VALUES(lat)`,
          lng: sql`VALUES(lng)`,
          speedKmph: sql`VALUES(speed_kmph)`,
          headingDeg: sql`VALUES(heading_deg)`,
          source: sql`VALUES(source)`,
          isSimulated: sql`VALUES(is_simulated)`,
        },
      });
    const byOrg = new Map<number, unknown[]>();
    for (const f of fixes) {
      byOrg.set(f.orgId, [...(byOrg.get(f.orgId) ?? []), { vehicleId: f.vehicleId, tripId: f.tripId, lat: f.lat, lng: f.lng, speedKmph: f.speedKmph, headingDeg: f.headingDeg, recordedAt: f.at.toISOString(), isSimulated: f.isSimulated }]);
    }
    for (const [orgId, positions] of byOrg) this.deps.realtime.toPermission(orgId, 'tracking:read', 'positions', positions);
  }

  /** Records arrival at the final stop once (the trip still needs proof of delivery). */
  private async markArrived(tc: Ctx, now: Date): Promise<void> {
    const last = tc.stops[tc.stops.length - 1];
    if (!last || last.status !== 'pending') return;
    const [res] = await this.db.update(tripStops).set({ status: 'arrived', actualArrival: now }).where(and(eq(tripStops.id, last.id), eq(tripStops.status, 'pending')));
    if ((res as unknown as { affectedRows: number }).affectedRows === 0) return;
    last.status = 'arrived';
    await recordEvent(this.db, { orgId: tc.trip.orgId, tripId: tc.trip.id, type: 'arrived_stop', userId: null, stopId: last.id, note: `Arrived at ${last.name} (simulated GPS). Waiting for proof of delivery.`, lat: toNumber(last.lat), lng: toNumber(last.lng), source: 'simulated', at: now });
  }

  /** Route, path, expected duration and stops for each trip, loaded in bulk. */
  private async tripContexts(list: TripRow[]): Promise<Map<number, Ctx>> {
    const out = new Map<number, Ctx>();
    if (!list.length) return out;
    const routeIds = [...new Set(list.map((t) => t.routeId).filter((x): x is number => !!x))];
    const routeRows = routeIds.length ? await this.db.select().from(routes).where(inArray(routes.id, routeIds)) : [];
    const routeById = new Map(routeRows.map((r) => [r.id, r]));
    const stopRows = await this.db.select().from(tripStops).where(inArray(tripStops.tripId, list.map((t) => t.id))).orderBy(asc(tripStops.tripId), asc(tripStops.seq));
    const stopsByTrip = new Map<number, (typeof tripStops.$inferSelect)[]>();
    for (const s of stopRows) stopsByTrip.set(s.tripId, [...(stopsByTrip.get(s.tripId) ?? []), s]);
    for (const t of list) {
      const stops = stopsByTrip.get(t.id) ?? [];
      const route = t.routeId ? routeById.get(t.routeId) : undefined;
      const located = stops.filter((s) => s.lat && s.lng);
      const path: LatLng[] = route
        ? route.polyline
        : located.length >= 2
          ? straightPath([Number(located[0]!.lat), Number(located[0]!.lng)], [Number(located[located.length - 1]!.lat), Number(located[located.length - 1]!.lng)])
          : [];
      const plannedMin = (t.plannedEnd.getTime() - t.plannedStart.getTime()) / 60_000;
      const durationMin = simDurationMin(plannedMin, route?.expectedDurationMin ?? null);
      out.set(t.id, { trip: t, path, durationMin, stops });
    }
    return out;
  }

  private async eta(tc: Ctx, position: PositionDto | null, now: Date): Promise<EtaDto> {
    const hist = tc.trip.routeId ? await this.routeHistory(tc.trip.routeId) : { kmph: null, samples: 0 };
    let remaining: number | null = null;
    if (position && tc.path.length > 1) {
      const along = distanceToPolyline([position.lat, position.lng], tc.path).alongKm;
      remaining = remainingKm(tc.path, Math.min(1, along / polylineKm(tc.path)), toNumber(tc.trip.plannedDistanceKm));
    }
    const pendingStops = tc.stops.filter((s) => s.status === 'pending').length;
    return estimateEta(
      {
        now,
        plannedEnd: tc.trip.plannedEnd.toISOString(),
        remainingKm: remaining,
        fixAgeMin: position ? (now.getTime() - Date.parse(position.recordedAt)) / 60_000 : null,
        historicalKmph: hist.kmph,
        historicalSamples: hist.samples,
        remainingStops: Math.max(0, pendingStops - 1),
        drivenHours: tc.trip.actualStart ? (now.getTime() - tc.trip.actualStart.getTime()) / 3_600_000 : 0,
      },
      DEFAULT_ETA_SETTINGS,
    );
  }

  /** Average door-to-door speed of delivered trips on a route (cached briefly). */
  private async routeHistory(routeId: number): Promise<{ kmph: number | null; samples: number }> {
    const hit = this.history.get(routeId);
    if (hit && Date.now() - hit.at < HISTORY_TTL_MS) return hit;
    const [r] = await this.db
      .select({
        kmph: sql<string | null>`AVG(${trips.plannedDistanceKm} / (TIMESTAMPDIFF(MINUTE, ${trips.actualStart}, ${trips.deliveredAt}) / 60))`,
        n: count(),
      })
      .from(trips)
      .where(
        and(
          eq(trips.routeId, routeId),
          isNotNull(trips.actualStart),
          isNotNull(trips.deliveredAt),
          isNotNull(trips.plannedDistanceKm),
          sql`TIMESTAMPDIFF(MINUTE, ${trips.actualStart}, ${trips.deliveredAt}) > 60`,
        ),
      );
    const value = { kmph: r?.kmph != null ? Number(r.kmph) : null, samples: Number(r?.n ?? 0), at: Date.now() };
    this.history.set(routeId, value);
    return value;
  }
}

interface StoredFix {
  orgId: number;
  vehicleId: number;
  tripId: number;
  at: Date;
  lat: number;
  lng: number;
  speedKmph: number | null;
  headingDeg: number | null;
  accuracyM: number | null;
  source: GpsSource;
  isSimulated: boolean;
}

function toPosition(p: { lat: string; lng: string; speedKmph: string | null; headingDeg: number | null; recordedAt: Date; source: GpsSource; isSimulated: boolean }): PositionDto {
  return {
    lat: Number(p.lat),
    lng: Number(p.lng),
    speedKmph: toNumber(p.speedKmph),
    headingDeg: p.headingDeg,
    recordedAt: p.recordedAt.toISOString(),
    source: p.source,
    isSimulated: p.isSimulated,
  };
}
