import { randomBytes } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { licenceCovers, type BodyType, type BookingStatus, type TripStatus } from '@transaxis/shared';
import type { Db } from '../src/client.js';
import * as s from '../src/schema/index.js';
import type { SeededCustomer, SeededRoute } from './commercial.js';
import { CONSIGNEE_SITES } from './data/parties.js';
import { INSPECTION_ITEMS_PRE, RECIPIENTS } from './data/people.js';
import { addDaysTo, addHours, addMinutes, istAt, round5, Sequences } from './helpers.js';
import type { SeededWorker } from './people.js';
import type { Rng } from './prng.js';

export interface SeededVehicle {
  id: number;
  index: number;
  registrationNo: string;
  typeId: number;
  typeName: string;
  bodyType: BodyType;
  requiredLicenceClass: string;
  payloadKg: number;
  odometerKm: number;
  status: string;
}

interface Busy {
  start: number;
  end: number;
}

interface Plan {
  customer: SeededCustomer;
  route: SeededRoute;
  vehicle: SeededVehicle;
  driver: SeededWorker;
  helpers: SeededWorker[];
  units: number;
  status: TripStatus;
  plannedStart: Date;
  plannedEnd: Date;
  actualStart: Date | null;
  deliveredAt: Date | null;
  completedAt: Date | null;
  holdReason?: string;
  startOdometer: number | null;
  endOdometer: number | null;
}

interface QueueSpec {
  customerCode: string;
  route: string;
  weightKg: number;
  status: BookingStatus;
  loadingAt: Date;
  cancelReason?: string;
}

export interface OperationsOptions {
  orgId: number;
  now: Date;
  anchor: string;
  vehicles: SeededVehicle[];
  drivers: SeededWorker[];
  helpers: SeededWorker[];
  customers: SeededCustomer[];
  routes: SeededRoute[];
  depotIds: Map<string, number>;
  dispatcherUserId: number | null;
  historyCount: number;
  active: {
    v: number;
    d: number;
    h?: number[];
    customer: string;
    route: string;
    fill: number;
    status: TripStatus;
    /** Hours relative to `now` for the planned start. */
    startInHours?: number;
    /** Absolute planned start (IST helper), overrides startInHours. */
    startAt?: Date;
    /** For delivered: hours ago it was delivered. */
    deliveredHoursAgo?: number;
    holdReason?: string;
    /** Chain after another active plan (index), starting this many hours after its planned end. */
    after?: { plan: number; gapHours: number };
  }[];
  queue: (now: Date, anchor: string) => QueueSpec[];
}

export interface OperationsSummary {
  bookings: number;
  trips: number;
  activeTrips: number;
}

const perTonneKm = (cat: string) => (cat === 'perishable' ? 6.2 : cat === 'hazardous' ? 5.4 : cat === 'high_value' || cat === 'fragile' ? 4.8 : 4.2);

function freightFor(c: SeededCustomer, r: SeededRoute, weightKg: number): { basis: 'per_trip' | 'per_tonne'; rate: number; freight: number } {
  if (c.fixture.cargo.category === 'perishable') {
    const rate = Math.round((r.fixture.distanceKm * 75) / 500) * 500;
    return { basis: 'per_trip', rate, freight: rate };
  }
  const rate = Math.round((r.fixture.distanceKm * perTonneKm(c.fixture.cargo.category)) / 10) * 10;
  return { basis: 'per_tonne', rate, freight: Math.round((rate * weightKg) / 1000) };
}

const fitsCargo = (v: SeededVehicle, cat: string) =>
  cat === 'perishable' ? v.bodyType === 'reefer' : cat === 'oversized' ? v.bodyType === 'open' || v.bodyType === 'trailer' : v.bodyType !== 'reefer';

export async function seedOperations(db: Db, rng: Rng, o: OperationsOptions): Promise<OperationsSummary> {
  const busy = new Map<string, Busy[]>();
  const isFree = (key: string, start: Date, end: Date, bufferH = 6) =>
    !(busy.get(key) ?? []).some((b) => start.getTime() < b.end + bufferH * 3_600_000 && b.start < end.getTime() + bufferH * 3_600_000);
  const hold = (key: string, start: Date, end: Date) => busy.set(key, [...(busy.get(key) ?? []), { start: start.getTime(), end: end.getTime() }]);
  const reserve = (p: Plan) => {
    hold(`v${p.vehicle.id}`, p.plannedStart, p.plannedEnd);
    hold(`w${p.driver.id}`, p.plannedStart, p.plannedEnd);
    for (const h of p.helpers) hold(`w${h.id}`, p.plannedStart, p.plannedEnd);
  };
  const customerBy = (code: string) => o.customers.find((c) => c.fixture.code === code)!;
  const routeBy = (name: string) => o.routes.find((r) => r.fixture.name === name)!;
  const unitsFor = (c: SeededCustomer, kg: number) => Math.max(1, Math.floor(kg / c.fixture.cargo.kgPerUnit));

  // ------------------------------------------------------------- active (current) trips
  const plans: Plan[] = [];
  const activePlans: Plan[] = [];
  for (const a of o.active) {
    const customer = customerBy(a.customer);
    const route = routeBy(a.route);
    const vehicle = o.vehicles[a.v]!;
    const driver = o.drivers[a.d]!;
    const durMin = route.fixture.durationMin;
    let plannedStart: Date;
    if (a.after) {
      const prev = activePlans[a.after.plan]!;
      plannedStart = round5(addHours(prev.plannedEnd, a.after.gapHours));
    } else {
      plannedStart = a.startAt ?? round5(addHours(o.now, a.startInHours ?? 0));
    }
    // Dispatchers plan with a buffer over the base driving time (route history runs about 13% slower).
    const plannedEnd = addMinutes(plannedStart, Math.round(durMin * 1.15));
    let actualStart: Date | null = null;
    let deliveredAt: Date | null = null;
    if (a.status === 'in_transit' || a.status === 'delivered') actualStart = addMinutes(plannedStart, rng.int(5, 25));
    if (a.status === 'delivered') deliveredAt = round5(addHours(o.now, -(a.deliveredHoursAgo ?? 1)));
    const plan: Plan = {
      customer,
      route,
      vehicle,
      driver,
      helpers: (a.h ?? []).map((i) => o.helpers[i]!),
      units: unitsFor(customer, vehicle.payloadKg * a.fill),
      status: a.status,
      plannedStart,
      plannedEnd,
      actualStart,
      deliveredAt,
      completedAt: null,
      holdReason: a.holdReason,
      startOdometer: null,
      endOdometer: null,
    };
    reserve(plan);
    activePlans.push(plan);
    plans.push(plan);
  }

  // ------------------------------------------------------------- history
  const histVehicles = o.vehicles.filter((v) => v.status !== 'retired' || rng.chance(0.3));
  let attempts = 0;
  let made = 0;
  while (made < o.historyCount && attempts < o.historyCount * 40) {
    attempts++;
    const customer = rng.pick(o.customers);
    const route = routeBy(rng.pick(customer.fixture.lanes));
    const vehicles = histVehicles.filter((v) => fitsCargo(v, customer.fixture.cargo.category));
    if (!vehicles.length) continue;
    const vehicle = rng.pick(vehicles);
    const daysAgo = rng.int(2, 180);
    const plannedStart = istAt(o.anchor, -daysAgo, rng.int(4, 20), rng.pick([0, 15, 30, 45]));
    const late = rng.chance(0.15);
    const travelMin = Math.round(route.fixture.durationMin * (late ? 1.3 + rng.next() * 0.3 : 0.92 + rng.next() * 0.3));
    const actualStart = round5(addMinutes(plannedStart, rng.int(-15, 75)));
    const deliveredAt = round5(addMinutes(actualStart, travelMin));
    if (deliveredAt.getTime() > o.now.getTime() - 3_600_000) continue;
    const completedAt = round5(addHours(deliveredAt, rng.int(2, 8)));
    const plannedEnd = addMinutes(plannedStart, route.fixture.durationMin);
    const windowEnd = completedAt.getTime() > plannedEnd.getTime() ? completedAt : plannedEnd;
    if (!isFree(`v${vehicle.id}`, plannedStart, windowEnd)) continue;
    const drivers = o.drivers.filter((d) => d.historical && licenceCovers(d.classes, vehicle.requiredLicenceClass) && isFree(`w${d.id}`, plannedStart, windowEnd));
    if (!drivers.length) continue;
    const driver = rng.pick(drivers);
    const helper = rng.chance(0.4) ? o.helpers.find((h) => isFree(`w${h.id}`, plannedStart, windowEnd)) : undefined;
    const ageDays = (o.now.getTime() - completedAt.getTime()) / 86_400_000;
    const status: TripStatus = ageDays < 1 ? 'delivered' : ageDays < 10 ? 'completed' : ageDays < 25 ? 'reconciled' : 'closed';
    const plan: Plan = {
      customer,
      route,
      vehicle,
      driver,
      helpers: helper ? [helper] : [],
      units: unitsFor(customer, vehicle.payloadKg * (0.45 + rng.next() * 0.5)),
      status,
      plannedStart,
      plannedEnd,
      actualStart,
      deliveredAt,
      completedAt: status === 'delivered' ? null : completedAt,
      startOdometer: null,
      endOdometer: null,
    };
    hold(`v${vehicle.id}`, plannedStart, windowEnd);
    hold(`w${driver.id}`, plannedStart, windowEnd);
    if (helper) hold(`w${helper.id}`, plannedStart, windowEnd);
    plans.push(plan);
    made++;
  }

  // ------------------------------------------------------------- odometers, newest first per vehicle
  for (const v of o.vehicles) {
    let cursor = v.odometerKm;
    const own = plans.filter((p) => p.vehicle.id === v.id).sort((a, b) => b.plannedStart.getTime() - a.plannedStart.getTime());
    for (const p of own) {
      const dist = p.route.fixture.distanceKm;
      if (p.status === 'in_transit') {
        p.startOdometer = cursor;
      } else if (p.status === 'delivered') {
        p.startOdometer = Math.round(cursor - dist * 1.02);
        cursor = p.startOdometer - rng.int(5, 60);
      } else if (p.completedAt) {
        p.endOdometer = Math.round(cursor - rng.int(5, 120));
        p.startOdometer = Math.round(p.endOdometer - dist * (1 + rng.next() * 0.05));
        cursor = p.startOdometer;
      }
    }
  }

  // ------------------------------------------------------------- persist in chronological order
  const seq = new Sequences();
  const [preTemplate] = await db
    .select()
    .from(s.inspectionTemplates)
    .where(and(eq(s.inspectionTemplates.orgId, o.orgId), eq(s.inspectionTemplates.inspectionType, 'pre_trip')));
  const userId = o.dispatcherUserId;
  plans.sort((a, b) => a.plannedStart.getTime() - b.plannedStart.getTime());

  for (const p of plans) {
    const { customer, route, vehicle, driver } = p;
    const weightKg = p.units * customer.fixture.cargo.kgPerUnit;
    const price = freightFor(customer, route, weightKg);
    const createdAt = addHours(p.plannedStart, -rng.int(18, 60));
    const bookingStatus: BookingStatus =
      p.status === 'planned' || p.status === 'ready' || p.status === 'on_hold' ? 'planned' : p.status === 'in_transit' ? 'in_transit' : 'delivered';
    const bookingId = await insertBooking(db, o, seq, {
      customer,
      route,
      weightKg,
      units: p.units,
      price,
      status: bookingStatus,
      createdAt,
      loadingAt: addHours(p.plannedStart, -1),
      deadline: addHours(p.plannedEnd, 8),
      lrNumber: seq.take('LR', 'LR', p.plannedStart),
      userId,
    });

    const tripNo = seq.take('TRP', 'TRP', p.plannedStart);
    const otpActive = p.status === 'in_transit';
    const podDone = p.deliveredAt !== null;
    const [trip] = await db
      .insert(s.trips)
      .values({
        orgId: o.orgId,
        tripNo,
        bookingId,
        tripType: 'loaded',
        status: p.status,
        holdFromStatus: p.status === 'on_hold' ? 'planned' : null,
        holdReason: p.holdReason ?? null,
        vehicleId: vehicle.id,
        driverId: driver.id,
        routeId: route.id,
        originCity: route.fixture.origin,
        destinationCity: route.fixture.destination,
        plannedStart: p.plannedStart,
        plannedEnd: p.plannedEnd,
        actualStart: p.actualStart,
        deliveredAt: p.deliveredAt,
        completedAt: p.completedAt,
        startOdometer: p.startOdometer?.toFixed(1) ?? null,
        endOdometer: p.endOdometer?.toFixed(1) ?? null,
        plannedDistanceKm: route.fixture.distanceKm.toFixed(1),
        // Seeded in-transit trips get an unknowable OTP; dispatchers reissue one to demo delivery.
        deliveryOtpHash: otpActive ? randomBytes(32).toString('hex') : null,
        deliveryOtpExpiresAt: otpActive ? addDaysTo(p.plannedEnd, 3) : null,
        podStatus: podDone ? 'verified_otp' : 'pending',
        createdBy: userId,
        reconciledAt: p.status === 'reconciled' || p.status === 'closed' ? addDaysTo(p.completedAt!, 3) : null,
        closedAt: p.status === 'closed' ? addDaysTo(p.completedAt!, 6) : null,
        createdAt,
      })
      .$returningId();
    const tripId = trip!.id;

    if (p.helpers.length) await db.insert(s.tripCrew).values(p.helpers.map((h) => ({ tripId, workerId: h.id, role: 'helper' as const })));
    const active = ['planned', 'ready', 'in_transit', 'delivered', 'on_hold'].includes(p.status);
    const resEnd = p.completedAt && p.completedAt > p.plannedEnd ? p.completedAt : p.plannedEnd;
    await db.insert(s.resourceReservations).values([
      { orgId: o.orgId, tripId, resourceType: 'vehicle', resourceId: vehicle.id, startsAt: p.plannedStart, endsAt: resEnd, active },
      { orgId: o.orgId, tripId, resourceType: 'worker', resourceId: driver.id, startsAt: p.plannedStart, endsAt: resEnd, active },
      ...p.helpers.map((h) => ({ orgId: o.orgId, tripId, resourceType: 'worker' as const, resourceId: h.id, startsAt: p.plannedStart, endsAt: resEnd, active })),
    ]);

    // Stops mirror the booking.
    const stops = stopsFor(customer, route);
    const stopIds: number[] = [];
    for (let i = 0; i < stops.length; i++) {
      const st = stops[i]!;
      const arrival = i === 0 ? p.actualStart : p.deliveredAt;
      const [row] = await db
        .insert(s.tripStops)
        .values({
          orgId: o.orgId,
          tripId,
          seq: i + 1,
          stopType: st.stopType,
          name: st.name,
          addressLine: st.address,
          city: st.city,
          lat: st.site[0].toFixed(6),
          lng: st.site[1].toFixed(6),
          contactName: st.contactName,
          contactPhone: st.contactPhone,
          plannedArrival: i === 0 ? p.plannedStart : p.plannedEnd,
          actualArrival: arrival ? addMinutes(arrival, i === 0 ? -50 : 0) : null,
          actualDeparture: i === 0 ? p.actualStart : null,
          status: arrival ? (i === 0 ? 'departed' : 'arrived') : 'pending',
        })
        .$returningId();
      stopIds.push(row!.id);
    }

    // Status history, events, inspection, seals and POD consistent with the status.
    const history: { from: TripStatus | null; to: TripStatus; at: Date; reason?: string }[] = [{ from: null, to: 'planned', at: createdAt }];
    const events: { type: (typeof s.tripEvents.$inferInsert)['eventType']; at: Date; note?: string; odometer?: number | null; stopId?: number }[] = [
      { type: 'created', at: createdAt, note: `Assigned ${vehicle.registrationNo} and ${driver.name}` },
    ];
    const inspected = p.status !== 'planned' && p.status !== 'on_hold';
    const inspectionAt = addMinutes(p.actualStart ?? p.plannedStart, -45);
    if (inspected) {
      history.push({ from: 'planned', to: 'ready', at: inspectionAt });
      events.push({ type: 'inspection_passed', at: inspectionAt });
      await db.insert(s.inspections).values({
        orgId: o.orgId,
        tripId,
        vehicleId: vehicle.id,
        inspectionType: 'pre_trip',
        templateId: preTemplate?.id ?? null,
        inspectedBy: userId,
        inspectedAt: inspectionAt,
        odometer: p.startOdometer?.toFixed(1) ?? null,
        result: 'pass',
        items: INSPECTION_ITEMS_PRE.map((it) => ({ ...it, result: 'pass' as const })),
      });
      if (['container', 'closed', 'reefer'].includes(vehicle.bodyType)) {
        await db.insert(s.cargoSeals).values({
          orgId: o.orgId,
          tripId,
          sealNo: `SL-${tripNo.slice(-6)}-${rng.int(100, 999)}`,
          appliedAt: inspectionAt,
          appliedBy: userId,
          verifiedAt: p.deliveredAt,
          verifiedBy: p.deliveredAt ? userId : null,
          intact: p.deliveredAt ? true : null,
        });
      }
    }
    if (p.status === 'on_hold') {
      history.push({ from: 'planned', to: 'on_hold', at: addHours(createdAt, 2), reason: p.holdReason });
      events.push({ type: 'on_hold', at: addHours(createdAt, 2), note: p.holdReason });
    }
    if (p.actualStart) {
      history.push({ from: 'ready', to: 'in_transit', at: p.actualStart });
      events.push({ type: 'dispatched', at: p.actualStart, odometer: p.startOdometer, stopId: stopIds[0] });
      events.push({ type: 'otp_issued', at: p.actualStart, note: 'Delivery OTP sent to consignee (log-only messaging in demo)' });
    }
    if (p.deliveredAt) {
      history.push({ from: 'in_transit', to: 'delivered', at: p.deliveredAt });
      events.push({ type: 'arrived_stop', at: addMinutes(p.deliveredAt, -40), stopId: stopIds[stopIds.length - 1] });
      events.push({ type: 'delivered', at: p.deliveredAt, note: 'POD verified with consignee OTP' });
      await db.insert(s.proofOfDelivery).values({
        orgId: o.orgId,
        tripId,
        method: 'otp',
        recipientName: rng.pick(RECIPIENTS),
        recipientPhone: stops[stops.length - 1]!.contactPhone,
        deliveredAt: p.deliveredAt,
        recordedBy: userId,
      });
    }
    if (p.completedAt) {
      history.push({ from: 'delivered', to: 'completed', at: p.completedAt });
      events.push({ type: 'completed', at: p.completedAt, odometer: p.endOdometer });
    }
    if (p.status === 'reconciled' || p.status === 'closed') history.push({ from: 'completed', to: 'reconciled', at: addDaysTo(p.completedAt!, 3) });
    if (p.status === 'closed') history.push({ from: 'reconciled', to: 'closed', at: addDaysTo(p.completedAt!, 6) });

    await db.insert(s.tripStatusHistory).values(
      history.map((h) => ({ orgId: o.orgId, tripId, fromStatus: h.from, toStatus: h.to, changedBy: userId, reason: h.reason ?? null, createdAt: h.at })),
    );
    await db.insert(s.tripEvents).values(
      events.map((e) => ({
        orgId: o.orgId,
        tripId,
        eventType: e.type,
        occurredAt: e.at,
        note: e.note ?? null,
        odometer: e.odometer?.toFixed(1) ?? null,
        stopId: e.stopId ?? null,
        recordedBy: userId,
        source: 'system' as const,
        createdAt: e.at,
      })),
    );
  }

  // Vehicle statuses follow their live trips.
  for (const p of activePlans) {
    const st = p.status === 'in_transit' || p.status === 'delivered' ? 'on_trip' : 'assigned';
    const current = await db.select({ status: s.vehicles.status }).from(s.vehicles).where(eq(s.vehicles.id, p.vehicle.id));
    if (current[0]?.status !== 'on_trip') await db.update(s.vehicles).set({ status: st }).where(eq(s.vehicles.id, p.vehicle.id));
  }

  // ------------------------------------------------------------- planning queue (no trips yet)
  const queue = o.queue(o.now, o.anchor);
  for (const q of queue) {
    const customer = customerBy(q.customerCode);
    const route = routeBy(q.route);
    const units = unitsFor(customer, q.weightKg);
    const weightKg = units * customer.fixture.cargo.kgPerUnit;
    await insertBooking(db, o, seq, {
      customer,
      route,
      weightKg,
      units,
      price: q.status === 'draft' ? null : freightFor(customer, route, weightKg),
      status: q.status,
      createdAt: addHours(o.now, -rng.int(2, 30)),
      loadingAt: q.loadingAt,
      deadline: addMinutes(q.loadingAt, route.fixture.durationMin + 12 * 60),
      lrNumber: null,
      userId,
      cancelReason: q.cancelReason,
    });
  }

  await db.insert(s.numberSequences).values(seq.rows(o.orgId));
  return { bookings: plans.length + queue.length, trips: plans.length, activeTrips: activePlans.length };
}

function stopsFor(c: SeededCustomer, r: SeededRoute) {
  const site = (city: string, isOrigin: boolean) => {
    if (c.fixture.city === city) {
      return { name: c.fixture.siteName, address: `${c.fixture.siteName}, ${city}`, city, site: c.fixture.site, locationId: c.siteLocationId as number | null, contactName: c.contactName, contactPhone: c.contactPhone };
    }
    const g = CONSIGNEE_SITES[city] ?? { name: `${city} delivery point`, site: r.fixture.polyline[isOrigin ? 0 : r.fixture.polyline.length - 1]!, state: '' };
    return { name: g.name, address: `${g.name}, ${city}`, city, site: g.site, locationId: null, contactName: 'Receiving desk', contactPhone: '+91 98000 00000' };
  };
  return [
    { stopType: 'pickup' as const, ...site(r.fixture.origin, true) },
    { stopType: 'drop' as const, ...site(r.fixture.destination, false) },
  ];
}

async function insertBooking(
  db: Db,
  o: OperationsOptions,
  seq: Sequences,
  b: {
    customer: SeededCustomer;
    route: SeededRoute;
    weightKg: number;
    units: number;
    price: { basis: 'per_trip' | 'per_tonne'; rate: number; freight: number } | null;
    status: BookingStatus;
    createdAt: Date;
    loadingAt: Date;
    deadline: Date;
    lrNumber: string | null;
    userId: number | null;
    cancelReason?: string;
  },
): Promise<number> {
  const cat = b.customer.fixture.cargo.category;
  const extras = b.price ? 1500 + 1200 : 0;
  const total = b.price ? (b.price.freight + extras).toFixed(2) : null;
  const priced = b.price !== null && b.status !== 'draft';
  const approved = !['draft', 'quoted', 'cancelled'].includes(b.status) || (b.status === 'cancelled' && false);
  const [row] = await db
    .insert(s.bookings)
    .values({
      orgId: o.orgId,
      bookingNo: seq.take('BKG', 'BKG', b.createdAt),
      customerId: b.customer.id,
      customerRef: `PO-${b.customer.fixture.code}-${String(b.createdAt.getTime()).slice(-6)}`,
      status: b.status,
      lrNumber: b.lrNumber,
      routeId: b.route.id,
      originCity: b.route.fixture.origin,
      destinationCity: b.route.fixture.destination,
      requiresTemperatureControl: cat === 'perishable',
      isHazardous: cat === 'hazardous',
      requiredBodyType: cat === 'perishable' ? 'reefer' : null,
      totalWeightKg: b.weightKg.toFixed(3),
      loadingWindowStart: b.loadingAt,
      loadingWindowEnd: addHours(b.loadingAt, 3),
      deliveryDeadline: b.deadline,
      rateBasis: priced ? b.price!.basis : null,
      rate: priced ? b.price!.rate.toFixed(2) : null,
      quotedAmount: priced ? total : null,
      approvedAmount: priced && approved ? total : null,
      paymentTermsDays: b.customer.fixture.terms,
      specialInstructions: cat === 'perishable' ? 'Maintain 2–8 °C throughout. Do not open doors en route.' : cat === 'hazardous' ? 'Class 3 flammable. TREM card on board; no smoking; park away from habitation.' : null,
      quotedAt: priced ? addHours(b.createdAt, 1) : null,
      quotedBy: priced ? b.userId : null,
      approvedAt: priced && approved ? addHours(b.createdAt, 2) : null,
      approvedBy: priced && approved ? b.userId : null,
      cancelledAt: b.status === 'cancelled' ? addHours(b.createdAt, 3) : null,
      cancelReason: b.cancelReason ?? null,
      createdBy: b.userId,
      createdAt: b.createdAt,
    })
    .$returningId();
  const bookingId = row!.id;

  const stops = stopsFor(b.customer, b.route);
  await db.insert(s.bookingStops).values(
    stops.map((st, i) => ({
      orgId: o.orgId,
      bookingId,
      seq: i + 1,
      stopType: st.stopType,
      locationId: st.locationId,
      name: st.name,
      addressLine: st.address,
      city: st.city,
      lat: st.site[0].toFixed(6),
      lng: st.site[1].toFixed(6),
      contactName: st.contactName,
      contactPhone: st.contactPhone,
      windowStart: i === 0 ? b.loadingAt : null,
      windowEnd: i === 0 ? addHours(b.loadingAt, 3) : b.deadline,
    })),
  );
  const c = b.customer.fixture.cargo;
  await db.insert(s.cargoItems).values({
    orgId: o.orgId,
    bookingId,
    description: c.description,
    category: c.category,
    hsnCode: c.hsn,
    quantity: b.units.toFixed(3),
    unit: c.unit,
    weightKg: b.weightKg.toFixed(3),
    packaging: c.unit === 'bags' ? 'HDPE bags' : c.unit === 'pallets' ? 'Wooden pallets' : null,
    declaredValue: (b.weightKg * (c.category === 'high_value' ? 900 : c.category === 'perishable' ? 1500 : 60)).toFixed(2),
  });
  if (b.price) {
    await db.insert(s.bookingCharges).values([
      { orgId: o.orgId, bookingId, chargeType: 'freight', description: b.price.basis === 'per_trip' ? 'Freight (per trip)' : `Freight @ ₹${b.price.rate}/t`, amount: b.price.freight.toFixed(2) },
      { orgId: o.orgId, bookingId, chargeType: 'loading', description: 'Loading', amount: '1500.00' },
      { orgId: o.orgId, bookingId, chargeType: 'unloading', description: 'Unloading', amount: '1200.00' },
    ]);
  }
  return bookingId;
}

/** Wall-clock helper re-exported for the scenario definitions in seed.ts. */
export { istAt };
