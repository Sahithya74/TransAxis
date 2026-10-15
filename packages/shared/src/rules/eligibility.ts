import { MANDATORY_VEHICLE_DOCS, VEHICLE_DOC_LABELS, type BodyType, type VehicleDocType, type VehicleStatus } from '../enums.js';
import type { EmploymentStatus, LicenceVerification, WorkerType } from '../enums-ops.js';
import { addDays } from './compliance.js';
import { licenceCovers } from './licence.js';

/**
 * Deterministic assignment checks. `block` violations stop the assignment outright; `warn`
 * violations need an authorised override with a written reason. The API gathers the facts (with row
 * locks held) and this function decides, so the same rules are unit-testable and explainable.
 */
export type Severity = 'block' | 'warn';

export interface Violation {
  code: string;
  severity: Severity;
  resource: 'vehicle' | 'driver' | 'crew';
  resourceId: number;
  message: string;
}

export interface Window {
  /** ISO datetimes (UTC). */
  start: string;
  end: string;
  /** Org-local calendar dates for document validity checks (YYYY-MM-DD). */
  startDate: string;
  endDate: string;
}

export interface Requirements {
  totalWeightKg: number;
  totalVolumeCbm: number | null;
  requiredVehicleTypeId: number | null;
  requiredBodyType: BodyType | null;
  requiresTemperatureControl: boolean;
  isHazardous: boolean;
}

export interface ConflictRef {
  tripId: number;
  tripNo: string;
  start: string;
  end: string;
}

export interface VehicleFacts {
  id: number;
  registrationNo: string;
  status: VehicleStatus;
  vehicleTypeId: number;
  bodyType: BodyType;
  requiredLicenceClass: string;
  payloadCapacityKg: number;
  volumeCapacityCbm: number | null;
  documents: { docType: VehicleDocType; expiresOn: string | null }[];
  conflicts: ConflictRef[];
}

export interface WorkerFacts {
  id: number;
  name: string;
  workerType: WorkerType;
  employmentStatus: EmploymentStatus;
  licence: { validUntil: string; classes: string[]; verification: LicenceVerification } | null;
  hazmatCertified: boolean;
  medicalValidUntil: string | null;
  approvedLeave: { from: string; to: string }[];
  /** End of this worker's most recent trip before the window, if any (ISO). */
  lastTripEnd: string | null;
  conflicts: ConflictRef[];
}

export interface EligibilitySettings {
  expiryWarningDays: number;
  minRestHours: number;
  maxDutyHours: number;
}

export const DEFAULT_ELIGIBILITY_SETTINGS: EligibilitySettings = {
  expiryWarningDays: 15,
  minRestHours: 8,
  maxDutyHours: 12,
};

export interface AssignmentInput {
  window: Window;
  requirements: Requirements;
  vehicle: VehicleFacts;
  driver: WorkerFacts;
  crew: WorkerFacts[];
  settings?: Partial<EligibilitySettings>;
}

export interface AssignmentResult {
  ok: boolean;
  blocks: Violation[];
  warnings: Violation[];
}

const fmtKg = (kg: number) => `${(kg / 1000).toLocaleString('en-IN', { maximumFractionDigits: 2 })} t`;
const hoursBetween = (a: string, b: string) => (Date.parse(b) - Date.parse(a)) / 3_600_000;

export function checkAssignment(input: AssignmentInput): AssignmentResult {
  const s = { ...DEFAULT_ELIGIBILITY_SETTINGS, ...input.settings };
  const out: Violation[] = [];
  out.push(...checkVehicle(input.vehicle, input.requirements, input.window, s));
  out.push(...checkDriver(input.driver, input.vehicle, input.requirements, input.window, s, input.crew));
  for (const c of input.crew) out.push(...checkCrew(c, input.window, input.driver.id));
  const blocks = out.filter((v) => v.severity === 'block');
  const warnings = out.filter((v) => v.severity === 'warn');
  return { ok: blocks.length === 0 && warnings.length === 0, blocks, warnings };
}

function checkVehicle(v: VehicleFacts, req: Requirements, w: Window, s: EligibilitySettings): Violation[] {
  const out: Violation[] = [];
  const add = (code: string, severity: Severity, message: string) =>
    out.push({ code, severity, resource: 'vehicle', resourceId: v.id, message });

  if (v.status === 'under_maintenance' || v.status === 'unavailable' || v.status === 'retired') {
    add('VEHICLE_UNAVAILABLE', 'block', `${v.registrationNo} is ${v.status.replace('_', ' ')}`);
  }
  if (req.totalWeightKg > v.payloadCapacityKg) {
    add('VEHICLE_OVER_CAPACITY', 'block', `Cargo ${fmtKg(req.totalWeightKg)} exceeds ${v.registrationNo}'s payload of ${fmtKg(v.payloadCapacityKg)}`);
  }
  if (req.totalVolumeCbm && v.volumeCapacityCbm && req.totalVolumeCbm > v.volumeCapacityCbm) {
    add('VEHICLE_OVER_VOLUME', 'block', `Cargo volume ${req.totalVolumeCbm} m³ exceeds ${v.volumeCapacityCbm} m³`);
  }
  if (req.requiredVehicleTypeId && req.requiredVehicleTypeId !== v.vehicleTypeId) {
    add('VEHICLE_TYPE_MISMATCH', 'block', `Booking requires a different vehicle type`);
  }
  if (req.requiredBodyType && req.requiredBodyType !== v.bodyType) {
    add('VEHICLE_BODY_MISMATCH', 'block', `Booking requires a ${req.requiredBodyType} body; ${v.registrationNo} is ${v.bodyType}`);
  }
  if (req.requiresTemperatureControl && v.bodyType !== 'reefer') {
    add('VEHICLE_NOT_REEFER', 'block', `Temperature-controlled cargo needs a reefer; ${v.registrationNo} is ${v.bodyType}`);
  }

  // Each mandatory document must be valid for the whole trip (latest renewal wins).
  const latest = new Map<VehicleDocType, string | null>();
  for (const d of v.documents) {
    const cur = latest.get(d.docType);
    if (!latest.has(d.docType) || (cur !== null && (d.expiresOn === null || d.expiresOn > (cur ?? '')))) {
      latest.set(d.docType, d.expiresOn);
    }
  }
  for (const type of MANDATORY_VEHICLE_DOCS) {
    const label = VEHICLE_DOC_LABELS[type];
    if (!latest.has(type)) {
      add('VEHICLE_DOC_MISSING', 'block', `${label} is not on file for ${v.registrationNo}`);
      continue;
    }
    const exp = latest.get(type) ?? null;
    if (exp === null) continue;
    if (exp < w.endDate) {
      add('VEHICLE_DOC_EXPIRED', 'block', `${label} for ${v.registrationNo} ${exp < w.startDate ? 'expired' : 'expires'} on ${exp}, before the trip ends`);
    } else if (exp <= addDays(w.endDate, s.expiryWarningDays)) {
      add('VEHICLE_DOC_EXPIRING', 'warn', `${label} for ${v.registrationNo} expires on ${exp}, within ${s.expiryWarningDays} days of the trip`);
    }
  }

  for (const c of v.conflicts) {
    add('VEHICLE_CONFLICT', 'block', `${v.registrationNo} is already reserved for trip ${c.tripNo} in an overlapping window`);
  }
  return out;
}

function checkDriver(
  d: WorkerFacts,
  v: VehicleFacts,
  req: Requirements,
  w: Window,
  s: EligibilitySettings,
  crew: WorkerFacts[],
): Violation[] {
  const out: Violation[] = [];
  const add = (code: string, severity: Severity, message: string) =>
    out.push({ code, severity, resource: 'driver', resourceId: d.id, message });

  if (d.workerType !== 'driver') add('DRIVER_NOT_DRIVER', 'block', `${d.name} is registered as a ${d.workerType}, not a driver`);
  if (d.employmentStatus !== 'active') add('DRIVER_INACTIVE', 'block', `${d.name} is ${d.employmentStatus}`);

  if (!d.licence) {
    add('DRIVER_NO_LICENCE', 'block', `${d.name} has no driving licence on file`);
  } else {
    if (d.licence.verification === 'rejected') add('DRIVER_LICENCE_REJECTED', 'block', `${d.name}'s licence failed verification`);
    if (d.licence.validUntil < w.endDate) {
      add('DRIVER_LICENCE_EXPIRED', 'block', `${d.name}'s licence ${d.licence.validUntil < w.startDate ? 'expired' : 'expires'} on ${d.licence.validUntil}, before the trip ends`);
    } else if (d.licence.validUntil <= addDays(w.endDate, s.expiryWarningDays)) {
      add('DRIVER_LICENCE_EXPIRING', 'warn', `${d.name}'s licence expires on ${d.licence.validUntil}`);
    }
    if (!licenceCovers(d.licence.classes, v.requiredLicenceClass)) {
      add('DRIVER_LICENCE_CLASS', 'block', `${d.name}'s licence (${d.licence.classes.join(', ') || 'no classes'}) does not cover ${v.requiredLicenceClass} required by ${v.registrationNo}`);
    }
    if (d.licence.verification === 'unverified') add('DRIVER_LICENCE_UNVERIFIED', 'warn', `${d.name}'s licence has not been verified`);
  }

  if (req.isHazardous && !d.hazmatCertified) {
    add('DRIVER_NO_HAZMAT', 'block', `Hazardous cargo needs a driver with valid hazmat training; ${d.name} has none`);
  }
  if (d.medicalValidUntil && d.medicalValidUntil < w.endDate) {
    add('DRIVER_MEDICAL_EXPIRED', 'warn', `${d.name}'s medical certificate expired on ${d.medicalValidUntil}`);
  }
  for (const l of d.approvedLeave) {
    if (l.from <= w.endDate && l.to >= w.startDate) add('DRIVER_ON_LEAVE', 'block', `${d.name} is on approved leave ${l.from} to ${l.to}`);
  }
  for (const c of d.conflicts) add('DRIVER_CONFLICT', 'block', `${d.name} is already assigned to trip ${c.tripNo} in an overlapping window`);

  if (d.lastTripEnd) {
    const rest = hoursBetween(d.lastTripEnd, w.start);
    if (rest >= 0 && rest < s.minRestHours) {
      add('DRIVER_REST', 'warn', `${d.name} would have only ${rest.toFixed(1)} h rest since the last trip (minimum ${s.minRestHours} h)`);
    }
  }
  const duty = hoursBetween(w.start, w.end);
  const hasCoDriver = crew.some((c) => c.workerType === 'driver');
  if (duty > s.maxDutyHours && !hasCoDriver) {
    add('DRIVER_DUTY_HOURS', 'warn', `Planned duty of ${duty.toFixed(1)} h exceeds ${s.maxDutyHours} h without a co-driver; confirm rest stops are planned`);
  }
  return out;
}

function checkCrew(c: WorkerFacts, w: Window, driverId: number): Violation[] {
  const out: Violation[] = [];
  const add = (code: string, message: string) => out.push({ code, severity: 'block', resource: 'crew', resourceId: c.id, message });
  if (c.id === driverId) add('CREW_IS_DRIVER', `${c.name} is already the driver`);
  if (c.employmentStatus !== 'active') add('CREW_INACTIVE', `${c.name} is ${c.employmentStatus}`);
  for (const l of c.approvedLeave) {
    if (l.from <= w.endDate && l.to >= w.startDate) add('CREW_ON_LEAVE', `${c.name} is on approved leave ${l.from} to ${l.to}`);
  }
  for (const k of c.conflicts) add('CREW_CONFLICT', `${c.name} is already assigned to trip ${k.tripNo} in an overlapping window`);
  return out;
}

/** True when two half-open intervals [aStart, aEnd) and [bStart, bEnd) overlap. */
export function overlaps(aStart: string, aEnd: string, bStart: string, bEnd: string): boolean {
  return Date.parse(aStart) < Date.parse(bEnd) && Date.parse(bStart) < Date.parse(aEnd);
}
