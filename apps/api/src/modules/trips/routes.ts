import { Router } from 'express';
import {
  assignmentCheckSchema,
  candidatesQuerySchema,
  idParamSchema,
  idSchema,
  inspectionInputSchema,
  podOtpSchema,
  podOverrideSchema,
  tripActionSchema,
  tripCreateSchema,
  tripEventInputSchema,
  tripListQuerySchema,
  tripReassignSchema,
} from '@transaxis/shared';
import { requireContext, requirePermission } from '../../middleware/auth.js';
import type { TripService } from './service.js';

export function tripRoutes(svc: TripService): Router {
  const r = Router();
  const readers = requirePermission('trips:read', 'trips:update_own');
  const crewOrDispatch = requirePermission('trips:dispatch', 'trips:update_own');

  r.get('/', readers, async (req, res) => {
    res.json(await svc.list(requireContext(req), tripListQuerySchema.parse(req.query)));
  });

  // Assignment helpers. Registered before '/:id' so the words aren't parsed as ids.
  r.get('/candidates', requirePermission('trips:assign'), async (req, res) => {
    const q = candidatesQuerySchema.parse(req.query);
    const vehicleId = req.query.vehicleId ? idSchema.parse(req.query.vehicleId) : undefined;
    res.json(await svc.candidates(requireContext(req), { ...q, vehicleId }));
  });
  r.post('/check', requirePermission('trips:assign'), async (req, res) => {
    res.json(await svc.check(requireContext(req), assignmentCheckSchema.parse(req.body)));
  });

  r.post('/', requirePermission('trips:assign'), async (req, res) => {
    res.status(201).json(await svc.create(requireContext(req), tripCreateSchema.parse(req.body), req));
  });
  r.get('/:id', readers, async (req, res) => {
    res.json(await svc.get(requireContext(req), idParamSchema.parse(req.params).id));
  });
  r.put('/:id/assignment', requirePermission('trips:assign'), async (req, res) => {
    res.json(await svc.reassign(requireContext(req), idParamSchema.parse(req.params).id, tripReassignSchema.parse(req.body), req));
  });
  // Per-action permissions (including "own trip" for drivers) are enforced in the service.
  r.post('/:id/actions', requirePermission('trips:dispatch', 'trips:update_own', 'finance:post', 'finance:approve'), async (req, res) => {
    const result = await svc.act(requireContext(req), idParamSchema.parse(req.params).id, tripActionSchema.parse(req.body), req);
    res.setHeader('cache-control', 'no-store');
    res.json(result);
  });
  r.post('/:id/otp', requirePermission('trips:dispatch'), async (req, res) => {
    res.setHeader('cache-control', 'no-store');
    res.json(await svc.reissueOtp(requireContext(req), idParamSchema.parse(req.params).id, req));
  });
  r.post('/:id/pod', crewOrDispatch, async (req, res) => {
    res.json(await svc.deliverWithOtp(requireContext(req), idParamSchema.parse(req.params).id, podOtpSchema.parse(req.body), req));
  });
  r.post('/:id/pod/override', requirePermission('trips:dispatch'), async (req, res) => {
    res.json(await svc.deliverWithOverride(requireContext(req), idParamSchema.parse(req.params).id, podOverrideSchema.parse(req.body), req));
  });
  r.post('/:id/inspections', crewOrDispatch, async (req, res) => {
    res.status(201).json(await svc.inspect(requireContext(req), idParamSchema.parse(req.params).id, inspectionInputSchema.parse(req.body), req));
  });
  r.post('/:id/events', crewOrDispatch, async (req, res) => {
    res.status(201).json(await svc.addEvent(requireContext(req), idParamSchema.parse(req.params).id, tripEventInputSchema.parse(req.body), req));
  });
  r.get('/:id/backhaul', requirePermission('trips:read'), async (req, res) => {
    res.json({ data: await svc.backhaul(requireContext(req), idParamSchema.parse(req.params).id) });
  });
  return r;
}
