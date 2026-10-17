import { randomInt } from 'node:crypto';
import { constants } from 'node:fs';
import { access, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { Request } from 'express';
import { and, asc, count, desc, eq, gte, inArray, isNull, like, lt, ne, or, sql, type SQL } from 'drizzle-orm';
import {
  auditLogs,
  customers,
  documents,
  expenseCategories,
  expenses,
  hashPassword,
  jobLocks,
  organizations,
  orgSettings,
  permissions,
  rolePermissions,
  roles,
  userRoles,
  users,
  userSessions,
  vehicles,
  workers,
  type Db,
  type DbOrTx,
} from '@transaxis/database';
import {
  ALL_PERMISSIONS,
  addDays,
  isAdminPermission,
  ORG_SETTINGS,
  PERMISSIONS,
  startOfDayIn,
  type AdminExpenseCategoryDto,
  type AdminUserCreate,
  type AdminUserDto,
  type AuditLogDto,
  type OrgSettingKey,
  type OrgSettingsDto,
  type Paginated,
  type Permission,
  type RoleDto,
  type SystemHealthDto,
  type TemporaryPasswordDto,
  type TenantDto,
} from '@transaxis/shared';
import type { z } from 'zod';
import type { adminUserListQuerySchema, adminUserUpdateSchema, auditQuerySchema, expenseCategoryInputSchema, orgSettingsUpdateSchema } from '@transaxis/shared';
import { ROOT_DIR } from '../../config/env.js';
import { audit } from '../../lib/audit.js';
import type { RequestContext } from '../../lib/context.js';
import { AppError } from '../../lib/errors.js';
import { escapeLike, paginated, parseSort } from '../../lib/http.js';
import { getOrgInfo, invalidateOrgInfo } from '../../lib/org.js';
import type { RagClient } from '../../lib/rag.js';

const LOWER = 'abcdefghijkmnpqrstuvwxyz';
const UPPER = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const DIGITS = '23456789';

/** 14 characters with every class the password policy asks for, avoiding look-alike characters. */
export function temporaryPassword(): string {
  const pick = (set: string) => set[randomInt(set.length)]!;
  const chars = [pick(UPPER), pick(LOWER), pick(DIGITS), ...Array.from({ length: 11 }, () => pick(LOWER + UPPER + DIGITS))];
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j]!, chars[i]!];
  }
  return chars.join('');
}

const startedAt = Date.now();
let version = '0.0.0';
void readFile(resolve(ROOT_DIR, 'package.json'), 'utf8').then((t) => (version = (JSON.parse(t) as { version?: string }).version ?? version), () => undefined);

type UserRow = typeof users.$inferSelect;

/**
 * Administration of one organisation: people, roles, settings, configuration, the audit trail and
 * health. Tenants (organisations themselves) are managed only with `orgs:manage`.
 */
export class AdminService {
  constructor(
    private readonly db: Db,
    private readonly uploadDir: string,
    private readonly rag: RagClient,
  ) {}

  // ------------------------------------------------------------------ users

  private async userDtos(orgId: number, rows: UserRow[]): Promise<AdminUserDto[]> {
    if (!rows.length) return [];
    const ids = rows.map((u) => u.id);
    const [roleRows, workerRows, customerRows] = await Promise.all([
      this.db
        .select({ userId: userRoles.userId, id: roles.id, key: roles.key, name: roles.name })
        .from(userRoles)
        .innerJoin(roles, and(eq(roles.id, userRoles.roleId), eq(roles.orgId, orgId)))
        .where(inArray(userRoles.userId, ids)),
      this.db.select({ id: workers.id, fullName: workers.fullName }).from(workers).where(inArray(workers.id, rows.map((u) => u.workerId ?? 0))),
      this.db.select({ id: customers.id, name: customers.name }).from(customers).where(inArray(customers.id, rows.map((u) => u.customerId ?? 0))),
    ]);
    return rows.map((u) => ({
      id: u.id,
      email: u.email,
      fullName: u.fullName,
      phone: u.phone,
      status: u.status,
      roles: roleRows.filter((r) => r.userId === u.id).map(({ id, key, name }) => ({ id, key, name })),
      worker: workerRows.find((w) => w.id === u.workerId) ?? null,
      customer: customerRows.find((c) => c.id === u.customerId) ?? null,
      lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
      lockedUntil: u.lockedUntil && u.lockedUntil > new Date() ? u.lockedUntil.toISOString() : null,
      totpEnabled: u.totpEnabled,
      mustChangePassword: u.mustChangePassword,
      createdAt: u.createdAt.toISOString(),
    }));
  }

  private async user(ctx: RequestContext, id: number): Promise<UserRow> {
    const [u] = await this.db.select().from(users).where(and(eq(users.id, id), eq(users.orgId, ctx.orgId)));
    if (!u) throw AppError.notFound('User');
    return u;
  }

  async listUsers(ctx: RequestContext, q: z.infer<typeof adminUserListQuerySchema>): Promise<Paginated<AdminUserDto>> {
    const conds: SQL[] = [eq(users.orgId, ctx.orgId)];
    if (q.status) conds.push(eq(users.status, q.status));
    if (q.q) conds.push(or(like(users.fullName, `%${escapeLike(q.q)}%`), like(users.email, `%${escapeLike(q.q)}%`))!);
    if (q.roleId) conds.push(sql`${users.id} IN (SELECT ${userRoles.userId} FROM ${userRoles} WHERE ${userRoles.roleId} = ${q.roleId})`);
    const where = and(...conds);
    const sort = parseSort<'fullName' | 'email' | 'lastLoginAt'>(q.sort, 'fullName');
    const col = sort.field === 'email' ? users.email : sort.field === 'lastLoginAt' ? users.lastLoginAt : users.fullName;
    const [[total], rows] = await Promise.all([
      this.db.select({ n: count() }).from(users).where(where),
      this.db.select().from(users).where(where).orderBy(sort.desc ? desc(col) : asc(col), asc(users.id)).limit(q.pageSize).offset((q.page - 1) * q.pageSize),
    ]);
    return paginated(await this.userDtos(ctx.orgId, rows), q.page, q.pageSize, Number(total?.n ?? 0));
  }

  async getUser(ctx: RequestContext, id: number): Promise<AdminUserDto> {
    return (await this.userDtos(ctx.orgId, [await this.user(ctx, id)]))[0]!;
  }

  private async checkLinks(
    tx: DbOrTx,
    ctx: RequestContext,
    input: { roleIds?: number[]; workerId?: number | null; customerId?: number | null },
    existing?: { id: number; roleIds: number[]; workerId: number | null; customerId: number | null },
  ) {
    const userId = existing?.id;
    if (input.roleIds) {
      const found = await tx.select({ id: roles.id, key: roles.key }).from(roles).where(and(inArray(roles.id, input.roleIds), eq(roles.orgId, ctx.orgId)));
      if (found.length !== new Set(input.roleIds).size) throw AppError.validation('Unknown role', [{ path: 'roleIds', message: 'Choose roles of this organisation' }]);
      // Giving someone a role grants its permissions, so the role-editing rule applies here too: a role
      // carrying administration permissions can only be assigned by someone who holds them.
      const added = input.roleIds.filter((id) => !existing?.roleIds.includes(id));
      if (added.length) {
        const granted = await tx
          .selectDistinct({ key: permissions.key })
          .from(rolePermissions)
          .innerJoin(permissions, eq(permissions.id, rolePermissions.permissionId))
          .where(inArray(rolePermissions.roleId, added));
        const notHeld = granted.map((g) => g.key as Permission).filter((p) => isAdminPermission(p) && !ctx.permissions.has(p));
        if (notHeld.length) {
          throw AppError.forbidden(`That role includes administration access you don't have yourself (${notHeld.join(', ')}), so you can't assign it`);
        }
      }
      const keys = new Set(found.map((r) => r.key));
      const workerId = input.workerId !== undefined ? input.workerId : (existing?.workerId ?? null);
      const customerId = input.customerId !== undefined ? input.customerId : (existing?.customerId ?? null);
      if (keys.has('driver') && !workerId) {
        throw AppError.validation('Link the driver login to their worker record', [{ path: 'workerId', message: 'Drivers see only their own trips and pay, so choose who this is' }]);
      }
      if (keys.has('customer') && !customerId) {
        throw AppError.validation('Link the portal login to its customer', [{ path: 'customerId', message: 'Portal users see only their own bookings and invoices, so choose the customer' }]);
      }
    }
    if (input.workerId) {
      const [w] = await tx.select({ id: workers.id }).from(workers).where(and(eq(workers.id, input.workerId), eq(workers.orgId, ctx.orgId)));
      if (!w) throw AppError.validation('Unknown worker', [{ path: 'workerId', message: 'Worker not found' }]);
      const [taken] = await tx.select({ id: users.id }).from(users).where(and(eq(users.workerId, input.workerId), userId ? ne(users.id, userId) : sql`TRUE`));
      if (taken) throw AppError.conflict('Another login is already linked to this worker', [{ path: 'workerId', message: 'Already linked' }]);
    }
    if (input.customerId) {
      const [c] = await tx.select({ id: customers.id }).from(customers).where(and(eq(customers.id, input.customerId), eq(customers.orgId, ctx.orgId)));
      if (!c) throw AppError.validation('Unknown customer', [{ path: 'customerId', message: 'Customer not found' }]);
    }
  }

  /**
   * Nobody can edit, reset or disable an account with administration access they don't have themselves;
   * otherwise a user administrator could reset the owner's password and sign in as them.
   */
  private async assertOutranks(db: DbOrTx, ctx: RequestContext, userId: number) {
    if (userId === ctx.userId) return;
    const rows = await db
      .selectDistinct({ key: permissions.key })
      .from(userRoles)
      .innerJoin(roles, and(eq(roles.id, userRoles.roleId), eq(roles.orgId, ctx.orgId)))
      .innerJoin(rolePermissions, eq(rolePermissions.roleId, roles.id))
      .innerJoin(permissions, eq(permissions.id, rolePermissions.permissionId))
      .where(eq(userRoles.userId, userId));
    const above = rows.map((r) => r.key as Permission).filter((p) => isAdminPermission(p) && !ctx.permissions.has(p));
    if (above.length) {
      throw AppError.forbidden(`This person has administration access you don't have (${above.join(', ')}); only someone with at least the same access can change their account`);
    }
  }

  /** People who can still manage users after a change; zero would lock the organisation out. */
  private async managersLeft(tx: DbOrTx, orgId: number): Promise<number> {
    const [r] = await tx
      .select({ n: sql<number>`COUNT(DISTINCT ${users.id})` })
      .from(users)
      .innerJoin(userRoles, eq(userRoles.userId, users.id))
      .innerJoin(roles, and(eq(roles.id, userRoles.roleId), eq(roles.orgId, orgId)))
      .innerJoin(rolePermissions, eq(rolePermissions.roleId, roles.id))
      .innerJoin(permissions, eq(permissions.id, rolePermissions.permissionId))
      .where(and(eq(users.orgId, orgId), eq(users.status, 'active'), eq(permissions.key, 'users:manage')));
    return Number(r?.n ?? 0);
  }

  private async assertNotLockedOut(tx: DbOrTx, orgId: number) {
    if ((await this.managersLeft(tx, orgId)) === 0) {
      throw AppError.businessRule('This change would leave nobody able to manage users. Give someone else that permission first.');
    }
  }

  async createUser(ctx: RequestContext, input: AdminUserCreate, req: Request): Promise<TemporaryPasswordDto> {
    const temp = temporaryPassword();
    const id = await this.db.transaction(async (tx) => {
      await this.checkLinks(tx, ctx, input);
      const [exists] = await tx.select({ id: users.id }).from(users).where(eq(users.email, input.email));
      if (exists) throw AppError.conflict('An account with this email already exists', [{ path: 'email', message: 'Already in use' }]);
      const [row] = await tx
        .insert(users)
        .values({
          orgId: ctx.orgId,
          email: input.email,
          fullName: input.fullName,
          phone: input.phone ?? null,
          passwordHash: await hashPassword(temp),
          mustChangePassword: true,
          workerId: input.workerId ?? null,
          customerId: input.customerId ?? null,
        })
        .$returningId();
      await tx.insert(userRoles).values(input.roleIds.map((roleId) => ({ userId: row!.id, roleId })));
      await audit(tx, req, { action: 'user.created', entityType: 'user', entityId: row!.id, summary: `${input.fullName} <${input.email}>`, after: { roleIds: input.roleIds } });
      return row!.id;
    });
    return { user: await this.getUser(ctx, id), temporaryPassword: temp };
  }

  async updateUser(ctx: RequestContext, id: number, input: z.infer<typeof adminUserUpdateSchema>, req: Request): Promise<AdminUserDto> {
    const before = await this.getUser(ctx, id);
    const currentRoleIds = before.roles.map((r) => r.id);
    const rolesChanged = !!input.roleIds && (input.roleIds.length !== currentRoleIds.length || input.roleIds.some((r) => !currentRoleIds.includes(r)));
    const disabling = input.status === 'disabled' && before.status !== 'disabled';
    if (id === ctx.userId && (disabling || rolesChanged)) {
      throw AppError.forbidden("You can't change your own roles or disable your own account; ask another administrator");
    }
    await this.assertOutranks(this.db, ctx, id);
    await this.db.transaction(async (tx) => {
      // The link checks need the full role list even when only the worker or customer link changes.
      const roleIds = input.roleIds ?? (input.workerId !== undefined || input.customerId !== undefined ? currentRoleIds : undefined);
      await this.checkLinks(tx, ctx, { ...input, roleIds }, { id, roleIds: currentRoleIds, workerId: before.worker?.id ?? null, customerId: before.customer?.id ?? null });
      const set: Partial<typeof users.$inferInsert> = {};
      if (input.fullName !== undefined) set.fullName = input.fullName;
      if (input.phone !== undefined) set.phone = input.phone;
      if (input.status !== undefined) set.status = input.status;
      if (input.workerId !== undefined) set.workerId = input.workerId;
      if (input.customerId !== undefined) set.customerId = input.customerId;
      if (Object.keys(set).length) await tx.update(users).set(set).where(eq(users.id, id));
      if (rolesChanged) {
        await tx.delete(userRoles).where(eq(userRoles.userId, id));
        await tx.insert(userRoles).values(input.roleIds!.map((roleId) => ({ userId: id, roleId })));
      }
      // Disabling or changing roles signs the person out everywhere, so new permissions apply at once.
      if (disabling || rolesChanged) {
        await tx.update(userSessions).set({ revokedAt: new Date() }).where(and(eq(userSessions.userId, id), isNull(userSessions.revokedAt)));
      }
      await this.assertNotLockedOut(tx, ctx.orgId);
      await audit(tx, req, {
        action: 'user.updated',
        entityType: 'user',
        entityId: id,
        summary: before.fullName,
        before: { status: before.status, roles: before.roles.map((r) => r.key), workerId: before.worker?.id ?? null, customerId: before.customer?.id ?? null },
        after: input,
      });
    });
    return this.getUser(ctx, id);
  }

  /** Workers and customers a login can be linked to, with only the fields the picker shows. */
  async linkOptions(ctx: RequestContext) {
    const [workerRows, customerRows, linked] = await Promise.all([
      this.db
        .select({ id: workers.id, fullName: workers.fullName, employeeCode: workers.employeeCode, workerType: workers.workerType })
        .from(workers)
        .where(and(eq(workers.orgId, ctx.orgId), ne(workers.employmentStatus, 'terminated')))
        .orderBy(asc(workers.fullName)),
      this.db.select({ id: customers.id, name: customers.name, code: customers.code }).from(customers).where(eq(customers.orgId, ctx.orgId)).orderBy(asc(customers.name)),
      this.db.select({ userId: users.id, workerId: users.workerId }).from(users).where(and(eq(users.orgId, ctx.orgId), sql`${users.workerId} IS NOT NULL`)),
    ]);
    return {
      workers: workerRows.map((w) => ({ ...w, linkedUserId: linked.find((l) => l.workerId === w.id)?.userId ?? null })),
      customers: customerRows,
    };
  }

  private notSelf(ctx: RequestContext, id: number, what: string) {
    if (id === ctx.userId) throw AppError.businessRule(`To ${what} for your own account, use My account (it asks for your password first)`);
  }

  async resetPassword(ctx: RequestContext, id: number, req: Request): Promise<TemporaryPasswordDto> {
    this.notSelf(ctx, id, 'change the password');
    const u = await this.user(ctx, id);
    await this.assertOutranks(this.db, ctx, id);
    const temp = temporaryPassword();
    await this.db.transaction(async (tx) => {
      await tx.update(users).set({ passwordHash: await hashPassword(temp), mustChangePassword: true, failedLoginCount: 0, lockedUntil: null }).where(eq(users.id, id));
      await tx.update(userSessions).set({ revokedAt: new Date() }).where(and(eq(userSessions.userId, id), isNull(userSessions.revokedAt)));
      await audit(tx, req, { action: 'user.password_reset', entityType: 'user', entityId: id, summary: u.fullName });
    });
    return { user: await this.getUser(ctx, id), temporaryPassword: temp };
  }

  async unlock(ctx: RequestContext, id: number, req: Request): Promise<AdminUserDto> {
    const u = await this.user(ctx, id);
    await this.db.update(users).set({ failedLoginCount: 0, lockedUntil: null }).where(eq(users.id, id));
    await audit(this.db, req, { action: 'user.unlocked', entityType: 'user', entityId: id, summary: u.fullName });
    return this.getUser(ctx, id);
  }

  /** For a lost phone: turns two-step sign-in off so the person can set it up again. */
  async resetTwoStep(ctx: RequestContext, id: number, req: Request): Promise<AdminUserDto> {
    this.notSelf(ctx, id, 'turn off two-step sign-in');
    const u = await this.user(ctx, id);
    await this.assertOutranks(this.db, ctx, id);
    await this.db.update(users).set({ totpEnabled: false, totpSecretEnc: null, totpLastStep: null }).where(eq(users.id, id));
    await audit(this.db, req, { action: 'user.totp_reset', entityType: 'user', entityId: id, summary: u.fullName });
    return this.getUser(ctx, id);
  }

  // ------------------------------------------------------------------ roles

  async listRoles(ctx: RequestContext): Promise<RoleDto[]> {
    const [roleRows, permRows, userCounts] = await Promise.all([
      this.db.select().from(roles).where(eq(roles.orgId, ctx.orgId)).orderBy(asc(roles.name)),
      this.db
        .select({ roleId: rolePermissions.roleId, key: permissions.key })
        .from(rolePermissions)
        .innerJoin(permissions, eq(permissions.id, rolePermissions.permissionId))
        .innerJoin(roles, and(eq(roles.id, rolePermissions.roleId), eq(roles.orgId, ctx.orgId))),
      this.db
        .select({ roleId: userRoles.roleId, n: count() })
        .from(userRoles)
        .innerJoin(roles, and(eq(roles.id, userRoles.roleId), eq(roles.orgId, ctx.orgId)))
        .groupBy(userRoles.roleId),
    ]);
    return roleRows.map((r) => ({
      id: r.id,
      key: r.key,
      name: r.name,
      isSystem: r.isSystem,
      permissions: permRows.filter((p) => p.roleId === r.id).map((p) => p.key as Permission).sort(),
      userCount: Number(userCounts.find((u) => u.roleId === r.id)?.n ?? 0),
    }));
  }

  /**
   * Operational permissions can be granted by anyone who manages users. Administration permissions can
   * only be granted by someone who holds them, and a role that carries administration access you lack
   * can't be changed by you at all (that would demote the people above you).
   */
  private assertGrantable(ctx: RequestContext, current: Permission[], next: Permission[]) {
    const outranked = current.filter((p) => isAdminPermission(p) && !ctx.permissions.has(p));
    if (outranked.length) {
      throw AppError.forbidden(`This role has administration access you don't have (${outranked.join(', ')}); only someone with at least that access can change it`);
    }
    const notHeld = next.filter((p) => !current.includes(p) && isAdminPermission(p) && !ctx.permissions.has(p));
    if (notHeld.length) throw AppError.forbidden(`Only someone who has these administration permissions can grant them: ${notHeld.join(', ')}`);
  }

  private async setPermissions(tx: DbOrTx, roleId: number, keys: Permission[]) {
    await tx.delete(rolePermissions).where(eq(rolePermissions.roleId, roleId));
    if (!keys.length) return;
    const rows = await tx.select({ id: permissions.id }).from(permissions).where(inArray(permissions.key, keys));
    await tx.insert(rolePermissions).values(rows.map((p) => ({ roleId, permissionId: p.id })));
  }

  async createRole(ctx: RequestContext, input: { name: string; permissions: Permission[] }, req: Request): Promise<RoleDto> {
    this.assertGrantable(ctx, [], input.permissions);
    const slug = input.name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 40) || 'role';
    const id = await this.db.transaction(async (tx) => {
      const [dup] = await tx.select({ id: roles.id }).from(roles).where(and(eq(roles.orgId, ctx.orgId), or(eq(roles.key, `custom_${slug}`), eq(roles.name, input.name))));
      if (dup) throw AppError.conflict('A role with this name already exists', [{ path: 'name', message: 'Already exists' }]);
      const [row] = await tx.insert(roles).values({ orgId: ctx.orgId, key: `custom_${slug}`, name: input.name, isSystem: false }).$returningId();
      await this.setPermissions(tx, row!.id, input.permissions);
      await audit(tx, req, { action: 'role.created', entityType: 'role', entityId: row!.id, summary: input.name, after: { permissions: input.permissions } });
      return row!.id;
    });
    return (await this.listRoles(ctx)).find((r) => r.id === id)!;
  }

  async updateRolePermissions(ctx: RequestContext, id: number, next: Permission[], req: Request): Promise<RoleDto> {
    const role = (await this.listRoles(ctx)).find((r) => r.id === id);
    if (!role) throw AppError.notFound('Role');
    if (role.key === 'super_admin') throw AppError.forbidden('The platform administrator role cannot be edited');
    this.assertGrantable(ctx, role.permissions, next);
    await this.db.transaction(async (tx) => {
      await this.setPermissions(tx, id, next);
      await this.assertNotLockedOut(tx, ctx.orgId);
      // Holders of the role get the new permissions on their next sign-in or token refresh (within 15 minutes).
      await audit(tx, req, {
        action: 'role.permissions_changed',
        entityType: 'role',
        entityId: id,
        summary: role.name,
        before: { permissions: role.permissions },
        after: { permissions: next },
      });
    });
    return (await this.listRoles(ctx)).find((r) => r.id === id)!;
  }

  async deleteRole(ctx: RequestContext, id: number, req: Request): Promise<void> {
    const role = (await this.listRoles(ctx)).find((r) => r.id === id);
    if (!role) throw AppError.notFound('Role');
    if (role.isSystem) throw AppError.businessRule('Built-in roles cannot be deleted; remove their permissions instead');
    if (role.userCount > 0) throw AppError.businessRule(`${role.userCount} people still have this role; move them to another role first`);
    this.assertGrantable(ctx, role.permissions, []);
    await this.db.transaction(async (tx) => {
      await tx.delete(roles).where(and(eq(roles.id, id), eq(roles.orgId, ctx.orgId)));
      await audit(tx, req, { action: 'role.deleted', entityType: 'role', entityId: id, summary: role.name });
    });
  }

  /** Every permission with its description, grouped by resource for the roles editor. */
  permissionCatalogue(): { key: Permission; description: string; group: string }[] {
    return ALL_PERMISSIONS.map((key) => ({ key, description: PERMISSIONS[key], group: key.split(':')[0]! }));
  }

  // ------------------------------------------------------------------ settings

  async getSettings(ctx: RequestContext): Promise<OrgSettingsDto> {
    const [org] = await this.db.select().from(organizations).where(eq(organizations.id, ctx.orgId));
    if (!org) throw AppError.notFound('Organisation');
    const rows = await this.db.select().from(orgSettings).where(eq(orgSettings.orgId, ctx.orgId));
    const settings = Object.fromEntries(
      (Object.keys(ORG_SETTINGS) as OrgSettingKey[]).map((k) => {
        const v = rows.find((r) => r.key === k)?.value;
        return [k, typeof v === 'number' ? v : ORG_SETTINGS[k].default];
      }),
    ) as Record<OrgSettingKey, number>;
    return {
      profile: { code: org.code, name: org.name, legalName: org.legalName, gstin: org.gstin, addressLine: org.addressLine, city: org.city, state: org.state, timezone: org.timezone, currency: org.currency },
      settings,
    };
  }

  async updateSettings(ctx: RequestContext, input: z.infer<typeof orgSettingsUpdateSchema>, req: Request): Promise<OrgSettingsDto> {
    const before = await this.getSettings(ctx);
    await this.db.transaction(async (tx) => {
      if (input.profile && Object.keys(input.profile).length) {
        await tx.update(organizations).set(input.profile).where(eq(organizations.id, ctx.orgId));
      }
      for (const [key, value] of Object.entries(input.settings ?? {})) {
        if (value === undefined) continue;
        await tx.insert(orgSettings).values({ orgId: ctx.orgId, key, value }).onDuplicateKeyUpdate({ set: { value } });
      }
      await audit(tx, req, { action: 'settings.updated', entityType: 'organization', entityId: ctx.orgId, summary: 'Organisation settings changed', before, after: input });
    });
    invalidateOrgInfo(ctx.orgId);
    return this.getSettings(ctx);
  }

  // ------------------------------------------------------------------ configuration

  async expenseCategories(ctx: RequestContext): Promise<AdminExpenseCategoryDto[]> {
    const [rows, used] = await Promise.all([
      this.db.select().from(expenseCategories).where(eq(expenseCategories.orgId, ctx.orgId)).orderBy(asc(expenseCategories.name)),
      this.db.select({ id: expenses.categoryId, n: count() }).from(expenses).where(eq(expenses.orgId, ctx.orgId)).groupBy(expenses.categoryId),
    ]);
    return rows.map((c) => ({
      id: c.id,
      name: c.name,
      accountKey: c.accountKey,
      isTripExpense: c.isTripExpense,
      requiresReceiptAbove: c.requiresReceiptAbove,
      isActive: c.isActive,
      used: Number(used.find((u) => u.id === c.id)?.n ?? 0),
    }));
  }

  async saveExpenseCategory(ctx: RequestContext, input: z.infer<typeof expenseCategoryInputSchema>, id: number | null, req: Request): Promise<AdminExpenseCategoryDto> {
    const values = {
      name: input.name,
      accountKey: input.accountKey,
      isTripExpense: input.isTripExpense,
      requiresReceiptAbove: input.requiresReceiptAbove === null || input.requiresReceiptAbove === undefined ? null : input.requiresReceiptAbove.toFixed(2),
      isActive: input.isActive,
    };
    const [dup] = await this.db
      .select({ id: expenseCategories.id })
      .from(expenseCategories)
      .where(and(eq(expenseCategories.orgId, ctx.orgId), eq(expenseCategories.name, input.name), id ? ne(expenseCategories.id, id) : sql`TRUE`));
    if (dup) throw AppError.conflict('A category with this name already exists', [{ path: 'name', message: 'Already exists' }]);
    let savedId = id;
    if (id) {
      const [res] = await this.db.update(expenseCategories).set(values).where(and(eq(expenseCategories.id, id), eq(expenseCategories.orgId, ctx.orgId)));
      if ((res as { affectedRows?: number }).affectedRows === 0) throw AppError.notFound('Expense category');
    } else {
      const [row] = await this.db.insert(expenseCategories).values({ orgId: ctx.orgId, ...values }).$returningId();
      savedId = row!.id;
    }
    await audit(this.db, req, { action: id ? 'config.expense_category_updated' : 'config.expense_category_created', entityType: 'expense_category', entityId: savedId!, summary: input.name, after: input });
    return (await this.expenseCategories(ctx)).find((c) => c.id === savedId)!;
  }

  // ------------------------------------------------------------------ audit trail

  async auditLog(ctx: RequestContext, q: z.infer<typeof auditQuerySchema>): Promise<Paginated<AuditLogDto>> {
    const org = await getOrgInfo(this.db, ctx.orgId);
    const conds: SQL[] = [eq(auditLogs.orgId, ctx.orgId)];
    if (q.action) conds.push(like(auditLogs.action, `${escapeLike(q.action)}%`));
    if (q.entityType) conds.push(eq(auditLogs.entityType, q.entityType));
    if (q.entityId) conds.push(eq(auditLogs.entityId, q.entityId));
    if (q.userId) conds.push(eq(auditLogs.userId, q.userId));
    if (q.from) conds.push(gte(auditLogs.createdAt, startOfDayIn(q.from, org.timezone)));
    if (q.to) conds.push(lt(auditLogs.createdAt, startOfDayIn(addDays(q.to, 1), org.timezone)));
    if (q.q) conds.push(or(like(auditLogs.summary, `%${escapeLike(q.q)}%`), like(auditLogs.action, `%${escapeLike(q.q)}%`))!);
    const where = and(...conds);
    const descending = q.sort !== 'createdAt';
    const [[total], rows] = await Promise.all([
      this.db.select({ n: count() }).from(auditLogs).where(where),
      this.db
        .select({ a: auditLogs, u: { id: users.id, fullName: users.fullName, email: users.email } })
        .from(auditLogs)
        .leftJoin(users, eq(users.id, auditLogs.userId))
        .where(where)
        .orderBy(descending ? desc(auditLogs.createdAt) : asc(auditLogs.createdAt), descending ? desc(auditLogs.id) : asc(auditLogs.id))
        .limit(q.pageSize)
        .offset((q.page - 1) * q.pageSize),
    ]);
    return paginated(
      rows.map(({ a, u }) => ({
        id: a.id,
        action: a.action,
        entityType: a.entityType,
        entityId: a.entityId,
        summary: a.summary,
        user: u?.id ? u : null,
        before: a.before,
        after: a.after,
        ip: a.ip,
        userAgent: a.userAgent,
        requestId: a.requestId,
        createdAt: a.createdAt.toISOString(),
      })),
      q.page,
      q.pageSize,
      Number(total?.n ?? 0),
    );
  }

  // ------------------------------------------------------------------ health

  async health(ctx: RequestContext): Promise<SystemHealthDto> {
    let dbOk = false;
    let latency: number | null = null;
    let migrations = 0;
    try {
      const t0 = performance.now();
      await this.db.execute(sql`SELECT 1`);
      latency = Math.round(performance.now() - t0);
      const [rows] = (await this.db.execute(sql`SELECT COUNT(*) AS n FROM __drizzle_migrations`)) as unknown as [{ n: number }[]];
      migrations = Number(rows[0]?.n ?? 0);
      dbOk = true;
    } catch {
      dbOk = false;
    }
    const [rag, docCounts, locks, writable] = await Promise.all([
      this.rag.health(),
      this.db
        .select({ status: documents.status, n: count() })
        .from(documents)
        .where(and(eq(documents.orgId, ctx.orgId), inArray(documents.status, ['queued', 'failed'])))
        .groupBy(documents.status),
      this.db.select().from(jobLocks).orderBy(asc(jobLocks.name)),
      access(this.uploadDir, constants.W_OK).then(
        () => true,
        () => false,
      ),
    ]);
    const now = Date.now();
    return {
      checkedAt: new Date().toISOString(),
      api: { version, node: process.version, uptimeSeconds: Math.round((now - startedAt) / 1000), environment: process.env.NODE_ENV ?? 'development' },
      database: { ok: dbOk, latencyMs: latency, migrations },
      documentService: {
        ok: !!rag,
        mode: rag?.llm ?? null,
        embedding: rag?.embedding ?? null,
        queued: Number(docCounts.find((d) => d.status === 'queued')?.n ?? 0),
        failed: Number(docCounts.find((d) => d.status === 'failed')?.n ?? 0),
      },
      // A lease that lapsed more than five minutes ago means the job stopped running.
      jobs: locks.map((l) => ({ name: l.name, lockedBy: l.lockedBy, lockedUntil: l.lockedUntil.toISOString(), healthy: l.lockedUntil.getTime() > now - 5 * 60_000 })),
      storage: { uploadsWritable: writable },
    };
  }

  // ------------------------------------------------------------------ tenants (platform administrators)

  async tenants(): Promise<TenantDto[]> {
    const [orgs, userCounts, vehicleCounts] = await Promise.all([
      this.db.select().from(organizations).orderBy(asc(organizations.name)),
      this.db.select({ orgId: users.orgId, n: count() }).from(users).groupBy(users.orgId),
      this.db.select({ orgId: vehicles.orgId, n: count() }).from(vehicles).groupBy(vehicles.orgId),
    ]);
    return orgs.map((o) => ({
      id: o.id,
      code: o.code,
      name: o.name,
      status: o.status,
      users: Number(userCounts.find((c) => c.orgId === o.id)?.n ?? 0),
      vehicles: Number(vehicleCounts.find((c) => c.orgId === o.id)?.n ?? 0),
      createdAt: o.createdAt.toISOString(),
    }));
  }

  async setTenantStatus(ctx: RequestContext, id: number, status: 'active' | 'suspended', reason: string, req: Request): Promise<TenantDto> {
    if (id === ctx.orgId) throw AppError.businessRule("You can't suspend your own organisation");
    const [org] = await this.db.select().from(organizations).where(eq(organizations.id, id));
    if (!org) throw AppError.notFound('Organisation');
    await this.db.transaction(async (tx) => {
      await tx.update(organizations).set({ status }).where(eq(organizations.id, id));
      if (status === 'suspended') {
        // Everyone in the organisation is signed out; sign-in and refresh refuse suspended organisations.
        await tx.execute(sql`UPDATE ${userSessions} SET revoked_at = NOW(3) WHERE revoked_at IS NULL AND user_id IN (SELECT id FROM ${users} WHERE org_id = ${id})`);
      }
      await audit(tx, req, { action: status === 'suspended' ? 'tenant.suspended' : 'tenant.reactivated', entityType: 'organization', entityId: id, summary: `${org.name}: ${reason}` });
      await audit(tx, req, { action: status === 'suspended' ? 'tenant.suspended' : 'tenant.reactivated', entityType: 'organization', entityId: id, summary: `By the platform administrator: ${reason}`, orgId: id });
    });
    invalidateOrgInfo(id);
    return (await this.tenants()).find((t) => t.id === id)!;
  }
}
