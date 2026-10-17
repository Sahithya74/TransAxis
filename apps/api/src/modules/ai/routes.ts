import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { aiAskSchema } from '@transaxis/shared';
import { AppError } from '../../lib/errors.js';
import { requireContext, requirePermission } from '../../middleware/auth.js';
import type { AiService } from './service.js';

export function aiRoutes(svc: AiService, isTest = false): Router {
  const r = Router();
  r.use(requirePermission('ai:query'));

  // Per person, not per IP: a whole office may share one address.
  const askLimiter = rateLimit({
    windowMs: 60_000,
    limit: isTest ? 1000 : 20,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    keyGenerator: (req) => `ai:${req.ctx?.orgId}:${req.ctx?.userId}`,
    handler: (_req, _res, next) => next(new AppError(429, 'RATE_LIMITED', 'Too many questions in a minute. Wait a moment and ask again.')),
  });

  r.get('/status', async (req, res) => {
    res.json(await svc.status(requireContext(req)));
  });
  r.post('/ask', askLimiter, async (req, res) => {
    const input = aiAskSchema.parse(req.body);
    // The service looks up figures as this user, through the same permission checks as the app.
    const header = req.get('authorization') ?? '';
    const token = header.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() : null;
    res.json(await svc.ask(requireContext(req), input, token));
  });
  r.get('/history', async (req, res) => {
    res.json({ data: await svc.history(requireContext(req)) });
  });
  return r;
}
