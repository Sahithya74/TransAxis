import type { Request } from 'express';
import { aliasedTable, and, asc, count, desc, eq, inArray, sql, type SQL } from 'drizzle-orm';
import type { z } from 'zod';
import { incidents, incidentUpdates, safetyAlerts, trips, users, vehicles, workers, type Db } from '@transaxis/database';
import {
  INCIDENT_TRANSITIONS,
  type IncidentDto,
  type IncidentSeverity,
  type IncidentStatus,
  type NotificationPriority,
  type Paginated,
} from '@transaxis/shared';
import type { incidentChangeSchema, incidentCreateSchema, incidentListQuerySchema, sosSchema } from '@transaxis/shared';
import { audit } from '../../lib/audit.js';
import type { RequestContext } from '../../lib/context.js';
import { AppError } from '../../lib/errors.js';
import { paginated, parseSort, toNumber } from '../../lib/http.js';
import { getOrgInfo, orgYear } from '../../lib/org.js';
import { nextNumber } from '../../lib/sequences.js';
import { assertTripAccess, isOwnTrip } from '../../lib/trip-access.js';
import type { Realtime } from '../../realtime/socket.js';
import type { NotificationService } from '../notifications/service.js';
import type { AlertService } from './alerts.js';

const PRIORITY: Record<IncidentSeverity, NotificationPriority> = { critical: 'critical', high: 'high', medium: 'normal', low: 'low' };
const SEVERITY_ORDER = sql`FIELD(${incidents.severity}, 'critical', 'high', 'medium', 'low')`;

export class IncidentService {
  constructor(
    private readonly db: Db,
    private readonly alerts: AlertService,
    private readonly notifier: NotificationService,
    private readonly realtime: Realtime,
  ) {}

  async list(ctx: RequestContext, q: z.infer<typeof incidentListQuerySchema>): Promise<Paginated<IncidentDto>> {
    const conds: SQL[] = [eq(incidents.orgId, ctx.orgId)];
    if (q.status === 'active') conds.push(inArray(incidents.status, ['open', 'investigating', 'escalated']));
    else if (q.status) conds.push(eq(incidents.status, q.status as IncidentStatus));
    if (q.severity) conds.push(eq(incidents.severity, q.severity));
    if (q.incidentType) conds.push(eq(incidents.incidentType, q.incidentType));
    if (q.tripId) conds.push(eq(incidents.tripId, q.tripId));
    const where = and(...conds);
    const sort = parseSort<'reportedAt' | 'severity' | 'incidentNo'>(q.sort, 'reportedAt');
    const col = sort.field === 'severity' ? SEVERITY_ORDER : sort.field === 'incidentNo' ? incidents.incidentNo : incidents.reportedAt;
    const descending = q.sort ? sort.desc : true;
    const [[total], rows] = await Promise.all([
      this.db.select({ n: count() }).from(incidents).where(where),
      this.select().where(where).orderBy(descending ? desc(col) : asc(col), desc(incidents.id)).limit(q.pageSize).offset((q.page - 1) * q.pageSize),
    ]);
    return paginated(rows.map((r) => toDto(r, [], ctx)), q.page, q.pageSize, Number(total?.n ?? 0));
  }

  async get(ctx: RequestContext, id: number): Promise<IncidentDto> {
    const [row] = await this.select().where(and(eq(incidents.id, id), eq(incidents.orgId, ctx.orgId)));
    if (!row) throw AppError.notFound('Incident');
    const updates = await this.db
      .select({ u: incidentUpdates, by: users.fullName })
      .from(incidentUpdates)
      .leftJoin(users, eq(users.id, incidentUpdates.createdBy))
      .where(eq(incidentUpdates.incidentId, id))
      .orderBy(desc(incidentUpdates.createdAt), desc(incidentUpdates.id));
    return toDto(row, updates, ctx);
  }

  async create(ctx: RequestContext, input: z.infer<typeof incidentCreateSchema>, req: Request, opts: { sos?: boolean } = {}): Promise<IncidentDto> {
    // Crew can report incidents on their own trips; managers on anything in the organisation.
    if (!ctx.permissions.has('incidents:manage')) {
      if (!ctx.permissions.has('incidents:report')) throw AppError.forbidden();
      const t = input.tripId ? await assertTripAccess(this.db, ctx, input.tripId) : null;
      if (!t || !(await isOwnTrip(this.db, ctx, t.id, t.driverId))) throw AppError.forbidden('You can only report incidents on your own trips');
    }
    const refs = await this.resolveRefs(ctx, input);
    const org = await getOrgInfo(this.db, ctx.orgId);
    const id = await this.db.transaction(async (tx) => {
      const incidentNo = await nextNumber(tx, ctx.orgId, 'INC', orgYear(org));
      const [row] = await tx
        .insert(incidents)
        .values({
          orgId: ctx.orgId,
          incidentNo,
          incidentType: input.incidentType,
          severity: input.severity,
          title: input.title,
          description: input.description ?? null,
          tripId: refs.tripId,
          vehicleId: refs.vehicleId,
          driverId: refs.driverId,
          lat: input.lat != null ? input.lat.toFixed(6) : null,
          lng: input.lng != null ? input.lng.toFixed(6) : null,
          locationText: input.locationText ?? null,
          reportedBy: ctx.userId,
          reportedAt: new Date(),
        })
        .$returningId();
      const incidentId = row!.id;
      await tx.insert(incidentUpdates).values({ orgId: ctx.orgId, incidentId, kind: 'created', body: input.description ?? null, toStatus: 'open', createdBy: ctx.userId });
      if (input.alertId) {
        const [a] = await tx.select().from(safetyAlerts).where(and(eq(safetyAlerts.id, input.alertId), eq(safetyAlerts.orgId, ctx.orgId)));
        if (!a) throw AppError.validation('Unknown alert', [{ path: 'alertId', message: 'Alert not found' }]);
        await tx
          .update(safetyAlerts)
          .set({ incidentId, ...(a.status === 'open' ? { status: 'acknowledged' as const, acknowledgedAt: new Date(), acknowledgedBy: ctx.userId } : {}) })
          .where(eq(safetyAlerts.id, a.id));
      }
      if (opts.sos && refs.tripId) {
        await this.alerts.raise(tx, {
          orgId: ctx.orgId,
          type: 'sos',
          severity: 'critical',
          title: input.title,
          detail: input.description ?? 'SOS raised from the driver app',
          tripId: refs.tripId,
          vehicleId: refs.vehicleId,
          driverId: refs.driverId,
          lat: input.lat ?? null,
          lng: input.lng ?? null,
          dedupeKey: `trip:${refs.tripId}:sos:${incidentId}`,
        });
        await tx.update(safetyAlerts).set({ incidentId }).where(and(eq(safetyAlerts.orgId, ctx.orgId), eq(safetyAlerts.dedupeKey, `trip:${refs.tripId}:sos:${incidentId}`)));
      }
      await this.notifier.notify(tx, {
        orgId: ctx.orgId,
        permission: 'incidents:read',
        category: 'incident',
        priority: PRIORITY[input.severity],
        title: `${incidentNo}: ${input.title}`,
        body: input.description ?? null,
        link: `/incidents/${incidentId}`,
        entityType: 'incident',
        entityId: incidentId,
        dedupeKey: `incident:${incidentId}:created`,
      });
      await audit(tx, req, { action: opts.sos ? 'incident.sos' : 'incident.created', entityType: 'incident', entityId: incidentId, summary: `${incidentNo}: ${input.title}` });
      return incidentId;
    });
    this.realtime.toPermission(ctx.orgId, 'incidents:read', 'incident', { id, severity: input.severity });
    return this.get(ctx, id);
  }

  /** SOS from a trip: a critical incident plus a critical alert. No emergency services are contacted. */
  async sos(ctx: RequestContext, tripId: number, input: z.infer<typeof sosSchema>, req: Request): Promise<IncidentDto> {
    await assertTripAccess(this.db, ctx, tripId);
    const [t] = await this.db
      .select({ tripNo: trips.tripNo, status: trips.status, driver: workers.fullName })
      .from(trips)
      .innerJoin(workers, eq(workers.id, trips.driverId))
      .where(eq(trips.id, tripId));
    const [who] = await this.db.select({ name: users.fullName }).from(users).where(eq(users.id, ctx.userId));
    return this.create(
      ctx,
      {
        incidentType: 'sos',
        severity: 'critical',
        title: `SOS on ${t!.tripNo} from ${who?.name ?? t!.driver}`,
        description: input.note ?? 'SOS button pressed.',
        tripId,
        lat: input.lat ?? null,
        lng: input.lng ?? null,
      },
      req,
      { sos: true },
    );
  }

  async change(ctx: RequestContext, id: number, input: z.infer<typeof incidentChangeSchema>, req: Request): Promise<IncidentDto> {
    await this.db.transaction(async (tx) => {
      const [inc] = await tx.select().from(incidents).where(and(eq(incidents.id, id), eq(incidents.orgId, ctx.orgId))).for('update');
      if (!inc) throw AppError.notFound('Incident');
      if (input.version && input.version !== inc.version) throw AppError.conflict('This incident was changed by someone else. Reload and try again.');
      const set: Partial<typeof incidents.$inferInsert> = {};
      const log: (typeof incidentUpdates.$inferInsert)[] = [];
      const base = { orgId: ctx.orgId, incidentId: id, createdBy: ctx.userId };

      if (input.status && input.status !== inc.status) {
        if (!INCIDENT_TRANSITIONS[inc.status].includes(input.status)) {
          throw AppError.businessRule(`An incident that is ${inc.status} cannot move to ${input.status}`);
        }
        set.status = input.status;
        if (input.status === 'resolved') Object.assign(set, { resolvedAt: new Date(), resolution: input.resolution });
        if (input.status === 'investigating' && inc.status === 'resolved') Object.assign(set, { resolvedAt: null });
        log.push({ ...base, kind: input.status === 'escalated' ? 'escalation' : 'status_change', fromStatus: inc.status, toStatus: input.status, body: input.status === 'resolved' ? input.resolution : (input.note ?? null) });
      }
      if (input.severity && input.severity !== inc.severity) {
        set.severity = input.severity;
        log.push({ ...base, kind: 'note', body: `Severity changed from ${inc.severity} to ${input.severity}` });
      }
      if (input.assignedToUserId !== undefined && input.assignedToUserId !== inc.assignedTo) {
        let name = 'nobody';
        if (input.assignedToUserId) {
          const [u] = await tx.select({ name: users.fullName }).from(users).where(and(eq(users.id, input.assignedToUserId), eq(users.orgId, ctx.orgId), eq(users.status, 'active')));
          if (!u) throw AppError.validation('Unknown user', [{ path: 'assignedToUserId', message: 'Choose an active user' }]);
          name = u.name;
        }
        set.assignedTo = input.assignedToUserId;
        log.push({ ...base, kind: 'assignment', body: `Assigned to ${name}` });
      }
      if (input.note && !log.some((l) => l.body === input.note)) log.push({ ...base, kind: 'note', body: input.note });
      if (!log.length) throw AppError.businessRule('Nothing changed');

      await tx.update(incidents).set({ ...set, version: sql`${incidents.version} + 1` }).where(eq(incidents.id, id));
      await tx.insert(incidentUpdates).values(log);
      if (set.status === 'escalated') {
        await this.notifier.notify(tx, {
          orgId: ctx.orgId,
          permission: 'settings:read',
          category: 'incident',
          priority: 'critical',
          title: `Escalated: ${inc.incidentNo} ${inc.title}`,
          body: input.note ?? null,
          link: `/incidents/${id}`,
          entityType: 'incident',
          entityId: id,
          dedupeKey: `incident:${id}:escalated:${inc.version}`,
        });
      }
      if (set.assignedTo) {
        await this.notifier.notify(tx, {
          orgId: ctx.orgId,
          userIds: [set.assignedTo],
          category: 'incident',
          priority: PRIORITY[set.severity ?? inc.severity],
          title: `Assigned to you: ${inc.incidentNo} ${inc.title}`,
          link: `/incidents/${id}`,
          entityType: 'incident',
          entityId: id,
          dedupeKey: `incident:${id}:assigned:${set.assignedTo}:${inc.version}`,
        });
      }
      await audit(tx, req, { action: 'incident.updated', entityType: 'incident', entityId: id, summary: `${inc.incidentNo}: ${log.map((l) => l.kind).join(', ')}`, after: set });
    });
    this.realtime.toPermission(ctx.orgId, 'incidents:read', 'incident', { id });
    return this.get(ctx, id);
  }

  async activeCount(orgId: number): Promise<number> {
    const [r] = await this.db.select({ n: count() }).from(incidents).where(and(eq(incidents.orgId, orgId), inArray(incidents.status, ['open', 'investigating', 'escalated'])));
    return Number(r?.n ?? 0);
  }

  /** Fills vehicle and driver from the trip, and checks every reference belongs to the organisation. */
  private async resolveRefs(ctx: RequestContext, input: { tripId?: number | null; vehicleId?: number | null; driverId?: number | null }) {
    const tripId = input.tripId ?? null;
    let vehicleId = input.vehicleId ?? null;
    let driverId = input.driverId ?? null;
    if (tripId) {
      const [t] = await this.db.select({ vehicleId: trips.vehicleId, driverId: trips.driverId }).from(trips).where(and(eq(trips.id, tripId), eq(trips.orgId, ctx.orgId)));
      if (!t) throw AppError.validation('Unknown trip', [{ path: 'tripId', message: 'Trip not found' }]);
      vehicleId ??= t.vehicleId;
      driverId ??= t.driverId;
    }
    if (vehicleId && !(await this.db.select({ id: vehicles.id }).from(vehicles).where(and(eq(vehicles.id, vehicleId), eq(vehicles.orgId, ctx.orgId))))[0]) {
      throw AppError.validation('Unknown vehicle', [{ path: 'vehicleId', message: 'Vehicle not found' }]);
    }
    if (driverId && !(await this.db.select({ id: workers.id }).from(workers).where(and(eq(workers.id, driverId), eq(workers.orgId, ctx.orgId))))[0]) {
      throw AppError.validation('Unknown driver', [{ path: 'driverId', message: 'Driver not found' }]);
    }
    return { tripId, vehicleId, driverId };
  }

  private select() {
    const reporter = aliasedTable(users, 'reporter');
    const assignee = aliasedTable(users, 'assignee');
    return this.db
      .select({
        i: incidents,
        t: { id: trips.id, tripNo: trips.tripNo },
        v: { id: vehicles.id, registrationNo: vehicles.registrationNo },
        d: { id: workers.id, fullName: workers.fullName, phone: workers.phone },
        reporter: reporter.fullName,
        assignee: { id: assignee.id, fullName: assignee.fullName },
      })
      .from(incidents)
      .leftJoin(trips, eq(trips.id, incidents.tripId))
      .leftJoin(vehicles, eq(vehicles.id, incidents.vehicleId))
      .leftJoin(workers, eq(workers.id, incidents.driverId))
      .leftJoin(reporter, eq(reporter.id, incidents.reportedBy))
      .leftJoin(assignee, eq(assignee.id, incidents.assignedTo))
      .$dynamic();
  }
}

type Row = {
  i: typeof incidents.$inferSelect;
  t: { id: number; tripNo: string } | null;
  v: { id: number; registrationNo: string } | null;
  d: { id: number; fullName: string; phone: string } | null;
  reporter: string | null;
  assignee: { id: number; fullName: string } | null;
};

function toDto({ i, t, v, d, reporter, assignee }: Row, updates: { u: typeof incidentUpdates.$inferSelect; by: string | null }[], ctx: RequestContext): IncidentDto {
  return {
    id: i.id,
    incidentNo: i.incidentNo,
    incidentType: i.incidentType,
    severity: i.severity,
    status: i.status,
    title: i.title,
    description: i.description,
    trip: t?.id ? t : null,
    vehicle: v?.id ? v : null,
    driver: d?.id ? d : null,
    lat: toNumber(i.lat),
    lng: toNumber(i.lng),
    locationText: i.locationText,
    reportedBy: reporter,
    reportedAt: i.reportedAt.toISOString(),
    assignedTo: assignee?.id ? assignee : null,
    resolvedAt: i.resolvedAt?.toISOString() ?? null,
    resolution: i.resolution,
    isSimulated: i.isSimulated,
    updates: updates.map(({ u, by }) => ({ id: u.id, kind: u.kind, body: u.body, fromStatus: u.fromStatus, toStatus: u.toStatus, by, at: u.createdAt.toISOString() })),
    allowedStatuses: ctx.permissions.has('incidents:manage') ? [...INCIDENT_TRANSITIONS[i.status]] : [],
    version: i.version,
  };
}

