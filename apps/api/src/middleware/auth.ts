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

/** Verifies the Bearer access token and attaches the request context. */
export function authenticate(jwtSecret: string): RequestHandler {
  return async (req: Request, _res: Response, next: NextFunction) => {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) return next(AppError.unauthenticated());
    try {
      req.ctx = await verifyAccessToken(header.slice('Bearer '.length).trim(), jwtSecret);
      next();
    } catch {
      // Expired, tampered and malformed tokens are indistinguishable to the caller on purpose.
      next(AppError.unauthenticated('Invalid or expired access token'));
    }
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
