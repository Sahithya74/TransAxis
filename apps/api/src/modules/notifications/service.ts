import { and, count, desc, eq, inArray, isNull, lt, sql } from 'drizzle-orm';
import { notifications, permissions, rolePermissions, userRoles, users, type Db, type DbOrTx } from '@transaxis/database';
import type { NotificationCategory, NotificationDto, NotificationPriority, Paginated, Permission } from '@transaxis/shared';
import type { RequestContext } from '../../lib/context.js';
import { AppError } from '../../lib/errors.js';
import { paginated } from '../../lib/http.js';
import type { Realtime } from '../../realtime/socket.js';

export interface NotifyInput {
  orgId: number;
  /** Everyone in the organisation holding this permission receives it. */
  permission?: Permission;
  userIds?: number[];
  category: NotificationCategory;
  priority: NotificationPriority;
  title: string;
  body?: string | null;
  link?: string | null;
  entityType?: string;
  entityId?: number;
  /** The same key never notifies the same user twice. */
  dedupeKey: string;
}

/** Critical notifications nobody acknowledged within this time are escalated to management. */
export const ESCALATE_AFTER_MIN = 10;

type Row = typeof notifications.$inferSelect;
const toDto = (n: Row): NotificationDto => ({
  id: n.id,
  category: n.category,
  priority: n.priority,
  title: n.title,
  body: n.body,
  link: n.link,
  createdAt: n.createdAt.toISOString(),
  readAt: n.readAt?.toISOString() ?? null,
  acknowledgedAt: n.acknowledgedAt?.toISOString() ?? null,
  escalatedAt: n.escalatedAt?.toISOString() ?? null,
});

export class NotificationService {
  constructor(
    private readonly db: Db,
    private readonly realtime: Realtime,
  ) {}

  /** Active users of an organisation who hold a permission through any of their roles. */
  async usersWith(db: DbOrTx, orgId: number, permission: Permission): Promise<number[]> {
    const rows = await db
      .selectDistinct({ id: users.id })
      .from(users)
      .innerJoin(userRoles, eq(userRoles.userId, users.id))
      .innerJoin(rolePermissions, eq(rolePermissions.roleId, userRoles.roleId))
      .innerJoin(permissions, eq(permissions.id, rolePermissions.permissionId))
      .where(and(eq(users.orgId, orgId), eq(users.status, 'active'), eq(permissions.key, permission)));
    return rows.map((r) => r.id);
  }

  /** Creates one notification per recipient (skipping duplicates) and pushes a hint to their browsers. */
  async notify(db: DbOrTx, input: NotifyInput): Promise<number> {
    const recipients = new Set(input.userIds ?? []);
    if (input.permission) for (const id of await this.usersWith(db, input.orgId, input.permission)) recipients.add(id);
    if (!recipients.size) return 0;
    const [res] = await db
      .insert(notifications)
      .ignore()
      .values(
        [...recipients].map((userId) => ({
          orgId: input.orgId,
          userId,
          category: input.category,
          priority: input.priority,
          title: input.title.slice(0, 160),
          body: input.body?.slice(0, 500) ?? null,
          link: input.link ?? null,
          entityType: input.entityType ?? null,
          entityId: input.entityId ?? null,
          dedupeKey: input.dedupeKey.slice(0, 160),
        })),
      );
    const inserted = (res as unknown as { affectedRows: number }).affectedRows;
    if (inserted > 0) {
      for (const id of recipients) this.realtime.toUser(id, 'notification', { title: input.title, priority: input.priority, link: input.link ?? null });
    }
    return inserted;
  }

  async list(ctx: RequestContext, q: { unread?: 'true' | 'false'; page: number; pageSize: number }): Promise<Paginated<NotificationDto> & { unread: number }> {
    const mine = eq(notifications.userId, ctx.userId);
    const where = q.unread === 'true' ? and(mine, isNull(notifications.readAt)) : mine;
    const [[total], [unread], rows] = await Promise.all([
      this.db.select({ n: count() }).from(notifications).where(where),
      this.db.select({ n: count() }).from(notifications).where(and(mine, isNull(notifications.readAt))),
      this.db.select().from(notifications).where(where).orderBy(desc(notifications.createdAt), desc(notifications.id)).limit(q.pageSize).offset((q.page - 1) * q.pageSize),
    ]);
    return { ...paginated(rows.map(toDto), q.page, q.pageSize, Number(total?.n ?? 0)), unread: Number(unread?.n ?? 0) };
  }

  async markRead(ctx: RequestContext, id: number, acknowledge = false): Promise<NotificationDto> {
    const [n] = await this.db.select().from(notifications).where(and(eq(notifications.id, id), eq(notifications.userId, ctx.userId)));
    if (!n) throw AppError.notFound('Notification');
    const now = new Date();
    await this.db
      .update(notifications)
      .set({ readAt: n.readAt ?? now, ...(acknowledge ? { acknowledgedAt: n.acknowledgedAt ?? now } : {}) })
      .where(eq(notifications.id, id));
    return toDto({ ...n, readAt: n.readAt ?? now, acknowledgedAt: acknowledge ? (n.acknowledgedAt ?? now) : n.acknowledgedAt });
  }

  async markAllRead(ctx: RequestContext): Promise<number> {
    const [res] = await this.db.update(notifications).set({ readAt: new Date() }).where(and(eq(notifications.userId, ctx.userId), isNull(notifications.readAt)));
    return (res as unknown as { affectedRows: number }).affectedRows;
  }

  /**
   * Escalation job: critical notifications left unacknowledged are re-sent to management (users who
   * can read organisation settings) once, and marked escalated.
   */
  async escalate(now = new Date()): Promise<number> {
    const due = await this.db
      .select()
      .from(notifications)
      .where(
        and(
          eq(notifications.priority, 'critical'),
          isNull(notifications.acknowledgedAt),
          isNull(notifications.escalatedAt),
          lt(notifications.createdAt, new Date(now.getTime() - ESCALATE_AFTER_MIN * 60_000)),
          sql`${notifications.dedupeKey} NOT LIKE 'escalation:%'`,
        ),
      )
      .limit(200);
    if (!due.length) return 0;
    // One escalation per underlying event, even if several people missed it.
    const byKey = new Map<string, Row>();
    for (const n of due) byKey.set(`${n.orgId}:${n.dedupeKey}`, n);
    for (const n of byKey.values()) {
      await this.notify(this.db, {
        orgId: n.orgId,
        permission: 'settings:read',
        category: n.category,
        priority: 'critical',
        title: `Not acknowledged for ${ESCALATE_AFTER_MIN}+ min: ${n.title}`.slice(0, 160),
        body: n.body,
        link: n.link,
        entityType: n.entityType ?? undefined,
        entityId: n.entityId ?? undefined,
        dedupeKey: `escalation:${n.dedupeKey}`,
      });
    }
    await this.db.update(notifications).set({ escalatedAt: now }).where(inArray(notifications.id, due.map((n) => n.id)));
    return byKey.size;
  }
}
