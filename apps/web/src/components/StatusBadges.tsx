import type { BookingStatus, LicenceState, TripStatus } from '@transaxis/shared';
import { Badge, type Tone } from './ui/Badge';

const TRIP: Record<TripStatus, [Tone, string]> = {
  planned: ['neutral', 'Planned'],
  ready: ['info', 'Ready'],
  in_transit: ['ok', 'In transit'],
  delivered: ['info', 'Delivered'],
  completed: ['ok', 'Completed'],
  reconciled: ['neutral', 'Reconciled'],
  closed: ['neutral', 'Closed'],
  on_hold: ['warn', 'On hold'],
  cancelled: ['crit', 'Cancelled'],
};

const BOOKING: Record<BookingStatus, [Tone, string]> = {
  draft: ['neutral', 'Draft'],
  quoted: ['info', 'Quoted'],
  approved: ['warn', 'Awaiting trip'],
  planned: ['info', 'Planned'],
  in_transit: ['ok', 'In transit'],
  delivered: ['ok', 'Delivered'],
  invoiced: ['neutral', 'Invoiced'],
  closed: ['neutral', 'Closed'],
  on_hold: ['warn', 'On hold'],
  cancelled: ['crit', 'Cancelled'],
};

const LICENCE: Record<LicenceState, [Tone, string]> = {
  ok: ['ok', 'Valid'],
  expiring: ['warn', 'Expiring'],
  expired: ['crit', 'Expired'],
  missing: ['crit', 'No licence'],
  not_required: ['neutral', 'n/a'],
};

export const TRIP_STATUS_LABEL = Object.fromEntries(Object.entries(TRIP).map(([k, v]) => [k, v[1]])) as Record<TripStatus, string>;
export const BOOKING_STATUS_LABEL = Object.fromEntries(Object.entries(BOOKING).map(([k, v]) => [k, v[1]])) as Record<BookingStatus, string>;

export const TripStatusBadge = ({ status }: { status: TripStatus }) => <Badge tone={TRIP[status][0]}>{TRIP[status][1]}</Badge>;
export const BookingStatusBadge = ({ status }: { status: BookingStatus }) => <Badge tone={BOOKING[status][0]}>{BOOKING[status][1]}</Badge>;
export const LicenceBadge = ({ state }: { state: LicenceState }) => <Badge tone={LICENCE[state][0]}>{LICENCE[state][1]}</Badge>;
