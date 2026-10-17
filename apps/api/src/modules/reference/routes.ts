import { Router } from 'express';
import { and, asc, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { branches, inspectionTemplates, organizations, permissions, rolePermissions, userRoles, users, type Db } from '@transaxis/database';
import { isPermission, type InspectionChecklistDto, type OrganizationProfileDto } from '@transaxis/shared';
import { requireContext, requirePermission } from '../../middleware/auth.js';

/** Small lookup lists any signed-in user of the organisation may read (for form selects). */
export function referenceRoutes(db: Db): Router {
  const r = Router();
  r.get('/branches', async (req, res) => {
    const ctx = requireContext(req);
    const rows = await db
      .select({ id: branches.id, name: branches.name, city: branches.city, state: branches.state })
      .from(branches)
      .where(and(eq(branches.orgId, ctx.orgId), eq(branches.isActive, true)))
      .orderBy(asc(branches.name));
    res.json({ data: rows });
  });

  // Colleagues holding a permission, e.g. who an incident can be assigned to.
  r.get('/users', requirePermission('users:read', 'incidents:manage', 'alerts:manage'), async (req, res) => {
    const ctx = requireContext(req);
    const permission = z.string().refine(isPermission, 'Unknown permission').parse(req.query.permission);
    const rows = await db
      .selectDistinct({ id: users.id, fullName: users.fullName })
      .from(users)
      .innerJoin(userRoles, eq(userRoles.userId, users.id))
      .innerJoin(rolePermissions, eq(rolePermissions.roleId, userRoles.roleId))
      .innerJoin(permissions, eq(permissions.id, rolePermissions.permissionId))
      .where(and(eq(users.orgId, ctx.orgId), eq(users.status, 'active'), eq(permissions.key, permission)))
      .orderBy(asc(users.fullName));
    res.json({ data: rows });
  });

  // Letterhead details for printed documents (lorry receipts, trip sheets, invoices).
  r.get('/organization', async (req, res) => {
    const ctx = requireContext(req);
    const [org] = await db
      .select({
        name: organizations.name,
        legalName: organizations.legalName,
        gstin: organizations.gstin,
        addressLine: organizations.addressLine,
        city: organizations.city,
        state: organizations.state,
      })
      .from(organizations)
      .where(eq(organizations.id, ctx.orgId));
    res.json(org satisfies OrganizationProfileDto | undefined);
  });

  // The newest active checklist per inspection type, which is the one inspections are validated against.
  r.get('/inspection-checklists', async (req, res) => {
    const ctx = requireContext(req);
    const rows = await db
      .select()
      .from(inspectionTemplates)
      .where(and(eq(inspectionTemplates.orgId, ctx.orgId), eq(inspectionTemplates.isActive, true)))
      .orderBy(desc(inspectionTemplates.id));
    const latest = new Map<string, InspectionChecklistDto>();
    for (const t of rows) {
      if (!latest.has(t.inspectionType)) latest.set(t.inspectionType, { inspectionType: t.inspectionType, name: t.name, items: t.items });
    }
    res.json({ data: [...latest.values()] });
  });
  return r;
}
