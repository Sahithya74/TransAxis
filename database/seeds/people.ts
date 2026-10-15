import { addDays, type LicenceClass } from '@transaxis/shared';
import type { Db } from '../src/client.js';
import * as s from '../src/schema/index.js';
import { INSPECTION_ITEMS_POST, INSPECTION_ITEMS_PRE } from './data/people.js';
import { fakeMobile } from './helpers.js';
import type { Rng } from './prng.js';

export interface SeededWorker {
  id: number;
  name: string;
  workerType: 'driver' | 'helper';
  classes: LicenceClass[];
  /** Usable for new assignments today (active, valid verified licence, not on leave). */
  assignable: boolean;
  /** Usable for historical trips (employed at the time, licence covered the vehicle). */
  historical: boolean;
  hazmat: boolean;
}

const RELATIONS = ['Spouse', 'Father', 'Mother', 'Brother', 'Sister'];
const BLOOD = ['A+', 'B+', 'O+', 'AB+', 'O-', 'B-'] as const;

/**
 * Seeds workers with a deliberate spread of problems for the assignment rules to catch:
 * idx 12 licence expired, idx 7 and 18 expiring, idx 22 and 27 unverified, idx 15 on approved leave,
 * idx 20 pending leave, idx 25 suspended, idx 29 terminated, idx 10 medical expired.
 * Drivers 5, 6 and 8 hold trailer endorsements; 2 and 9 are hazmat trained.
 */
export async function seedPeople(
  db: Db,
  rng: Rng,
  opts: { orgId: number; anchor: string; branchIds: number[]; drivers: string[]; helpers: string[]; codePrefix: string; hrUserId: number | null },
): Promise<{ drivers: SeededWorker[]; helpers: SeededWorker[] }> {
  const { orgId, anchor } = opts;

  const [perKm] = await db
    .insert(s.compensationPolicies)
    .values({ orgId, name: 'Driver: long haul per km', appliesTo: 'driver', basis: 'per_km', rate: '2.5000', dailyAllowance: '350.00', onTimeBonus: '500.00', minPerTrip: '1500.00', effectiveFrom: addDays(anchor, -365) })
    .$returningId();
  const [fixed] = await db
    .insert(s.compensationPolicies)
    .values({ orgId, name: 'Driver: fixed per trip (regional)', appliesTo: 'driver', basis: 'fixed_per_trip', rate: '1400.0000', dailyAllowance: '250.00', onTimeBonus: '300.00', effectiveFrom: addDays(anchor, -365) })
    .$returningId();
  const [helperPolicy] = await db
    .insert(s.compensationPolicies)
    .values({ orgId, name: 'Helper: fixed per trip', appliesTo: 'helper', basis: 'fixed_per_trip', rate: '650.0000', dailyAllowance: '200.00', onTimeBonus: '0.00', effectiveFrom: addDays(anchor, -365) })
    .$returningId();

  const drivers: SeededWorker[] = [];
  for (let i = 0; i < opts.drivers.length; i++) {
    const name = opts.drivers[i]!;
    const status = i === 25 ? 'suspended' : i === 29 ? 'terminated' : 'active';
    const [w] = await db
      .insert(s.workers)
      .values({
        orgId,
        branchId: opts.branchIds.length ? opts.branchIds[i % opts.branchIds.length]! : null,
        employeeCode: `${opts.codePrefix}-DRV-${String(i + 1).padStart(3, '0')}`,
        workerType: 'driver',
        fullName: name,
        phone: fakeMobile(rng),
        dateOfBirth: addDays(anchor, -365 * rng.int(26, 52) - rng.int(0, 364)),
        address: `${rng.int(1, 240)}, ${rng.pick(['Gandhi Street', 'Nehru Nagar', 'Kamaraj Salai', 'Anna Nagar', 'MG Road', 'Station Road'])}`,
        bloodGroup: rng.pick(BLOOD),
        emergencyContactName: `${rng.pick(['Lakshmi', 'Meena', 'Selvi', 'Ravi', 'Kumar', 'Devi'])} ${name.split(' ')[1] ?? ''}`.trim(),
        emergencyContactPhone: fakeMobile(rng),
        emergencyContactRelation: rng.pick(RELATIONS),
        baseMonthlySalary: (rng.int(18, 26) * 1000).toFixed(2),
        employmentStatus: status,
        joinedOn: addDays(anchor, -rng.int(200, 3000)),
        leftOn: status === 'terminated' ? addDays(anchor, -40) : null,
        compensationPolicyId: i % 3 === 2 ? fixed!.id : perKm!.id,
        medicalValidUntil: i === 10 ? addDays(anchor, -20) : addDays(anchor, rng.int(60, 700)),
      })
      .$returningId();

    const classes: LicenceClass[] = [5, 6, 8].includes(i)
      ? ['HTV', 'TRAILER']
      : i === 26 || i === 28
        ? ['LMV-TR']
        : i === 24
          ? ['MGV']
          : i % 7 === 3
            ? ['HTV']
            : ['HGMV'];
    const validUntil = i === 12 ? addDays(anchor, -10) : i === 7 ? addDays(anchor, 6) : i === 18 ? addDays(anchor, 11) : addDays(anchor, rng.int(400, 4000));
    const verification = i === 22 || i === 27 ? 'unverified' : 'verified';
    const [lic] = await db
      .insert(s.driverLicences)
      .values({
        orgId,
        workerId: w!.id,
        licenceNo: `${opts.codePrefix === 'KRL' ? 'TN' : 'MH'}${String(rng.int(1, 99)).padStart(2, '0')}${rng.int(2005, 2020)}${String(rng.int(1, 9999999)).padStart(7, '0')}`,
        issuingState: opts.codePrefix === 'KRL' ? 'Tamil Nadu' : 'Maharashtra',
        issuedOn: addDays(validUntil, -365 * 5),
        validUntil,
        verification,
        verifiedOn: verification === 'verified' ? addDays(anchor, -rng.int(30, 600)) : null,
        verifiedBy: verification === 'verified' ? opts.hrUserId : null,
      })
      .$returningId();
    await db.insert(s.driverLicenceClasses).values(classes.map((c) => ({ licenceId: lic!.id, licenceClass: c })));

    const hazmat = i === 2 || i === 9;
    await db.insert(s.workerTrainings).values([
      { orgId, workerId: w!.id, trainingType: 'induction', completedOn: addDays(anchor, -rng.int(200, 900)), provider: 'In-house' },
      ...(i % 2 === 0
        ? [{ orgId, workerId: w!.id, trainingType: 'defensive_driving' as const, completedOn: addDays(anchor, -rng.int(60, 400)), validUntil: addDays(anchor, rng.int(200, 700)), provider: 'IDTR Gummidipoondi' }]
        : []),
      ...(hazmat ? [{ orgId, workerId: w!.id, trainingType: 'hazmat' as const, completedOn: addDays(anchor, -120), validUntil: addDays(anchor, 610), provider: 'PESO-approved trainer' }] : []),
    ]);
    if (i === 15) {
      await db.insert(s.leaveRequests).values({ orgId, workerId: w!.id, leaveType: 'sick', fromDate: addDays(anchor, -1), toDate: addDays(anchor, 2), reason: 'Fever', status: 'approved', decidedBy: opts.hrUserId, decidedAt: new Date() });
    }
    if (i === 20) {
      await db.insert(s.leaveRequests).values({ orgId, workerId: w!.id, leaveType: 'casual', fromDate: addDays(anchor, 6), toDate: addDays(anchor, 8), reason: 'Family function' });
    }
    await db.insert(s.workerDocuments).values([
      { orgId, workerId: w!.id, docType: 'id_proof', documentNo: `XXXX-XXXX-${rng.int(1000, 9999)}`, notes: 'Aadhaar (masked)' },
      { orgId, workerId: w!.id, docType: 'police_verification', documentNo: `PV-${rng.int(10000, 99999)}`, expiresOn: addDays(anchor, rng.int(100, 900)) },
    ]);

    drivers.push({
      id: w!.id,
      name,
      workerType: 'driver',
      classes,
      hazmat,
      historical: status !== 'suspended',
      assignable: status === 'active' && ![7, 12, 15, 18].includes(i) && verification === 'verified',
    });
  }

  const helpers: SeededWorker[] = [];
  for (let i = 0; i < opts.helpers.length; i++) {
    const [w] = await db
      .insert(s.workers)
      .values({
        orgId,
        branchId: opts.branchIds.length ? opts.branchIds[i % opts.branchIds.length]! : null,
        employeeCode: `${opts.codePrefix}-HLP-${String(i + 1).padStart(3, '0')}`,
        workerType: 'helper',
        fullName: opts.helpers[i]!,
        phone: fakeMobile(rng),
        dateOfBirth: addDays(anchor, -365 * rng.int(21, 45)),
        bloodGroup: rng.pick(BLOOD),
        emergencyContactName: 'Family contact',
        emergencyContactPhone: fakeMobile(rng),
        emergencyContactRelation: rng.pick(RELATIONS),
        baseMonthlySalary: (rng.int(12, 16) * 1000).toFixed(2),
        joinedOn: addDays(anchor, -rng.int(100, 2000)),
        compensationPolicyId: helperPolicy!.id,
      })
      .$returningId();
    helpers.push({ id: w!.id, name: opts.helpers[i]!, workerType: 'helper', classes: [], hazmat: false, historical: true, assignable: true });
  }

  await db.insert(s.inspectionTemplates).values([
    { orgId, name: 'Pre-trip vehicle and cargo check', inspectionType: 'pre_trip', items: INSPECTION_ITEMS_PRE },
    { orgId, name: 'Post-trip check', inspectionType: 'post_trip', items: INSPECTION_ITEMS_POST },
  ]);

  return { drivers, helpers };
}
