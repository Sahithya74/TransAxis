import { SignJWT, jwtVerify } from 'jose';
import { isPermission, ROLE_KEYS, type Permission, type RoleKey } from '@transaxis/shared';
import type { RequestContext } from './context.js';

const ISSUER = 'transaxis-api';
const AUDIENCE = 'transaxis-web';

export interface AccessTokenClaims {
  sub: string;
  org: number;
  roles: RoleKey[];
  perms: Permission[];
  wrk: number | null;
  cus: number | null;
  /** Present (true) while the password is a temporary one. */
  pwd?: true;
}

const key = (secret: string) => new TextEncoder().encode(secret);

export async function signAccessToken(
  ctx: RequestContext,
  secret: string,
  ttlMinutes: number,
): Promise<string> {
  return new SignJWT({
    org: ctx.orgId,
    roles: ctx.roles,
    perms: [...ctx.permissions],
    wrk: ctx.workerId,
    cus: ctx.customerId,
    ...(ctx.mustChangePassword ? { pwd: true } : {}),
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(String(ctx.userId))
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(`${ttlMinutes}m`)
    .sign(key(secret));
}

/** Verifies signature, expiry, issuer and audience, then rebuilds the request context. */
export async function verifyAccessToken(token: string, secret: string): Promise<RequestContext> {
  const { payload } = await jwtVerify(token, key(secret), {
    issuer: ISSUER,
    audience: AUDIENCE,
    algorithms: ['HS256'],
  });
  const claims = payload as unknown as Partial<AccessTokenClaims>;
  const userId = Number(payload.sub);
  if (!Number.isSafeInteger(userId) || typeof claims.org !== 'number') {
    throw new Error('Malformed access token');
  }
  return {
    userId,
    orgId: claims.org,
    roles: (claims.roles ?? []).filter((r): r is RoleKey => (ROLE_KEYS as readonly string[]).includes(r)),
    permissions: new Set((claims.perms ?? []).filter(isPermission)),
    workerId: claims.wrk ?? null,
    customerId: claims.cus ?? null,
    mustChangePassword: claims.pwd === true,
  };
}
