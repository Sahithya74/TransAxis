import type { Request } from 'express';
import Big from 'big.js';
import { and, asc, count, desc, eq, gte, inArray, isNotNull, type SQL, sql } from 'drizzle-orm';
import type { z } from 'zod';
import {
  fuelLogs,
  inventoryMovements,
  maintenanceSchedules,
  spareParts,
  tyres,
  users,
  vehicles,
  vendors,
  workOrderItems,
  workOrders,
  type Db,
  type Tx,
} from '@transaxis/database';
import { serviceDue, type Paginated, type PartDto, type ScheduleDto, type TyreDto, type WorkOrderDto } from '@transaxis/shared';
import type {
  partInputSchema,
  partPurchaseSchema,
  scheduleInputSchema,
  tyreActionSchema,
  tyreInputSchema,
  workOrderActionSchema,
  workOrderCreateSchema,
  workOrderItemSchema,
  workOrderListQuerySchema,
} from '@transaxis/shared';
import { audit } from '../../lib/audit.js';
import type { RequestContext } from '../../lib/context.js';
import { AppError } from '../../lib/errors.js';
import { paginated, parseSort, toNumber } from '../../lib/http.js';
import { getOrgInfo, orgToday, orgYear } from '../../lib/org.js';
import { nextNumber } from '../../lib/sequences.js';
import type { LedgerService } from '../finance/ledger.js';
import type { NotificationService } from '../notifications/service.js';
import { syncVehicleStatus } from '../trips/lifecycle.js';

const money = (v: Big | string | number) => new Big(v).round(2, Big.roundHalfUp).toFixed(2);
const PAY_ACCOUNT = { cash: 'cash', bank: 'bank', upi: 'bank', vendor_credit: 'payables' } as const;

export class MaintenanceService {
  constructor(
    private readonly db: Db,
    private readonly ledger: LedgerService,
    private readonly notifier: NotificationService,
  ) {}

  // ------------------------------------------------------------------ schedules

  async schedules(ctx: RequestContext, q: { vehicleId?: number; due?: 'due' | 'all' }): Promise<ScheduleDto[]> {
    const org = await getOrgInfo(this.db, ctx.orgId);
    const today = orgToday(org);
    const conds: SQL[] = [eq(maintenanceSchedules.orgId, ctx.orgId), eq(maintenanceSchedules.isActive, true)];
    if (q.vehicleId) conds.push(eq(maintenanceSchedules.vehicleId, q.vehicleId));
    const rows = await this.db
      .select({ s: maintenanceSchedules, v: { id: vehicles.id, registrationNo: vehicles.registrationNo, odometerKm: vehicles.odometerKm } })
      .from(maintenanceSchedules)
      .innerJoin(vehicles, eq(vehicles.id, maintenanceSchedules.vehicleId))
      .where(and(...conds))
      .orderBy(asc(vehicles.registrationNo), asc(maintenanceSchedules.task));
    const open = await this.db
      .select({ id: workOrders.id, woNo: workOrders.woNo, scheduleId: workOrders.scheduleId })
      .from(workOrders)
      .where(and(eq(workOrders.orgId, ctx.orgId), inArray(workOrders.status, ['open', 'in_progress']), isNotNull(workOrders.scheduleId)));
    const openBySchedule = new Map(open.map((o) => [o.scheduleId!, { id: o.id, woNo: o.woNo }]));
    const out = rows.map(({ s, v }) => ({
      id: s.id,
      vehicle: { id: v.id, registrationNo: v.registrationNo, odometerKm: Number(v.odometerKm) },
      task: s.task,
      everyKm: s.everyKm,
      everyDays: s.everyDays,
      lastDoneKm: toNumber(s.lastDoneKm),
      lastDoneOn: s.lastDoneOn,
      due: serviceDue({ everyKm: s.everyKm, everyDays: s.everyDays, lastKm: toNumber(s.lastDoneKm), lastOn: s.lastDoneOn, odometerKm: Number(v.odometerKm), today }),
      openWorkOrder: openBySchedule.get(s.id) ?? null,
    }));
    const rank = { overdue: 0, due_soon: 1, ok: 2 } as const;
    return (q.due === 'due' ? out.filter((s) => s.due.status !== 'ok') : out).sort((a, b) => rank[a.due.status] - rank[b.due.status]);
  }

  async saveSchedule(ctx: RequestContext, input: z.infer<typeof scheduleInputSchema>, id: number | null, req: Request): Promise<ScheduleDto> {
    const [v] = await this.db.select({ id: vehicles.id }).from(vehicles).where(and(eq(vehicles.id, input.vehicleId), eq(vehicles.orgId, ctx.orgId)));
    if (!v) throw AppError.validation('Unknown vehicle', [{ path: 'vehicleId', message: 'Vehicle not found' }]);
    const values = {
      vehicleId: input.vehicleId,
      task: input.task,
      everyKm: input.everyKm ?? null,
      everyDays: input.everyDays ?? null,
      lastDoneKm: input.lastDoneKm != null ? input.lastDoneKm.toFixed(1) : null,
      lastDoneOn: input.lastDoneOn ?? null,
    };
    let scheduleId = id;
    if (id) {
      const [res] = await this.db.update(maintenanceSchedules).set(values).where(and(eq(maintenanceSchedules.id, id), eq(maintenanceSchedules.orgId, ctx.orgId)));
      if ((res as unknown as { affectedRows: number }).affectedRows === 0) throw AppError.notFound('Schedule');
    } else {
      try {
        const [row] = await this.db.insert(maintenanceSchedules).values({ orgId: ctx.orgId, ...values }).$returningId();
        scheduleId = row!.id;
      } catch (err) {
        if ((err as { cause?: { code?: string } }).cause?.code === 'ER_DUP_ENTRY' || (err as { code?: string }).code === 'ER_DUP_ENTRY') {
          throw AppError.conflict(`This vehicle already has a "${input.task}" schedule`);
        }
        throw err;
      }
    }
    await audit(this.db, req, { action: id ? 'maintenance.schedule_updated' : 'maintenance.schedule_created', entityType: 'maintenance_schedule', entityId: scheduleId, summary: input.task });
    return (await this.schedules(ctx, { vehicleId: input.vehicleId })).find((s) => s.id === scheduleId)!;
  }

  // ------------------------------------------------------------------ work orders

  async listWorkOrders(ctx: RequestContext, q: z.infer<typeof workOrderListQuerySchema>): Promise<Paginated<WorkOrderDto>> {
    const conds: SQL[] = [eq(workOrders.orgId, ctx.orgId)];
    if (q.status === 'active') conds.push(inArray(workOrders.status, ['open', 'in_progress']));
    else if (q.status) conds.push(eq(workOrders.status, q.status as 'open'));
    if (q.vehicleId) conds.push(eq(workOrders.vehicleId, q.vehicleId));
    if (q.woType) conds.push(eq(workOrders.woType, q.woType));
    if (q.q) conds.push(sql`(${workOrders.woNo} LIKE ${`%${q.q}%`} OR ${workOrders.title} LIKE ${`%${q.q}%`} OR ${vehicles.registrationNo} LIKE ${`%${q.q}%`})`);
    const where = and(...conds);
    const sort = parseSort<'openedAt' | 'total' | 'woNo'>(q.sort, 'openedAt');
    const col = sort.field === 'total' ? workOrders.total : sort.field === 'woNo' ? workOrders.woNo : workOrders.openedAt;
    const descending = q.sort ? sort.desc : true;
    const [[total], rows] = await Promise.all([
      this.db.select({ n: count() }).from(workOrders).innerJoin(vehicles, eq(vehicles.id, workOrders.vehicleId)).where(where),
      this.selectWo().where(where).orderBy(descending ? desc(col) : asc(col), desc(workOrders.id)).limit(q.pageSize).offset((q.page - 1) * q.pageSize),
    ]);
    return paginated(rows.map((r) => woDto(r, [])), q.page, q.pageSize, Number(total?.n ?? 0));
  }

  async getWorkOrder(ctx: RequestContext, id: number): Promise<WorkOrderDto> {
    const [row] = await this.selectWo().where(and(eq(workOrders.id, id), eq(workOrders.orgId, ctx.orgId)));
    if (!row) throw AppError.notFound('Work order');
    const items = await this.db
      .select({ i: workOrderItems, p: { id: spareParts.id, partNo: spareParts.partNo } })
      .from(workOrderItems)
      .leftJoin(spareParts, eq(spareParts.id, workOrderItems.partId))
      .where(eq(workOrderItems.workOrderId, id))
      .orderBy(asc(workOrderItems.id));
    return woDto(row, items);
  }

  async createWorkOrder(ctx: RequestContext, input: z.infer<typeof workOrderCreateSchema>, req: Request): Promise<WorkOrderDto> {
    const [v] = await this.db.select().from(vehicles).where(and(eq(vehicles.id, input.vehicleId), eq(vehicles.orgId, ctx.orgId)));
    if (!v) throw AppError.validation('Unknown vehicle', [{ path: 'vehicleId', message: 'Vehicle not found' }]);
    if (input.vendorId && !(await this.db.select({ id: vendors.id }).from(vendors).where(and(eq(vendors.id, input.vendorId), eq(vendors.orgId, ctx.orgId))))[0]) {
      throw AppError.validation('Unknown vendor', [{ path: 'vendorId', message: 'Vendor not found' }]);
    }
    if (input.scheduleId) {
      const [s] = await this.db.select().from(maintenanceSchedules).where(and(eq(maintenanceSchedules.id, input.scheduleId), eq(maintenanceSchedules.vehicleId, input.vehicleId)));
      if (!s) throw AppError.validation('That schedule belongs to another vehicle', [{ path: 'scheduleId', message: 'Mismatch' }]);
    }
    const org = await getOrgInfo(this.db, ctx.orgId);
    const id = await this.db.transaction(async (tx) => {
      const woNo = await nextNumber(tx, ctx.orgId, 'WO', orgYear(org));
      const [row] = await tx
        .insert(workOrders)
        .values({
          orgId: ctx.orgId,
          woNo,
          vehicleId: input.vehicleId,
          scheduleId: input.scheduleId ?? null,
          woType: input.woType,
          priority: input.priority,
          title: input.title,
          description: input.description ?? null,
          vendorId: input.vendorId ?? null,
          odometerKm: (input.odometerKm ?? Number(v.odometerKm)).toFixed(1),
          openedAt: new Date(),
          createdBy: ctx.userId,
        })
        .$returningId();
      await audit(tx, req, { action: 'work_order.created', entityType: 'work_order', entityId: row!.id, summary: `${woNo} ${v.registrationNo}: ${input.title}` });
      return row!.id;
    });
    return this.getWorkOrder(ctx, id);
  }

  async addItem(ctx: RequestContext, id: number, input: z.infer<typeof workOrderItemSchema>, req: Request): Promise<WorkOrderDto> {
    await this.db.transaction(async (tx) => {
      const wo = await this.lockWo(tx, ctx, id);
      if (wo.status === 'completed' || wo.status === 'cancelled') throw AppError.businessRule(`${wo.woNo} is ${wo.status}`);
      let unitCost = input.unitCost;
      if (input.kind === 'part' && input.partId) {
        const [p] = await tx.select().from(spareParts).where(and(eq(spareParts.id, input.partId), eq(spareParts.orgId, ctx.orgId))).for('update');
        if (!p) throw AppError.validation('Unknown part', [{ path: 'partId', message: 'Part not found' }]);
        if (Number(p.stockQty) < input.quantity) throw AppError.businessRule(`Only ${Number(p.stockQty)} ${p.unit} of ${p.name} in stock`);
        unitCost = unitCost || Number(p.unitCost);
        await tx.update(spareParts).set({ stockQty: sql`${spareParts.stockQty} - ${input.quantity}` }).where(eq(spareParts.id, p.id));
        await tx.insert(inventoryMovements).values({ orgId: ctx.orgId, partId: p.id, quantity: (-input.quantity).toFixed(2), reason: 'issue', workOrderId: id, unitCost: unitCost.toFixed(2), createdBy: ctx.userId });
      }
      await tx.insert(workOrderItems).values({
        workOrderId: id,
        kind: input.kind,
        partId: input.kind === 'part' ? (input.partId ?? null) : null,
        description: input.description,
        quantity: input.quantity.toFixed(2),
        unitCost: unitCost.toFixed(2),
        amount: money(new Big(input.quantity).times(unitCost)),
      });
      await this.retotal(tx, id);
      await audit(tx, req, { action: 'work_order.item_added', entityType: 'work_order', entityId: id, summary: `${wo.woNo}: ${input.description}` });
    });
    return this.getWorkOrder(ctx, id);
  }

  async removeItem(ctx: RequestContext, id: number, itemId: number, req: Request): Promise<WorkOrderDto> {
    await this.db.transaction(async (tx) => {
      const wo = await this.lockWo(tx, ctx, id);
      if (wo.status === 'completed' || wo.status === 'cancelled') throw AppError.businessRule(`${wo.woNo} is ${wo.status}`);
      const [item] = await tx.select().from(workOrderItems).where(and(eq(workOrderItems.id, itemId), eq(workOrderItems.workOrderId, id)));
      if (!item) throw AppError.notFound('Item');
      if (item.partId) {
        // Return the parts to stock.
        await tx.update(spareParts).set({ stockQty: sql`${spareParts.stockQty} + ${item.quantity}` }).where(eq(spareParts.id, item.partId));
        await tx.insert(inventoryMovements).values({ orgId: ctx.orgId, partId: item.partId, quantity: item.quantity, reason: 'return', workOrderId: id, unitCost: item.unitCost, createdBy: ctx.userId });
      }
      await tx.delete(workOrderItems).where(eq(workOrderItems.id, itemId));
      await this.retotal(tx, id);
      await audit(tx, req, { action: 'work_order.item_removed', entityType: 'work_order', entityId: id, summary: `${wo.woNo}: ${item.description}` });
    });
    return this.getWorkOrder(ctx, id);
  }

  async act(ctx: RequestContext, id: number, input: z.infer<typeof workOrderActionSchema>, req: Request): Promise<WorkOrderDto> {
    const org = await getOrgInfo(this.db, ctx.orgId);
    await this.db.transaction(async (tx) => {
      const wo = await this.lockWo(tx, ctx, id);
      const [v] = await tx.select().from(vehicles).where(eq(vehicles.id, wo.vehicleId)).for('update');
      const now = new Date();
      switch (input.action) {
        case 'start': {
          if (wo.status !== 'open') throw AppError.businessRule(`${wo.woNo} is ${wo.status.replace('_', ' ')}`);
          if (v!.status === 'on_trip') throw AppError.businessRule(`${v!.registrationNo} is on a trip; start the work when it returns`);
          await tx.update(workOrders).set({ status: 'in_progress', startedAt: now, vehicleStatusBefore: v!.status, version: sql`${workOrders.version} + 1` }).where(eq(workOrders.id, id));
          await tx.update(vehicles).set({ status: 'under_maintenance' }).where(eq(vehicles.id, v!.id));
          if (v!.status === 'assigned') {
            // Planned trips will fail their dispatch check while the vehicle is in the workshop.
            await this.notifier.notify(tx, {
              orgId: ctx.orgId,
              permission: 'trips:assign',
              category: 'trip',
              priority: 'high',
              title: `${v!.registrationNo} is in the workshop (${wo.woNo})`,
              body: `${wo.title}. Its planned trips may need another vehicle.`,
              link: `/trips?q=${encodeURIComponent(v!.registrationNo)}`,
              entityType: 'work_order',
              entityId: id,
              dedupeKey: `work_order:${id}:started`,
            });
          }
          break;
        }
        case 'complete': {
          if (wo.status !== 'open' && wo.status !== 'in_progress') throw AppError.businessRule(`${wo.woNo} is ${wo.status}`);
          const total = Number(wo.total);
          if (total > 0 && !input.paymentMode) throw AppError.validation('How was the work paid for?', [{ path: 'paymentMode', message: 'Required when there are costs' }]);
          const odometer = input.odometerKm ?? Number(wo.odometerKm ?? v!.odometerKm);
          await tx
            .update(workOrders)
            .set({ status: 'completed', startedAt: wo.startedAt ?? now, completedAt: now, odometerKm: odometer.toFixed(1), paymentMode: input.paymentMode ?? null, version: sql`${workOrders.version} + 1` })
            .where(eq(workOrders.id, id));
          if (v!.status === 'under_maintenance') {
            await tx.update(vehicles).set({ status: 'available' }).where(eq(vehicles.id, v!.id));
            await syncVehicleStatus(tx, v!.id);
          }
          if (odometer > Number(v!.odometerKm)) await tx.update(vehicles).set({ odometerKm: odometer.toFixed(1) }).where(eq(vehicles.id, v!.id));
          if (wo.scheduleId) await tx.update(maintenanceSchedules).set({ lastDoneKm: odometer.toFixed(1), lastDoneOn: orgToday(org) }).where(eq(maintenanceSchedules.id, wo.scheduleId));
          if (total > 0) {
            const fromStock = await tx.select({ s: sql<string>`COALESCE(SUM(${workOrderItems.amount}), 0)` }).from(workOrderItems).where(and(eq(workOrderItems.workOrderId, id), isNotNull(workOrderItems.partId)));
            const stock = new Big(fromStock[0]?.s ?? 0);
            const rest = new Big(wo.total).minus(stock);
            const credit = PAY_ACCOUNT[input.paymentMode!];
            const entry = await this.ledger.post(tx, {
              orgId: ctx.orgId,
              memo: `${wo.woNo} ${v!.registrationNo}: ${wo.title}`,
              source: 'work_order',
              sourceId: id,
              idempotencyKey: `work_order:${id}`,
              userId: ctx.userId,
              lines: [
                { account: 'maintenance_expense', debit: wo.total, vehicleId: v!.id, vendorId: wo.vendorId },
                { account: 'spares_inventory', credit: stock, vehicleId: v!.id },
                { account: credit, credit: rest, vendorId: credit === 'payables' ? wo.vendorId : null, vehicleId: v!.id },
              ],
            });
            await tx.update(workOrders).set({ journalEntryId: entry }).where(eq(workOrders.id, id));
          }
          break;
        }
        case 'cancel': {
          if (wo.status === 'completed' || wo.status === 'cancelled') throw AppError.businessRule(`${wo.woNo} is already ${wo.status}`);
          if (!input.reason) throw AppError.validation('Give a reason', [{ path: 'reason', message: 'Required' }]);
          const parts = await tx.select().from(workOrderItems).where(and(eq(workOrderItems.workOrderId, id), isNotNull(workOrderItems.partId)));
          for (const p of parts) {
            await tx.update(spareParts).set({ stockQty: sql`${spareParts.stockQty} + ${p.quantity}` }).where(eq(spareParts.id, p.partId!));
            await tx.insert(inventoryMovements).values({ orgId: ctx.orgId, partId: p.partId!, quantity: p.quantity, reason: 'return', workOrderId: id, unitCost: p.unitCost, note: 'Work order cancelled', createdBy: ctx.userId });
          }
          await tx.update(workOrders).set({ status: 'cancelled', cancelReason: input.reason, version: sql`${workOrders.version} + 1` }).where(eq(workOrders.id, id));
          if (v!.status === 'under_maintenance' && wo.status === 'in_progress') {
            await tx.update(vehicles).set({ status: 'available' }).where(eq(vehicles.id, v!.id));
            await syncVehicleStatus(tx, v!.id);
          }
          break;
        }
      }
      await audit(tx, req, { action: `work_order.${input.action}`, entityType: 'work_order', entityId: id, summary: `${wo.woNo} ${v!.registrationNo}${input.reason ? `: ${input.reason}` : ''}` });
    });
    return this.getWorkOrder(ctx, id);
  }

  // ------------------------------------------------------------------ parts

  async parts(ctx: RequestContext): Promise<PartDto[]> {
    const rows = await this.db.select().from(spareParts).where(and(eq(spareParts.orgId, ctx.orgId), eq(spareParts.isActive, true))).orderBy(asc(spareParts.name));
    return rows.map(partDto);
  }

  async createPart(ctx: RequestContext, input: z.infer<typeof partInputSchema>, req: Request): Promise<PartDto> {
    try {
      const [row] = await this.db
        .insert(spareParts)
        .values({ orgId: ctx.orgId, partNo: input.partNo, name: input.name, unit: input.unit, reorderLevel: input.reorderLevel.toFixed(2), unitCost: input.unitCost.toFixed(2) })
        .$returningId();
      await audit(this.db, req, { action: 'part.created', entityType: 'spare_part', entityId: row!.id, summary: `${input.partNo} ${input.name}` });
      return partDto((await this.db.select().from(spareParts).where(eq(spareParts.id, row!.id)))[0]!);
    } catch (err) {
      if (JSON.stringify(err).includes('ER_DUP_ENTRY') || (err as { cause?: { code?: string } }).cause?.code === 'ER_DUP_ENTRY') throw AppError.conflict(`Part number ${input.partNo} already exists`);
      throw err;
    }
  }

  /** Adds stock at a purchase price (weighted average cost) and books the purchase. */
  async purchase(ctx: RequestContext, partId: number, input: z.infer<typeof partPurchaseSchema>, req: Request): Promise<PartDto> {
    await this.db.transaction(async (tx) => {
      const [p] = await tx.select().from(spareParts).where(and(eq(spareParts.id, partId), eq(spareParts.orgId, ctx.orgId))).for('update');
      if (!p) throw AppError.notFound('Part');
      const oldQty = new Big(p.stockQty);
      const newQty = oldQty.plus(input.quantity);
      const avg = oldQty.times(p.unitCost).plus(new Big(input.quantity).times(input.unitCost)).div(newQty);
      await tx.update(spareParts).set({ stockQty: newQty.toFixed(2), unitCost: avg.round(2, Big.roundHalfUp).toFixed(2) }).where(eq(spareParts.id, partId));
      const [mv] = await tx
        .insert(inventoryMovements)
        .values({ orgId: ctx.orgId, partId, quantity: input.quantity.toFixed(2), reason: 'purchase', unitCost: input.unitCost.toFixed(2), note: input.note ?? null, createdBy: ctx.userId })
        .$returningId();
      const amount = money(new Big(input.quantity).times(input.unitCost));
      const credit = PAY_ACCOUNT[input.paymentMode];
      await this.ledger.post(tx, {
        orgId: ctx.orgId,
        memo: `Purchase ${input.quantity} ${p.unit} ${p.name}`,
        source: 'manual',
        sourceId: mv!.id,
        idempotencyKey: `part_purchase:${mv!.id}`,
        userId: ctx.userId,
        lines: [
          { account: 'spares_inventory', debit: amount },
          { account: credit, credit: amount, vendorId: credit === 'payables' ? (input.vendorId ?? null) : null },
        ],
      });
      await audit(tx, req, { action: 'part.purchased', entityType: 'spare_part', entityId: partId, summary: `${input.quantity} × ${p.name} @ ₹${input.unitCost}` });
    });
    return partDto((await this.db.select().from(spareParts).where(eq(spareParts.id, partId)))[0]!);
  }

  // ------------------------------------------------------------------ tyres

  async tyres(ctx: RequestContext, q: { vehicleId?: number; status?: string }): Promise<TyreDto[]> {
    const conds: SQL[] = [eq(tyres.orgId, ctx.orgId)];
    if (q.vehicleId) conds.push(eq(tyres.vehicleId, q.vehicleId));
    if (q.status) conds.push(eq(tyres.status, q.status as 'fitted'));
    const rows = await this.db
      .select({ t: tyres, v: { id: vehicles.id, registrationNo: vehicles.registrationNo, odometerKm: vehicles.odometerKm } })
      .from(tyres)
      .leftJoin(vehicles, eq(vehicles.id, tyres.vehicleId))
      .where(and(...conds))
      .orderBy(asc(tyres.status), asc(tyres.serialNo));
    return rows.map(({ t, v }) => tyreDto(t, v?.id ? v : null));
  }

  async createTyre(ctx: RequestContext, input: z.infer<typeof tyreInputSchema>, req: Request): Promise<TyreDto> {
    const [row] = await this.db
      .insert(tyres)
      .values({ orgId: ctx.orgId, serialNo: input.serialNo, brand: input.brand, size: input.size, purchaseCost: input.purchaseCost?.toFixed(2) ?? null, purchasedOn: input.purchasedOn ?? null, expectedLifeKm: input.expectedLifeKm ?? null })
      .$returningId()
      .catch((err: unknown) => {
        if (JSON.stringify(err).includes('ER_DUP_ENTRY') || (err as { cause?: { code?: string } }).cause?.code === 'ER_DUP_ENTRY') throw AppError.conflict(`Tyre ${input.serialNo} already exists`);
        throw err;
      });
    await audit(this.db, req, { action: 'tyre.created', entityType: 'tyre', entityId: row!.id, summary: input.serialNo });
    return (await this.tyres(ctx, {})).find((t) => t.id === row!.id)!;
  }

  async tyreAction(ctx: RequestContext, id: number, input: z.infer<typeof tyreActionSchema>, req: Request): Promise<TyreDto> {
    await this.db.transaction(async (tx) => {
      const [t] = await tx.select().from(tyres).where(and(eq(tyres.id, id), eq(tyres.orgId, ctx.orgId))).for('update');
      if (!t) throw AppError.notFound('Tyre');
      if (input.action === 'fit') {
        if (t.status === 'fitted') throw AppError.businessRule('This tyre is already fitted; remove it first');
        if (t.status === 'scrapped') throw AppError.businessRule('A scrapped tyre cannot be fitted');
        const [v] = await tx.select().from(vehicles).where(and(eq(vehicles.id, input.vehicleId), eq(vehicles.orgId, ctx.orgId)));
        if (!v) throw AppError.validation('Unknown vehicle', [{ path: 'vehicleId', message: 'Vehicle not found' }]);
        const [taken] = await tx.select({ serialNo: tyres.serialNo }).from(tyres).where(and(eq(tyres.vehicleId, v.id), eq(tyres.position, input.position), eq(tyres.status, 'fitted')));
        if (taken) throw AppError.conflict(`Position ${input.position} on ${v.registrationNo} already has tyre ${taken.serialNo}`);
        await tx.update(tyres).set({ status: 'fitted', vehicleId: v.id, position: input.position, fittedOn: orgToday(await getOrgInfo(this.db, ctx.orgId)), fittedAtKm: input.odometerKm.toFixed(1) }).where(eq(tyres.id, id));
      } else {
        if (t.status !== 'fitted') throw AppError.businessRule('This tyre is not fitted');
        const run = Math.max(0, input.odometerKm - Number(t.fittedAtKm ?? input.odometerKm));
        await tx
          .update(tyres)
          .set({ status: input.scrap ? 'scrapped' : 'removed', vehicleId: null, position: null, fittedOn: null, fittedAtKm: null, kmRunBefore: (Number(t.kmRunBefore) + run).toFixed(1), notes: input.notes ?? t.notes })
          .where(eq(tyres.id, id));
      }
      await audit(tx, req, { action: `tyre.${input.action}`, entityType: 'tyre', entityId: id, summary: t.serialNo });
    });
    return (await this.tyres(ctx, {})).find((t) => t.id === id)!;
  }

  // ------------------------------------------------------------------ insights

  /**
   * EXPERIMENTAL rule-based hints, not predictions from a trained model: repeated breakdowns, falling
   * fuel economy, and services overdue. Shown labelled as experimental.
   */
  async insights(ctx: RequestContext): Promise<{ vehicle: { id: number; registrationNo: string }; signal: string; detail: string }[]> {
    const since = new Date(Date.now() - 90 * 86_400_000);
    const breakdowns = await this.db
      .select({ id: vehicles.id, reg: vehicles.registrationNo, n: count() })
      .from(workOrders)
      .innerJoin(vehicles, eq(vehicles.id, workOrders.vehicleId))
      .where(and(eq(workOrders.orgId, ctx.orgId), inArray(workOrders.woType, ['breakdown', 'tyre']), gte(workOrders.openedAt, since)))
      .groupBy(vehicles.id);
    const out = breakdowns.filter((b) => Number(b.n) >= 2).map((b) => ({ vehicle: { id: b.id, registrationNo: b.reg }, signal: 'Repeated breakdowns', detail: `${b.n} breakdown or tyre jobs in 90 days: consider a full inspection.` }));
    const fills = await this.db
      .select({ vehicleId: fuelLogs.vehicleId, reg: vehicles.registrationNo, kmpl: fuelLogs.kmpl })
      .from(fuelLogs)
      .innerJoin(vehicles, eq(vehicles.id, fuelLogs.vehicleId))
      .where(and(eq(fuelLogs.orgId, ctx.orgId), isNotNull(fuelLogs.kmpl), eq(fuelLogs.anomaly, false)))
      .orderBy(asc(fuelLogs.vehicleId), desc(fuelLogs.filledAt));
    const byVehicle = new Map<number, { reg: string; k: number[] }>();
    for (const f of fills) {
      const e = byVehicle.get(f.vehicleId) ?? { reg: f.reg, k: [] };
      e.k.push(Number(f.kmpl));
      byVehicle.set(f.vehicleId, e);
    }
    for (const [id, { reg, k }] of byVehicle) {
      if (k.length < 6) continue;
      const recent = (k[0]! + k[1]! + k[2]!) / 3;
      const before = k.slice(3, 9).reduce((s, x) => s + x, 0) / Math.min(6, k.length - 3);
      if (recent < before * 0.88) out.push({ vehicle: { id, registrationNo: reg }, signal: 'Fuel economy falling', detail: `Last 3 fills average ${recent.toFixed(2)} km/L against ${before.toFixed(2)} km/L before: check injectors, air filter and tyre pressure.` });
    }
    const overdue = (await this.schedules(ctx, { due: 'due' })).filter((s) => s.due.status === 'overdue' && !s.openWorkOrder);
    for (const s of overdue) {
      const by = [s.due.kmLeft !== null && s.due.kmLeft <= 0 ? `${-s.due.kmLeft} km` : null, s.due.daysLeft !== null && s.due.daysLeft <= 0 ? `${-s.due.daysLeft} days` : null].filter(Boolean);
      out.push({ vehicle: { id: s.vehicle.id, registrationNo: s.vehicle.registrationNo }, signal: 'Service overdue', detail: `${s.task} is overdue${by.length ? ` by ${by.join(' and ')}` : ''}.` });
    }
    return out;
  }

  // ------------------------------------------------------------------ internals

  private async lockWo(tx: Tx, ctx: RequestContext, id: number) {
    const [wo] = await tx.select().from(workOrders).where(and(eq(workOrders.id, id), eq(workOrders.orgId, ctx.orgId))).for('update');
    if (!wo) throw AppError.notFound('Work order');
    return wo;
  }

  private async retotal(tx: Tx, id: number) {
    const sums = await tx
      .select({ kind: workOrderItems.kind, s: sql<string>`COALESCE(SUM(${workOrderItems.amount}), 0)` })
      .from(workOrderItems)
      .where(eq(workOrderItems.workOrderId, id))
      .groupBy(workOrderItems.kind);
    const by = (k: string) => new Big(sums.find((s) => s.kind === k)?.s ?? 0);
    const parts = by('part');
    const labour = by('labour');
    const other = by('other');
    await tx
      .update(workOrders)
      .set({ partsCost: money(parts), labourCost: money(labour), otherCost: money(other), total: money(parts.plus(labour).plus(other)), version: sql`${workOrders.version} + 1` })
      .where(eq(workOrders.id, id));
  }

  private selectWo() {
    return this.db
      .select({
        w: workOrders,
        v: { id: vehicles.id, registrationNo: vehicles.registrationNo, status: vehicles.status },
        s: { id: maintenanceSchedules.id, task: maintenanceSchedules.task },
        vd: { id: vendors.id, name: vendors.name },
        by: users.fullName,
      })
      .from(workOrders)
      .innerJoin(vehicles, eq(vehicles.id, workOrders.vehicleId))
      .leftJoin(maintenanceSchedules, eq(maintenanceSchedules.id, workOrders.scheduleId))
      .leftJoin(vendors, eq(vendors.id, workOrders.vendorId))
      .leftJoin(users, eq(users.id, workOrders.createdBy))
      .$dynamic();
  }
}

type WoRow = {
  w: typeof workOrders.$inferSelect;
  v: { id: number; registrationNo: string; status: string };
  s: { id: number; task: string } | null;
  vd: { id: number; name: string } | null;
  by: string | null;
};

function woDto({ w, v, s, vd, by }: WoRow, items: { i: typeof workOrderItems.$inferSelect; p: { id: number; partNo: string } | null }[]): WorkOrderDto {
  const end = w.completedAt ?? (w.status === 'in_progress' ? new Date() : null);
  return {
    id: w.id,
    woNo: w.woNo,
    vehicle: v,
    schedule: s?.id ? s : null,
    woType: w.woType,
    priority: w.priority,
    status: w.status,
    title: w.title,
    description: w.description,
    vendor: vd?.id ? vd : null,
    odometerKm: toNumber(w.odometerKm),
    openedAt: w.openedAt.toISOString(),
    startedAt: w.startedAt?.toISOString() ?? null,
    completedAt: w.completedAt?.toISOString() ?? null,
    downtimeHours: w.startedAt && end ? Math.round(((end.getTime() - w.startedAt.getTime()) / 3_600_000) * 10) / 10 : null,
    partsCost: w.partsCost,
    labourCost: w.labourCost,
    otherCost: w.otherCost,
    total: w.total,
    paymentMode: w.paymentMode,
    cancelReason: w.cancelReason,
    items: items.map(({ i, p }) => ({ id: i.id, kind: i.kind, part: p?.id ? p : null, description: i.description, quantity: Number(i.quantity), unitCost: i.unitCost, amount: i.amount })),
    createdBy: by,
    version: w.version,
  };
}

function partDto(p: typeof spareParts.$inferSelect): PartDto {
  return { id: p.id, partNo: p.partNo, name: p.name, unit: p.unit, stockQty: Number(p.stockQty), reorderLevel: Number(p.reorderLevel), unitCost: p.unitCost, lowStock: Number(p.stockQty) <= Number(p.reorderLevel) };
}

function tyreDto(t: typeof tyres.$inferSelect, v: { id: number; registrationNo: string; odometerKm: string } | null): TyreDto {
  const current = t.status === 'fitted' && v && t.fittedAtKm ? Math.max(0, Number(v.odometerKm) - Number(t.fittedAtKm)) : 0;
  const kmRun = Math.round(Number(t.kmRunBefore) + current);
  return {
    id: t.id,
    serialNo: t.serialNo,
    brand: t.brand,
    size: t.size,
    status: t.status,
    vehicle: v ? { id: v.id, registrationNo: v.registrationNo } : null,
    position: t.position,
    fittedOn: t.fittedOn,
    kmRun,
    expectedLifeKm: t.expectedLifeKm,
    wearPct: t.expectedLifeKm ? Math.min(100, Math.round((kmRun / t.expectedLifeKm) * 100)) : null,
    purchaseCost: t.purchaseCost,
  };
}
