import { describe, expect, it } from 'vitest';
import { checkAssignment, overlaps, type AssignmentInput, type VehicleFacts, type WorkerFacts } from './eligibility.js';
import { licenceCovers } from './licence.js';

const window = { start: '2026-10-20T03:30:00.000Z', end: '2026-10-20T15:30:00.000Z', startDate: '2026-10-20', endDate: '2026-10-20' };
const validDocs = (['registration', 'insurance', 'fitness', 'permit', 'pollution'] as const).map((docType) => ({ docType, expiresOn: '2027-06-30' }));

const vehicle = (o: Partial<VehicleFacts> = {}): VehicleFacts => ({
  id: 1,
  registrationNo: 'TN01AB1234',
  status: 'available',
  vehicleTypeId: 10,
  bodyType: 'open',
  requiredLicenceClass: 'HGMV',
  payloadCapacityKg: 16000,
  volumeCapacityCbm: null,
  documents: validDocs,
  conflicts: [],
  ...o,
});

const worker = (o: Partial<WorkerFacts> = {}): WorkerFacts => ({
  id: 100,
  name: 'Murugan',
  workerType: 'driver',
  employmentStatus: 'active',
  licence: { validUntil: '2030-01-01', classes: ['HGMV'], verification: 'verified' },
  hazmatCertified: false,
  medicalValidUntil: null,
  approvedLeave: [],
  lastTripEnd: null,
  conflicts: [],
  ...o,
});

const input = (o: Partial<AssignmentInput> = {}): AssignmentInput => ({
  window,
  requirements: {
    totalWeightKg: 12000,
    totalVolumeCbm: null,
    requiredVehicleTypeId: null,
    requiredBodyType: null,
    requiresTemperatureControl: false,
    isHazardous: false,
  },
  vehicle: vehicle(),
  driver: worker(),
  crew: [],
  ...o,
});

const codes = (r: ReturnType<typeof checkAssignment>) => [...r.blocks, ...r.warnings].map((v) => v.code);

describe('checkAssignment', () => {
  it('passes a compliant assignment', () => {
    const r = checkAssignment(input());
    expect(r).toEqual({ ok: true, blocks: [], warnings: [] });
  });

  it('blocks cargo heavier than the payload', () => {
    const r = checkAssignment(input({ requirements: { ...input().requirements, totalWeightKg: 16001 } }));
    expect(r.blocks.map((b) => b.code)).toEqual(['VEHICLE_OVER_CAPACITY']);
    expect(r.blocks[0]!.message).toContain('16 t');
  });

  it('allows cargo exactly at the payload limit', () => {
    expect(checkAssignment(input({ requirements: { ...input().requirements, totalWeightKg: 16000 } })).ok).toBe(true);
  });

  it('blocks vehicles under maintenance and with expired or missing documents', () => {
    const r = checkAssignment(
      input({
        vehicle: vehicle({
          status: 'under_maintenance',
          documents: validDocs.filter((d) => d.docType !== 'pollution').map((d) => (d.docType === 'insurance' ? { ...d, expiresOn: '2026-10-19' } : d)),
        }),
      }),
    );
    expect(codes(r)).toEqual(expect.arrayContaining(['VEHICLE_UNAVAILABLE', 'VEHICLE_DOC_EXPIRED', 'VEHICLE_DOC_MISSING']));
  });

  it('blocks a document that expires during the trip, warns when it expires soon after', () => {
    const multiDay = { ...window, end: '2026-10-22T10:00:00.000Z', endDate: '2026-10-22' };
    const during = checkAssignment(input({ window: multiDay, vehicle: vehicle({ documents: validDocs.map((d) => (d.docType === 'permit' ? { ...d, expiresOn: '2026-10-21' } : d)) }) }));
    expect(during.blocks.map((b) => b.code)).toEqual(['VEHICLE_DOC_EXPIRED']);
    const soon = checkAssignment(input({ vehicle: vehicle({ documents: validDocs.map((d) => (d.docType === 'permit' ? { ...d, expiresOn: '2026-10-30' } : d)) }) }));
    expect(soon.blocks).toEqual([]);
    expect(soon.warnings.map((w) => w.code)).toEqual(['VEHICLE_DOC_EXPIRING']);
  });

  it('requires a reefer for temperature-controlled loads and matching body/type requirements', () => {
    const r = checkAssignment(input({ requirements: { ...input().requirements, requiresTemperatureControl: true, requiredBodyType: 'container', requiredVehicleTypeId: 99 } }));
    expect(codes(r)).toEqual(expect.arrayContaining(['VEHICLE_NOT_REEFER', 'VEHICLE_BODY_MISMATCH', 'VEHICLE_TYPE_MISMATCH']));
  });

  it('blocks an expired licence and one that lacks the required class', () => {
    const expired = checkAssignment(input({ driver: worker({ licence: { validUntil: '2026-10-01', classes: ['HGMV'], verification: 'verified' } }) }));
    expect(expired.blocks.map((b) => b.code)).toEqual(['DRIVER_LICENCE_EXPIRED']);
    const wrongClass = checkAssignment(input({ driver: worker({ licence: { validUntil: '2030-01-01', classes: ['LMV-TR'], verification: 'verified' } }) }));
    expect(wrongClass.blocks.map((b) => b.code)).toEqual(['DRIVER_LICENCE_CLASS']);
  });

  it('blocks non-drivers, inactive workers, missing licences, leave and conflicts', () => {
    const r = checkAssignment(
      input({
        driver: worker({
          workerType: 'helper',
          employmentStatus: 'suspended',
          licence: null,
          approvedLeave: [{ from: '2026-10-19', to: '2026-10-21' }],
          conflicts: [{ tripId: 5, tripNo: 'TRP-2026-000005', start: window.start, end: window.end }],
        }),
      }),
    );
    expect(codes(r)).toEqual(expect.arrayContaining(['DRIVER_NOT_DRIVER', 'DRIVER_INACTIVE', 'DRIVER_NO_LICENCE', 'DRIVER_ON_LEAVE', 'DRIVER_CONFLICT']));
  });

  it('requires hazmat certification for hazardous cargo', () => {
    const r = checkAssignment(input({ requirements: { ...input().requirements, isHazardous: true } }));
    expect(r.blocks.map((b) => b.code)).toEqual(['DRIVER_NO_HAZMAT']);
    expect(checkAssignment(input({ requirements: { ...input().requirements, isHazardous: true }, driver: worker({ hazmatCertified: true }) })).ok).toBe(true);
  });

  it('warns (not blocks) on short rest, long duty without co-driver and unverified licence', () => {
    const r = checkAssignment(
      input({
        window: { ...window, end: '2026-10-20T19:30:00.000Z' },
        driver: worker({ lastTripEnd: '2026-10-19T23:00:00.000Z', licence: { validUntil: '2030-01-01', classes: ['HTV'], verification: 'unverified' } }),
      }),
    );
    expect(r.blocks).toEqual([]);
    expect(r.warnings.map((w) => w.code).sort()).toEqual(['DRIVER_DUTY_HOURS', 'DRIVER_LICENCE_UNVERIFIED', 'DRIVER_REST']);
  });

  it('a co-driver removes the duty-hours warning', () => {
    const r = checkAssignment(input({ window: { ...window, end: '2026-10-20T19:30:00.000Z' }, crew: [worker({ id: 101, name: 'Selvam' })] }));
    expect(r.ok).toBe(true);
  });

  it('checks crew availability and refuses the driver as their own helper', () => {
    const r = checkAssignment(input({ crew: [worker({ id: 100 }), worker({ id: 102, name: 'Kumar', workerType: 'helper', approvedLeave: [{ from: '2026-10-20', to: '2026-10-20' }] })] }));
    expect(codes(r)).toEqual(expect.arrayContaining(['CREW_IS_DRIVER', 'CREW_ON_LEAVE']));
  });
});

describe('licenceCovers', () => {
  it('lets higher transport classes drive lower ones', () => {
    expect(licenceCovers(['HTV'], 'HGMV')).toBe(true);
    expect(licenceCovers(['HGMV'], 'LMV-TR')).toBe(true);
    expect(licenceCovers(['MGV'], 'HGMV')).toBe(false);
  });

  it('never implies a trailer endorsement', () => {
    expect(licenceCovers(['HTV'], 'TRAILER')).toBe(false);
    expect(licenceCovers(['HGMV', 'TRAILER'], 'TRAILER')).toBe(true);
  });
});

describe('overlaps', () => {
  it('treats touching intervals as not overlapping', () => {
    expect(overlaps('2026-10-20T00:00:00Z', '2026-10-20T10:00:00Z', '2026-10-20T10:00:00Z', '2026-10-20T12:00:00Z')).toBe(false);
    expect(overlaps('2026-10-20T00:00:00Z', '2026-10-20T10:00:01Z', '2026-10-20T10:00:00Z', '2026-10-20T12:00:00Z')).toBe(true);
  });
});
