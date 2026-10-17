import { z } from 'zod';
import { ALL_PERMISSIONS, type Permission } from '../permissions.js';
import { idSchema, isoDateSchema, listQuerySchema, optionalText } from './common.js';
import { gstinSchema } from './parties.js';
import { phoneSchema } from './workers.js';

// ------------------------------------------------------------------ users

const roleIds = z.array(idSchema).min(1, 'Give the person at least one role').max(10);

export const adminUserCreateSchema = z.object({
  email: z.string().trim().toLowerCase().email('Enter a valid email address').max(190),
  fullName: z.string().trim().min(2, 'Enter the full name').max(140),
  phone: z.preprocess((v) => (v === '' ? null : v), phoneSchema.nullable().optional()),
  roleIds,
  /** Links a driver or helper login to their worker record, so they see only their own trips and pay. */
  workerId: idSchema.nullable().optional(),
  /** Links a customer-portal login to its customer. */
  customerId: idSchema.nullable().optional(),
});
export type AdminUserCreate = z.infer<typeof adminUserCreateSchema>;

export const adminUserUpdateSchema = z.object({
  fullName: z.string().trim().min(2).max(140).optional(),
  phone: z.preprocess((v) => (v === '' ? null : v), phoneSchema.nullable().optional()),
  status: z.enum(['active', 'disabled']).optional(),
  roleIds: roleIds.optional(),
  workerId: idSchema.nullable().optional(),
  customerId: idSchema.nullable().optional(),
});

export const adminUserListQuerySchema = listQuerySchema(['fullName', 'email', 'lastLoginAt'] as const).extend({
  status: z.enum(['active', 'disabled']).optional(),
  roleId: idSchema.optional(),
});

export interface AdminUserDto {
  id: number;
  email: string;
  fullName: string;
  phone: string | null;
  status: 'active' | 'disabled';
  roles: { id: number; key: string; name: string }[];
  worker: { id: number; fullName: string } | null;
  customer: { id: number; name: string } | null;
  lastLoginAt: string | null;
  lockedUntil: string | null;
  totpEnabled: boolean;
  mustChangePassword: boolean;
  createdAt: string;
}

/** Returned once when a user is created or their password is reset; never stored in clear. */
export interface TemporaryPasswordDto {
  user: AdminUserDto;
  temporaryPassword: string;
}

// ------------------------------------------------------------------ roles

const permissionList = z.array(z.enum(ALL_PERMISSIONS as [Permission, ...Permission[]])).max(ALL_PERMISSIONS.length);

export const roleCreateSchema = z.object({
  name: z.string().trim().min(3, 'Name the role').max(120),
  permissions: permissionList,
});
export const rolePermissionsSchema = z.object({ permissions: permissionList });

export interface RoleDto {
  id: number;
  key: string;
  name: string;
  isSystem: boolean;
  permissions: Permission[];
  userCount: number;
}

// ------------------------------------------------------------------ organisation settings

/** Settings people can change, with their limits. The API reads these keys; nothing else is accepted. */
export const ORG_SETTINGS = {
  'compliance.expiry_warning_days': { label: 'Document expiry warning (days)', description: 'Vehicle documents and licences show as expiring this many days ahead.', min: 1, max: 90, default: 15 },
  'dispatch.min_rest_hours': { label: 'Minimum rest between trips (hours)', description: 'Assigning a driver with less rest than this needs a written override.', min: 4, max: 24, default: 8 },
  'dispatch.max_duty_hours': { label: 'Maximum duty per trip (hours)', description: 'Trips planned longer than this for one driver need a written override.', min: 6, max: 16, default: 12 },
} as const;
export type OrgSettingKey = keyof typeof ORG_SETTINGS;

const timezoneSchema = z.string().refine((tz) => {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}, 'Unknown timezone');

const settingNumber = (k: OrgSettingKey) => z.coerce.number().int().min(ORG_SETTINGS[k].min, `At least ${ORG_SETTINGS[k].min}`).max(ORG_SETTINGS[k].max, `At most ${ORG_SETTINGS[k].max}`).optional();

export const orgSettingsUpdateSchema = z.object({
  profile: z
    .object({
      name: z.string().trim().min(2).max(160),
      legalName: optionalText(200),
      gstin: gstinSchema,
      addressLine: optionalText(255),
      city: optionalText(80),
      state: optionalText(80),
      timezone: timezoneSchema,
    })
    .partial()
    .optional(),
  settings: z
    .object({
      'compliance.expiry_warning_days': settingNumber('compliance.expiry_warning_days'),
      'dispatch.min_rest_hours': settingNumber('dispatch.min_rest_hours'),
      'dispatch.max_duty_hours': settingNumber('dispatch.max_duty_hours'),
    })
    .optional(),
});

export interface OrgSettingsDto {
  profile: {
    code: string;
    name: string;
    legalName: string | null;
    gstin: string | null;
    addressLine: string | null;
    city: string | null;
    state: string | null;
    timezone: string;
    currency: string;
  };
  settings: Record<OrgSettingKey, number>;
}

// ------------------------------------------------------------------ audit, health, tenants

export const auditQuerySchema = listQuerySchema(['createdAt'] as const).extend({
  action: z.string().trim().max(64).optional(),
  entityType: z.string().trim().max(48).optional(),
  entityId: z.string().trim().max(48).optional(),
  userId: idSchema.optional(),
  from: isoDateSchema.optional(),
  to: isoDateSchema.optional(),
});

export interface AuditLogDto {
  id: number;
  action: string;
  entityType: string | null;
  entityId: string | null;
  summary: string | null;
  user: { id: number; fullName: string; email: string } | null;
  before: unknown;
  after: unknown;
  ip: string | null;
  userAgent: string | null;
  requestId: string | null;
  createdAt: string;
}

export interface SystemHealthDto {
  checkedAt: string;
  api: { version: string; node: string; uptimeSeconds: number; environment: string };
  database: { ok: boolean; latencyMs: number | null; migrations: number };
  documentService: { ok: boolean; mode: string | null; embedding: string | null; queued: number; failed: number };
  jobs: { name: string; lockedBy: string; lockedUntil: string; healthy: boolean }[];
  storage: { uploadsWritable: boolean };
}

export interface TenantDto {
  id: number;
  code: string;
  name: string;
  status: 'active' | 'suspended';
  users: number;
  vehicles: number;
  createdAt: string;
}

export const tenantStatusSchema = z.object({ status: z.enum(['active', 'suspended']), reason: z.string().trim().min(5, 'Give a reason').max(255) });

// ------------------------------------------------------------------ two-factor sign-in

export const totpCodeSchema = z.object({ code: z.string().trim().regex(/^\d{6}$/, 'Enter the 6-digit code from your authenticator app') });
export const totpLoginSchema = totpCodeSchema.extend({ mfaToken: z.string().min(20).max(2000) });
export const totpDisableSchema = z.object({ password: z.string().min(1, 'Enter your password').max(200) });

export interface TotpSetupDto {
  /** Base32 secret for manual entry. */
  secret: string;
  otpauthUrl: string;
  /** PNG data URL of the QR code. */
  qrDataUrl: string;
}

/** A sign-in that needs the second step: no session yet, only a short-lived challenge. */
export interface MfaChallengeDto {
  mfaRequired: true;
  mfaToken: string;
}

// ------------------------------------------------------------------ global search

export interface SearchResultDto {
  type: 'vehicle' | 'worker' | 'customer' | 'booking' | 'trip' | 'invoice' | 'document';
  id: number;
  title: string;
  subtitle: string | null;
  link: string;
}

// ------------------------------------------------------------------ configuration: expense categories

/** Ledger accounts an expense category can be booked to. */
export const EXPENSE_ACCOUNT_KEYS = ['trip_expense', 'fuel_expense', 'maintenance_expense', 'crew_wages', 'hire_charges', 'office_expense'] as const;

export const expenseCategoryInputSchema = z.object({
  name: z.string().trim().min(3, 'Name the category').max(80),
  accountKey: z.enum(EXPENSE_ACCOUNT_KEYS),
  isTripExpense: z.boolean().default(true),
  requiresReceiptAbove: z.coerce.number().min(0).max(1_000_000).nullable().optional(),
  isActive: z.boolean().default(true),
});

export interface AdminExpenseCategoryDto {
  id: number;
  name: string;
  accountKey: string;
  isTripExpense: boolean;
  requiresReceiptAbove: string | null;
  isActive: boolean;
  used: number;
}
