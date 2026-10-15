import type { BookingStatus } from '../enums-ops.js';
import type { Permission } from '../permissions.js';

/**
 * Booking actions a user can take directly. Transitions caused by the trip (planned, in transit,
 * delivered) and by invoicing are applied by those modules, not by users.
 */
export const BOOKING_ACTIONS = ['quote', 'approve', 'hold', 'resume', 'cancel', 'close'] as const;
export type BookingAction = (typeof BOOKING_ACTIONS)[number];

export const BOOKING_ACTION_RULES: Record<
  BookingAction,
  { from: readonly BookingStatus[]; to: BookingStatus | null; permission: Permission; requiresReason?: boolean }
> = {
  quote: { from: ['draft', 'quoted'], to: 'quoted', permission: 'bookings:write' },
  approve: { from: ['quoted'], to: 'approved', permission: 'bookings:approve' },
  hold: { from: ['draft', 'quoted', 'approved'], to: 'on_hold', permission: 'bookings:write', requiresReason: true },
  resume: { from: ['on_hold'], to: null, permission: 'bookings:write' },
  // A planned booking is cancelled together with its (not yet dispatched) trip.
  cancel: { from: ['draft', 'quoted', 'approved', 'planned', 'on_hold'], to: 'cancelled', permission: 'bookings:write', requiresReason: true },
  close: { from: ['delivered', 'invoiced'], to: 'closed', permission: 'bookings:approve' },
};

/** Bookings whose core fields (cargo, stops, price) may still be edited. */
export const EDITABLE_BOOKING_STATUSES: readonly BookingStatus[] = ['draft', 'quoted', 'on_hold'];

export function checkBookingTransition(
  status: BookingStatus,
  action: BookingAction,
  holdFrom: BookingStatus | null = null,
): { allowed: boolean; to?: BookingStatus; reason?: string } {
  const rule = BOOKING_ACTION_RULES[action];
  if (!rule.from.includes(status)) {
    return { allowed: false, reason: `Cannot ${action} a booking that is ${status.replace('_', ' ')}` };
  }
  if (action === 'resume') return holdFrom ? { allowed: true, to: holdFrom } : { allowed: false, reason: 'No previous status recorded' };
  return { allowed: true, to: rule.to! };
}

export function availableBookingActions(status: BookingStatus, holdFrom: BookingStatus | null = null): BookingAction[] {
  return BOOKING_ACTIONS.filter((a) => checkBookingTransition(status, a, holdFrom).allowed);
}
