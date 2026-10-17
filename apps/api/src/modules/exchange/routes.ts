import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { EXCHANGE_ENTITIES, importRequestSchema, type ExchangeEntity } from '@transaxis/shared';
import { UTF8_BOM } from '../../lib/csv.js';
import { AppError } from '../../lib/errors.js';
import { requireContext } from '../../middleware/auth.js';
import type { ExchangeService } from './service.js';

const entityParam = z.object({ entity: z.enum(EXCHANGE_ENTITIES) });

/**
 * GET  /exchange/:entity/export.csv    the organisation's records (read permission)
 * GET  /exchange/:entity/template.csv  headers and an example row (write permission)
 * POST /exchange/:entity/import        { csv, commit } check, then create (write permission)
 */
export function exchangeRoutes(svc: ExchangeService): Router {
  const r = Router();

  const entityFor = (req: Request, need: 'read' | 'write'): ExchangeEntity => {
    const parsed = entityParam.safeParse(req.params);
    if (!parsed.success) throw AppError.notFound('Export');
    const ctx = requireContext(req);
    const def = svc.definition(parsed.data.entity);
    if (!ctx.permissions.has(need === 'read' ? def.read : def.write)) throw AppError.forbidden();
    return parsed.data.entity;
  };

  const sendCsv = (res: Response, name: string, body: string) => {
    res.setHeader('content-type', 'text/csv; charset=utf-8');
    res.setHeader('content-disposition', `attachment; filename="${name}"`);
    res.setHeader('cache-control', 'private, no-store');
    res.send(`${UTF8_BOM}${body}`);
  };

  r.get('/:entity/export.csv', async (req, res) => {
    const entity = entityFor(req, 'read');
    const ctx = requireContext(req);
    sendCsv(res, await svc.filename(ctx, entity), await svc.export(ctx, entity, req));
  });

  r.get('/:entity/template.csv', async (req, res) => {
    const entity = entityFor(req, 'write');
    sendCsv(res, `${entity}-import-template.csv`, svc.template(requireContext(req), entity));
  });

  r.post('/:entity/import', async (req, res) => {
    const entity = entityFor(req, 'write');
    const body = importRequestSchema.parse(req.body);
    res.json(await svc.import(requireContext(req), entity, body.csv, body.commit, req));
  });

  return r;
}
