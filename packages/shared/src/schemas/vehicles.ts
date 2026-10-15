import { z } from 'zod';
import {
  BODY_TYPES,
  FUEL_TYPES,
  LICENCE_CLASSES,
  MANUAL_VEHICLE_STATUSES,
  VEHICLE_DOC_TYPES,
  VEHICLE_OWNERSHIP,
  VEHICLE_STATUSES,
  type BodyType,
  type FuelType,
  type LicenceClass,
  type VehicleDocType,
  type VehicleOwnership,
  type VehicleStatus,
} from '../enums.js';
import { idSchema, isoDateSchema, listQuerySchema, optionalText } from './common.js';

/** Normalises "tn-01 ab 1234" to "TN01AB1234" so the same plate can't be registered twice. */
export function normaliseRegistration(input: string): string {
  return input.toUpperCase().replace(/[\s-]/g, '');
}

const registrationSchema = z
  .string()
  .transform(normaliseRegistration)
  .pipe(z.string().regex(/^[A-Z0-9]{4,15}$/, 'Registration must be 4–15 letters/digits'));

const positiveDecimal = (max: number) =>
  z.coerce
    .number({ message: 'Enter a number' })
    .positive('Must be greater than 0')
    .max(max, `Must be at most ${max.toLocaleString('en-IN')}`);

export const vehicleTypeInputSchema = z.object({
  name: z.string().trim().min(2).max(80),
  bodyType: z.enum(BODY_TYPES),
  requiredLicenceClass: z.enum(LICENCE_CLASSES),
  defaultPayloadKg: positiveDecimal(100_000).nullable().optional(),
  isActive: z.boolean().optional(),
});
export type VehicleTypeInput = z.infer<typeof vehicleTypeInputSchema>;

// Field definitions without defaults. Defaults belong only to *create*: applying them on a partial
// update would silently overwrite stored values (e.g. reset the odometer to 0).
const vehicleFields = {
  registrationNo: registrationSchema,
  vehicleTypeId: idSchema,
  branchId: idSchema.nullable().optional(),
  make: optionalText(60),
  model: optionalText(60),
  year: z.coerce
    .number({ message: 'Enter a year' })
    .int('Enter a whole year')
    .min(1980, 'Year must be 1980 or later')
    .max(new Date().getFullYear() + 1, 'Year cannot be in the future')
    .nullable()
    .optional(),
  ownership: z.enum(VEHICLE_OWNERSHIP),
  payloadCapacityKg: positiveDecimal(100_000),
  volumeCapacityCbm: positiveDecimal(1_000).nullable().optional(),
  fuelType: z.enum(FUEL_TYPES),
  odometerKm: z.coerce.number({ message: 'Enter a number' }).min(0, 'Cannot be negative').max(5_000_000, 'Must be at most 50,00,000'),
  fuelEfficiencyKmpl: positiveDecimal(50).nullable().optional(),
  notes: optionalText(2000),
};

export const vehicleCreateSchema = z.object({
  ...vehicleFields,
  ownership: vehicleFields.ownership.default('owned'),
  fuelType: vehicleFields.fuelType.default('diesel'),
  odometerKm: vehicleFields.odometerKm.default(0),
});
export type VehicleCreateInput = z.infer<typeof vehicleCreateSchema>;

export const vehicleUpdateSchema = z
  .object(vehicleFields)
  .partial()
  .extend({ status: z.enum(MANUAL_VEHICLE_STATUSES).optional() })
  .refine((v) => Object.values(v).some((x) => x !== undefined), 'Provide at least one field to update');
export type VehicleUpdateInput = z.infer<typeof vehicleUpdateSchema>;

export const VEHICLE_SORT_FIELDS = ['registrationNo', 'status', 'payloadCapacityKg', 'createdAt'] as const;

export const vehicleListQuerySchema = listQuerySchema(VEHICLE_SORT_FIELDS).extend({
  status: z.enum(VEHICLE_STATUSES).optional(),
  vehicleTypeId: idSchema.optional(),
  compliance: z.enum(['expired', 'expiring', 'ok']).optional(),
});
export type VehicleListQuery = z.infer<typeof vehicleListQuerySchema>;

export const vehicleDocumentInputSchema = z
  .object({
    docType: z.enum(VEHICLE_DOC_TYPES),
    documentNo: optionalText(80),
    issuedOn: isoDateSchema.nullable().optional(),
    expiresOn: isoDateSchema.nullable().optional(),
    fileId: idSchema.nullable().optional(),
    notes: optionalText(255),
  })
  .refine((d) => !d.issuedOn || !d.expiresOn || d.issuedOn <= d.expiresOn, {
    message: 'Expiry date cannot be before the issue date',
    path: ['expiresOn'],
  });
export type VehicleDocumentInput = z.infer<typeof vehicleDocumentInputSchema>;

// ------------------------------------------------------------------ response shapes

export interface VehicleTypeDto {
  id: number;
  name: string;
  bodyType: BodyType;
  requiredLicenceClass: LicenceClass;
  defaultPayloadKg: number | null;
  isActive: boolean;
}

export type ComplianceState = 'ok' | 'expiring' | 'expired' | 'missing';

export interface VehicleComplianceSummary {
  state: ComplianceState;
  /** Earliest expiry among mandatory documents, if any are on file. */
  nextExpiry: string | null;
  expired: VehicleDocType[];
  expiringSoon: VehicleDocType[];
  missing: VehicleDocType[];
}

export interface VehicleDto {
  id: number;
  registrationNo: string;
  vehicleType: Pick<VehicleTypeDto, 'id' | 'name' | 'bodyType' | 'requiredLicenceClass'>;
  branch: { id: number; name: string } | null;
  make: string | null;
  model: string | null;
  year: number | null;
  ownership: VehicleOwnership;
  payloadCapacityKg: number;
  volumeCapacityCbm: number | null;
  fuelType: FuelType;
  odometerKm: number;
  fuelEfficiencyKmpl: number | null;
  status: VehicleStatus;
  notes: string | null;
  compliance: VehicleComplianceSummary;
  createdAt: string;
  updatedAt: string;
}

export interface VehicleFleetSummary {
  total: number;
  byStatus: Record<VehicleStatus, number>;
  /** Non-retired vehicles by compliance state. */
  compliance: Record<ComplianceState, number>;
  /** Org-local date the compliance figures were computed for. */
  asOf: string;
  expiryWarningDays: number;
}

export interface VehicleDocumentDto {
  id: number;
  vehicleId: number;
  docType: VehicleDocType;
  documentNo: string | null;
  issuedOn: string | null;
  expiresOn: string | null;
  fileId: number | null;
  notes: string | null;
  createdAt: string;
}
