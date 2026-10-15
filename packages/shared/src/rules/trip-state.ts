import type { Permission } from '../permissions.js';
import type { BookingStatus, TripStatus } from '../enums-ops.js';

/**
 * Trip lifecycle. Every status change goes through one of these actions so the allowed paths,
 * required permissions and resulting statuses live in one tested table.
 *
 *   planned ──inspection pass──▶ ready ──dispatch──▶ in_transit ──deliver──▶ delivered
 *      │                           │                    │                        │
 *      └──────── cancel ◀──────────┘          hold ◀────┘                  complete
 *                                                                                ▼
 *                                         closed ◀──close── reconciled ◀──reconcile── completed
 */
export const TRIP_ACTIONS = ['mark_ready', 'dispatch', 'deliver', 'complete', 'reconcile', 'close', 'hold', 'resume', 'cancel'] as const;
export type TripAction = (typeof TRIP_ACTIONS)[number];

interface ActionRule {
  from: readonly TripStatus[];
  /** `null` means "the status recorded before the hold" (resume). */
  to: TripStatus | null;
  /** Any-of. `trips:update_own` lets a driver act only on trips they are assigned to. */
  permissions: readonly Permission[];
  requiresReason?: boolean;
}

export const TRIP_ACTION_RULES: Record<TripAction, ActionRule> = {
  mark_ready: { from: ['planned'], to: 'ready', permissions: ['trips:dispatch'] },
  dispatch: { from: ['ready'], to: 'in_transit', permissions: ['trips:dispatch', 'trips:update_own'] },
  deliver: { from: ['in_transit'], to: 'delivered', permissions: ['trips:dispatch', 'trips:update_own'] },
  complete: { from: ['delivered'], to: 'completed', permissions: ['trips:dispatch', 'trips:update_own'] },
  reconcile: { from: ['completed'], to: 'reconciled', permissions: ['finance:post'] },
  close: { from: ['reconciled'], to: 'closed', permissions: ['finance:post', 'finance:approve'] },
  hold: { from: ['planned', 'ready', 'in_transit'], to: 'on_hold', permissions: ['trips:dispatch'], requiresReason: true },
  resume: { from: ['on_hold'], to: null, permissions: ['trips:dispatch'] },
  cancel: { from: ['planned', 'ready', 'on_hold'], to: 'cancelled', permissions: ['trips:dispatch'], requiresReason: true },
};

export interface TransitionCheck {
  allowed: boolean;
  to?: TripStatus;
  reason?: string;
}

/**
 * Pure transition check. `holdFrom` is needed to resume and to stop cancelling a trip that was put on
 * hold mid-journey (goods already loaded cannot simply be cancelled).
 */
export function checkTripTransition(status: TripStatus, action: TripAction, holdFrom: TripStatus | null = null): TransitionCheck {
  const rule = TRIP_ACTION_RULES[action];
  if (!rule.from.includes(status)) {
    return { allowed: false, reason: `Cannot ${action.replace('_', ' ')} a trip that is ${status.replace('_', ' ')}` };
  }
  if (action === 'cancel' && status === 'on_hold' && holdFrom === 'in_transit') {
    return { allowed: false, reason: 'A trip held while in transit cannot be cancelled; resume and complete it, or record an incident' };
  }
  if (action === 'resume') {
    if (!holdFrom) return { allowed: false, reason: 'No previous status recorded for this hold' };
    return { allowed: true, to: holdFrom };
  }
  return { allowed: true, to: rule.to! };
}

/** Actions available from a status (for rendering buttons; the API re-checks everything). */
export function availableTripActions(status: TripStatus, holdFrom: TripStatus | null = null): TripAction[] {
  return TRIP_ACTIONS.filter((a) => checkTripTransition(status, a, holdFrom).allowed);
}

/** The booking status implied by its trip moving to `tripStatus`. */
export function bookingStatusForTrip(tripStatus: TripStatus): BookingStatus | null {
  switch (tripStatus) {
    case 'planned':
    case 'ready':
      return 'planned';
    case 'in_transit':
      return 'in_transit';
    case 'delivered':
    case 'completed':
    case 'reconciled':
    case 'closed':
      return 'delivered';
    case 'cancelled':
      return 'approved'; // the booking goes back to the planning queue
    default:
      return null; // on_hold leaves the booking as it was
  }
}
