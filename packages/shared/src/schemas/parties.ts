import { z } from 'zod';
import {
  LOCATION_TYPES,
  PARTY_STATUSES,
  RATE_BASES,
  VENDOR_TYPES,
  type LocationType,
  type PartyStatus,
  type RateBasis,
  type VendorType,
} from '../enums-ops.js';
import { idSchema, isoDateSchema, listQuerySchema, optionalText } from './common.js';
import { phoneSchema } from './workers.js';

const blank = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? null : v);
export const gstinSchema = z.preprocess(
  blank,
  z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/, 'Enter a valid 15-character GSTIN')
    .nullable()
    .optional(),
);
export const panSchema = z.preprocess(
  blank,
  z.string().trim().toUpperCase().regex(/^[A-Z]{5}\d{4}[A-Z]$/, 'Enter a valid PAN').nullable().optional(),
);
const pincode = z.preprocess(blank, z.string().regex(/^\d{6}$/, 'Use a 6-digit PIN code').nullable().optional());
const optionalPhone = z.preprocess(blank, phoneSchema.nullable().optional());
const optionalEmail = z.preprocess(blank, z.string().trim().toLowerCase().email('Enter a valid email').max(190).nullable().optional());
const code = z.string().trim().toUpperCase().regex(/^[A-Z0-9-]{2,24}$/, 'Use 2–24 letters, digits or dashes');
const lat = z.coerce.number().min(-90).max(90);
const lng = z.coerce.number().min(-180).max(180);

const customerFields = {
  code,
  name: z.string().trim().min(2).max(160),
  legalName: optionalText(200),
  gstin: gstinSchema,
  pan: panSchema,
  billingAddress: optionalText(255),
  city: optionalText(80),
  state: optionalText(80),
  pincode,
  phone: optionalPhone,
  email: optionalEmail,
  paymentTermsDays: z.coerce.number().int().min(0).max(365),
  creditLimit: z.coerce.number().min(0).max(1_000_000_000).nullable().optional(),
  status: z.enum(PARTY_STATUSES),
  notes: optionalText(2000),
};
export const customerCreateSchema = z.object({
  ...customerFields,
  paymentTermsDays: customerFields.paymentTermsDays.default(30),
  status: customerFields.status.default('active'),
});
export const customerUpdateSchema = z.object(customerFields).partial().refine((v) => Object.values(v).some((x) => x !== undefined), 'Nothing to update');
export const customerListQuerySchema = listQuerySchema(['name', 'code', 'createdAt'] as const).extend({ status: z.enum(PARTY_STATUSES).optional() });

export const contactInputSchema = z.object({
  name: z.string().trim().min(2).max(120),
  designation: optionalText(80),
  phone: optionalPhone,
  email: optionalEmail,
  isPrimary: z.boolean().default(false),
});

const vendorFields = {
  code,
  name: z.string().trim().min(2).max(160),
  vendorType: z.enum(VENDOR_TYPES),
  gstin: gstinSchema,
  pan: panSchema,
  address: optionalText(255),
  city: optionalText(80),
  state: optionalText(80),
  contactName: optionalText(120),
  phone: optionalPhone,
  email: optionalEmail,
  paymentTermsDays: z.coerce.number().int().min(0).max(365),
  status: z.enum(PARTY_STATUSES),
  notes: optionalText(2000),
};
export const vendorCreateSchema = z.object({
  ...vendorFields,
  paymentTermsDays: vendorFields.paymentTermsDays.default(30),
  status: vendorFields.status.default('active'),
});
export const vendorUpdateSchema = z.object(vendorFields).partial().refine((v) => Object.values(v).some((x) => x !== undefined), 'Nothing to update');
export const vendorListQuerySchema = listQuerySchema(['name', 'code', 'vendorType'] as const).extend({
  vendorType: z.enum(VENDOR_TYPES).optional(),
  status: z.enum(PARTY_STATUSES).optional(),
});

export const locationInputSchema = z.object({
  name: z.string().trim().min(2).max(140),
  locationType: z.enum(LOCATION_TYPES),
  customerId: idSchema.nullable().optional(),
  addressLine: optionalText(255),
  city: z.string().trim().min(2).max(80),
  state: optionalText(80),
  pincode,
  lat: lat.nullable().optional(),
  lng: lng.nullable().optional(),
  contactName: optionalText(120),
  contactPhone: optionalPhone,
  isActive: z.boolean().default(true),
});
export const locationListQuerySchema = z.object({
  customerId: idSchema.optional(),
  city: z.string().trim().max(80).optional(),
  q: z.string().trim().max(100).optional(),
});

export const routeInputSchema = z.object({
  name: z.string().trim().min(2).max(120),
  originCity: z.string().trim().min(2).max(80),
  destinationCity: z.string().trim().min(2).max(80),
  distanceKm: z.coerce.number().positive().max(5000),
  expectedDurationMin: z.coerce.number().int().positive().max(10_000),
  polyline: z.array(z.tuple([lat, lng])).min(2, 'A route needs at least two points').max(2000),
  tollEstimate: z.coerce.number().min(0).max(1_000_000).nullable().optional(),
  isActive: z.boolean().default(true),
});

export const rateCardInputSchema = z
  .object({
    originCity: z.string().trim().min(2).max(80),
    destinationCity: z.string().trim().min(2).max(80),
    vehicleTypeId: idSchema.nullable().optional(),
    rateBasis: z.enum(RATE_BASES),
    rate: z.coerce.number().positive().max(10_000_000),
    loadingCharge: z.coerce.number().min(0).max(1_000_000).default(0),
    unloadingCharge: z.coerce.number().min(0).max(1_000_000).default(0),
    detentionFreeHours: z.coerce.number().int().min(0).max(240).default(24),
    detentionRatePerHour: z.coerce.number().min(0).max(100_000).default(0),
    validFrom: isoDateSchema,
    validTo: isoDateSchema.nullable().optional(),
    notes: optionalText(255),
  })
  .refine((r) => !r.validTo || r.validTo >= r.validFrom, { message: 'Ends before it starts', path: ['validTo'] });

export const quoteRequestSchema = z.object({
  customerId: idSchema,
  originCity: z.string().trim().min(2).max(80),
  destinationCity: z.string().trim().min(2).max(80),
  vehicleTypeId: idSchema.optional(),
  totalWeightKg: z.coerce.number().min(0).max(200_000),
  distanceKm: z.coerce.number().positive().max(5000).optional(),
  onDate: isoDateSchema.optional(),
});

// ------------------------------------------------------------------ DTOs

export interface CustomerDto {
  id: number;
  code: string;
  name: string;
  legalName: string | null;
  gstin: string | null;
  pan: string | null;
  billingAddress: string | null;
  city: string | null;
  state: string | null;
  pincode: string | null;
  phone: string | null;
  email: string | null;
  paymentTermsDays: number;
  creditLimit: string | null;
  status: PartyStatus;
  notes: string | null;
  openBookings: number;
  createdAt: string;
}

export interface ContactDto {
  id: number;
  name: string;
  designation: string | null;
  phone: string | null;
  email: string | null;
  isPrimary: boolean;
}

export interface VendorDto {
  id: number;
  code: string;
  name: string;
  vendorType: VendorType;
  gstin: string | null;
  pan: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  contactName: string | null;
  phone: string | null;
  email: string | null;
  paymentTermsDays: number;
  status: PartyStatus;
  notes: string | null;
}

export interface LocationDto {
  id: number;
  name: string;
  locationType: LocationType;
  customer: { id: number; name: string } | null;
  addressLine: string | null;
  city: string;
  state: string | null;
  pincode: string | null;
  lat: number | null;
  lng: number | null;
  contactName: string | null;
  contactPhone: string | null;
  isActive: boolean;
}

export interface RouteDto {
  id: number;
  name: string;
  originCity: string;
  destinationCity: string;
  distanceKm: number;
  expectedDurationMin: number;
  polyline: [number, number][];
  tollEstimate: string | null;
  isActive: boolean;
}

export interface RateCardDto {
  id: number;
  customerId: number;
  originCity: string;
  destinationCity: string;
  vehicleType: { id: number; name: string } | null;
  rateBasis: RateBasis;
  rate: string;
  loadingCharge: string;
  unloadingCharge: string;
  detentionFreeHours: number;
  detentionRatePerHour: string;
  validFrom: string;
  validTo: string | null;
  notes: string | null;
}

export interface QuoteDto {
  rateCard: RateCardDto | null;
  /** Null when no active rate card matches; the dispatcher then prices manually. */
  quote: { total: string; lines: { label: string; formula: string; amount: string }[] } | null;
  message: string;
}
