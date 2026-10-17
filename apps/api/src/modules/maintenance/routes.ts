import { Router } from 'express';
import { z } from 'zod';
import {
  TYRE_STATUSES,
  idParamSchema,
  idSchema,
  partInputSchema,
  partPurchaseSchema,
  scheduleInputSchema,
  tyreActionSchema,
  tyreInputSchema,
  workOrderActionSchema,
  workOrderCreateSchema,
  workOrderItemSchema,
  workOrderListQuerySchema,
} from '@transaxis/shared';
import { requireContext, requirePermission } from '../../middleware/auth.js';
import type { MaintenanceService } from './service.js';

export function maintenanceRoutes(svc: MaintenanceService): Router {
  const r = Router();
  const read = requirePermission('maintenance:read');
  const write = requirePermission('maintenance:write');

  r.get('/schedules', read, async (req, res) => {
    const q = z.object({ vehicleId: idSchema.optional(), due: z.enum(['due', 'all']).optional() }).parse(req.query);
    res.json({ data: await svc.schedules(requireContext(req), q) });
  });
  r.post('/schedules', write, async (req, res) => {
    res.status(201).json(await svc.saveSchedule(requireContext(req), scheduleInputSchema.parse(req.body), null, req));
  });
  r.put('/schedules/:id', write, async (req, res) => {
    res.json(await svc.saveSchedule(requireContext(req), scheduleInputSchema.parse(req.body), idParamSchema.parse(req.params).id, req));
  });

  r.get('/work-orders', read, async (req, res) => {
    res.json(await svc.listWorkOrders(requireContext(req), workOrderListQuerySchema.parse(req.query)));
  });
  r.get('/work-orders/:id', read, async (req, res) => {
    res.json(await svc.getWorkOrder(requireContext(req), idParamSchema.parse(req.params).id));
  });
  r.post('/work-orders', write, async (req, res) => {
    res.status(201).json(await svc.createWorkOrder(requireContext(req), workOrderCreateSchema.parse(req.body), req));
  });
  r.post('/work-orders/:id/items', write, async (req, res) => {
    res.status(201).json(await svc.addItem(requireContext(req), idParamSchema.parse(req.params).id, workOrderItemSchema.parse(req.body), req));
  });
  r.delete('/work-orders/:id/items/:itemId', write, async (req, res) => {
    const p = z.object({ id: idSchema, itemId: idSchema }).parse(req.params);
    res.json(await svc.removeItem(requireContext(req), p.id, p.itemId, req));
  });
  r.post('/work-orders/:id/actions', write, async (req, res) => {
    res.json(await svc.act(requireContext(req), idParamSchema.parse(req.params).id, workOrderActionSchema.parse(req.body), req));
  });

  r.get('/parts', read, async (req, res) => {
    res.json({ data: await svc.parts(requireContext(req)) });
  });
  r.post('/parts', write, async (req, res) => {
    res.status(201).json(await svc.createPart(requireContext(req), partInputSchema.parse(req.body), req));
  });
  r.post('/parts/:id/purchases', write, async (req, res) => {
    res.status(201).json(await svc.purchase(requireContext(req), idParamSchema.parse(req.params).id, partPurchaseSchema.parse(req.body), req));
  });

  r.get('/tyres', read, async (req, res) => {
    const q = z.object({ vehicleId: idSchema.optional(), status: z.enum(TYRE_STATUSES).optional() }).parse(req.query);
    res.json({ data: await svc.tyres(requireContext(req), q) });
  });
  r.post('/tyres', write, async (req, res) => {
    res.status(201).json(await svc.createTyre(requireContext(req), tyreInputSchema.parse(req.body), req));
  });
  r.post('/tyres/:id/actions', write, async (req, res) => {
    res.json(await svc.tyreAction(requireContext(req), idParamSchema.parse(req.params).id, tyreActionSchema.parse(req.body), req));
  });

  r.get('/insights', read, async (req, res) => {
    res.json({ data: await svc.insights(requireContext(req)), experimental: true });
  });
  return r;
}
