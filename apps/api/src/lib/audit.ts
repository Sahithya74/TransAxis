import type { Request } from 'express';
import { auditLogs, type DbOrTx } from '@transaxis/database';

export interface AuditEntry {
  action: string;
  entityType?: string;
  entityId?: string | number | null;
  summary?: string;
  before?: unknown;
  after?: unknown;
  /** Defaults to the request context. Set explicitly for unauthenticated events (e.g. login). */
  orgId?: number | null;
  userId?: number | null;
}

/**
 * Appends an audit record. Pass the active transaction handle so the audit row commits or rolls
 * back together with the change it describes.
 */
export async function audit(db: DbOrTx, req: Request | null, entry: AuditEntry): Promise<void> {
  const ctx = req?.ctx;
  await db.insert(auditLogs).values({
    orgId: entry.orgId !== undefined ? entry.orgId : (ctx?.orgId ?? null),
    userId: entry.userId !== undefined ? entry.userId : (ctx?.userId ?? null),
    action: entry.action,
    entityType: entry.entityType ?? null,
    entityId: entry.entityId != null ? String(entry.entityId) : null,
    summary: entry.summary?.slice(0, 255) ?? null,
    before: entry.before ?? null,
    after: entry.after ?? null,
    ip: req?.ip?.slice(0, 45) ?? null,
    userAgent: req?.get('user-agent')?.slice(0, 255) ?? null,
    requestId: ((req as { id?: string } | null)?.id ?? null)?.slice(0, 64) ?? null,
  });
}

/** Returns only the fields that changed, so audit rows stay small and readable. */
export function changedFields<T extends Record<string, unknown>>(
  before: T,
  after: Partial<T>,
): { before: Partial<T>; after: Partial<T> } | null {
  const b: Partial<T> = {};
  const a: Partial<T> = {};
  for (const key of Object.keys(after) as (keyof T)[]) {
    const prev = before[key];
    const next = after[key];
    if (next === undefined) continue;
    if (JSON.stringify(prev) !== JSON.stringify(next)) {
      b[key] = prev;
      a[key] = next;
    }
  }
  return Object.keys(a).length ? { before: b, after: a } : null;
}
