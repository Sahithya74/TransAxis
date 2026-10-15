import { VEHICLE_DOC_LABELS, type VehicleComplianceSummary, type VehicleStatus } from '@transaxis/shared';
import { Badge, type Tone } from '../../components/ui/Badge';
import { daysBetween, fmtDate } from '../../lib/format';

const statusTone: Record<VehicleStatus, Tone> = {
  available: 'ok',
  assigned: 'info',
  on_trip: 'info',
  under_maintenance: 'warn',
  unavailable: 'warn',
  retired: 'neutral',
};

export const VEHICLE_STATUS_LABEL: Record<VehicleStatus, string> = {
  available: 'Available',
  assigned: 'Assigned',
  on_trip: 'On trip',
  under_maintenance: 'Under maintenance',
  unavailable: 'Unavailable',
  retired: 'Retired',
};

export function VehicleStatusBadge({ status }: { status: VehicleStatus }) {
  return <Badge tone={statusTone[status]}>{VEHICLE_STATUS_LABEL[status]}</Badge>;
}

export function ComplianceBadge({ compliance, today }: { compliance: VehicleComplianceSummary; today: string }) {
  const list = (types: string[]) => types.map((t) => VEHICLE_DOC_LABELS[t as keyof typeof VEHICLE_DOC_LABELS] ?? t).join(', ');
  switch (compliance.state) {
    case 'expired':
      return <Badge tone="crit" title={`Expired: ${list(compliance.expired)}`}>Expired ({compliance.expired.length})</Badge>;
    case 'missing':
      return <Badge tone="crit" title={`Missing: ${list(compliance.missing)}`}>Missing docs ({compliance.missing.length})</Badge>;
    case 'expiring': {
      const d = compliance.nextExpiry ? daysBetween(today, compliance.nextExpiry) : null;
      return (
        <Badge tone="warn" title={`Expiring: ${list(compliance.expiringSoon)} on ${fmtDate(compliance.nextExpiry)}`}>
          {d === 0 ? 'Expires today' : `Expires in ${d} d`}
        </Badge>
      );
    }
    default:
      return <Badge tone="ok" title={compliance.nextExpiry ? `Next expiry ${fmtDate(compliance.nextExpiry)}` : undefined}>Compliant</Badge>;
  }
}
