import {
  boolean,
  bigint,
  char,
  index,
  int,
  json,
  mysqlEnum,
  mysqlTable,
  primaryKey,
  text,
  uniqueIndex,
  varchar,
  decimal,
  type AnyMySqlColumn,
} from 'drizzle-orm/mysql-core';
import { createdAtCol, dt, idCol, refCol, updatedAtCol } from './common.js';
import { customers } from './commercial.js';
import { workers } from './people.js';

// ---------------------------------------------------------------- tenancy

export const organizations = mysqlTable(
  'organizations',
  {
    id: idCol(),
    code: varchar('code', { length: 32 }).notNull(),
    name: varchar('name', { length: 160 }).notNull(),
    legalName: varchar('legal_name', { length: 200 }),
    gstin: varchar('gstin', { length: 20 }),
    addressLine: varchar('address_line', { length: 255 }),
    city: varchar('city', { length: 80 }),
    state: varchar('state', { length: 80 }),
    country: varchar('country', { length: 2 }).notNull().default('IN'),
    timezone: varchar('timezone', { length: 64 }).notNull().default('Asia/Kolkata'),
    currency: varchar('currency', { length: 3 }).notNull().default('INR'),
    status: mysqlEnum('status', ['active', 'suspended']).notNull().default('active'),
    createdAt: createdAtCol(),
    updatedAt: updatedAtCol(),
  },
  (t) => [uniqueIndex('uq_organizations_code').on(t.code)],
);

export const branches = mysqlTable(
  'branches',
  {
    id: idCol(),
    orgId: refCol('org_id')
      .notNull()
      .references(() => organizations.id),
    name: varchar('name', { length: 120 }).notNull(),
    city: varchar('city', { length: 80 }),
    state: varchar('state', { length: 80 }),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: createdAtCol(),
    updatedAt: updatedAtCol(),
  },
  (t) => [uniqueIndex('uq_branches_org_name').on(t.orgId, t.name)],
);

// ---------------------------------------------------------------- identity & access

export const users = mysqlTable(
  'users',
  {
    id: idCol(),
    orgId: refCol('org_id')
      .notNull()
      .references(() => organizations.id),
    email: varchar('email', { length: 190 }).notNull(),
    passwordHash: varchar('password_hash', { length: 255 }).notNull(),
    fullName: varchar('full_name', { length: 140 }).notNull(),
    phone: varchar('phone', { length: 32 }),
    status: mysqlEnum('status', ['active', 'disabled']).notNull().default('active'),
    failedLoginCount: int('failed_login_count').notNull().default(0),
    lockedUntil: dt('locked_until'),
    lastLoginAt: dt('last_login_at'),
    mustChangePassword: boolean('must_change_password').notNull().default(false),
    totpSecretEnc: varchar('totp_secret_enc', { length: 255 }),
    totpEnabled: boolean('totp_enabled').notNull().default(false),
    /** Set for driver/helper logins; restricts trip access to the worker's own assignments. */
    workerId: refCol('worker_id').references((): AnyMySqlColumn => workers.id),
    /** Set for customer-portal logins; restricts bookings and invoices to that customer. */
    customerId: refCol('customer_id').references((): AnyMySqlColumn => customers.id),
    createdAt: createdAtCol(),
    updatedAt: updatedAtCol(),
  },
  (t) => [uniqueIndex('uq_users_email').on(t.email), index('ix_users_org').on(t.orgId)],
);

export const roles = mysqlTable(
  'roles',
  {
    id: idCol(),
    orgId: refCol('org_id')
      .notNull()
      .references(() => organizations.id),
    key: varchar('key', { length: 48 }).notNull(),
    name: varchar('name', { length: 120 }).notNull(),
    isSystem: boolean('is_system').notNull().default(false),
    createdAt: createdAtCol(),
  },
  (t) => [uniqueIndex('uq_roles_org_key').on(t.orgId, t.key)],
);

export const permissions = mysqlTable(
  'permissions',
  {
    id: idCol(),
    key: varchar('key', { length: 64 }).notNull(),
    description: varchar('description', { length: 255 }).notNull(),
  },
  (t) => [uniqueIndex('uq_permissions_key').on(t.key)],
);

export const rolePermissions = mysqlTable(
  'role_permissions',
  {
    roleId: refCol('role_id')
      .notNull()
      .references(() => roles.id, { onDelete: 'cascade' }),
    permissionId: refCol('permission_id')
      .notNull()
      .references(() => permissions.id, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.roleId, t.permissionId] })],
);

export const userRoles = mysqlTable(
  'user_roles',
  {
    userId: refCol('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    roleId: refCol('role_id')
      .notNull()
      .references(() => roles.id, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.userId, t.roleId] })],
);

/**
 * Refresh sessions. The opaque refresh token is never stored, only its SHA-256.
 * Rotation keeps `familyId`; presenting an already-rotated token revokes the whole family.
 */
export const userSessions = mysqlTable(
  'user_sessions',
  {
    id: idCol(),
    userId: refCol('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    familyId: char('family_id', { length: 36 }).notNull(),
    tokenHash: char('token_hash', { length: 64 }).notNull(),
    userAgent: varchar('user_agent', { length: 255 }),
    ip: varchar('ip', { length: 45 }),
    expiresAt: dt('expires_at').notNull(),
    rotatedAt: dt('rotated_at'),
    revokedAt: dt('revoked_at'),
    createdAt: createdAtCol(),
    lastUsedAt: dt('last_used_at'),
  },
  (t) => [
    uniqueIndex('uq_user_sessions_token').on(t.tokenHash),
    index('ix_user_sessions_user').on(t.userId),
    index('ix_user_sessions_family').on(t.familyId),
  ],
);

export const passwordResetTokens = mysqlTable(
  'password_reset_tokens',
  {
    id: idCol(),
    userId: refCol('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: char('token_hash', { length: 64 }).notNull(),
    expiresAt: dt('expires_at').notNull(),
    usedAt: dt('used_at'),
    createdAt: createdAtCol(),
  },
  (t) => [uniqueIndex('uq_password_reset_token').on(t.tokenHash)],
);

// ---------------------------------------------------------------- configuration & plumbing

export const orgSettings = mysqlTable(
  'org_settings',
  {
    orgId: refCol('org_id')
      .notNull()
      .references(() => organizations.id),
    key: varchar('key', { length: 80 }).notNull(),
    value: json('value').notNull(),
    updatedAt: updatedAtCol(),
  },
  (t) => [primaryKey({ columns: [t.orgId, t.key] })],
);

/** Per-org, per-year human-readable number generator (TRP-2026-000123). */
export const numberSequences = mysqlTable(
  'number_sequences',
  {
    orgId: refCol('org_id')
      .notNull()
      .references(() => organizations.id),
    scope: varchar('scope', { length: 32 }).notNull(),
    year: int('year').notNull(),
    nextValue: int('next_value').notNull().default(1),
  },
  (t) => [primaryKey({ columns: [t.orgId, t.scope, t.year] })],
);

export const idempotencyKeys = mysqlTable(
  'idempotency_keys',
  {
    id: idCol(),
    orgId: refCol('org_id').notNull(),
    userId: refCol('user_id').notNull(),
    key: varchar('key', { length: 100 }).notNull(),
    requestHash: char('request_hash', { length: 64 }).notNull(),
    responseStatus: int('response_status'),
    responseBody: json('response_body'),
    createdAt: createdAtCol(),
  },
  (t) => [uniqueIndex('uq_idempotency_org_key').on(t.orgId, t.key)],
);

/** Append-only. UPDATE/DELETE are blocked by triggers in migration 0001b. */
export const auditLogs = mysqlTable(
  'audit_logs',
  {
    id: idCol(),
    orgId: refCol('org_id'),
    userId: refCol('user_id'),
    action: varchar('action', { length: 64 }).notNull(),
    entityType: varchar('entity_type', { length: 48 }),
    entityId: varchar('entity_id', { length: 48 }),
    summary: varchar('summary', { length: 255 }),
    before: json('before'),
    after: json('after'),
    ip: varchar('ip', { length: 45 }),
    userAgent: varchar('user_agent', { length: 255 }),
    requestId: varchar('request_id', { length: 64 }),
    createdAt: createdAtCol(),
  },
  (t) => [
    index('ix_audit_org_created').on(t.orgId, t.createdAt),
    index('ix_audit_entity').on(t.entityType, t.entityId),
    index('ix_audit_user').on(t.userId),
  ],
);

export const jobLocks = mysqlTable('job_locks', {
  name: varchar('name', { length: 64 }).primaryKey(),
  lockedUntil: dt('locked_until').notNull(),
  lockedBy: varchar('locked_by', { length: 64 }).notNull(),
});

/** Generic attachment metadata. Bytes live on disk under UPLOAD_DIR, never served statically. */
export const files = mysqlTable(
  'files',
  {
    id: idCol(),
    orgId: refCol('org_id')
      .notNull()
      .references(() => organizations.id),
    storageKey: varchar('storage_key', { length: 255 }).notNull(),
    originalName: varchar('original_name', { length: 255 }).notNull(),
    mime: varchar('mime', { length: 120 }).notNull(),
    sizeBytes: bigint('size_bytes', { mode: 'number', unsigned: true }).notNull(),
    sha256: char('sha256', { length: 64 }).notNull(),
    category: varchar('category', { length: 48 }).notNull().default('general'),
    entityType: varchar('entity_type', { length: 48 }),
    entityId: refCol('entity_id'),
    uploadedBy: refCol('uploaded_by').references(() => users.id),
    capturedAt: dt('captured_at'),
    lat: decimal('lat', { precision: 9, scale: 6 }),
    lng: decimal('lng', { precision: 9, scale: 6 }),
    note: text('note'),
    createdAt: createdAtCol(),
  },
  (t) => [
    uniqueIndex('uq_files_storage_key').on(t.storageKey),
    index('ix_files_entity').on(t.orgId, t.entityType, t.entityId),
  ],
);
