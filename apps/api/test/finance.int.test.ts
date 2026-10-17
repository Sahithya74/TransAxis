import Big from 'big.js';
import { and, eq, sql } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hashPassword, journalEntries, journalLines, ledgerAccounts, organizations, roles, spareParts, userRoles, users, vehicles } from '@transaxis/database';
import type { BookingListItemDto, ExpenseDto, InvoiceDto, SettlementDto, TripListItemDto, UninvoicedBookingDto, VehicleDto, WorkOrderDto } from '@transaxis/shared';
import { bearer, createTestApp, DEMO_PASSWORD, hasDb, login, type LoggedIn, type TestApp } from './helpers.js';

const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());

describe.skipIf(!hasDb)('finance, maintenance and reports (integration)', () => {
  let t: TestApp;
  let finance: LoggedIn;
  let dispatch: LoggedIn;
  let driver: LoggedIn;
  let maint: LoggedIn;
  let owner: LoggedIn;
  let customer: LoggedIn;
  let otherOrg: LoggedIn;

  beforeAll(async () => {
    t = createTestApp();
    [finance, dispatch, driver, maint, owner, customer, otherOrg] = (await Promise.all(
      ['finance@kaveri.demo', 'dispatch@kaveri.demo', 'driver@kaveri.demo', 'maintenance@kaveri.demo', 'owner@kaveri.demo', 'customer@kaveri.demo', 'owner@sahyadri.demo'].map((e) => login(t.app, e)),
    )) as LoggedIn[] as [LoggedIn, LoggedIn, LoggedIn, LoggedIn, LoggedIn, LoggedIn, LoggedIn];
  });
  afterAll(async () => {
    await t.close();
  });

  const get = (token: string, path: string, query: Record<string, unknown> = {}) => request(t.app).get(`/api/v1${path}`).query(query).set(bearer(token));
  const post = (token: string, path: string, body: unknown = {}) => request(t.app).post(`/api/v1${path}`).set(bearer(token)).send(body as object);

  describe('ledger', () => {
    it('keeps the books balanced after seeding', async () => {
      const tb = await get(finance.token, '/finance/trial-balance');
      expect(tb.status).toBe(200);
      const debit = tb.body.data.reduce((s: Big, r: { debit: string }) => s.plus(r.debit), new Big(0));
      const credit = tb.body.data.reduce((s: Big, r: { credit: string }) => s.plus(r.credit), new Big(0));
      expect(debit.gt(0)).toBe(true);
      expect(debit.eq(credit)).toBe(true);
    });

    it('refuses to edit or delete posted journal lines', async () => {
      const [line] = await t.handle.db.select().from(journalLines).limit(1);
      const blocked = { cause: expect.objectContaining({ message: expect.stringMatching(/append-only/) }) };
      await expect(t.handle.db.update(journalLines).set({ debit: '1.00' }).where(eq(journalLines.id, line!.id))).rejects.toMatchObject(blocked);
      await expect(t.handle.db.delete(journalLines).where(eq(journalLines.id, line!.id))).rejects.toMatchObject(blocked);
    });

    it('keeps the books to finance roles and to their own organisation', async () => {
      expect((await get(driver.token, '/finance/trial-balance')).status).toBe(403);
      const theirs = await get(otherOrg.token, '/finance/trial-balance');
      expect(theirs.status).toBe(200);
      const ours = new Set((await t.handle.db.select({ id: ledgerAccounts.id }).from(ledgerAccounts).where(eq(ledgerAccounts.orgId, finance.body.organization.id))).map((a) => a.id));
      expect(theirs.body.data.length).toBeGreaterThan(0);
      expect(theirs.body.data.some((a: { id: number }) => ours.has(a.id))).toBe(false);
    });
  });

  describe('expenses', () => {
    let myTrip: TripListItemDto;
    beforeAll(async () => {
      myTrip = (await get(driver.token, '/trips', { status: 'in_transit' })).body.data[0];
    });
    const category = async (name: string) => ((await get(finance.token, '/finance/expense-categories')).body.data as { id: number; name: string }[]).find((c) => c.name === name)!;

    it('lets a driver claim on their own trip only, and finance approve it into the ledger', async () => {
      const food = await category('Driver food and stay');
      const claim = await post(driver.token, '/finance/expenses', { categoryId: food.id, tripId: myTrip.id, expenseDate: today(), amount: 640, paymentMode: 'driver_paid', description: 'Dinner at Vellore' });
      expect(claim.status).toBe(201);
      const e = claim.body as ExpenseDto;
      expect(e).toMatchObject({ status: 'submitted', amount: '640.00', worker: { id: myTrip.driver.id }, trip: { id: myTrip.id } });

      const others = (await get(dispatch.token, '/trips', { status: 'in_transit' })).body.data as TripListItemDto[];
      const notMine = others.find((x) => x.id !== myTrip.id)!;
      expect((await post(driver.token, '/finance/expenses', { categoryId: food.id, tripId: notMine.id, expenseDate: today(), amount: 100, paymentMode: 'driver_paid', description: 'Not my trip' })).status).toBe(403);

      expect((await post(dispatch.token, `/finance/expenses/${e.id}/decision`, { decision: 'approve' })).status).toBe(403);
      expect((await post(finance.token, `/finance/expenses/${e.id}/decision`, { decision: 'reject' })).status).toBe(400);
      const ok = await post(finance.token, `/finance/expenses/${e.id}/decision`, { decision: 'approve' });
      expect(ok.body.status).toBe('approved');
      const [entry] = await t.handle.db.select().from(journalEntries).where(and(eq(journalEntries.sourceType, 'expense'), eq(journalEntries.sourceId, e.id)));
      const lines = await t.handle.db.select().from(journalLines).where(eq(journalLines.entryId, entry!.id));
      expect(lines.map((l) => [l.debit, l.credit])).toEqual(expect.arrayContaining([['640.00', '0.00'], ['0.00', '640.00']]));
      expect(lines.every((l) => l.tripId === myTrip.id)).toBe(true);
      expect((await post(finance.token, `/finance/expenses/${e.id}/decision`, { decision: 'approve' })).status).toBe(422);
    });

    it('requires receipts above the category threshold', async () => {
      const fine = await category('Fines and challans');
      const res = await post(finance.token, '/finance/expenses', { categoryId: fine.id, tripId: myTrip.id, expenseDate: today(), amount: 500, paymentMode: 'cash', description: 'Challan' });
      expect(res.status).toBe(400);
      expect(res.body.error.details[0].path).toBe('receiptFileId');
    });
  });

  describe('fuel', () => {
    it('computes mileage, flags pilferage and tells maintenance', async () => {
      const fleet = (await get(maint.token, '/vehicles', { pageSize: 100, status: 'available' })).body.data as VehicleDto[];
      const v = fleet[0]!;
      const odo = Number((await t.handle.db.select().from(vehicles).where(eq(vehicles.id, v.id)))[0]!.odometerKm);
      const fill = (km: number, litres: number, minutesAgo: number) =>
        post(maint.token, '/finance/fuel', { vehicleId: v.id, filledAt: new Date(Date.now() - minutesAgo * 60_000).toISOString(), odometerKm: km, litres, pricePerLitre: 92.5, paymentMode: 'fuel_card', fullTank: true });
      const first = await fill(odo + 10, 150, 120);
      expect(first.status).toBe(201);
      const second = await fill(odo + 310, 160, 60); // 300 km on 160 L ≈ 1.9 km/L
      expect(second.body.kmpl).toBeCloseTo(1.88, 1);
      expect(second.body.anomaly).toBe(true);
      expect(second.body.anomalyReasons[0]).toMatch(/below the usual/);
      expect(second.body.amount).toBe('14800.00');
      const notes = (await get(maint.token, '/notifications', { pageSize: 50 })).body.data as { title: string }[];
      expect(notes.some((n) => n.title === `Fuel anomaly on ${v.registrationNo}`)).toBe(true);
      expect((await fill(odo - 5000, 50, 30)).body.anomalyReasons.join(' ')).toMatch(/below the previous fill/);
      expect((await post(maint.token, '/finance/fuel', { vehicleId: v.id, filledAt: new Date().toISOString(), odometerKm: odo + 400, litres: 20, pricePerLitre: 92, paymentMode: 'driver_paid' })).status).toBe(400);
    });
  });

  describe('invoicing and collections', () => {
    let invoice: InvoiceDto;
    it('invoices delivered bookings with GST and blocks double billing', async () => {
      const open = (await get(finance.token, '/finance/invoices/uninvoiced')).body.data as UninvoicedBookingDto[];
      expect(open.length).toBeGreaterThan(0);
      const booking = open[0]!;
      const customerId = (await get(finance.token, `/bookings/${booking.bookingId}`)).body.customer.id;
      const res = await post(finance.token, '/finance/invoices', { customerId, gstMode: 'forward_12', bookingIds: [booking.bookingId], extraLines: [{ description: 'Detention 6 h', amount: 1500 }] });
      expect(res.status).toBe(201);
      invoice = res.body;
      const taxable = new Big(booking.amount).plus(1500);
      expect(invoice.taxable).toBe(taxable.toFixed(2));
      const tax = new Big(invoice.cgst).plus(invoice.sgst).plus(invoice.igst);
      expect(tax.toFixed(2)).toBe(taxable.times(0.12).round(2, Big.roundHalfUp).toFixed(2));
      expect(invoice.total).toBe(taxable.plus(tax).toFixed(2));
      expect((await get(finance.token, `/bookings/${booking.bookingId}`)).body.status).toBe('invoiced');
      expect((await post(finance.token, '/finance/invoices', { customerId, gstMode: 'rcm_5', bookingIds: [booking.bookingId] })).status).toBe(422);
    });

    it('settles invoices with receipts and TDS, oldest first, and limits credit notes', async () => {
      const half = new Big(invoice.total).div(2).round(2);
      const res = await post(finance.token, '/finance/receipts', { customerId: invoice.customer.id, receivedOn: today(), mode: 'bank', reference: 'UTR123', amount: half.minus(200).toFixed(2), tdsAmount: 200, allocations: [{ invoiceId: invoice.id, amount: half.toFixed(2) }] });
      expect(res.status).toBe(201);
      const after = (await get(finance.token, `/finance/invoices/${invoice.id}`)).body as InvoiceDto;
      expect(after).toMatchObject({ status: 'partially_paid', paid: half.toFixed(2) });
      expect(after.outstanding).toBe(new Big(invoice.total).minus(half).toFixed(2));
      expect((await post(finance.token, `/finance/invoices/${invoice.id}/cancel`, { reason: 'Raised by mistake' })).status).toBe(422);
      expect((await post(finance.token, `/finance/invoices/${invoice.id}/credit-notes`, { taxable: Number(invoice.taxable), reason: 'Too much credit' })).status).toBe(400);
      const cn = await post(finance.token, `/finance/invoices/${invoice.id}/credit-notes`, { taxable: 1000, reason: 'Short delivery of 2 cartons' });
      expect(cn.status).toBe(201);
      expect(cn.body.credited).toBe('1120.00');
    });

    it('shows customers only their own invoices', async () => {
      const mine = await get(customer.token, '/finance/invoices', { pageSize: 100 });
      expect(mine.status).toBe(200);
      const customerId = (await get(customer.token, '/portal/summary')).body.customer.id;
      expect(mine.body.data.every((i: InvoiceDto) => i.customer.id === customerId)).toBe(true);
      const someoneElse = (await get(finance.token, '/finance/invoices', { pageSize: 100 })).body.data.find((i: InvoiceDto) => i.customer.id !== customerId);
      expect((await get(customer.token, `/finance/invoices/${someoneElse.id}`)).status).toBe(404);
      expect((await get(customer.token, '/finance/receipts')).status).toBe(403);
    });
  });

  describe('crew pay', () => {
    it('settles a driver’s unsettled pay, recovers advances, and pays once', async () => {
      const balances = (await get(finance.token, '/finance/crew/balances')).body.data as { worker: { id: number }; unsettledEarnings: string }[];
      const who = balances.find((b) => Number(b.unsettledEarnings) > 0)!;
      await post(finance.token, '/finance/crew/advances', { workerId: who.worker.id, givenOn: today(), amount: 500, mode: 'cash', purpose: 'Test advance' });
      const preview = await get(finance.token, '/finance/settlements/preview', { workerId: who.worker.id, periodFrom: '2026-01-01', periodTo: today() });
      expect(preview.status).toBe(200);
      const p = preview.body as SettlementDto;
      expect(new Big(p.earnings).plus(p.reimbursements).minus(p.deductions).minus(p.advancesRecovered).toFixed(2)).toBe(p.net);
      const created = await post(finance.token, '/finance/settlements', { workerId: who.worker.id, periodFrom: '2026-01-01', periodTo: today() });
      expect(created.status).toBe(201);
      const s = created.body as SettlementDto;
      expect(s).toMatchObject({ status: 'draft', net: p.net });
      expect((await post(finance.token, '/finance/settlements', { workerId: who.worker.id, periodFrom: '2026-01-01', periodTo: today() })).status).toBe(422);
      expect((await post(finance.token, `/finance/settlements/${s.id}/pay`, { paidOn: today(), mode: 'bank' })).status).toBe(422);
      await post(owner.token, `/finance/settlements/${s.id}/approve`);
      const paid = await post(finance.token, `/finance/settlements/${s.id}/pay`, { paidOn: today(), mode: 'bank', reference: 'NEFT1' });
      expect(paid.body.status).toBe('paid');
      const [entry] = await t.handle.db.select().from(journalEntries).where(and(eq(journalEntries.sourceType, 'settlement'), eq(journalEntries.sourceId, s.id!)));
      expect(entry).toBeDefined();
    });

    it('lets drivers see only their own pay', async () => {
      const own = await get(driver.token, '/finance/crew/earnings');
      expect(own.status).toBe(200);
      const ids = new Set(own.body.data.map((e: { worker: { id: number } }) => e.worker.id));
      expect(ids.size).toBeLessThanOrEqual(1);
      const someone = ((await get(finance.token, '/finance/crew/balances')).body.data as { worker: { id: number } }[]).find((b) => !ids.has(b.worker.id))!;
      expect((await get(driver.token, '/finance/crew/earnings', { workerId: someone.worker.id })).status).toBe(403);
      expect((await get(driver.token, '/finance/crew/balances')).status).toBe(403);
    });
  });

  describe('maintenance', () => {
    it('issues parts from stock, takes the vehicle off the road and books the cost on completion', async () => {
      const fleet = (await get(maint.token, '/vehicles', { pageSize: 100, status: 'available' })).body.data as VehicleDto[];
      const v = fleet[1]!;
      const part = ((await get(maint.token, '/maintenance/parts')).body.data as { id: number; partNo: string; stockQty: number }[]).find((p) => p.partNo === 'OF-1132')!;
      const wo = (await post(maint.token, '/maintenance/work-orders', { vehicleId: v.id, woType: 'preventive', title: 'Oil change' })).body as WorkOrderDto;
      expect(wo.woNo).toMatch(/^WO-\d{4}-\d{6}$/);
      const withItems = await post(maint.token, `/maintenance/work-orders/${wo.id}/items`, { kind: 'part', partId: part.id, description: 'Oil filter', quantity: 2, unitCost: 0 });
      expect(withItems.body.partsCost).toBe('1280.00');
      await post(maint.token, `/maintenance/work-orders/${wo.id}/items`, { kind: 'labour', description: 'Labour', quantity: 1, unitCost: 900 });
      const [stock] = await t.handle.db.select().from(spareParts).where(eq(spareParts.id, part.id));
      expect(Number(stock!.stockQty)).toBe(part.stockQty - 2);

      expect((await post(maint.token, `/maintenance/work-orders/${wo.id}/actions`, { action: 'start' })).body.status).toBe('in_progress');
      expect((await get(maint.token, `/vehicles/${v.id}`)).body.status).toBe('under_maintenance');
      expect((await post(maint.token, `/maintenance/work-orders/${wo.id}/actions`, { action: 'complete' })).status).toBe(400);
      const done = await post(maint.token, `/maintenance/work-orders/${wo.id}/actions`, { action: 'complete', paymentMode: 'cash' });
      expect(done.body).toMatchObject({ status: 'completed', total: '2180.00' });
      expect((await get(maint.token, `/vehicles/${v.id}`)).body.status).toMatch(/available|assigned/);
      const [entry] = await t.handle.db.select().from(journalEntries).where(and(eq(journalEntries.sourceType, 'work_order'), eq(journalEntries.sourceId, wo.id)));
      const lines = await t.handle.db.select().from(journalLines).where(eq(journalLines.entryId, entry!.id));
      expect(lines.reduce((s, l) => s.plus(l.debit), new Big(0)).toFixed(2)).toBe('2180.00');
      expect((await post(dispatch.token, '/maintenance/work-orders', { vehicleId: v.id, woType: 'other', title: 'x' })).status).toBe(403);
    });
  });

  describe('reports', () => {
    it('summarises the period and explains provisional trip profits', async () => {
      const from = '2026-01-01';
      const sum = await get(owner.token, '/finance/summary', { from, to: today() });
      expect(sum.status).toBe(200);
      expect(Number(sum.body.revenueEarned)).toBeGreaterThan(0);
      expect(Number(sum.body.costs.total)).toBeGreaterThan(0);
      expect(sum.body.monthly).toHaveLength(6);
      const trips = await get(owner.token, '/reports/trip-profitability', { from, to: today() });
      expect(trips.body.data.length).toBeGreaterThan(0);
      expect(trips.body.data.some((x: { provisional: boolean; provisionalReasons: string[] }) => x.provisional && x.provisionalReasons.length > 0)).toBe(true);
    });

    it('exports CSV only with the export permission', async () => {
      const csv = await get(owner.token, '/reports/vehicle-performance.csv', { from: '2026-01-01', to: today() });
      expect(csv.status).toBe(200);
      expect(csv.headers['content-type']).toMatch(/text\/csv/);
      expect(csv.text.charCodeAt(0)).toBe(0xfeff);
      expect(csv.text).toContain('Vehicle,Type,Trips delivered');
      expect((await get(dispatch.token, '/reports/vehicle-performance.csv', { from: '2026-01-01', to: today() })).status).toBe(403);
      expect((await get(owner.token, '/reports/no-such-report', { from: '2026-01-01', to: today() })).status).toBe(404);
    });
  });

  describe('customer portal', () => {
    it('turns a shipment request into a draft booking for dispatch', async () => {
      const day = 86_400_000;
      const res = await post(customer.token, '/portal/requests', {
        customerRef: 'PO-7781',
        pickup: { name: 'Hosur plant', city: 'Hosur', pincode: '635109', contactName: 'Ravi', contactPhone: '9876543210' },
        drop: { name: 'Pune DC', city: 'Pune', pincode: '411019' },
        loadingWindowStart: new Date(Date.now() + 2 * day).toISOString(),
        deliveryDeadline: new Date(Date.now() + 4 * day).toISOString(),
        cargoDescription: 'Auto parts in crates',
        category: 'general',
        quantity: 40,
        unit: 'crates',
        weightKg: 6500,
        declaredValue: 850000,
      });
      expect(res.status).toBe(201);
      const summary = (await get(customer.token, '/portal/summary')).body;
      expect(res.body).toMatchObject({ status: 'draft', customer: { id: summary.customer.id }, originCity: 'Hosur', destinationCity: 'Pune' });
      const notes = (await get(dispatch.token, '/notifications', { pageSize: 50 })).body.data as { title: string }[];
      expect(notes.some((n) => n.title.startsWith(`New shipment request ${res.body.bookingNo}`))).toBe(true);
      const own = await get(customer.token, `/portal/bookings/${res.body.id}/tracking`);
      expect(own.status).toBe(200);
      expect(own.body).toMatchObject({ bookingNo: res.body.bookingNo, trip: null, position: null });
    });

    it('shows customers only their own shipments, and only to customers', async () => {
      const mine = (await get(customer.token, '/portal/summary')).body.customer.id;
      const theirs = ((await get(dispatch.token, '/bookings', { pageSize: 100 })).body.data as BookingListItemDto[]).find((b) => b.customer.id !== mine)!;
      expect((await get(customer.token, `/portal/bookings/${theirs.id}/tracking`)).status).toBe(404);
      expect((await get(customer.token, `/bookings/${theirs.id}`)).status).toBe(404);
      expect((await get(dispatch.token, '/portal/summary')).status).toBe(403);
    });

    it('refuses a customer login that is not linked to a customer', async () => {
      const db = t.handle.db;
      const [org] = await db.select().from(organizations).where(eq(organizations.code, 'KRL'));
      const [role] = await db.select().from(roles).where(and(eq(roles.orgId, org!.id), eq(roles.key, 'customer')));
      const email = `unlinked-${Date.now()}@kaveri.demo`;
      const [u] = await db.insert(users).values({ orgId: org!.id, email, fullName: 'Unlinked Customer', passwordHash: await hashPassword(DEMO_PASSWORD) }).$returningId();
      await db.insert(userRoles).values({ userId: u!.id, roleId: role!.id });
      const who = await login(t.app, email);
      for (const path of ['/finance/invoices', '/bookings', '/portal/summary']) expect((await get(who.token, path)).status).toBe(403);
    });
  });

  it('keeps the books balanced after all of the above', async () => {
    const [r] = (await t.handle.db.execute(sql`SELECT SUM(debit) AS d, SUM(credit) AS c FROM journal_lines`)) as unknown as [{ d: string; c: string }[]];
    expect(new Big(r[0]!.d).eq(r[0]!.c)).toBe(true);
  });
});
