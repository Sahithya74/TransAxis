import {
  boolean,
  date,
  decimal,
  index,
  int,
  json,
  mysqlEnum,
  mysqlTable,
  text,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/mysql-core';
import { LOCATION_TYPES, PARTY_STATUSES, RATE_BASES, VENDOR_TYPES } from '@transaxis/shared';
import { createdAtCol, idCol, refCol, updatedAtCol } from './common.js';
import { organizations } from './core.js';
import { vehicleTypes } from './fleet.js';

export const customers = mysqlTable(
  'customers',
  {
    id: idCol(),
    orgId: refCol('org_id')
      .notNull()
      .references(() => organizations.id),
    code: varchar('code', { length: 24 }).notNull(),
    name: varchar('name', { length: 160 }).notNull(),
    legalName: varchar('legal_name', { length: 200 }),
    gstin: varchar('gstin', { length: 15 }),
    pan: varchar('pan', { length: 10 }),
    billingAddress: varchar('billing_address', { length: 255 }),
    city: varchar('city', { length: 80 }),
    state: varchar('state', { length: 80 }),
    pincode: varchar('pincode', { length: 10 }),
    phone: varchar('phone', { length: 32 }),
    email: varchar('email', { length: 190 }),
    paymentTermsDays: int('payment_terms_days').notNull().default(30),
    creditLimit: decimal('credit_limit', { precision: 14, scale: 2 }),
    status: mysqlEnum('status', PARTY_STATUSES).notNull().default('active'),
    notes: text('notes'),
    createdAt: createdAtCol(),
    updatedAt: updatedAtCol(),
  },
  (t) => [uniqueIndex('uq_customers_org_code').on(t.orgId, t.code), index('ix_customers_org_name').on(t.orgId, t.name)],
);

export const customerContacts = mysqlTable(
  'customer_contacts',
  {
    id: idCol(),
    orgId: refCol('org_id')
      .notNull()
      .references(() => organizations.id),
    customerId: refCol('customer_id')
      .notNull()
      .references(() => customers.id, { onDelete: 'cascade' }),
    name: varchar('name', { length: 120 }).notNull(),
    designation: varchar('designation', { length: 80 }),
    phone: varchar('phone', { length: 32 }),
    email: varchar('email', { length: 190 }),
    isPrimary: boolean('is_primary').notNull().default(false),
    createdAt: createdAtCol(),
  },
  (t) => [index('ix_customer_contacts_customer').on(t.customerId)],
);

export const vendors = mysqlTable(
  'vendors',
  {
    id: idCol(),
    orgId: refCol('org_id')
      .notNull()
      .references(() => organizations.id),
    code: varchar('code', { length: 24 }).notNull(),
    name: varchar('name', { length: 160 }).notNull(),
    vendorType: mysqlEnum('vendor_type', VENDOR_TYPES).notNull(),
    gstin: varchar('gstin', { length: 15 }),
    pan: varchar('pan', { length: 10 }),
    address: varchar('address', { length: 255 }),
    city: varchar('city', { length: 80 }),
    state: varchar('state', { length: 80 }),
    contactName: varchar('contact_name', { length: 120 }),
    phone: varchar('phone', { length: 32 }),
    email: varchar('email', { length: 190 }),
    paymentTermsDays: int('payment_terms_days').notNull().default(30),
    status: mysqlEnum('status', PARTY_STATUSES).notNull().default('active'),
    notes: text('notes'),
    createdAt: createdAtCol(),
    updatedAt: updatedAtCol(),
  },
  (t) => [uniqueIndex('uq_vendors_org_code').on(t.orgId, t.code), index('ix_vendors_org_type').on(t.orgId, t.vendorType)],
);

/** Named places: customer sites, warehouses, depots. Used for stops, geofences and routes. */
export const locations = mysqlTable(
  'locations',
  {
    id: idCol(),
    orgId: refCol('org_id')
      .notNull()
      .references(() => organizations.id),
    customerId: refCol('customer_id').references(() => customers.id),
    name: varchar('name', { length: 140 }).notNull(),
    locationType: mysqlEnum('location_type', LOCATION_TYPES).notNull(),
    addressLine: varchar('address_line', { length: 255 }),
    city: varchar('city', { length: 80 }).notNull(),
    state: varchar('state', { length: 80 }),
    pincode: varchar('pincode', { length: 10 }),
    lat: decimal('lat', { precision: 9, scale: 6 }),
    lng: decimal('lng', { precision: 9, scale: 6 }),
    contactName: varchar('contact_name', { length: 120 }),
    contactPhone: varchar('contact_phone', { length: 32 }),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: createdAtCol(),
    updatedAt: updatedAtCol(),
  },
  (t) => [index('ix_locations_org_city').on(t.orgId, t.city), index('ix_locations_customer').on(t.customerId)],
);

/** Planned corridor between two cities. The polyline drives the GPS simulator and ETA. */
export const routes = mysqlTable(
  'routes',
  {
    id: idCol(),
    orgId: refCol('org_id')
      .notNull()
      .references(() => organizations.id),
    name: varchar('name', { length: 120 }).notNull(),
    originCity: varchar('origin_city', { length: 80 }).notNull(),
    destinationCity: varchar('destination_city', { length: 80 }).notNull(),
    distanceKm: decimal('distance_km', { precision: 8, scale: 1 }).notNull(),
    expectedDurationMin: int('expected_duration_min').notNull(),
    /** [[lat, lng], ...] waypoints. */
    polyline: json('polyline').$type<[number, number][]>().notNull(),
    tollEstimate: decimal('toll_estimate', { precision: 10, scale: 2 }),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: createdAtCol(),
    updatedAt: updatedAtCol(),
  },
  (t) => [uniqueIndex('uq_routes_org_name').on(t.orgId, t.name), index('ix_routes_cities').on(t.orgId, t.originCity, t.destinationCity)],
);

export const customerRateCards = mysqlTable(
  'customer_rate_cards',
  {
    id: idCol(),
    orgId: refCol('org_id')
      .notNull()
      .references(() => organizations.id),
    customerId: refCol('customer_id')
      .notNull()
      .references(() => customers.id, { onDelete: 'cascade' }),
    originCity: varchar('origin_city', { length: 80 }).notNull(),
    destinationCity: varchar('destination_city', { length: 80 }).notNull(),
    vehicleTypeId: refCol('vehicle_type_id').references(() => vehicleTypes.id),
    rateBasis: mysqlEnum('rate_basis', RATE_BASES).notNull(),
    rate: decimal('rate', { precision: 12, scale: 2 }).notNull(),
    loadingCharge: decimal('loading_charge', { precision: 10, scale: 2 }).notNull().default('0.00'),
    unloadingCharge: decimal('unloading_charge', { precision: 10, scale: 2 }).notNull().default('0.00'),
    detentionFreeHours: int('detention_free_hours').notNull().default(24),
    detentionRatePerHour: decimal('detention_rate_per_hour', { precision: 10, scale: 2 }).notNull().default('0.00'),
    validFrom: date('valid_from', { mode: 'string' }).notNull(),
    validTo: date('valid_to', { mode: 'string' }),
    notes: varchar('notes', { length: 255 }),
    createdAt: createdAtCol(),
    updatedAt: updatedAtCol(),
  },
  (t) => [index('ix_rate_cards_lookup').on(t.orgId, t.customerId, t.originCity, t.destinationCity)],
);
