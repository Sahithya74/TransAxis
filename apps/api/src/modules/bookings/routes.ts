import { Router } from 'express';
import { z } from 'zod';
import {
  bookingActionSchema,
  bookingInputSchema,
  bookingListQuerySchema,
  bookingQuoteSchema,
  idParamSchema,
} from '@transaxis/shared';
import { requireContext, requirePermission } from '../../middleware/auth.js';
import type { BookingService } from './service.js';

const versionHeader = z.coerce.number().int().positive().optional();

export function bookingRoutes(svc: BookingService): Router {
  const r = Router();

  // portal:access users are scoped to their own customer inside the service.
  r.get('/', requirePermission('bookings:read', 'portal:access'), async (req, res) => {
    res.json(await svc.list(requireContext(req), bookingListQuerySchema.parse(req.query)));
  });
  r.post('/', requirePermission('bookings:write'), async (req, res) => {
    res.status(201).json(await svc.create(requireContext(req), bookingInputSchema.parse(req.body), req));
  });
  r.get('/:id', requirePermission('bookings:read', 'portal:access'), async (req, res) => {
    res.json(await svc.get(requireContext(req), idParamSchema.parse(req.params).id));
  });
  // Full replace. Send the version you loaded in If-Match to avoid overwriting someone else's edit.
  r.put('/:id', requirePermission('bookings:write'), async (req, res) => {
    const { id } = idParamSchema.parse(req.params);
    const version = versionHeader.parse(req.get('if-match')?.replace(/"/g, '') || undefined);
    res.json(await svc.replace(requireContext(req), id, bookingInputSchema.parse(req.body), version, req));
  });
  r.post('/:id/quote', requirePermission('bookings:write'), async (req, res) => {
    res.json(await svc.quote(requireContext(req), idParamSchema.parse(req.params).id, bookingQuoteSchema.parse(req.body), req));
  });
  r.post('/:id/actions', requirePermission('bookings:write', 'bookings:approve'), async (req, res) => {
    res.json(await svc.act(requireContext(req), idParamSchema.parse(req.params).id, bookingActionSchema.parse(req.body), req));
  });
  return r;
}
