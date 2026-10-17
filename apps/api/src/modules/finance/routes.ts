import { Router } from 'express';
import { z } from 'zod';
import {
  advanceCreateSchema,
  creditNoteSchema,
  deductionCreateSchema,
  expenseDecisionSchema,
  expenseInputSchema,
  expenseListQuerySchema,
  fuelInputSchema,
  fuelListQuerySchema,
  idParamSchema,
  idSchema,
  invoiceCancelSchema,
  invoiceCreateSchema,
  invoiceListQuerySchema,
  isoDateSchema,
  receiptCreateSchema,
  reportPeriodSchema,
  settlementCreateSchema,
  settlementListQuerySchema,
  settlementPaySchema,
} from '@transaxis/shared';
import { requireContext, requirePermission } from '../../middleware/auth.js';
import type { CrewPayService } from './crew-pay.js';
import type { ExpenseService } from './expenses.js';
import type { FuelService } from './fuel.js';
import type { InvoiceService } from './invoices.js';
import type { LedgerService } from './ledger.js';
import { REPORT_KEYS, toCsv, type ReportService } from './reports.js';

export interface FinanceServices {
  ledger: LedgerService;
  expenses: ExpenseService;
  fuel: FuelService;
  invoices: InvoiceService;
  crew: CrewPayService;
  reports: ReportService;
}

const period = (q: unknown) => reportPeriodSchema.parse(q);
const reason = z.object({ reason: z.string().trim().min(5, 'Give a reason').max(255) });
const note = z.object({ note: z.string().trim().min(3, 'Write a note').max(255) });
const page = z.object({ page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(25), customerId: idSchema.optional() });

export function financeRoutes(s: FinanceServices): Router {
  const r = Router();
  const read = requirePermission('finance:read');
  const post = requirePermission('finance:post');

  r.get('/summary', requirePermission('finance:read', 'reports:read'), async (req, res) => {
    const p = period(req.query);
    res.json(await s.reports.financeSummary(requireContext(req), p.from, p.to));
  });
  r.get('/trial-balance', read, async (req, res) => {
    const q = z.object({ from: isoDateSchema.optional(), to: isoDateSchema.optional() }).parse(req.query);
    res.json({ data: await s.ledger.trialBalance(requireContext(req).orgId, q.from, q.to) });
  });

  // ------------------------------------------------------------------ expenses
  const expenseUsers = requirePermission('finance:read', 'finance:post', 'expenses:submit');
  r.get('/expense-categories', expenseUsers, async (req, res) => {
    res.json({ data: await s.expenses.categories(requireContext(req)) });
  });
  r.get('/expenses', expenseUsers, async (req, res) => {
    res.json(await s.expenses.list(requireContext(req), expenseListQuerySchema.parse(req.query)));
  });
  r.get('/expenses/:id', expenseUsers, async (req, res) => {
    res.json(await s.expenses.get(requireContext(req), idParamSchema.parse(req.params).id));
  });
  r.post('/expenses', requirePermission('finance:post', 'expenses:submit'), async (req, res) => {
    res.status(201).json(await s.expenses.create(requireContext(req), expenseInputSchema.parse(req.body), req));
  });
  r.post('/expenses/:id/decision', post, async (req, res) => {
    res.json(await s.expenses.decide(requireContext(req), idParamSchema.parse(req.params).id, expenseDecisionSchema.parse(req.body), req));
  });

  // ------------------------------------------------------------------ fuel
  r.get('/fuel', requirePermission('fuel:read', 'finance:read'), async (req, res) => {
    res.json(await s.fuel.list(requireContext(req), fuelListQuerySchema.parse(req.query)));
  });
  r.get('/fuel/summary', requirePermission('fuel:read', 'finance:read'), async (req, res) => {
    const p = period(req.query);
    res.json({ data: await s.fuel.summary(requireContext(req), p.from, p.to) });
  });
  // Crew may record fuel on their own trip; checked in the service.
  r.post('/fuel', requirePermission('fuel:write', 'finance:post', 'expenses:submit'), async (req, res) => {
    res.status(201).json(await s.fuel.create(requireContext(req), fuelInputSchema.parse(req.body), req));
  });
  r.post('/fuel/:id/review', requirePermission('fuel:write'), async (req, res) => {
    res.json(await s.fuel.review(requireContext(req), idParamSchema.parse(req.params).id, note.parse(req.body).note, req));
  });

  // ------------------------------------------------------------------ invoices and receipts
  // Customers may read their own invoices; the service limits portal users to their customer.
  r.get('/invoices', requirePermission('finance:read', 'portal:access'), async (req, res) => {
    res.json(await s.invoices.list(requireContext(req), invoiceListQuerySchema.parse(req.query)));
  });
  r.get('/invoices/uninvoiced', read, async (req, res) => {
    const q = z.object({ customerId: idSchema.optional() }).parse(req.query);
    res.json({ data: await s.invoices.uninvoiced(requireContext(req), q.customerId) });
  });
  r.get('/invoices/:id', requirePermission('finance:read', 'portal:access'), async (req, res) => {
    res.json(await s.invoices.get(requireContext(req), idParamSchema.parse(req.params).id));
  });
  r.post('/invoices', post, async (req, res) => {
    res.status(201).json(await s.invoices.create(requireContext(req), invoiceCreateSchema.parse(req.body), req));
  });
  r.post('/invoices/:id/cancel', post, async (req, res) => {
    res.json(await s.invoices.cancel(requireContext(req), idParamSchema.parse(req.params).id, invoiceCancelSchema.parse(req.body).reason, req));
  });
  r.post('/invoices/:id/credit-notes', post, async (req, res) => {
    res.status(201).json(await s.invoices.creditNote(requireContext(req), idParamSchema.parse(req.params).id, creditNoteSchema.parse(req.body), req));
  });
  r.get('/receipts', read, async (req, res) => {
    res.json(await s.invoices.receipts(requireContext(req), page.parse(req.query)));
  });
  r.post('/receipts', post, async (req, res) => {
    res.status(201).json(await s.invoices.receive(requireContext(req), receiptCreateSchema.parse(req.body), req));
  });

  // ------------------------------------------------------------------ crew pay
  const crewRead = requirePermission('settlements:read', 'settlements:manage', 'settlements:read_own');
  const crewManage = requirePermission('settlements:manage');
  const crewQuery = z.object({ workerId: idSchema.optional(), tripId: idSchema.optional(), unsettled: z.enum(['true', 'false']).optional(), outstanding: z.enum(['true', 'false']).optional() });
  r.get('/crew/balances', requirePermission('settlements:read', 'settlements:manage'), async (req, res) => {
    res.json({ data: await s.crew.balances(requireContext(req)) });
  });
  r.get('/crew/earnings', crewRead, async (req, res) => {
    const q = crewQuery.parse(req.query);
    res.json({ data: await s.crew.earnings(requireContext(req), { workerId: q.workerId, tripId: q.tripId, unsettled: q.unsettled === 'true' }) });
  });
  r.get('/crew/advances', crewRead, async (req, res) => {
    const q = crewQuery.parse(req.query);
    res.json({ data: await s.crew.advances(requireContext(req), { workerId: q.workerId, outstanding: q.outstanding === 'true' }) });
  });
  r.post('/crew/advances', requirePermission('settlements:manage', 'finance:post'), async (req, res) => {
    res.status(201).json(await s.crew.giveAdvance(requireContext(req), advanceCreateSchema.parse(req.body), req));
  });
  r.get('/crew/deductions', crewRead, async (req, res) => {
    res.json({ data: await s.crew.deductions(requireContext(req), crewQuery.parse(req.query)) });
  });
  r.post('/crew/deductions', crewManage, async (req, res) => {
    res.status(201).json(await s.crew.addDeduction(requireContext(req), deductionCreateSchema.parse(req.body), req));
  });
  r.get('/settlements', crewRead, async (req, res) => {
    res.json(await s.crew.list(requireContext(req), settlementListQuerySchema.parse(req.query)));
  });
  r.get('/settlements/preview', crewManage, async (req, res) => {
    const q = settlementCreateSchema.parse(req.query);
    res.json((await s.crew.preview(requireContext(req), q.workerId, q.periodFrom, q.periodTo)).dto);
  });
  r.post('/settlements', crewManage, async (req, res) => {
    res.status(201).json(await s.crew.create(requireContext(req), settlementCreateSchema.parse(req.body), req));
  });
  r.get('/settlements/:id', crewRead, async (req, res) => {
    res.json(await s.crew.get(requireContext(req), idParamSchema.parse(req.params).id));
  });
  r.post('/settlements/:id/approve', requirePermission('settlements:manage', 'finance:approve'), async (req, res) => {
    res.json(await s.crew.approve(requireContext(req), idParamSchema.parse(req.params).id, req));
  });
  r.post('/settlements/:id/pay', crewManage, async (req, res) => {
    res.json(await s.crew.pay(requireContext(req), idParamSchema.parse(req.params).id, settlementPaySchema.parse(req.body), req));
  });
  r.post('/settlements/:id/cancel', crewManage, async (req, res) => {
    res.json(await s.crew.cancel(requireContext(req), idParamSchema.parse(req.params).id, reason.parse(req.body).reason, req));
  });
  return r;
}

export function reportRoutes(reports: ReportService): Router {
  const r = Router();
  r.get('/catalogue', requirePermission('reports:read'), (_req, res) => {
    res.json({ data: ['trip-profitability', ...REPORT_KEYS] });
  });
  r.get('/trip-profitability', requirePermission('reports:read'), async (req, res) => {
    const p = period(req.query);
    const f = z.object({ vehicleId: idSchema.optional(), customerId: idSchema.optional() }).parse(req.query);
    res.json({ data: await reports.tripProfitability(requireContext(req), p.from, p.to, f) });
  });
  r.get('/:key.csv', requirePermission('reports:export'), async (req, res) => {
    const p = period(req.query);
    const t = await reports.table(requireContext(req), String(req.params.key), p.from, p.to);
    res.setHeader('content-type', 'text/csv; charset=utf-8');
    res.setHeader('content-disposition', `attachment; filename="${req.params.key}-${p.from}-to-${p.to}.csv"`);
    // A byte-order mark makes Excel open the UTF-8 file (₹, names) correctly.
    res.send(`${String.fromCharCode(0xfeff)}${toCsv(t)}`);
  });
  r.get('/:key', requirePermission('reports:read'), async (req, res) => {
    const p = period(req.query);
    res.json(await reports.table(requireContext(req), String(req.params.key), p.from, p.to));
  });
  return r;
}
