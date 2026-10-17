import { Router } from 'express';
import { idParamSchema, portalRequestSchema } from '@transaxis/shared';
import { requireContext, requirePermission } from '../../middleware/auth.js';
import type { PortalService } from './service.js';

/** Customer portal. Bookings and invoices themselves use the main endpoints, which scope portal users. */
export function portalRoutes(svc: PortalService): Router {
  const r = Router();
  r.use(requirePermission('portal:access'));
  r.get('/summary', async (req, res) => {
    res.json(await svc.summary(requireContext(req)));
  });
  r.get('/bookings/:id/tracking', async (req, res) => {
    res.json(await svc.tracking(requireContext(req), idParamSchema.parse(req.params).id));
  });
  r.post('/requests', async (req, res) => {
    res.status(201).json(await svc.request(requireContext(req), portalRequestSchema.parse(req.body), req));
  });
  return r;
}
