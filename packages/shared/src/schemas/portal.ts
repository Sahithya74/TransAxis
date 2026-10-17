import { z } from 'zod';
import type { BookingStatus, TripStatus } from '../enums-ops.js';
import { CARGO_CATEGORIES } from '../enums-ops.js';
import type { EtaDto } from '../rules/eta.js';
import { isoDateTimeSchema } from './bookings.js';
import { optionalText } from './common.js';
import { phoneSchema } from './workers.js';

const place = z.object({
  name: z.string().trim().min(2, 'Name the place').max(140),
  addressLine: optionalText(255),
  city: z.string().trim().min(2, 'Enter the city').max(80),
  pincode: z.preprocess((v) => (v === '' ? null : v), z.string().regex(/^\d{6}$/, 'Use a 6-digit PIN code').nullable().optional()),
  contactName: optionalText(120),
  contactPhone: z.preprocess((v) => (v === '' ? null : v), phoneSchema.nullable().optional()),
});

/** A shipment request from the customer portal; dispatch turns it into a priced booking. */
export const portalRequestSchema = z
  .object({
    customerRef: optionalText(60),
    pickup: place,
    drop: place,
    loadingWindowStart: isoDateTimeSchema,
    deliveryDeadline: isoDateTimeSchema,
    cargoDescription: z.string().trim().min(2, 'Describe the goods').max(200),
    category: z.enum(CARGO_CATEGORIES).default('general'),
    quantity: z.coerce.number({ message: 'Enter a quantity' }).positive().max(10_000_000),
    unit: z.string().trim().min(1).max(16),
    weightKg: z.coerce.number({ message: 'Enter the weight' }).positive().max(200_000),
    declaredValue: z.coerce.number().min(0).max(10_000_000_000).nullable().optional(),
    specialInstructions: optionalText(2000),
  })
  .refine((r) => Date.parse(r.deliveryDeadline) > Date.parse(r.loadingWindowStart), { message: 'Delivery must be after loading', path: ['deliveryDeadline'] });

export interface PortalSummaryDto {
  customer: { id: number; name: string };
  activeBookings: number;
  inTransit: number;
  deliveredLast30Days: number;
  outstanding: string;
  overdue: string;
}

export interface PortalTrackingDto {
  bookingId: number;
  bookingNo: string;
  status: BookingStatus;
  lrNumber: string | null;
  trip: {
    tripNo: string;
    status: TripStatus;
    vehicleNo: string;
    driverName: string;
    plannedEnd: string;
    actualStart: string | null;
    deliveredAt: string | null;
  } | null;
  /** Shown only while the goods are on the road. */
  position: { lat: number; lng: number; recordedAt: string; isSimulated: boolean } | null;
  eta: EtaDto | null;
  milestones: { label: string; at: string }[];
  pod: { recipientName: string; deliveredAt: string; method: 'otp' | 'override' } | null;
}
