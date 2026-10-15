/** Enumerations for workforce, commercial parties, bookings and trips. */

// ------------------------------------------------------------------ workforce
export const WORKER_TYPES = ['driver', 'helper', 'loader', 'mechanic', 'supervisor'] as const;
export type WorkerType = (typeof WORKER_TYPES)[number];

export const EMPLOYMENT_STATUSES = ['active', 'suspended', 'terminated'] as const;
export type EmploymentStatus = (typeof EMPLOYMENT_STATUSES)[number];

export const LICENCE_VERIFICATION = ['unverified', 'verified', 'rejected'] as const;
export type LicenceVerification = (typeof LICENCE_VERIFICATION)[number];

export const WORKER_DOC_TYPES = [
  'id_proof',
  'address_proof',
  'medical_certificate',
  'police_verification',
  'training_certificate',
  'employment_contract',
  'other',
] as const;
export type WorkerDocType = (typeof WORKER_DOC_TYPES)[number];

export const TRAINING_TYPES = ['defensive_driving', 'hazmat', 'first_aid', 'fire_safety', 'induction', 'other'] as const;
export type TrainingType = (typeof TRAINING_TYPES)[number];

export const LEAVE_TYPES = ['casual', 'sick', 'earned', 'unpaid', 'other'] as const;
export type LeaveType = (typeof LEAVE_TYPES)[number];

export const LEAVE_STATUSES = ['pending', 'approved', 'rejected', 'cancelled'] as const;
export type LeaveStatus = (typeof LEAVE_STATUSES)[number];

export const ATTENDANCE_STATUSES = ['present', 'absent', 'leave', 'off', 'on_trip'] as const;
export type AttendanceStatus = (typeof ATTENDANCE_STATUSES)[number];

/** How a driver/helper is paid for a trip. Amounts are always computed by rules, never by AI. */
export const COMPENSATION_BASES = ['fixed_per_trip', 'per_km', 'per_tonne', 'percent_of_freight', 'monthly_salary'] as const;
export type CompensationBasis = (typeof COMPENSATION_BASES)[number];

// ------------------------------------------------------------------ commercial
export const PARTY_STATUSES = ['active', 'on_hold', 'inactive'] as const;
export type PartyStatus = (typeof PARTY_STATUSES)[number];

export const VENDOR_TYPES = [
  'workshop',
  'fuel_station',
  'subcontractor',
  'freight_agent',
  'parts_supplier',
  'tyre_dealer',
  'insurer',
  'other',
] as const;
export type VendorType = (typeof VENDOR_TYPES)[number];

export const LOCATION_TYPES = ['customer_site', 'warehouse', 'depot', 'port', 'fuel_station', 'other'] as const;
export type LocationType = (typeof LOCATION_TYPES)[number];

export const RATE_BASES = ['per_trip', 'per_tonne', 'per_km'] as const;
export type RateBasis = (typeof RATE_BASES)[number];

// ------------------------------------------------------------------ bookings
export const CARGO_CATEGORIES = [
  'general',
  'fragile',
  'perishable',
  'hazardous',
  'high_value',
  'oversized',
  'liquid_bulk',
  'other',
] as const;
export type CargoCategory = (typeof CARGO_CATEGORIES)[number];

export const CHARGE_TYPES = ['freight', 'loading', 'unloading', 'detention', 'halting', 'toll', 'other'] as const;
export type ChargeType = (typeof CHARGE_TYPES)[number];

export const STOP_TYPES = ['pickup', 'drop', 'via'] as const;
export type StopType = (typeof STOP_TYPES)[number];

export const BOOKING_STATUSES = [
  'draft',
  'quoted',
  'approved',
  'planned',
  'in_transit',
  'delivered',
  'invoiced',
  'closed',
  'on_hold',
  'cancelled',
] as const;
export type BookingStatus = (typeof BOOKING_STATUSES)[number];

// ------------------------------------------------------------------ trips
export const TRIP_STATUSES = [
  'planned',
  'ready',
  'in_transit',
  'delivered',
  'completed',
  'reconciled',
  'closed',
  'on_hold',
  'cancelled',
] as const;
export type TripStatus = (typeof TRIP_STATUSES)[number];

/** Trips that still hold their vehicle and crew (their reservations are active). */
export const ACTIVE_TRIP_STATUSES: readonly TripStatus[] = ['planned', 'ready', 'in_transit', 'delivered', 'on_hold'];

export const TRIP_TYPES = ['loaded', 'empty', 'return'] as const;
export type TripType = (typeof TRIP_TYPES)[number];

export const TRIP_EVENT_TYPES = [
  'created',
  'assigned',
  'reassigned',
  'inspection_passed',
  'inspection_failed',
  'dispatched',
  'loading_started',
  'loading_completed',
  'checkpoint',
  'arrived_stop',
  'departed_stop',
  'unloading_started',
  'unloading_completed',
  'delay_reported',
  'otp_issued',
  'otp_failed',
  'delivered',
  'completed',
  'on_hold',
  'resumed',
  'cancelled',
  'reconciled',
  'closed',
  'note',
] as const;
export type TripEventType = (typeof TRIP_EVENT_TYPES)[number];

/** Milestones a driver or dispatcher may record by hand while the trip runs. */
export const MANUAL_TRIP_EVENTS = [
  'loading_started',
  'loading_completed',
  'checkpoint',
  'arrived_stop',
  'departed_stop',
  'unloading_started',
  'unloading_completed',
  'delay_reported',
  'note',
] as const satisfies readonly TripEventType[];
export type ManualTripEvent = (typeof MANUAL_TRIP_EVENTS)[number];

export const INSPECTION_TYPES = ['pre_trip', 'post_trip'] as const;
export type InspectionType = (typeof INSPECTION_TYPES)[number];

export const POD_METHODS = ['otp', 'override'] as const;
export type PodMethod = (typeof POD_METHODS)[number];
