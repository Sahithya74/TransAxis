import { and, asc, desc, eq, inArray, isNotNull } from 'drizzle-orm';
import { simDurationMin, simulateFix, type LatLng } from '@transaxis/shared';
import type { Db } from '../src/client.js';
import * as s from '../src/schema/index.js';
import { addMinutes, Sequences } from './helpers.js';
import type { Rng } from './prng.js';

export interface LiveOptions {
  orgId: number;
  now: Date;
  userIdByRole: Map<string, number>;
  /** A permit-only area near the operating base; no seeded route crosses it. */
  restrictedZone: { name: string; at: LatLng; radiusM: number };
}

const GPS_STEP_MIN = 3;
const CHECKIN_EVERY_H = 3;

/**
 * Live-operations demo data: geofences, the GPS trail so far for trips on the road (from the same
 * simulator the API runs, so trails continue seamlessly), past check-ins, and a small history of alerts
 * and incidents. All positions are flagged as simulated.
 */
export async function seedLive(db: Db, rng: Rng, o: LiveOptions): Promise<{ gpsEvents: number; incidents: number; alerts: number }> {
  // ------------------------------------------------------------- geofences from saved places
  const places = await db.select().from(s.locations).where(and(eq(s.locations.orgId, o.orgId), isNotNull(s.locations.lat)));
  const fences = places.flatMap((l) => {
    const kind = l.locationType === 'customer_site' ? 'customer_site' : l.locationType === 'depot' || l.locationType === 'warehouse' ? 'depot' : l.locationType === 'fuel_station' ? 'checkpoint' : null;
    return kind ? [{ orgId: o.orgId, name: l.name, kind: kind as 'depot', lat: l.lat!, lng: l.lng!, radiusM: kind === 'depot' ? 1000 : 600, locationId: l.id }] : [];
  });
  fences.push({ orgId: o.orgId, name: o.restrictedZone.name, kind: 'restricted' as 'depot', lat: o.restrictedZone.at[0].toFixed(6), lng: o.restrictedZone.at[1].toFixed(6), radiusM: o.restrictedZone.radiusM, locationId: null as unknown as number });
  if (fences.length) await db.insert(s.geofences).values(fences.map((f) => ({ ...f, kind: f.kind as (typeof s.geofences.$inferInsert)['kind'] })));

  // ------------------------------------------------------------- GPS trails and check-ins for trips on the road
  const running = await db
    .select({ t: s.trips, r: s.routes })
    .from(s.trips)
    .innerJoin(s.routes, eq(s.routes.id, s.trips.routeId))
    .where(and(eq(s.trips.orgId, o.orgId), eq(s.trips.status, 'in_transit'), isNotNull(s.trips.actualStart)));
  let gpsCount = 0;
  for (const { t, r } of running) {
    const plannedMin = (t.plannedEnd.getTime() - t.plannedStart.getTime()) / 60_000;
    const sim = { id: t.id, dispatchedAt: t.actualStart!.getTime(), durationMin: simDurationMin(plannedMin, r.expectedDurationMin), path: r.polyline };
    const rows: (typeof s.gpsEvents.$inferInsert)[] = [];
    for (let at = t.actualStart!.getTime(); at <= o.now.getTime(); at += GPS_STEP_MIN * 60_000) {
      const f = simulateFix(sim, at);
      if (!f) continue;
      rows.push({
        orgId: o.orgId,
        vehicleId: t.vehicleId,
        tripId: t.id,
        recordedAt: new Date(at),
        lat: f.lat.toFixed(6),
        lng: f.lng.toFixed(6),
        speedKmph: f.speedKmph.toFixed(1),
        headingDeg: f.headingDeg,
        source: 'simulated',
        isSimulated: true,
      });
    }
    for (let i = 0; i < rows.length; i += 500) await db.insert(s.gpsEvents).values(rows.slice(i, i + 500));
    gpsCount += rows.length;
    const last = rows[rows.length - 1];
    if (last) {
      await db.insert(s.vehicleLastPositions).values({ vehicleId: t.vehicleId, orgId: o.orgId, tripId: t.id, recordedAt: last.recordedAt, lat: last.lat, lng: last.lng, speedKmph: last.speedKmph, headingDeg: last.headingDeg, source: 'simulated', isSimulated: true });
    }
    const checkins: (typeof s.driverCheckins.$inferInsert)[] = [];
    for (let due = addMinutes(t.actualStart!, CHECKIN_EVERY_H * 60); due < o.now; due = addMinutes(due, CHECKIN_EVERY_H * 60)) {
      checkins.push({ orgId: o.orgId, tripId: t.id, workerId: t.driverId, dueAt: due, checkedInAt: addMinutes(due, rng.int(-10, 12)), status: 'ok', note: rng.pick(['All good', 'Tea break', 'Traffic near toll plaza', null]) });
    }
    if (checkins.length) await db.insert(s.driverCheckins).values(checkins);
  }

  // ------------------------------------------------------------- incident and alert history (main demo org only)
  const control = o.userIdByRole.get('control_room') ?? null;
  const dispatcher = o.userIdByRole.get('dispatcher') ?? null;
  if (!control) return { gpsEvents: gpsCount, incidents: 0, alerts: 0 };

  const done = await db
    .select()
    .from(s.trips)
    .where(and(eq(s.trips.orgId, o.orgId), inArray(s.trips.status, ['completed', 'reconciled', 'closed']), isNotNull(s.trips.deliveredAt)))
    .orderBy(desc(s.trips.deliveredAt))
    .limit(6);
  const [delivered] = await db.select().from(s.trips).where(and(eq(s.trips.orgId, o.orgId), eq(s.trips.status, 'delivered'))).orderBy(asc(s.trips.id)).limit(1);
  if (done.length < 3) return { gpsEvents: gpsCount, incidents: 0, alerts: 0 };

  const seq = new Sequences();
  let incidents = 0;
  let alerts = 0;
  const incident = async (
    trip: typeof s.trips.$inferSelect,
    v: { type: 'breakdown' | 'sos' | 'cargo_damage'; severity: 'medium' | 'high' | 'critical'; status: 'closed' | 'investigating'; title: string; description: string; at: Date; resolution?: string; simulated?: boolean; location?: string },
    updates: { kind: 'created' | 'note' | 'status_change' | 'assignment'; body: string | null; from?: 'open' | 'investigating' | 'resolved'; to?: 'open' | 'investigating' | 'resolved' | 'closed'; afterMin: number; by: number | null }[],
  ) => {
    const [row] = await db
      .insert(s.incidents)
      .values({
        orgId: o.orgId,
        incidentNo: seq.take('INC', 'INC', v.at),
        incidentType: v.type,
        severity: v.severity,
        status: v.status,
        title: v.title,
        description: v.description,
        tripId: trip.id,
        vehicleId: trip.vehicleId,
        driverId: trip.driverId,
        locationText: v.location ?? null,
        reportedBy: v.type === 'sos' ? null : dispatcher,
        reportedAt: v.at,
        assignedTo: control,
        resolvedAt: v.resolution ? addMinutes(v.at, updates[updates.length - 1]!.afterMin) : null,
        resolution: v.resolution ?? null,
        isSimulated: v.simulated ?? false,
      })
      .$returningId();
    await db.insert(s.incidentUpdates).values(
      updates.map((u) => ({ orgId: o.orgId, incidentId: row!.id, kind: u.kind, body: u.body, fromStatus: u.from ?? null, toStatus: u.to ?? null, createdBy: u.by, createdAt: addMinutes(v.at, u.afterMin) })),
    );
    incidents++;
    return row!.id;
  };
  const alert = async (trip: typeof s.trips.$inferSelect, a: { type: 'route_deviation' | 'unexpected_stop' | 'gps_stale' | 'sos'; severity: 'warning' | 'critical'; title: string; detail: string; at: Date; resolvedAfterMin: number; note: string; auto?: boolean; incidentId?: number }) => {
    await db.insert(s.safetyAlerts).values({
      orgId: o.orgId,
      alertType: a.type,
      severity: a.severity,
      status: 'resolved',
      title: `${a.title}: ${trip.tripNo}`,
      detail: a.detail,
      tripId: trip.id,
      vehicleId: trip.vehicleId,
      driverId: trip.driverId,
      dedupeKey: null,
      isSimulated: true,
      raisedAt: a.at,
      lastSeenAt: addMinutes(a.at, Math.min(a.resolvedAfterMin, 25)),
      occurrences: rng.int(2, 9),
      acknowledgedAt: a.auto ? null : addMinutes(a.at, 3),
      acknowledgedBy: a.auto ? null : control,
      resolvedAt: addMinutes(a.at, a.resolvedAfterMin),
      resolvedBy: a.auto ? null : control,
      resolutionNote: a.note,
      autoResolved: !!a.auto,
      incidentId: a.incidentId ?? null,
    });
    alerts++;
  };

  // A tyre burst on a recent trip: unplanned-stop alert, then a breakdown incident worked to closure.
  const t1 = done[0]!;
  const burstAt = addMinutes(t1.actualStart!, 190);
  const breakdown = await incident(
    t1,
    { type: 'breakdown', severity: 'medium', status: 'closed', title: 'Tyre burst on the highway', description: 'Rear left outer tyre burst. Driver stopped on the shoulder with hazard lights on.', at: burstAt, location: 'NH48 near Krishnagiri toll plaza', resolution: 'Spare fitted by a roadside mechanic from the vendor list. Trip continued 1 h 50 min late; customer informed.' },
    [
      { kind: 'created', body: 'Driver called the control room after an unplanned stop alert.', to: 'open', afterMin: 0, by: dispatcher },
      { kind: 'assignment', body: 'Assigned to the control room', afterMin: 2, by: control },
      { kind: 'status_change', body: 'Calling the nearest workshop vendor.', from: 'open', to: 'investigating', afterMin: 4, by: control },
      { kind: 'status_change', body: 'Spare fitted by a roadside mechanic from the vendor list. Trip continued 1 h 50 min late; customer informed.', from: 'investigating', to: 'resolved', afterMin: 115, by: control },
      { kind: 'status_change', body: null, from: 'resolved', to: 'closed', afterMin: 600, by: control },
    ],
  );
  await alert(t1, { type: 'unexpected_stop', severity: 'warning', title: 'Unplanned stop', detail: 'Stationary for 18 min away from any stop or depot.', at: addMinutes(burstAt, -12), resolvedAfterMin: 125, note: 'Tyre burst; see the breakdown incident.', incidentId: breakdown });

  // A diversion explained by the driver.
  const t2 = done[1]!;
  await alert(t2, { type: 'route_deviation', severity: 'critical', title: 'Off the planned route', detail: '7.4 km from the planned route.', at: addMinutes(t2.actualStart!, 140), resolvedAfterMin: 35, note: 'Diversion for road works on the bypass; confirmed with the driver by phone.' });

  // A signal gap that cleared on its own.
  const t3 = done[2]!;
  await alert(t3, { type: 'gps_stale', severity: 'warning', title: 'No GPS signal', detail: 'Last position 14 min ago.', at: addMinutes(t3.actualStart!, 260), resolvedAfterMin: 22, note: 'Condition cleared', auto: true });

  // A simulated SOS drill, clearly labelled.
  const drillAt = addMinutes(done[3]?.actualStart ?? t3.actualStart!, 95);
  const drill = await incident(
    done[3] ?? t3,
    { type: 'sos', severity: 'critical', status: 'closed', title: 'SOS drill (simulated)', description: 'Monthly SOS drill triggered from the driver app. No emergency services were contacted.', at: drillAt, resolution: 'Drill completed. Control room called the driver back in 2 min 40 s.', simulated: true },
    [
      { kind: 'created', body: 'SOS button pressed (drill).', to: 'open', afterMin: 0, by: null },
      { kind: 'status_change', body: 'Calling the driver.', from: 'open', to: 'investigating', afterMin: 1, by: control },
      { kind: 'status_change', body: 'Drill completed. Control room called the driver back in 2 min 40 s.', from: 'investigating', to: 'resolved', afterMin: 6, by: control },
      { kind: 'status_change', body: null, from: 'resolved', to: 'closed', afterMin: 30, by: control },
    ],
  );
  await alert(done[3] ?? t3, { type: 'sos', severity: 'critical', title: 'SOS (drill)', detail: 'SOS raised from the driver app (simulated drill).', at: drillAt, resolvedAfterMin: 6, note: 'Drill; see the SOS incident.', incidentId: drill });

  // An open cargo-damage investigation on the trip awaiting closure.
  if (delivered?.deliveredAt) {
    const damageId = await incident(
      delivered,
      { type: 'cargo_damage', severity: 'high', status: 'investigating', title: 'Two cartons crushed at unloading', description: 'Consignee noted two crushed cartons on the proof of delivery. Photos requested from the driver.', at: addMinutes(delivered.deliveredAt, 20) },
      [
        { kind: 'created', body: 'Damage noted on the proof of delivery.', to: 'open', afterMin: 0, by: dispatcher },
        { kind: 'status_change', body: 'Collecting photos and the loading supervisor’s statement.', from: 'open', to: 'investigating', afterMin: 15, by: control },
      ],
    );
    const recipients = [control, dispatcher, o.userIdByRole.get('owner')].filter((x): x is number => !!x);
    await db.insert(s.notifications).values(
      recipients.map((userId) => ({
        orgId: o.orgId,
        userId,
        category: 'incident' as const,
        priority: 'high' as const,
        title: 'Cargo damage reported on delivery',
        body: 'Two cartons crushed at unloading. Investigation open.',
        link: `/incidents/${damageId}`,
        entityType: 'incident',
        entityId: damageId,
        dedupeKey: `incident:${damageId}:created`,
        createdAt: addMinutes(delivered.deliveredAt!, 20),
      })),
    );
  }

  await db.insert(s.numberSequences).values(seq.rows(o.orgId));
  return { gpsEvents: gpsCount, incidents, alerts };
}
