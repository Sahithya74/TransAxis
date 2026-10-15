import { eq } from 'drizzle-orm';
import { organizations, orgSettings, type Db } from '@transaxis/database';
import { DEFAULT_EXPIRY_WARNING_DAYS, todayIn } from '@transaxis/shared';
import { AppError } from './errors.js';

export interface OrgInfo {
  id: number;
  name: string;
  timezone: string;
  currency: string;
  status: 'active' | 'suspended';
  expiryWarningDays: number;
}

const TTL_MS = 60_000;
const cache = new Map<number, { value: OrgInfo; expires: number }>();

/** Organisation facts needed on most requests (timezone, thresholds), cached briefly. */
export async function getOrgInfo(db: Db, orgId: number): Promise<OrgInfo> {
  const hit = cache.get(orgId);
  if (hit && hit.expires > Date.now()) return hit.value;

  const [org] = await db.select().from(organizations).where(eq(organizations.id, orgId)).limit(1);
  if (!org) throw AppError.notFound('Organisation');
  const settings = await db.select().from(orgSettings).where(eq(orgSettings.orgId, orgId));
  const warn = settings.find((s) => s.key === 'compliance.expiry_warning_days')?.value;

  const value: OrgInfo = {
    id: org.id,
    name: org.name,
    timezone: org.timezone,
    currency: org.currency,
    status: org.status,
    expiryWarningDays: typeof warn === 'number' ? warn : DEFAULT_EXPIRY_WARNING_DAYS,
  };
  cache.set(orgId, { value, expires: Date.now() + TTL_MS });
  return value;
}

export function invalidateOrgInfo(orgId: number): void {
  cache.delete(orgId);
}

export const orgToday = (org: OrgInfo, now = new Date()) => todayIn(org.timezone, now);
