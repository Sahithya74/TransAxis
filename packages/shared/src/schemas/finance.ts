import { z } from 'zod';
import {
  DEDUCTION_TYPES,
  EXPENSE_STATUSES,
  GST_MODES,
  INVOICE_STATUSES,
  PAYMENT_MODES,
  RECEIPT_MODES,
  SETTLEMENT_STATUSES,
  TYRE_POSITIONS,
  WORK_ITEM_KINDS,
  WORK_ORDER_PRIORITIES,
  WORK_ORDER_STATUSES,
  WORK_ORDER_TYPES,
  type DeductionType,
  type EarningType,
  type ExpenseStatus,
  type GstMode,
  type InvoiceStatus,
  type PaymentMode,
  type ReceiptMode,
  type SettlementStatus,
  type TyrePosition,
  type TyreStatus,
  type WorkItemKind,
  type WorkOrderPriority,
  type WorkOrderStatus,
  type WorkOrderType,
} from '../enums-finance.js';
import type { AgeingBucket, ServiceDue } from '../rules/finance.js';
import { isoDateTimeSchema } from './bookings.js';
import { idSchema, isoDateSchema, listQuerySchema, optionalText } from './common.js';

const money = (msg = 'Enter an amount') => z.coerce.number({ message: msg }).positive('Must be more than zero').max(100_000_000);
const ref = idSchema.nullable().optional();

// ------------------------------------------------------------------ expenses

export const expenseInputSchema = z.object({
  categoryId: idSchema,
  tripId: ref,
  vehicleId: ref,
  workerId: ref,
  vendorId: ref,
  expenseDate: isoDateSchema,
  amount: money(),
  paymentMode: z.enum(PAYMENT_MODES),
  description: z.string().trim().min(3, 'Describe the expense').max(255),
  receiptFileId: ref,
});
export type ExpenseInput = z.infer<typeof expenseInputSchema>;

export const expenseDecisionSchema = z
  .object({ decision: z.enum(['approve', 'reject']), reason: optionalText(255) })
  .refine((d) => d.decision === 'approve' || (d.reason && d.reason.length >= 3), { message: 'Say why it is rejected', path: ['reason'] });

export const expenseListQuerySchema = listQuerySchema(['expenseDate', 'amount'] as const).extend({
  status: z.enum(EXPENSE_STATUSES).optional(),
  tripId: idSchema.optional(),
  workerId: idSchema.optional(),
  vehicleId: idSchema.optional(),
  categoryId: idSchema.optional(),
  from: isoDateSchema.optional(),
  to: isoDateSchema.optional(),
});

export interface ExpenseCategoryDto {
  id: number;
  name: string;
  accountKey: string;
  isTripExpense: boolean;
  requiresReceiptAbove: string | null;
}

export interface ExpenseDto {
  id: number;
  category: { id: number; name: string };
  trip: { id: number; tripNo: string } | null;
  vehicle: { id: number; registrationNo: string } | null;
  worker: { id: number; fullName: string } | null;
  vendor: { id: number; name: string } | null;
  expenseDate: string;
  amount: string;
  paymentMode: PaymentMode;
  description: string;
  receiptFileId: number | null;
  status: ExpenseStatus;
  submittedBy: string | null;
  decidedBy: string | null;
  decidedAt: string | null;
  rejectionReason: string | null;
  settled: boolean;
  createdAt: string;
}

// ------------------------------------------------------------------ fuel

export const fuelInputSchema = z.object({
  vehicleId: idSchema,
  tripId: ref,
  workerId: ref,
  vendorId: ref,
  filledAt: isoDateTimeSchema,
  odometerKm: z.coerce.number({ message: 'Enter the odometer reading' }).min(0).max(5_000_000),
  litres: z.coerce.number({ message: 'Enter the litres' }).positive().max(2000),
  pricePerLitre: z.coerce.number({ message: 'Enter the price per litre' }).positive().max(500),
  paymentMode: z.enum(PAYMENT_MODES),
  fullTank: z.boolean().default(true),
  stationName: optionalText(120),
  receiptFileId: ref,
});

export const fuelListQuerySchema = listQuerySchema(['filledAt', 'kmpl'] as const).extend({
  vehicleId: idSchema.optional(),
  tripId: idSchema.optional(),
  anomaly: z.enum(['true', 'false']).optional(),
  from: isoDateSchema.optional(),
  to: isoDateSchema.optional(),
});

export interface FuelLogDto {
  id: number;
  vehicle: { id: number; registrationNo: string };
  trip: { id: number; tripNo: string } | null;
  worker: { id: number; fullName: string } | null;
  vendor: { id: number; name: string } | null;
  filledAt: string;
  odometerKm: number;
  litres: number;
  pricePerLitre: string;
  amount: string;
  paymentMode: PaymentMode;
  fullTank: boolean;
  stationName: string | null;
  kmpl: number | null;
  anomaly: boolean;
  anomalyReasons: string[];
  reviewNote: string | null;
  reviewedBy: string | null;
}

export interface FuelVehicleSummaryDto {
  vehicle: { id: number; registrationNo: string; vehicleType: string };
  fills: number;
  litres: number;
  amount: string;
  kmpl: number | null;
  declaredKmpl: number | null;
  anomalies: number;
}

// ------------------------------------------------------------------ invoices, credit notes, receipts

export const invoiceCreateSchema = z
  .object({
    customerId: idSchema,
    invoiceDate: isoDateSchema.optional(),
    gstMode: z.enum(GST_MODES),
    bookingIds: z.array(idSchema).max(100).default([]),
    extraLines: z.array(z.object({ description: z.string().trim().min(3).max(255), amount: money() })).max(10).default([]),
    notes: optionalText(500),
  })
  .refine((i) => i.bookingIds.length + i.extraLines.length > 0, { message: 'Add at least one delivered booking or charge', path: ['bookingIds'] });

export const invoiceListQuerySchema = listQuerySchema(['invoiceDate', 'dueDate', 'invoiceNo', 'total'] as const).extend({
  status: z.enum([...INVOICE_STATUSES, 'open', 'overdue'] as [string, ...string[]]).optional(),
  customerId: idSchema.optional(),
  from: isoDateSchema.optional(),
  to: isoDateSchema.optional(),
});

export const creditNoteSchema = z.object({ taxable: money(), reason: z.string().trim().min(5, 'Explain the credit').max(255) });
export const invoiceCancelSchema = z.object({ reason: z.string().trim().min(5, 'Explain the cancellation').max(255) });

export const receiptCreateSchema = z.object({
  customerId: idSchema,
  receivedOn: isoDateSchema,
  mode: z.enum(RECEIPT_MODES),
  reference: optionalText(80),
  amount: money('Enter the amount received'),
  tdsAmount: z.coerce.number().min(0).max(100_000_000).default(0),
  /** Omit to settle the oldest open invoices first. */
  allocations: z.array(z.object({ invoiceId: idSchema, amount: money() })).max(100).optional(),
  notes: optionalText(255),
});

export interface InvoiceLineDto {
  id: number;
  bookingId: number | null;
  bookingNo: string | null;
  lrNumber: string | null;
  tripId: number | null;
  description: string;
  sac: string;
  amount: string;
}

export interface InvoiceDto {
  id: number;
  invoiceNo: string;
  customer: { id: number; name: string; code: string; gstin: string | null; billingAddress: string | null; city: string | null; state: string | null };
  invoiceDate: string;
  dueDate: string;
  gstMode: GstMode;
  intraState: boolean;
  placeOfSupply: string | null;
  taxable: string;
  cgst: string;
  sgst: string;
  igst: string;
  reverseChargeTax: string;
  total: string;
  paid: string;
  credited: string;
  outstanding: string;
  status: InvoiceStatus;
  ageing: { bucket: AgeingBucket; daysOverdue: number };
  lines: InvoiceLineDto[];
  creditNotes: { id: number; noteNo: string; noteDate: string; reason: string; total: string }[];
  allocations: { receiptId: number; receiptNo: string; receivedOn: string; amount: string }[];
  notes: string | null;
  cancelReason: string | null;
  createdAt: string;
}

export interface UninvoicedBookingDto {
  bookingId: number;
  bookingNo: string;
  customer: { id: number; name: string };
  lrNumber: string | null;
  customerRef: string | null;
  originCity: string;
  destinationCity: string;
  deliveredAt: string | null;
  amount: string;
  tripId: number | null;
}

export interface ReceiptDto {
  id: number;
  receiptNo: string;
  customer: { id: number; name: string };
  receivedOn: string;
  mode: ReceiptMode;
  reference: string | null;
  amount: string;
  tdsAmount: string;
  unallocated: string;
  allocations: { invoiceId: number; invoiceNo: string; amount: string }[];
  notes: string | null;
  createdAt: string;
}

// ------------------------------------------------------------------ crew pay

export const advanceCreateSchema = z.object({
  workerId: idSchema,
  tripId: ref,
  givenOn: isoDateSchema,
  amount: money(),
  mode: z.enum(['cash', 'bank', 'upi']),
  purpose: optionalText(255),
});

export const deductionCreateSchema = z.object({
  workerId: idSchema,
  tripId: ref,
  deductionType: z.enum(DEDUCTION_TYPES),
  amount: money(),
  reason: z.string().trim().min(5, 'Explain the deduction').max(255),
  deductedOn: isoDateSchema,
});

export const settlementCreateSchema = z.object({ workerId: idSchema, periodFrom: isoDateSchema, periodTo: isoDateSchema }).refine((s) => s.periodTo >= s.periodFrom, { message: 'The period ends before it starts', path: ['periodTo'] });
export const settlementPaySchema = z.object({ paidOn: isoDateSchema, mode: z.enum(['cash', 'bank', 'upi']), reference: optionalText(80) });
export const settlementListQuerySchema = listQuerySchema(['createdAt', 'net'] as const).extend({ status: z.enum(SETTLEMENT_STATUSES).optional(), workerId: idSchema.optional() });

export interface EarningDto {
  id: number;
  worker: { id: number; fullName: string };
  trip: { id: number; tripNo: string } | null;
  earningType: EarningType;
  amount: string;
  label: string;
  formula: string;
  earnedOn: string;
  settled: boolean;
}

export interface AdvanceDto {
  id: number;
  worker: { id: number; fullName: string };
  trip: { id: number; tripNo: string } | null;
  givenOn: string;
  amount: string;
  recovered: string;
  outstanding: string;
  mode: 'cash' | 'bank' | 'upi';
  purpose: string | null;
}

export interface DeductionDto {
  id: number;
  worker: { id: number; fullName: string };
  trip: { id: number; tripNo: string } | null;
  deductionType: DeductionType;
  amount: string;
  reason: string;
  deductedOn: string;
  settled: boolean;
}

export interface SettlementBreakdown {
  earnings: { id: number; tripNo: string | null; label: string; formula: string; amount: string }[];
  reimbursements: { id: number; date: string; description: string; amount: string }[];
  deductions: { id: number; reason: string; amount: string }[];
  advances: { id: number; givenOn: string; outstanding: string; recoveredNow: string }[];
}

export interface SettlementDto {
  id: number | null;
  settlementNo: string | null;
  worker: { id: number; fullName: string; employeeCode: string };
  periodFrom: string;
  periodTo: string;
  earnings: string;
  reimbursements: string;
  deductions: string;
  advancesRecovered: string;
  advanceCarriedForward: string;
  net: string;
  status: SettlementStatus | 'preview';
  breakdown: SettlementBreakdown;
  approvedBy: string | null;
  approvedAt: string | null;
  paidOn: string | null;
  paidMode: 'cash' | 'bank' | 'upi' | null;
  paymentReference: string | null;
}

/** Per-person balance shown before settling. */
export interface CrewBalanceDto {
  worker: { id: number; fullName: string; employeeCode: string; workerType: string };
  unsettledEarnings: string;
  pendingReimbursements: string;
  outstandingAdvances: string;
  unsettledDeductions: string;
  estimatedNet: string;
  lastSettledTo: string | null;
}

// ------------------------------------------------------------------ maintenance

export const scheduleInputSchema = z
  .object({
    vehicleId: idSchema,
    task: z.string().trim().min(3).max(120),
    everyKm: z.coerce.number().int().positive().max(1_000_000).nullable().optional(),
    everyDays: z.coerce.number().int().positive().max(3650).nullable().optional(),
    lastDoneKm: z.coerce.number().min(0).max(5_000_000).nullable().optional(),
    lastDoneOn: isoDateSchema.nullable().optional(),
  })
  .refine((s) => s.everyKm || s.everyDays, { message: 'Set a distance or a time interval', path: ['everyKm'] });

export const workOrderCreateSchema = z.object({
  vehicleId: idSchema,
  woType: z.enum(WORK_ORDER_TYPES),
  priority: z.enum(WORK_ORDER_PRIORITIES).default('normal'),
  title: z.string().trim().min(3).max(160),
  description: optionalText(2000),
  vendorId: ref,
  scheduleId: ref,
  odometerKm: z.coerce.number().min(0).max(5_000_000).nullable().optional(),
});

export const workOrderItemSchema = z
  .object({
    kind: z.enum(WORK_ITEM_KINDS),
    partId: ref,
    description: z.string().trim().min(2).max(160),
    quantity: z.coerce.number().positive().max(100_000),
    unitCost: z.coerce.number().min(0).max(10_000_000),
  })
  .refine((i) => i.kind !== 'part' || !!i.partId || i.description.length > 0, { message: 'Choose the part', path: ['partId'] });

export const workOrderActionSchema = z.object({
  action: z.enum(['start', 'complete', 'cancel']),
  reason: optionalText(255),
  odometerKm: z.coerce.number().min(0).max(5_000_000).optional(),
  paymentMode: z.enum(['cash', 'bank', 'upi', 'vendor_credit']).optional(),
});

export const workOrderListQuerySchema = listQuerySchema(['openedAt', 'total', 'woNo'] as const).extend({
  status: z.enum([...WORK_ORDER_STATUSES, 'active'] as [string, ...string[]]).optional(),
  vehicleId: idSchema.optional(),
  woType: z.enum(WORK_ORDER_TYPES).optional(),
});

export const partInputSchema = z.object({
  partNo: z.string().trim().toUpperCase().min(2).max(40),
  name: z.string().trim().min(2).max(120),
  unit: z.string().trim().min(1).max(16).default('pcs'),
  reorderLevel: z.coerce.number().min(0).max(1_000_000).default(0),
  unitCost: z.coerce.number().min(0).max(10_000_000).default(0),
});

export const partPurchaseSchema = z.object({
  quantity: z.coerce.number().positive().max(1_000_000),
  unitCost: z.coerce.number().positive().max(10_000_000),
  paymentMode: z.enum(['cash', 'bank', 'upi', 'vendor_credit']),
  vendorId: ref,
  note: optionalText(255),
});

export const tyreInputSchema = z.object({
  serialNo: z.string().trim().toUpperCase().min(3).max(40),
  brand: z.string().trim().min(2).max(60),
  size: z.string().trim().min(2).max(40),
  purchaseCost: z.coerce.number().min(0).max(10_000_000).nullable().optional(),
  purchasedOn: isoDateSchema.nullable().optional(),
  expectedLifeKm: z.coerce.number().int().positive().max(1_000_000).nullable().optional(),
});

export const tyreActionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('fit'), vehicleId: idSchema, position: z.enum(TYRE_POSITIONS), odometerKm: z.coerce.number().min(0).max(5_000_000) }),
  z.object({ action: z.literal('remove'), odometerKm: z.coerce.number().min(0).max(5_000_000), scrap: z.boolean().default(false), notes: optionalText(255) }),
]);

export interface ScheduleDto {
  id: number;
  vehicle: { id: number; registrationNo: string; odometerKm: number };
  task: string;
  everyKm: number | null;
  everyDays: number | null;
  lastDoneKm: number | null;
  lastDoneOn: string | null;
  due: ServiceDue;
  openWorkOrder: { id: number; woNo: string } | null;
}

export interface WorkOrderItemDto {
  id: number;
  kind: WorkItemKind;
  part: { id: number; partNo: string } | null;
  description: string;
  quantity: number;
  unitCost: string;
  amount: string;
}

export interface WorkOrderDto {
  id: number;
  woNo: string;
  vehicle: { id: number; registrationNo: string; status: string };
  schedule: { id: number; task: string } | null;
  woType: WorkOrderType;
  priority: WorkOrderPriority;
  status: WorkOrderStatus;
  title: string;
  description: string | null;
  vendor: { id: number; name: string } | null;
  odometerKm: number | null;
  openedAt: string;
  startedAt: string | null;
  completedAt: string | null;
  downtimeHours: number | null;
  partsCost: string;
  labourCost: string;
  otherCost: string;
  total: string;
  paymentMode: string | null;
  cancelReason: string | null;
  items: WorkOrderItemDto[];
  createdBy: string | null;
  version: number;
}

export interface PartDto {
  id: number;
  partNo: string;
  name: string;
  unit: string;
  stockQty: number;
  reorderLevel: number;
  unitCost: string;
  lowStock: boolean;
}

export interface TyreDto {
  id: number;
  serialNo: string;
  brand: string;
  size: string;
  status: TyreStatus;
  vehicle: { id: number; registrationNo: string } | null;
  position: TyrePosition | null;
  fittedOn: string | null;
  kmRun: number;
  expectedLifeKm: number | null;
  wearPct: number | null;
  purchaseCost: string | null;
}

// ------------------------------------------------------------------ reports

export const reportPeriodSchema = z
  .object({ from: isoDateSchema, to: isoDateSchema })
  .refine((p) => p.to >= p.from, { message: 'The period ends before it starts', path: ['to'] });

export interface FinanceSummaryDto {
  from: string;
  to: string;
  /** Freight earned on trips delivered in the period (accrual, before tax). */
  revenueEarned: string;
  invoiced: string;
  collected: string;
  outstanding: string;
  overdue: string;
  ageing: Record<AgeingBucket, string>;
  costs: { fuel: string; tripExpenses: string; maintenance: string; crew: string; other: string; total: string };
  grossProfit: string;
  marginPct: number | null;
  pending: { expenses: number; expenseAmount: string; uninvoicedBookings: number; uninvoicedAmount: string; fuelAnomalies: number; draftSettlements: number };
  monthly: { month: string; revenue: string; costs: string; collected: string }[];
}

export interface TripProfitDto {
  trip: { id: number; tripNo: string; status: string; originCity: string; destinationCity: string; deliveredAt: string | null };
  vehicle: { id: number; registrationNo: string };
  customer: string | null;
  revenue: string;
  fuel: string;
  expenses: string;
  crew: string;
  totalCost: string;
  profit: string;
  marginPct: number | null;
  /** Costs may still change: e.g. no fuel recorded, expenses awaiting approval, crew pay not accrued. */
  provisional: boolean;
  provisionalReasons: string[];
}

export interface ReportTableDto {
  title: string;
  description: string;
  columns: { key: string; label: string; type: 'text' | 'number' | 'money' | 'percent' | 'date' }[];
  rows: Record<string, string | number | null>[];
  totals?: Record<string, string | number | null>;
  notes: string[];
}
