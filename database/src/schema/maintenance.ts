import { boolean, date, decimal, index, int, mysqlEnum, mysqlTable, text, uniqueIndex, varchar } from 'drizzle-orm/mysql-core';
import { TYRE_POSITIONS, TYRE_STATUSES, WORK_ITEM_KINDS, WORK_ORDER_PRIORITIES, WORK_ORDER_STATUSES, WORK_ORDER_TYPES } from '@transaxis/shared';
import { createdAtCol, dt, idCol, refCol, updatedAtCol } from './common.js';
import { organizations, users } from './core.js';
import { vendors } from './commercial.js';
import { vehicles } from './fleet.js';
import { journalEntries } from './finance.js';

const amount = (name: string) => decimal(name, { precision: 14, scale: 2 });

/** Recurring service tasks per vehicle, due by distance or time, whichever comes first. */
export const maintenanceSchedules = mysqlTable(
  'maintenance_schedules',
  {
    id: idCol(),
    orgId: refCol('org_id')
      .notNull()
      .references(() => organizations.id),
    vehicleId: refCol('vehicle_id')
      .notNull()
      .references(() => vehicles.id),
    task: varchar('task', { length: 120 }).notNull(),
    everyKm: int('every_km'),
    everyDays: int('every_days'),
    lastDoneKm: decimal('last_done_km', { precision: 12, scale: 1 }),
    lastDoneOn: date('last_done_on', { mode: 'string' }),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: createdAtCol(),
    updatedAt: updatedAtCol(),
  },
  (t) => [uniqueIndex('uq_schedules_vehicle_task').on(t.vehicleId, t.task), index('ix_schedules_org').on(t.orgId, t.isActive)],
);

export const workOrders = mysqlTable(
  'work_orders',
  {
    id: idCol(),
    orgId: refCol('org_id')
      .notNull()
      .references(() => organizations.id),
    woNo: varchar('wo_no', { length: 24 }).notNull(),
    vehicleId: refCol('vehicle_id')
      .notNull()
      .references(() => vehicles.id),
    scheduleId: refCol('schedule_id').references(() => maintenanceSchedules.id),
    woType: mysqlEnum('wo_type', WORK_ORDER_TYPES).notNull(),
    priority: mysqlEnum('priority', WORK_ORDER_PRIORITIES).notNull().default('normal'),
    status: mysqlEnum('status', WORK_ORDER_STATUSES).notNull().default('open'),
    title: varchar('title', { length: 160 }).notNull(),
    description: text('description'),
    /** Workshop doing the job; null for in-house work. */
    vendorId: refCol('vendor_id').references(() => vendors.id),
    odometerKm: decimal('odometer_km', { precision: 12, scale: 1 }),
    openedAt: dt('opened_at').notNull(),
    startedAt: dt('started_at'),
    completedAt: dt('completed_at'),
    /** Vehicle status before the work began, restored when it completes. */
    vehicleStatusBefore: varchar('vehicle_status_before', { length: 24 }),
    partsCost: amount('parts_cost').notNull().default('0.00'),
    labourCost: amount('labour_cost').notNull().default('0.00'),
    otherCost: amount('other_cost').notNull().default('0.00'),
    total: amount('total').notNull().default('0.00'),
    paymentMode: mysqlEnum('payment_mode', ['cash', 'bank', 'upi', 'vendor_credit']),
    cancelReason: varchar('cancel_reason', { length: 255 }),
    journalEntryId: refCol('journal_entry_id').references(() => journalEntries.id),
    createdBy: refCol('created_by').references(() => users.id),
    version: int('version').notNull().default(1),
    createdAt: createdAtCol(),
    updatedAt: updatedAtCol(),
  },
  (t) => [uniqueIndex('uq_work_orders_org_no').on(t.orgId, t.woNo), index('ix_work_orders_org_status').on(t.orgId, t.status), index('ix_work_orders_vehicle').on(t.vehicleId, t.openedAt)],
);

export const spareParts = mysqlTable(
  'spare_parts',
  {
    id: idCol(),
    orgId: refCol('org_id')
      .notNull()
      .references(() => organizations.id),
    partNo: varchar('part_no', { length: 40 }).notNull(),
    name: varchar('name', { length: 120 }).notNull(),
    unit: varchar('unit', { length: 16 }).notNull().default('pcs'),
    stockQty: decimal('stock_qty', { precision: 12, scale: 2 }).notNull().default('0.00'),
    reorderLevel: decimal('reorder_level', { precision: 12, scale: 2 }).notNull().default('0.00'),
    unitCost: decimal('unit_cost', { precision: 12, scale: 2 }).notNull().default('0.00'),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: createdAtCol(),
    updatedAt: updatedAtCol(),
  },
  (t) => [uniqueIndex('uq_parts_org_no').on(t.orgId, t.partNo)],
);

export const workOrderItems = mysqlTable(
  'work_order_items',
  {
    id: idCol(),
    workOrderId: refCol('work_order_id')
      .notNull()
      .references(() => workOrders.id, { onDelete: 'cascade' }),
    kind: mysqlEnum('kind', WORK_ITEM_KINDS).notNull(),
    partId: refCol('part_id').references(() => spareParts.id),
    description: varchar('description', { length: 160 }).notNull(),
    quantity: decimal('quantity', { precision: 12, scale: 2 }).notNull(),
    unitCost: decimal('unit_cost', { precision: 12, scale: 2 }).notNull(),
    amount: amount('amount').notNull(),
    createdAt: createdAtCol(),
  },
  (t) => [index('ix_wo_items_wo').on(t.workOrderId)],
);

/** Stock ledger for spare parts: purchases add, issues to work orders subtract. */
export const inventoryMovements = mysqlTable(
  'inventory_movements',
  {
    id: idCol(),
    orgId: refCol('org_id')
      .notNull()
      .references(() => organizations.id),
    partId: refCol('part_id')
      .notNull()
      .references(() => spareParts.id),
    quantity: decimal('quantity', { precision: 12, scale: 2 }).notNull(),
    reason: mysqlEnum('reason', ['purchase', 'issue', 'return', 'adjustment']).notNull(),
    workOrderId: refCol('work_order_id').references(() => workOrders.id),
    unitCost: decimal('unit_cost', { precision: 12, scale: 2 }),
    note: varchar('note', { length: 255 }),
    createdBy: refCol('created_by').references(() => users.id),
    createdAt: createdAtCol(),
  },
  (t) => [index('ix_movements_part').on(t.partId, t.createdAt)],
);

export const tyres = mysqlTable(
  'tyres',
  {
    id: idCol(),
    orgId: refCol('org_id')
      .notNull()
      .references(() => organizations.id),
    serialNo: varchar('serial_no', { length: 40 }).notNull(),
    brand: varchar('brand', { length: 60 }).notNull(),
    size: varchar('size', { length: 40 }).notNull(),
    status: mysqlEnum('status', TYRE_STATUSES).notNull().default('in_stock'),
    vehicleId: refCol('vehicle_id').references(() => vehicles.id),
    position: mysqlEnum('position', TYRE_POSITIONS),
    fittedOn: date('fitted_on', { mode: 'string' }),
    fittedAtKm: decimal('fitted_at_km', { precision: 12, scale: 1 }),
    /** Distance run on earlier fitments; the current fitment adds odometer − fittedAtKm. */
    kmRunBefore: decimal('km_run_before', { precision: 12, scale: 1 }).notNull().default('0.0'),
    purchaseCost: amount('purchase_cost'),
    purchasedOn: date('purchased_on', { mode: 'string' }),
    expectedLifeKm: int('expected_life_km'),
    notes: varchar('notes', { length: 255 }),
    createdAt: createdAtCol(),
    updatedAt: updatedAtCol(),
  },
  (t) => [uniqueIndex('uq_tyres_org_serial').on(t.orgId, t.serialNo), index('ix_tyres_vehicle').on(t.vehicleId)],
);
