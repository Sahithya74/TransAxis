import { z } from 'zod';
import type { LicenceClass, VehicleStatus } from '../enums.js';
import {
  INSPECTION_TYPES,
  MANUAL_TRIP_EVENTS,
  TRIP_STATUSES,
  TRIP_TYPES,
  type InspectionType,
  type PodMethod,
  type StopType,
  type TripEventType,
  type TripStatus,
  type TripType,
} from '../enums-ops.js';
import type { Violation } from '../rules/eligibility.js';
import { TRIP_ACTIONS, type TripAction } from '../rules/trip-state.js';
import { isoDateTimeSchema } from './bookings.js';
import { idSchema, isoDateSchema, listQuerySchema, optionalText } from './common.js';

const overrideReason = z.preprocess(
  (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
  z.string().trim().min(10, 'Explain the override in at least 10 characters').max(255).optional(),
);

const crewSchema = z
  .array(z.object({ workerId: idSchema, role: z.enum(['co_driver', 'helper']) }))
  .max(3, 'At most 3 crew members')
  .default([]);

export const assignmentCheckSchema = z
  .object({
    bookingId: idSchema.nullable().optional(),
    tripId: idSchema.optional(),
    vehicleId: idSchema,
    driverId: idSchema,
    crew: crewSchema,
    plannedStart: isoDateTimeSchema,
    plannedEnd: isoDateTimeSchema,
  })
  .refine((a) => Date.parse(a.plannedEnd) > Date.parse(a.plannedStart), { message: 'Planned end must be after the start', path: ['plannedEnd'] });

export const tripCreateSchema = z
  .object({
    bookingId: idSchema.nullable().optional(),
    tripType: z.enum(TRIP_TYPES).default('loaded'),
    parentTripId: idSchema.nullable().optional(),
    vehicleId: idSchema,
    driverId: idSchema,
    crew: crewSchema,
    plannedStart: isoDateTimeSchema,
    plannedEnd: isoDateTimeSchema,
    routeId: idSchema.nullable().optional(),
    /** Required only for trips without a booking (empty repositioning or returns). */
    originCity: optionalText(80),
    destinationCity: optionalText(80),
    notes: optionalText(2000),
    overrideReason,
  })
  .superRefine((t, ctx) => {
    if (Date.parse(t.plannedEnd) <= Date.parse(t.plannedStart)) {
      ctx.addIssue({ code: 'custom', message: 'Planned end must be after the start', path: ['plannedEnd'] });
    }
    if (!t.bookingId && (!t.originCity || !t.destinationCity)) {
      ctx.addIssue({ code: 'custom', message: 'Origin and destination are required for a trip without a booking', path: ['originCity'] });
    }
    if (t.tripType === 'loaded' && !t.bookingId) {
      ctx.addIssue({ code: 'custom', message: 'A loaded trip must belong to a booking', path: ['bookingId'] });
    }
  });
export type TripCreateInput = z.infer<typeof tripCreateSchema>;

export const tripReassignSchema = z
  .object({
    vehicleId: idSchema,
    driverId: idSchema,
    crew: crewSchema,
    plannedStart: isoDateTimeSchema,
    plannedEnd: isoDateTimeSchema,
    overrideReason,
    reason: optionalText(255),
  })
  .refine((a) => Date.parse(a.plannedEnd) > Date.parse(a.plannedStart), { message: 'Planned end must be after the start', path: ['plannedEnd'] });

export const tripActionSchema = z.object({
  action: z.enum(TRIP_ACTIONS),
  reason: optionalText(255),
  /** dispatch: starting odometer; complete: closing odometer. */
  odometer: z.coerce.number().min(0).max(5_000_000).optional(),
  /** Expected version for optimistic concurrency (optional). */
  version: z.coerce.number().int().positive().optional(),
});

export const inspectionInputSchema = z.object({
  inspectionType: z.enum(INSPECTION_TYPES),
  odometer: z.coerce.number().min(0).max(5_000_000).optional(),
  items: z
    .array(z.object({ key: z.string().min(1).max(40), result: z.enum(['pass', 'fail', 'na']), note: optionalText(255) }))
    .min(1)
    .max(60),
  sealNumbers: z.array(z.string().trim().toUpperCase().regex(/^[A-Z0-9-]{3,40}$/, 'Seal numbers are 3–40 letters/digits')).max(10).default([]),
  notes: optionalText(500),
});

export const tripEventInputSchema = z.object({
  eventType: z.enum(MANUAL_TRIP_EVENTS),
  stopId: idSchema.optional(),
  note: optionalText(500),
  lat: z.coerce.number().min(-90).max(90).optional(),
  lng: z.coerce.number().min(-180).max(180).optional(),
  odometer: z.coerce.number().min(0).max(5_000_000).optional(),
});

const podBase = {
  recipientName: z.string().trim().min(2, 'Enter who received the goods').max(120),
  recipientPhone: z.preprocess((v) => (v === '' ? null : v), z.string().trim().max(32).nullable().optional()),
  remarks: optionalText(500),
  damageReported: z.boolean().default(false),
  shortageReported: z.boolean().default(false),
  /** Were all cargo seals found intact? Required when seals were applied. */
  sealsIntact: z.boolean().optional(),
  signatureFileId: idSchema.nullable().optional(),
  photoFileIds: z.array(idSchema).max(10).default([]),
};

export const podOtpSchema = z.object({ ...podBase, otp: z.string().trim().regex(/^\d{6}$/, 'The OTP has 6 digits') });
export const podOverrideSchema = z.object({
  ...podBase,
  reason: z.string().trim().min(10, 'Explain why OTP verification is being bypassed').max(255),
});

export const TRIP_SORT_FIELDS = ['tripNo', 'plannedStart', 'status'] as const;
export const tripListQuerySchema = listQuerySchema(TRIP_SORT_FIELDS).extend({
  status: z.enum(TRIP_STATUSES).optional(),
  active: z.enum(['true', 'false']).optional(),
  vehicleId: idSchema.optional(),
  driverId: idSchema.optional(),
  bookingId: idSchema.optional(),
  from: isoDateSchema.optional(),
  to: isoDateSchema.optional(),
});
export type TripListQuery = z.infer<typeof tripListQuerySchema>;

export const candidatesQuerySchema = z
  .object({
    bookingId: idSchema.optional(),
    tripId: idSchema.optional(),
    plannedStart: isoDateTimeSchema,
    plannedEnd: isoDateTimeSchema,
  })
  .refine((a) => Date.parse(a.plannedEnd) > Date.parse(a.plannedStart), { message: 'Planned end must be after the start', path: ['plannedEnd'] });

// ------------------------------------------------------------------ DTOs

export interface AssignmentCheckDto {
  ok: boolean;
  blocks: Violation[];
  warnings: Violation[];
  /** True when the caller may override the warnings (trips:override_warnings). */
  canOverride: boolean;
}

export interface CandidateDto {
  id: number;
  label: string;
  detail: string;
  blocks: Violation[];
  warnings: Violation[];
}

export interface CandidatesDto {
  vehicles: CandidateDto[];
  drivers: CandidateDto[];
  helpers: CandidateDto[];
}

export interface TripListItemDto {
  id: number;
  tripNo: string;
  tripType: TripType;
  status: TripStatus;
  booking: { id: number; bookingNo: string; customerName: string; lrNumber: string | null } | null;
  vehicle: { id: number; registrationNo: string };
  driver: { id: number; fullName: string; phone: string };
  originCity: string;
  destinationCity: string;
  plannedStart: string;
  plannedEnd: string;
  actualStart: string | null;
  deliveredAt: string | null;
}

export interface TripStopDto {
  id: number;
  seq: number;
  stopType: StopType;
  name: string;
  addressLine: string | null;
  city: string;
  lat: number | null;
  lng: number | null;
  contactName: string | null;
  contactPhone: string | null;
  plannedArrival: string | null;
  actualArrival: string | null;
  actualDeparture: string | null;
  status: 'pending' | 'arrived' | 'departed' | 'skipped';
}

export interface TripEventDto {
  id: number;
  eventType: TripEventType;
  occurredAt: string;
  note: string | null;
  stopId: number | null;
  odometer: number | null;
  recordedBy: string | null;
  source: 'web' | 'driver_app' | 'system' | 'simulated';
}

export interface InspectionDto {
  id: number;
  inspectionType: InspectionType;
  inspectedAt: string;
  inspectedBy: string | null;
  odometer: number | null;
  result: 'pass' | 'fail';
  items: { key: string; label: string; critical: boolean; result: 'pass' | 'fail' | 'na'; note?: string }[];
  notes: string | null;
}

export interface PodDto {
  method: PodMethod;
  recipientName: string;
  recipientPhone: string | null;
  deliveredAt: string;
  overrideReason: string | null;
  damageReported: boolean;
  shortageReported: boolean;
  remarks: string | null;
  signatureFileId: number | null;
  photoFileIds: number[];
  recordedBy: string | null;
}

export interface TripDto extends TripListItemDto {
  parentTripId: number | null;
  holdFromStatus: TripStatus | null;
  holdReason: string | null;
  cancelReason: string | null;
  overrideReason: string | null;
  vehicle: { id: number; registrationNo: string; vehicleType: string; requiredLicenceClass: LicenceClass; status: VehicleStatus; payloadCapacityKg: number };
  crew: { workerId: number; fullName: string; role: 'co_driver' | 'helper'; phone: string }[];
  route: { id: number; name: string; distanceKm: number; polyline: [number, number][] } | null;
  completedAt: string | null;
  startOdometer: number | null;
  endOdometer: number | null;
  plannedDistanceKm: number | null;
  podStatus: 'pending' | 'verified_otp' | 'override' | 'not_required';
  otpActive: boolean;
  otpAttemptsLeft: number;
  notes: string | null;
  stops: TripStopDto[];
  events: TripEventDto[];
  history: { fromStatus: TripStatus | null; toStatus: TripStatus; changedBy: string | null; reason: string | null; at: string }[];
  inspections: InspectionDto[];
  seals: { sealNo: string; appliedAt: string; intact: boolean | null; verifiedAt: string | null }[];
  pod: PodDto | null;
  cargoWeightKg: number;
  availableActions: TripAction[];
  version: number;
}

/** Returned once when an OTP is issued; never retrievable again. */
export interface OtpIssuedDto {
  otp: string;
  expiresAt: string;
  delivery: { channel: 'sms'; to: string | null; status: string };
}
