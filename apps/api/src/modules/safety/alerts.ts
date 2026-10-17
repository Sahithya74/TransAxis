import type { Request } from 'express';
import { aliasedTable, and, asc, count, desc, eq, inArray, isNotNull, sql, type SQL } from 'drizzle-orm';
import { safetyAlerts, trips, users, vehicles, workers, isDuplicateKeyError, type Db, type DbOrTx } from '@transaxis/database';
import type { AlertSeverity, AlertType, NotificationPriority, Paginated, SafetyAlertDto } from '@transaxis/shared';
import type { alertListQuerySchema } from '@transaxis/shared';
import type { z } from 'zod';
import { audit } from '../../lib/audit.js';
import type { RequestContext } from '../../lib/context.js';
import { AppError } from '../../lib/errors.js';
import { paginated, parseSort, toNumber } from '../../lib/http.js';
import type { Realtime } from '../../realtime/socket.js';
import type { NotificationService } from '../notifications/service.js';

export interface RaiseAlert {
  orgId: number;
  type: AlertType;
  severity: AlertSeverity;
  title: string;
  detail?: string | null;
  tripId?: number | null;
  vehicleId?: number | null;
  driverId?: number | null;
  lat?: number | null;
  lng?: number | null;
  isSimulated?: boolean;
  /** One unresolved alert per key, e.g. `trip:12:route_deviation`. */
  dedupeKey: string;
  now?: Date;
}

/** Warnings clear themselves when the condition stops; critical alerts always wait for a person. */
export const AUTO_RESOLVABLE: ReadonlySet<AlertType> = new Set(['gps_stale', 'unexpected_stop', 'overspeed', 'late_arrival']);

const PRIORITY: Record<AlertSeverity, NotificationPriority> = { critical: 'critical', warning: 'high', info: 'normal' };
const SEVERITY_ORDER = sql`FIELD(${safetyAlerts.severity}, 'critical', 'warning', 'info')`;

export class AlertService {
  constructor(
    private readonly db: Db,
    private readonly notifier: NotificationService,
    private readonly realtime: Realtime,
  ) {}

  /** Creates an alert, or refreshes the open one with the same key. Notifies only on creation. */
  async raise(db: DbOrTx, a: RaiseAlert): Promise<{ id: number; created: boolean }> {
    const now = a.now ?? new Date();
    const values = {
      orgId: a.orgId,
      alertType: a.type,
      severity: a.severity,
      title: a.title.slice(0, 160),
      detail: a.detail?.slice(0, 500) ?? null,
      tripId: a.tripId ?? null,
      vehicleId: a.vehicleId ?? null,
      driverId: a.driverId ?? null,
      lat: a.lat != null ? a.lat.toFixed(6) : null,
      lng: a.lng != null ? a.lng.toFixed(6) : null,
      dedupeKey: a.dedupeKey,
      isSimulated: a.isSimulated ?? false,
      raisedAt: now,
      lastSeenAt: now,
    };
    const refresh = async (id: number) => {
      await db
        .update(safetyAlerts)
        .set({ lastSeenAt: now, occurrences: sql`${safetyAlerts.occurrences} + 1`, detail: values.detail, lat: values.lat, lng: values.lng, severity: a.severity })
        .where(eq(safetyAlerts.id, id));
      return { id, created: false };
    };
    const findOpen = async () =>
      (await db.select({ id: safetyAlerts.id }).from(safetyAlerts).where(and(eq(safetyAlerts.orgId, a.orgId), eq(safetyAlerts.dedupeKey, a.dedupeKey))))[0];
    const open = await findOpen();
    if (open) return refresh(open.id);
    try {
      const [row] = await db.insert(safetyAlerts).values(values).$returningId();
      const id = row!.id;
      await this.notifier.notify(db, {
        orgId: a.orgId,
        permission: 'alerts:read',
        category: a.type === 'missed_checkin' ? 'checkin' : 'alert',
        priority: PRIORITY[a.severity],
        title: a.title,
        body: a.detail,
        link: `/control-room?alert=${id}`,
        entityType: 'alert',
        entityId: id,
        dedupeKey: `alert:${id}`,
      });
      this.realtime.toPermission(a.orgId, 'alerts:read', 'alert', { id, type: a.type, severity: a.severity, title: a.title, tripId: a.tripId ?? null });
      return { id, created: true };
    } catch (err) {
      // Raised concurrently by another process between the lookup and the insert.
      if (!isDuplicateKeyError(err)) throw err;
      return refresh((await findOpen())!.id);
    }
  }

  /** Resolves the unresolved alert with this key (if any) because its condition has cleared. */
  async autoResolve(db: DbOrTx, orgId: number, dedupeKey: string, note: string, now = new Date()): Promise<boolean> {
    const [res] = await db
      .update(safetyAlerts)
      .set({ status: 'resolved', resolvedAt: now, autoResolved: true, resolutionNote: note.slice(0, 255), dedupeKey: null })
      .where(and(eq(safetyAlerts.orgId, orgId), eq(safetyAlerts.dedupeKey, dedupeKey)));
    const done = (res as unknown as { affectedRows: number }).affectedRows > 0;
    if (done) this.realtime.toPermission(orgId, 'alerts:read', 'alert', { resolved: dedupeKey });
    return done;
  }

  /** Keys of the trip's unresolved alerts. */
  async openKeys(db: DbOrTx, orgId: number, tripId: number): Promise<{ key: string; type: AlertType }[]> {
    const rows = await db
      .select({ key: safetyAlerts.dedupeKey, type: safetyAlerts.alertType })
      .from(safetyAlerts)
      .where(and(eq(safetyAlerts.orgId, orgId), eq(safetyAlerts.tripId, tripId), isNotNull(safetyAlerts.dedupeKey)));
    return rows.map((r) => ({ key: r.key!, type: r.type }));
  }

  // ------------------------------------------------------------------ queries and actions

  async list(ctx: RequestContext, q: z.infer<typeof alertListQuerySchema>): Promise<Paginated<SafetyAlertDto>> {
    const conds: SQL[] = [eq(safetyAlerts.orgId, ctx.orgId)];
    if (q.status === 'active') conds.push(inArray(safetyAlerts.status, ['open', 'acknowledged']));
    else if (q.status) conds.push(eq(safetyAlerts.status, q.status as 'open'));
    if (q.severity) conds.push(eq(safetyAlerts.severity, q.severity));
    if (q.alertType) conds.push(eq(safetyAlerts.alertType, q.alertType));
    if (q.tripId) conds.push(eq(safetyAlerts.tripId, q.tripId));
    const where = and(...conds);
    const sort = parseSort<'raisedAt' | 'severity'>(q.sort, 'raisedAt');
    const order = sort.field === 'severity' ? [sort.desc ? desc(SEVERITY_ORDER) : asc(SEVERITY_ORDER), desc(safetyAlerts.raisedAt)] : [sort.desc || !q.sort ? desc(safetyAlerts.raisedAt) : asc(safetyAlerts.raisedAt)];
    const [[total], rows] = await Promise.all([
      this.db.select({ n: count() }).from(safetyAlerts).where(where),
      this.select().where(where).orderBy(...order, desc(safetyAlerts.id)).limit(q.pageSize).offset((q.page - 1) * q.pageSize),
    ]);
    return paginated(rows.map(toDto), q.page, q.pageSize, Number(total?.n ?? 0));
  }

  async get(ctx: RequestContext, id: number): Promise<SafetyAlertDto> {
    const [row] = await this.select().where(and(eq(safetyAlerts.id, id), eq(safetyAlerts.orgId, ctx.orgId)));
    if (!row) throw AppError.notFound('Alert');
    return toDto(row);
  }

  async acknowledge(ctx: RequestContext, id: number, note: string | null | undefined, req: Request): Promise<SafetyAlertDto> {
    const a = await this.get(ctx, id);
    if (a.status !== 'open') throw AppError.businessRule(`This alert is already ${a.status}`);
    await this.db.update(safetyAlerts).set({ status: 'acknowledged', acknowledgedAt: new Date(), acknowledgedBy: ctx.userId }).where(eq(safetyAlerts.id, id));
    await audit(this.db, req, { action: 'alert.acknowledged', entityType: 'alert', entityId: id, summary: `${a.title}${note ? `: ${note}` : ''}` });
    this.realtime.toPermission(ctx.orgId, 'alerts:read', 'alert', { id, status: 'acknowledged' });
    return this.get(ctx, id);
  }

  async resolve(ctx: RequestContext, id: number, note: string, req: Request): Promise<SafetyAlertDto> {
    const a = await this.get(ctx, id);
    if (a.status === 'resolved') throw AppError.businessRule('This alert is already resolved');
    await this.db
      .update(safetyAlerts)
      .set({ status: 'resolved', resolvedAt: new Date(), resolvedBy: ctx.userId, resolutionNote: note, dedupeKey: null, ...(a.status === 'open' ? { acknowledgedAt: new Date(), acknowledgedBy: ctx.userId } : {}) })
      .where(eq(safetyAlerts.id, id));
    await audit(this.db, req, { action: 'alert.resolved', entityType: 'alert', entityId: id, summary: `${a.title}: ${note}` });
    this.realtime.toPermission(ctx.orgId, 'alerts:read', 'alert', { id, status: 'resolved' });
    return this.get(ctx, id);
  }

  async counts(orgId: number): Promise<{ critical: number; warning: number; info: number }> {
    const rows = await this.db
      .select({ severity: safetyAlerts.severity, n: count() })
      .from(safetyAlerts)
      .where(and(eq(safetyAlerts.orgId, orgId), inArray(safetyAlerts.status, ['open', 'acknowledged'])))
      .groupBy(safetyAlerts.severity);
    const out = { critical: 0, warning: 0, info: 0 };
    for (const r of rows) out[r.severity] = Number(r.n);
    return out;
  }

  private select() {
    const ackBy = aliasedTable(users, 'ack_user');
    const resBy = aliasedTable(users, 'res_user');
    return this.db
      .select({
        a: safetyAlerts,
        t: { id: trips.id, tripNo: trips.tripNo },
        v: { id: vehicles.id, registrationNo: vehicles.registrationNo },
        d: { id: workers.id, fullName: workers.fullName, phone: workers.phone },
        ackBy: ackBy.fullName,
        resBy: resBy.fullName,
      })
      .from(safetyAlerts)
      .leftJoin(trips, eq(trips.id, safetyAlerts.tripId))
      .leftJoin(vehicles, eq(vehicles.id, safetyAlerts.vehicleId))
      .leftJoin(workers, eq(workers.id, safetyAlerts.driverId))
      .leftJoin(ackBy, eq(ackBy.id, safetyAlerts.acknowledgedBy))
      .leftJoin(resBy, eq(resBy.id, safetyAlerts.resolvedBy))
      .$dynamic();
  }
}

type SelectRow = {
  a: typeof safetyAlerts.$inferSelect;
  t: { id: number; tripNo: string } | null;
  v: { id: number; registrationNo: string } | null;
  d: { id: number; fullName: string; phone: string } | null;
  ackBy: string | null;
  resBy: string | null;
};

function toDto({ a, t, v, d, ackBy, resBy }: SelectRow): SafetyAlertDto {
  return {
    id: a.id,
    alertType: a.alertType,
    severity: a.severity,
    status: a.status,
    title: a.title,
    detail: a.detail,
    trip: t?.id ? t : null,
    vehicle: v?.id ? v : null,
    driver: d?.id ? d : null,
    lat: toNumber(a.lat),
    lng: toNumber(a.lng),
    isSimulated: a.isSimulated,
    raisedAt: a.raisedAt.toISOString(),
    lastSeenAt: a.lastSeenAt.toISOString(),
    occurrences: a.occurrences,
    acknowledgedAt: a.acknowledgedAt?.toISOString() ?? null,
    acknowledgedBy: ackBy,
    resolvedAt: a.resolvedAt?.toISOString() ?? null,
    resolvedBy: resBy,
    resolutionNote: a.resolutionNote,
    autoResolved: a.autoResolved,
    incidentId: a.incidentId,
  };
}
