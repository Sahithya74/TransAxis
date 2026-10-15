import { Router } from 'express';
import { z } from 'zod';
import {
  idParamSchema,
  idSchema,
  vehicleCreateSchema,
  vehicleDocumentInputSchema,
  vehicleListQuerySchema,
  vehicleTypeInputSchema,
  vehicleUpdateSchema,
} from '@transaxis/shared';
import { requireContext, requirePermission } from '../../middleware/auth.js';
import type { VehicleService } from './service.js';

const docParams = z.object({ id: idSchema, docId: idSchema });

export function vehicleRoutes(svc: VehicleService): Router {
  const r = Router();

  r.get('/', requirePermission('vehicles:read'), async (req, res) => {
    res.json(await svc.list(requireContext(req), vehicleListQuerySchema.parse(req.query)));
  });

  r.post('/', requirePermission('vehicles:write'), async (req, res) => {
    const vehicle = await svc.create(requireContext(req), vehicleCreateSchema.parse(req.body), req);
    res.status(201).json(vehicle);
  });

  // Registered before '/:id' so "summary" is not parsed as an id.
  r.get('/summary', requirePermission('vehicles:read'), async (req, res) => {
    res.json(await svc.summary(requireContext(req)));
  });

  r.get('/:id', requirePermission('vehicles:read'), async (req, res) => {
    const { id } = idParamSchema.parse(req.params);
    res.json(await svc.get(requireContext(req), id));
  });

  r.patch('/:id', requirePermission('vehicles:write'), async (req, res) => {
    const { id } = idParamSchema.parse(req.params);
    res.json(await svc.update(requireContext(req), id, vehicleUpdateSchema.parse(req.body), req));
  });

  r.get('/:id/documents', requirePermission('vehicles:read'), async (req, res) => {
    const { id } = idParamSchema.parse(req.params);
    res.json({ data: await svc.listDocuments(requireContext(req), id) });
  });

  r.post('/:id/documents', requirePermission('vehicle_documents:write'), async (req, res) => {
    const { id } = idParamSchema.parse(req.params);
    const doc = await svc.addDocument(requireContext(req), id, vehicleDocumentInputSchema.parse(req.body), req);
    res.status(201).json(doc);
  });

  r.put('/:id/documents/:docId', requirePermission('vehicle_documents:write'), async (req, res) => {
    const { id, docId } = docParams.parse(req.params);
    res.json(await svc.updateDocument(requireContext(req), id, docId, vehicleDocumentInputSchema.parse(req.body), req));
  });

  r.delete('/:id/documents/:docId', requirePermission('vehicle_documents:write'), async (req, res) => {
    const { id, docId } = docParams.parse(req.params);
    await svc.deleteDocument(requireContext(req), id, docId, req);
    res.status(204).end();
  });

  return r;
}

export function vehicleTypeRoutes(svc: VehicleService): Router {
  const r = Router();
  r.get('/', requirePermission('vehicles:read'), async (req, res) => {
    res.json({ data: await svc.listTypes(requireContext(req)) });
  });
  r.post('/', requirePermission('vehicles:write'), async (req, res) => {
    res.status(201).json(await svc.createType(requireContext(req), vehicleTypeInputSchema.parse(req.body), req));
  });
  r.patch('/:id', requirePermission('vehicles:write'), async (req, res) => {
    const { id } = idParamSchema.parse(req.params);
    res.json(await svc.updateType(requireContext(req), id, vehicleTypeInputSchema.partial().parse(req.body), req));
  });
  return r;
}
