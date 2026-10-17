import { z } from 'zod';
import {
  ALERT_SEVERITIES,
  ALERT_STATUSES,
  ALERT_TYPES,
  INCIDENT_SEVERITIES,
  INCIDENT_STATUSES,
  INCIDENT_TYPES,
  type AlertSeverity,
  type AlertStatus,
  type AlertType,
  type CheckinStatus,
  type GpsSource,
  type IncidentSeverity,
  type IncidentStatus,
  type IncidentType,
  type NotificationCategory,
  type NotificationPriority,
} from '../enums-live.js';
import type { TripStatus } from '../enums-ops.js';
import type { EtaDto } from '../rules/eta.js';
import type { SimScenario } from '../rules/simulation.js';
import { idSchema, listQuerySchema, optionalText } from './common.js';

const lat = z.coerce.number().min(-90).max(90);
const lng = z.coerce.number().min(-180).max(180);

// ------------------------------------------------------------------ inputs

/** A position pushed from the driver's phone. Accepted only while the driver is on an active trip. */
export const positionReportSchema = z.object({
  lat,
  lng,
  speedKmph: z.coerce.number().min(0).max(200).optional(),
  headingDeg: z.coerce.number().min(0).max(360).optional(),
  accuracyM: z.coerce.number().min(0).max(10_000).optional(),
});

export const alertListQuerySchema = listQuerySchema(['raisedAt', 'severity'] as const).extend({
  status: z.enum([...ALERT_STATUSES, 'active'] as [string, ...string[]]).optional(),
  severity: z.enum(ALERT_SEVERITIES).optional(),
  alertType: z.enum(ALERT_TYPES).optional(),
  tripId: idSchema.optional(),
});

export const alertAckSchema = z.object({ note: optionalText(255) });
export const alertResolveSchema = z.object({ note: z.string().trim().min(3, 'Say how it was resolved').max(255) });

export const incidentListQuerySchema = listQuerySchema(['reportedAt', 'severity', 'incidentNo'] as const).extend({
  status: z.enum([...INCIDENT_STATUSES, 'active'] as [string, ...string[]]).optional(),
  severity: z.enum(INCIDENT_SEVERITIES).optional(),
  incidentType: z.enum(INCIDENT_TYPES).optional(),
  tripId: idSchema.optional(),
});

export const incidentCreateSchema = z.object({
  incidentType: z.enum(INCIDENT_TYPES),
  severity: z.enum(INCIDENT_SEVERITIES),
  title: z.string().trim().min(3, 'Give the incident a short title').max(160),
  description: optionalText(4000),
  tripId: idSchema.nullable().optional(),
  vehicleId: idSchema.nullable().optional(),
  driverId: idSchema.nullable().optional(),
  lat: lat.nullable().optional(),
  lng: lng.nullable().optional(),
  locationText: optionalText(255),
  /** Raise from an alert: the alert is linked and acknowledged. */
  alertId: idSchema.optional(),
});

export const incidentChangeSchema = z
  .object({
    status: z.enum(INCIDENT_STATUSES).optional(),
    severity: z.enum(INCIDENT_SEVERITIES).optional(),
    assignedToUserId: idSchema.nullable().optional(),
    note: optionalText(2000),
    resolution: optionalText(2000),
    version: z.coerce.number().int().positive().optional(),
  })
  .refine((c) => c.status || c.severity || c.assignedToUserId !== undefined || c.note, { message: 'Nothing to change' })
  .refine((c) => c.status !== 'resolved' || (c.resolution && c.resolution.length >= 5), { message: 'Describe the resolution', path: ['resolution'] });

export const sosSchema = z.object({ note: optionalText(500), lat: lat.optional(), lng: lng.optional() });
export const checkinSchema = z.object({ note: optionalText(255), lat: lat.optional(), lng: lng.optional() });

export const notificationListQuerySchema = z.object({
  unread: z.enum(['true', 'false']).optional(),
  page: z.coerce.number().int().min(1).max(1000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(30),
});

// ------------------------------------------------------------------ DTOs

export interface PositionDto {
  lat: number;
  lng: number;
  speedKmph: number | null;
  headingDeg: number | null;
  recordedAt: string;
  source: GpsSource;
  isSimulated: boolean;
}

/** One row of the live map: a vehicle, its latest position and its active trip, if any. */
export interface LiveVehicleDto {
  vehicleId: number;
  registrationNo: string;
  vehicleType: string;
  position: PositionDto | null;
  /** live: under 2 min; recent: under 10 min; stale: older or none. */
  freshness: 'live' | 'recent' | 'stale';
  trip: {
    id: number;
    tripNo: string;
    status: TripStatus;
    originCity: string;
    destinationCity: string;
    plannedEnd: string;
    driver: { id: number; fullName: string; phone: string };
    customerName: string | null;
  } | null;
  eta: EtaDto | null;
  openAlerts: number;
  /** Which demo scenario the simulator is playing for this trip (simulated data only). */
  scenario: SimScenario | null;
}

export interface TripTrackDto {
  tripId: number;
  tripNo: string;
  status: TripStatus;
  plannedPath: [number, number][];
  /** Actual positions, oldest first. */
  breadcrumb: { lat: number; lng: number; at: string; speedKmph: number | null }[];
  stops: { id: number; seq: number; name: string; lat: number | null; lng: number | null; status: string }[];
  position: PositionDto | null;
  eta: EtaDto | null;
}

export interface SafetyAlertDto {
  id: number;
  alertType: AlertType;
  severity: AlertSeverity;
  status: AlertStatus;
  title: string;
  detail: string | null;
  trip: { id: number; tripNo: string } | null;
  vehicle: { id: number; registrationNo: string } | null;
  driver: { id: number; fullName: string; phone: string } | null;
  lat: number | null;
  lng: number | null;
  isSimulated: boolean;
  raisedAt: string;
  lastSeenAt: string;
  occurrences: number;
  acknowledgedAt: string | null;
  acknowledgedBy: string | null;
  resolvedAt: string | null;
  resolvedBy: string | null;
  resolutionNote: string | null;
  autoResolved: boolean;
  incidentId: number | null;
}

export interface IncidentUpdateDto {
  id: number;
  kind: 'note' | 'status_change' | 'assignment' | 'escalation' | 'created';
  body: string | null;
  fromStatus: IncidentStatus | null;
  toStatus: IncidentStatus | null;
  by: string | null;
  at: string;
}

export interface IncidentDto {
  id: number;
  incidentNo: string;
  incidentType: IncidentType;
  severity: IncidentSeverity;
  status: IncidentStatus;
  title: string;
  description: string | null;
  trip: { id: number; tripNo: string } | null;
  vehicle: { id: number; registrationNo: string } | null;
  driver: { id: number; fullName: string; phone: string } | null;
  lat: number | null;
  lng: number | null;
  locationText: string | null;
  reportedBy: string | null;
  reportedAt: string;
  assignedTo: { id: number; fullName: string } | null;
  resolvedAt: string | null;
  resolution: string | null;
  isSimulated: boolean;
  updates: IncidentUpdateDto[];
  allowedStatuses: IncidentStatus[];
  version: number;
}

export interface CheckinDto {
  id: number;
  trip: { id: number; tripNo: string };
  worker: { id: number; fullName: string; phone: string };
  dueAt: string;
  checkedInAt: string | null;
  status: CheckinStatus;
  note: string | null;
}

export interface NotificationDto {
  id: number;
  category: NotificationCategory;
  priority: NotificationPriority;
  title: string;
  body: string | null;
  link: string | null;
  createdAt: string;
  readAt: string | null;
  acknowledgedAt: string | null;
  escalatedAt: string | null;
}

/** Control-room summary counters. */
export interface LiveSummaryDto {
  vehiclesTracked: number;
  live: number;
  stale: number;
  openAlerts: { critical: number; warning: number; info: number };
  activeIncidents: number;
  missedCheckins: number;
  simulated: boolean;
}
