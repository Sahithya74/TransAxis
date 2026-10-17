/** Enumerations for live tracking, safety alerts, incidents, check-ins and notifications. */

/** Where a position fix came from. Simulated fixes are always labelled as such in the UI. */
export const GPS_SOURCES = ['simulated', 'device', 'manual'] as const;
export type GpsSource = (typeof GPS_SOURCES)[number];

export const ALERT_TYPES = [
  'route_deviation',
  'unexpected_stop',
  'overspeed',
  'gps_stale',
  'geofence_breach',
  'late_arrival',
  'missed_checkin',
  'sos',
] as const;
export type AlertType = (typeof ALERT_TYPES)[number];

export const ALERT_SEVERITIES = ['info', 'warning', 'critical'] as const;
export type AlertSeverity = (typeof ALERT_SEVERITIES)[number];

export const ALERT_STATUSES = ['open', 'acknowledged', 'resolved'] as const;
export type AlertStatus = (typeof ALERT_STATUSES)[number];

export const INCIDENT_TYPES = ['accident', 'breakdown', 'theft', 'cargo_damage', 'medical', 'harassment', 'road_block', 'sos', 'other'] as const;
export type IncidentType = (typeof INCIDENT_TYPES)[number];

export const INCIDENT_SEVERITIES = ['low', 'medium', 'high', 'critical'] as const;
export type IncidentSeverity = (typeof INCIDENT_SEVERITIES)[number];

export const INCIDENT_STATUSES = ['open', 'investigating', 'escalated', 'resolved', 'closed'] as const;
export type IncidentStatus = (typeof INCIDENT_STATUSES)[number];

/** Allowed incident status changes. Closing requires a resolution first. */
export const INCIDENT_TRANSITIONS: Record<IncidentStatus, readonly IncidentStatus[]> = {
  open: ['investigating', 'escalated', 'resolved'],
  investigating: ['escalated', 'resolved'],
  escalated: ['investigating', 'resolved'],
  resolved: ['closed', 'investigating'],
  closed: [],
};

export const CHECKIN_STATUSES = ['pending', 'ok', 'missed'] as const;
export type CheckinStatus = (typeof CHECKIN_STATUSES)[number];

export const NOTIFICATION_CATEGORIES = ['alert', 'incident', 'trip', 'compliance', 'checkin', 'system'] as const;
export type NotificationCategory = (typeof NOTIFICATION_CATEGORIES)[number];

export const NOTIFICATION_PRIORITIES = ['low', 'normal', 'high', 'critical'] as const;
export type NotificationPriority = (typeof NOTIFICATION_PRIORITIES)[number];

export const GEOFENCE_KINDS = ['depot', 'customer_site', 'restricted', 'checkpoint'] as const;
export type GeofenceKind = (typeof GEOFENCE_KINDS)[number];

/** How an ETA was worked out, best first. The UI always shows which one was used. */
export const ETA_METHODS = ['provider', 'historical', 'fallback', 'schedule'] as const;
export type EtaMethod = (typeof ETA_METHODS)[number];
