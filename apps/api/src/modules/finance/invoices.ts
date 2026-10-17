import type { Request } from 'express';
import Big from 'big.js';
import { and, asc, count, desc, eq, gte, inArray, isNull, lt, lte, sql, type SQL } from 'drizzle-orm';
import type { z } from 'zod';
import { bookings, creditNotes, customers, invoiceLines, invoices, organizations, receiptAllocations, receipts, trips, type Db } from '@transaxis/database';
import { ageingBucket, addDays, computeInvoiceTax, sameGstState, type InvoiceDto, type Paginated, type ReceiptDto, type UninvoicedBookingDto } from '@transaxis/shared';
import type { creditNoteSchema, invoiceCreateSchema, invoiceListQuerySchema, receiptCreateSchema } from '@transaxis/shared';
import { audit } from '../../lib/audit.js';
import type { RequestContext } from '../../lib/context.js';
import { AppError } from '../../lib/errors.js';
import { paginated, parseSort } from '../../lib/http.js';
import { getOrgInfo, orgToday, orgYear } from '../../lib/org.js';
import { nextNumber } from '../../lib/sequences.js';
import type { LedgerService } from './ledger.js';

const money = (v: Big | string | number) => new Big(v).round(2, Big.roundHalfUp).toFixed(2);
const outstandingOf = (i: { total: string; paid: string; credited: string }) => new Big(i.total).minus(i.paid).minus(i.credited);
const statusFor = (i: { total: string; paid: string; credited: string }) => (outstandingOf(i).lte(0) ? 'paid' : new Big(i.paid).gt(0) || new Big(i.credited).gt(0) ? 'partially_paid' : 'issued');

export class InvoiceService {
  constructor(
    private readonly db: Db,
    private readonly ledger: LedgerService,
  ) {}

  /** Delivered, approved bookings that are not on an invoice yet. */
  async uninvoiced(ctx: RequestContext, customerId?: number): Promise<UninvoicedBookingDto[]> {
    const conds: SQL[] = [eq(bookings.orgId, ctx.orgId), eq(bookings.status, 'delivered'), sql`${bookings.approvedAmount} IS NOT NULL`, isNull(invoiceLines.id)];
    if (customerId) conds.push(eq(bookings.customerId, customerId));
    const rows = await this.db
      .select({ b: bookings, t: { id: trips.id, deliveredAt: trips.deliveredAt }, c: { id: customers.id, name: customers.name } })
      .from(bookings)
      .innerJoin(customers, eq(customers.id, bookings.customerId))
      .leftJoin(invoiceLines, eq(invoiceLines.bookingId, bookings.id))
      .leftJoin(trips, and(eq(trips.bookingId, bookings.id), sql`${trips.status} <> 'cancelled'`))
      .where(and(...conds))
      .orderBy(asc(trips.deliveredAt));
    return rows.map(({ b, t, c }) => ({
      bookingId: b.id,
      bookingNo: b.bookingNo,
      customer: c,
      lrNumber: b.lrNumber,
      customerRef: b.customerRef,
      originCity: b.originCity,
      destinationCity: b.destinationCity,
      deliveredAt: t?.deliveredAt?.toISOString() ?? null,
      amount: b.approvedAmount!,
      tripId: t?.id ?? null,
    }));
  }

  /** Customer-portal users only ever see their own customer's invoices. */
  private scope(ctx: RequestContext): SQL[] {
    const conds: SQL[] = [eq(invoices.orgId, ctx.orgId)];
    if (!ctx.permissions.has('finance:read')) {
      if (!ctx.permissions.has('portal:access') || !ctx.customerId) throw AppError.forbidden();
      conds.push(eq(invoices.customerId, ctx.customerId));
    }
    return conds;
  }

  async list(ctx: RequestContext, q: z.infer<typeof invoiceListQuerySchema>): Promise<Paginated<InvoiceDto> & { totals: { total: string; outstanding: string } }> {
    const org = await getOrgInfo(this.db, ctx.orgId);
    const conds = this.scope(ctx);
    if (q.status === 'open') conds.push(inArray(invoices.status, ['issued', 'partially_paid']));
    else if (q.status === 'overdue') conds.push(inArray(invoices.status, ['issued', 'partially_paid']), lt(invoices.dueDate, orgToday(org)));
    else if (q.status) conds.push(eq(invoices.status, q.status as 'issued'));
    if (q.customerId) conds.push(eq(invoices.customerId, q.customerId));
    if (q.from) conds.push(gte(invoices.invoiceDate, q.from));
    if (q.to) conds.push(lte(invoices.invoiceDate, q.to));
    if (q.q) conds.push(sql`(${invoices.invoiceNo} LIKE ${`%${q.q}%`} OR ${customers.name} LIKE ${`%${q.q}%`})`);
    const where = and(...conds);
    const cols = { invoiceDate: invoices.invoiceDate, dueDate: invoices.dueDate, invoiceNo: invoices.invoiceNo, total: invoices.total } as const;
    const sort = parseSort<keyof typeof cols>(q.sort, 'invoiceDate');
    const descending = q.sort ? sort.desc : true;
    const [[agg], rows] = await Promise.all([
      this.db
        .select({
          n: count(),
          total: sql<string>`COALESCE(SUM(${invoices.total}), 0)`,
          out: sql<string>`COALESCE(SUM(CASE WHEN ${invoices.status} IN ('issued', 'partially_paid') THEN ${invoices.total} - ${invoices.paid} - ${invoices.credited} ELSE 0 END), 0)`,
        })
        .from(invoices)
        .innerJoin(customers, eq(customers.id, invoices.customerId))
        .where(where),
      this.db
        .select({ i: invoices, c: customers })
        .from(invoices)
        .innerJoin(customers, eq(customers.id, invoices.customerId))
        .where(where)
        .orderBy(descending ? desc(cols[sort.field]) : asc(cols[sort.field]), desc(invoices.id))
        .limit(q.pageSize)
        .offset((q.page - 1) * q.pageSize),
    ]);
    const today = orgToday(org);
    return {
      ...paginated(rows.map(({ i, c }) => this.dto(i, c, [], [], [], today)), q.page, q.pageSize, Number(agg?.n ?? 0)),
      totals: { total: money(agg?.total ?? 0), outstanding: money(agg?.out ?? 0) },
    };
  }

  async get(ctx: RequestContext, id: number): Promise<InvoiceDto> {
    const conds = [eq(invoices.id, id), ...this.scope(ctx)];
    const [row] = await this.db.select({ i: invoices, c: customers }).from(invoices).innerJoin(customers, eq(customers.id, invoices.customerId)).where(and(...conds));
    if (!row) throw AppError.notFound('Invoice');
    const [lines, notes, allocs] = await Promise.all([
      this.db
        .select({ l: invoiceLines, b: { bookingNo: bookings.bookingNo, lrNumber: bookings.lrNumber } })
        .from(invoiceLines)
        .leftJoin(bookings, eq(bookings.id, invoiceLines.bookingId))
        .where(eq(invoiceLines.invoiceId, id))
        .orderBy(asc(invoiceLines.id)),
      this.db.select().from(creditNotes).where(eq(creditNotes.invoiceId, id)).orderBy(asc(creditNotes.id)),
      this.db
        .select({ a: receiptAllocations, r: { receiptNo: receipts.receiptNo, receivedOn: receipts.receivedOn } })
        .from(receiptAllocations)
        .innerJoin(receipts, eq(receipts.id, receiptAllocations.receiptId))
        .where(eq(receiptAllocations.invoiceId, id))
        .orderBy(asc(receiptAllocations.id)),
    ]);
    return this.dto(row.i, row.c, lines, notes, allocs, orgToday(await getOrgInfo(this.db, ctx.orgId)));
  }

  async create(ctx: RequestContext, input: z.infer<typeof invoiceCreateSchema>, req: Request): Promise<InvoiceDto> {
    const org = await getOrgInfo(this.db, ctx.orgId);
    const [c] = await this.db.select().from(customers).where(and(eq(customers.id, input.customerId), eq(customers.orgId, ctx.orgId)));
    if (!c) throw AppError.validation('Unknown customer', [{ path: 'customerId', message: 'Customer not found' }]);
    const [orgRow] = await this.db.select({ gstin: organizations.gstin, state: organizations.state }).from(organizations).where(eq(organizations.id, ctx.orgId));
    const intraState = c.gstin ? sameGstState(orgRow?.gstin, c.gstin) : !!c.state && c.state === orgRow?.state;
    const invoiceDate = input.invoiceDate ?? orgToday(org);
    const id = await this.db.transaction(async (tx) => {
      const lines: { bookingId: number | null; tripId: number | null; description: string; amount: string }[] = [];
      if (input.bookingIds.length) {
        const rows = await tx
          .select({ b: bookings, t: { id: trips.id } })
          .from(bookings)
          .leftJoin(trips, and(eq(trips.bookingId, bookings.id), sql`${trips.status} <> 'cancelled'`))
          .where(and(eq(bookings.orgId, ctx.orgId), inArray(bookings.id, input.bookingIds)))
          .for('update');
        for (const bid of input.bookingIds) {
          const r = rows.find((x) => x.b.id === bid);
          if (!r) throw AppError.validation('Unknown booking', [{ path: 'bookingIds', message: `Booking ${bid} not found` }]);
          if (r.b.customerId !== c.id) throw AppError.businessRule(`${r.b.bookingNo} belongs to another customer`);
          if (r.b.status !== 'delivered') throw AppError.businessRule(`${r.b.bookingNo} is ${r.b.status.replace('_', ' ')}; only delivered bookings can be invoiced`);
          if (!r.b.approvedAmount) throw AppError.businessRule(`${r.b.bookingNo} has no approved amount`);
          lines.push({ bookingId: r.b.id, tripId: r.t?.id ?? null, description: `Freight ${r.b.originCity} to ${r.b.destinationCity}, ${r.b.bookingNo}${r.b.lrNumber ? `, LR ${r.b.lrNumber}` : ''}${r.b.customerRef ? `, PO ${r.b.customerRef}` : ''}`, amount: r.b.approvedAmount });
        }
      }
      for (const x of input.extraLines) lines.push({ bookingId: null, tripId: null, description: x.description, amount: money(x.amount) });
      const taxable = lines.reduce((s, l) => s.plus(l.amount), new Big(0));
      const tax = computeInvoiceTax(taxable.toFixed(2), input.gstMode, intraState);
      const invoiceNo = await nextNumber(tx, ctx.orgId, 'INV', orgYear(org, new Date(`${invoiceDate}T12:00:00Z`)));
      const [row] = await tx
        .insert(invoices)
        .values({
          orgId: ctx.orgId,
          invoiceNo,
          customerId: c.id,
          invoiceDate,
          dueDate: addDays(invoiceDate, c.paymentTermsDays),
          gstMode: input.gstMode,
          placeOfSupply: c.state ?? null,
          intraState,
          taxable: tax.taxable,
          cgst: tax.cgst,
          sgst: tax.sgst,
          igst: tax.igst,
          reverseChargeTax: tax.reverseChargeTax,
          total: tax.total,
          notes: input.notes ?? null,
          createdBy: ctx.userId,
        })
        .$returningId();
      const invoiceId = row!.id;
      try {
        await tx.insert(invoiceLines).values(lines.map((l) => ({ invoiceId, ...l })));
      } catch (err) {
        if (JSON.stringify(err).includes('ER_DUP_ENTRY') || (err as { cause?: { code?: string } }).cause?.code === 'ER_DUP_ENTRY') {
          throw AppError.conflict('One of these bookings was invoiced a moment ago. Reload and try again.');
        }
        throw err;
      }
      if (input.bookingIds.length) await tx.update(bookings).set({ status: 'invoiced', version: sql`${bookings.version} + 1` }).where(inArray(bookings.id, input.bookingIds));
      const entry = await this.ledger.post(tx, {
        orgId: ctx.orgId,
        date: invoiceDate,
        memo: `Invoice ${invoiceNo} to ${c.name}`,
        source: 'invoice',
        sourceId: invoiceId,
        idempotencyKey: `invoice:${invoiceId}`,
        userId: ctx.userId,
        lines: [
          { account: 'receivables', debit: tax.total, customerId: c.id },
          ...lines.map((l) => ({ account: 'freight_income' as const, credit: l.amount, tripId: l.tripId, customerId: c.id, memo: l.description })),
          { account: 'gst_output', credit: tax.taxOnInvoice, customerId: c.id },
        ],
      });
      await tx.update(invoices).set({ journalEntryId: entry }).where(eq(invoices.id, invoiceId));
      await audit(tx, req, { action: 'invoice.issued', entityType: 'invoice', entityId: invoiceId, summary: `${invoiceNo} ${c.name}: ₹${tax.total}` });
      return invoiceId;
    });
    return this.get(ctx, id);
  }

  /** Cancels an unpaid invoice: reverses its posting and frees its bookings for re-invoicing. */
  async cancel(ctx: RequestContext, id: number, reason: string, req: Request): Promise<InvoiceDto> {
    await this.db.transaction(async (tx) => {
      const [i] = await tx.select().from(invoices).where(and(eq(invoices.id, id), eq(invoices.orgId, ctx.orgId))).for('update');
      if (!i) throw AppError.notFound('Invoice');
      if (i.status === 'cancelled') throw AppError.businessRule('Already cancelled');
      if (new Big(i.paid).gt(0) || new Big(i.credited).gt(0)) throw AppError.businessRule('Payments or credit notes exist; issue a credit note instead of cancelling');
      const lines = await tx.select().from(invoiceLines).where(eq(invoiceLines.invoiceId, id));
      const bookingIds = lines.map((l) => l.bookingId).filter((b): b is number => !!b);
      if (bookingIds.length) {
        await tx.update(bookings).set({ status: 'delivered', version: sql`${bookings.version} + 1` }).where(inArray(bookings.id, bookingIds));
        await tx.update(invoiceLines).set({ bookingId: null }).where(eq(invoiceLines.invoiceId, id));
      }
      await tx.update(invoices).set({ status: 'cancelled', cancelReason: reason, version: sql`${invoices.version} + 1` }).where(eq(invoices.id, id));
      if (i.journalEntryId) await this.ledger.reverse(tx, ctx.orgId, i.journalEntryId, `invoice ${i.invoiceNo} cancelled: ${reason}`, ctx.userId);
      await audit(tx, req, { action: 'invoice.cancelled', entityType: 'invoice', entityId: id, summary: `${i.invoiceNo}: ${reason}` });
    });
    return this.get(ctx, id);
  }

  async creditNote(ctx: RequestContext, id: number, input: z.infer<typeof creditNoteSchema>, req: Request): Promise<InvoiceDto> {
    const org = await getOrgInfo(this.db, ctx.orgId);
    await this.db.transaction(async (tx) => {
      const [i] = await tx.select().from(invoices).where(and(eq(invoices.id, id), eq(invoices.orgId, ctx.orgId))).for('update');
      if (!i) throw AppError.notFound('Invoice');
      if (i.status === 'cancelled') throw AppError.businessRule('The invoice is cancelled');
      const tax = computeInvoiceTax(input.taxable.toFixed(2), i.gstMode, i.intraState);
      if (new Big(tax.total).gt(outstandingOf(i))) {
        throw AppError.validation(`A credit cannot exceed the ₹${money(outstandingOf(i))} still outstanding`, [{ path: 'taxable', message: 'Too large' }]);
      }
      const noteNo = await nextNumber(tx, ctx.orgId, 'CN', orgYear(org));
      const [row] = await tx
        .insert(creditNotes)
        .values({ orgId: ctx.orgId, noteNo, invoiceId: id, noteDate: orgToday(org), reason: input.reason, taxable: tax.taxable, tax: tax.taxOnInvoice, total: tax.total, createdBy: ctx.userId })
        .$returningId();
      const credited = money(new Big(i.credited).plus(tax.total));
      await tx.update(invoices).set({ credited, status: statusFor({ ...i, credited }), version: sql`${invoices.version} + 1` }).where(eq(invoices.id, id));
      const entry = await this.ledger.post(tx, {
        orgId: ctx.orgId,
        memo: `Credit note ${noteNo} against ${i.invoiceNo}: ${input.reason}`,
        source: 'credit_note',
        sourceId: row!.id,
        idempotencyKey: `credit_note:${row!.id}`,
        userId: ctx.userId,
        lines: [
          { account: 'freight_income', debit: tax.taxable, customerId: i.customerId },
          { account: 'gst_output', debit: tax.taxOnInvoice, customerId: i.customerId },
          { account: 'receivables', credit: tax.total, customerId: i.customerId },
        ],
      });
      await tx.update(creditNotes).set({ journalEntryId: entry }).where(eq(creditNotes.id, row!.id));
      await audit(tx, req, { action: 'invoice.credit_note', entityType: 'invoice', entityId: id, summary: `${noteNo} ₹${tax.total}: ${input.reason}` });
    });
    return this.get(ctx, id);
  }

  // ------------------------------------------------------------------ receipts

  async receipts(ctx: RequestContext, q: { customerId?: number; page: number; pageSize: number }): Promise<Paginated<ReceiptDto>> {
    const conds: SQL[] = [eq(receipts.orgId, ctx.orgId)];
    if (q.customerId) conds.push(eq(receipts.customerId, q.customerId));
    const where = and(...conds);
    const [[total], rows] = await Promise.all([
      this.db.select({ n: count() }).from(receipts).where(where),
      this.db
        .select({ r: receipts, c: { id: customers.id, name: customers.name } })
        .from(receipts)
        .innerJoin(customers, eq(customers.id, receipts.customerId))
        .where(where)
        .orderBy(desc(receipts.receivedOn), desc(receipts.id))
        .limit(q.pageSize)
        .offset((q.page - 1) * q.pageSize),
    ]);
    const allocs = rows.length
      ? await this.db
          .select({ a: receiptAllocations, invoiceNo: invoices.invoiceNo })
          .from(receiptAllocations)
          .innerJoin(invoices, eq(invoices.id, receiptAllocations.invoiceId))
          .where(inArray(receiptAllocations.receiptId, rows.map((r) => r.r.id)))
      : [];
    return paginated(
      rows.map(({ r, c }) => ({
        id: r.id,
        receiptNo: r.receiptNo,
        customer: c,
        receivedOn: r.receivedOn,
        mode: r.mode,
        reference: r.reference,
        amount: r.amount,
        tdsAmount: r.tdsAmount,
        unallocated: r.unallocated,
        allocations: allocs.filter((a) => a.a.receiptId === r.id).map((a) => ({ invoiceId: a.a.invoiceId, invoiceNo: a.invoiceNo, amount: a.a.amount })),
        notes: r.notes,
        createdAt: r.createdAt.toISOString(),
      })),
      q.page,
      q.pageSize,
      Number(total?.n ?? 0),
    );
  }

  /** Records money received (plus TDS deducted) and settles invoices, oldest due first unless told otherwise. */
  async receive(ctx: RequestContext, input: z.infer<typeof receiptCreateSchema>, req: Request): Promise<ReceiptDto> {
    const org = await getOrgInfo(this.db, ctx.orgId);
    const [c] = await this.db.select().from(customers).where(and(eq(customers.id, input.customerId), eq(customers.orgId, ctx.orgId)));
    if (!c) throw AppError.validation('Unknown customer', [{ path: 'customerId', message: 'Customer not found' }]);
    const settleTotal = new Big(input.amount).plus(input.tdsAmount);
    const id = await this.db.transaction(async (tx) => {
      const open = await tx
        .select()
        .from(invoices)
        .where(and(eq(invoices.orgId, ctx.orgId), eq(invoices.customerId, c.id), inArray(invoices.status, ['issued', 'partially_paid'])))
        .orderBy(asc(invoices.dueDate), asc(invoices.id))
        .for('update');
      const plan: { invoiceId: number; amount: Big }[] = [];
      if (input.allocations?.length) {
        for (const a of input.allocations) {
          const inv = open.find((i) => i.id === a.invoiceId);
          if (!inv) throw AppError.validation('That invoice is not open for this customer', [{ path: 'allocations', message: `Invoice ${a.invoiceId} not open` }]);
          if (new Big(a.amount).gt(outstandingOf(inv))) throw AppError.validation(`${inv.invoiceNo} has only ₹${money(outstandingOf(inv))} outstanding`, [{ path: 'allocations', message: 'Too much' }]);
          plan.push({ invoiceId: inv.id, amount: new Big(a.amount) });
        }
      } else {
        let left = settleTotal;
        for (const inv of open) {
          if (left.lte(0)) break;
          const take = outstandingOf(inv).gt(left) ? left : outstandingOf(inv);
          if (take.gt(0)) plan.push({ invoiceId: inv.id, amount: take });
          left = left.minus(take);
        }
      }
      const allocated = plan.reduce((s, p) => s.plus(p.amount), new Big(0));
      if (allocated.gt(settleTotal)) throw AppError.validation('Allocations exceed the amount received plus TDS', [{ path: 'allocations', message: 'Too much' }]);
      const receiptNo = await nextNumber(tx, ctx.orgId, 'RCP', orgYear(org, new Date(`${input.receivedOn}T12:00:00Z`)));
      const [row] = await tx
        .insert(receipts)
        .values({
          orgId: ctx.orgId,
          receiptNo,
          customerId: c.id,
          receivedOn: input.receivedOn,
          mode: input.mode,
          reference: input.reference ?? null,
          amount: money(input.amount),
          tdsAmount: money(input.tdsAmount),
          unallocated: money(settleTotal.minus(allocated)),
          notes: input.notes ?? null,
          createdBy: ctx.userId,
        })
        .$returningId();
      for (const p of plan) {
        const inv = open.find((i) => i.id === p.invoiceId)!;
        const paid = money(new Big(inv.paid).plus(p.amount));
        await tx.insert(receiptAllocations).values({ receiptId: row!.id, invoiceId: inv.id, amount: money(p.amount) });
        await tx.update(invoices).set({ paid, status: statusFor({ ...inv, paid }), version: sql`${invoices.version} + 1` }).where(eq(invoices.id, inv.id));
      }
      const entry = await this.ledger.post(tx, {
        orgId: ctx.orgId,
        date: input.receivedOn,
        memo: `Receipt ${receiptNo} from ${c.name}${input.reference ? ` (${input.reference})` : ''}`,
        source: 'receipt',
        sourceId: row!.id,
        idempotencyKey: `receipt:${row!.id}`,
        userId: ctx.userId,
        lines: [
          { account: input.mode === 'cash' ? 'cash' : 'bank', debit: input.amount, customerId: c.id },
          { account: 'tds_receivable', debit: input.tdsAmount, customerId: c.id },
          { account: 'receivables', credit: settleTotal, customerId: c.id },
        ],
      });
      await tx.update(receipts).set({ journalEntryId: entry }).where(eq(receipts.id, row!.id));
      await audit(tx, req, { action: 'receipt.recorded', entityType: 'receipt', entityId: row!.id, summary: `${receiptNo} ${c.name}: ₹${money(input.amount)}${input.tdsAmount ? ` + TDS ₹${money(input.tdsAmount)}` : ''}` });
      return row!.id;
    });
    return (await this.receipts(ctx, { customerId: c.id, page: 1, pageSize: 100 })).data.find((r) => r.id === id)!;
  }

  private dto(
    i: typeof invoices.$inferSelect,
    c: typeof customers.$inferSelect,
    lines: { l: typeof invoiceLines.$inferSelect; b: { bookingNo: string | null; lrNumber: string | null } | null }[],
    notes: (typeof creditNotes.$inferSelect)[],
    allocs: { a: typeof receiptAllocations.$inferSelect; r: { receiptNo: string; receivedOn: string } }[],
    today: string,
  ): InvoiceDto {
    const outstanding = i.status === 'cancelled' ? new Big(0) : outstandingOf(i);
    return {
      id: i.id,
      invoiceNo: i.invoiceNo,
      customer: { id: c.id, name: c.name, code: c.code, gstin: c.gstin, billingAddress: c.billingAddress, city: c.city, state: c.state },
      invoiceDate: i.invoiceDate,
      dueDate: i.dueDate,
      gstMode: i.gstMode,
      intraState: i.intraState,
      placeOfSupply: i.placeOfSupply,
      taxable: i.taxable,
      cgst: i.cgst,
      sgst: i.sgst,
      igst: i.igst,
      reverseChargeTax: i.reverseChargeTax,
      total: i.total,
      paid: i.paid,
      credited: i.credited,
      outstanding: money(outstanding),
      status: i.status,
      ageing: outstanding.gt(0) ? ageingBucket(i.dueDate, today) : { bucket: 'current', daysOverdue: 0 },
      lines: lines.map(({ l, b }) => ({ id: l.id, bookingId: l.bookingId, bookingNo: b?.bookingNo ?? null, lrNumber: b?.lrNumber ?? null, tripId: l.tripId, description: l.description, sac: l.sac, amount: l.amount })),
      creditNotes: notes.map((n) => ({ id: n.id, noteNo: n.noteNo, noteDate: n.noteDate, reason: n.reason, total: n.total })),
      allocations: allocs.map(({ a, r }) => ({ receiptId: a.receiptId, receiptNo: r.receiptNo, receivedOn: r.receivedOn, amount: a.amount })),
      notes: i.notes,
      cancelReason: i.cancelReason,
      createdAt: i.createdAt.toISOString(),
    };
  }
}
