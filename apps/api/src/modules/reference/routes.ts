import { Router } from 'express';
import { and, asc, eq } from 'drizzle-orm';
import { branches, type Db } from '@transaxis/database';
import { requireContext } from '../../middleware/auth.js';

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
  return r;
}
