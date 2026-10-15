import type { Request } from 'express';
import { and, asc, desc, eq, gt, gte, inArray, like, lt, lte, or, sql, type SQL } from 'drizzle-orm';
import {
  branches,
  files,
  isDuplicateKeyError,
  vehicleDocuments,
  vehicles,
  vehicleTypes,
  type Db,
} from '@transaxis/database';
import {
  MANDATORY_VEHICLE_DOCS,
  VEHICLE_STATUSES,
  addDays,
  summariseCompliance,
  type VehicleFleetSummary,
  type VehicleStatus,
  type LicenceClass,
  type Paginated,
  type VehicleCreateInput,
  type VehicleDocumentDto,
  type VehicleDocumentInput,
  type VehicleDto,
  type VehicleListQuery,
  type VehicleTypeDto,
  type VehicleTypeInput,
  type VehicleUpdateInput,
} from '@transaxis/shared';
import { audit, changedFields } from '../../lib/audit.js';
import type { RequestContext } from '../../lib/context.js';
import { AppError } from '../../lib/errors.js';
import { escapeLike, paginated, parseSort, toNumber } from '../../lib/http.js';
import { getOrgInfo, orgToday } from '../../lib/org.js';

/** Statuses owned by the trip lifecycle; manual edits are refused while a vehicle holds one. */
const LIFECYCLE_STATUSES = new Set(['assigned', 'on_trip']);

const dec = (n: number | null | undefined, scale: number) => (n === null || n === undefined ? null : n.toFixed(scale));

export class VehicleService {
  constructor(private readonly db: Db) {}

  // ------------------------------------------------------------------ vehicle types

  async listTypes(ctx: RequestContext): Promise<VehicleTypeDto[]> {
    const rows = await this.db
      .select()
      .from(vehicleTypes)
      .where(eq(vehicleTypes.orgId, ctx.orgId))
      .orderBy(asc(vehicleTypes.name));
    return rows.map(toTypeDto);
  }

  async createType(ctx: RequestContext, input: VehicleTypeInput, req: Request): Promise<VehicleTypeDto> {
    try {
      const [created] = await this.db
        .insert(vehicleTypes)
        .values({
          orgId: ctx.orgId,
          name: input.name,
          bodyType: input.bodyType,
          requiredLicenceClass: input.requiredLicenceClass,
          defaultPayloadKg: dec(input.defaultPayloadKg, 3),
          isActive: input.isActive ?? true,
        })
        .$returningId();
      await audit(this.db, req, { action: 'vehicle_type.created', entityType: 'vehicle_type', entityId: created!.id, after: input });
      const [row] = await this.db.select().from(vehicleTypes).where(eq(vehicleTypes.id, created!.id));
      return toTypeDto(row!);
    } catch (err) {
      if (isDuplicateKeyError(err)) throw AppError.conflict(`A vehicle type named "${input.name}" already exists`);
      throw err;
    }
  }

  async updateType(ctx: RequestContext, id: number, input: Partial<VehicleTypeInput>, req: Request): Promise<VehicleTypeDto> {
    const [existing] = await this.db
      .select()
      .from(vehicleTypes)
      .where(and(eq(vehicleTypes.id, id), eq(vehicleTypes.orgId, ctx.orgId)))
      .limit(1);
    if (!existing) throw AppError.notFound('Vehicle type');
    const patch = {
      name: input.name,
      bodyType: input.bodyType,
      requiredLicenceClass: input.requiredLicenceClass,
      defaultPayloadKg: input.defaultPayloadKg === undefined ? undefined : dec(input.defaultPayloadKg, 3),
      isActive: input.isActive,
    };
    const diff = changedFields(existing, patch);
    if (diff) {
      try {
        await this.db.update(vehicleTypes).set(patch).where(eq(vehicleTypes.id, id));
      } catch (err) {
        if (isDuplicateKeyError(err)) throw AppError.conflict(`A vehicle type named "${input.name}" already exists`);
        throw err;
      }
      await audit(this.db, req, { action: 'vehicle_type.updated', entityType: 'vehicle_type', entityId: id, ...diff });
    }
    const [row] = await this.db.select().from(vehicleTypes).where(eq(vehicleTypes.id, id));
    return toTypeDto(row!);
  }

  // ------------------------------------------------------------------ vehicles

  async list(ctx: RequestContext, q: VehicleListQuery): Promise<Paginated<VehicleDto>> {
    const org = await getOrgInfo(this.db, ctx.orgId);
    const today = orgToday(org);
    const warnLimit = addDays(today, org.expiryWarningDays);
    const comp = this.complianceSubquery(ctx.orgId);

    const conds: SQL[] = [eq(vehicles.orgId, ctx.orgId)];
    if (q.status) conds.push(eq(vehicles.status, q.status));
    if (q.vehicleTypeId) conds.push(eq(vehicles.vehicleTypeId, q.vehicleTypeId));
    if (q.q) {
      const term = `%${escapeLike(q.q)}%`;
      conds.push(or(like(vehicles.registrationNo, term), like(vehicles.make, term), like(vehicles.model, term))!);
    }
    // "Expired" = at least one mandatory document past expiry; "expiring" = earliest expiry falls
    // inside the warning window; "ok" = all mandatory documents present and outside the window.
    if (q.compliance === 'expired') conds.push(lt(comp.minEff, today));
    if (q.compliance === 'expiring') conds.push(and(gte(comp.minEff, today), lte(comp.minEff, warnLimit))!);
    if (q.compliance === 'ok') {
      conds.push(and(eq(comp.present, MANDATORY_VEHICLE_DOCS.length), gt(comp.minEff, warnLimit))!);
    }
    const where = and(...conds);

    const sortColumns = {
      registrationNo: vehicles.registrationNo,
      status: vehicles.status,
      payloadCapacityKg: vehicles.payloadCapacityKg,
      createdAt: vehicles.createdAt,
    } as const;
    const sort = parseSort<keyof typeof sortColumns>(q.sort, 'registrationNo');
    const orderCol = sortColumns[sort.field];

    const [countRow] = await this.db
      .select({ n: sql<number>`COUNT(*)` })
      .from(vehicles)
      .leftJoin(comp, eq(comp.vehicleId, vehicles.id))
      .where(where);

    const rows = await this.baseSelect()
      .leftJoin(comp, eq(comp.vehicleId, vehicles.id))
      .where(where)
      .orderBy(sort.desc ? desc(orderCol) : asc(orderCol), asc(vehicles.id))
      .limit(q.pageSize)
      .offset((q.page - 1) * q.pageSize);

    const docsByVehicle = await this.docsFor(rows.map((r) => r.v.id));
    const data = rows.map((r) => toVehicleDto(r, docsByVehicle.get(r.v.id) ?? [], today, org.expiryWarningDays));
    return paginated(data, q.page, q.pageSize, Number(countRow?.n ?? 0));
  }

  /** Fleet counts for dashboards. Retired vehicles are excluded from compliance counts. */
  async summary(ctx: RequestContext): Promise<VehicleFleetSummary> {
    const org = await getOrgInfo(this.db, ctx.orgId);
    const today = orgToday(org);
    const statusRows = await this.db
      .select({ status: vehicles.status, n: sql<number>`COUNT(*)` })
      .from(vehicles)
      .where(eq(vehicles.orgId, ctx.orgId))
      .groupBy(vehicles.status);
    const byStatus = Object.fromEntries(VEHICLE_STATUSES.map((s) => [s, 0])) as Record<VehicleStatus, number>;
    for (const r of statusRows) byStatus[r.status] = Number(r.n);

    const active = await this.db
      .select({ id: vehicles.id })
      .from(vehicles)
      .where(and(eq(vehicles.orgId, ctx.orgId), sql`${vehicles.status} <> 'retired'`));
    const docs = await this.docsFor(active.map((v) => v.id));
    const compliance = { ok: 0, expiring: 0, expired: 0, missing: 0 };
    for (const v of active) compliance[summariseCompliance(docs.get(v.id) ?? [], today, org.expiryWarningDays).state]++;

    return {
      total: statusRows.reduce((a, r) => a + Number(r.n), 0),
      byStatus,
      compliance,
      asOf: today,
      expiryWarningDays: org.expiryWarningDays,
    };
  }

  async get(ctx: RequestContext, id: number): Promise<VehicleDto> {
    const org = await getOrgInfo(this.db, ctx.orgId);
    const [row] = await this.baseSelect()
      .where(and(eq(vehicles.id, id), eq(vehicles.orgId, ctx.orgId)))
      .limit(1);
    // Rows from another organisation are reported as not found, never as forbidden.
    if (!row) throw AppError.notFound('Vehicle');
    const docs = await this.docsFor([id]);
    return toVehicleDto(row, docs.get(id) ?? [], orgToday(org), org.expiryWarningDays);
  }

  async create(ctx: RequestContext, input: VehicleCreateInput, req: Request): Promise<VehicleDto> {
    await this.assertRefs(ctx, input.vehicleTypeId, input.branchId ?? null);
    let id: number;
    try {
      const [created] = await this.db
        .insert(vehicles)
        .values({
          orgId: ctx.orgId,
          registrationNo: input.registrationNo,
          vehicleTypeId: input.vehicleTypeId,
          branchId: input.branchId ?? null,
          make: input.make ?? null,
          model: input.model ?? null,
          year: input.year ?? null,
          ownership: input.ownership,
          payloadCapacityKg: dec(input.payloadCapacityKg, 3)!,
          volumeCapacityCbm: dec(input.volumeCapacityCbm, 2),
          fuelType: input.fuelType,
          odometerKm: dec(input.odometerKm, 1)!,
          fuelEfficiencyKmpl: dec(input.fuelEfficiencyKmpl, 2),
          notes: input.notes ?? null,
        })
        .$returningId();
      id = created!.id;
    } catch (err) {
      if (isDuplicateKeyError(err)) {
        throw AppError.conflict(`Vehicle ${input.registrationNo} is already registered`, [
          { path: 'registrationNo', message: 'Already registered' },
        ]);
      }
      throw err;
    }
    await audit(this.db, req, {
      action: 'vehicle.created',
      entityType: 'vehicle',
      entityId: id,
      summary: `Registered ${input.registrationNo}`,
      after: input,
    });
    return this.get(ctx, id);
  }

  async update(ctx: RequestContext, id: number, input: VehicleUpdateInput, req: Request): Promise<VehicleDto> {
    const [existing] = await this.db
      .select()
      .from(vehicles)
      .where(and(eq(vehicles.id, id), eq(vehicles.orgId, ctx.orgId)))
      .limit(1);
    if (!existing) throw AppError.notFound('Vehicle');

    if (input.status && input.status !== existing.status && LIFECYCLE_STATUSES.has(existing.status)) {
      throw AppError.businessRule(
        `Vehicle is currently ${existing.status.replace('_', ' ')}; its status is managed by the trip until the trip is completed or the assignment is released.`,
      );
    }
    if (input.vehicleTypeId !== undefined || input.branchId !== undefined) {
      await this.assertRefs(ctx, input.vehicleTypeId ?? existing.vehicleTypeId, input.branchId === undefined ? null : input.branchId);
    }
    if (input.odometerKm !== undefined && input.odometerKm < Number(existing.odometerKm)) {
      throw AppError.businessRule('Odometer reading cannot go backwards', [
        { path: 'odometerKm', message: `Current reading is ${existing.odometerKm} km` },
      ]);
    }

    const patch = {
      registrationNo: input.registrationNo,
      vehicleTypeId: input.vehicleTypeId,
      branchId: input.branchId,
      make: input.make,
      model: input.model,
      year: input.year,
      ownership: input.ownership,
      payloadCapacityKg: input.payloadCapacityKg === undefined ? undefined : dec(input.payloadCapacityKg, 3)!,
      volumeCapacityCbm: input.volumeCapacityCbm === undefined ? undefined : dec(input.volumeCapacityCbm, 2),
      fuelType: input.fuelType,
      odometerKm: input.odometerKm === undefined ? undefined : dec(input.odometerKm, 1)!,
      fuelEfficiencyKmpl: input.fuelEfficiencyKmpl === undefined ? undefined : dec(input.fuelEfficiencyKmpl, 2),
      notes: input.notes,
      status: input.status,
    };
    const diff = changedFields(existing, patch);
    if (diff) {
      try {
        await this.db.update(vehicles).set(patch).where(and(eq(vehicles.id, id), eq(vehicles.orgId, ctx.orgId)));
      } catch (err) {
        if (isDuplicateKeyError(err)) throw AppError.conflict(`Vehicle ${input.registrationNo} is already registered`);
        throw err;
      }
      await audit(this.db, req, {
        action: diff.after.status ? 'vehicle.status_changed' : 'vehicle.updated',
        entityType: 'vehicle',
        entityId: id,
        summary: existing.registrationNo,
        ...diff,
      });
    }
    return this.get(ctx, id);
  }

  // ------------------------------------------------------------------ documents

  async listDocuments(ctx: RequestContext, vehicleId: number): Promise<VehicleDocumentDto[]> {
    await this.assertVehicle(ctx, vehicleId);
    const rows = await this.db
      .select()
      .from(vehicleDocuments)
      .where(and(eq(vehicleDocuments.vehicleId, vehicleId), eq(vehicleDocuments.orgId, ctx.orgId)))
      .orderBy(asc(vehicleDocuments.docType), desc(vehicleDocuments.expiresOn));
    return rows.map(toDocDto);
  }

  async addDocument(ctx: RequestContext, vehicleId: number, input: VehicleDocumentInput, req: Request): Promise<VehicleDocumentDto> {
    const vehicle = await this.assertVehicle(ctx, vehicleId);
    if (input.fileId) await this.assertFile(ctx, input.fileId);
    const [created] = await this.db
      .insert(vehicleDocuments)
      .values({
        orgId: ctx.orgId,
        vehicleId,
        docType: input.docType,
        documentNo: input.documentNo ?? null,
        issuedOn: input.issuedOn ?? null,
        expiresOn: input.expiresOn ?? null,
        fileId: input.fileId ?? null,
        notes: input.notes ?? null,
      })
      .$returningId();
    await audit(this.db, req, {
      action: 'vehicle_document.created',
      entityType: 'vehicle',
      entityId: vehicleId,
      summary: `${input.docType} added for ${vehicle.registrationNo}`,
      after: input,
    });
    const [row] = await this.db.select().from(vehicleDocuments).where(eq(vehicleDocuments.id, created!.id));
    return toDocDto(row!);
  }

  async updateDocument(
    ctx: RequestContext,
    vehicleId: number,
    docId: number,
    input: VehicleDocumentInput,
    req: Request,
  ): Promise<VehicleDocumentDto> {
    const existing = await this.assertDocument(ctx, vehicleId, docId);
    if (input.fileId) await this.assertFile(ctx, input.fileId);
    const patch = {
      docType: input.docType,
      documentNo: input.documentNo ?? null,
      issuedOn: input.issuedOn ?? null,
      expiresOn: input.expiresOn ?? null,
      fileId: input.fileId ?? null,
      notes: input.notes ?? null,
    };
    const diff = changedFields(existing, patch);
    if (diff) {
      await this.db.update(vehicleDocuments).set(patch).where(eq(vehicleDocuments.id, docId));
      await audit(this.db, req, { action: 'vehicle_document.updated', entityType: 'vehicle', entityId: vehicleId, ...diff });
    }
    const [row] = await this.db.select().from(vehicleDocuments).where(eq(vehicleDocuments.id, docId));
    return toDocDto(row!);
  }

  async deleteDocument(ctx: RequestContext, vehicleId: number, docId: number, req: Request): Promise<void> {
    const existing = await this.assertDocument(ctx, vehicleId, docId);
    await this.db.delete(vehicleDocuments).where(eq(vehicleDocuments.id, docId));
    await audit(this.db, req, {
      action: 'vehicle_document.deleted',
      entityType: 'vehicle',
      entityId: vehicleId,
      before: toDocDto(existing),
    });
  }

  // ------------------------------------------------------------------ helpers

  private baseSelect() {
    return this.db
      .select({
        v: vehicles,
        t: { id: vehicleTypes.id, name: vehicleTypes.name, bodyType: vehicleTypes.bodyType, requiredLicenceClass: vehicleTypes.requiredLicenceClass },
        b: { id: branches.id, name: branches.name },
      })
      .from(vehicles)
      .innerJoin(vehicleTypes, eq(vehicleTypes.id, vehicles.vehicleTypeId))
      .leftJoin(branches, eq(branches.id, vehicles.branchId))
      .$dynamic();
  }

  /** Per vehicle: earliest effective expiry across mandatory doc types, and how many types exist. */
  private complianceSubquery(orgId: number) {
    const effective = this.db
      .select({
        vehicleId: vehicleDocuments.vehicleId,
        eff: sql<string>`MAX(COALESCE(${vehicleDocuments.expiresOn}, '9999-12-31'))`.as('eff'),
      })
      .from(vehicleDocuments)
      .where(and(eq(vehicleDocuments.orgId, orgId), inArray(vehicleDocuments.docType, [...MANDATORY_VEHICLE_DOCS])))
      .groupBy(vehicleDocuments.vehicleId, vehicleDocuments.docType)
      .as('eff_docs');
    return this.db
      .select({
        vehicleId: effective.vehicleId,
        minEff: sql<string>`MIN(${effective.eff})`.as('min_eff'),
        present: sql<number>`COUNT(*)`.as('present_types'),
      })
      .from(effective)
      .groupBy(effective.vehicleId)
      .as('comp');
  }

  private async docsFor(vehicleIds: number[]) {
    const map = new Map<number, { docType: (typeof vehicleDocuments.$inferSelect)['docType']; expiresOn: string | null }[]>();
    if (!vehicleIds.length) return map;
    const rows = await this.db
      .select({ vehicleId: vehicleDocuments.vehicleId, docType: vehicleDocuments.docType, expiresOn: vehicleDocuments.expiresOn })
      .from(vehicleDocuments)
      .where(inArray(vehicleDocuments.vehicleId, vehicleIds));
    for (const r of rows) {
      const list = map.get(r.vehicleId) ?? [];
      list.push({ docType: r.docType, expiresOn: r.expiresOn });
      map.set(r.vehicleId, list);
    }
    return map;
  }

  private async assertRefs(ctx: RequestContext, vehicleTypeId: number, branchId: number | null) {
    const [type] = await this.db
      .select({ id: vehicleTypes.id })
      .from(vehicleTypes)
      .where(and(eq(vehicleTypes.id, vehicleTypeId), eq(vehicleTypes.orgId, ctx.orgId)))
      .limit(1);
    if (!type) throw AppError.validation('Unknown vehicle type', [{ path: 'vehicleTypeId', message: 'Vehicle type not found' }]);
    if (branchId !== null) {
      const [branch] = await this.db
        .select({ id: branches.id })
        .from(branches)
        .where(and(eq(branches.id, branchId), eq(branches.orgId, ctx.orgId)))
        .limit(1);
      if (!branch) throw AppError.validation('Unknown branch', [{ path: 'branchId', message: 'Branch not found' }]);
    }
  }

  private async assertVehicle(ctx: RequestContext, vehicleId: number) {
    const [v] = await this.db
      .select({ id: vehicles.id, registrationNo: vehicles.registrationNo })
      .from(vehicles)
      .where(and(eq(vehicles.id, vehicleId), eq(vehicles.orgId, ctx.orgId)))
      .limit(1);
    if (!v) throw AppError.notFound('Vehicle');
    return v;
  }

  private async assertDocument(ctx: RequestContext, vehicleId: number, docId: number) {
    const [d] = await this.db
      .select()
      .from(vehicleDocuments)
      .where(and(eq(vehicleDocuments.id, docId), eq(vehicleDocuments.vehicleId, vehicleId), eq(vehicleDocuments.orgId, ctx.orgId)))
      .limit(1);
    if (!d) throw AppError.notFound('Vehicle document');
    return d;
  }

  private async assertFile(ctx: RequestContext, fileId: number) {
    const [f] = await this.db
      .select({ id: files.id })
      .from(files)
      .where(and(eq(files.id, fileId), eq(files.orgId, ctx.orgId)))
      .limit(1);
    if (!f) throw AppError.validation('Unknown file', [{ path: 'fileId', message: 'File not found' }]);
  }
}

// ------------------------------------------------------------------ mappers

function toTypeDto(row: typeof vehicleTypes.$inferSelect): VehicleTypeDto {
  return {
    id: row.id,
    name: row.name,
    bodyType: row.bodyType,
    requiredLicenceClass: row.requiredLicenceClass as LicenceClass,
    defaultPayloadKg: toNumber(row.defaultPayloadKg),
    isActive: row.isActive,
  };
}

function toDocDto(row: typeof vehicleDocuments.$inferSelect): VehicleDocumentDto {
  return {
    id: row.id,
    vehicleId: row.vehicleId,
    docType: row.docType,
    documentNo: row.documentNo,
    issuedOn: row.issuedOn,
    expiresOn: row.expiresOn,
    fileId: row.fileId,
    notes: row.notes,
    createdAt: row.createdAt.toISOString(),
  };
}

type BaseRow = {
  v: typeof vehicles.$inferSelect;
  t: { id: number; name: string; bodyType: VehicleTypeDto['bodyType']; requiredLicenceClass: string };
  b: { id: number; name: string } | null;
};

function toVehicleDto(
  r: BaseRow,
  docs: { docType: VehicleDocumentDto['docType']; expiresOn: string | null }[],
  today: string,
  warnDays: number,
): VehicleDto {
  const v = r.v;
  return {
    id: v.id,
    registrationNo: v.registrationNo,
    vehicleType: { ...r.t, requiredLicenceClass: r.t.requiredLicenceClass as LicenceClass },
    branch: r.b?.id ? { id: r.b.id, name: r.b.name } : null,
    make: v.make,
    model: v.model,
    year: v.year,
    ownership: v.ownership,
    payloadCapacityKg: Number(v.payloadCapacityKg),
    volumeCapacityCbm: toNumber(v.volumeCapacityCbm),
    fuelType: v.fuelType,
    odometerKm: Number(v.odometerKm),
    fuelEfficiencyKmpl: toNumber(v.fuelEfficiencyKmpl),
    status: v.status,
    notes: v.notes,
    compliance: summariseCompliance(docs, today, warnDays),
    createdAt: v.createdAt.toISOString(),
    updatedAt: v.updatedAt.toISOString(),
  };
}
