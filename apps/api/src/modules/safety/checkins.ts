import type { Request } from 'express';
import { and, asc, desc, eq, inArray, lt, lte, sql } from 'drizzle-orm';
import type { z } from 'zod';
import { driverCheckins, trips, workers, type Db } from '@transaxis/database';
import type { CheckinDto, CheckinStatus } from '@transaxis/shared';
import type { checkinSchema } from '@transaxis/shared';
import { audit } from '../../lib/audit.js';
import type { RequestContext } from '../../lib/context.js';
import { AppError } from '../../lib/errors.js';
import { assertTripAccess, isOwnTrip } from '../../lib/trip-access.js';
import { recordEvent } from '../trips/lifecycle.js';
import type { AlertService } from './alerts.js';

/** Drivers on a running trip check in this often; a check-in is missed after the grace period. */
export const CHECKIN_EVERY_H = 3;
export const CHECKIN_GRACE_MIN = 20;

export class CheckinService {
  constructor(
    private readonly db: Db,
    private readonly alerts: AlertService,
  ) {}

  /** Job: schedule the next check-in for every running trip and flag overdue ones as missed. */
  async monitor(now = new Date()): Promise<{ scheduled: number; missed: number }> {
    const running = await this.db
      .select({ id: trips.id, orgId: trips.orgId, driverId: trips.driverId, actualStart: trips.actualStart })
      .from(trips)
      .where(eq(trips.status, 'in_transit'));
    let scheduled = 0;
    const every = CHECKIN_EVERY_H * 3_600_000;
    for (const t of running) {
      if (!t.actualStart) continue;
      const k = Math.floor((now.getTime() - t.actualStart.getTime()) / every) + 1;
      const dueAt = new Date(t.actualStart.getTime() + k * every);
      const [res] = await this.db.insert(driverCheckins).ignore().values({ orgId: t.orgId, tripId: t.id, workerId: t.driverId, dueAt });
      scheduled += (res as unknown as { affectedRows: number }).affectedRows;
    }

    const overdue = await this.db
      .select({ c: driverCheckins, t: { tripNo: trips.tripNo, vehicleId: trips.vehicleId, status: trips.status }, w: { fullName: workers.fullName, phone: workers.phone } })
      .from(driverCheckins)
      .innerJoin(trips, eq(trips.id, driverCheckins.tripId))
      .innerJoin(workers, eq(workers.id, driverCheckins.workerId))
      .where(and(eq(driverCheckins.status, 'pending'), lt(driverCheckins.dueAt, new Date(now.getTime() - CHECKIN_GRACE_MIN * 60_000))));
    let missed = 0;
    for (const { c, t, w } of overdue) {
      await this.db.update(driverCheckins).set({ status: 'missed' }).where(eq(driverCheckins.id, c.id));
      if (t.status !== 'in_transit') continue; // the trip ended; nothing to chase
      missed++;
      const [prev] = await this.db
        .select({ status: driverCheckins.status })
        .from(driverCheckins)
        .where(and(eq(driverCheckins.tripId, c.tripId), lt(driverCheckins.dueAt, c.dueAt)))
        .orderBy(desc(driverCheckins.dueAt))
        .limit(1);
      const repeated = prev?.status === 'missed';
      await this.alerts.raise(this.db, {
        orgId: c.orgId,
        type: 'missed_checkin',
        severity: repeated ? 'critical' : 'warning',
        title: `${repeated ? 'Second missed' : 'Missed'} check-in: ${w.fullName} on ${t.tripNo}`,
        detail: `Check-in was due ${Math.round((now.getTime() - c.dueAt.getTime()) / 60_000)} min ago. Call ${w.fullName} on ${w.phone}.`,
        tripId: c.tripId,
        vehicleId: t.vehicleId,
        driverId: c.workerId,
        dedupeKey: `trip:${c.tripId}:missed_checkin`,
        now,
      });
    }
    return { scheduled, missed };
  }

  /** The driver (or dispatch on their behalf) confirms they are safe. */
  async checkIn(ctx: RequestContext, tripId: number, input: z.infer<typeof checkinSchema>, req: Request): Promise<CheckinDto> {
    const t = await assertTripAccess(this.db, ctx, tripId);
    if (!ctx.permissions.has('trips:dispatch') && !(await isOwnTrip(this.db, ctx, t.id, t.driverId))) throw AppError.forbidden();
    if (t.status !== 'in_transit') throw AppError.businessRule('Check-ins are only needed while the trip is in transit');
    const now = new Date();
    const id = await this.db.transaction(async (tx) => {
      const [due] = await tx
        .select()
        .from(driverCheckins)
        .where(and(eq(driverCheckins.tripId, tripId), inArray(driverCheckins.status, ['pending', 'missed']), lte(driverCheckins.dueAt, new Date(now.getTime() + 60 * 60_000))))
        .orderBy(asc(driverCheckins.dueAt))
        .limit(1)
        .for('update');
      const fields = { status: 'ok' as CheckinStatus, checkedInAt: now, note: input.note ?? null, lat: input.lat?.toFixed(6) ?? null, lng: input.lng?.toFixed(6) ?? null };
      let checkinId: number;
      if (due) {
        await tx.update(driverCheckins).set(fields).where(eq(driverCheckins.id, due.id));
        // Earlier missed check-ins are settled by this one too.
        await tx.update(driverCheckins).set({ status: 'ok', note: sql`COALESCE(${driverCheckins.note}, 'Covered by a later check-in')` }).where(and(eq(driverCheckins.tripId, tripId), eq(driverCheckins.status, 'missed'), lt(driverCheckins.dueAt, due.dueAt)));
        checkinId = due.id;
      } else {
        const [row] = await tx.insert(driverCheckins).values({ orgId: ctx.orgId, tripId, workerId: t.driverId, dueAt: now, ...fields }).$returningId();
        checkinId = row!.id;
      }
      await recordEvent(tx, {
        orgId: ctx.orgId,
        tripId,
        type: 'checkpoint',
        userId: ctx.userId,
        note: `Driver check-in${input.note ? `: ${input.note}` : ''}`,
        lat: input.lat,
        lng: input.lng,
        source: ctx.permissions.has('trips:read') ? 'web' : 'driver_app',
      });
      await this.alerts.autoResolve(tx, ctx.orgId, `trip:${tripId}:missed_checkin`, 'Driver checked in', now);
      await audit(tx, req, { action: 'trip.checkin', entityType: 'trip', entityId: tripId, summary: input.note ?? 'Check-in' });
      return checkinId;
    });
    return (await this.list(ctx, { tripId, ids: [id] }))[0]!;
  }

  async list(ctx: RequestContext, q: { status?: CheckinStatus; tripId?: number; ids?: number[] }): Promise<CheckinDto[]> {
    const conds = [eq(driverCheckins.orgId, ctx.orgId)];
    if (q.status) conds.push(eq(driverCheckins.status, q.status));
    if (q.tripId) conds.push(eq(driverCheckins.tripId, q.tripId));
    if (q.ids) conds.push(inArray(driverCheckins.id, q.ids));
    const rows = await this.db
      .select({ c: driverCheckins, t: { id: trips.id, tripNo: trips.tripNo, status: trips.status }, w: { id: workers.id, fullName: workers.fullName, phone: workers.phone } })
      .from(driverCheckins)
      .innerJoin(trips, eq(trips.id, driverCheckins.tripId))
      .innerJoin(workers, eq(workers.id, driverCheckins.workerId))
      .where(and(...conds))
      .orderBy(desc(driverCheckins.dueAt))
      .limit(200);
    return rows
      .filter((r) => q.status !== 'missed' || r.t.status === 'in_transit')
      .map(({ c, t, w }) => ({
        id: c.id,
        trip: { id: t.id, tripNo: t.tripNo },
        worker: w,
        dueAt: c.dueAt.toISOString(),
        checkedInAt: c.checkedInAt?.toISOString() ?? null,
        status: c.status,
        note: c.note,
      }));
  }
}
