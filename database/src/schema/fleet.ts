import {
  boolean,
  date,
  decimal,
  index,
  int,
  mysqlEnum,
  mysqlTable,
  text,
  uniqueIndex,
  varchar,
  type AnyMySqlColumn,
} from 'drizzle-orm/mysql-core';
import { vendors } from './commercial.js';
import {
  BODY_TYPES,
  FUEL_TYPES,
  VEHICLE_DOC_TYPES,
  VEHICLE_OWNERSHIP,
  VEHICLE_STATUSES,
} from '@transaxis/shared';
import { createdAtCol, idCol, refCol, updatedAtCol } from './common.js';
import { branches, files, organizations } from './core.js';

export const vehicleTypes = mysqlTable(
  'vehicle_types',
  {
    id: idCol(),
    orgId: refCol('org_id')
      .notNull()
      .references(() => organizations.id),
    name: varchar('name', { length: 80 }).notNull(),
    bodyType: mysqlEnum('body_type', BODY_TYPES).notNull(),
    /** Licence class a driver must hold to be assigned (e.g. HGMV). Checked in eligibility rules. */
    requiredLicenceClass: varchar('required_licence_class', { length: 16 }).notNull(),
    defaultPayloadKg: decimal('default_payload_kg', { precision: 12, scale: 3 }),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: createdAtCol(),
    updatedAt: updatedAtCol(),
  },
  (t) => [uniqueIndex('uq_vehicle_types_org_name').on(t.orgId, t.name)],
);

export const vehicles = mysqlTable(
  'vehicles',
  {
    id: idCol(),
    orgId: refCol('org_id')
      .notNull()
      .references(() => organizations.id),
    branchId: refCol('branch_id').references(() => branches.id),
    vehicleTypeId: refCol('vehicle_type_id')
      .notNull()
      .references(() => vehicleTypes.id),
    registrationNo: varchar('registration_no', { length: 20 }).notNull(),
    make: varchar('make', { length: 60 }),
    model: varchar('model', { length: 60 }),
    year: int('year'),
    ownership: mysqlEnum('ownership', VEHICLE_OWNERSHIP).notNull().default('owned'),
    /** Owner/subcontractor for attached or hired vehicles. */
    vendorId: refCol('vendor_id').references((): AnyMySqlColumn => vendors.id),
    payloadCapacityKg: decimal('payload_capacity_kg', { precision: 12, scale: 3 }).notNull(),
    volumeCapacityCbm: decimal('volume_capacity_cbm', { precision: 10, scale: 2 }),
    fuelType: mysqlEnum('fuel_type', FUEL_TYPES).notNull().default('diesel'),
    odometerKm: decimal('odometer_km', { precision: 12, scale: 1 }).notNull().default('0.0'),
    fuelEfficiencyKmpl: decimal('fuel_efficiency_kmpl', { precision: 6, scale: 2 }),
    status: mysqlEnum('status', VEHICLE_STATUSES).notNull().default('available'),
    notes: text('notes'),
    createdAt: createdAtCol(),
    updatedAt: updatedAtCol(),
  },
  (t) => [
    uniqueIndex('uq_vehicles_org_reg').on(t.orgId, t.registrationNo),
    index('ix_vehicles_org_status').on(t.orgId, t.status),
  ],
);

export const vehicleDocuments = mysqlTable(
  'vehicle_documents',
  {
    id: idCol(),
    orgId: refCol('org_id')
      .notNull()
      .references(() => organizations.id),
    vehicleId: refCol('vehicle_id')
      .notNull()
      .references(() => vehicles.id, { onDelete: 'cascade' }),
    docType: mysqlEnum('doc_type', VEHICLE_DOC_TYPES).notNull(),
    documentNo: varchar('document_no', { length: 80 }),
    issuedOn: date('issued_on', { mode: 'string' }),
    expiresOn: date('expires_on', { mode: 'string' }),
    fileId: refCol('file_id').references(() => files.id),
    notes: varchar('notes', { length: 255 }),
    createdAt: createdAtCol(),
    updatedAt: updatedAtCol(),
  },
  (t) => [
    index('ix_vehicle_docs_vehicle').on(t.vehicleId, t.docType),
    index('ix_vehicle_docs_expiry').on(t.orgId, t.expiresOn),
  ],
);
