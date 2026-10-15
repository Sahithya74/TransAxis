import {
  boolean,
  date,
  decimal,
  index,
  mysqlEnum,
  mysqlTable,
  primaryKey,
  text,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/mysql-core';
import {
  ATTENDANCE_STATUSES,
  COMPENSATION_BASES,
  EMPLOYMENT_STATUSES,
  LEAVE_STATUSES,
  LEAVE_TYPES,
  LICENCE_VERIFICATION,
  TRAINING_TYPES,
  WORKER_DOC_TYPES,
  WORKER_TYPES,
} from '@transaxis/shared';
import { createdAtCol, dt, idCol, refCol, updatedAtCol } from './common.js';
import { branches, files, organizations, users } from './core.js';

export const compensationPolicies = mysqlTable(
  'compensation_policies',
  {
    id: idCol(),
    orgId: refCol('org_id')
      .notNull()
      .references(() => organizations.id),
    name: varchar('name', { length: 100 }).notNull(),
    appliesTo: mysqlEnum('applies_to', ['driver', 'helper']).notNull(),
    basis: mysqlEnum('basis', COMPENSATION_BASES).notNull(),
    /** Meaning depends on basis: ₹/trip, ₹/km, ₹/tonne, % of freight, or ₹/month. */
    rate: decimal('rate', { precision: 12, scale: 4 }).notNull(),
    /** Daily allowance (bhatta) per trip day, ₹. */
    dailyAllowance: decimal('daily_allowance', { precision: 10, scale: 2 }).notNull().default('0.00'),
    onTimeBonus: decimal('on_time_bonus', { precision: 10, scale: 2 }).notNull().default('0.00'),
    minPerTrip: decimal('min_per_trip', { precision: 10, scale: 2 }),
    effectiveFrom: date('effective_from', { mode: 'string' }).notNull(),
    isActive: boolean('is_active').notNull().default(true),
    notes: varchar('notes', { length: 255 }),
    createdAt: createdAtCol(),
    updatedAt: updatedAtCol(),
  },
  (t) => [uniqueIndex('uq_comp_policies_org_name').on(t.orgId, t.name)],
);

/** Drivers, helpers, loaders, mechanics and supervisors. */
export const workers = mysqlTable(
  'workers',
  {
    id: idCol(),
    orgId: refCol('org_id')
      .notNull()
      .references(() => organizations.id),
    branchId: refCol('branch_id').references(() => branches.id),
    employeeCode: varchar('employee_code', { length: 24 }).notNull(),
    workerType: mysqlEnum('worker_type', WORKER_TYPES).notNull(),
    fullName: varchar('full_name', { length: 140 }).notNull(),
    phone: varchar('phone', { length: 32 }).notNull(),
    altPhone: varchar('alt_phone', { length: 32 }),
    // Sensitive personal data: returned only to holders of workers:sensitive.
    dateOfBirth: date('date_of_birth', { mode: 'string' }),
    address: varchar('address', { length: 255 }),
    bloodGroup: varchar('blood_group', { length: 5 }),
    emergencyContactName: varchar('emergency_contact_name', { length: 120 }),
    emergencyContactPhone: varchar('emergency_contact_phone', { length: 32 }),
    emergencyContactRelation: varchar('emergency_contact_relation', { length: 40 }),
    baseMonthlySalary: decimal('base_monthly_salary', { precision: 12, scale: 2 }),
    employmentStatus: mysqlEnum('employment_status', EMPLOYMENT_STATUSES).notNull().default('active'),
    joinedOn: date('joined_on', { mode: 'string' }),
    leftOn: date('left_on', { mode: 'string' }),
    compensationPolicyId: refCol('compensation_policy_id').references(() => compensationPolicies.id),
    medicalValidUntil: date('medical_valid_until', { mode: 'string' }),
    notes: text('notes'),
    createdAt: createdAtCol(),
    updatedAt: updatedAtCol(),
  },
  (t) => [
    uniqueIndex('uq_workers_org_code').on(t.orgId, t.employeeCode),
    index('ix_workers_org_type_status').on(t.orgId, t.workerType, t.employmentStatus),
  ],
);

/** Licence history; the row with `isCurrent` is the one checked at assignment. */
export const driverLicences = mysqlTable(
  'driver_licences',
  {
    id: idCol(),
    orgId: refCol('org_id')
      .notNull()
      .references(() => organizations.id),
    workerId: refCol('worker_id')
      .notNull()
      .references(() => workers.id, { onDelete: 'cascade' }),
    licenceNo: varchar('licence_no', { length: 32 }).notNull(),
    issuingState: varchar('issuing_state', { length: 60 }),
    issuedOn: date('issued_on', { mode: 'string' }),
    validUntil: date('valid_until', { mode: 'string' }).notNull(),
    verification: mysqlEnum('verification', LICENCE_VERIFICATION).notNull().default('unverified'),
    verifiedOn: date('verified_on', { mode: 'string' }),
    verifiedBy: refCol('verified_by').references(() => users.id),
    fileId: refCol('file_id').references(() => files.id),
    isCurrent: boolean('is_current').notNull().default(true),
    createdAt: createdAtCol(),
    updatedAt: updatedAtCol(),
  },
  (t) => [index('ix_driver_licences_worker').on(t.workerId, t.isCurrent), index('ix_driver_licences_expiry').on(t.orgId, t.validUntil)],
);

export const driverLicenceClasses = mysqlTable(
  'driver_licence_classes',
  {
    licenceId: refCol('licence_id')
      .notNull()
      .references(() => driverLicences.id, { onDelete: 'cascade' }),
    licenceClass: varchar('licence_class', { length: 16 }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.licenceId, t.licenceClass] })],
);

export const workerDocuments = mysqlTable(
  'worker_documents',
  {
    id: idCol(),
    orgId: refCol('org_id')
      .notNull()
      .references(() => organizations.id),
    workerId: refCol('worker_id')
      .notNull()
      .references(() => workers.id, { onDelete: 'cascade' }),
    docType: mysqlEnum('doc_type', WORKER_DOC_TYPES).notNull(),
    documentNo: varchar('document_no', { length: 80 }),
    expiresOn: date('expires_on', { mode: 'string' }),
    fileId: refCol('file_id').references(() => files.id),
    notes: varchar('notes', { length: 255 }),
    createdAt: createdAtCol(),
  },
  (t) => [index('ix_worker_docs_worker').on(t.workerId)],
);

export const workerTrainings = mysqlTable(
  'worker_trainings',
  {
    id: idCol(),
    orgId: refCol('org_id')
      .notNull()
      .references(() => organizations.id),
    workerId: refCol('worker_id')
      .notNull()
      .references(() => workers.id, { onDelete: 'cascade' }),
    trainingType: mysqlEnum('training_type', TRAINING_TYPES).notNull(),
    completedOn: date('completed_on', { mode: 'string' }).notNull(),
    validUntil: date('valid_until', { mode: 'string' }),
    provider: varchar('provider', { length: 120 }),
    notes: varchar('notes', { length: 255 }),
    createdAt: createdAtCol(),
  },
  (t) => [index('ix_worker_trainings_worker').on(t.workerId, t.trainingType)],
);

export const leaveRequests = mysqlTable(
  'leave_requests',
  {
    id: idCol(),
    orgId: refCol('org_id')
      .notNull()
      .references(() => organizations.id),
    workerId: refCol('worker_id')
      .notNull()
      .references(() => workers.id, { onDelete: 'cascade' }),
    leaveType: mysqlEnum('leave_type', LEAVE_TYPES).notNull(),
    fromDate: date('from_date', { mode: 'string' }).notNull(),
    toDate: date('to_date', { mode: 'string' }).notNull(),
    reason: varchar('reason', { length: 255 }),
    status: mysqlEnum('status', LEAVE_STATUSES).notNull().default('pending'),
    decidedBy: refCol('decided_by').references(() => users.id),
    decidedAt: dt('decided_at'),
    decisionNote: varchar('decision_note', { length: 255 }),
    createdAt: createdAtCol(),
  },
  (t) => [index('ix_leave_worker_dates').on(t.workerId, t.status, t.fromDate, t.toDate)],
);

export const attendance = mysqlTable(
  'attendance',
  {
    id: idCol(),
    orgId: refCol('org_id')
      .notNull()
      .references(() => organizations.id),
    workerId: refCol('worker_id')
      .notNull()
      .references(() => workers.id, { onDelete: 'cascade' }),
    workDate: date('work_date', { mode: 'string' }).notNull(),
    status: mysqlEnum('status', ATTENDANCE_STATUSES).notNull(),
    checkIn: dt('check_in'),
    checkOut: dt('check_out'),
    source: mysqlEnum('source', ['manual', 'trip', 'app']).notNull().default('manual'),
    notes: varchar('notes', { length: 255 }),
    recordedBy: refCol('recorded_by').references(() => users.id),
    createdAt: createdAtCol(),
    updatedAt: updatedAtCol(),
  },
  (t) => [uniqueIndex('uq_attendance_worker_date').on(t.workerId, t.workDate), index('ix_attendance_org_date').on(t.orgId, t.workDate)],
);

export const dutyRosters = mysqlTable(
  'duty_rosters',
  {
    id: idCol(),
    orgId: refCol('org_id')
      .notNull()
      .references(() => organizations.id),
    workerId: refCol('worker_id')
      .notNull()
      .references(() => workers.id, { onDelete: 'cascade' }),
    startsAt: dt('starts_at').notNull(),
    endsAt: dt('ends_at').notNull(),
    shiftType: mysqlEnum('shift_type', ['day', 'night', 'standby', 'off']).notNull(),
    notes: varchar('notes', { length: 255 }),
    createdAt: createdAtCol(),
  },
  (t) => [index('ix_rosters_worker_time').on(t.workerId, t.startsAt)],
);
