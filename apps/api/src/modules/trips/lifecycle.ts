import type { Request } from 'express';
import { and, eq, inArray, sql } from 'drizzle-orm';
import {
  bookings,
  resourceReservations,
  trips,
  tripEvents,
  tripStatusHistory,
  vehicles,
  type DbOrTx,
} from '@transaxis/database';
import { bookingStatusForTrip, type TripEventType, type TripStatus } from '@transaxis/shared';
import { audit } from '../../lib/audit.js';
import type { RequestContext } from '../../lib/context.js';

type Source = 'web' | 'driver_app' | 'system' | 'simulated';

export async function recordHistory(
  tx: DbOrTx,
  t: { orgId: number; tripId: number },
  from: TripStatus | null,
  to: TripStatus,
  userId: number | null,
  reason?: string | null,
): Promise<void> {
  await tx.insert(tripStatusHistory).values({ orgId: t.orgId, tripId: t.tripId, fromStatus: from, toStatus: to, changedBy: userId, reason: reason ?? null });
}

export async function recordEvent(
  tx: DbOrTx,
  e: {
    orgId: number;
    tripId: number;
    type: TripEventType;
    userId: number | null;
    note?: string | null;
    stopId?: number | null;
    odometer?: number | null;
    lat?: number | null;
    lng?: number | null;
    source?: Source;
    at?: Date;
  },
): Promise<void> {
  await tx.insert(tripEvents).values({
    orgId: e.orgId,
    tripId: e.tripId,
    eventType: e.type,
    occurredAt: e.at ?? new Date(),
    note: e.note ?? null,
    stopId: e.stopId ?? null,
    odometer: e.odometer?.toFixed(1) ?? null,
    lat: e.lat?.toFixed(6) ?? null,
    lng: e.lng?.toFixed(6) ?? null,
    recordedBy: e.userId,
    source: e.source ?? 'web',
  });
}

export async function releaseReservations(tx: DbOrTx, tripId: number): Promise<void> {
  await tx.update(resourceReservations).set({ active: false }).where(eq(resourceReservations.tripId, tripId));
}

/**
 * Derives the vehicle's lifecycle status from its live trips. Manual statuses (maintenance,
 * unavailable, retired) are never overwritten here.
 */
export async function syncVehicleStatus(tx: DbOrTx, vehicleId: number): Promise<void> {
  const [v] = await tx.select({ status: vehicles.status }).from(vehicles).where(eq(vehicles.id, vehicleId));
  if (!v) return;
  const live = await tx
    .select({ status: trips.status })
    .from(trips)
    .where(and(eq(trips.vehicleId, vehicleId), inArray(trips.status, ['planned', 'ready', 'in_transit', 'delivered', 'on_hold'])));
  const onTrip = live.some((t) => t.status === 'in_transit' || t.status === 'delivered');
  const next = onTrip ? 'on_trip' : live.length ? 'assigned' : 'available';
  const lifecycleOwned = v.status === 'available' || v.status === 'assigned' || v.status === 'on_trip';
  // A vehicle on the road stays on_trip even if someone marked it unavailable meanwhile.
  if ((lifecycleOwned || onTrip) && v.status !== next) await tx.update(vehicles).set({ status: next }).where(eq(vehicles.id, vehicleId));
}

/** Moves the booking along with its trip, never backwards past invoicing. */
export async function syncBookingFromTrip(tx: DbOrTx, bookingId: number | null, tripStatus: TripStatus): Promise<void> {
  if (!bookingId) return;
  const next = bookingStatusForTrip(tripStatus);
  if (!next) return;
  const [b] = await tx.select({ status: bookings.status }).from(bookings).where(eq(bookings.id, bookingId));
  if (!b || b.status === 'invoiced' || b.status === 'closed' || b.status === 'cancelled') return;
  if (b.status !== next) {
    await tx.update(bookings).set({ status: next, version: sql`${bookings.version} + 1` }).where(eq(bookings.id, bookingId));
  }
}

/**
 * Cancels a trip that has not left yet: releases its vehicle and crew and returns the booking to the
 * planning queue. Callers have already checked the transition is allowed.
 */
export async function cancelTrip(
  tx: DbOrTx,
  ctx: RequestContext,
  trip: { id: number; orgId: number; status: TripStatus; vehicleId: number; bookingId: number | null; tripNo: string },
  reason: string,
  req: Request | null,
  opts: { returnBookingToQueue: boolean },
): Promise<void> {
  await tx
    .update(trips)
    .set({ status: 'cancelled', cancelReason: reason, holdFromStatus: null })
    .where(eq(trips.id, trip.id));
  await releaseReservations(tx, trip.id);
  await recordHistory(tx, { orgId: trip.orgId, tripId: trip.id }, trip.status, 'cancelled', ctx.userId, reason);
  await recordEvent(tx, { orgId: trip.orgId, tripId: trip.id, type: 'cancelled', userId: ctx.userId, note: reason });
  await syncVehicleStatus(tx, trip.vehicleId);
  if (opts.returnBookingToQueue) await syncBookingFromTrip(tx, trip.bookingId, 'cancelled');
  await audit(tx, req, { action: 'trip.cancelled', entityType: 'trip', entityId: trip.id, summary: `${trip.tripNo}: ${reason}` });
}
