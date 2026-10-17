import { boolean, decimal, index, int, mysqlEnum, mysqlTable, text, uniqueIndex, varchar } from 'drizzle-orm/mysql-core';
import {
  ALERT_SEVERITIES,
  ALERT_STATUSES,
  ALERT_TYPES,
  CHECKIN_STATUSES,
  GEOFENCE_KINDS,
  GPS_SOURCES,
  INCIDENT_SEVERITIES,
  INCIDENT_STATUSES,
  INCIDENT_TYPES,
  NOTIFICATION_CATEGORIES,
  NOTIFICATION_PRIORITIES,
} from '@transaxis/shared';
import { createdAtCol, dt, idCol, refCol, updatedAtCol } from './common.js';
import { organizations, users } from './core.js';
import { locations } from './commercial.js';
import { vehicles } from './fleet.js';
import { trips } from './operations.js';
import { workers } from './people.js';

// ------------------------------------------------------------------ tracking

/**
 * Position history. Accepted only for vehicles on an active trip (privacy); `is_simulated` marks demo
 * data, which the UI labels. Old rows are purged by the retention job.
 */
export const gpsEvents = mysqlTable(
  'gps_events',
  {
    id: idCol(),
    orgId: refCol('org_id')
      .notNull()
      .references(() => organizations.id),
    vehicleId: refCol('vehicle_id')
      .notNull()
      .references(() => vehicles.id),
    tripId: refCol('trip_id').references(() => trips.id, { onDelete: 'cascade' }),
    recordedAt: dt('recorded_at').notNull(),
    lat: decimal('lat', { precision: 9, scale: 6 }).notNull(),
    lng: decimal('lng', { precision: 9, scale: 6 }).notNull(),
    speedKmph: decimal('speed_kmph', { precision: 5, scale: 1 }),
    headingDeg: int('heading_deg'),
    accuracyM: int('accuracy_m'),
    source: mysqlEnum('source', GPS_SOURCES).notNull(),
    isSimulated: boolean('is_simulated').notNull().default(false),
    createdAt: createdAtCol(),
  },
  (t) => [
    index('ix_gps_trip_time').on(t.tripId, t.recordedAt),
    index('ix_gps_vehicle_time').on(t.vehicleId, t.recordedAt),
    index('ix_gps_org_time').on(t.orgId, t.recordedAt),
  ],
);

/** Latest fix per vehicle, so the live map never scans history. */
export const vehicleLastPositions = mysqlTable(
  'vehicle_last_positions',
  {
    vehicleId: refCol('vehicle_id')
      .primaryKey()
      .references(() => vehicles.id),
    orgId: refCol('org_id')
      .notNull()
      .references(() => organizations.id),
    tripId: refCol('trip_id').references(() => trips.id, { onDelete: 'set null' }),
    recordedAt: dt('recorded_at').notNull(),
    lat: decimal('lat', { precision: 9, scale: 6 }).notNull(),
    lng: decimal('lng', { precision: 9, scale: 6 }).notNull(),
    speedKmph: decimal('speed_kmph', { precision: 5, scale: 1 }),
    headingDeg: int('heading_deg'),
    source: mysqlEnum('source', GPS_SOURCES).notNull(),
    isSimulated: boolean('is_simulated').notNull().default(false),
    updatedAt: updatedAtCol(),
  },
  (t) => [index('ix_last_positions_org').on(t.orgId)],
);

/** Circular zones: depots and sites (standing still there is expected) and restricted areas. */
export const geofences = mysqlTable(
  'geofences',
  {
    id: idCol(),
    orgId: refCol('org_id')
      .notNull()
      .references(() => organizations.id),
    name: varchar('name', { length: 120 }).notNull(),
    kind: mysqlEnum('kind', GEOFENCE_KINDS).notNull(),
    lat: decimal('lat', { precision: 9, scale: 6 }).notNull(),
    lng: decimal('lng', { precision: 9, scale: 6 }).notNull(),
    radiusM: int('radius_m').notNull(),
    locationId: refCol('location_id').references(() => locations.id),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: createdAtCol(),
  },
  (t) => [index('ix_geofences_org').on(t.orgId, t.kind, t.isActive)],
);

// ------------------------------------------------------------------ safety

/**
 * Safety alerts. `dedupe_key` is unique per organisation while an alert is unresolved and is cleared on
 * resolution, so a condition that persists updates one alert instead of creating many.
 */
export const safetyAlerts = mysqlTable(
  'safety_alerts',
  {
    id: idCol(),
    orgId: refCol('org_id')
      .notNull()
      .references(() => organizations.id),
    alertType: mysqlEnum('alert_type', ALERT_TYPES).notNull(),
    severity: mysqlEnum('severity', ALERT_SEVERITIES).notNull(),
    status: mysqlEnum('status', ALERT_STATUSES).notNull().default('open'),
    title: varchar('title', { length: 160 }).notNull(),
    detail: varchar('detail', { length: 500 }),
    tripId: refCol('trip_id').references(() => trips.id, { onDelete: 'set null' }),
    vehicleId: refCol('vehicle_id').references(() => vehicles.id),
    driverId: refCol('driver_id').references(() => workers.id),
    lat: decimal('lat', { precision: 9, scale: 6 }),
    lng: decimal('lng', { precision: 9, scale: 6 }),
    dedupeKey: varchar('dedupe_key', { length: 120 }),
    isSimulated: boolean('is_simulated').notNull().default(false),
    raisedAt: dt('raised_at').notNull(),
    lastSeenAt: dt('last_seen_at').notNull(),
    occurrences: int('occurrences').notNull().default(1),
    acknowledgedAt: dt('acknowledged_at'),
    acknowledgedBy: refCol('acknowledged_by').references(() => users.id),
    resolvedAt: dt('resolved_at'),
    resolvedBy: refCol('resolved_by').references(() => users.id),
    resolutionNote: varchar('resolution_note', { length: 255 }),
    autoResolved: boolean('auto_resolved').notNull().default(false),
    incidentId: refCol('incident_id'),
    createdAt: createdAtCol(),
  },
  (t) => [
    uniqueIndex('uq_alerts_org_dedupe').on(t.orgId, t.dedupeKey),
    index('ix_alerts_org_status').on(t.orgId, t.status, t.raisedAt),
    index('ix_alerts_trip').on(t.tripId),
  ],
);

export const incidents = mysqlTable(
  'incidents',
  {
    id: idCol(),
    orgId: refCol('org_id')
      .notNull()
      .references(() => organizations.id),
    incidentNo: varchar('incident_no', { length: 24 }).notNull(),
    incidentType: mysqlEnum('incident_type', INCIDENT_TYPES).notNull(),
    severity: mysqlEnum('severity', INCIDENT_SEVERITIES).notNull(),
    status: mysqlEnum('status', INCIDENT_STATUSES).notNull().default('open'),
    title: varchar('title', { length: 160 }).notNull(),
    description: text('description'),
    tripId: refCol('trip_id').references(() => trips.id, { onDelete: 'set null' }),
    vehicleId: refCol('vehicle_id').references(() => vehicles.id),
    driverId: refCol('driver_id').references(() => workers.id),
    lat: decimal('lat', { precision: 9, scale: 6 }),
    lng: decimal('lng', { precision: 9, scale: 6 }),
    locationText: varchar('location_text', { length: 255 }),
    reportedBy: refCol('reported_by').references(() => users.id),
    reportedAt: dt('reported_at').notNull(),
    assignedTo: refCol('assigned_to').references(() => users.id),
    resolvedAt: dt('resolved_at'),
    resolution: text('resolution'),
    isSimulated: boolean('is_simulated').notNull().default(false),
    version: int('version').notNull().default(1),
    createdAt: createdAtCol(),
    updatedAt: updatedAtCol(),
  },
  (t) => [uniqueIndex('uq_incidents_org_no').on(t.orgId, t.incidentNo), index('ix_incidents_org_status').on(t.orgId, t.status, t.reportedAt)],
);

export const incidentUpdates = mysqlTable(
  'incident_updates',
  {
    id: idCol(),
    orgId: refCol('org_id')
      .notNull()
      .references(() => organizations.id),
    incidentId: refCol('incident_id')
      .notNull()
      .references(() => incidents.id, { onDelete: 'cascade' }),
    kind: mysqlEnum('kind', ['created', 'note', 'status_change', 'assignment', 'escalation']).notNull(),
    body: text('body'),
    fromStatus: mysqlEnum('from_status', INCIDENT_STATUSES),
    toStatus: mysqlEnum('to_status', INCIDENT_STATUSES),
    createdBy: refCol('created_by').references(() => users.id),
    createdAt: createdAtCol(),
  },
  (t) => [index('ix_incident_updates_incident').on(t.incidentId, t.createdAt)],
);

/** Scheduled driver check-ins on running trips; missing one raises an alert. */
export const driverCheckins = mysqlTable(
  'driver_checkins',
  {
    id: idCol(),
    orgId: refCol('org_id')
      .notNull()
      .references(() => organizations.id),
    tripId: refCol('trip_id')
      .notNull()
      .references(() => trips.id, { onDelete: 'cascade' }),
    workerId: refCol('worker_id')
      .notNull()
      .references(() => workers.id),
    dueAt: dt('due_at').notNull(),
    checkedInAt: dt('checked_in_at'),
    status: mysqlEnum('status', CHECKIN_STATUSES).notNull().default('pending'),
    lat: decimal('lat', { precision: 9, scale: 6 }),
    lng: decimal('lng', { precision: 9, scale: 6 }),
    note: varchar('note', { length: 255 }),
    createdAt: createdAtCol(),
  },
  (t) => [uniqueIndex('uq_checkins_trip_due').on(t.tripId, t.dueAt), index('ix_checkins_org_status').on(t.orgId, t.status, t.dueAt)],
);

// ------------------------------------------------------------------ notifications

/** Per-recipient notifications. `dedupe_key` stops the same event notifying a user twice. */
export const notifications = mysqlTable(
  'notifications',
  {
    id: idCol(),
    orgId: refCol('org_id')
      .notNull()
      .references(() => organizations.id),
    userId: refCol('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    category: mysqlEnum('category', NOTIFICATION_CATEGORIES).notNull(),
    priority: mysqlEnum('priority', NOTIFICATION_PRIORITIES).notNull().default('normal'),
    title: varchar('title', { length: 160 }).notNull(),
    body: varchar('body', { length: 500 }),
    link: varchar('link', { length: 255 }),
    entityType: varchar('entity_type', { length: 48 }),
    entityId: refCol('entity_id'),
    dedupeKey: varchar('dedupe_key', { length: 160 }).notNull(),
    readAt: dt('read_at'),
    acknowledgedAt: dt('acknowledged_at'),
    escalatedAt: dt('escalated_at'),
    createdAt: createdAtCol(),
  },
  (t) => [uniqueIndex('uq_notifications_user_dedupe').on(t.userId, t.dedupeKey), index('ix_notifications_user').on(t.userId, t.readAt, t.createdAt)],
);
