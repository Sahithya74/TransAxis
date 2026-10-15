import { Router, type CookieOptions, type Request, type Response } from 'express';
import { ipKeyGenerator, rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import {
  loginRequestSchema,
  passwordResetConfirmSchema,
  passwordResetRequestSchema,
} from '@transaxis/shared';
import type { Env } from '../../config/env.js';
import { AppError } from '../../lib/errors.js';
import { authenticate, requireContext } from '../../middleware/auth.js';
import type { AuthService, IssuedSession } from './service.js';

export const REFRESH_COOKIE = 'tx_rt';
const COOKIE_PATH = '/api/v1/auth';

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(200),
  newPassword: z.string().min(1).max(200),
});

export function authRoutes(service: AuthService, config: Env): Router {
  const r = Router();
  const isTest = config.NODE_ENV === 'test';

  const cookieOptions = (expires?: Date): CookieOptions => ({
    httpOnly: true,
    secure: config.NODE_ENV === 'production',
    sameSite: 'strict',
    path: COOKIE_PATH,
    ...(expires ? { expires } : {}),
  });

  const sendSession = (res: Response, issued: IssuedSession) => {
    res.cookie(REFRESH_COOKIE, issued.refreshToken, cookieOptions(issued.refreshExpiresAt));
    res.setHeader('cache-control', 'no-store');
    res.json(issued.session);
  };

  /**
   * Cookie-authenticated endpoints (refresh/logout) must come from our own web origin. SameSite=Strict
   * already blocks cross-site cookies; this is defence in depth. Non-browser clients send no Origin.
   */
  const assertSameOrigin = (req: Request) => {
    const origin = req.get('origin');
    if (origin && origin !== config.WEB_ORIGIN) throw AppError.forbidden('Cross-origin request rejected');
  };

  // Per IP + email: slows credential stuffing; account lockout handles targeted guessing.
  const loginLimiter = rateLimit({
    windowMs: 15 * 60_000,
    limit: isTest ? 1000 : 20,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    // ipKeyGenerator groups IPv6 addresses by subnet so rotating addresses can't dodge the limit.
    keyGenerator: (req) => `${ipKeyGenerator(req.ip ?? '')}|${String(req.body?.email ?? '').toLowerCase().slice(0, 190)}`,
    handler: (_req, _res, next) => next(new AppError(429, 'RATE_LIMITED', 'Too many sign-in attempts. Try again later.')),
  });
  const resetLimiter = rateLimit({
    windowMs: 60 * 60_000,
    limit: isTest ? 1000 : 10,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    handler: (_req, _res, next) => next(new AppError(429, 'RATE_LIMITED', 'Too many reset requests. Try again later.')),
  });

  r.post('/login', loginLimiter, async (req, res) => {
    const input = loginRequestSchema.parse(req.body);
    sendSession(res, await service.login(input, req));
  });

  r.post('/refresh', async (req, res) => {
    assertSameOrigin(req);
    try {
      sendSession(res, await service.refresh(req.cookies?.[REFRESH_COOKIE], req));
    } catch (err) {
      if (err instanceof AppError && err.status === 401) res.clearCookie(REFRESH_COOKIE, cookieOptions());
      throw err;
    }
  });

  r.post('/logout', async (req, res) => {
    assertSameOrigin(req);
    await service.logout(req.cookies?.[REFRESH_COOKIE], req);
    res.clearCookie(REFRESH_COOKIE, cookieOptions());
    res.status(204).end();
  });

  r.get('/me', authenticate(config.JWT_ACCESS_SECRET), async (req, res) => {
    res.setHeader('cache-control', 'no-store');
    res.json(await service.me(requireContext(req)));
  });

  r.post('/change-password', authenticate(config.JWT_ACCESS_SECRET), async (req, res) => {
    const input = changePasswordSchema.parse(req.body);
    sendSession(res, await service.changePassword(requireContext(req), input.currentPassword, input.newPassword, req));
  });

  r.post('/password-reset/request', resetLimiter, async (req, res) => {
    const { email } = passwordResetRequestSchema.parse(req.body);
    await service.requestPasswordReset(email, req);
    res.status(202).json({ message: 'If an account exists for that email, a reset link has been sent.' });
  });

  r.post('/password-reset/confirm', resetLimiter, async (req, res) => {
    const input = passwordResetConfirmSchema.parse(req.body);
    await service.confirmPasswordReset(input.token, input.password, req);
    res.status(204).end();
  });

  return r;
}
