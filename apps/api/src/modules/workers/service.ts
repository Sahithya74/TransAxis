import type { Request } from 'express';
import { and, asc, desc, eq, gte, inArray, isNull, like, lt, lte, or, sql, type SQL } from 'drizzle-orm';
import {
  attendance,
  branches,
  compensationPolicies,
  driverLicenceClasses,
  driverLicences,
  isDuplicateKeyError,
  leaveRequests,
  trips,
  users,
  workerDocuments,
  workers,
  workerTrainings,
  type Db,
} from '@transaxis/database';
import {
  ACTIVE_TRIP_STATUSES,
  addDays,
  type AttendanceRowDto,
  type CompensationPolicyDto,
  type LicenceClass,
  type LicenceDto,
  type LicenceInput,
  type LicenceState,
  type LeaveDto,
  type Paginated,
  type TrainingDto,
  type WorkerCreateInput,
  type WorkerDocumentDto,
  type WorkerDto,
  type WorkerListQuery,
  type WorkerUpdateInput,
} from '@transaxis/shared';
import type { z } from 'zod';
import type {
  attendanceUpsertSchema,
  compensationPolicyInputSchema,
  leaveDecisionSchema,
  leaveListQuerySchema,
  leaveRequestSchema,
  trainingInputSchema,
  workerDocumentInputSchema,
} from '@transaxis/shared';
import { audit, changedFields } from '../../lib/audit.js';
import type { RequestContext } from '../../lib/context.js';
import { AppError } from '../../lib/errors.js';
import { escapeLike, paginated, parseSort, toNumber } from '../../lib/http.js';
import { getOrgInfo, orgToday } from '../../lib/org.js';

type WorkerRow = typeof workers.$inferSelect;
const SENSITIVE_KEYS = [
  'dateOfBirth',
  'address',
  'bloodGroup',
  'emergencyContactName',
  'emergencyContactPhone',
  'emergencyContactRelation',
  'baseMonthlySalary',
] as const;

const dec = (n: number | null | undefined, scale: number) => (n === null || n === undefined ? n : n.toFixed(scale));
export const maskLicence = (no: string) => (no.length <= 4 ? '••••' : `${'•'.repeat(Math.max(4, no.length - 4))}${no.slice(-4)}`);

export class WorkerService {
  constructor(private readonly db: Db) {}

  // ------------------------------------------------------------------ workers

  async list(ctx: RequestContext, q: WorkerListQuery): Promise<Paginated<WorkerDto>> {
    const org = await getOrgInfo(this.db, ctx.orgId);
    const today = orgToday(org);
    const conds: SQL[] = [eq(workers.orgId, ctx.orgId)];
    if (q.workerType) conds.push(eq(workers.workerType, q.workerType));
    if (q.status) conds.push(eq(workers.employmentStatus, q.status));
    if (q.branchId) conds.push(eq(workers.branchId, q.branchId));
    if (q.q) {
      const term = `%${escapeLike(q.q)}%`;
      conds.push(or(like(workers.fullName, term), like(workers.employeeCode, term), like(workers.phone, term))!);
    }
    const warnLimit = addDays(today, org.expiryWarningDays);
    if (q.licence === 'expired') conds.push(lt(driverLicences.validUntil, today));
    if (q.licence === 'expiring') conds.push(and(gte(driverLicences.validUntil, today), lte(driverLicences.validUntil, warnLimit))!);
    if (q.licence === 'ok') conds.push(sql`${driverLicences.validUntil} > ${warnLimit}`);
    if (q.licence === 'missing') conds.push(and(eq(workers.workerType, 'driver'), isNull(driverLicences.id))!);
    const where = and(...conds);

    const sortCols = {
      fullName: workers.fullName,
      employeeCode: workers.employeeCode,
      workerType: workers.workerType,
      licenceValidUntil: driverLicences.validUntil,
    } as const;
    const sort = parseSort<keyof typeof sortCols>(q.sort, 'fullName');

    const licJoin = and(eq(driverLicences.workerId, workers.id), eq(driverLicences.isCurrent, true));
    const [count] = await this.db.select({ n: sql<number>`COUNT(*)` }).from(workers).leftJoin(driverLicences, licJoin).where(where);
    const rows = await this.db
      .select({ w: workers, b: { id: branches.id, name: branches.name }, p: { id: compensationPolicies.id, name: compensationPolicies.name }, l: driverLicences })
      .from(workers)
      .leftJoin(driverLicences, licJoin)
      .leftJoin(branches, eq(branches.id, workers.branchId))
      .leftJoin(compensationPolicies, eq(compensationPolicies.id, workers.compensationPolicyId))
      .where(where)
      .orderBy(sort.desc ? desc(sortCols[sort.field]) : asc(sortCols[sort.field]), asc(workers.id))
      .limit(q.pageSize)
      .offset((q.page - 1) * q.pageSize);

    const dtos = await this.toDtos(ctx, rows, today, org.expiryWarningDays);
    return paginated(dtos, q.page, q.pageSize, Number(count?.n ?? 0));
  }

  async get(ctx: RequestContext, id: number): Promise<WorkerDto> {
    const org = await getOrgInfo(this.db, ctx.orgId);
    const rows = await this.db
      .select({ w: workers, b: { id: branches.id, name: branches.name }, p: { id: compensationPolicies.id, name: compensationPolicies.name }, l: driverLicences })
      .from(workers)
      .leftJoin(driverLicences, and(eq(driverLicences.workerId, workers.id), eq(driverLicences.isCurrent, true)))
      .leftJoin(branches, eq(branches.id, workers.branchId))
      .leftJoin(compensationPolicies, eq(compensationPolicies.id, workers.compensationPolicyId))
      .where(and(eq(workers.id, id), eq(workers.orgId, ctx.orgId)))
      .limit(1);
    if (!rows.length) throw AppError.notFound('Worker');
    return (await this.toDtos(ctx, rows, orgToday(org), org.expiryWarningDays))[0]!;
  }

  async create(ctx: RequestContext, input: WorkerCreateInput, req: Request): Promise<WorkerDto> {
    await this.assertRefs(ctx, input.branchId ?? null, input.compensationPolicyId ?? null);
    let id: number;
    try {
      const [row] = await this.db
        .insert(workers)
        .values({
          ...this.toColumns(input),
          orgId: ctx.orgId,
          employeeCode: input.employeeCode,
          workerType: input.workerType,
          fullName: input.fullName,
          phone: input.phone,
          employmentStatus: input.employmentStatus,
        })
        .$returningId();
      id = row!.id;
    } catch (err) {
      if (isDuplicateKeyError(err)) {
        throw AppError.conflict(`Employee code ${input.employeeCode} is already in use`, [{ path: 'employeeCode', message: 'Already in use' }]);
      }
      throw err;
    }
    await audit(this.db, req, { action: 'worker.created', entityType: 'worker', entityId: id, summary: `${input.fullName} (${input.workerType})`, after: redact(input) });
    return this.get(ctx, id);
  }

  async update(ctx: RequestContext, id: number, input: WorkerUpdateInput, req: Request): Promise<WorkerDto> {
    const existing = await this.row(ctx, id);
    const touchesSensitive = SENSITIVE_KEYS.some((k) => input[k] !== undefined);
    if (touchesSensitive && !ctx.permissions.has('workers:sensitive')) {
      throw AppError.forbidden('Changing personal or pay details requires HR access (workers:sensitive)');
    }
    if (input.branchId !== undefined || input.compensationPolicyId !== undefined) {
      await this.assertRefs(ctx, input.branchId ?? null, input.compensationPolicyId ?? null);
    }
    const patch = this.toColumns(input);
    const diff = changedFields(existing, patch);
    if (diff) {
      try {
        await this.db.update(workers).set(patch).where(and(eq(workers.id, id), eq(workers.orgId, ctx.orgId)));
      } catch (err) {
        if (isDuplicateKeyError(err)) throw AppError.conflict(`Employee code ${input.employeeCode} is already in use`);
        throw err;
      }
      await audit(this.db, req, {
        action: diff.after.employmentStatus ? 'worker.status_changed' : 'worker.updated',
        entityType: 'worker',
        entityId: id,
        summary: existing.fullName,
        before: redact(diff.before),
        after: redact(diff.after),
      });
    }
    return this.get(ctx, id);
  }

  // ------------------------------------------------------------------ licences

  async licences(ctx: RequestContext, workerId: number): Promise<LicenceDto[]> {
    await this.row(ctx, workerId);
    const rows = await this.db
      .select()
      .from(driverLicences)
      .where(and(eq(driverLicences.workerId, workerId), eq(driverLicences.orgId, ctx.orgId)))
      .orderBy(desc(driverLicences.isCurrent), desc(driverLicences.validUntil));
    const classes = await this.classesFor(rows.map((r) => r.id));
    return rows.map((r) => toLicenceDto(r, classes.get(r.id) ?? [], ctx.permissions.has('workers:sensitive')));
  }

  /** Records a new or renewed licence; it becomes the current one. Verification is reset. */
  async addLicence(ctx: RequestContext, workerId: number, input: LicenceInput, req: Request): Promise<LicenceDto> {
    const worker = await this.row(ctx, workerId);
    if (worker.workerType !== 'driver') throw AppError.businessRule('Only drivers hold driving licences in TransAxis');
    const id = await this.db.transaction(async (tx) => {
      await tx.update(driverLicences).set({ isCurrent: false }).where(and(eq(driverLicences.workerId, workerId), eq(driverLicences.isCurrent, true)));
      const [lic] = await tx
        .insert(driverLicences)
        .values({
          orgId: ctx.orgId,
          workerId,
          licenceNo: input.licenceNo,
          issuingState: input.issuingState ?? null,
          issuedOn: input.issuedOn ?? null,
          validUntil: input.validUntil,
          fileId: input.fileId ?? null,
          verification: 'unverified',
        })
        .$returningId();
      await tx.insert(driverLicenceClasses).values([...new Set(input.classes)].map((c) => ({ licenceId: lic!.id, licenceClass: c })));
      await audit(tx, req, {
        action: 'worker.licence_added',
        entityType: 'worker',
        entityId: workerId,
        summary: `${worker.fullName}: ${input.classes.join(', ')} valid until ${input.validUntil}`,
      });
      return lic!.id;
    });
    return (await this.licences(ctx, workerId)).find((l) => l.id === id)!;
  }

  async verifyLicence(ctx: RequestContext, workerId: number, licenceId: number, verification: 'verified' | 'rejected', req: Request): Promise<LicenceDto> {
    const worker = await this.row(ctx, workerId);
    const [lic] = await this.db
      .select()
      .from(driverLicences)
      .where(and(eq(driverLicences.id, licenceId), eq(driverLicences.workerId, workerId), eq(driverLicences.orgId, ctx.orgId)))
      .limit(1);
    if (!lic) throw AppError.notFound('Licence');
    const org = await getOrgInfo(this.db, ctx.orgId);
    await this.db
      .update(driverLicences)
      .set({ verification, verifiedOn: orgToday(org), verifiedBy: ctx.userId })
      .where(eq(driverLicences.id, licenceId));
    await audit(this.db, req, { action: `worker.licence_${verification}`, entityType: 'worker', entityId: workerId, summary: worker.fullName });
    return (await this.licences(ctx, workerId)).find((l) => l.id === licenceId)!;
  }

  // ------------------------------------------------------------------ documents and trainings

  async documents(ctx: RequestContext, workerId: number): Promise<WorkerDocumentDto[]> {
    await this.row(ctx, workerId);
    const rows = await this.db
      .select()
      .from(workerDocuments)
      .where(and(eq(workerDocuments.workerId, workerId), eq(workerDocuments.orgId, ctx.orgId)))
      .orderBy(asc(workerDocuments.docType));
    return rows.map((r) => ({ id: r.id, docType: r.docType, documentNo: r.documentNo, expiresOn: r.expiresOn, fileId: r.fileId, notes: r.notes, createdAt: r.createdAt.toISOString() }));
  }

  async addDocument(ctx: RequestContext, workerId: number, input: z.infer<typeof workerDocumentInputSchema>, req: Request): Promise<void> {
    const worker = await this.row(ctx, workerId);
    await this.db.insert(workerDocuments).values({
      orgId: ctx.orgId,
      workerId,
      docType: input.docType,
      documentNo: input.documentNo ?? null,
      expiresOn: input.expiresOn ?? null,
      fileId: input.fileId ?? null,
      notes: input.notes ?? null,
    });
    await audit(this.db, req, { action: 'worker.document_added', entityType: 'worker', entityId: workerId, summary: `${worker.fullName}: ${input.docType}` });
  }

  async deleteDocument(ctx: RequestContext, workerId: number, docId: number, req: Request): Promise<void> {
    await this.row(ctx, workerId);
    const [doc] = await this.db
      .select()
      .from(workerDocuments)
      .where(and(eq(workerDocuments.id, docId), eq(workerDocuments.workerId, workerId), eq(workerDocuments.orgId, ctx.orgId)));
    if (!doc) throw AppError.notFound('Document');
    await this.db.delete(workerDocuments).where(eq(workerDocuments.id, docId));
    await audit(this.db, req, { action: 'worker.document_deleted', entityType: 'worker', entityId: workerId, before: { docType: doc.docType, documentNo: doc.documentNo } });
  }

  async trainings(ctx: RequestContext, workerId: number): Promise<TrainingDto[]> {
    await this.row(ctx, workerId);
    const rows = await this.db
      .select()
      .from(workerTrainings)
      .where(and(eq(workerTrainings.workerId, workerId), eq(workerTrainings.orgId, ctx.orgId)))
      .orderBy(desc(workerTrainings.completedOn));
    return rows.map((r) => ({ id: r.id, trainingType: r.trainingType, completedOn: r.completedOn, validUntil: r.validUntil, provider: r.provider, notes: r.notes }));
  }

  async addTraining(ctx: RequestContext, workerId: number, input: z.infer<typeof trainingInputSchema>, req: Request): Promise<void> {
    const worker = await this.row(ctx, workerId);
    await this.db.insert(workerTrainings).values({
      orgId: ctx.orgId,
      workerId,
      trainingType: input.trainingType,
      completedOn: input.completedOn,
      validUntil: input.validUntil ?? null,
      provider: input.provider ?? null,
      notes: input.notes ?? null,
    });
    await audit(this.db, req, { action: 'worker.training_added', entityType: 'worker', entityId: workerId, summary: `${worker.fullName}: ${input.trainingType}` });
  }

  // ------------------------------------------------------------------ leave

  async listLeave(ctx: RequestContext, q: z.infer<typeof leaveListQuerySchema>): Promise<LeaveDto[]> {
    const conds: SQL[] = [eq(leaveRequests.orgId, ctx.orgId)];
    if (q.status) conds.push(eq(leaveRequests.status, q.status));
    if (q.workerId) conds.push(eq(leaveRequests.workerId, q.workerId));
    if (q.from) conds.push(gte(leaveRequests.toDate, q.from));
    if (q.to) conds.push(lte(leaveRequests.fromDate, q.to));
    const rows = await this.db
      .select({ l: leaveRequests, w: { id: workers.id, fullName: workers.fullName, employeeCode: workers.employeeCode, workerType: workers.workerType }, by: users.fullName })
      .from(leaveRequests)
      .innerJoin(workers, eq(workers.id, leaveRequests.workerId))
      .leftJoin(users, eq(users.id, leaveRequests.decidedBy))
      .where(and(...conds))
      .orderBy(desc(leaveRequests.fromDate))
      .limit(200);
    return rows.map(({ l, w, by }) => ({
      id: l.id,
      worker: w,
      leaveType: l.leaveType,
      fromDate: l.fromDate,
      toDate: l.toDate,
      reason: l.reason,
      status: l.status,
      decidedBy: by,
      decidedAt: l.decidedAt?.toISOString() ?? null,
      decisionNote: l.decisionNote,
      createdAt: l.createdAt.toISOString(),
    }));
  }

  async requestLeave(ctx: RequestContext, input: z.infer<typeof leaveRequestSchema>, req: Request): Promise<void> {
    const worker = await this.row(ctx, input.workerId);
    const [overlap] = await this.db
      .select({ id: leaveRequests.id })
      .from(leaveRequests)
      .where(
        and(
          eq(leaveRequests.workerId, input.workerId),
          inArray(leaveRequests.status, ['pending', 'approved']),
          lte(leaveRequests.fromDate, input.toDate),
          gte(leaveRequests.toDate, input.fromDate),
        ),
      )
      .limit(1);
    if (overlap) throw AppError.conflict(`${worker.fullName} already has leave requested or approved in that period`);
    await this.db.insert(leaveRequests).values({
      orgId: ctx.orgId,
      workerId: input.workerId,
      leaveType: input.leaveType,
      fromDate: input.fromDate,
      toDate: input.toDate,
      reason: input.reason ?? null,
    });
    await audit(this.db, req, { action: 'leave.requested', entityType: 'worker', entityId: input.workerId, summary: `${input.fromDate} to ${input.toDate}` });
  }

  /**
   * Approve, reject or cancel. Approving leave that clashes with a trip the worker is already assigned
   * to is refused: the dispatcher must reassign the trip first.
   */
  async decideLeave(ctx: RequestContext, id: number, input: z.infer<typeof leaveDecisionSchema>, req: Request): Promise<void> {
    const [leave] = await this.db
      .select()
      .from(leaveRequests)
      .where(and(eq(leaveRequests.id, id), eq(leaveRequests.orgId, ctx.orgId)))
      .limit(1);
    if (!leave) throw AppError.notFound('Leave request');
    const allowed = input.decision === 'cancelled' ? ['pending', 'approved'] : ['pending'];
    if (!allowed.includes(leave.status)) throw AppError.businessRule(`This request is already ${leave.status}`);

    if (input.decision === 'approved') {
      const org = await getOrgInfo(this.db, ctx.orgId);
      const clash = await this.db
        .select({ tripNo: trips.tripNo, start: trips.plannedStart, end: trips.plannedEnd })
        .from(trips)
        .where(and(eq(trips.orgId, ctx.orgId), eq(trips.driverId, leave.workerId), inArray(trips.status, [...ACTIVE_TRIP_STATUSES])));
      const hit = clash.find((t) => {
        const s = orgToday(org, t.start);
        const e = orgToday(org, t.end);
        return s <= leave.toDate && e >= leave.fromDate;
      });
      if (hit) throw AppError.businessRule(`Leave overlaps trip ${hit.tripNo}. Reassign that trip before approving.`);
    }
    await this.db
      .update(leaveRequests)
      .set({ status: input.decision, decidedBy: ctx.userId, decidedAt: new Date(), decisionNote: input.note ?? null })
      .where(eq(leaveRequests.id, id));
    await audit(this.db, req, { action: `leave.${input.decision}`, entityType: 'worker', entityId: leave.workerId, summary: `${leave.fromDate} to ${leave.toDate}` });
  }

  // ------------------------------------------------------------------ attendance

  async attendanceFor(ctx: RequestContext, workDate: string): Promise<AttendanceRowDto[]> {
    const rows = await this.db
      .select({ w: { id: workers.id, fullName: workers.fullName, employeeCode: workers.employeeCode, workerType: workers.workerType }, a: attendance })
      .from(workers)
      .leftJoin(attendance, and(eq(attendance.workerId, workers.id), eq(attendance.workDate, workDate)))
      .where(and(eq(workers.orgId, ctx.orgId), eq(workers.employmentStatus, 'active')))
      .orderBy(asc(workers.workerType), asc(workers.fullName));
    return rows.map(({ w, a }) => ({ worker: w, status: a?.status ?? null, notes: a?.notes ?? null, source: a?.source ?? null }));
  }

  async upsertAttendance(ctx: RequestContext, input: z.infer<typeof attendanceUpsertSchema>, req: Request): Promise<void> {
    const ids = [...new Set(input.entries.map((e) => e.workerId))];
    const owned = await this.db.select({ id: workers.id }).from(workers).where(and(eq(workers.orgId, ctx.orgId), inArray(workers.id, ids)));
    if (owned.length !== ids.length) throw AppError.validation('One or more workers were not found');
    await this.db.transaction(async (tx) => {
      for (const e of input.entries) {
        await tx
          .insert(attendance)
          .values({ orgId: ctx.orgId, workerId: e.workerId, workDate: input.workDate, status: e.status, notes: e.notes ?? null, source: 'manual', recordedBy: ctx.userId })
          .onDuplicateKeyUpdate({ set: { status: e.status, notes: e.notes ?? null, source: 'manual', recordedBy: ctx.userId } });
      }
      await audit(tx, req, { action: 'attendance.recorded', summary: `${input.entries.length} entries for ${input.workDate}` });
    });
  }

  // ------------------------------------------------------------------ compensation policies

  async policies(ctx: RequestContext): Promise<CompensationPolicyDto[]> {
    const rows = await this.db
      .select()
      .from(compensationPolicies)
      .where(eq(compensationPolicies.orgId, ctx.orgId))
      .orderBy(desc(compensationPolicies.isActive), asc(compensationPolicies.name));
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      appliesTo: r.appliesTo,
      basis: r.basis,
      rate: r.rate,
      dailyAllowance: r.dailyAllowance,
      onTimeBonus: r.onTimeBonus,
      minPerTrip: r.minPerTrip,
      effectiveFrom: r.effectiveFrom,
      isActive: r.isActive,
      notes: r.notes,
    }));
  }

  async createPolicy(ctx: RequestContext, input: z.infer<typeof compensationPolicyInputSchema>, req: Request): Promise<void> {
    try {
      const [row] = await this.db
        .insert(compensationPolicies)
        .values({
          orgId: ctx.orgId,
          name: input.name,
          appliesTo: input.appliesTo,
          basis: input.basis,
          rate: input.rate.toFixed(4),
          dailyAllowance: input.dailyAllowance.toFixed(2),
          onTimeBonus: input.onTimeBonus.toFixed(2),
          minPerTrip: dec(input.minPerTrip, 2) ?? null,
          effectiveFrom: input.effectiveFrom,
          isActive: input.isActive,
          notes: input.notes ?? null,
        })
        .$returningId();
      await audit(this.db, req, { action: 'compensation_policy.created', entityType: 'compensation_policy', entityId: row!.id, after: input });
    } catch (err) {
      if (isDuplicateKeyError(err)) throw AppError.conflict(`A policy named "${input.name}" already exists`);
      throw err;
    }
  }

  // ------------------------------------------------------------------ helpers

  private async row(ctx: RequestContext, id: number): Promise<WorkerRow> {
    const [w] = await this.db.select().from(workers).where(and(eq(workers.id, id), eq(workers.orgId, ctx.orgId))).limit(1);
    if (!w) throw AppError.notFound('Worker');
    return w;
  }

  private async assertRefs(ctx: RequestContext, branchId: number | null, policyId: number | null) {
    if (branchId) {
      const [b] = await this.db.select({ id: branches.id }).from(branches).where(and(eq(branches.id, branchId), eq(branches.orgId, ctx.orgId)));
      if (!b) throw AppError.validation('Unknown branch', [{ path: 'branchId', message: 'Branch not found' }]);
    }
    if (policyId) {
      const [p] = await this.db
        .select({ id: compensationPolicies.id })
        .from(compensationPolicies)
        .where(and(eq(compensationPolicies.id, policyId), eq(compensationPolicies.orgId, ctx.orgId)));
      if (!p) throw AppError.validation('Unknown compensation policy', [{ path: 'compensationPolicyId', message: 'Policy not found' }]);
    }
  }

  private toColumns(input: Partial<WorkerCreateInput>) {
    return {
      employeeCode: input.employeeCode,
      workerType: input.workerType,
      fullName: input.fullName,
      phone: input.phone,
      altPhone: input.altPhone,
      branchId: input.branchId,
      dateOfBirth: input.dateOfBirth,
      address: input.address,
      bloodGroup: input.bloodGroup,
      emergencyContactName: input.emergencyContactName,
      emergencyContactPhone: input.emergencyContactPhone,
      emergencyContactRelation: input.emergencyContactRelation,
      baseMonthlySalary: input.baseMonthlySalary === undefined ? undefined : (dec(input.baseMonthlySalary, 2) ?? null),
      employmentStatus: input.employmentStatus,
      joinedOn: input.joinedOn,
      leftOn: input.leftOn,
      compensationPolicyId: input.compensationPolicyId,
      medicalValidUntil: input.medicalValidUntil,
      notes: input.notes,
    };
  }

  private async classesFor(licenceIds: number[]) {
    const map = new Map<number, LicenceClass[]>();
    if (!licenceIds.length) return map;
    const rows = await this.db.select().from(driverLicenceClasses).where(inArray(driverLicenceClasses.licenceId, licenceIds));
    for (const r of rows) map.set(r.licenceId, [...(map.get(r.licenceId) ?? []), r.licenceClass as LicenceClass]);
    return map;
  }

  /** Builds DTOs for a page of workers with a fixed number of extra queries (no N+1). */
  private async toDtos(
    ctx: RequestContext,
    rows: { w: WorkerRow; b: { id: number; name: string } | null; p: { id: number; name: string } | null; l: typeof driverLicences.$inferSelect | null }[],
    today: string,
    warnDays: number,
  ): Promise<WorkerDto[]> {
    const ids = rows.map((r) => r.w.id);
    if (!ids.length) return [];
    const sensitive = ctx.permissions.has('workers:sensitive');
    const classes = await this.classesFor(rows.map((r) => r.l?.id).filter((x): x is number => !!x));
    const leaveRows = await this.db
      .select({ workerId: leaveRequests.workerId })
      .from(leaveRequests)
      .where(and(inArray(leaveRequests.workerId, ids), eq(leaveRequests.status, 'approved'), lte(leaveRequests.fromDate, today), gte(leaveRequests.toDate, today)));
    const onLeave = new Set(leaveRows.map((r) => r.workerId));
    const hazmatRows = await this.db
      .select({ workerId: workerTrainings.workerId })
      .from(workerTrainings)
      .where(
        and(
          inArray(workerTrainings.workerId, ids),
          eq(workerTrainings.trainingType, 'hazmat'),
          or(isNull(workerTrainings.validUntil), gte(workerTrainings.validUntil, today)),
        ),
      );
    const hazmat = new Set(hazmatRows.map((r) => r.workerId));
    const tripRows = await this.db
      .select({ id: trips.id, tripNo: trips.tripNo, status: trips.status, driverId: trips.driverId, start: trips.plannedStart })
      .from(trips)
      .where(and(inArray(trips.driverId, ids), inArray(trips.status, ['ready', 'in_transit', 'delivered', 'planned', 'on_hold'])))
      .orderBy(asc(trips.plannedStart));
    const current = new Map<number, { id: number; tripNo: string; status: (typeof tripRows)[number]['status'] }>();
    for (const t of tripRows) {
      // Prefer a trip that is actually running over a future planned one.
      const prev = current.get(t.driverId);
      if (!prev || (prev.status === 'planned' && t.status !== 'planned')) current.set(t.driverId, { id: t.id, tripNo: t.tripNo, status: t.status });
    }
    const logins = await this.db.select({ workerId: users.workerId }).from(users).where(inArray(users.workerId, ids));
    const hasLogin = new Set(logins.map((l) => l.workerId));

    const warnLimit = addDays(today, warnDays);
    return rows.map(({ w, b, p, l }) => {
      let licenceState: LicenceState = 'not_required';
      if (w.workerType === 'driver') {
        if (!l) licenceState = 'missing';
        else if (l.validUntil < today) licenceState = 'expired';
        else if (l.validUntil <= warnLimit) licenceState = 'expiring';
        else licenceState = 'ok';
      }
      const dto: WorkerDto = {
        id: w.id,
        employeeCode: w.employeeCode,
        workerType: w.workerType,
        fullName: w.fullName,
        phone: w.phone,
        altPhone: w.altPhone,
        branch: b?.id ? b : null,
        employmentStatus: w.employmentStatus,
        joinedOn: w.joinedOn,
        leftOn: w.leftOn,
        medicalValidUntil: w.medicalValidUntil,
        compensationPolicy: p?.id ? p : null,
        licence: l ? toLicenceDto(l, classes.get(l.id) ?? [], sensitive) : null,
        licenceState,
        hazmatCertified: hazmat.has(w.id),
        onLeaveToday: onLeave.has(w.id),
        currentTrip: current.get(w.id) ?? null,
        hasLogin: hasLogin.has(w.id),
        notes: w.notes,
      };
      if (sensitive) {
        dto.sensitive = {
          dateOfBirth: w.dateOfBirth,
          address: w.address,
          bloodGroup: w.bloodGroup,
          emergencyContactName: w.emergencyContactName,
          emergencyContactPhone: w.emergencyContactPhone,
          emergencyContactRelation: w.emergencyContactRelation,
          baseMonthlySalary: toNumber(w.baseMonthlySalary),
        };
      }
      return dto;
    });
  }
}

function toLicenceDto(r: typeof driverLicences.$inferSelect, classes: LicenceClass[], sensitive: boolean): LicenceDto {
  return {
    id: r.id,
    licenceNo: sensitive ? r.licenceNo : maskLicence(r.licenceNo),
    issuingState: r.issuingState,
    issuedOn: r.issuedOn,
    validUntil: r.validUntil,
    classes: [...classes].sort(),
    verification: r.verification,
    verifiedOn: r.verifiedOn,
    fileId: r.fileId,
  };
}

/** Keeps salary and personal data out of audit rows. */
function redact<T extends object>(obj: T): T {
  const out = { ...obj } as Record<string, unknown>;
  for (const k of SENSITIVE_KEYS) if (k in out) out[k] = '[redacted]';
  return out as T;
}
