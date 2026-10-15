import { Router } from 'express';
import {
  contactInputSchema,
  customerCreateSchema,
  customerListQuerySchema,
  customerUpdateSchema,
  idParamSchema,
  locationInputSchema,
  locationListQuerySchema,
  quoteRequestSchema,
  rateCardInputSchema,
  routeInputSchema,
  vendorCreateSchema,
  vendorListQuerySchema,
  vendorUpdateSchema,
} from '@transaxis/shared';
import { requireContext, requirePermission } from '../../middleware/auth.js';
import type { PartyService } from './service.js';

export function customerRoutes(svc: PartyService): Router {
  const r = Router();
  r.get('/', requirePermission('customers:read'), async (req, res) => {
    res.json(await svc.listCustomers(requireContext(req), customerListQuerySchema.parse(req.query)));
  });
  r.post('/', requirePermission('customers:write'), async (req, res) => {
    res.status(201).json(await svc.createCustomer(requireContext(req), customerCreateSchema.parse(req.body), req));
  });
  r.get('/:id', requirePermission('customers:read'), async (req, res) => {
    res.json(await svc.getCustomer(requireContext(req), idParamSchema.parse(req.params).id));
  });
  r.patch('/:id', requirePermission('customers:write'), async (req, res) => {
    res.json(await svc.updateCustomer(requireContext(req), idParamSchema.parse(req.params).id, customerUpdateSchema.parse(req.body), req));
  });
  r.post('/:id/contacts', requirePermission('customers:write'), async (req, res) => {
    await svc.addContact(requireContext(req), idParamSchema.parse(req.params).id, contactInputSchema.parse(req.body), req);
    res.status(201).end();
  });
  r.get('/:id/rate-cards', requirePermission('customers:read'), async (req, res) => {
    res.json({ data: await svc.rateCards(requireContext(req), idParamSchema.parse(req.params).id) });
  });
  r.post('/:id/rate-cards', requirePermission('customers:write', 'bookings:approve'), async (req, res) => {
    await svc.addRateCard(requireContext(req), idParamSchema.parse(req.params).id, rateCardInputSchema.parse(req.body), req);
    res.status(201).end();
  });
  return r;
}

export function quoteRoutes(svc: PartyService): Router {
  const r = Router();
  r.post('/', requirePermission('bookings:write', 'bookings:read'), async (req, res) => {
    res.json(await svc.quote(requireContext(req), quoteRequestSchema.parse(req.body)));
  });
  return r;
}

export function vendorRoutes(svc: PartyService): Router {
  const r = Router();
  r.get('/', requirePermission('vendors:read'), async (req, res) => {
    res.json(await svc.listVendors(requireContext(req), vendorListQuerySchema.parse(req.query)));
  });
  r.post('/', requirePermission('vendors:write'), async (req, res) => {
    res.status(201).json(await svc.createVendor(requireContext(req), vendorCreateSchema.parse(req.body), req));
  });
  r.get('/:id', requirePermission('vendors:read'), async (req, res) => {
    res.json(await svc.getVendor(requireContext(req), idParamSchema.parse(req.params).id));
  });
  r.patch('/:id', requirePermission('vendors:write'), async (req, res) => {
    res.json(await svc.updateVendor(requireContext(req), idParamSchema.parse(req.params).id, vendorUpdateSchema.parse(req.body), req));
  });
  return r;
}

export function locationRoutes(svc: PartyService): Router {
  const r = Router();
  r.get('/', requirePermission('customers:read', 'bookings:read', 'trips:read'), async (req, res) => {
    res.json({ data: await svc.listLocations(requireContext(req), locationListQuerySchema.parse(req.query)) });
  });
  r.post('/', requirePermission('customers:write', 'bookings:write'), async (req, res) => {
    await svc.createLocation(requireContext(req), locationInputSchema.parse(req.body), req);
    res.status(201).end();
  });
  return r;
}

export function routeRoutes(svc: PartyService): Router {
  const r = Router();
  r.get('/', requirePermission('bookings:read', 'trips:read', 'tracking:read'), async (req, res) => {
    res.json({ data: await svc.listRoutes(requireContext(req)) });
  });
  r.post('/', requirePermission('trips:dispatch'), async (req, res) => {
    res.status(201).json(await svc.createRoute(requireContext(req), routeInputSchema.parse(req.body), req));
  });
  return r;
}
