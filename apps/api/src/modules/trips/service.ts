import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';
import type { Request } from 'express';
import { aliasedTable, and, asc, desc, eq, gte, inArray, like, lt, lte, notInArray, or, sql, type SQL } from 'drizzle-orm';
import type { z } from 'zod';
import {
  bookingStops,
  bookings,
  cargoSeals,
  customers,
  inspections,
  inspectionTemplates,
  locations,
  proofOfDelivery,
  resourceReservations,
  routes,
  tripCrew,
  tripEvents,
  trips,
  tripStatusHistory,
  tripStops,
  users,
  vehicles,
  vehicleTypes,
  workers,
  isDuplicateKeyError,
  type Db,
  type Tx,
} from '@transaxis/database';
import {
  TRIP_ACTION_RULES,
  addDays,
  availableTripActions,
  checkAssignment,
  checkTripTransition,
  startOfDayIn,
  type AssignmentCheckDto,
  type AssignmentResult,
  type BookingListItemDto,
  type CandidateDto,
  type CandidatesDto,
  type LicenceClass,
  type OtpIssuedDto,
  type Paginated,
  type TripAction,
  type TripCreateInput,
  type TripDto,
  type TripListItemDto,
  type TripListQuery,
  type TripStatus,
  type VehicleFacts,
  type WorkerFacts,
  type Window,
} from '@transaxis/shared';
import type {
  assignmentCheckSchema,
  candidatesQuerySchema,
  inspectionInputSchema,
  podOtpSchema,
  podOverrideSchema,
  tripActionSchema,
  tripEventInputSchema,
  tripReassignSchema,
} from '@transaxis/shared';
import type { Env } from '../../config/env.js';
import { audit } from '../../lib/audit.js';
import type { RequestContext } from '../../lib/context.js';
import { AppError } from '../../lib/errors.js';
import { escapeLike, paginated, parseSort, toNumber } from '../../lib/http.js';
import { getOrgInfo, orgYear, type OrgInfo } from '../../lib/org.js';
import { nextNumber } from '../../lib/sequences.js';
import { assertTripAccess, isOwnTrip } from '../../lib/trip-access.js';
import type { MessageProvider } from '../../providers/messaging.js';
import type { FileService } from '../files/service.js';
import { bookingRequirements, buildWindow, loadVehicleFacts, loadWorkerFacts, lockResources } from './assignment.js';
import { cancelTrip, recordEvent, recordHistory, releaseReservations, syncBookingFromTrip, syncVehicleStatus } from './lifecycle.js';

export const MAX_OTP_ATTEMPTS = 5;
/**
 * Assignment transactions run under READ COMMITTED. Under MySQL's default REPEATABLE READ the
 * snapshot is fixed by the first plain read, which can happen before we wait for the vehicle/worker
 * row locks; the conflict check would then miss a reservation committed while we waited and allow a
 * double booking. With READ COMMITTED every read after the lock sees the latest committed rows.
 */
const ASSIGNMENT_TX = { isolationLevel: 'read committed' } as const;
const OTP_VALID_AFTER_PLANNED_END_H = 72;
type TripRow = typeof trips.$inferSelect;

export interface TripDeps {
  db: Db;
  config: Env;
  messenger: MessageProvider;
  files: FileService;
  /** Accrues crew pay when a trip completes (inside the same transaction). */
  crewPay?: { accrue(tx: Tx, trip: TripRow, completedAt: Date, endOdometer: number | null): Promise<void> };
}

/** Trips visible to the caller: all of the org's, or only their own for drivers/helpers. */
function scope(ctx: RequestContext): SQL[] {
  const conds: SQL[] = [eq(trips.orgId, ctx.orgId)];
  if (!ctx.permissions.has('trips:read')) {
    if (!ctx.permissions.has('trips:update_own') || !ctx.workerId) throw AppError.forbidden();
    conds.push(or(eq(trips.driverId, ctx.workerId), sql`${trips.id} IN (SELECT trip_id FROM trip_crew WHERE worker_id = ${ctx.workerId})`)!);
  }
  return conds;
}

export class TripService {
  private readonly db: Db;
  constructor(private readonly deps: TripDeps) {
    this.db = deps.db;
  }

  // ------------------------------------------------------------------ queries

  async list(ctx: RequestContext, q: TripListQuery): Promise<Paginated<TripListItemDto>> {
    const conds = scope(ctx);
    if (q.status) conds.push(eq(trips.status, q.status));
    if (q.active === 'true') conds.push(inArray(trips.status, ['planned', 'ready', 'in_transit', 'delivered', 'on_hold']));
    if (q.vehicleId) conds.push(eq(trips.vehicleId, q.vehicleId));
    if (q.driverId) conds.push(eq(trips.driverId, q.driverId));
    if (q.bookingId) conds.push(eq(trips.bookingId, q.bookingId));
    if (q.from || q.to) {
      // Dates are calendar days in the organisation's timezone.
      const tz = (await getOrgInfo(this.db, ctx.orgId)).timezone;
      if (q.from) conds.push(gte(trips.plannedStart, startOfDayIn(q.from, tz)));
      if (q.to) conds.push(lt(trips.plannedStart, startOfDayIn(addDays(q.to, 1), tz)));
    }
    if (q.q) {
      const t = `%${escapeLike(q.q)}%`;
      conds.push(or(like(trips.tripNo, t), like(vehicles.registrationNo, t), like(workers.fullName, t), like(bookings.bookingNo, t), like(bookings.lrNumber, t))!);
    }
    const where = and(...conds);
    const cols = { tripNo: trips.tripNo, plannedStart: trips.plannedStart, status: trips.status } as const;
    const sort = parseSort<keyof typeof cols>(q.sort, 'plannedStart');
    const base = () =>
      this.db
        .select({
          t: trips,
          v: { id: vehicles.id, registrationNo: vehicles.registrationNo },
          d: { id: workers.id, fullName: workers.fullName, phone: workers.phone },
          b: { id: bookings.id, bookingNo: bookings.bookingNo, lrNumber: bookings.lrNumber },
          c: { name: customers.name },
        })
        .from(trips)
        .innerJoin(vehicles, eq(vehicles.id, trips.vehicleId))
        .innerJoin(workers, eq(workers.id, trips.driverId))
        .leftJoin(bookings, eq(bookings.id, trips.bookingId))
        .leftJoin(customers, eq(customers.id, bookings.customerId))
        .$dynamic();
    const [count] = await this.db
      .select({ n: sql<number>`COUNT(*)` })
      .from(trips)
      .innerJoin(vehicles, eq(vehicles.id, trips.vehicleId))
      .innerJoin(workers, eq(workers.id, trips.driverId))
      .leftJoin(bookings, eq(bookings.id, trips.bookingId))
      .where(where);
    const rows = await base()
      .where(where)
      .orderBy(sort.desc ? desc(cols[sort.field]) : asc(cols[sort.field]), desc(trips.id))
      .limit(q.pageSize)
      .offset((q.page - 1) * q.pageSize);
    return paginated(rows.map(toListItem), q.page, q.pageSize, Number(count?.n ?? 0));
  }

  async get(ctx: RequestContext, id: number): Promise<TripDto> {
    await assertTripAccess(this.db, ctx, id);
    const changedBy = aliasedTable(users, 'changed_by_user');
    const [row] = await this.db
      .select({
        t: trips,
        v: { id: vehicles.id, registrationNo: vehicles.registrationNo, status: vehicles.status, payload: vehicles.payloadCapacityKg },
        vt: { name: vehicleTypes.name, cls: vehicleTypes.requiredLicenceClass },
        d: { id: workers.id, fullName: workers.fullName, phone: workers.phone },
        b: { id: bookings.id, bookingNo: bookings.bookingNo, lrNumber: bookings.lrNumber, weight: bookings.totalWeightKg },
        c: { name: customers.name },
        r: { id: routes.id, name: routes.name, distanceKm: routes.distanceKm, polyline: routes.polyline },
      })
      .from(trips)
      .innerJoin(vehicles, eq(vehicles.id, trips.vehicleId))
      .innerJoin(vehicleTypes, eq(vehicleTypes.id, vehicles.vehicleTypeId))
      .innerJoin(workers, eq(workers.id, trips.driverId))
      .leftJoin(bookings, eq(bookings.id, trips.bookingId))
      .leftJoin(customers, eq(customers.id, bookings.customerId))
      .leftJoin(routes, eq(routes.id, trips.routeId))
      .where(and(eq(trips.id, id), eq(trips.orgId, ctx.orgId)))
      .limit(1);
    if (!row) throw AppError.notFound('Trip');
    const t = row.t;

    const [crew, stops, events, history, insp, seals, pod] = await Promise.all([
      this.db
        .select({ workerId: tripCrew.workerId, role: tripCrew.role, fullName: workers.fullName, phone: workers.phone })
        .from(tripCrew)
        .innerJoin(workers, eq(workers.id, tripCrew.workerId))
        .where(eq(tripCrew.tripId, id)),
      this.db.select().from(tripStops).where(eq(tripStops.tripId, id)).orderBy(asc(tripStops.seq)),
      this.db
        .select({ e: tripEvents, by: users.fullName })
        .from(tripEvents)
        .leftJoin(users, eq(users.id, tripEvents.recordedBy))
        .where(eq(tripEvents.tripId, id))
        .orderBy(desc(tripEvents.occurredAt), desc(tripEvents.id)),
      this.db
        .select({ h: tripStatusHistory, by: changedBy.fullName })
        .from(tripStatusHistory)
        .leftJoin(changedBy, eq(changedBy.id, tripStatusHistory.changedBy))
        .where(eq(tripStatusHistory.tripId, id))
        .orderBy(asc(tripStatusHistory.createdAt), asc(tripStatusHistory.id)),
      this.db
        .select({ i: inspections, by: users.fullName })
        .from(inspections)
        .leftJoin(users, eq(users.id, inspections.inspectedBy))
        .where(eq(inspections.tripId, id))
        .orderBy(desc(inspections.inspectedAt)),
      this.db.select().from(cargoSeals).where(eq(cargoSeals.tripId, id)),
      this.db
        .select({ p: proofOfDelivery, by: users.fullName })
        .from(proofOfDelivery)
        .leftJoin(users, eq(users.id, proofOfDelivery.recordedBy))
        .where(eq(proofOfDelivery.tripId, id))
        .limit(1),
    ]);

    const own = await isOwnTrip(this.db, ctx, t.id, t.driverId);
    const actions = availableTripActions(t.status, t.holdFromStatus).filter(
      (a) => a !== 'deliver' && TRIP_ACTION_RULES[a].permissions.some((p) => (p === 'trips:update_own' ? own : ctx.permissions.has(p))),
    );
    const otpActive = !!t.deliveryOtpHash && !!t.deliveryOtpExpiresAt && t.deliveryOtpExpiresAt > new Date();

    return {
      ...toListItem({ t, v: row.v, d: row.d, b: row.b?.id ? row.b : null, c: row.c?.name ? row.c : null }),
      parentTripId: t.parentTripId,
      holdFromStatus: t.holdFromStatus,
      holdReason: t.holdReason,
      cancelReason: t.cancelReason,
      overrideReason: t.overrideReason,
      vehicle: {
        id: row.v.id,
        registrationNo: row.v.registrationNo,
        vehicleType: row.vt.name,
        requiredLicenceClass: row.vt.cls as LicenceClass,
        status: row.v.status,
        payloadCapacityKg: Number(row.v.payload),
      },
      crew,
      route: row.r?.id ? { id: row.r.id, name: row.r.name, distanceKm: Number(row.r.distanceKm), polyline: row.r.polyline } : null,
      completedAt: t.completedAt?.toISOString() ?? null,
      startOdometer: toNumber(t.startOdometer),
      endOdometer: toNumber(t.endOdometer),
      plannedDistanceKm: toNumber(t.plannedDistanceKm),
      podStatus: t.podStatus,
      otpActive,
      otpAttemptsLeft: Math.max(0, MAX_OTP_ATTEMPTS - t.deliveryOtpAttempts),
      notes: t.notes,
      stops: stops.map((s) => ({
        id: s.id,
        seq: s.seq,
        stopType: s.stopType,
        name: s.name,
        addressLine: s.addressLine,
        city: s.city,
        lat: toNumber(s.lat),
        lng: toNumber(s.lng),
        contactName: s.contactName,
        contactPhone: s.contactPhone,
        plannedArrival: s.plannedArrival?.toISOString() ?? null,
        actualArrival: s.actualArrival?.toISOString() ?? null,
        actualDeparture: s.actualDeparture?.toISOString() ?? null,
        status: s.status,
      })),
      events: events.map(({ e, by }) => ({
        id: e.id,
        eventType: e.eventType,
        occurredAt: e.occurredAt.toISOString(),
        note: e.note,
        stopId: e.stopId,
        odometer: toNumber(e.odometer),
        recordedBy: by,
        source: e.source,
      })),
      history: history.map(({ h, by }) => ({ fromStatus: h.fromStatus, toStatus: h.toStatus, changedBy: by, reason: h.reason, at: h.createdAt.toISOString() })),
      inspections: insp.map(({ i, by }) => ({
        id: i.id,
        inspectionType: i.inspectionType,
        inspectedAt: i.inspectedAt.toISOString(),
        inspectedBy: by,
        odometer: toNumber(i.odometer),
        result: i.result,
        items: i.items,
        notes: i.notes,
      })),
      seals: seals.map((s) => ({ sealNo: s.sealNo, appliedAt: s.appliedAt.toISOString(), intact: s.intact, verifiedAt: s.verifiedAt?.toISOString() ?? null })),
      pod: pod[0]
        ? {
            method: pod[0].p.method,
            recipientName: pod[0].p.recipientName,
            recipientPhone: pod[0].p.recipientPhone,
            deliveredAt: pod[0].p.deliveredAt.toISOString(),
            overrideReason: pod[0].p.overrideReason,
            damageReported: pod[0].p.damageReported,
            shortageReported: pod[0].p.shortageReported,
            remarks: pod[0].p.remarks,
            signatureFileId: pod[0].p.signatureFileId,
            photoFileIds: pod[0].p.photoFileIds ?? [],
            recordedBy: pod[0].by,
          }
        : null,
      cargoWeightKg: row.b?.weight ? Number(row.b.weight) : 0,
      availableActions: actions,
      version: t.version,
    };
  }

  // ------------------------------------------------------------------ assignment

  async check(ctx: RequestContext, input: z.infer<typeof assignmentCheckSchema>): Promise<AssignmentCheckDto> {
    const org = await getOrgInfo(this.db, ctx.orgId);
    const window = buildWindow(org, input.plannedStart, input.plannedEnd);
    const result = await this.evaluate(this.db, ctx.orgId, org, input, window, input.bookingId ?? null, input.tripId);
    return { ...result, canOverride: ctx.permissions.has('trips:override_warnings') };
  }

  /** Every vehicle, driver and helper ranked by how cleanly they fit the window (fewest problems first). */
  async candidates(ctx: RequestContext, q: z.infer<typeof candidatesQuerySchema> & { vehicleId?: number }): Promise<CandidatesDto> {
    const org = await getOrgInfo(this.db, ctx.orgId);
    const window = buildWindow(org, q.plannedStart, q.plannedEnd);
    const requirements = await bookingRequirements(this.db, ctx.orgId, q.bookingId);
    const settings = { expiryWarningDays: org.expiryWarningDays, minRestHours: org.minRestHours, maxDutyHours: org.maxDutyHours };

    const vFacts = await loadVehicleFacts(this.db, ctx.orgId, 'all', window, q.tripId);
    const labels = await this.db
      .select({ id: vehicles.id, typeName: vehicleTypes.name })
      .from(vehicles)
      .innerJoin(vehicleTypes, eq(vehicleTypes.id, vehicles.vehicleTypeId))
      .where(eq(vehicles.orgId, ctx.orgId));
    const typeName = new Map(labels.map((l) => [l.id, l.typeName]));

    const vehiclesOut: CandidateDto[] = [...vFacts.values()].map((v) => {
      const r = checkAssignment({ window, requirements, vehicle: v, driver: neutralDriver(v), crew: [], settings });
      return candidate(v.id, v.registrationNo, `${typeName.get(v.id)} · ${(v.payloadCapacityKg / 1000).toFixed(1)} t · ${v.status.replace('_', ' ')}`, r, 'vehicle');
    });

    const target = q.vehicleId ? vFacts.get(q.vehicleId) : undefined;
    const dFacts = await loadWorkerFacts(this.db, ctx.orgId, { type: 'driver' }, window, q.tripId);
    const driversOut: CandidateDto[] = [...dFacts.values()].map((d) => {
      const vehicle = target ?? neutralVehicle(d, requirements.totalWeightKg);
      const r = checkAssignment({ window, requirements: target ? requirements : { ...requirements, requiredBodyType: null, requiredVehicleTypeId: null, requiresTemperatureControl: false }, vehicle, driver: d, crew: [], settings });
      const lic = d.licence ? `${d.licence.classes.join('/')} until ${d.licence.validUntil}` : 'no licence';
      return candidate(d.id, d.name, lic, r, 'driver');
    });

    const hFacts = await loadWorkerFacts(this.db, ctx.orgId, { type: 'helper' }, window, q.tripId);
    const helpersOut: CandidateDto[] = [...hFacts.values()].map((h) => {
      const r = checkAssignment({ window, requirements: { ...requirements, isHazardous: false }, vehicle: neutralVehicle(h, 0), driver: { ...h, id: -1, workerType: 'driver' }, crew: [h], settings });
      return candidate(h.id, h.name, h.employmentStatus, r, 'crew');
    });

    const rank = (a: CandidateDto, b: CandidateDto) =>
      a.blocks.length - b.blocks.length || a.warnings.length - b.warnings.length || a.label.localeCompare(b.label);
    return { vehicles: vehiclesOut.sort(rank), drivers: driversOut.sort(rank), helpers: helpersOut.sort(rank) };
  }

  async create(ctx: RequestContext, input: TripCreateInput, req: Request): Promise<TripDto> {
    const org = await getOrgInfo(this.db, ctx.orgId);
    const window = buildWindow(org, input.plannedStart, input.plannedEnd);
    const id = await this.db.transaction(async (tx) => {
      let booking: typeof bookings.$inferSelect | null = null;
      if (input.bookingId) {
        const [locked] = await tx.select().from(bookings).where(and(eq(bookings.id, input.bookingId), eq(bookings.orgId, ctx.orgId))).for('update');
        if (!locked) throw AppError.validation('Unknown booking', [{ path: 'bookingId', message: 'Booking not found' }]);
        booking = locked;
        if (booking.status !== 'approved') {
          throw AppError.businessRule(`Only approved bookings can be planned; ${booking.bookingNo} is ${booking.status.replace('_', ' ')}`);
        }
        const [live] = await tx
          .select({ tripNo: trips.tripNo })
          .from(trips)
          .where(and(eq(trips.bookingId, booking.id), notInArray(trips.status, ['cancelled'])))
          .limit(1);
        if (live) throw AppError.conflict(`Booking ${booking.bookingNo} already has trip ${live.tripNo}`);
      }
      if (input.parentTripId) await assertTripAccess(tx, ctx, input.parentTripId);
      let route: typeof routes.$inferSelect | undefined;
      const routeId = input.routeId ?? booking?.routeId ?? null;
      if (routeId) {
        [route] = await tx.select().from(routes).where(and(eq(routes.id, routeId), eq(routes.orgId, ctx.orgId)));
        if (!route) throw AppError.validation('Unknown route', [{ path: 'routeId', message: 'Route not found' }]);
      }

      await lockResources(tx, ctx.orgId, input.vehicleId, [input.driverId, ...input.crew.map((c) => c.workerId)]);
      const result = await this.evaluate(tx, ctx.orgId, org, input, window, booking?.id ?? null);
      this.enforce(ctx, result, input.overrideReason);

      const tripNo = await nextNumber(tx, ctx.orgId, 'TRP', orgYear(org, new Date(input.plannedStart)));
      const origin = booking?.originCity ?? input.originCity!;
      const destination = booking?.destinationCity ?? input.destinationCity!;
      const [row] = await tx
        .insert(trips)
        .values({
          orgId: ctx.orgId,
          tripNo,
          bookingId: booking?.id ?? null,
          tripType: input.tripType,
          parentTripId: input.parentTripId ?? null,
          vehicleId: input.vehicleId,
          driverId: input.driverId,
          routeId: route?.id ?? null,
          originCity: origin,
          destinationCity: destination,
          plannedStart: new Date(input.plannedStart),
          plannedEnd: new Date(input.plannedEnd),
          plannedDistanceKm: route?.distanceKm ?? null,
          podStatus: booking ? 'pending' : 'not_required',
          overrideReason: result.warnings.length ? input.overrideReason! : null,
          overriddenBy: result.warnings.length ? ctx.userId : null,
          notes: input.notes ?? null,
          createdBy: ctx.userId,
        })
        .$returningId();
      const tripId = row!.id;

      await this.writeAssignment(tx, ctx.orgId, tripId, input, window);
      await this.writeStops(tx, ctx.orgId, tripId, booking?.id ?? null, origin, destination, route, input);
      await recordHistory(tx, { orgId: ctx.orgId, tripId }, null, 'planned', ctx.userId);
      await recordEvent(tx, {
        orgId: ctx.orgId,
        tripId,
        type: 'created',
        userId: ctx.userId,
        note: result.warnings.length ? `Assigned with ${result.warnings.length} warning(s) overridden: ${input.overrideReason}` : 'Assigned with no rule warnings',
      });
      if (booking) {
        const lr = booking.lrNumber ?? (await nextNumber(tx, ctx.orgId, 'LR', orgYear(org)));
        await tx.update(bookings).set({ status: 'planned', lrNumber: lr, version: sql`${bookings.version} + 1` }).where(eq(bookings.id, booking.id));
      }
      await syncVehicleStatus(tx, input.vehicleId);
      await audit(tx, req, {
        action: 'trip.created',
        entityType: 'trip',
        entityId: tripId,
        summary: `${tripNo}${booking ? ` for ${booking.bookingNo}` : ''}`,
        after: { vehicleId: input.vehicleId, driverId: input.driverId, crew: input.crew, overriddenWarnings: result.warnings.map((w) => w.code) },
      });
      return tripId;
    }, ASSIGNMENT_TX);
    return this.get(ctx, id);
  }

  async reassign(ctx: RequestContext, id: number, input: z.infer<typeof tripReassignSchema>, req: Request): Promise<TripDto> {
    const org = await getOrgInfo(this.db, ctx.orgId);
    const window = buildWindow(org, input.plannedStart, input.plannedEnd);
    await this.db.transaction(async (tx) => {
      const t = await this.lockTrip(tx, ctx, id);
      const editable = t.status === 'planned' || t.status === 'ready' || (t.status === 'on_hold' && t.holdFromStatus !== 'in_transit');
      if (!editable) throw AppError.businessRule(`A ${t.status.replace('_', ' ')} trip cannot be reassigned`);
      await lockResources(tx, ctx.orgId, input.vehicleId, [input.driverId, ...input.crew.map((c) => c.workerId)]);
      const result = await this.evaluate(tx, ctx.orgId, org, input, window, t.bookingId, t.id);
      this.enforce(ctx, result, input.overrideReason);

      const vehicleChanged = input.vehicleId !== t.vehicleId;
      // A new vehicle needs its own pre-trip inspection.
      const nextStatus: TripStatus = vehicleChanged && t.status === 'ready' ? 'planned' : t.status;
      await tx
        .update(trips)
        .set({
          vehicleId: input.vehicleId,
          driverId: input.driverId,
          plannedStart: new Date(input.plannedStart),
          plannedEnd: new Date(input.plannedEnd),
          status: nextStatus,
          holdFromStatus: t.status === 'on_hold' && vehicleChanged && t.holdFromStatus === 'ready' ? 'planned' : t.holdFromStatus,
          overrideReason: result.warnings.length ? input.overrideReason! : t.overrideReason,
          overriddenBy: result.warnings.length ? ctx.userId : t.overriddenBy,
          version: sql`${trips.version} + 1`,
        })
        .where(eq(trips.id, id));
      await tx.delete(tripCrew).where(eq(tripCrew.tripId, id));
      await releaseReservations(tx, id);
      await this.writeAssignment(tx, ctx.orgId, id, input, window);
      if (nextStatus !== t.status) await recordHistory(tx, { orgId: ctx.orgId, tripId: id }, t.status, nextStatus, ctx.userId, 'Vehicle changed; pre-trip inspection required again');
      await recordEvent(tx, { orgId: ctx.orgId, tripId: id, type: 'reassigned', userId: ctx.userId, note: input.reason ?? 'Assignment changed' });
      await syncVehicleStatus(tx, t.vehicleId);
      if (vehicleChanged) await syncVehicleStatus(tx, input.vehicleId);
      await audit(tx, req, {
        action: 'trip.reassigned',
        entityType: 'trip',
        entityId: id,
        summary: t.tripNo,
        before: { vehicleId: t.vehicleId, driverId: t.driverId, plannedStart: t.plannedStart, plannedEnd: t.plannedEnd },
        after: { vehicleId: input.vehicleId, driverId: input.driverId, plannedStart: input.plannedStart, plannedEnd: input.plannedEnd, overriddenWarnings: result.warnings.map((w) => w.code) },
      });
    }, ASSIGNMENT_TX);
    return this.get(ctx, id);
  }

  // ------------------------------------------------------------------ lifecycle actions

  async act(ctx: RequestContext, id: number, input: z.infer<typeof tripActionSchema>, req: Request): Promise<{ trip: TripDto; otp?: OtpIssuedDto }> {
    const action = input.action as TripAction;
    if (action === 'deliver') throw AppError.businessRule('Record proof of delivery (OTP or authorised override) to deliver a trip');
    const org = await getOrgInfo(this.db, ctx.orgId);
    let otp: OtpIssuedDto | undefined;

    await this.db.transaction(async (tx) => {
      const t = await this.lockTrip(tx, ctx, id);
      const own = await isOwnTrip(tx, ctx, t.id, t.driverId);
      const rule = TRIP_ACTION_RULES[action];
      if (!rule.permissions.some((p) => (p === 'trips:update_own' ? own : ctx.permissions.has(p)))) throw AppError.forbidden();
      if (input.version && input.version !== t.version) throw AppError.conflict('This trip was changed by someone else. Reload and try again.');
      const check = checkTripTransition(t.status, action, t.holdFromStatus);
      if (!check.allowed) throw AppError.businessRule(check.reason!);
      if (rule.requiresReason && !input.reason) throw AppError.validation('A reason is required', [{ path: 'reason', message: 'Required' }]);
      const to = check.to!;
      const set: Partial<typeof trips.$inferInsert> = { status: to };
      const base = { orgId: ctx.orgId, tripId: t.id };
      const source = ctx.permissions.has('trips:read') ? 'web' : 'driver_app';

      switch (action) {
        case 'mark_ready': {
          const passed = await this.latestPreTripPassed(tx, t);
          if (!passed) throw AppError.businessRule('A passed pre-trip inspection is required before the trip is ready');
          break;
        }
        case 'dispatch': {
          if (input.odometer === undefined) throw AppError.validation('Enter the starting odometer reading', [{ path: 'odometer', message: 'Required' }]);
          const [v] = await tx.select().from(vehicles).where(eq(vehicles.id, t.vehicleId)).for('update');
          if (input.odometer < Number(v!.odometerKm)) {
            throw AppError.businessRule(`Odometer ${input.odometer} km is below the last recorded ${v!.odometerKm} km`, [{ path: 'odometer', message: 'Too low' }]);
          }
          await this.recheckBeforeDispatch(tx, ctx, org, t);
          const issued = this.newOtp(t.id, t.plannedEnd);
          Object.assign(set, {
            actualStart: new Date(),
            startOdometer: input.odometer.toFixed(1),
            deliveryOtpHash: issued.hash,
            deliveryOtpExpiresAt: issued.expiresAt,
            deliveryOtpAttempts: 0,
          });
          await tx.update(vehicles).set({ odometerKm: input.odometer.toFixed(1) }).where(eq(vehicles.id, t.vehicleId));
          const [first] = await tx.select().from(tripStops).where(eq(tripStops.tripId, t.id)).orderBy(asc(tripStops.seq)).limit(1);
          if (first) await tx.update(tripStops).set({ status: 'departed', actualDeparture: new Date() }).where(eq(tripStops.id, first.id));
          await recordEvent(tx, { ...base, type: 'dispatched', userId: ctx.userId, odometer: input.odometer, stopId: first?.id, source });
          otp = await this.sendOtp(tx, ctx, t, issued);
          break;
        }
        case 'complete': {
          if (input.odometer === undefined) throw AppError.validation('Enter the closing odometer reading', [{ path: 'odometer', message: 'Required' }]);
          if (t.startOdometer && input.odometer < Number(t.startOdometer)) {
            throw AppError.businessRule(`Closing odometer ${input.odometer} km is below the starting ${t.startOdometer} km`, [{ path: 'odometer', message: 'Too low' }]);
          }
          const completedAt = new Date();
          Object.assign(set, { completedAt, endOdometer: input.odometer.toFixed(1) });
          const [v] = await tx.select({ odo: vehicles.odometerKm }).from(vehicles).where(eq(vehicles.id, t.vehicleId)).for('update');
          if (input.odometer > Number(v!.odo)) await tx.update(vehicles).set({ odometerKm: input.odometer.toFixed(1) }).where(eq(vehicles.id, t.vehicleId));
          await releaseReservations(tx, t.id);
          await recordEvent(tx, { ...base, type: 'completed', userId: ctx.userId, odometer: input.odometer, source });
          await this.deps.crewPay?.accrue(tx, t, completedAt, input.odometer);
          break;
        }
        case 'reconcile':
          Object.assign(set, { reconciledAt: new Date() });
          await recordEvent(tx, { ...base, type: 'reconciled', userId: ctx.userId, note: input.reason });
          break;
        case 'close':
          Object.assign(set, { closedAt: new Date() });
          await recordEvent(tx, { ...base, type: 'closed', userId: ctx.userId, note: input.reason });
          break;
        case 'hold':
          Object.assign(set, { holdFromStatus: t.status, holdReason: input.reason });
          await recordEvent(tx, { ...base, type: 'on_hold', userId: ctx.userId, note: input.reason });
          break;
        case 'resume':
          Object.assign(set, { holdFromStatus: null, holdReason: null });
          await recordEvent(tx, { ...base, type: 'resumed', userId: ctx.userId, note: input.reason });
          break;
        case 'cancel':
          await cancelTrip(tx, ctx, t, input.reason!, req, { returnBookingToQueue: true });
          return;
      }

      await tx.update(trips).set({ ...set, version: sql`${trips.version} + 1` }).where(eq(trips.id, t.id));
      await recordHistory(tx, base, t.status, to, ctx.userId, input.reason);
      await syncVehicleStatus(tx, t.vehicleId);
      await syncBookingFromTrip(tx, t.bookingId, to);
      await audit(tx, req, { action: `trip.${action}`, entityType: 'trip', entityId: t.id, summary: `${t.tripNo}: ${t.status} → ${to}${input.reason ? ` (${input.reason})` : ''}` });
    });
    return { trip: await this.get(ctx, id), ...(otp ? { otp } : {}) };
  }

  async reissueOtp(ctx: RequestContext, id: number, req: Request): Promise<OtpIssuedDto> {
    return this.db.transaction(async (tx) => {
      const t = await this.lockTrip(tx, ctx, id);
      if (t.status !== 'in_transit' || t.podStatus !== 'pending') throw AppError.businessRule('An OTP can only be issued for a trip in transit that has not been delivered');
      const issued = this.newOtp(t.id, t.plannedEnd);
      await tx
        .update(trips)
        .set({ deliveryOtpHash: issued.hash, deliveryOtpExpiresAt: issued.expiresAt, deliveryOtpAttempts: 0, version: sql`${trips.version} + 1` })
        .where(eq(trips.id, t.id));
      const otp = await this.sendOtp(tx, ctx, t, issued);
      await audit(tx, req, { action: 'trip.otp_reissued', entityType: 'trip', entityId: t.id, summary: t.tripNo });
      return otp;
    });
  }

  // ------------------------------------------------------------------ proof of delivery

  async deliverWithOtp(ctx: RequestContext, id: number, input: z.infer<typeof podOtpSchema>, req: Request): Promise<TripDto> {
    // Verify outside the main transaction so a failed attempt is counted even though the request fails.
    const [t] = await this.db.select().from(trips).where(and(eq(trips.id, id), ...scope(ctx))).limit(1);
    if (!t) throw AppError.notFound('Trip');
    if (!ctx.permissions.has('trips:dispatch') && !(await isOwnTrip(this.db, ctx, t.id, t.driverId))) throw AppError.forbidden();
    if (t.status !== 'in_transit') throw AppError.businessRule(`Trip is ${t.status.replace('_', ' ')}, not in transit`);
    if (!t.deliveryOtpHash || !t.deliveryOtpExpiresAt || t.deliveryOtpExpiresAt <= new Date()) {
      throw new AppError(422, 'OTP_INVALID', 'No valid delivery OTP is active. Ask dispatch to reissue one.');
    }
    if (t.deliveryOtpAttempts >= MAX_OTP_ATTEMPTS) {
      throw new AppError(422, 'OTP_LOCKED', 'Too many wrong OTP attempts. Dispatch must reissue the OTP or record an authorised override.');
    }
    if (!this.otpMatches(t.id, input.otp, t.deliveryOtpHash)) {
      await this.db
        .update(trips)
        .set({ deliveryOtpAttempts: sql`${trips.deliveryOtpAttempts} + 1` })
        .where(and(eq(trips.id, t.id), lt(trips.deliveryOtpAttempts, MAX_OTP_ATTEMPTS)));
      await recordEvent(this.db, { orgId: ctx.orgId, tripId: t.id, type: 'otp_failed', userId: ctx.userId, note: 'Wrong delivery OTP entered' });
      const left = Math.max(0, MAX_OTP_ATTEMPTS - t.deliveryOtpAttempts - 1);
      throw new AppError(422, 'OTP_INVALID', left ? `Incorrect OTP. ${left} attempt(s) left.` : 'Incorrect OTP. The OTP is now locked.', { attemptsLeft: left });
    }
    await this.completeDelivery(ctx, id, { ...input, method: 'otp' }, req);
    return this.get(ctx, id);
  }

  /** Bypass OTP with a written reason and photographic evidence. Dispatch only; drivers cannot override. */
  async deliverWithOverride(ctx: RequestContext, id: number, input: z.infer<typeof podOverrideSchema>, req: Request): Promise<TripDto> {
    if (!ctx.permissions.has('trips:dispatch')) throw AppError.forbidden('Only dispatch can override OTP verification');
    if (!input.photoFileIds.length) {
      throw AppError.validation('Attach at least one delivery photo to override OTP verification', [{ path: 'photoFileIds', message: 'Required' }]);
    }
    await this.completeDelivery(ctx, id, { ...input, method: 'override' }, req);
    return this.get(ctx, id);
  }

  private async completeDelivery(
    ctx: RequestContext,
    id: number,
    input: (z.infer<typeof podOtpSchema> | z.infer<typeof podOverrideSchema>) & { method: 'otp' | 'override' },
    req: Request,
  ): Promise<void> {
    await this.deps.files.assertOwned(ctx, [...input.photoFileIds, ...(input.signatureFileId ? [input.signatureFileId] : [])], id);
    await this.db.transaction(async (tx) => {
      const t = await this.lockTrip(tx, ctx, id);
      if (t.status !== 'in_transit' || t.podStatus !== 'pending') throw AppError.conflict('This trip has already been delivered or is not in transit');
      const seals = await tx.select().from(cargoSeals).where(eq(cargoSeals.tripId, id));
      if (seals.length && input.sealsIntact === undefined) {
        throw AppError.validation('Confirm whether the cargo seals were intact', [{ path: 'sealsIntact', message: 'Required when seals were applied' }]);
      }
      const now = new Date();
      const reason = 'reason' in input ? input.reason : null;
      await tx.insert(proofOfDelivery).values({
        orgId: ctx.orgId,
        tripId: id,
        method: input.method,
        recipientName: input.recipientName,
        recipientPhone: input.recipientPhone ?? null,
        deliveredAt: now,
        overrideReason: reason,
        damageReported: input.damageReported || input.sealsIntact === false,
        shortageReported: input.shortageReported,
        remarks: input.remarks ?? null,
        signatureFileId: input.signatureFileId ?? null,
        photoFileIds: input.photoFileIds,
        recordedBy: ctx.userId,
      });
      if (seals.length) {
        await tx.update(cargoSeals).set({ verifiedAt: now, verifiedBy: ctx.userId, intact: input.sealsIntact! }).where(eq(cargoSeals.tripId, id));
      }
      await tx
        .update(trips)
        .set({
          status: 'delivered',
          deliveredAt: now,
          podStatus: input.method === 'otp' ? 'verified_otp' : 'override',
          deliveryOtpHash: null,
          overrideReason: input.method === 'override' ? reason : t.overrideReason,
          overriddenBy: input.method === 'override' ? ctx.userId : t.overriddenBy,
          version: sql`${trips.version} + 1`,
        })
        .where(eq(trips.id, id));
      const [last] = await tx.select().from(tripStops).where(eq(tripStops.tripId, id)).orderBy(desc(tripStops.seq)).limit(1);
      if (last && last.status === 'pending') await tx.update(tripStops).set({ status: 'arrived', actualArrival: now }).where(eq(tripStops.id, last.id));
      const flags = [input.damageReported || input.sealsIntact === false ? 'damage reported' : '', input.shortageReported ? 'shortage reported' : '', input.sealsIntact === false ? 'seal broken' : '']
        .filter(Boolean)
        .join(', ');
      await recordEvent(tx, {
        orgId: ctx.orgId,
        tripId: id,
        type: 'delivered',
        userId: ctx.userId,
        stopId: last?.id,
        note: `${input.method === 'otp' ? 'POD verified with consignee OTP' : `POD by authorised override: ${reason}`}. Received by ${input.recipientName}${flags ? ` (${flags})` : ''}`,
        source: ctx.permissions.has('trips:read') ? 'web' : 'driver_app',
      });
      await recordHistory(tx, { orgId: ctx.orgId, tripId: id }, 'in_transit', 'delivered', ctx.userId, reason);
      await syncBookingFromTrip(tx, t.bookingId, 'delivered');
      await syncVehicleStatus(tx, t.vehicleId);
      await audit(tx, req, {
        action: input.method === 'otp' ? 'trip.delivered' : 'trip.pod_override',
        entityType: 'trip',
        entityId: id,
        summary: `${t.tripNo}${flags ? `: ${flags}` : ''}`,
      });
    });
  }

  // ------------------------------------------------------------------ inspections and milestones

  async inspect(ctx: RequestContext, id: number, input: z.infer<typeof inspectionInputSchema>, req: Request): Promise<TripDto> {
    await this.db.transaction(async (tx) => {
      const t = await this.lockTrip(tx, ctx, id);
      if (!ctx.permissions.has('trips:dispatch') && !(await isOwnTrip(tx, ctx, t.id, t.driverId))) throw AppError.forbidden();
      const allowed = input.inspectionType === 'pre_trip' ? ['planned', 'ready'] : ['delivered', 'completed'];
      if (!allowed.includes(t.status)) {
        throw AppError.businessRule(`A ${input.inspectionType.replace('_', '-')} inspection is not possible while the trip is ${t.status.replace('_', ' ')}`);
      }
      const [template] = await tx
        .select()
        .from(inspectionTemplates)
        .where(and(eq(inspectionTemplates.orgId, ctx.orgId), eq(inspectionTemplates.inspectionType, input.inspectionType), eq(inspectionTemplates.isActive, true)))
        .orderBy(desc(inspectionTemplates.id))
        .limit(1);
      if (!template) throw AppError.businessRule('No active inspection checklist is configured');
      const given = new Map(input.items.map((i) => [i.key, i]));
      const missing = template.items.filter((i) => !given.has(i.key));
      if (missing.length) throw AppError.validation(`Answer every checklist item (missing: ${missing.map((m) => m.label).join('; ')})`);
      const items = template.items.map((i) => ({ ...i, result: given.get(i.key)!.result, ...(given.get(i.key)!.note ? { note: given.get(i.key)!.note! } : {}) }));
      const result = items.some((i) => i.critical && i.result === 'fail') ? 'fail' : 'pass';
      if (input.inspectionType === 'pre_trip' && result === 'pass' && !input.sealNumbers.length) {
        const [v] = await tx.select({ body: vehicleTypes.bodyType }).from(vehicles).innerJoin(vehicleTypes, eq(vehicleTypes.id, vehicles.vehicleTypeId)).where(eq(vehicles.id, t.vehicleId));
        const [existingSeal] = await tx.select({ id: cargoSeals.id }).from(cargoSeals).where(eq(cargoSeals.tripId, t.id)).limit(1);
        if (['container', 'closed', 'reefer'].includes(v!.body) && !existingSeal) {
          throw AppError.validation('Record the cargo seal number for a closed or container body', [{ path: 'sealNumbers', message: 'Required' }]);
        }
      }
      const now = new Date();
      await tx.insert(inspections).values({
        orgId: ctx.orgId,
        tripId: t.id,
        vehicleId: t.vehicleId,
        inspectionType: input.inspectionType,
        templateId: template.id,
        inspectedBy: ctx.userId,
        inspectedAt: now,
        odometer: input.odometer?.toFixed(1) ?? null,
        result,
        items,
        notes: input.notes ?? null,
      });
      for (const sealNo of new Set(input.sealNumbers)) {
        try {
          await tx.insert(cargoSeals).values({ orgId: ctx.orgId, tripId: t.id, sealNo, appliedAt: now, appliedBy: ctx.userId });
        } catch (err) {
          if (isDuplicateKeyError(err)) throw AppError.conflict(`Seal ${sealNo} has already been used`, [{ path: 'sealNumbers', message: `${sealNo} already used` }]);
          throw err;
        }
      }
      const base = { orgId: ctx.orgId, tripId: t.id };
      const failedCritical = items.filter((i) => i.critical && i.result === 'fail').map((i) => i.label);
      await recordEvent(tx, {
        ...base,
        type: result === 'pass' ? 'inspection_passed' : 'inspection_failed',
        userId: ctx.userId,
        note: result === 'pass' ? `${input.inspectionType.replace('_', '-')} inspection passed` : `Failed: ${failedCritical.join('; ')}`,
        odometer: input.odometer,
        source: ctx.permissions.has('trips:read') ? 'web' : 'driver_app',
      });
      if (input.inspectionType === 'pre_trip') {
        const next: TripStatus | null = result === 'pass' && t.status === 'planned' ? 'ready' : result === 'fail' && t.status === 'ready' ? 'planned' : null;
        if (next) {
          await tx.update(trips).set({ status: next, version: sql`${trips.version} + 1` }).where(eq(trips.id, t.id));
          await recordHistory(tx, base, t.status, next, ctx.userId, result === 'pass' ? 'Pre-trip inspection passed' : 'Pre-trip inspection failed');
        }
      }
      await audit(tx, req, { action: `trip.inspection_${result}`, entityType: 'trip', entityId: t.id, summary: `${t.tripNo}: ${input.inspectionType}` });
    });
    return this.get(ctx, id);
  }

  async addEvent(ctx: RequestContext, id: number, input: z.infer<typeof tripEventInputSchema>, req: Request): Promise<TripDto> {
    await this.db.transaction(async (tx) => {
      const t = await this.lockTrip(tx, ctx, id);
      if (!ctx.permissions.has('trips:dispatch') && !(await isOwnTrip(tx, ctx, t.id, t.driverId))) throw AppError.forbidden();
      if (!['ready', 'in_transit', 'delivered'].includes(t.status)) throw AppError.businessRule('Milestones can only be recorded on a running trip');
      if (input.stopId) {
        const [stop] = await tx.select().from(tripStops).where(and(eq(tripStops.id, input.stopId), eq(tripStops.tripId, id)));
        if (!stop) throw AppError.validation('Unknown stop', [{ path: 'stopId', message: 'Not a stop of this trip' }]);
        if (input.eventType === 'arrived_stop') await tx.update(tripStops).set({ status: 'arrived', actualArrival: new Date() }).where(eq(tripStops.id, stop.id));
        if (input.eventType === 'departed_stop') await tx.update(tripStops).set({ status: 'departed', actualDeparture: new Date() }).where(eq(tripStops.id, stop.id));
      } else if (input.eventType === 'arrived_stop' || input.eventType === 'departed_stop') {
        throw AppError.validation('Choose the stop', [{ path: 'stopId', message: 'Required for stop arrival or departure' }]);
      }
      await recordEvent(tx, {
        orgId: ctx.orgId,
        tripId: id,
        type: input.eventType,
        userId: ctx.userId,
        note: input.note,
        stopId: input.stopId,
        odometer: input.odometer,
        lat: input.lat,
        lng: input.lng,
        source: ctx.permissions.has('trips:read') ? 'web' : 'driver_app',
      });
      await audit(tx, req, { action: `trip.event.${input.eventType}`, entityType: 'trip', entityId: id, summary: t.tripNo });
    });
    return this.get(ctx, id);
  }

  /** Approved, unplanned bookings loading near this trip's destination soon after it arrives. */
  async backhaul(ctx: RequestContext, id: number): Promise<BookingListItemDto[]> {
    await assertTripAccess(this.db, ctx, id);
    const [t] = await this.db.select().from(trips).where(eq(trips.id, id));
    const from = new Date(t!.plannedEnd.getTime() - 12 * 3_600_000);
    const to = new Date(t!.plannedEnd.getTime() + 72 * 3_600_000);
    const rows = await this.db
      .select({ b: bookings, c: { id: customers.id, name: customers.name } })
      .from(bookings)
      .innerJoin(customers, eq(customers.id, bookings.customerId))
      .where(
        and(
          eq(bookings.orgId, ctx.orgId),
          eq(bookings.status, 'approved'),
          eq(bookings.originCity, t!.destinationCity),
          gte(bookings.loadingWindowStart, from),
          lte(bookings.loadingWindowStart, to),
        ),
      )
      .orderBy(asc(bookings.loadingWindowStart))
      .limit(10);
    return rows.map(({ b, c }) => ({
      id: b.id,
      bookingNo: b.bookingNo,
      status: b.status,
      customer: c,
      customerRef: b.customerRef,
      originCity: b.originCity,
      destinationCity: b.destinationCity,
      loadingWindowStart: b.loadingWindowStart.toISOString(),
      deliveryDeadline: b.deliveryDeadline.toISOString(),
      totalWeightKg: Number(b.totalWeightKg),
      quotedAmount: b.quotedAmount,
      approvedAmount: b.approvedAmount,
      lrNumber: b.lrNumber,
      trip: null,
    }));
  }

  // ------------------------------------------------------------------ internals

  private async lockTrip(tx: Tx, ctx: RequestContext, id: number): Promise<TripRow> {
    const [t] = await tx.select().from(trips).where(and(eq(trips.id, id), ...scope(ctx))).for('update');
    if (!t) throw AppError.notFound('Trip');
    return t;
  }

  private async evaluate(
    db: Db | Tx,
    orgId: number,
    org: OrgInfo,
    input: { vehicleId: number; driverId: number; crew: { workerId: number }[] },
    window: Window,
    bookingId: number | null,
    excludeTripId?: number,
  ): Promise<AssignmentResult> {
    const requirements = await bookingRequirements(db, orgId, bookingId);
    const vehicle = (await loadVehicleFacts(db, orgId, [input.vehicleId], window, excludeTripId)).get(input.vehicleId);
    if (!vehicle) throw AppError.validation('Unknown vehicle', [{ path: 'vehicleId', message: 'Vehicle not found' }]);
    const ids = [input.driverId, ...input.crew.map((c) => c.workerId)];
    const people = await loadWorkerFacts(db, orgId, ids, window, excludeTripId);
    const driver = people.get(input.driverId);
    if (!driver) throw AppError.validation('Unknown driver', [{ path: 'driverId', message: 'Driver not found' }]);
    const crew = input.crew.map((c) => {
      const w = people.get(c.workerId);
      if (!w) throw AppError.validation('Unknown crew member', [{ path: 'crew', message: `Worker ${c.workerId} not found` }]);
      return w;
    });
    return checkAssignment({
      window,
      requirements,
      vehicle,
      driver,
      crew,
      settings: { expiryWarningDays: org.expiryWarningDays, minRestHours: org.minRestHours, maxDutyHours: org.maxDutyHours },
    });
  }

  private enforce(ctx: RequestContext, result: AssignmentResult, overrideReason: string | undefined) {
    if (result.blocks.length) {
      throw new AppError(422, 'ASSIGNMENT_BLOCKED', `This assignment breaks ${result.blocks.length} rule(s)`, { blocks: result.blocks, warnings: result.warnings });
    }
    if (result.warnings.length && !overrideReason) {
      throw new AppError(422, 'OVERRIDE_REQUIRED', `${result.warnings.length} warning(s) need an override reason`, { blocks: [], warnings: result.warnings });
    }
    if (result.warnings.length && !ctx.permissions.has('trips:override_warnings')) {
      throw AppError.forbidden('Overriding assignment warnings requires the trips:override_warnings permission');
    }
  }

  /** Documents and licences can lapse between planning and departure; check again at the gate. */
  private async recheckBeforeDispatch(tx: Tx, ctx: RequestContext, org: OrgInfo, t: TripRow) {
    const now = new Date();
    const end = t.plannedEnd > now ? t.plannedEnd : new Date(now.getTime() + (t.plannedEnd.getTime() - t.plannedStart.getTime()));
    const window = buildWindow(org, now, end);
    const crew = await tx.select({ workerId: tripCrew.workerId }).from(tripCrew).where(eq(tripCrew.tripId, t.id));
    const result = await this.evaluate(tx, ctx.orgId, org, { vehicleId: t.vehicleId, driverId: t.driverId, crew }, window, t.bookingId, t.id);
    const gate = ['VEHICLE_DOC_EXPIRED', 'VEHICLE_DOC_MISSING', 'VEHICLE_UNAVAILABLE', 'DRIVER_LICENCE_EXPIRED', 'DRIVER_INACTIVE', 'DRIVER_LICENCE_REJECTED', 'DRIVER_ON_LEAVE'];
    const blocks = result.blocks.filter((b) => gate.includes(b.code));
    if (blocks.length) throw new AppError(422, 'ASSIGNMENT_BLOCKED', 'This trip can no longer be dispatched', { blocks, warnings: [] });
    if (t.bookingId) {
      const [b] = await tx.select({ no: bookings.ewayBillNo, exp: bookings.ewayBillExpiresAt }).from(bookings).where(eq(bookings.id, t.bookingId));
      if (b?.no && b.exp && b.exp < now) throw AppError.businessRule(`E-way bill ${b.no} expired; extend it before dispatch`);
    }
  }

  private async latestPreTripPassed(tx: Tx, t: TripRow): Promise<boolean> {
    const [last] = await tx
      .select({ result: inspections.result, vehicleId: inspections.vehicleId })
      .from(inspections)
      .where(and(eq(inspections.tripId, t.id), eq(inspections.inspectionType, 'pre_trip')))
      .orderBy(desc(inspections.inspectedAt), desc(inspections.id))
      .limit(1);
    return last?.result === 'pass' && last.vehicleId === t.vehicleId;
  }

  private async writeAssignment(tx: Tx, orgId: number, tripId: number, input: { vehicleId: number; driverId: number; crew: { workerId: number; role: 'co_driver' | 'helper' }[] }, w: Window) {
    if (input.crew.length) await tx.insert(tripCrew).values(input.crew.map((c) => ({ tripId, workerId: c.workerId, role: c.role })));
    const startsAt = new Date(w.start);
    const endsAt = new Date(w.end);
    await tx.insert(resourceReservations).values([
      { orgId, tripId, resourceType: 'vehicle', resourceId: input.vehicleId, startsAt, endsAt },
      { orgId, tripId, resourceType: 'worker', resourceId: input.driverId, startsAt, endsAt },
      ...input.crew.map((c) => ({ orgId, tripId, resourceType: 'worker' as const, resourceId: c.workerId, startsAt, endsAt })),
    ]);
  }

  private async writeStops(
    tx: Tx,
    orgId: number,
    tripId: number,
    bookingId: number | null,
    origin: string,
    destination: string,
    route: typeof routes.$inferSelect | undefined,
    input: TripCreateInput,
  ) {
    if (bookingId) {
      const stops = await tx.select().from(bookingStops).where(eq(bookingStops.bookingId, bookingId)).orderBy(asc(bookingStops.seq));
      await tx.insert(tripStops).values(
        stops.map((s, i) => ({
          orgId,
          tripId,
          seq: i + 1,
          stopType: s.stopType,
          bookingStopId: s.id,
          name: s.name,
          addressLine: s.addressLine,
          city: s.city,
          lat: s.lat,
          lng: s.lng,
          contactName: s.contactName,
          contactPhone: s.contactPhone,
          plannedArrival: i === 0 ? new Date(input.plannedStart) : i === stops.length - 1 ? new Date(input.plannedEnd) : null,
        })),
      );
      return;
    }
    // Empty or return trip: start and end at the org's depots in those cities when known.
    const point = async (city: string, which: 'first' | 'last') => {
      const [depot] = await tx.select().from(locations).where(and(eq(locations.orgId, orgId), eq(locations.city, city), eq(locations.locationType, 'depot'))).limit(1);
      if (depot) return { name: depot.name, lat: depot.lat, lng: depot.lng };
      const p = route?.polyline[which === 'first' ? 0 : route.polyline.length - 1];
      return { name: `${city} (unspecified)`, lat: p ? p[0].toFixed(6) : null, lng: p ? p[1].toFixed(6) : null };
    };
    const a = await point(origin, 'first');
    const b = await point(destination, 'last');
    await tx.insert(tripStops).values([
      { orgId, tripId, seq: 1, stopType: 'pickup', name: a.name, city: origin, lat: a.lat, lng: a.lng, plannedArrival: new Date(input.plannedStart) },
      { orgId, tripId, seq: 2, stopType: 'drop', name: b.name, city: destination, lat: b.lat, lng: b.lng, plannedArrival: new Date(input.plannedEnd) },
    ]);
  }

  private otpKey() {
    return `${this.deps.config.JWT_ACCESS_SECRET}:delivery-otp`;
  }

  private newOtp(tripId: number, plannedEnd: Date) {
    const otp = String(randomInt(0, 1_000_000)).padStart(6, '0');
    const hash = createHmac('sha256', this.otpKey()).update(`${tripId}:${otp}`).digest('hex');
    const base = plannedEnd > new Date() ? plannedEnd : new Date();
    return { otp, hash, expiresAt: new Date(base.getTime() + OTP_VALID_AFTER_PLANNED_END_H * 3_600_000) };
  }

  private otpMatches(tripId: number, otp: string, stored: string): boolean {
    const candidate = createHmac('sha256', this.otpKey()).update(`${tripId}:${otp}`).digest();
    const expected = Buffer.from(stored, 'hex');
    return expected.length === candidate.length && timingSafeEqual(candidate, expected);
  }

  /** Sends the OTP to the consignee (log-only unless a provider is configured) and returns it once to the caller. */
  private async sendOtp(tx: Tx, ctx: RequestContext, t: TripRow, issued: { otp: string; expiresAt: Date }): Promise<OtpIssuedDto> {
    const [drop] = await tx.select().from(tripStops).where(eq(tripStops.tripId, t.id)).orderBy(desc(tripStops.seq)).limit(1);
    const to = drop?.contactPhone ?? null;
    const delivery = to
      ? await this.deps.messenger.send({
          channel: 'sms',
          to,
          purpose: 'delivery_otp',
          body: `TransAxis: share OTP ${issued.otp} with the driver only when goods for trip ${t.tripNo} are received in good condition.`,
        })
      : { delivered: false, status: 'no_consignee_phone' };
    await recordEvent(tx, {
      orgId: ctx.orgId,
      tripId: t.id,
      type: 'otp_issued',
      userId: ctx.userId,
      note: `Delivery OTP issued; consignee notification: ${delivery.status}`,
    });
    return { otp: issued.otp, expiresAt: issued.expiresAt.toISOString(), delivery: { channel: 'sms', to, status: delivery.status } };
  }
}

// ------------------------------------------------------------------ helpers

function candidate(id: number, label: string, detail: string, r: AssignmentResult, resource: 'vehicle' | 'driver' | 'crew'): CandidateDto {
  const mine = (v: { resource: string; resourceId: number }) => v.resource === resource && (resource !== 'crew' || v.resourceId === id);
  return { id, label, detail, blocks: r.blocks.filter(mine), warnings: r.warnings.filter(mine) };
}

/** A driver that satisfies everything, used to isolate vehicle-only problems. */
function neutralDriver(v: VehicleFacts): WorkerFacts {
  return {
    id: -1,
    name: 'n/a',
    workerType: 'driver',
    employmentStatus: 'active',
    licence: { validUntil: '9999-12-31', classes: [v.requiredLicenceClass], verification: 'verified' },
    hazmatCertified: true,
    medicalValidUntil: null,
    approvedLeave: [],
    lastTripEnd: null,
    conflicts: [],
  };
}

/** A vehicle that satisfies everything except the driver's own licence class, to isolate driver problems. */
function neutralVehicle(w: WorkerFacts, weightKg: number): VehicleFacts {
  return {
    id: -1,
    registrationNo: 'n/a',
    status: 'available',
    vehicleTypeId: -1,
    bodyType: 'open',
    requiredLicenceClass: w.licence?.classes[0] ?? 'LMV',
    payloadCapacityKg: Math.max(weightKg, 1),
    volumeCapacityCbm: null,
    documents: (['registration', 'insurance', 'fitness', 'permit', 'pollution'] as const).map((docType) => ({ docType, expiresOn: null })),
    conflicts: [],
  };
}

type ListRow = {
  t: TripRow;
  v: { id: number; registrationNo: string };
  d: { id: number; fullName: string; phone: string };
  b: { id: number; bookingNo: string; lrNumber: string | null } | null;
  c: { name: string } | null;
};

function toListItem({ t, v, d, b, c }: ListRow): TripListItemDto {
  return {
    id: t.id,
    tripNo: t.tripNo,
    tripType: t.tripType,
    status: t.status,
    booking: b?.id ? { id: b.id, bookingNo: b.bookingNo, customerName: c?.name ?? '', lrNumber: b.lrNumber } : null,
    vehicle: { id: v.id, registrationNo: v.registrationNo },
    driver: { id: d.id, fullName: d.fullName, phone: d.phone },
    originCity: t.originCity,
    destinationCity: t.destinationCity,
    plannedStart: t.plannedStart.toISOString(),
    plannedEnd: t.plannedEnd.toISOString(),
    actualStart: t.actualStart?.toISOString() ?? null,
    deliveredAt: t.deliveredAt?.toISOString() ?? null,
  };
}

