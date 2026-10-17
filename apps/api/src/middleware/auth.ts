import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { Permission } from '@transaxis/shared';
import { AppError } from '../lib/errors.js';
import type { RequestContext } from '../lib/context.js';
import { verifyAccessToken } from '../lib/tokens.js';

declare module 'express-serve-static-core' {
  interface Request {
    /** Set by `authenticate`. Never read directly in handlers; use `requireContext(req)`. */
    ctx?: RequestContext;
  }
}

export interface AuthenticateOptions {
  /** Cached organisation check: stops a suspended organisation at once instead of when its tokens expire. */
  orgActive?: (orgId: number) => Promise<boolean>;
  /** Refuse sessions still on a temporary password. Off only for the account endpoints that change it. */
  requireCurrentPassword?: boolean;
}

/** Verifies the Bearer access token and attaches the request context. */
export function authenticate(jwtSecret: string, { orgActive, requireCurrentPassword = false }: AuthenticateOptions = {}): RequestHandler {
  return async (req: Request, _res: Response, next: NextFunction) => {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) return next(AppError.unauthenticated());
    let ctx: RequestContext;
    try {
      ctx = await verifyAccessToken(header.slice('Bearer '.length).trim(), jwtSecret);
    } catch {
      // Expired, tampered and malformed tokens are indistinguishable to the caller on purpose.
      return next(AppError.unauthenticated('Invalid or expired access token'));
    }
    try {
      if (orgActive && !(await orgActive(ctx.orgId))) return next(AppError.unauthenticated('Your organisation’s access is suspended'));
    } catch (err) {
      return next(err);
    }
    if (requireCurrentPassword && ctx.mustChangePassword) {
      return next(new AppError(403, 'PASSWORD_CHANGE_REQUIRED', 'Choose a new password before continuing'));
    }
    req.ctx = ctx;
    next();
  };
}

export function requireContext(req: Request): RequestContext {
  if (!req.ctx) throw AppError.unauthenticated();
  return req.ctx;
}

/**
 * Server-side permission gate. The user needs at least one of the listed permissions (any-of),
 * which keeps shared endpoints simple. Hidden UI buttons are never the security boundary.
 */
export function requirePermission(...needed: Permission[]): RequestHandler {
  return (req, _res, next) => {
    const ctx = req.ctx;
    if (!ctx) return next(AppError.unauthenticated());
    if (needed.some((p) => ctx.permissions.has(p))) return next();
    next(AppError.forbidden());
  };
}
