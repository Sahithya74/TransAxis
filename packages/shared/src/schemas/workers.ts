import { z } from 'zod';
import { LICENCE_CLASSES, type LicenceClass } from '../enums.js';
import {
  ATTENDANCE_STATUSES,
  COMPENSATION_BASES,
  EMPLOYMENT_STATUSES,
  LEAVE_TYPES,
  TRAINING_TYPES,
  WORKER_DOC_TYPES,
  WORKER_TYPES,
  type AttendanceStatus,
  type CompensationBasis,
  type EmploymentStatus,
  type LeaveStatus,
  type LeaveType,
  type LicenceVerification,
  type TrainingType,
  type TripStatus,
  type WorkerDocType,
  type WorkerType,
} from '../enums-ops.js';
import { idSchema, isoDateSchema, listQuerySchema, optionalText } from './common.js';

export const phoneSchema = z
  .string()
  .trim()
  .regex(/^\+?[\d\s-]{7,20}$/, 'Enter a valid phone number');

const optionalPhone = z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? null : v), phoneSchema.nullable().optional());
const optionalDate = isoDateSchema.nullable().optional();
const money = (max = 10_000_000) => z.coerce.number({ message: 'Enter an amount' }).min(0, 'Cannot be negative').max(max);

const workerFields = {
  employeeCode: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9-]{2,24}$/, 'Use 2–24 letters, digits or dashes'),
  workerType: z.enum(WORKER_TYPES),
  fullName: z.string().trim().min(2, 'Enter the full name').max(140),
  phone: phoneSchema,
  altPhone: optionalPhone,
  branchId: idSchema.nullable().optional(),
  dateOfBirth: optionalDate,
  address: optionalText(255),
  bloodGroup: z.preprocess((v) => (v === '' ? null : v), z.enum(['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-']).nullable().optional()),
  emergencyContactName: optionalText(120),
  emergencyContactPhone: optionalPhone,
  emergencyContactRelation: optionalText(40),
  baseMonthlySalary: money().nullable().optional(),
  employmentStatus: z.enum(EMPLOYMENT_STATUSES),
  joinedOn: optionalDate,
  leftOn: optionalDate,
  compensationPolicyId: idSchema.nullable().optional(),
  medicalValidUntil: optionalDate,
  notes: optionalText(2000),
};

export const workerCreateSchema = z.object({ ...workerFields, employmentStatus: workerFields.employmentStatus.default('active') });
export type WorkerCreateInput = z.infer<typeof workerCreateSchema>;

export const workerUpdateSchema = z
  .object(workerFields)
  .partial()
  .refine((v) => Object.values(v).some((x) => x !== undefined), 'Provide at least one field to update');
export type WorkerUpdateInput = z.infer<typeof workerUpdateSchema>;

export const WORKER_SORT_FIELDS = ['fullName', 'employeeCode', 'workerType', 'licenceValidUntil'] as const;
export const workerListQuerySchema = listQuerySchema(WORKER_SORT_FIELDS).extend({
  workerType: z.enum(WORKER_TYPES).optional(),
  status: z.enum(EMPLOYMENT_STATUSES).optional(),
  licence: z.enum(['expired', 'expiring', 'missing', 'ok']).optional(),
  branchId: idSchema.optional(),
});
export type WorkerListQuery = z.infer<typeof workerListQuerySchema>;

export const licenceInputSchema = z
  .object({
    licenceNo: z.string().trim().toUpperCase().min(5, 'Enter the licence number').max(32),
    issuingState: optionalText(60),
    issuedOn: optionalDate,
    validUntil: isoDateSchema,
    classes: z.array(z.enum(LICENCE_CLASSES)).min(1, 'Select at least one class').max(LICENCE_CLASSES.length),
    fileId: idSchema.nullable().optional(),
  })
  .refine((l) => !l.issuedOn || l.issuedOn <= l.validUntil, { message: 'Validity ends before the issue date', path: ['validUntil'] });
export type LicenceInput = z.infer<typeof licenceInputSchema>;

export const licenceVerificationSchema = z.object({ verification: z.enum(['verified', 'rejected']) });

export const workerDocumentInputSchema = z.object({
  docType: z.enum(WORKER_DOC_TYPES),
  documentNo: optionalText(80),
  expiresOn: optionalDate,
  fileId: idSchema.nullable().optional(),
  notes: optionalText(255),
});

export const trainingInputSchema = z
  .object({
    trainingType: z.enum(TRAINING_TYPES),
    completedOn: isoDateSchema,
    validUntil: optionalDate,
    provider: optionalText(120),
    notes: optionalText(255),
  })
  .refine((t) => !t.validUntil || t.validUntil >= t.completedOn, { message: 'Validity ends before completion', path: ['validUntil'] });

export const leaveRequestSchema = z
  .object({
    workerId: idSchema,
    leaveType: z.enum(LEAVE_TYPES),
    fromDate: isoDateSchema,
    toDate: isoDateSchema,
    reason: optionalText(255),
  })
  .refine((l) => l.fromDate <= l.toDate, { message: 'End date is before start date', path: ['toDate'] });

export const leaveDecisionSchema = z.object({
  decision: z.enum(['approved', 'rejected', 'cancelled']),
  note: optionalText(255),
});

export const leaveListQuerySchema = z.object({
  status: z.enum(['pending', 'approved', 'rejected', 'cancelled']).optional(),
  workerId: idSchema.optional(),
  from: isoDateSchema.optional(),
  to: isoDateSchema.optional(),
});

export const attendanceUpsertSchema = z.object({
  workDate: isoDateSchema,
  entries: z
    .array(z.object({ workerId: idSchema, status: z.enum(ATTENDANCE_STATUSES), notes: optionalText(255) }))
    .min(1)
    .max(500),
});

export const compensationPolicyInputSchema = z.object({
  name: z.string().trim().min(2).max(100),
  appliesTo: z.enum(['driver', 'helper']),
  basis: z.enum(COMPENSATION_BASES),
  rate: z.coerce.number().min(0).max(1_000_000),
  dailyAllowance: money(100_000).default(0),
  onTimeBonus: money(100_000).default(0),
  minPerTrip: money(1_000_000).nullable().optional(),
  effectiveFrom: isoDateSchema,
  isActive: z.boolean().default(true),
  notes: optionalText(255),
});

// ------------------------------------------------------------------ DTOs

export type LicenceState = 'ok' | 'expiring' | 'expired' | 'missing' | 'not_required';

export interface LicenceDto {
  id: number;
  /** Full number only for holders of workers:sensitive; otherwise masked (e.g. "••••••••3021"). */
  licenceNo: string;
  issuingState: string | null;
  issuedOn: string | null;
  validUntil: string;
  classes: LicenceClass[];
  verification: LicenceVerification;
  verifiedOn: string | null;
  fileId: number | null;
}

export interface WorkerSensitiveDto {
  dateOfBirth: string | null;
  address: string | null;
  bloodGroup: string | null;
  emergencyContactName: string | null;
  emergencyContactPhone: string | null;
  emergencyContactRelation: string | null;
  baseMonthlySalary: number | null;
}

export interface WorkerDto {
  id: number;
  employeeCode: string;
  workerType: WorkerType;
  fullName: string;
  phone: string;
  altPhone: string | null;
  branch: { id: number; name: string } | null;
  employmentStatus: EmploymentStatus;
  joinedOn: string | null;
  leftOn: string | null;
  medicalValidUntil: string | null;
  compensationPolicy: { id: number; name: string } | null;
  licence: LicenceDto | null;
  licenceState: LicenceState;
  hazmatCertified: boolean;
  onLeaveToday: boolean;
  currentTrip: { id: number; tripNo: string; status: TripStatus } | null;
  hasLogin: boolean;
  notes: string | null;
  /** Present only when the caller holds workers:sensitive. */
  sensitive?: WorkerSensitiveDto;
}

export interface WorkerDocumentDto {
  id: number;
  docType: WorkerDocType;
  documentNo: string | null;
  expiresOn: string | null;
  fileId: number | null;
  notes: string | null;
  createdAt: string;
}

export interface TrainingDto {
  id: number;
  trainingType: TrainingType;
  completedOn: string;
  validUntil: string | null;
  provider: string | null;
  notes: string | null;
}

export interface LeaveDto {
  id: number;
  worker: { id: number; fullName: string; employeeCode: string; workerType: WorkerType };
  leaveType: LeaveType;
  fromDate: string;
  toDate: string;
  reason: string | null;
  status: LeaveStatus;
  decidedBy: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
  createdAt: string;
}

export interface AttendanceRowDto {
  worker: { id: number; fullName: string; employeeCode: string; workerType: WorkerType };
  status: AttendanceStatus | null;
  notes: string | null;
  source: 'manual' | 'trip' | 'app' | null;
}

export interface CompensationPolicyDto {
  id: number;
  name: string;
  appliesTo: 'driver' | 'helper';
  basis: CompensationBasis;
  rate: string;
  dailyAllowance: string;
  onTimeBonus: string;
  minPerTrip: string | null;
  effectiveFrom: string;
  isActive: boolean;
  notes: string | null;
}
