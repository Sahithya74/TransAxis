import {
  boolean,
  char,
  decimal,
  index,
  int,
  json,
  mysqlEnum,
  mysqlTable,
  primaryKey,
  text,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/mysql-core';
import {
  BODY_TYPES,
  BOOKING_STATUSES,
  CARGO_CATEGORIES,
  CHARGE_TYPES,
  INSPECTION_TYPES,
  POD_METHODS,
  RATE_BASES,
  STOP_TYPES,
  TRIP_EVENT_TYPES,
  TRIP_STATUSES,
  TRIP_TYPES,
} from '@transaxis/shared';
import { createdAtCol, dt, idCol, refCol, updatedAtCol } from './common.js';
import { files, organizations, users } from './core.js';
import { customers, locations, routes } from './commercial.js';
import { vehicles, vehicleTypes } from './fleet.js';
import { workers } from './people.js';

// ------------------------------------------------------------------ bookings

export const bookings = mysqlTable(
  'bookings',
  {
    id: idCol(),
    orgId: refCol('org_id')
      .notNull()
      .references(() => organizations.id),
    bookingNo: varchar('booking_no', { length: 24 }).notNull(),
    customerId: refCol('customer_id')
      .notNull()
      .references(() => customers.id),
    customerRef: varchar('customer_ref', { length: 60 }),
    status: mysqlEnum('status', BOOKING_STATUSES).notNull().default('draft'),
    holdFromStatus: mysqlEnum('hold_from_status', BOOKING_STATUSES),
    /** Lorry receipt / consignment note number, issued when a trip is planned. */
    lrNumber: varchar('lr_number', { length: 24 }),
    ewayBillNo: varchar('eway_bill_no', { length: 20 }),
    ewayBillExpiresAt: dt('eway_bill_expires_at'),
    routeId: refCol('route_id').references(() => routes.id),
    originCity: varchar('origin_city', { length: 80 }).notNull(),
    destinationCity: varchar('destination_city', { length: 80 }).notNull(),
    requiredVehicleTypeId: refCol('required_vehicle_type_id').references(() => vehicleTypes.id),
    requiredBodyType: mysqlEnum('required_body_type', BODY_TYPES),
    requiresTemperatureControl: boolean('requires_temperature_control').notNull().default(false),
    isHazardous: boolean('is_hazardous').notNull().default(false),
    /** Denormalised from cargo items, recomputed on every cargo change. */
    totalWeightKg: decimal('total_weight_kg', { precision: 12, scale: 3 }).notNull().default('0.000'),
    totalVolumeCbm: decimal('total_volume_cbm', { precision: 10, scale: 2 }),
    loadingWindowStart: dt('loading_window_start').notNull(),
    loadingWindowEnd: dt('loading_window_end'),
    deliveryDeadline: dt('delivery_deadline').notNull(),
    rateBasis: mysqlEnum('rate_basis', RATE_BASES),
    rate: decimal('rate', { precision: 12, scale: 2 }),
    quotedAmount: decimal('quoted_amount', { precision: 14, scale: 2 }),
    approvedAmount: decimal('approved_amount', { precision: 14, scale: 2 }),
    paymentTermsDays: int('payment_terms_days'),
    specialInstructions: text('special_instructions'),
    notes: text('notes'),
    quotedAt: dt('quoted_at'),
    quotedBy: refCol('quoted_by').references(() => users.id),
    approvedAt: dt('approved_at'),
    approvedBy: refCol('approved_by').references(() => users.id),
    cancelledAt: dt('cancelled_at'),
    cancelReason: varchar('cancel_reason', { length: 255 }),
    holdReason: varchar('hold_reason', { length: 255 }),
    createdBy: refCol('created_by').references(() => users.id),
    version: int('version').notNull().default(1),
    createdAt: createdAtCol(),
    updatedAt: updatedAtCol(),
  },
  (t) => [
    uniqueIndex('uq_bookings_org_no').on(t.orgId, t.bookingNo),
    uniqueIndex('uq_bookings_org_lr').on(t.orgId, t.lrNumber),
    index('ix_bookings_org_status').on(t.orgId, t.status),
    index('ix_bookings_customer').on(t.customerId),
    index('ix_bookings_loading').on(t.orgId, t.loadingWindowStart),
  ],
);

export const bookingStops = mysqlTable(
  'booking_stops',
  {
    id: idCol(),
    orgId: refCol('org_id')
      .notNull()
      .references(() => organizations.id),
    bookingId: refCol('booking_id')
      .notNull()
      .references(() => bookings.id, { onDelete: 'cascade' }),
    seq: int('seq').notNull(),
    stopType: mysqlEnum('stop_type', STOP_TYPES).notNull(),
    locationId: refCol('location_id').references(() => locations.id),
    name: varchar('name', { length: 140 }).notNull(),
    addressLine: varchar('address_line', { length: 255 }),
    city: varchar('city', { length: 80 }).notNull(),
    state: varchar('state', { length: 80 }),
    pincode: varchar('pincode', { length: 10 }),
    lat: decimal('lat', { precision: 9, scale: 6 }),
    lng: decimal('lng', { precision: 9, scale: 6 }),
    contactName: varchar('contact_name', { length: 120 }),
    contactPhone: varchar('contact_phone', { length: 32 }),
    windowStart: dt('window_start'),
    windowEnd: dt('window_end'),
    instructions: varchar('instructions', { length: 255 }),
  },
  (t) => [uniqueIndex('uq_booking_stops_seq').on(t.bookingId, t.seq)],
);

export const cargoItems = mysqlTable(
  'cargo_items',
  {
    id: idCol(),
    orgId: refCol('org_id')
      .notNull()
      .references(() => organizations.id),
    bookingId: refCol('booking_id')
      .notNull()
      .references(() => bookings.id, { onDelete: 'cascade' }),
    description: varchar('description', { length: 200 }).notNull(),
    category: mysqlEnum('category', CARGO_CATEGORIES).notNull().default('general'),
    hsnCode: varchar('hsn_code', { length: 10 }),
    quantity: decimal('quantity', { precision: 12, scale: 3 }).notNull(),
    unit: varchar('unit', { length: 16 }).notNull(),
    weightKg: decimal('weight_kg', { precision: 12, scale: 3 }).notNull(),
    volumeCbm: decimal('volume_cbm', { precision: 10, scale: 2 }),
    packaging: varchar('packaging', { length: 40 }),
    declaredValue: decimal('declared_value', { precision: 14, scale: 2 }),
    handling: varchar('handling', { length: 255 }),
  },
  (t) => [index('ix_cargo_booking').on(t.bookingId)],
);

export const bookingCharges = mysqlTable(
  'booking_charges',
  {
    id: idCol(),
    orgId: refCol('org_id')
      .notNull()
      .references(() => organizations.id),
    bookingId: refCol('booking_id')
      .notNull()
      .references(() => bookings.id, { onDelete: 'cascade' }),
    chargeType: mysqlEnum('charge_type', CHARGE_TYPES).notNull(),
    description: varchar('description', { length: 120 }),
    amount: decimal('amount', { precision: 14, scale: 2 }).notNull(),
    isTaxable: boolean('is_taxable').notNull().default(true),
  },
  (t) => [index('ix_charges_booking').on(t.bookingId)],
);

// ------------------------------------------------------------------ trips

export const trips = mysqlTable(
  'trips',
  {
    id: idCol(),
    orgId: refCol('org_id')
      .notNull()
      .references(() => organizations.id),
    tripNo: varchar('trip_no', { length: 24 }).notNull(),
    bookingId: refCol('booking_id').references(() => bookings.id),
    tripType: mysqlEnum('trip_type', TRIP_TYPES).notNull().default('loaded'),
    parentTripId: refCol('parent_trip_id'),
    status: mysqlEnum('status', TRIP_STATUSES).notNull().default('planned'),
    holdFromStatus: mysqlEnum('hold_from_status', TRIP_STATUSES),
    holdReason: varchar('hold_reason', { length: 255 }),
    vehicleId: refCol('vehicle_id')
      .notNull()
      .references(() => vehicles.id),
    driverId: refCol('driver_id')
      .notNull()
      .references(() => workers.id),
    routeId: refCol('route_id').references(() => routes.id),
    originCity: varchar('origin_city', { length: 80 }).notNull(),
    destinationCity: varchar('destination_city', { length: 80 }).notNull(),
    plannedStart: dt('planned_start').notNull(),
    plannedEnd: dt('planned_end').notNull(),
    actualStart: dt('actual_start'),
    deliveredAt: dt('delivered_at'),
    completedAt: dt('completed_at'),
    startOdometer: decimal('start_odometer', { precision: 12, scale: 1 }),
    endOdometer: decimal('end_odometer', { precision: 12, scale: 1 }),
    plannedDistanceKm: decimal('planned_distance_km', { precision: 8, scale: 1 }),
    /** HMAC of the delivery OTP; the OTP itself is never stored. */
    deliveryOtpHash: char('delivery_otp_hash', { length: 64 }),
    deliveryOtpExpiresAt: dt('delivery_otp_expires_at'),
    deliveryOtpAttempts: int('delivery_otp_attempts').notNull().default(0),
    podStatus: mysqlEnum('pod_status', ['pending', 'verified_otp', 'override', 'not_required']).notNull().default('pending'),
    overrideReason: varchar('override_reason', { length: 255 }),
    overriddenBy: refCol('overridden_by').references(() => users.id),
    cancelReason: varchar('cancel_reason', { length: 255 }),
    notes: text('notes'),
    createdBy: refCol('created_by').references(() => users.id),
    reconciledAt: dt('reconciled_at'),
    closedAt: dt('closed_at'),
    version: int('version').notNull().default(1),
    createdAt: createdAtCol(),
    updatedAt: updatedAtCol(),
  },
  (t) => [
    uniqueIndex('uq_trips_org_no').on(t.orgId, t.tripNo),
    index('ix_trips_org_status').on(t.orgId, t.status),
    index('ix_trips_vehicle').on(t.vehicleId, t.plannedStart),
    index('ix_trips_driver').on(t.driverId, t.plannedStart),
    index('ix_trips_booking').on(t.bookingId),
  ],
);

export const tripCrew = mysqlTable(
  'trip_crew',
  {
    tripId: refCol('trip_id')
      .notNull()
      .references(() => trips.id, { onDelete: 'cascade' }),
    workerId: refCol('worker_id')
      .notNull()
      .references(() => workers.id),
    role: mysqlEnum('role', ['co_driver', 'helper']).notNull(),
  },
  (t) => [primaryKey({ columns: [t.tripId, t.workerId] })],
);

/**
 * Time-window holds on vehicles and workers. Conflict checks look for overlapping active rows while
 * holding row locks on the vehicle/worker, which prevents double booking under concurrency.
 */
export const resourceReservations = mysqlTable(
  'resource_reservations',
  {
    id: idCol(),
    orgId: refCol('org_id')
      .notNull()
      .references(() => organizations.id),
    tripId: refCol('trip_id')
      .notNull()
      .references(() => trips.id, { onDelete: 'cascade' }),
    resourceType: mysqlEnum('resource_type', ['vehicle', 'worker']).notNull(),
    resourceId: refCol('resource_id').notNull(),
    startsAt: dt('starts_at').notNull(),
    endsAt: dt('ends_at').notNull(),
    active: boolean('active').notNull().default(true),
    createdAt: createdAtCol(),
  },
  (t) => [index('ix_reservations_lookup').on(t.resourceType, t.resourceId, t.active, t.startsAt), index('ix_reservations_trip').on(t.tripId)],
);

export const tripStops = mysqlTable(
  'trip_stops',
  {
    id: idCol(),
    orgId: refCol('org_id')
      .notNull()
      .references(() => organizations.id),
    tripId: refCol('trip_id')
      .notNull()
      .references(() => trips.id, { onDelete: 'cascade' }),
    seq: int('seq').notNull(),
    stopType: mysqlEnum('stop_type', STOP_TYPES).notNull(),
    bookingStopId: refCol('booking_stop_id').references(() => bookingStops.id),
    name: varchar('name', { length: 140 }).notNull(),
    addressLine: varchar('address_line', { length: 255 }),
    city: varchar('city', { length: 80 }).notNull(),
    lat: decimal('lat', { precision: 9, scale: 6 }),
    lng: decimal('lng', { precision: 9, scale: 6 }),
    contactName: varchar('contact_name', { length: 120 }),
    contactPhone: varchar('contact_phone', { length: 32 }),
    plannedArrival: dt('planned_arrival'),
    actualArrival: dt('actual_arrival'),
    actualDeparture: dt('actual_departure'),
    status: mysqlEnum('status', ['pending', 'arrived', 'departed', 'skipped']).notNull().default('pending'),
  },
  (t) => [uniqueIndex('uq_trip_stops_seq').on(t.tripId, t.seq)],
);

export const tripStatusHistory = mysqlTable(
  'trip_status_history',
  {
    id: idCol(),
    orgId: refCol('org_id')
      .notNull()
      .references(() => organizations.id),
    tripId: refCol('trip_id')
      .notNull()
      .references(() => trips.id, { onDelete: 'cascade' }),
    fromStatus: mysqlEnum('from_status', TRIP_STATUSES),
    toStatus: mysqlEnum('to_status', TRIP_STATUSES).notNull(),
    changedBy: refCol('changed_by').references(() => users.id),
    reason: varchar('reason', { length: 255 }),
    createdAt: createdAtCol(),
  },
  (t) => [index('ix_trip_history_trip').on(t.tripId, t.createdAt)],
);

export const tripEvents = mysqlTable(
  'trip_events',
  {
    id: idCol(),
    orgId: refCol('org_id')
      .notNull()
      .references(() => organizations.id),
    tripId: refCol('trip_id')
      .notNull()
      .references(() => trips.id, { onDelete: 'cascade' }),
    eventType: mysqlEnum('event_type', TRIP_EVENT_TYPES).notNull(),
    occurredAt: dt('occurred_at').notNull(),
    stopId: refCol('stop_id').references(() => tripStops.id),
    note: varchar('note', { length: 500 }),
    lat: decimal('lat', { precision: 9, scale: 6 }),
    lng: decimal('lng', { precision: 9, scale: 6 }),
    odometer: decimal('odometer', { precision: 12, scale: 1 }),
    recordedBy: refCol('recorded_by').references(() => users.id),
    source: mysqlEnum('source', ['web', 'driver_app', 'system', 'simulated']).notNull().default('web'),
    createdAt: createdAtCol(),
  },
  (t) => [index('ix_trip_events_trip').on(t.tripId, t.occurredAt)],
);

export const inspectionTemplates = mysqlTable(
  'inspection_templates',
  {
    id: idCol(),
    orgId: refCol('org_id')
      .notNull()
      .references(() => organizations.id),
    name: varchar('name', { length: 100 }).notNull(),
    inspectionType: mysqlEnum('inspection_type', INSPECTION_TYPES).notNull(),
    items: json('items').$type<{ key: string; label: string; critical: boolean }[]>().notNull(),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: createdAtCol(),
  },
  (t) => [index('ix_inspection_templates_org').on(t.orgId, t.inspectionType, t.isActive)],
);

export const inspections = mysqlTable(
  'inspections',
  {
    id: idCol(),
    orgId: refCol('org_id')
      .notNull()
      .references(() => organizations.id),
    tripId: refCol('trip_id')
      .notNull()
      .references(() => trips.id, { onDelete: 'cascade' }),
    vehicleId: refCol('vehicle_id')
      .notNull()
      .references(() => vehicles.id),
    inspectionType: mysqlEnum('inspection_type', INSPECTION_TYPES).notNull(),
    templateId: refCol('template_id').references(() => inspectionTemplates.id),
    inspectedBy: refCol('inspected_by').references(() => users.id),
    inspectedAt: dt('inspected_at').notNull(),
    odometer: decimal('odometer', { precision: 12, scale: 1 }),
    result: mysqlEnum('result', ['pass', 'fail']).notNull(),
    items: json('items')
      .$type<{ key: string; label: string; critical: boolean; result: 'pass' | 'fail' | 'na'; note?: string }[]>()
      .notNull(),
    notes: varchar('notes', { length: 500 }),
    createdAt: createdAtCol(),
  },
  (t) => [index('ix_inspections_trip').on(t.tripId, t.inspectionType)],
);

export const cargoSeals = mysqlTable(
  'cargo_seals',
  {
    id: idCol(),
    orgId: refCol('org_id')
      .notNull()
      .references(() => organizations.id),
    tripId: refCol('trip_id')
      .notNull()
      .references(() => trips.id, { onDelete: 'cascade' }),
    sealNo: varchar('seal_no', { length: 40 }).notNull(),
    appliedAt: dt('applied_at').notNull(),
    appliedBy: refCol('applied_by').references(() => users.id),
    verifiedAt: dt('verified_at'),
    verifiedBy: refCol('verified_by').references(() => users.id),
    intact: boolean('intact'),
    notes: varchar('notes', { length: 255 }),
  },
  (t) => [uniqueIndex('uq_cargo_seals_org_no').on(t.orgId, t.sealNo), index('ix_cargo_seals_trip').on(t.tripId)],
);

export const proofOfDelivery = mysqlTable(
  'proof_of_delivery',
  {
    id: idCol(),
    orgId: refCol('org_id')
      .notNull()
      .references(() => organizations.id),
    tripId: refCol('trip_id')
      .notNull()
      .references(() => trips.id, { onDelete: 'cascade' }),
    method: mysqlEnum('method', POD_METHODS).notNull(),
    recipientName: varchar('recipient_name', { length: 120 }).notNull(),
    recipientPhone: varchar('recipient_phone', { length: 32 }),
    deliveredAt: dt('delivered_at').notNull(),
    overrideReason: varchar('override_reason', { length: 255 }),
    damageReported: boolean('damage_reported').notNull().default(false),
    shortageReported: boolean('shortage_reported').notNull().default(false),
    remarks: varchar('remarks', { length: 500 }),
    signatureFileId: refCol('signature_file_id').references(() => files.id),
    photoFileIds: json('photo_file_ids').$type<number[]>(),
    recordedBy: refCol('recorded_by').references(() => users.id),
    createdAt: createdAtCol(),
  },
  (t) => [uniqueIndex('uq_pod_trip').on(t.tripId)],
);
