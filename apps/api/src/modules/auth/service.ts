import { randomUUID } from 'node:crypto';
import type { Request } from 'express';
import { and, eq, gt, isNull } from 'drizzle-orm';
import {
  hashPassword,
  organizations,
  passwordResetTokens,
  permissions,
  rolePermissions,
  roles,
  userRoles,
  users,
  userSessions,
  verifyPassword,
  type Db,
  type DbOrTx,
} from '@transaxis/database';
import {
  isPermission,
  passwordSchema,
  ROLE_KEYS,
  type LoginRequest,
  type Permission,
  type RoleKey,
  type SessionOrganization,
  type SessionResponse,
  type SessionUser,
} from '@transaxis/shared';
import type { Env } from '../../config/env.js';
import { audit } from '../../lib/audit.js';
import type { RequestContext } from '../../lib/context.js';
import { randomToken, sha256 } from '../../lib/crypto.js';
import { AppError } from '../../lib/errors.js';
import { signAccessToken } from '../../lib/tokens.js';
import type { MessageProvider } from '../../providers/messaging.js';

export const MAX_FAILED_LOGINS = 5;
export const LOCKOUT_MINUTES = 15;
const RESET_TOKEN_TTL_MINUTES = 30;
/** Two tabs refreshing at the same moment is normal; treat a just-rotated token as a race, not theft. */
const REFRESH_RACE_GRACE_MS = 10_000;

const INVALID_LOGIN = `Invalid email or password. After ${MAX_FAILED_LOGINS} failed attempts an account is locked for ${LOCKOUT_MINUTES} minutes.`;

export interface AuthDeps {
  db: Db;
  config: Env;
  messenger: MessageProvider;
}

export interface IssuedSession {
  session: SessionResponse;
  refreshToken: string;
  refreshExpiresAt: Date;
}

type UserRow = typeof users.$inferSelect;

export class AuthService {
  /** Hash of a random password, verified for unknown emails so response time doesn't reveal them. */
  private dummyHash: Promise<string>;

  constructor(private readonly deps: AuthDeps) {
    this.dummyHash = hashPassword(randomToken(16));
  }

  // ------------------------------------------------------------------ login

  async login(input: LoginRequest, req: Request): Promise<IssuedSession> {
    const { db } = this.deps;
    const [user] = await db.select().from(users).where(eq(users.email, input.email)).limit(1);

    if (!user) {
      await verifyPassword(await this.dummyHash, input.password);
      await audit(db, req, {
        action: 'auth.login_failed',
        summary: 'Unknown email',
        after: { email: input.email },
        orgId: null,
        userId: null,
      });
      throw AppError.unauthenticated(INVALID_LOGIN);
    }

    const now = new Date();
    const locked = user.lockedUntil && user.lockedUntil > now;
    const passwordOk = await verifyPassword(user.passwordHash, input.password);
    const [org] = await db.select().from(organizations).where(eq(organizations.id, user.orgId)).limit(1);

    if (locked) {
      await audit(db, req, { action: 'auth.login_blocked', summary: 'Account locked', orgId: user.orgId, userId: user.id });
      throw AppError.unauthenticated(INVALID_LOGIN);
    }

    if (!passwordOk) {
      const failures = user.failedLoginCount + 1;
      const lockNow = failures >= MAX_FAILED_LOGINS;
      await db
        .update(users)
        .set({
          failedLoginCount: lockNow ? 0 : failures,
          lockedUntil: lockNow ? new Date(now.getTime() + LOCKOUT_MINUTES * 60_000) : user.lockedUntil,
        })
        .where(eq(users.id, user.id));
      await audit(db, req, {
        action: lockNow ? 'auth.account_locked' : 'auth.login_failed',
        summary: lockNow ? `Locked for ${LOCKOUT_MINUTES} minutes after ${MAX_FAILED_LOGINS} failures` : `Wrong password (${failures})`,
        orgId: user.orgId,
        userId: user.id,
      });
      throw AppError.unauthenticated(INVALID_LOGIN);
    }

    if (user.status !== 'active' || !org || org.status !== 'active') {
      await audit(db, req, { action: 'auth.login_blocked', summary: 'User or organisation inactive', orgId: user.orgId, userId: user.id });
      throw AppError.unauthenticated(INVALID_LOGIN);
    }

    await db
      .update(users)
      .set({ failedLoginCount: 0, lockedUntil: null, lastLoginAt: now })
      .where(eq(users.id, user.id));

    const issued = await this.issueSession(db, user, randomUUID(), req);
    await audit(db, req, { action: 'auth.login', orgId: user.orgId, userId: user.id });
    return issued;
  }

  // ------------------------------------------------------------------ refresh / logout

  async refresh(refreshToken: string | undefined, req: Request): Promise<IssuedSession> {
    const { db } = this.deps;
    if (!refreshToken) throw AppError.unauthenticated('No active session');

    const [session] = await db
      .select()
      .from(userSessions)
      .where(eq(userSessions.tokenHash, sha256(refreshToken)))
      .limit(1);
    if (!session || session.revokedAt) throw AppError.unauthenticated('Session expired, please sign in again');

    const now = new Date();
    if (session.rotatedAt) {
      if (now.getTime() - session.rotatedAt.getTime() < REFRESH_RACE_GRACE_MS) {
        throw new AppError(409, 'CONFLICT', 'Session was just refreshed by another request; retry');
      }
      // A rotated token was presented again: it was copied. Kill every session in the family.
      await this.revokeFamily(db, session.familyId);
      const [u] = await db.select({ orgId: users.orgId }).from(users).where(eq(users.id, session.userId)).limit(1);
      await audit(db, req, {
        action: 'auth.refresh_reuse_detected',
        summary: 'Rotated refresh token reused; all sessions in the family revoked',
        orgId: u?.orgId ?? null,
        userId: session.userId,
      });
      throw AppError.unauthenticated('Session expired, please sign in again');
    }
    if (session.expiresAt <= now) throw AppError.unauthenticated('Session expired, please sign in again');

    const [user] = await db.select().from(users).where(eq(users.id, session.userId)).limit(1);
    const [org] = user ? await db.select().from(organizations).where(eq(organizations.id, user.orgId)).limit(1) : [];
    if (!user || user.status !== 'active' || !org || org.status !== 'active') {
      await this.revokeFamily(db, session.familyId);
      throw AppError.unauthenticated('Session expired, please sign in again');
    }

    return db.transaction(async (tx) => {
      // Conditional update makes rotation atomic: only one concurrent request can win.
      const [result] = await tx
        .update(userSessions)
        .set({ rotatedAt: now, lastUsedAt: now })
        .where(and(eq(userSessions.id, session.id), isNull(userSessions.rotatedAt), isNull(userSessions.revokedAt)));
      if ((result as { affectedRows?: number }).affectedRows !== 1) {
        throw new AppError(409, 'CONFLICT', 'Session was just refreshed by another request; retry');
      }
      return this.issueSession(tx, user, session.familyId, req);
    });
  }

  async logout(refreshToken: string | undefined, req: Request): Promise<void> {
    if (!refreshToken) return;
    const { db } = this.deps;
    const [session] = await db
      .select()
      .from(userSessions)
      .where(eq(userSessions.tokenHash, sha256(refreshToken)))
      .limit(1);
    if (!session) return;
    await this.revokeFamily(db, session.familyId);
    const [u] = await db.select({ orgId: users.orgId }).from(users).where(eq(users.id, session.userId)).limit(1);
    await audit(db, req, { action: 'auth.logout', orgId: u?.orgId ?? null, userId: session.userId });
  }

  // ------------------------------------------------------------------ profile

  async me(ctx: RequestContext): Promise<Omit<SessionResponse, 'accessToken' | 'expiresIn'>> {
    const { db } = this.deps;
    const [user] = await db.select().from(users).where(and(eq(users.id, ctx.userId), eq(users.orgId, ctx.orgId))).limit(1);
    if (!user || user.status !== 'active') throw AppError.unauthenticated();
    const [org] = await db.select().from(organizations).where(eq(organizations.id, user.orgId)).limit(1);
    const access = await loadUserAccess(db, user.id, user.orgId);
    return { user: toSessionUser(user, access), organization: toSessionOrg(org!) };
  }

  async changePassword(ctx: RequestContext, current: string, next: string, req: Request): Promise<IssuedSession> {
    const { db } = this.deps;
    const [user] = await db.select().from(users).where(and(eq(users.id, ctx.userId), eq(users.orgId, ctx.orgId))).limit(1);
    if (!user) throw AppError.unauthenticated();
    if (!(await verifyPassword(user.passwordHash, current))) {
      throw AppError.validation('Current password is incorrect', [{ path: 'currentPassword', message: 'Incorrect password' }]);
    }
    passwordSchema.parse(next);
    if (current === next) {
      throw AppError.validation('Choose a password different from the current one', [{ path: 'newPassword', message: 'Must differ from current password' }]);
    }

    return db.transaction(async (tx) => {
      await tx
        .update(users)
        .set({ passwordHash: await hashPassword(next), mustChangePassword: false })
        .where(eq(users.id, user.id));
      // Every other device is signed out; this one gets a fresh session.
      await tx.update(userSessions).set({ revokedAt: new Date() }).where(and(eq(userSessions.userId, user.id), isNull(userSessions.revokedAt)));
      await audit(tx, req, { action: 'auth.password_changed' });
      return this.issueSession(tx, { ...user, mustChangePassword: false }, randomUUID(), req);
    });
  }

  // ------------------------------------------------------------------ password reset

  /** Always succeeds from the caller's point of view so it can't be used to discover accounts. */
  async requestPasswordReset(email: string, req: Request): Promise<void> {
    const { db, config, messenger } = this.deps;
    const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);
    if (!user || user.status !== 'active') return;

    const token = randomToken();
    await db.insert(passwordResetTokens).values({
      userId: user.id,
      tokenHash: sha256(token),
      expiresAt: new Date(Date.now() + RESET_TOKEN_TTL_MINUTES * 60_000),
    });
    const link = `${config.WEB_ORIGIN}/reset-password?token=${encodeURIComponent(token)}`;
    const result = await messenger.send({
      channel: 'email',
      to: user.email,
      purpose: 'password_reset',
      subject: 'Reset your TransAxis password',
      body: `Use this link within ${RESET_TOKEN_TTL_MINUTES} minutes to set a new password: ${link}\nIf you did not request this, ignore this message.`,
    });
    await audit(db, req, {
      action: 'auth.password_reset_requested',
      summary: `Delivery: ${result.status} via ${messenger.name}`,
      orgId: user.orgId,
      userId: user.id,
    });
  }

  async confirmPasswordReset(token: string, newPassword: string, req: Request): Promise<void> {
    const { db } = this.deps;
    const now = new Date();
    const [row] = await db
      .select()
      .from(passwordResetTokens)
      .where(
        and(
          eq(passwordResetTokens.tokenHash, sha256(token)),
          isNull(passwordResetTokens.usedAt),
          gt(passwordResetTokens.expiresAt, now),
        ),
      )
      .limit(1);
    if (!row) throw AppError.validation('This reset link is invalid or has expired. Request a new one.');

    await db.transaction(async (tx) => {
      const [res] = await tx
        .update(passwordResetTokens)
        .set({ usedAt: now })
        .where(and(eq(passwordResetTokens.id, row.id), isNull(passwordResetTokens.usedAt)));
      if ((res as { affectedRows?: number }).affectedRows !== 1) {
        throw AppError.validation('This reset link has already been used.');
      }
      await tx
        .update(users)
        .set({ passwordHash: await hashPassword(newPassword), failedLoginCount: 0, lockedUntil: null, mustChangePassword: false })
        .where(eq(users.id, row.userId));
      await tx.update(userSessions).set({ revokedAt: now }).where(and(eq(userSessions.userId, row.userId), isNull(userSessions.revokedAt)));
      const [u] = await tx.select({ orgId: users.orgId }).from(users).where(eq(users.id, row.userId)).limit(1);
      await audit(tx, req, { action: 'auth.password_reset_completed', orgId: u?.orgId ?? null, userId: row.userId });
    });
  }

  // ------------------------------------------------------------------ internals

  private async issueSession(db: DbOrTx, user: UserRow, familyId: string, req: Request): Promise<IssuedSession> {
    const { config } = this.deps;
    const access = await loadUserAccess(db, user.id, user.orgId);
    const [org] = await db.select().from(organizations).where(eq(organizations.id, user.orgId)).limit(1);

    const ctx: RequestContext = {
      userId: user.id,
      orgId: user.orgId,
      roles: access.roles,
      permissions: new Set(access.permissions),
      workerId: user.workerId ?? null,
      customerId: user.customerId ?? null,
    };
    const accessToken = await signAccessToken(ctx, config.JWT_ACCESS_SECRET, config.ACCESS_TOKEN_TTL_MINUTES);
    const refreshToken = randomToken();
    const refreshExpiresAt = new Date(Date.now() + config.REFRESH_TOKEN_TTL_DAYS * 86_400_000);

    await db.insert(userSessions).values({
      userId: user.id,
      familyId,
      tokenHash: sha256(refreshToken),
      userAgent: req.get('user-agent')?.slice(0, 255) ?? null,
      ip: req.ip?.slice(0, 45) ?? null,
      expiresAt: refreshExpiresAt,
    });

    return {
      refreshToken,
      refreshExpiresAt,
      session: {
        accessToken,
        expiresIn: config.ACCESS_TOKEN_TTL_MINUTES * 60,
        user: toSessionUser(user, access),
        organization: toSessionOrg(org!),
      },
    };
  }

  private async revokeFamily(db: DbOrTx, familyId: string): Promise<void> {
    await db
      .update(userSessions)
      .set({ revokedAt: new Date() })
      .where(and(eq(userSessions.familyId, familyId), isNull(userSessions.revokedAt)));
  }
}

/** Roles and permissions granted to a user through roles of their own organisation only. */
export async function loadUserAccess(
  db: DbOrTx,
  userId: number,
  orgId: number,
): Promise<{ roles: RoleKey[]; permissions: Permission[] }> {
  const rows = await db
    .select({ role: roles.key, perm: permissions.key })
    .from(userRoles)
    .innerJoin(roles, and(eq(roles.id, userRoles.roleId), eq(roles.orgId, orgId)))
    .leftJoin(rolePermissions, eq(rolePermissions.roleId, roles.id))
    .leftJoin(permissions, eq(permissions.id, rolePermissions.permissionId))
    .where(eq(userRoles.userId, userId));

  const roleSet = new Set<RoleKey>();
  const permSet = new Set<Permission>();
  for (const r of rows) {
    if ((ROLE_KEYS as readonly string[]).includes(r.role)) roleSet.add(r.role as RoleKey);
    if (r.perm && isPermission(r.perm)) permSet.add(r.perm);
  }
  return { roles: [...roleSet], permissions: [...permSet].sort() };
}

function toSessionUser(user: UserRow, access: { roles: RoleKey[]; permissions: Permission[] }): SessionUser {
  return {
    id: user.id,
    email: user.email,
    fullName: user.fullName,
    roles: access.roles,
    permissions: access.permissions,
    workerId: user.workerId ?? null,
    customerId: user.customerId ?? null,
    mustChangePassword: user.mustChangePassword,
  };
}

function toSessionOrg(org: typeof organizations.$inferSelect): SessionOrganization {
  return { id: org.id, name: org.name, timezone: org.timezone, currency: org.currency };
}
