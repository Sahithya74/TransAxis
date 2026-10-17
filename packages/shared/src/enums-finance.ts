/** Enumerations for finance, settlements, fuel and maintenance. */

// ------------------------------------------------------------------ ledger

export const ACCOUNT_TYPES = ['asset', 'liability', 'equity', 'income', 'expense'] as const;
export type AccountType = (typeof ACCOUNT_TYPES)[number];

/**
 * The chart of accounts every organisation starts with. Postings refer to these by key, so the
 * numbering can be changed per organisation without touching code.
 */
export const SYSTEM_ACCOUNTS = {
  cash: { code: '1000', name: 'Cash in hand', type: 'asset' },
  bank: { code: '1010', name: 'Bank', type: 'asset' },
  receivables: { code: '1100', name: 'Trade receivables', type: 'asset' },
  driver_advances: { code: '1200', name: 'Advances to drivers', type: 'asset' },
  gst_input: { code: '1300', name: 'GST input credit', type: 'asset' },
  tds_receivable: { code: '1310', name: 'TDS deducted by customers', type: 'asset' },
  spares_inventory: { code: '1400', name: 'Spare parts inventory', type: 'asset' },
  payables: { code: '2000', name: 'Trade payables (vendors)', type: 'liability' },
  driver_payable: { code: '2100', name: 'Payable to drivers and crew', type: 'liability' },
  gst_output: { code: '2200', name: 'GST output', type: 'liability' },
  owner_capital: { code: '3000', name: 'Owner’s capital', type: 'equity' },
  freight_income: { code: '4000', name: 'Freight income', type: 'income' },
  other_income: { code: '4100', name: 'Recoveries and other income', type: 'income' },
  fuel_expense: { code: '5000', name: 'Fuel', type: 'expense' },
  trip_expense: { code: '5100', name: 'Trip expenses (tolls, loading, food)', type: 'expense' },
  maintenance_expense: { code: '5200', name: 'Repairs and maintenance', type: 'expense' },
  crew_wages: { code: '5300', name: 'Driver and crew pay', type: 'expense' },
  hire_charges: { code: '5400', name: 'Vehicle hire charges', type: 'expense' },
  office_expense: { code: '6000', name: 'Office and administration', type: 'expense' },
} as const satisfies Record<string, { code: string; name: string; type: AccountType }>;
export type SystemAccount = keyof typeof SYSTEM_ACCOUNTS;

export const JOURNAL_SOURCES = ['invoice', 'credit_note', 'receipt', 'expense', 'fuel', 'work_order', 'earning', 'advance', 'settlement', 'manual', 'reversal'] as const;
export type JournalSource = (typeof JOURNAL_SOURCES)[number];

// ------------------------------------------------------------------ expenses and payments

export const PAYMENT_MODES = ['cash', 'bank', 'upi', 'card', 'fuel_card', 'fastag', 'driver_paid', 'vendor_credit'] as const;
export type PaymentMode = (typeof PAYMENT_MODES)[number];

/** Where a payment comes from, as a ledger account. Driver-paid amounts are owed back to the driver. */
export const PAYMENT_ACCOUNT: Record<PaymentMode, SystemAccount> = {
  cash: 'cash',
  bank: 'bank',
  upi: 'bank',
  card: 'bank',
  fuel_card: 'payables',
  fastag: 'bank',
  driver_paid: 'driver_payable',
  vendor_credit: 'payables',
};

export const EXPENSE_STATUSES = ['submitted', 'approved', 'rejected'] as const;
export type ExpenseStatus = (typeof EXPENSE_STATUSES)[number];

export const RECEIPT_MODES = ['bank', 'upi', 'cheque', 'cash'] as const;
export type ReceiptMode = (typeof RECEIPT_MODES)[number];

// ------------------------------------------------------------------ invoicing

export const INVOICE_STATUSES = ['issued', 'partially_paid', 'paid', 'cancelled'] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

/**
 * GST on road transport by a goods transport agency (SAC 9965): either the recipient pays 5% under
 * reverse charge, or the GTA charges 12% (with input credit) or 5% (without) on the invoice.
 */
export const GST_MODES = ['rcm_5', 'forward_12', 'forward_5'] as const;
export type GstMode = (typeof GST_MODES)[number];
export const GST_RATE: Record<GstMode, number> = { rcm_5: 5, forward_12: 12, forward_5: 5 };
export const SAC_GOODS_TRANSPORT = '9965';

// ------------------------------------------------------------------ crew pay

export const EARNING_TYPES = ['trip_pay', 'daily_allowance', 'on_time_bonus', 'adjustment'] as const;
export type EarningType = (typeof EARNING_TYPES)[number];

export const DEDUCTION_TYPES = ['cash_shortfall', 'damage', 'fine', 'loan_recovery', 'other'] as const;
export type DeductionType = (typeof DEDUCTION_TYPES)[number];

export const SETTLEMENT_STATUSES = ['draft', 'approved', 'paid', 'cancelled'] as const;
export type SettlementStatus = (typeof SETTLEMENT_STATUSES)[number];

// ------------------------------------------------------------------ maintenance

export const WORK_ORDER_TYPES = ['preventive', 'breakdown', 'accident', 'inspection', 'tyre', 'other'] as const;
export type WorkOrderType = (typeof WORK_ORDER_TYPES)[number];

export const WORK_ORDER_STATUSES = ['open', 'in_progress', 'completed', 'cancelled'] as const;
export type WorkOrderStatus = (typeof WORK_ORDER_STATUSES)[number];

export const WORK_ORDER_PRIORITIES = ['low', 'normal', 'high', 'urgent'] as const;
export type WorkOrderPriority = (typeof WORK_ORDER_PRIORITIES)[number];

export const WORK_ITEM_KINDS = ['part', 'labour', 'other'] as const;
export type WorkItemKind = (typeof WORK_ITEM_KINDS)[number];

export const TYRE_STATUSES = ['in_stock', 'fitted', 'removed', 'scrapped'] as const;
export type TyreStatus = (typeof TYRE_STATUSES)[number];

export const TYRE_POSITIONS = ['FL', 'FR', 'RLO', 'RLI', 'RRO', 'RRI', 'R2LO', 'R2LI', 'R2RO', 'R2RI', 'SPARE'] as const;
export type TyrePosition = (typeof TYRE_POSITIONS)[number];
