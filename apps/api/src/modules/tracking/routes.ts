import { Router } from 'express';
import { idParamSchema, positionReportSchema } from '@transaxis/shared';
import { requireContext, requirePermission } from '../../middleware/auth.js';
import type { AlertService } from '../safety/alerts.js';
import type { CheckinService } from '../safety/checkins.js';
import type { IncidentService } from '../safety/incidents.js';
import type { TrackingService } from './service.js';

export function trackingRoutes(svc: TrackingService, alerts: AlertService, incidents: IncidentService, checkins: CheckinService): Router {
  const r = Router();
  r.get('/vehicles', requirePermission('tracking:read'), async (req, res) => {
    res.json({ data: await svc.live(requireContext(req)), simulated: svc.simulated });
  });
  r.get('/summary', requirePermission('tracking:read', 'alerts:read'), async (req, res) => {
    const ctx = requireContext(req);
    const [counts, activeIncidents, missed] = await Promise.all([
      alerts.counts(ctx.orgId),
      incidents.activeCount(ctx.orgId),
      checkins.list(ctx, { status: 'missed' }),
    ]);
    res.json(await svc.summary(ctx, { alerts: counts, activeIncidents, missedCheckins: missed.length }));
  });
  // Crew may follow their own trip; access is checked per trip.
  r.get('/trips/:id', requirePermission('tracking:read', 'trips:update_own'), async (req, res) => {
    res.json(await svc.track(requireContext(req), idParamSchema.parse(req.params).id));
  });
  r.post('/positions', requirePermission('trips:update_own'), async (req, res) => {
    res.status(201).json(await svc.report(requireContext(req), positionReportSchema.parse(req.body), req));
  });
  return r;
}
