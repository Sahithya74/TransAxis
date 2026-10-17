import type { Request } from 'express';
import Big from 'big.js';
import { and, asc, count, desc, eq, gte, inArray, ne } from 'drizzle-orm';
import type { z } from 'zod';
import { bookings, customers, invoices, proofOfDelivery, trips, tripEvents, vehicles, workers, type Db } from '@transaxis/database';
import type { BookingDto, PortalSummaryDto, PortalTrackingDto, TripEventType } from '@transaxis/shared';
import type { portalRequestSchema } from '@transaxis/shared';
import type { RequestContext } from '../../lib/context.js';
import { AppError } from '../../lib/errors.js';
import { getOrgInfo, orgToday } from '../../lib/org.js';
import type { BookingService } from '../bookings/service.js';
import type { NotificationService } from '../notifications/service.js';
import type { TrackingService } from '../tracking/service.js';

const MILESTONES = ['dispatched', 'loading_completed', 'arrived_stop', 'unloading_started', 'delivered', 'delay_reported'] as const satisfies readonly TripEventType[];
const MILESTONE_LABEL: Record<(typeof MILESTONES)[number], string> = {
  dispatched: 'Left the pickup',
  loading_completed: 'Loading completed',
  arrived_stop: 'Arrived at a stop',
  unloading_started: 'Unloading started',
  delivered: 'Delivered',
  delay_reported: 'Delay reported',
};

/**
 * What a customer sees in the portal: their own bookings, invoices and a deliberately limited view of
 * tracking (position only while their goods are on the road, no driver phone numbers).
 */
export class PortalService {
  constructor(
    private readonly db: Db,
    private readonly bookings: BookingService,
    private readonly tracker: TrackingService,
    private readonly notifier: NotificationService,
  ) {}

  private customerId(ctx: RequestContext): number {
    if (!ctx.customerId) throw AppError.forbidden('This account is not linked to a customer');
    return ctx.customerId;
  }

  async summary(ctx: RequestContext): Promise<PortalSummaryDto> {
    const customerId = this.customerId(ctx);
    const org = await getOrgInfo(this.db, ctx.orgId);
    const today = orgToday(org);
    const [[c], active, transit, delivered, open] = await Promise.all([
      this.db.select({ id: customers.id, name: customers.name }).from(customers).where(and(eq(customers.id, customerId), eq(customers.orgId, ctx.orgId))),
      this.db.select({ n: count() }).from(bookings).where(and(eq(bookings.customerId, customerId), inArray(bookings.status, ['draft', 'quoted', 'approved', 'planned', 'in_transit', 'on_hold']))),
      this.db.select({ n: count() }).from(bookings).where(and(eq(bookings.customerId, customerId), eq(bookings.status, 'in_transit'))),
      this.db
        .select({ n: count() })
        .from(trips)
        .innerJoin(bookings, eq(bookings.id, trips.bookingId))
        .where(and(eq(bookings.customerId, customerId), gte(trips.deliveredAt, new Date(Date.now() - 30 * 86_400_000)), ne(trips.status, 'cancelled'))),
      this.db.select().from(invoices).where(and(eq(invoices.customerId, customerId), inArray(invoices.status, ['issued', 'partially_paid']))),
    ]);
    if (!c) throw AppError.forbidden();
    const out = (rows: typeof open) => rows.reduce((s, i) => s.plus(new Big(i.total).minus(i.paid).minus(i.credited)), new Big(0)).toFixed(2);
    return {
      customer: c,
      activeBookings: Number(active[0]?.n ?? 0),
      inTransit: Number(transit[0]?.n ?? 0),
      deliveredLast30Days: Number(delivered[0]?.n ?? 0),
      outstanding: out(open),
      overdue: out(open.filter((i) => i.dueDate < today)),
    };
  }

  async tracking(ctx: RequestContext, bookingId: number): Promise<PortalTrackingDto> {
    const customerId = this.customerId(ctx);
    const [b] = await this.db.select().from(bookings).where(and(eq(bookings.id, bookingId), eq(bookings.orgId, ctx.orgId), eq(bookings.customerId, customerId)));
    if (!b) throw AppError.notFound('Booking');
    const [t] = await this.db
      .select({ t: trips, reg: vehicles.registrationNo, driver: workers.fullName })
      .from(trips)
      .innerJoin(vehicles, eq(vehicles.id, trips.vehicleId))
      .innerJoin(workers, eq(workers.id, trips.driverId))
      .where(and(eq(trips.bookingId, b.id), ne(trips.status, 'cancelled')))
      .orderBy(desc(trips.id))
      .limit(1);
    let live: Awaited<ReturnType<TrackingService['positionAndEta']>> = { position: null, eta: null };
    let milestones: PortalTrackingDto['milestones'] = [];
    let pod: PortalTrackingDto['pod'] = null;
    if (t) {
      live = await this.tracker.positionAndEta(t.t.id);
      const events = await this.db
        .select({ type: tripEvents.eventType, at: tripEvents.occurredAt })
        .from(tripEvents)
        .where(and(eq(tripEvents.tripId, t.t.id), inArray(tripEvents.eventType, [...MILESTONES])))
        .orderBy(asc(tripEvents.occurredAt));
      milestones = events.map((e) => ({ label: MILESTONE_LABEL[e.type as (typeof MILESTONES)[number]] ?? e.type, at: e.at.toISOString() }));
      const [p] = await this.db.select().from(proofOfDelivery).where(eq(proofOfDelivery.tripId, t.t.id)).limit(1);
      if (p) pod = { recipientName: p.recipientName, deliveredAt: p.deliveredAt.toISOString(), method: p.method };
    }
    return {
      bookingId: b.id,
      bookingNo: b.bookingNo,
      status: b.status,
      lrNumber: b.lrNumber,
      trip: t
        ? {
            tripNo: t.t.tripNo,
            status: t.t.status,
            vehicleNo: t.reg,
            driverName: t.driver.split(' ')[0]!,
            plannedEnd: t.t.plannedEnd.toISOString(),
            actualStart: t.t.actualStart?.toISOString() ?? null,
            deliveredAt: t.t.deliveredAt?.toISOString() ?? null,
          }
        : null,
      position: live.position ? { lat: live.position.lat, lng: live.position.lng, recordedAt: live.position.recordedAt, isSimulated: live.position.isSimulated } : null,
      eta: live.eta,
      milestones,
      pod,
    };
  }

  /** A shipment request becomes a draft booking for dispatch to price and plan. */
  async request(ctx: RequestContext, input: z.infer<typeof portalRequestSchema>, req: Request): Promise<BookingDto> {
    const customerId = this.customerId(ctx);
    const booking = await this.bookings.create(
      ctx,
      {
        customerId,
        customerRef: input.customerRef ?? null,
        requiresTemperatureControl: input.category === 'perishable',
        isHazardous: input.category === 'hazardous',
        loadingWindowStart: input.loadingWindowStart,
        deliveryDeadline: input.deliveryDeadline,
        specialInstructions: input.specialInstructions ?? null,
        notes: 'Requested through the customer portal.',
        stops: [
          { stopType: 'pickup', ...input.pickup },
          { stopType: 'drop', ...input.drop },
        ],
        cargo: [{ description: input.cargoDescription, category: input.category, quantity: input.quantity, unit: input.unit, weightKg: input.weightKg, declaredValue: input.declaredValue ?? null }],
        charges: [],
      },
      req,
    );
    await this.notifier.notify(this.db, {
      orgId: ctx.orgId,
      permission: 'bookings:write',
      category: 'trip',
      priority: 'high',
      title: `New shipment request ${booking.bookingNo} from ${booking.customer.name}`,
      body: `${booking.originCity} to ${booking.destinationCity}, loading ${input.loadingWindowStart.slice(0, 10)}`,
      link: `/bookings/${booking.id}`,
      entityType: 'booking',
      entityId: booking.id,
      dedupeKey: `booking:${booking.id}:portal_request`,
    });
    return booking;
  }
}

