import type { Request } from 'express';
import Big from 'big.js';
import { and, asc, count, desc, eq, gt, gte, inArray, isNotNull, lt, lte, sql, type SQL } from 'drizzle-orm';
import type { z } from 'zod';
import { fuelLogs, trips, users, vehicles, vehicleTypes, vendors, workers, type Db } from '@transaxis/database';
import { PAYMENT_ACCOUNT, checkFuelFill, median, startOfDayIn, addDays, type FuelLogDto, type FuelVehicleSummaryDto, type Paginated } from '@transaxis/shared';
import type { fuelInputSchema, fuelListQuerySchema } from '@transaxis/shared';
import { audit } from '../../lib/audit.js';
import type { RequestContext } from '../../lib/context.js';
import { AppError } from '../../lib/errors.js';
import { paginated, parseSort, toNumber } from '../../lib/http.js';
import { getOrgInfo, orgDate } from '../../lib/org.js';
import { isOwnTrip } from '../../lib/trip-access.js';
import type { NotificationService } from '../notifications/service.js';
import type { LedgerService } from './ledger.js';

export class FuelService {
  constructor(
    private readonly db: Db,
    private readonly ledger: LedgerService,
    private readonly notifier: NotificationService,
  ) {}

  async list(ctx: RequestContext, q: z.infer<typeof fuelListQuerySchema>): Promise<Paginated<FuelLogDto>> {
    const conds: SQL[] = [eq(fuelLogs.orgId, ctx.orgId)];
    if (q.vehicleId) conds.push(eq(fuelLogs.vehicleId, q.vehicleId));
    if (q.tripId) conds.push(eq(fuelLogs.tripId, q.tripId));
    if (q.anomaly) conds.push(eq(fuelLogs.anomaly, q.anomaly === 'true'));
    if (q.from || q.to) {
      const tz = (await getOrgInfo(this.db, ctx.orgId)).timezone;
      if (q.from) conds.push(gte(fuelLogs.filledAt, startOfDayIn(q.from, tz)));
      if (q.to) conds.push(lt(fuelLogs.filledAt, startOfDayIn(addDays(q.to, 1), tz)));
    }
    const where = and(...conds);
    const sort = parseSort<'filledAt' | 'kmpl'>(q.sort, 'filledAt');
    const col = sort.field === 'kmpl' ? fuelLogs.kmpl : fuelLogs.filledAt;
    const descending = q.sort ? sort.desc : true;
    const [[total], rows] = await Promise.all([
      this.db.select({ n: count() }).from(fuelLogs).where(where),
      this.select().where(where).orderBy(descending ? desc(col) : asc(col), desc(fuelLogs.id)).limit(q.pageSize).offset((q.page - 1) * q.pageSize),
    ]);
    return paginated(rows.map(toDto), q.page, q.pageSize, Number(total?.n ?? 0));
  }

  async get(ctx: RequestContext, id: number): Promise<FuelLogDto> {
    const [row] = await this.select().where(and(eq(fuelLogs.id, id), eq(fuelLogs.orgId, ctx.orgId)));
    if (!row) throw AppError.notFound('Fuel log');
    return toDto(row);
  }

  /** Records a fill: mileage since the last full tank, anomaly checks and the ledger posting. */
  async create(ctx: RequestContext, input: z.infer<typeof fuelInputSchema>, req: Request): Promise<FuelLogDto> {
    if (input.paymentMode === 'driver_paid') {
      throw AppError.validation('Claim fuel the driver paid for as an expense ("Fuel paid by driver") so it is reimbursed in their settlement', [{ path: 'paymentMode', message: 'Use an expense claim' }]);
    }
    const [v] = await this.db
      .select({ v: vehicles })
      .from(vehicles)
      .innerJoin(vehicleTypes, eq(vehicleTypes.id, vehicles.vehicleTypeId))
      .where(and(eq(vehicles.id, input.vehicleId), eq(vehicles.orgId, ctx.orgId)));
    if (!v) throw AppError.validation('Unknown vehicle', [{ path: 'vehicleId', message: 'Vehicle not found' }]);
    const filledAt = new Date(input.filledAt);
    let tripId = input.tripId ?? null;
    if (tripId) {
      const [t] = await this.db.select().from(trips).where(and(eq(trips.id, tripId), eq(trips.orgId, ctx.orgId)));
      if (!t) throw AppError.validation('Unknown trip', [{ path: 'tripId', message: 'Trip not found' }]);
      if (t.vehicleId !== input.vehicleId) throw AppError.validation('That trip used a different vehicle', [{ path: 'tripId', message: 'Vehicle mismatch' }]);
    } else {
      // Link to the trip the vehicle was on at the time, if any.
      const [t] = await this.db
        .select({ id: trips.id })
        .from(trips)
        .where(and(eq(trips.vehicleId, input.vehicleId), isNotNull(trips.actualStart), lte(trips.actualStart, filledAt), sql`COALESCE(${trips.completedAt}, ${trips.deliveredAt}, NOW(3)) >= ${filledAt}`))
        .orderBy(desc(trips.actualStart))
        .limit(1);
      tripId = t?.id ?? null;
    }
    const canWrite = ctx.permissions.has('fuel:write') || ctx.permissions.has('finance:post');
    if (!canWrite) {
      const [t] = tripId ? await this.db.select({ id: trips.id, driverId: trips.driverId }).from(trips).where(eq(trips.id, tripId)) : [];
      if (!t || !(await isOwnTrip(this.db, ctx, t.id, t.driverId))) throw AppError.forbidden('Crew can only record fuel for their own trip');
    }

    const [prev] = await this.db.select().from(fuelLogs).where(and(eq(fuelLogs.vehicleId, input.vehicleId), lt(fuelLogs.filledAt, filledAt))).orderBy(desc(fuelLogs.filledAt)).limit(1);
    const [lastFull] = await this.db
      .select()
      .from(fuelLogs)
      .where(and(eq(fuelLogs.vehicleId, input.vehicleId), eq(fuelLogs.fullTank, true), lt(fuelLogs.filledAt, filledAt)))
      .orderBy(desc(fuelLogs.filledAt))
      .limit(1);
    let litresSinceFull: number | null = null;
    let kmSinceFull: number | null = null;
    if (input.fullTank && lastFull) {
      const between = await this.db
        .select({ l: sql<string>`COALESCE(SUM(${fuelLogs.litres}), 0)` })
        .from(fuelLogs)
        .where(and(eq(fuelLogs.vehicleId, input.vehicleId), gt(fuelLogs.filledAt, lastFull.filledAt), lt(fuelLogs.filledAt, filledAt)));
      litresSinceFull = Number(between[0]?.l ?? 0) + input.litres;
      kmSinceFull = input.odometerKm - Number(lastFull.odometerKm);
    }
    const history = await this.db.select({ k: fuelLogs.kmpl }).from(fuelLogs).where(and(eq(fuelLogs.vehicleId, input.vehicleId), isNotNull(fuelLogs.kmpl), eq(fuelLogs.anomaly, false))).orderBy(desc(fuelLogs.filledAt)).limit(10);
    const typical = history.length >= 3 ? median(history.map((h) => Number(h.k))) : toNumber(v.v.fuelEfficiencyKmpl);
    const check = checkFuelFill({
      litres: input.litres,
      odometerKm: input.odometerKm,
      previousOdometerKm: prev ? Number(prev.odometerKm) : null,
      litresSinceFull,
      kmSinceFull,
      tankLitres: v.v.fuelTankLitres,
      typicalKmpl: typical,
    });
    const amount = new Big(input.litres).times(input.pricePerLitre).round(2, Big.roundHalfUp).toFixed(2);
    const org = await getOrgInfo(this.db, ctx.orgId);

    const id = await this.db.transaction(async (tx) => {
      const [row] = await tx
        .insert(fuelLogs)
        .values({
          orgId: ctx.orgId,
          vehicleId: input.vehicleId,
          tripId,
          workerId: input.workerId ?? ctx.workerId ?? null,
          vendorId: input.vendorId ?? null,
          filledAt,
          odometerKm: input.odometerKm.toFixed(1),
          litres: input.litres.toFixed(2),
          pricePerLitre: input.pricePerLitre.toFixed(2),
          amount,
          paymentMode: input.paymentMode,
          fullTank: input.fullTank,
          stationName: input.stationName ?? null,
          kmpl: check.kmpl?.toFixed(2) ?? null,
          anomaly: check.anomalies.length > 0,
          anomalyReasons: check.anomalies.length ? check.anomalies : null,
          receiptFileId: input.receiptFileId ?? null,
          createdBy: ctx.userId,
        })
        .$returningId();
      if (input.odometerKm > Number(v.v.odometerKm)) await tx.update(vehicles).set({ odometerKm: input.odometerKm.toFixed(1) }).where(eq(vehicles.id, input.vehicleId));
      const credit = PAYMENT_ACCOUNT[input.paymentMode];
      const entry = await this.ledger.post(tx, {
        orgId: ctx.orgId,
        date: orgDate(org, filledAt),
        memo: `Fuel ${input.litres} L for ${v.v.registrationNo}`,
        source: 'fuel',
        sourceId: row!.id,
        idempotencyKey: `fuel:${row!.id}`,
        userId: ctx.userId,
        lines: [
          { account: 'fuel_expense', debit: amount, tripId, vehicleId: input.vehicleId },
          { account: credit, credit: amount, vendorId: credit === 'payables' ? (input.vendorId ?? null) : null, workerId: credit === 'driver_payable' ? (input.workerId ?? ctx.workerId ?? null) : null, tripId },
        ],
      });
      await tx.update(fuelLogs).set({ journalEntryId: entry }).where(eq(fuelLogs.id, row!.id));
      if (check.anomalies.length) {
        await this.notifier.notify(tx, {
          orgId: ctx.orgId,
          permission: 'maintenance:write',
          category: 'system',
          priority: 'high',
          title: `Fuel anomaly on ${v.v.registrationNo}`,
          body: check.anomalies.join(' '),
          link: `/fuel?anomaly=true&vehicleId=${input.vehicleId}`,
          entityType: 'fuel_log',
          entityId: row!.id,
          dedupeKey: `fuel:${row!.id}:anomaly`,
        });
      }
      await audit(tx, req, { action: 'fuel.recorded', entityType: 'fuel_log', entityId: row!.id, summary: `${v.v.registrationNo}: ${input.litres} L, ₹${amount}${check.anomalies.length ? ' (anomaly)' : ''}` });
      return row!.id;
    });
    return this.get(ctx, id);
  }

  async review(ctx: RequestContext, id: number, note: string, req: Request): Promise<FuelLogDto> {
    const f = await this.get(ctx, id);
    await this.db.update(fuelLogs).set({ reviewedBy: ctx.userId, reviewNote: note }).where(eq(fuelLogs.id, id));
    await audit(this.db, req, { action: 'fuel.reviewed', entityType: 'fuel_log', entityId: id, summary: `${f.vehicle.registrationNo}: ${note}` });
    return this.get(ctx, id);
  }

  /** Per-vehicle consumption and mileage for a period. */
  async summary(ctx: RequestContext, from: string, to: string): Promise<FuelVehicleSummaryDto[]> {
    const tz = (await getOrgInfo(this.db, ctx.orgId)).timezone;
    const rows = await this.db
      .select({
        id: vehicles.id,
        registrationNo: vehicles.registrationNo,
        vehicleType: vehicleTypes.name,
        declared: vehicles.fuelEfficiencyKmpl,
        fills: count(fuelLogs.id),
        litres: sql<string>`COALESCE(SUM(${fuelLogs.litres}), 0)`,
        amount: sql<string>`COALESCE(SUM(${fuelLogs.amount}), 0)`,
        kmpl: sql<string | null>`AVG(${fuelLogs.kmpl})`,
        anomalies: sql<string>`COALESCE(SUM(${fuelLogs.anomaly}), 0)`,
      })
      .from(vehicles)
      .innerJoin(vehicleTypes, eq(vehicleTypes.id, vehicles.vehicleTypeId))
      .innerJoin(fuelLogs, and(eq(fuelLogs.vehicleId, vehicles.id), gte(fuelLogs.filledAt, startOfDayIn(from, tz)), lt(fuelLogs.filledAt, startOfDayIn(addDays(to, 1), tz))))
      .where(eq(vehicles.orgId, ctx.orgId))
      .groupBy(vehicles.id)
      .orderBy(asc(vehicles.registrationNo));
    return rows.map((r) => ({
      vehicle: { id: r.id, registrationNo: r.registrationNo, vehicleType: r.vehicleType },
      fills: Number(r.fills),
      litres: Math.round(Number(r.litres) * 100) / 100,
      amount: new Big(r.amount).toFixed(2),
      kmpl: r.kmpl != null ? Math.round(Number(r.kmpl) * 100) / 100 : null,
      declaredKmpl: toNumber(r.declared),
      anomalies: Number(r.anomalies),
    }));
  }

  async anomalyCount(orgId: number) {
    const [r] = await this.db.select({ n: count() }).from(fuelLogs).where(and(eq(fuelLogs.orgId, orgId), eq(fuelLogs.anomaly, true), sql`${fuelLogs.reviewedBy} IS NULL`));
    return Number(r?.n ?? 0);
  }

  async byTrips(tripIds: number[]) {
    if (!tripIds.length) return [];
    return this.db.select({ tripId: fuelLogs.tripId, amount: fuelLogs.amount }).from(fuelLogs).where(inArray(fuelLogs.tripId, tripIds));
  }

  private select() {
    return this.db
      .select({
        f: fuelLogs,
        v: { id: vehicles.id, registrationNo: vehicles.registrationNo },
        t: { id: trips.id, tripNo: trips.tripNo },
        w: { id: workers.id, fullName: workers.fullName },
        vd: { id: vendors.id, name: vendors.name },
        reviewer: users.fullName,
      })
      .from(fuelLogs)
      .innerJoin(vehicles, eq(vehicles.id, fuelLogs.vehicleId))
      .leftJoin(trips, eq(trips.id, fuelLogs.tripId))
      .leftJoin(workers, eq(workers.id, fuelLogs.workerId))
      .leftJoin(vendors, eq(vendors.id, fuelLogs.vendorId))
      .leftJoin(users, eq(users.id, fuelLogs.reviewedBy))
      .$dynamic();
  }
}

type Row = {
  f: typeof fuelLogs.$inferSelect;
  v: { id: number; registrationNo: string };
  t: { id: number; tripNo: string } | null;
  w: { id: number; fullName: string } | null;
  vd: { id: number; name: string } | null;
  reviewer: string | null;
};

function toDto({ f, v, t, w, vd, reviewer }: Row): FuelLogDto {
  return {
    id: f.id,
    vehicle: v,
    trip: t?.id ? t : null,
    worker: w?.id ? w : null,
    vendor: vd?.id ? vd : null,
    filledAt: f.filledAt.toISOString(),
    odometerKm: Number(f.odometerKm),
    litres: Number(f.litres),
    pricePerLitre: f.pricePerLitre,
    amount: f.amount,
    paymentMode: f.paymentMode,
    fullTank: f.fullTank,
    stationName: f.stationName,
    kmpl: toNumber(f.kmpl),
    anomaly: f.anomaly,
    anomalyReasons: f.anomalyReasons ?? [],
    reviewNote: f.reviewNote,
    reviewedBy: reviewer,
  };
}
