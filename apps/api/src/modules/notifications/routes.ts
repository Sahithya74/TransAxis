import { Router } from 'express';
import { idParamSchema, notificationListQuerySchema } from '@transaxis/shared';
import { requireContext, requirePermission } from '../../middleware/auth.js';
import type { NotificationService } from './service.js';

/** A user's own notifications. Nobody can read or change anyone else's. */
export function notificationRoutes(svc: NotificationService): Router {
  const r = Router();
  r.use(requirePermission('notifications:read'));
  r.get('/', async (req, res) => {
    res.json(await svc.list(requireContext(req), notificationListQuerySchema.parse(req.query)));
  });
  r.post('/read-all', async (req, res) => {
    res.json({ updated: await svc.markAllRead(requireContext(req)) });
  });
  r.post('/:id/read', async (req, res) => {
    res.json(await svc.markRead(requireContext(req), idParamSchema.parse(req.params).id));
  });
  r.post('/:id/acknowledge', async (req, res) => {
    res.json(await svc.markRead(requireContext(req), idParamSchema.parse(req.params).id, true));
  });
  return r;
}
