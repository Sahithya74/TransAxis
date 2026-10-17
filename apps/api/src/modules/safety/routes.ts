import { Router } from 'express';
import { z } from 'zod';
import {
  CHECKIN_STATUSES,
  alertAckSchema,
  alertListQuerySchema,
  alertResolveSchema,
  checkinSchema,
  idParamSchema,
  idSchema,
  incidentChangeSchema,
  incidentCreateSchema,
  incidentListQuerySchema,
  sosSchema,
} from '@transaxis/shared';
import { requireContext, requirePermission } from '../../middleware/auth.js';
import type { AlertService } from './alerts.js';
import type { CheckinService } from './checkins.js';
import type { IncidentService } from './incidents.js';

export function alertRoutes(svc: AlertService): Router {
  const r = Router();
  r.get('/', requirePermission('alerts:read'), async (req, res) => {
    res.json(await svc.list(requireContext(req), alertListQuerySchema.parse(req.query)));
  });
  r.get('/:id', requirePermission('alerts:read'), async (req, res) => {
    res.json(await svc.get(requireContext(req), idParamSchema.parse(req.params).id));
  });
  r.post('/:id/acknowledge', requirePermission('alerts:manage'), async (req, res) => {
    res.json(await svc.acknowledge(requireContext(req), idParamSchema.parse(req.params).id, alertAckSchema.parse(req.body ?? {}).note, req));
  });
  r.post('/:id/resolve', requirePermission('alerts:manage'), async (req, res) => {
    res.json(await svc.resolve(requireContext(req), idParamSchema.parse(req.params).id, alertResolveSchema.parse(req.body).note, req));
  });
  return r;
}

export function incidentRoutes(svc: IncidentService): Router {
  const r = Router();
  r.get('/', requirePermission('incidents:read'), async (req, res) => {
    res.json(await svc.list(requireContext(req), incidentListQuerySchema.parse(req.query)));
  });
  r.get('/:id', requirePermission('incidents:read'), async (req, res) => {
    res.json(await svc.get(requireContext(req), idParamSchema.parse(req.params).id));
  });
  // Crew with incidents:report may report on their own trips (checked in the service).
  r.post('/', requirePermission('incidents:report', 'incidents:manage'), async (req, res) => {
    res.status(201).json(await svc.create(requireContext(req), incidentCreateSchema.parse(req.body), req));
  });
  r.patch('/:id', requirePermission('incidents:manage'), async (req, res) => {
    res.json(await svc.change(requireContext(req), idParamSchema.parse(req.params).id, incidentChangeSchema.parse(req.body), req));
  });
  return r;
}

const checkinQuery = z.object({ status: z.enum(CHECKIN_STATUSES).optional(), tripId: idSchema.optional() });

export function checkinRoutes(svc: CheckinService): Router {
  const r = Router();
  r.get('/', requirePermission('alerts:read'), async (req, res) => {
    res.json({ data: await svc.list(requireContext(req), checkinQuery.parse(req.query)) });
  });
  return r;
}

/** Trip-scoped safety actions, mounted under /trips next to the trip lifecycle routes. */
export function tripSafetyRoutes(checkins: CheckinService, incidents: IncidentService): Router {
  const r = Router();
  r.post('/:id/checkins', requirePermission('trips:update_own', 'trips:dispatch'), async (req, res) => {
    res.status(201).json(await checkins.checkIn(requireContext(req), idParamSchema.parse(req.params).id, checkinSchema.parse(req.body ?? {}), req));
  });
  // SOS never contacts emergency services; it alerts the control room and management.
  r.post('/:id/sos', requirePermission('incidents:report', 'incidents:manage'), async (req, res) => {
    const incident = await incidents.sos(requireContext(req), idParamSchema.parse(req.params).id, sosSchema.parse(req.body ?? {}), req);
    res.status(201).json({ incident, message: 'The control room has been alerted. No emergency services were contacted: call 112 in an emergency.' });
  });
  return r;
}
