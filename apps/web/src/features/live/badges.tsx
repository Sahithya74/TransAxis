import type { AlertSeverity, AlertStatus, AlertType, IncidentSeverity, IncidentStatus, IncidentType } from '@transaxis/shared';
import { Badge, type Tone } from '../../components/ui/Badge';

export const ALERT_TYPE_LABEL: Record<AlertType, string> = {
  route_deviation: 'Route deviation',
  unexpected_stop: 'Unplanned stop',
  overspeed: 'Overspeeding',
  gps_stale: 'No GPS signal',
  geofence_breach: 'Restricted zone',
  late_arrival: 'Running late',
  missed_checkin: 'Missed check-in',
  sos: 'SOS',
};

export const INCIDENT_TYPE_LABEL: Record<IncidentType, string> = {
  accident: 'Accident',
  breakdown: 'Breakdown',
  theft: 'Theft or tampering',
  cargo_damage: 'Cargo damage',
  medical: 'Medical',
  harassment: 'Harassment or extortion',
  road_block: 'Road block',
  sos: 'SOS',
  other: 'Other',
};

const SEV: Record<AlertSeverity | IncidentSeverity, [Tone, string]> = {
  critical: ['crit', 'Critical'],
  high: ['crit', 'High'],
  warning: ['warn', 'Warning'],
  medium: ['warn', 'Medium'],
  info: ['info', 'Info'],
  low: ['neutral', 'Low'],
};

const ALERT_STATUS: Record<AlertStatus, [Tone, string]> = { open: ['crit', 'Open'], acknowledged: ['warn', 'Acknowledged'], resolved: ['ok', 'Resolved'] };
const INCIDENT_STATUS: Record<IncidentStatus, [Tone, string]> = {
  open: ['crit', 'Open'],
  investigating: ['warn', 'Investigating'],
  escalated: ['crit', 'Escalated'],
  resolved: ['ok', 'Resolved'],
  closed: ['neutral', 'Closed'],
};

export const SeverityBadge = ({ severity }: { severity: AlertSeverity | IncidentSeverity }) => <Badge tone={SEV[severity][0]}>{SEV[severity][1]}</Badge>;
export const AlertStatusBadge = ({ status }: { status: AlertStatus }) => <Badge tone={ALERT_STATUS[status][0]}>{ALERT_STATUS[status][1]}</Badge>;
export const IncidentStatusBadge = ({ status }: { status: IncidentStatus }) => <Badge tone={INCIDENT_STATUS[status][0]}>{INCIDENT_STATUS[status][1]}</Badge>;

/** Simulated data must always be visibly labelled. */
export const SimulatedBadge = () => (
  <Badge tone="neutral" title="Positions come from the built-in simulator, not real GPS devices">SIMULATED</Badge>
);
