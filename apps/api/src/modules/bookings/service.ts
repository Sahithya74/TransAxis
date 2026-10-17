import type { Request } from 'express';
import { and, asc, desc, eq, gte, inArray, like, lt, notInArray, or, sql, type SQL } from 'drizzle-orm';
import type { z } from 'zod';
import {
  bookingCharges,
  bookingStops,
  bookings,
  cargoItems,
  customers,
  locations,
  routes,
  trips,
  vehicleTypes,
  type Db,
  type Tx,
} from '@transaxis/database';
import {
  BOOKING_ACTION_RULES,
  EDITABLE_BOOKING_STATUSES,
  addDays,
  availableBookingActions,
  checkBookingTransition,
  computeQuote,
  startOfDayIn,
  type BookingAction,
  type BookingDto,
  type BookingInput,
  type BookingListItemDto,
  type BookingListQuery,
  type Paginated,
} from '@transaxis/shared';
import type { bookingActionSchema, bookingQuoteSchema } from '@transaxis/shared';
import { audit } from '../../lib/audit.js';
import type { RequestContext } from '../../lib/context.js';
import { AppError } from '../../lib/errors.js';
import { escapeLike, paginated, parseSort, toNumber } from '../../lib/http.js';
import { getOrgInfo, orgYear } from '../../lib/org.js';
import { nextNumber } from '../../lib/sequences.js';
import { cancelTrip } from '../trips/lifecycle.js';

type BookingRow = typeof bookings.$inferSelect;

/** Customer-portal users only ever see their own customer's bookings. */
function scope(ctx: RequestContext): SQL[] {
  const conds: SQL[] = [eq(bookings.orgId, ctx.orgId)];
  if (!ctx.permissions.has('bookings:read')) {
    if (!ctx.permissions.has('portal:access') || !ctx.customerId) throw AppError.forbidden();
    conds.push(eq(bookings.customerId, ctx.customerId));
  }
  return conds;
}

export class BookingService {
  constructor(private readonly db: Db) {}

  async list(ctx: RequestContext, q: BookingListQuery): Promise<Paginated<BookingListItemDto>> {
    const conds = scope(ctx);
    if (q.status) conds.push(eq(bookings.status, q.status));
    if (q.customerId) conds.push(eq(bookings.customerId, q.customerId));
    if (q.unassigned === 'true') conds.push(eq(bookings.status, 'approved'));
    if (q.from || q.to) {
      // Dates are calendar days in the organisation's timezone, not UTC.
      const tz = (await getOrgInfo(this.db, ctx.orgId)).timezone;
      if (q.from) conds.push(gte(bookings.loadingWindowStart, startOfDayIn(q.from, tz)));
      if (q.to) conds.push(lt(bookings.loadingWindowStart, startOfDayIn(addDays(q.to, 1), tz)));
    }
    if (q.q) {
      const t = `%${escapeLike(q.q)}%`;
      conds.push(or(like(bookings.bookingNo, t), like(bookings.customerRef, t), like(bookings.lrNumber, t), like(customers.name, t))!);
    }
    const where = and(...conds);
    const cols = {
      bookingNo: bookings.bookingNo,
      loadingWindowStart: bookings.loadingWindowStart,
      deliveryDeadline: bookings.deliveryDeadline,
      createdAt: bookings.createdAt,
    } as const;
    const sort = parseSort<keyof typeof cols>(q.sort, 'loadingWindowStart');
    const [count] = await this.db.select({ n: sql<number>`COUNT(*)` }).from(bookings).innerJoin(customers, eq(customers.id, bookings.customerId)).where(where);
    const rows = await this.db
      .select({ b: bookings, c: { id: customers.id, name: customers.name } })
      .from(bookings)
      .innerJoin(customers, eq(customers.id, bookings.customerId))
      .where(where)
      .orderBy(sort.desc ? desc(cols[sort.field]) : asc(cols[sort.field]), desc(bookings.id))
      .limit(q.pageSize)
      .offset((q.page - 1) * q.pageSize);
    const tripMap = await this.liveTrips(rows.map((r) => r.b.id));
    return paginated(
      rows.map(({ b, c }) => toListItem(b, c, tripMap.get(b.id) ?? null)),
      q.page,
      q.pageSize,
      Number(count?.n ?? 0),
    );
  }

  async get(ctx: RequestContext, id: number): Promise<BookingDto> {
    const [row] = await this.db
      .select({ b: bookings, c: { id: customers.id, name: customers.name }, t: { id: vehicleTypes.id, name: vehicleTypes.name } })
      .from(bookings)
      .innerJoin(customers, eq(customers.id, bookings.customerId))
      .leftJoin(vehicleTypes, eq(vehicleTypes.id, bookings.requiredVehicleTypeId))
      .where(and(eq(bookings.id, id), ...scope(ctx)))
      .limit(1);
    if (!row) throw AppError.notFound('Booking');
    const { b } = row;
    const [stops, cargo, charges, tripMap] = await Promise.all([
      this.db.select().from(bookingStops).where(eq(bookingStops.bookingId, id)).orderBy(asc(bookingStops.seq)),
      this.db.select().from(cargoItems).where(eq(cargoItems.bookingId, id)).orderBy(asc(cargoItems.id)),
      this.db.select().from(bookingCharges).where(eq(bookingCharges.bookingId, id)).orderBy(asc(bookingCharges.id)),
      this.liveTrips([id]),
    ]);
    const actions = availableBookingActions(b.status, b.holdFromStatus).filter((a) => ctx.permissions.has(BOOKING_ACTION_RULES[a].permission));
    return {
      ...toListItem(b, row.c, tripMap.get(id) ?? null),
      routeId: b.routeId,
      requiredVehicleType: row.t?.id ? row.t : null,
      requiredBodyType: b.requiredBodyType,
      requiresTemperatureControl: b.requiresTemperatureControl,
      isHazardous: b.isHazardous,
      totalVolumeCbm: toNumber(b.totalVolumeCbm),
      loadingWindowEnd: b.loadingWindowEnd?.toISOString() ?? null,
      ewayBillNo: b.ewayBillNo,
      ewayBillExpiresAt: b.ewayBillExpiresAt?.toISOString() ?? null,
      rateBasis: b.rateBasis,
      rate: b.rate,
      paymentTermsDays: b.paymentTermsDays,
      specialInstructions: b.specialInstructions,
      notes: b.notes,
      holdReason: b.holdReason,
      cancelReason: b.cancelReason,
      quotedAt: b.quotedAt?.toISOString() ?? null,
      approvedAt: b.approvedAt?.toISOString() ?? null,
      createdAt: b.createdAt.toISOString(),
      stops: stops.map((s) => ({
        id: s.id,
        seq: s.seq,
        stopType: s.stopType,
        locationId: s.locationId,
        name: s.name,
        addressLine: s.addressLine,
        city: s.city,
        state: s.state,
        pincode: s.pincode,
        lat: toNumber(s.lat),
        lng: toNumber(s.lng),
        contactName: s.contactName,
        contactPhone: s.contactPhone,
        windowStart: s.windowStart?.toISOString() ?? null,
        windowEnd: s.windowEnd?.toISOString() ?? null,
        instructions: s.instructions,
      })),
      cargo: cargo.map((c) => ({
        id: c.id,
        description: c.description,
        category: c.category,
        hsnCode: c.hsnCode,
        quantity: Number(c.quantity),
        unit: c.unit,
        weightKg: Number(c.weightKg),
        volumeCbm: toNumber(c.volumeCbm),
        packaging: c.packaging,
        declaredValue: c.declaredValue,
        handling: c.handling,
      })),
      charges: charges.map((c) => ({ id: c.id, chargeType: c.chargeType, description: c.description, amount: c.amount, isTaxable: c.isTaxable })),
      availableActions: actions,
      editable: EDITABLE_BOOKING_STATUSES.includes(b.status) && ctx.permissions.has('bookings:write'),
      version: b.version,
    };
  }

  async create(ctx: RequestContext, input: BookingInput, req: Request): Promise<BookingDto> {
    const org = await getOrgInfo(this.db, ctx.orgId);
    const id = await this.db.transaction(async (tx) => {
      const customer = await this.assertRefs(tx, ctx, input);
      const bookingNo = await nextNumber(tx, ctx.orgId, 'BKG', orgYear(org));
      const [row] = await tx
        .insert(bookings)
        .values({
          ...derived(input),
          orgId: ctx.orgId,
          bookingNo,
          customerId: input.customerId,
          status: 'draft',
          paymentTermsDays: input.paymentTermsDays ?? customer.paymentTermsDays,
          createdBy: ctx.userId,
        })
        .$returningId();
      await this.writeChildren(tx, ctx.orgId, row!.id, input);
      await audit(tx, req, { action: 'booking.created', entityType: 'booking', entityId: row!.id, summary: `${bookingNo} for ${customer.name}` });
      return row!.id;
    });
    return this.get(ctx, id);
  }

  /** Full replace while the booking is still editable. Editing a quoted booking voids the quote. */
  async replace(ctx: RequestContext, id: number, input: BookingInput, expectedVersion: number | undefined, req: Request): Promise<BookingDto> {
    await this.db.transaction(async (tx) => {
      const existing = await this.lockRow(tx, ctx, id);
      if (expectedVersion && expectedVersion !== existing.version) {
        throw AppError.conflict('This booking was changed by someone else. Reload and try again.');
      }
      if (!EDITABLE_BOOKING_STATUSES.includes(existing.status)) {
        throw AppError.businessRule(`A ${existing.status.replace('_', ' ')} booking can no longer be edited`);
      }
      if (input.customerId !== existing.customerId) throw AppError.businessRule('The customer of an existing booking cannot be changed');
      await this.assertRefs(tx, ctx, input);
      const wasQuoted = existing.status === 'quoted';
      await tx
        .update(bookings)
        .set({
          ...derived(input),
          paymentTermsDays: input.paymentTermsDays ?? existing.paymentTermsDays,
          ...(wasQuoted ? { status: 'draft' as const, quotedAmount: null, quotedAt: null, quotedBy: null } : {}),
          version: sql`${bookings.version} + 1`,
        })
        .where(eq(bookings.id, id));
      await tx.delete(bookingStops).where(eq(bookingStops.bookingId, id));
      await tx.delete(cargoItems).where(eq(cargoItems.bookingId, id));
      await tx.delete(bookingCharges).where(eq(bookingCharges.bookingId, id));
      await this.writeChildren(tx, ctx.orgId, id, input);
      await audit(tx, req, {
        action: 'booking.updated',
        entityType: 'booking',
        entityId: id,
        summary: wasQuoted ? `${existing.bookingNo}: edited, quote voided` : existing.bookingNo,
      });
    });
    return this.get(ctx, id);
  }

  /** Prices the booking. The freight line is recomputed; other charges on the booking are kept. */
  async quote(ctx: RequestContext, id: number, input: z.infer<typeof bookingQuoteSchema>, req: Request): Promise<BookingDto> {
    await this.db.transaction(async (tx) => {
      const b = await this.lockRow(tx, ctx, id);
      const check = checkBookingTransition(b.status, 'quote');
      if (!check.allowed) throw AppError.businessRule(check.reason!);
      let distance = input.distanceKm ?? null;
      if (input.rateBasis === 'per_km' && distance === null && b.routeId) {
        const [r] = await tx.select({ d: routes.distanceKm }).from(routes).where(eq(routes.id, b.routeId));
        distance = r ? Number(r.d) : null;
      }
      if (input.rateBasis === 'per_km' && distance === null) {
        throw AppError.validation('Distance is required for a per-km rate', [{ path: 'distanceKm', message: 'Required for per-km pricing' }]);
      }
      const others = (await tx.select().from(bookingCharges).where(eq(bookingCharges.bookingId, id))).filter((c) => c.chargeType !== 'freight');
      const result = computeQuote({
        rateBasis: input.rateBasis,
        rate: input.rate,
        totalWeightKg: Number(b.totalWeightKg),
        distanceKm: distance,
        extraCharges: others.map((c) => ({ label: c.description ?? c.chargeType, amount: c.amount })),
      });
      await tx.delete(bookingCharges).where(and(eq(bookingCharges.bookingId, id), eq(bookingCharges.chargeType, 'freight')));
      await tx.insert(bookingCharges).values({ orgId: ctx.orgId, bookingId: id, chargeType: 'freight', description: result.lines[0]!.formula, amount: result.lines[0]!.amount });
      await tx
        .update(bookings)
        .set({
          status: 'quoted',
          rateBasis: input.rateBasis,
          rate: input.rate.toFixed(2),
          quotedAmount: result.total,
          quotedAt: new Date(),
          quotedBy: ctx.userId,
          version: sql`${bookings.version} + 1`,
        })
        .where(eq(bookings.id, id));
      await audit(tx, req, { action: 'booking.quoted', entityType: 'booking', entityId: id, summary: `${b.bookingNo}: ₹${result.total}`, after: result });
    });
    return this.get(ctx, id);
  }

  async act(ctx: RequestContext, id: number, input: z.infer<typeof bookingActionSchema>, req: Request): Promise<BookingDto> {
    const rule = BOOKING_ACTION_RULES[input.action as BookingAction];
    if (!ctx.permissions.has(rule.permission)) throw AppError.forbidden();
    if (rule.requiresReason && !input.reason) throw AppError.validation('A reason is required', [{ path: 'reason', message: 'Required' }]);

    await this.db.transaction(async (tx) => {
      const b = await this.lockRow(tx, ctx, id);
      const check = checkBookingTransition(b.status, input.action, b.holdFromStatus);
      if (!check.allowed) throw AppError.businessRule(check.reason!);
      const to = check.to!;
      const set: Partial<typeof bookings.$inferInsert> = { status: to };

      switch (input.action) {
        case 'approve': {
          const amount = input.approvedAmount ?? (b.quotedAmount ? Number(b.quotedAmount) : null);
          if (!amount) throw AppError.validation('Set the approved amount', [{ path: 'approvedAmount', message: 'Required' }]);
          Object.assign(set, { approvedAmount: amount.toFixed(2), approvedAt: new Date(), approvedBy: ctx.userId });
          break;
        }
        case 'hold':
          Object.assign(set, { holdFromStatus: b.status, holdReason: input.reason });
          break;
        case 'resume':
          Object.assign(set, { holdFromStatus: null, holdReason: null });
          break;
        case 'cancel': {
          // A planned booking's trip must not have left yet; cancel it together with the booking.
          const live = await tx
            .select()
            .from(trips)
            .where(and(eq(trips.bookingId, id), notInArray(trips.status, ['cancelled', 'closed'])));
          for (const t of live) {
            if (!['planned', 'ready', 'on_hold'].includes(t.status) || (t.status === 'on_hold' && t.holdFromStatus === 'in_transit')) {
              throw AppError.businessRule(`Trip ${t.tripNo} has already left; it cannot be cancelled with the booking`);
            }
            await cancelTrip(tx, ctx, t, `Booking cancelled: ${input.reason}`, req, { returnBookingToQueue: false });
          }
          Object.assign(set, { cancelledAt: new Date(), cancelReason: input.reason, holdFromStatus: null });
          break;
        }
      }
      await tx
        .update(bookings)
        .set({ ...set, version: sql`${bookings.version} + 1` })
        .where(eq(bookings.id, id));
      await audit(tx, req, {
        action: `booking.${input.action}`,
        entityType: 'booking',
        entityId: id,
        summary: `${b.bookingNo}: ${b.status} → ${to}${input.reason ? ` (${input.reason})` : ''}`,
      });
    });
    return this.get(ctx, id);
  }

  // ------------------------------------------------------------------ helpers

  private async lockRow(tx: Tx, ctx: RequestContext, id: number): Promise<BookingRow> {
    const [b] = await tx.select().from(bookings).where(and(eq(bookings.id, id), eq(bookings.orgId, ctx.orgId))).for('update');
    if (!b) throw AppError.notFound('Booking');
    return b;
  }

  private async assertRefs(tx: Tx, ctx: RequestContext, input: BookingInput) {
    const [customer] = await tx.select().from(customers).where(and(eq(customers.id, input.customerId), eq(customers.orgId, ctx.orgId)));
    if (!customer) throw AppError.validation('Unknown customer', [{ path: 'customerId', message: 'Customer not found' }]);
    if (customer.status !== 'active') throw AppError.businessRule(`${customer.name} is ${customer.status.replace('_', ' ')}; new bookings are not allowed`);
    if (input.routeId) {
      const [r] = await tx.select({ id: routes.id }).from(routes).where(and(eq(routes.id, input.routeId), eq(routes.orgId, ctx.orgId)));
      if (!r) throw AppError.validation('Unknown route', [{ path: 'routeId', message: 'Route not found' }]);
    }
    if (input.requiredVehicleTypeId) {
      const [t] = await tx.select({ id: vehicleTypes.id }).from(vehicleTypes).where(and(eq(vehicleTypes.id, input.requiredVehicleTypeId), eq(vehicleTypes.orgId, ctx.orgId)));
      if (!t) throw AppError.validation('Unknown vehicle type', [{ path: 'requiredVehicleTypeId', message: 'Vehicle type not found' }]);
    }
    const locIds = input.stops.map((s) => s.locationId).filter((x): x is number => !!x);
    if (locIds.length) {
      const found = await tx.select({ id: locations.id }).from(locations).where(and(inArray(locations.id, locIds), eq(locations.orgId, ctx.orgId)));
      if (found.length !== new Set(locIds).size) throw AppError.validation('Unknown location on a stop');
    }
    return customer;
  }

  private async writeChildren(tx: Tx, orgId: number, bookingId: number, input: BookingInput) {
    await tx.insert(bookingStops).values(
      input.stops.map((s, i) => ({
        orgId,
        bookingId,
        seq: i + 1,
        stopType: s.stopType,
        locationId: s.locationId ?? null,
        name: s.name,
        addressLine: s.addressLine ?? null,
        city: s.city,
        state: s.state ?? null,
        pincode: s.pincode ?? null,
        lat: s.lat?.toFixed(6) ?? null,
        lng: s.lng?.toFixed(6) ?? null,
        contactName: s.contactName ?? null,
        contactPhone: s.contactPhone ?? null,
        windowStart: s.windowStart ? new Date(s.windowStart) : null,
        windowEnd: s.windowEnd ? new Date(s.windowEnd) : null,
        instructions: s.instructions ?? null,
      })),
    );
    await tx.insert(cargoItems).values(
      input.cargo.map((c) => ({
        orgId,
        bookingId,
        description: c.description,
        category: c.category,
        hsnCode: c.hsnCode ?? null,
        quantity: c.quantity.toFixed(3),
        unit: c.unit,
        weightKg: c.weightKg.toFixed(3),
        volumeCbm: c.volumeCbm?.toFixed(2) ?? null,
        packaging: c.packaging ?? null,
        declaredValue: c.declaredValue?.toFixed(2) ?? null,
        handling: c.handling ?? null,
      })),
    );
    if (input.charges.length) {
      await tx.insert(bookingCharges).values(
        input.charges.map((c) => ({ orgId, bookingId, chargeType: c.chargeType, description: c.description ?? null, amount: c.amount.toFixed(2), isTaxable: c.isTaxable })),
      );
    }
  }

  private async liveTrips(bookingIds: number[]) {
    const map = new Map<number, { id: number; tripNo: string; status: (typeof trips.$inferSelect)['status'] }>();
    if (!bookingIds.length) return map;
    const rows = await this.db
      .select({ id: trips.id, tripNo: trips.tripNo, status: trips.status, bookingId: trips.bookingId })
      .from(trips)
      .where(and(inArray(trips.bookingId, bookingIds), notInArray(trips.status, ['cancelled'])))
      .orderBy(desc(trips.id));
    for (const r of rows) if (r.bookingId && !map.has(r.bookingId)) map.set(r.bookingId, { id: r.id, tripNo: r.tripNo, status: r.status });
    return map;
  }
}

/** Columns computed from the payload: route endpoints, totals and safety flags. */
function derived(input: BookingInput) {
  const weight = input.cargo.reduce((s, c) => s + c.weightKg, 0);
  const volumes = input.cargo.map((c) => c.volumeCbm).filter((v): v is number => v != null);
  return {
    customerRef: input.customerRef ?? null,
    routeId: input.routeId ?? null,
    originCity: input.stops[0]!.city,
    destinationCity: input.stops[input.stops.length - 1]!.city,
    requiredVehicleTypeId: input.requiredVehicleTypeId ?? null,
    requiredBodyType: input.requiredBodyType ?? null,
    requiresTemperatureControl: input.requiresTemperatureControl,
    // Any hazardous cargo line makes the whole booking hazardous, whatever the checkbox says.
    isHazardous: input.isHazardous || input.cargo.some((c) => c.category === 'hazardous'),
    totalWeightKg: weight.toFixed(3),
    totalVolumeCbm: volumes.length ? volumes.reduce((a, b) => a + b, 0).toFixed(2) : null,
    loadingWindowStart: new Date(input.loadingWindowStart),
    loadingWindowEnd: input.loadingWindowEnd ? new Date(input.loadingWindowEnd) : null,
    deliveryDeadline: new Date(input.deliveryDeadline),
    ewayBillNo: input.ewayBillNo ?? null,
    ewayBillExpiresAt: input.ewayBillExpiresAt ? new Date(input.ewayBillExpiresAt) : null,
    rateBasis: input.rateBasis ?? null,
    rate: input.rate?.toFixed(2) ?? null,
    specialInstructions: input.specialInstructions ?? null,
    notes: input.notes ?? null,
  };
}

function toListItem(b: BookingRow, c: { id: number; name: string }, trip: BookingListItemDto['trip']): BookingListItemDto {
  return {
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
    trip,
  };
}
