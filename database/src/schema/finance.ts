import { boolean, date, decimal, index, int, json, mysqlEnum, mysqlTable, uniqueIndex, varchar } from 'drizzle-orm/mysql-core';
import {
  ACCOUNT_TYPES,
  DEDUCTION_TYPES,
  EARNING_TYPES,
  EXPENSE_STATUSES,
  GST_MODES,
  INVOICE_STATUSES,
  JOURNAL_SOURCES,
  PAYMENT_MODES,
  RECEIPT_MODES,
  SETTLEMENT_STATUSES,
} from '@transaxis/shared';
import { createdAtCol, dt, idCol, refCol, updatedAtCol } from './common.js';
import { files, organizations, users } from './core.js';
import { customers, vendors } from './commercial.js';
import { vehicles } from './fleet.js';
import { bookings, trips } from './operations.js';
import { workers } from './people.js';

const amount = (name: string) => decimal(name, { precision: 14, scale: 2 });

// ------------------------------------------------------------------ ledger

export const ledgerAccounts = mysqlTable(
  'ledger_accounts',
  {
    id: idCol(),
    orgId: refCol('org_id')
      .notNull()
      .references(() => organizations.id),
    code: varchar('code', { length: 16 }).notNull(),
    name: varchar('name', { length: 120 }).notNull(),
    accountType: mysqlEnum('account_type', ACCOUNT_TYPES).notNull(),
    /** Set for the accounts postings refer to by key (cash, receivables, freight_income…). */
    systemKey: varchar('system_key', { length: 40 }),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: createdAtCol(),
  },
  (t) => [uniqueIndex('uq_accounts_org_code').on(t.orgId, t.code), uniqueIndex('uq_accounts_org_key').on(t.orgId, t.systemKey)],
);

/**
 * Journal headers. A posting is never edited: corrections are reversal entries. The idempotency key
 * makes a retried posting return the original entry instead of booking twice.
 */
export const journalEntries = mysqlTable(
  'journal_entries',
  {
    id: idCol(),
    orgId: refCol('org_id')
      .notNull()
      .references(() => organizations.id),
    entryNo: varchar('entry_no', { length: 24 }).notNull(),
    entryDate: date('entry_date', { mode: 'string' }).notNull(),
    memo: varchar('memo', { length: 255 }).notNull(),
    sourceType: mysqlEnum('source_type', JOURNAL_SOURCES).notNull(),
    sourceId: refCol('source_id'),
    idempotencyKey: varchar('idempotency_key', { length: 120 }).notNull(),
    reversalOfId: refCol('reversal_of_id'),
    createdBy: refCol('created_by').references(() => users.id),
    createdAt: createdAtCol(),
  },
  (t) => [
    uniqueIndex('uq_journal_org_no').on(t.orgId, t.entryNo),
    uniqueIndex('uq_journal_org_idem').on(t.orgId, t.idempotencyKey),
    index('ix_journal_org_date').on(t.orgId, t.entryDate),
    index('ix_journal_source').on(t.sourceType, t.sourceId),
  ],
);

/** Append-only (UPDATE and DELETE are blocked by triggers). Dimensions allow per-trip and per-vehicle P&L. */
export const journalLines = mysqlTable(
  'journal_lines',
  {
    id: idCol(),
    orgId: refCol('org_id')
      .notNull()
      .references(() => organizations.id),
    entryId: refCol('entry_id')
      .notNull()
      .references(() => journalEntries.id),
    accountId: refCol('account_id')
      .notNull()
      .references(() => ledgerAccounts.id),
    debit: amount('debit').notNull().default('0.00'),
    credit: amount('credit').notNull().default('0.00'),
    tripId: refCol('trip_id').references(() => trips.id),
    vehicleId: refCol('vehicle_id').references(() => vehicles.id),
    customerId: refCol('customer_id').references(() => customers.id),
    vendorId: refCol('vendor_id').references(() => vendors.id),
    workerId: refCol('worker_id').references(() => workers.id),
    memo: varchar('memo', { length: 255 }),
  },
  (t) => [
    index('ix_lines_entry').on(t.entryId),
    index('ix_lines_account').on(t.orgId, t.accountId),
    index('ix_lines_trip').on(t.tripId),
    index('ix_lines_vehicle').on(t.vehicleId),
    index('ix_lines_customer').on(t.customerId),
    index('ix_lines_worker').on(t.workerId),
  ],
);

// ------------------------------------------------------------------ expenses

export const expenseCategories = mysqlTable(
  'expense_categories',
  {
    id: idCol(),
    orgId: refCol('org_id')
      .notNull()
      .references(() => organizations.id),
    name: varchar('name', { length: 80 }).notNull(),
    /** Ledger account (system key) the expense is booked to. */
    accountKey: varchar('account_key', { length: 40 }).notNull(),
    isTripExpense: boolean('is_trip_expense').notNull().default(true),
    requiresReceiptAbove: amount('requires_receipt_above'),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: createdAtCol(),
  },
  (t) => [uniqueIndex('uq_expense_categories_org_name').on(t.orgId, t.name)],
);

export const expenses = mysqlTable(
  'expenses',
  {
    id: idCol(),
    orgId: refCol('org_id')
      .notNull()
      .references(() => organizations.id),
    categoryId: refCol('category_id')
      .notNull()
      .references(() => expenseCategories.id),
    tripId: refCol('trip_id').references(() => trips.id),
    vehicleId: refCol('vehicle_id').references(() => vehicles.id),
    /** Who spent the money (for driver-paid expenses, who is reimbursed). */
    workerId: refCol('worker_id').references(() => workers.id),
    vendorId: refCol('vendor_id').references(() => vendors.id),
    expenseDate: date('expense_date', { mode: 'string' }).notNull(),
    amount: amount('amount').notNull(),
    paymentMode: mysqlEnum('payment_mode', PAYMENT_MODES).notNull(),
    description: varchar('description', { length: 255 }).notNull(),
    receiptFileId: refCol('receipt_file_id').references(() => files.id),
    status: mysqlEnum('status', EXPENSE_STATUSES).notNull().default('submitted'),
    submittedBy: refCol('submitted_by').references(() => users.id),
    decidedBy: refCol('decided_by').references(() => users.id),
    decidedAt: dt('decided_at'),
    rejectionReason: varchar('rejection_reason', { length: 255 }),
    journalEntryId: refCol('journal_entry_id').references(() => journalEntries.id),
    settlementId: refCol('settlement_id'),
    createdAt: createdAtCol(),
  },
  (t) => [index('ix_expenses_org_status').on(t.orgId, t.status, t.expenseDate), index('ix_expenses_trip').on(t.tripId), index('ix_expenses_worker').on(t.workerId)],
);

// ------------------------------------------------------------------ invoicing

export const invoices = mysqlTable(
  'invoices',
  {
    id: idCol(),
    orgId: refCol('org_id')
      .notNull()
      .references(() => organizations.id),
    invoiceNo: varchar('invoice_no', { length: 24 }).notNull(),
    customerId: refCol('customer_id')
      .notNull()
      .references(() => customers.id),
    invoiceDate: date('invoice_date', { mode: 'string' }).notNull(),
    dueDate: date('due_date', { mode: 'string' }).notNull(),
    gstMode: mysqlEnum('gst_mode', GST_MODES).notNull(),
    placeOfSupply: varchar('place_of_supply', { length: 80 }),
    intraState: boolean('intra_state').notNull(),
    taxable: amount('taxable').notNull(),
    cgst: amount('cgst').notNull().default('0.00'),
    sgst: amount('sgst').notNull().default('0.00'),
    igst: amount('igst').notNull().default('0.00'),
    reverseChargeTax: amount('reverse_charge_tax').notNull().default('0.00'),
    total: amount('total').notNull(),
    /** Received (cash plus TDS) and credited so far. Outstanding = total − paid − credited. */
    paid: amount('paid').notNull().default('0.00'),
    credited: amount('credited').notNull().default('0.00'),
    status: mysqlEnum('status', INVOICE_STATUSES).notNull().default('issued'),
    notes: varchar('notes', { length: 500 }),
    cancelReason: varchar('cancel_reason', { length: 255 }),
    journalEntryId: refCol('journal_entry_id').references(() => journalEntries.id),
    createdBy: refCol('created_by').references(() => users.id),
    version: int('version').notNull().default(1),
    createdAt: createdAtCol(),
    updatedAt: updatedAtCol(),
  },
  (t) => [uniqueIndex('uq_invoices_org_no').on(t.orgId, t.invoiceNo), index('ix_invoices_org_customer').on(t.orgId, t.customerId, t.status), index('ix_invoices_org_due').on(t.orgId, t.status, t.dueDate)],
);

export const invoiceLines = mysqlTable(
  'invoice_lines',
  {
    id: idCol(),
    invoiceId: refCol('invoice_id')
      .notNull()
      .references(() => invoices.id, { onDelete: 'cascade' }),
    bookingId: refCol('booking_id').references(() => bookings.id),
    tripId: refCol('trip_id').references(() => trips.id),
    description: varchar('description', { length: 255 }).notNull(),
    sac: varchar('sac', { length: 8 }).notNull().default('9965'),
    amount: amount('amount').notNull(),
  },
  (t) => [index('ix_invoice_lines_invoice').on(t.invoiceId), uniqueIndex('uq_invoice_lines_booking').on(t.bookingId)],
);

export const creditNotes = mysqlTable(
  'credit_notes',
  {
    id: idCol(),
    orgId: refCol('org_id')
      .notNull()
      .references(() => organizations.id),
    noteNo: varchar('note_no', { length: 24 }).notNull(),
    invoiceId: refCol('invoice_id')
      .notNull()
      .references(() => invoices.id),
    noteDate: date('note_date', { mode: 'string' }).notNull(),
    reason: varchar('reason', { length: 255 }).notNull(),
    taxable: amount('taxable').notNull(),
    tax: amount('tax').notNull(),
    total: amount('total').notNull(),
    journalEntryId: refCol('journal_entry_id').references(() => journalEntries.id),
    createdBy: refCol('created_by').references(() => users.id),
    createdAt: createdAtCol(),
  },
  (t) => [uniqueIndex('uq_credit_notes_org_no').on(t.orgId, t.noteNo), index('ix_credit_notes_invoice').on(t.invoiceId)],
);

export const receipts = mysqlTable(
  'receipts',
  {
    id: idCol(),
    orgId: refCol('org_id')
      .notNull()
      .references(() => organizations.id),
    receiptNo: varchar('receipt_no', { length: 24 }).notNull(),
    customerId: refCol('customer_id')
      .notNull()
      .references(() => customers.id),
    receivedOn: date('received_on', { mode: 'string' }).notNull(),
    mode: mysqlEnum('mode', RECEIPT_MODES).notNull(),
    reference: varchar('reference', { length: 80 }),
    /** Money received, and TDS the customer deducted (counts towards settling invoices). */
    amount: amount('amount').notNull(),
    tdsAmount: amount('tds_amount').notNull().default('0.00'),
    unallocated: amount('unallocated').notNull().default('0.00'),
    notes: varchar('notes', { length: 255 }),
    journalEntryId: refCol('journal_entry_id').references(() => journalEntries.id),
    createdBy: refCol('created_by').references(() => users.id),
    createdAt: createdAtCol(),
  },
  (t) => [uniqueIndex('uq_receipts_org_no').on(t.orgId, t.receiptNo), index('ix_receipts_org_customer').on(t.orgId, t.customerId)],
);

export const receiptAllocations = mysqlTable(
  'receipt_allocations',
  {
    id: idCol(),
    receiptId: refCol('receipt_id')
      .notNull()
      .references(() => receipts.id),
    invoiceId: refCol('invoice_id')
      .notNull()
      .references(() => invoices.id),
    amount: amount('amount').notNull(),
    createdAt: createdAtCol(),
  },
  (t) => [index('ix_allocations_receipt').on(t.receiptId), index('ix_allocations_invoice').on(t.invoiceId)],
);

// ------------------------------------------------------------------ crew pay

export const driverAdvances = mysqlTable(
  'driver_advances',
  {
    id: idCol(),
    orgId: refCol('org_id')
      .notNull()
      .references(() => organizations.id),
    workerId: refCol('worker_id')
      .notNull()
      .references(() => workers.id),
    tripId: refCol('trip_id').references(() => trips.id),
    givenOn: date('given_on', { mode: 'string' }).notNull(),
    amount: amount('amount').notNull(),
    recovered: amount('recovered').notNull().default('0.00'),
    mode: mysqlEnum('mode', ['cash', 'bank', 'upi']).notNull(),
    purpose: varchar('purpose', { length: 255 }),
    journalEntryId: refCol('journal_entry_id').references(() => journalEntries.id),
    createdBy: refCol('created_by').references(() => users.id),
    createdAt: createdAtCol(),
  },
  (t) => [index('ix_advances_worker').on(t.orgId, t.workerId)],
);

/** Pay earned per trip, computed by rules (never by AI). One row per trip, person and type. */
export const driverEarnings = mysqlTable(
  'driver_earnings',
  {
    id: idCol(),
    orgId: refCol('org_id')
      .notNull()
      .references(() => organizations.id),
    workerId: refCol('worker_id')
      .notNull()
      .references(() => workers.id),
    tripId: refCol('trip_id').references(() => trips.id),
    earningType: mysqlEnum('earning_type', EARNING_TYPES).notNull(),
    amount: amount('amount').notNull(),
    explanation: json('explanation').$type<{ label: string; formula: string; inputs?: Record<string, unknown> }>().notNull(),
    earnedOn: date('earned_on', { mode: 'string' }).notNull(),
    settlementId: refCol('settlement_id'),
    journalEntryId: refCol('journal_entry_id').references(() => journalEntries.id),
    createdAt: createdAtCol(),
  },
  (t) => [uniqueIndex('uq_earnings_trip_worker_type').on(t.tripId, t.workerId, t.earningType), index('ix_earnings_worker').on(t.orgId, t.workerId, t.settlementId)],
);

export const driverDeductions = mysqlTable(
  'driver_deductions',
  {
    id: idCol(),
    orgId: refCol('org_id')
      .notNull()
      .references(() => organizations.id),
    workerId: refCol('worker_id')
      .notNull()
      .references(() => workers.id),
    tripId: refCol('trip_id').references(() => trips.id),
    deductionType: mysqlEnum('deduction_type', DEDUCTION_TYPES).notNull(),
    amount: amount('amount').notNull(),
    reason: varchar('reason', { length: 255 }).notNull(),
    deductedOn: date('deducted_on', { mode: 'string' }).notNull(),
    settlementId: refCol('settlement_id'),
    createdBy: refCol('created_by').references(() => users.id),
    createdAt: createdAtCol(),
  },
  (t) => [index('ix_deductions_worker').on(t.orgId, t.workerId, t.settlementId)],
);

export const settlements = mysqlTable(
  'settlements',
  {
    id: idCol(),
    orgId: refCol('org_id')
      .notNull()
      .references(() => organizations.id),
    settlementNo: varchar('settlement_no', { length: 24 }).notNull(),
    workerId: refCol('worker_id')
      .notNull()
      .references(() => workers.id),
    periodFrom: date('period_from', { mode: 'string' }).notNull(),
    periodTo: date('period_to', { mode: 'string' }).notNull(),
    earnings: amount('earnings').notNull(),
    reimbursements: amount('reimbursements').notNull(),
    deductions: amount('deductions').notNull(),
    advancesRecovered: amount('advances_recovered').notNull(),
    net: amount('net').notNull(),
    status: mysqlEnum('status', SETTLEMENT_STATUSES).notNull().default('draft'),
    /** The calculation as approved, line by line, for the payslip. */
    breakdown: json('breakdown').notNull(),
    approvedBy: refCol('approved_by').references(() => users.id),
    approvedAt: dt('approved_at'),
    paidOn: date('paid_on', { mode: 'string' }),
    paidMode: mysqlEnum('paid_mode', ['cash', 'bank', 'upi']),
    paymentReference: varchar('payment_reference', { length: 80 }),
    journalEntryId: refCol('journal_entry_id').references(() => journalEntries.id),
    createdBy: refCol('created_by').references(() => users.id),
    createdAt: createdAtCol(),
    updatedAt: updatedAtCol(),
  },
  (t) => [uniqueIndex('uq_settlements_org_no').on(t.orgId, t.settlementNo), index('ix_settlements_worker').on(t.orgId, t.workerId, t.status)],
);

/** Which advances a settlement recovered, and how much of each. */
export const advanceRecoveries = mysqlTable(
  'advance_recoveries',
  {
    id: idCol(),
    settlementId: refCol('settlement_id')
      .notNull()
      .references(() => settlements.id),
    advanceId: refCol('advance_id')
      .notNull()
      .references(() => driverAdvances.id),
    amount: amount('amount').notNull(),
  },
  (t) => [index('ix_recoveries_settlement').on(t.settlementId)],
);

// ------------------------------------------------------------------ fuel

export const fuelLogs = mysqlTable(
  'fuel_logs',
  {
    id: idCol(),
    orgId: refCol('org_id')
      .notNull()
      .references(() => organizations.id),
    vehicleId: refCol('vehicle_id')
      .notNull()
      .references(() => vehicles.id),
    tripId: refCol('trip_id').references(() => trips.id),
    workerId: refCol('worker_id').references(() => workers.id),
    vendorId: refCol('vendor_id').references(() => vendors.id),
    filledAt: dt('filled_at').notNull(),
    odometerKm: decimal('odometer_km', { precision: 12, scale: 1 }).notNull(),
    litres: decimal('litres', { precision: 10, scale: 2 }).notNull(),
    pricePerLitre: decimal('price_per_litre', { precision: 8, scale: 2 }).notNull(),
    amount: amount('amount').notNull(),
    paymentMode: mysqlEnum('payment_mode', PAYMENT_MODES).notNull(),
    fullTank: boolean('full_tank').notNull().default(true),
    stationName: varchar('station_name', { length: 120 }),
    kmpl: decimal('kmpl', { precision: 6, scale: 2 }),
    anomaly: boolean('anomaly').notNull().default(false),
    anomalyReasons: json('anomaly_reasons').$type<string[]>(),
    reviewedBy: refCol('reviewed_by').references(() => users.id),
    reviewNote: varchar('review_note', { length: 255 }),
    receiptFileId: refCol('receipt_file_id').references(() => files.id),
    journalEntryId: refCol('journal_entry_id').references(() => journalEntries.id),
    createdBy: refCol('created_by').references(() => users.id),
    createdAt: createdAtCol(),
  },
  (t) => [index('ix_fuel_vehicle_time').on(t.vehicleId, t.filledAt), index('ix_fuel_org_time').on(t.orgId, t.filledAt), index('ix_fuel_trip').on(t.tripId)],
);

