import { Router } from 'express';
import { z } from 'zod';
import { requireContext } from '../../middleware/auth.js';
import type { SearchService } from './service.js';

const querySchema = z.object({ q: z.string().trim().max(80).default('') });

/** GET /search?q= - results are filtered by the caller's own permissions, so no extra gate is needed. */
export function searchRoutes(svc: SearchService): Router {
  const r = Router();
  r.get('/', async (req, res) => {
    res.setHeader('cache-control', 'private, no-store');
    res.json({ data: await svc.search(requireContext(req), querySchema.parse(req.query).q) });
  });
  return r;
}
