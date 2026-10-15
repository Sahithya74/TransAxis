import { eq } from 'drizzle-orm';
import { organizations, orgSettings, type Db } from '@transaxis/database';
import { DEFAULT_ELIGIBILITY_SETTINGS, DEFAULT_EXPIRY_WARNING_DAYS, todayIn } from '@transaxis/shared';
import { AppError } from './errors.js';

export interface OrgInfo {
  id: number;
  name: string;
  timezone: string;
  currency: string;
  status: 'active' | 'suspended';
  expiryWarningDays: number;
  minRestHours: number;
  maxDutyHours: number;
}

const TTL_MS = 60_000;
const cache = new Map<number, { value: OrgInfo; expires: number }>();

const num = (v: unknown, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);

/** Organisation facts needed on most requests (timezone, thresholds), cached briefly. */
export async function getOrgInfo(db: Db, orgId: number): Promise<OrgInfo> {
  const hit = cache.get(orgId);
  if (hit && hit.expires > Date.now()) return hit.value;

  const [org] = await db.select().from(organizations).where(eq(organizations.id, orgId)).limit(1);
  if (!org) throw AppError.notFound('Organisation');
  const settings = new Map((await db.select().from(orgSettings).where(eq(orgSettings.orgId, orgId))).map((s) => [s.key, s.value]));

  const value: OrgInfo = {
    id: org.id,
    name: org.name,
    timezone: org.timezone,
    currency: org.currency,
    status: org.status,
    expiryWarningDays: num(settings.get('compliance.expiry_warning_days'), DEFAULT_EXPIRY_WARNING_DAYS),
    minRestHours: num(settings.get('dispatch.min_rest_hours'), DEFAULT_ELIGIBILITY_SETTINGS.minRestHours),
    maxDutyHours: num(settings.get('dispatch.max_duty_hours'), DEFAULT_ELIGIBILITY_SETTINGS.maxDutyHours),
  };
  cache.set(orgId, { value, expires: Date.now() + TTL_MS });
  return value;
}

export function invalidateOrgInfo(orgId: number): void {
  cache.delete(orgId);
}

export const orgToday = (org: OrgInfo, now = new Date()) => todayIn(org.timezone, now);

/** Calendar date of an instant in the organisation's timezone. */
export const orgDate = (org: OrgInfo, at: Date | string) => todayIn(org.timezone, typeof at === 'string' ? new Date(at) : at);

/** Calendar year of an instant in the organisation's timezone (used for document numbering). */
export const orgYear = (org: OrgInfo, at: Date = new Date()) => Number(orgDate(org, at).slice(0, 4));
