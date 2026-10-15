import { z } from 'zod';
import { BODY_TYPES, type BodyType } from '../enums.js';
import {
  BOOKING_STATUSES,
  CARGO_CATEGORIES,
  CHARGE_TYPES,
  RATE_BASES,
  STOP_TYPES,
  type BookingStatus,
  type CargoCategory,
  type ChargeType,
  type RateBasis,
  type StopType,
  type TripStatus,
} from '../enums-ops.js';
import type { BookingAction } from '../rules/booking-state.js';
import { idSchema, isoDateSchema, listQuerySchema, optionalText } from './common.js';
import { phoneSchema } from './workers.js';

const blank = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? null : v);
export const isoDateTimeSchema = z.iso.datetime({ offset: true, message: 'Enter a valid date and time' });
const optionalDateTime = z.preprocess(blank, isoDateTimeSchema.nullable().optional());

export const bookingStopInputSchema = z.object({
  stopType: z.enum(STOP_TYPES),
  locationId: idSchema.nullable().optional(),
  name: z.string().trim().min(2, 'Name the stop').max(140),
  addressLine: optionalText(255),
  city: z.string().trim().min(2, 'Enter the city').max(80),
  state: optionalText(80),
  pincode: z.preprocess(blank, z.string().regex(/^\d{6}$/, 'Use a 6-digit PIN code').nullable().optional()),
  lat: z.coerce.number().min(-90).max(90).nullable().optional(),
  lng: z.coerce.number().min(-180).max(180).nullable().optional(),
  contactName: optionalText(120),
  contactPhone: z.preprocess(blank, phoneSchema.nullable().optional()),
  windowStart: optionalDateTime,
  windowEnd: optionalDateTime,
  instructions: optionalText(255),
});

export const cargoItemInputSchema = z.object({
  description: z.string().trim().min(2, 'Describe the cargo').max(200),
  category: z.enum(CARGO_CATEGORIES).default('general'),
  hsnCode: z.preprocess(blank, z.string().regex(/^\d{4,8}$/, 'HSN is 4–8 digits').nullable().optional()),
  quantity: z.coerce.number({ message: 'Enter a quantity' }).positive('Must be greater than 0').max(10_000_000),
  unit: z.string().trim().min(1).max(16),
  weightKg: z.coerce.number({ message: 'Enter the weight' }).positive('Weight must be greater than 0').max(200_000),
  volumeCbm: z.coerce.number().positive().max(10_000).nullable().optional(),
  packaging: optionalText(40),
  declaredValue: z.coerce.number().min(0).max(10_000_000_000).nullable().optional(),
  handling: optionalText(255),
});

export const bookingChargeInputSchema = z.object({
  chargeType: z.enum(CHARGE_TYPES),
  description: optionalText(120),
  amount: z.coerce.number().min(0).max(100_000_000),
  isTaxable: z.boolean().default(true),
});

/**
 * Full booking payload (create and replace). Origin/destination cities are derived from the first
 * pickup and last drop, and the hazardous flag is forced on when any cargo item is hazardous.
 */
export const bookingInputSchema = z
  .object({
    customerId: idSchema,
    customerRef: optionalText(60),
    routeId: idSchema.nullable().optional(),
    requiredVehicleTypeId: idSchema.nullable().optional(),
    requiredBodyType: z.preprocess(blank, z.enum(BODY_TYPES).nullable().optional()),
    requiresTemperatureControl: z.boolean().default(false),
    isHazardous: z.boolean().default(false),
    loadingWindowStart: isoDateTimeSchema,
    loadingWindowEnd: optionalDateTime,
    deliveryDeadline: isoDateTimeSchema,
    ewayBillNo: z.preprocess(blank, z.string().regex(/^\d{12}$/, 'E-way bill numbers are 12 digits').nullable().optional()),
    ewayBillExpiresAt: optionalDateTime,
    rateBasis: z.preprocess(blank, z.enum(RATE_BASES).nullable().optional()),
    rate: z.coerce.number().positive().max(100_000_000).nullable().optional(),
    paymentTermsDays: z.coerce.number().int().min(0).max(365).nullable().optional(),
    specialInstructions: optionalText(2000),
    notes: optionalText(2000),
    stops: z.array(bookingStopInputSchema).min(2, 'Add a pickup and a drop').max(20),
    cargo: z.array(cargoItemInputSchema).min(1, 'Add at least one cargo item').max(50),
    charges: z.array(bookingChargeInputSchema).max(20).default([]),
  })
  .superRefine((b, ctx) => {
    if (b.stops[0]?.stopType !== 'pickup') ctx.addIssue({ code: 'custom', message: 'The first stop must be a pickup', path: ['stops', 0, 'stopType'] });
    if (b.stops[b.stops.length - 1]?.stopType !== 'drop') {
      ctx.addIssue({ code: 'custom', message: 'The last stop must be a drop', path: ['stops', b.stops.length - 1, 'stopType'] });
    }
    if (Date.parse(b.deliveryDeadline) <= Date.parse(b.loadingWindowStart)) {
      ctx.addIssue({ code: 'custom', message: 'Delivery deadline must be after loading starts', path: ['deliveryDeadline'] });
    }
    if (b.loadingWindowEnd && Date.parse(b.loadingWindowEnd) < Date.parse(b.loadingWindowStart)) {
      ctx.addIssue({ code: 'custom', message: 'Loading window ends before it starts', path: ['loadingWindowEnd'] });
    }
    if ((b.rateBasis && b.rate == null) || (!b.rateBasis && b.rate != null)) {
      ctx.addIssue({ code: 'custom', message: 'Set both the rate basis and the rate, or neither', path: ['rate'] });
    }
  });
export type BookingInput = z.infer<typeof bookingInputSchema>;

export const bookingQuoteSchema = z.object({
  rateBasis: z.enum(RATE_BASES),
  rate: z.coerce.number().positive().max(100_000_000),
  distanceKm: z.coerce.number().positive().max(5000).optional(),
});

export const bookingActionSchema = z.object({
  action: z.enum(['approve', 'hold', 'resume', 'cancel', 'close']),
  reason: optionalText(255),
  /** Approve only: the agreed amount, defaulting to the quote. */
  approvedAmount: z.coerce.number().positive().max(100_000_000).optional(),
});

export const BOOKING_SORT_FIELDS = ['bookingNo', 'loadingWindowStart', 'deliveryDeadline', 'createdAt'] as const;
export const bookingListQuerySchema = listQuerySchema(BOOKING_SORT_FIELDS).extend({
  status: z.enum(BOOKING_STATUSES).optional(),
  customerId: idSchema.optional(),
  /** Approved bookings with no live trip: the dispatch planning queue. */
  unassigned: z.enum(['true', 'false']).optional(),
  from: isoDateSchema.optional(),
  to: isoDateSchema.optional(),
});
export type BookingListQuery = z.infer<typeof bookingListQuerySchema>;

// ------------------------------------------------------------------ DTOs

export interface BookingStopDto {
  id: number;
  seq: number;
  stopType: StopType;
  locationId: number | null;
  name: string;
  addressLine: string | null;
  city: string;
  state: string | null;
  pincode: string | null;
  lat: number | null;
  lng: number | null;
  contactName: string | null;
  contactPhone: string | null;
  windowStart: string | null;
  windowEnd: string | null;
  instructions: string | null;
}

export interface CargoItemDto {
  id: number;
  description: string;
  category: CargoCategory;
  hsnCode: string | null;
  quantity: number;
  unit: string;
  weightKg: number;
  volumeCbm: number | null;
  packaging: string | null;
  declaredValue: string | null;
  handling: string | null;
}

export interface BookingChargeDto {
  id: number;
  chargeType: ChargeType;
  description: string | null;
  amount: string;
  isTaxable: boolean;
}

export interface BookingListItemDto {
  id: number;
  bookingNo: string;
  status: BookingStatus;
  customer: { id: number; name: string };
  customerRef: string | null;
  originCity: string;
  destinationCity: string;
  loadingWindowStart: string;
  deliveryDeadline: string;
  totalWeightKg: number;
  quotedAmount: string | null;
  approvedAmount: string | null;
  lrNumber: string | null;
  trip: { id: number; tripNo: string; status: TripStatus } | null;
}

export interface BookingDto extends BookingListItemDto {
  routeId: number | null;
  requiredVehicleType: { id: number; name: string } | null;
  requiredBodyType: BodyType | null;
  requiresTemperatureControl: boolean;
  isHazardous: boolean;
  totalVolumeCbm: number | null;
  loadingWindowEnd: string | null;
  ewayBillNo: string | null;
  ewayBillExpiresAt: string | null;
  rateBasis: RateBasis | null;
  rate: string | null;
  paymentTermsDays: number | null;
  specialInstructions: string | null;
  notes: string | null;
  holdReason: string | null;
  cancelReason: string | null;
  quotedAt: string | null;
  approvedAt: string | null;
  createdAt: string;
  stops: BookingStopDto[];
  cargo: CargoItemDto[];
  charges: BookingChargeDto[];
  /** Actions the caller may take now (UI hint; the API re-checks). */
  availableActions: BookingAction[];
  editable: boolean;
  version: number;
}
