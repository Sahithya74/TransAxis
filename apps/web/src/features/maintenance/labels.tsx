import type { ServiceDue, TyrePosition, TyreStatus, WorkOrderPriority, WorkOrderStatus, WorkOrderType } from '@transaxis/shared';
import { Badge, type Tone } from '../../components/ui/Badge';
import { fmtDate, fmtNumber } from '../../lib/format';

export const WO_TYPE_LABEL: Record<WorkOrderType, string> = {
  preventive: 'Scheduled service',
  breakdown: 'Breakdown repair',
  accident: 'Accident repair',
  inspection: 'Inspection',
  tyre: 'Tyre work',
  other: 'Other',
};

const STATUS: Record<WorkOrderStatus, [Tone, string]> = {
  open: ['neutral', 'Open'],
  in_progress: ['warn', 'In the workshop'],
  completed: ['ok', 'Completed'],
  cancelled: ['crit', 'Cancelled'],
};
export const WO_STATUS_LABEL = Object.fromEntries(Object.entries(STATUS).map(([k, v]) => [k, v[1]])) as Record<WorkOrderStatus, string>;
export const WorkOrderStatusBadge = ({ status }: { status: WorkOrderStatus }) => <Badge tone={STATUS[status][0]}>{STATUS[status][1]}</Badge>;

const PRIORITY: Record<WorkOrderPriority, [Tone, string]> = { low: ['neutral', 'Low'], normal: ['info', 'Normal'], high: ['warn', 'High'], urgent: ['crit', 'Urgent'] };
export const PriorityBadge = ({ priority }: { priority: WorkOrderPriority }) => <Badge tone={PRIORITY[priority][0]}>{PRIORITY[priority][1]}</Badge>;

export const TYRE_STATUS_LABEL: Record<TyreStatus, string> = { in_stock: 'In stock', fitted: 'Fitted', removed: 'Removed', scrapped: 'Scrapped' };

export const TYRE_POSITION_LABEL: Record<TyrePosition, string> = {
  FL: 'Front left',
  FR: 'Front right',
  RLO: 'Rear left outer',
  RLI: 'Rear left inner',
  RRO: 'Rear right outer',
  RRI: 'Rear right inner',
  R2LO: '2nd rear left outer',
  R2LI: '2nd rear left inner',
  R2RO: '2nd rear right outer',
  R2RI: '2nd rear right inner',
  SPARE: 'Spare',
};

/** Whichever comes first, distance or date, is what the badge reports. */
export function ServiceDueBadge({ due }: { due: ServiceDue }) {
  const parts = [
    due.kmLeft !== null ? (due.kmLeft <= 0 ? `${fmtNumber(-due.kmLeft)} km over` : `${fmtNumber(due.kmLeft)} km left`) : null,
    due.daysLeft !== null ? (due.daysLeft <= 0 ? `${-due.daysLeft} d over` : `${due.daysLeft} d left`) : null,
  ].filter(Boolean);
  const title = [due.nextKm !== null ? `Due at ${fmtNumber(due.nextKm)} km` : null, due.nextOn ? `due by ${fmtDate(due.nextOn)}` : null].filter(Boolean).join(', ');
  const tone: Tone = due.status === 'overdue' ? 'crit' : due.status === 'due_soon' ? 'warn' : 'ok';
  const label = due.status === 'overdue' ? 'Overdue' : due.status === 'due_soon' ? 'Due soon' : 'OK';
  return (
    <span className="inline-flex flex-col gap-0.5" title={title}>
      <Badge tone={tone}>{label}</Badge>
      <span className="text-xs text-muted">{parts.join(' · ')}</span>
    </span>
  );
}
