import { Router } from 'express';
import { z } from 'zod';
import {
  attendanceUpsertSchema,
  compensationPolicyInputSchema,
  idParamSchema,
  idSchema,
  isoDateSchema,
  leaveDecisionSchema,
  leaveListQuerySchema,
  leaveRequestSchema,
  licenceInputSchema,
  licenceVerificationSchema,
  trainingInputSchema,
  workerCreateSchema,
  workerDocumentInputSchema,
  workerListQuerySchema,
  workerUpdateSchema,
} from '@transaxis/shared';
import { requireContext, requirePermission } from '../../middleware/auth.js';
import type { WorkerService } from './service.js';

const nested = (key: string) => z.object({ id: idSchema, [key]: idSchema });

export function workerRoutes(svc: WorkerService): Router {
  const r = Router();

  r.get('/', requirePermission('workers:read'), async (req, res) => {
    res.json(await svc.list(requireContext(req), workerListQuerySchema.parse(req.query)));
  });
  r.post('/', requirePermission('workers:write'), async (req, res) => {
    res.status(201).json(await svc.create(requireContext(req), workerCreateSchema.parse(req.body), req));
  });
  r.get('/:id', requirePermission('workers:read'), async (req, res) => {
    res.json(await svc.get(requireContext(req), idParamSchema.parse(req.params).id));
  });
  r.patch('/:id', requirePermission('workers:write'), async (req, res) => {
    res.json(await svc.update(requireContext(req), idParamSchema.parse(req.params).id, workerUpdateSchema.parse(req.body), req));
  });

  r.get('/:id/licences', requirePermission('workers:read'), async (req, res) => {
    res.json({ data: await svc.licences(requireContext(req), idParamSchema.parse(req.params).id) });
  });
  r.post('/:id/licences', requirePermission('workers:write'), async (req, res) => {
    res.status(201).json(await svc.addLicence(requireContext(req), idParamSchema.parse(req.params).id, licenceInputSchema.parse(req.body), req));
  });
  r.post('/:id/licences/:licenceId/verification', requirePermission('workers:write'), async (req, res) => {
    const { id, licenceId } = nested('licenceId').parse(req.params) as { id: number; licenceId: number };
    const { verification } = licenceVerificationSchema.parse(req.body);
    res.json(await svc.verifyLicence(requireContext(req), id, licenceId, verification, req));
  });

  // Personal documents (ID proofs, police verification) are HR-only.
  r.get('/:id/documents', requirePermission('workers:sensitive'), async (req, res) => {
    res.json({ data: await svc.documents(requireContext(req), idParamSchema.parse(req.params).id) });
  });
  r.post('/:id/documents', requirePermission('workers:sensitive'), async (req, res) => {
    await svc.addDocument(requireContext(req), idParamSchema.parse(req.params).id, workerDocumentInputSchema.parse(req.body), req);
    res.status(201).end();
  });
  r.delete('/:id/documents/:docId', requirePermission('workers:sensitive'), async (req, res) => {
    const { id, docId } = nested('docId').parse(req.params) as { id: number; docId: number };
    await svc.deleteDocument(requireContext(req), id, docId, req);
    res.status(204).end();
  });

  r.get('/:id/trainings', requirePermission('workers:read'), async (req, res) => {
    res.json({ data: await svc.trainings(requireContext(req), idParamSchema.parse(req.params).id) });
  });
  r.post('/:id/trainings', requirePermission('workers:write'), async (req, res) => {
    await svc.addTraining(requireContext(req), idParamSchema.parse(req.params).id, trainingInputSchema.parse(req.body), req);
    res.status(201).end();
  });

  return r;
}

export function leaveRoutes(svc: WorkerService): Router {
  const r = Router();
  r.get('/', requirePermission('attendance:manage', 'workers:read'), async (req, res) => {
    res.json({ data: await svc.listLeave(requireContext(req), leaveListQuerySchema.parse(req.query)) });
  });
  r.post('/', requirePermission('attendance:manage'), async (req, res) => {
    await svc.requestLeave(requireContext(req), leaveRequestSchema.parse(req.body), req);
    res.status(201).end();
  });
  r.post('/:id/decision', requirePermission('attendance:manage'), async (req, res) => {
    await svc.decideLeave(requireContext(req), idParamSchema.parse(req.params).id, leaveDecisionSchema.parse(req.body), req);
    res.status(204).end();
  });
  return r;
}

export function attendanceRoutes(svc: WorkerService): Router {
  const r = Router();
  r.get('/', requirePermission('attendance:manage'), async (req, res) => {
    const { date } = z.object({ date: isoDateSchema }).parse(req.query);
    res.json({ data: await svc.attendanceFor(requireContext(req), date) });
  });
  r.put('/', requirePermission('attendance:manage'), async (req, res) => {
    await svc.upsertAttendance(requireContext(req), attendanceUpsertSchema.parse(req.body), req);
    res.status(204).end();
  });
  return r;
}

export function compensationRoutes(svc: WorkerService): Router {
  const r = Router();
  r.get('/', requirePermission('workers:read', 'settlements:read'), async (req, res) => {
    res.json({ data: await svc.policies(requireContext(req)) });
  });
  r.post('/', requirePermission('workers:write'), async (req, res) => {
    await svc.createPolicy(requireContext(req), compensationPolicyInputSchema.parse(req.body), req);
    res.status(201).end();
  });
  return r;
}
