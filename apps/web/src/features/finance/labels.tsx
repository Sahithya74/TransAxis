import type {
  AgeingBucket,
  DeductionType,
  EarningType,
  ExpenseStatus,
  GstMode,
  InvoiceDto,
  PaymentMode,
  ReceiptMode,
  SettlementStatus,
} from '@transaxis/shared';
import { Badge, type Tone } from '../../components/ui/Badge';

export const PAYMENT_MODE_LABEL: Record<PaymentMode, string> = {
  cash: 'Cash',
  bank: 'Bank transfer',
  upi: 'UPI',
  card: 'Card',
  fuel_card: 'Fuel card',
  fastag: 'FASTag',
  driver_paid: 'Paid by driver',
  vendor_credit: 'On vendor credit',
};

export const RECEIPT_MODE_LABEL: Record<ReceiptMode, string> = { bank: 'Bank transfer', upi: 'UPI', cheque: 'Cheque', cash: 'Cash' };

export const GST_MODE_LABEL: Record<GstMode, string> = {
  rcm_5: 'Reverse charge, 5% (customer pays the GST)',
  forward_12: 'Forward charge, 12% (with input credit)',
  forward_5: 'Forward charge, 5% (no input credit)',
};

export const AGEING_LABEL: Record<AgeingBucket, string> = {
  current: 'Not yet due',
  '1_30': '1–30 days',
  '31_60': '31–60 days',
  '61_90': '61–90 days',
  '90_plus': 'Over 90 days',
};

export const EARNING_TYPE_LABEL: Record<EarningType, string> = {
  trip_pay: 'Trip pay',
  daily_allowance: 'Daily allowance (bata)',
  on_time_bonus: 'On-time bonus',
  adjustment: 'Adjustment',
};

export const DEDUCTION_TYPE_LABEL: Record<DeductionType, string> = {
  cash_shortfall: 'Cash shortfall',
  damage: 'Damage',
  fine: 'Traffic fine',
  loan_recovery: 'Loan recovery',
  other: 'Other',
};

const EXPENSE: Record<ExpenseStatus, [Tone, string]> = {
  submitted: ['warn', 'Awaiting approval'],
  approved: ['ok', 'Approved'],
  rejected: ['crit', 'Rejected'],
};
export const ExpenseStatusBadge = ({ status }: { status: ExpenseStatus }) => <Badge tone={EXPENSE[status][0]}>{EXPENSE[status][1]}</Badge>;

const SETTLEMENT: Record<SettlementStatus | 'preview', [Tone, string]> = {
  preview: ['neutral', 'Preview'],
  draft: ['neutral', 'Draft'],
  approved: ['info', 'Approved, to pay'],
  paid: ['ok', 'Paid'],
  cancelled: ['crit', 'Cancelled'],
};
export const SETTLEMENT_STATUS_LABEL = Object.fromEntries(Object.entries(SETTLEMENT).map(([k, v]) => [k, v[1]])) as Record<SettlementStatus, string>;
export const SettlementStatusBadge = ({ status }: { status: SettlementStatus | 'preview' }) => <Badge tone={SETTLEMENT[status][0]}>{SETTLEMENT[status][1]}</Badge>;

/** Open invoices past their due date say so, because that is what collections staff act on. */
export function InvoiceStatusBadge({ invoice }: { invoice: Pick<InvoiceDto, 'status' | 'ageing'> }) {
  const open = invoice.status === 'issued' || invoice.status === 'partially_paid';
  if (open && invoice.ageing.daysOverdue > 0) {
    return <Badge tone="crit" title={invoice.status === 'partially_paid' ? 'Part paid' : 'Unpaid'}>Overdue {invoice.ageing.daysOverdue} d</Badge>;
  }
  switch (invoice.status) {
    case 'issued':
      return <Badge tone="info">Due</Badge>;
    case 'partially_paid':
      return <Badge tone="warn">Part paid</Badge>;
    case 'paid':
      return <Badge tone="ok">Paid</Badge>;
    case 'cancelled':
      return <Badge tone="neutral">Cancelled</Badge>;
  }
}

export const INVOICE_FILTERS = [
  { id: 'open', label: 'Open' },
  { id: 'overdue', label: 'Overdue' },
  { id: 'paid', label: 'Paid' },
  { id: 'cancelled', label: 'Cancelled' },
  { id: 'all', label: 'All' },
] as const;
