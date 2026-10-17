import { Router } from 'express';
import {
  adminUserCreateSchema,
  adminUserListQuerySchema,
  adminUserUpdateSchema,
  auditQuerySchema,
  expenseCategoryInputSchema,
  idParamSchema,
  orgSettingsUpdateSchema,
  roleCreateSchema,
  rolePermissionsSchema,
  tenantStatusSchema,
} from '@transaxis/shared';
import { requireContext, requirePermission } from '../../middleware/auth.js';
import type { AdminService } from './service.js';

/** Organisation administration. Every route checks its own permission; tenants need `orgs:manage`. */
export function adminRoutes(svc: AdminService): Router {
  const r = Router();
  const usersRead = requirePermission('users:read', 'users:manage');
  const usersManage = requirePermission('users:manage');
  const settingsRead = requirePermission('settings:read', 'settings:manage');
  const settingsManage = requirePermission('settings:manage');
  const id = (params: unknown) => idParamSchema.parse(params).id;

  // People
  r.get('/users', usersRead, async (req, res) => {
    res.json(await svc.listUsers(requireContext(req), adminUserListQuerySchema.parse(req.query)));
  });
  r.get('/users/link-options', usersManage, async (req, res) => {
    res.json(await svc.linkOptions(requireContext(req)));
  });
  r.get('/users/:id', usersRead, async (req, res) => {
    res.json(await svc.getUser(requireContext(req), id(req.params)));
  });
  r.post('/users', usersManage, async (req, res) => {
    res.status(201).json(await svc.createUser(requireContext(req), adminUserCreateSchema.parse(req.body), req));
  });
  r.patch('/users/:id', usersManage, async (req, res) => {
    res.json(await svc.updateUser(requireContext(req), id(req.params), adminUserUpdateSchema.parse(req.body), req));
  });
  r.post('/users/:id/reset-password', usersManage, async (req, res) => {
    res.json(await svc.resetPassword(requireContext(req), id(req.params), req));
  });
  r.post('/users/:id/unlock', usersManage, async (req, res) => {
    res.json(await svc.unlock(requireContext(req), id(req.params), req));
  });
  r.post('/users/:id/reset-two-step', usersManage, async (req, res) => {
    res.json(await svc.resetTwoStep(requireContext(req), id(req.params), req));
  });

  // Roles
  r.get('/permissions', usersRead, (_req, res) => {
    res.json({ data: svc.permissionCatalogue() });
  });
  r.get('/roles', usersRead, async (req, res) => {
    res.json({ data: await svc.listRoles(requireContext(req)) });
  });
  r.post('/roles', usersManage, async (req, res) => {
    res.status(201).json(await svc.createRole(requireContext(req), roleCreateSchema.parse(req.body), req));
  });
  r.put('/roles/:id/permissions', usersManage, async (req, res) => {
    res.json(await svc.updateRolePermissions(requireContext(req), id(req.params), rolePermissionsSchema.parse(req.body).permissions, req));
  });
  r.delete('/roles/:id', usersManage, async (req, res) => {
    await svc.deleteRole(requireContext(req), id(req.params), req);
    res.status(204).end();
  });

  // Settings and configuration
  r.get('/settings', settingsRead, async (req, res) => {
    res.json(await svc.getSettings(requireContext(req)));
  });
  r.patch('/settings', settingsManage, async (req, res) => {
    res.json(await svc.updateSettings(requireContext(req), orgSettingsUpdateSchema.parse(req.body), req));
  });
  r.get('/expense-categories', settingsRead, async (req, res) => {
    res.json({ data: await svc.expenseCategories(requireContext(req)) });
  });
  r.post('/expense-categories', settingsManage, async (req, res) => {
    res.status(201).json(await svc.saveExpenseCategory(requireContext(req), expenseCategoryInputSchema.parse(req.body), null, req));
  });
  r.put('/expense-categories/:id', settingsManage, async (req, res) => {
    res.json(await svc.saveExpenseCategory(requireContext(req), expenseCategoryInputSchema.parse(req.body), id(req.params), req));
  });

  // Oversight
  r.get('/audit', requirePermission('audit:read'), async (req, res) => {
    res.json(await svc.auditLog(requireContext(req), auditQuerySchema.parse(req.query)));
  });
  r.get('/health', requirePermission('system:health'), async (req, res) => {
    res.setHeader('cache-control', 'no-store');
    res.json(await svc.health(requireContext(req)));
  });

  // Tenants (platform administrators only)
  r.get('/tenants', requirePermission('orgs:manage'), async (_req, res) => {
    res.json({ data: await svc.tenants() });
  });
  r.post('/tenants/:id/status', requirePermission('orgs:manage'), async (req, res) => {
    const body = tenantStatusSchema.parse(req.body);
    res.json(await svc.setTenantStatus(requireContext(req), id(req.params), body.status, body.reason, req));
  });
  return r;
}
