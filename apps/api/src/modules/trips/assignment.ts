import { and, eq, gt, gte, inArray, isNull, lt, lte, ne, notInArray, or, sql } from 'drizzle-orm';
import {
  bookings,
  driverLicenceClasses,
  driverLicences,
  leaveRequests,
  resourceReservations,
  trips,
  vehicleDocuments,
  vehicles,
  vehicleTypes,
  workers,
  workerTrainings,
  type DbOrTx,
} from '@transaxis/database';
import {
  MANDATORY_VEHICLE_DOCS,
  type ConflictRef,
  type Requirements,
  type VehicleFacts,
  type WorkerFacts,
  type Window,
} from '@transaxis/shared';
import { AppError } from '../../lib/errors.js';
import { orgDate, type OrgInfo } from '../../lib/org.js';

export function buildWindow(org: OrgInfo, start: string | Date, end: string | Date): Window {
  const s = typeof start === 'string' ? start : start.toISOString();
  const e = typeof end === 'string' ? end : end.toISOString();
  return { start: new Date(s).toISOString(), end: new Date(e).toISOString(), startDate: orgDate(org, s), endDate: orgDate(org, e) };
}

const NO_REQUIREMENTS: Requirements = {
  totalWeightKg: 0,
  totalVolumeCbm: null,
  requiredVehicleTypeId: null,
  requiredBodyType: null,
  requiresTemperatureControl: false,
  isHazardous: false,
};

export async function bookingRequirements(db: DbOrTx, orgId: number, bookingId: number | null | undefined): Promise<Requirements> {
  if (!bookingId) return NO_REQUIREMENTS;
  const [b] = await db.select().from(bookings).where(and(eq(bookings.id, bookingId), eq(bookings.orgId, orgId))).limit(1);
  if (!b) throw AppError.notFound('Booking');
  return {
    totalWeightKg: Number(b.totalWeightKg),
    totalVolumeCbm: b.totalVolumeCbm === null ? null : Number(b.totalVolumeCbm),
    requiredVehicleTypeId: b.requiredVehicleTypeId,
    requiredBodyType: b.requiredBodyType,
    requiresTemperatureControl: b.requiresTemperatureControl,
    isHazardous: b.isHazardous,
  };
}

/** Locks vehicle and worker rows in a fixed order (ids ascending) so concurrent assignments serialise without deadlocks. */
export async function lockResources(tx: DbOrTx, orgId: number, vehicleId: number, workerIds: number[]): Promise<void> {
  const [v] = await tx.select({ id: vehicles.id }).from(vehicles).where(and(eq(vehicles.id, vehicleId), eq(vehicles.orgId, orgId))).for('update');
  if (!v) throw AppError.validation('Unknown vehicle', [{ path: 'vehicleId', message: 'Vehicle not found' }]);
  const ids = [...new Set(workerIds)].sort((a, b) => a - b);
  const rows = await tx.select({ id: workers.id }).from(workers).where(and(inArray(workers.id, ids), eq(workers.orgId, orgId))).for('update');
  if (rows.length !== ids.length) throw AppError.validation('Unknown driver or crew member', [{ path: 'driverId', message: 'Worker not found' }]);
}

async function conflictsFor(db: DbOrTx, type: 'vehicle' | 'worker', ids: number[], w: Window, excludeTripId?: number) {
  const map = new Map<number, ConflictRef[]>();
  if (!ids.length) return map;
  const rows = await db
    .select({ resourceId: resourceReservations.resourceId, tripId: trips.id, tripNo: trips.tripNo, start: resourceReservations.startsAt, end: resourceReservations.endsAt })
    .from(resourceReservations)
    .innerJoin(trips, eq(trips.id, resourceReservations.tripId))
    .where(
      and(
        eq(resourceReservations.resourceType, type),
        inArray(resourceReservations.resourceId, ids),
        eq(resourceReservations.active, true),
        lt(resourceReservations.startsAt, new Date(w.end)),
        gt(resourceReservations.endsAt, new Date(w.start)),
        excludeTripId ? ne(resourceReservations.tripId, excludeTripId) : undefined,
      ),
    );
  for (const r of rows) {
    map.set(r.resourceId, [...(map.get(r.resourceId) ?? []), { tripId: r.tripId, tripNo: r.tripNo, start: r.start.toISOString(), end: r.end.toISOString() }]);
  }
  return map;
}

/** Facts for many vehicles at once (candidate ranking) or one (assignment). */
export async function loadVehicleFacts(db: DbOrTx, orgId: number, vehicleIds: number[] | 'all', w: Window, excludeTripId?: number): Promise<Map<number, VehicleFacts>> {
  const rows = await db
    .select({ v: vehicles, t: vehicleTypes })
    .from(vehicles)
    .innerJoin(vehicleTypes, eq(vehicleTypes.id, vehicles.vehicleTypeId))
    .where(and(eq(vehicles.orgId, orgId), vehicleIds === 'all' ? ne(vehicles.status, 'retired') : inArray(vehicles.id, vehicleIds)));
  const ids = rows.map((r) => r.v.id);
  const out = new Map<number, VehicleFacts>();
  if (!ids.length) return out;
  const docs = await db
    .select({ vehicleId: vehicleDocuments.vehicleId, docType: vehicleDocuments.docType, expiresOn: vehicleDocuments.expiresOn })
    .from(vehicleDocuments)
    .where(and(inArray(vehicleDocuments.vehicleId, ids), inArray(vehicleDocuments.docType, [...MANDATORY_VEHICLE_DOCS])));
  const conflicts = await conflictsFor(db, 'vehicle', ids, w, excludeTripId);
  for (const { v, t } of rows) {
    out.set(v.id, {
      id: v.id,
      registrationNo: v.registrationNo,
      status: v.status,
      vehicleTypeId: v.vehicleTypeId,
      bodyType: t.bodyType,
      requiredLicenceClass: t.requiredLicenceClass,
      payloadCapacityKg: Number(v.payloadCapacityKg),
      volumeCapacityCbm: v.volumeCapacityCbm === null ? null : Number(v.volumeCapacityCbm),
      documents: docs.filter((d) => d.vehicleId === v.id).map((d) => ({ docType: d.docType, expiresOn: d.expiresOn })),
      conflicts: conflicts.get(v.id) ?? [],
    });
  }
  return out;
}

/** Facts for many workers at once: licence, hazmat training, leave, conflicts and last trip end. */
export async function loadWorkerFacts(
  db: DbOrTx,
  orgId: number,
  workerIds: number[] | { type: 'driver' | 'helper' },
  w: Window,
  excludeTripId?: number,
): Promise<Map<number, WorkerFacts>> {
  const rows = await db
    .select()
    .from(workers)
    .where(
      and(
        eq(workers.orgId, orgId),
        Array.isArray(workerIds) ? inArray(workers.id, workerIds) : and(eq(workers.workerType, workerIds.type), ne(workers.employmentStatus, 'terminated')),
      ),
    );
  const ids = rows.map((r) => r.id);
  const out = new Map<number, WorkerFacts>();
  if (!ids.length) return out;

  const lic = await db
    .select({ workerId: driverLicences.workerId, id: driverLicences.id, validUntil: driverLicences.validUntil, verification: driverLicences.verification })
    .from(driverLicences)
    .where(and(inArray(driverLicences.workerId, ids), eq(driverLicences.isCurrent, true)));
  const classes = lic.length
    ? await db.select().from(driverLicenceClasses).where(inArray(driverLicenceClasses.licenceId, lic.map((l) => l.id)))
    : [];
  const hazmat = await db
    .select({ workerId: workerTrainings.workerId })
    .from(workerTrainings)
    .where(
      and(
        inArray(workerTrainings.workerId, ids),
        eq(workerTrainings.trainingType, 'hazmat'),
        or(isNull(workerTrainings.validUntil), gte(workerTrainings.validUntil, w.endDate)),
      ),
    );
  const hazmatSet = new Set(hazmat.map((h) => h.workerId));
  const leave = await db
    .select({ workerId: leaveRequests.workerId, from: leaveRequests.fromDate, to: leaveRequests.toDate })
    .from(leaveRequests)
    .where(and(inArray(leaveRequests.workerId, ids), eq(leaveRequests.status, 'approved'), lte(leaveRequests.fromDate, w.endDate), gte(leaveRequests.toDate, w.startDate)));
  const conflicts = await conflictsFor(db, 'worker', ids, w, excludeTripId);
  // Most recent trip ending before this window, per driver (for rest-period checks).
  const lastEnds = await db
    .select({
      driverId: trips.driverId,
      lastEnd: sql<Date>`MAX(COALESCE(${trips.completedAt}, ${trips.deliveredAt}, ${trips.plannedEnd}))`,
    })
    .from(trips)
    .where(
      and(
        inArray(trips.driverId, ids),
        notInArray(trips.status, ['cancelled']),
        lte(trips.plannedEnd, new Date(w.start)),
        excludeTripId ? ne(trips.id, excludeTripId) : undefined,
      ),
    )
    .groupBy(trips.driverId);

  for (const r of rows) {
    const l = lic.find((x) => x.workerId === r.id);
    const last = lastEnds.find((x) => x.driverId === r.id)?.lastEnd;
    out.set(r.id, {
      id: r.id,
      name: r.fullName,
      workerType: r.workerType,
      employmentStatus: r.employmentStatus,
      licence: l ? { validUntil: l.validUntil, classes: classes.filter((c) => c.licenceId === l.id).map((c) => c.licenceClass), verification: l.verification } : null,
      hazmatCertified: hazmatSet.has(r.id),
      medicalValidUntil: r.medicalValidUntil,
      approvedLeave: leave.filter((x) => x.workerId === r.id).map((x) => ({ from: x.from, to: x.to })),
      lastTripEnd: last ? new Date(last).toISOString() : null,
      conflicts: conflicts.get(r.id) ?? [],
    });
  }
  return out;
}
