import { and, eq } from 'drizzle-orm';
import { tripCrew, trips, type DbOrTx } from '@transaxis/database';
import type { RequestContext } from './context.js';
import { AppError } from './errors.js';

/**
 * Row-level trip access. Holders of trips:read see every trip in their organisation; drivers and
 * helpers with only trips:update_own see trips they are assigned to. Anything else is a 404.
 */
export async function assertTripAccess(db: DbOrTx, ctx: RequestContext, tripId: number) {
  const [t] = await db
    .select({ id: trips.id, driverId: trips.driverId, status: trips.status })
    .from(trips)
    .where(and(eq(trips.id, tripId), eq(trips.orgId, ctx.orgId)))
    .limit(1);
  if (!t) throw AppError.notFound('Trip');
  if (ctx.permissions.has('trips:read')) return t;
  if (await isOwnTrip(db, ctx, t.id, t.driverId)) return t;
  throw AppError.notFound('Trip');
}

/** True when the caller is the driver or a crew member of the trip. */
export async function isOwnTrip(db: DbOrTx, ctx: RequestContext, tripId: number, driverId: number): Promise<boolean> {
  if (!ctx.workerId || !ctx.permissions.has('trips:update_own')) return false;
  if (driverId === ctx.workerId) return true;
  const [c] = await db
    .select({ w: tripCrew.workerId })
    .from(tripCrew)
    .where(and(eq(tripCrew.tripId, tripId), eq(tripCrew.workerId, ctx.workerId)))
    .limit(1);
  return !!c;
}
