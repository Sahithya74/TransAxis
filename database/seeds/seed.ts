import { sql } from 'drizzle-orm';
import {
  ALL_PERMISSIONS,
  DEFAULT_ROLE_PERMISSIONS,
  MANDATORY_VEHICLE_DOCS,
  PERMISSIONS,
  ROLE_KEYS,
  ROLE_LABELS,
  addDays,
  type VehicleStatus,
} from '@transaxis/shared';
import type { Db } from '../src/client.js';
import { hashPassword } from '../src/password.js';
import * as s from '../src/schema/index.js';
import { DEMO_PASSWORD, KAVERI, PLATFORM_ORG, SAHYADRI, VEHICLE_TYPES, type OrgFixture } from './fixtures.js';
import { createRng, type Rng } from './prng.js';

export interface SeedOptions {
  /** Calendar date (YYYY-MM-DD) that relative demo dates are anchored to. */
  anchorDate: string;
}

export interface SeedSummary {
  organizations: number;
  users: number;
  vehicles: number;
  vehicleDocuments: number;
}

/** Removes all rows from every application table (dev/test only). Keeps the migrations journal. */
export async function wipeData(db: Db): Promise<void> {
  const [rows] = (await db.execute(
    sql`SELECT table_name AS t FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name <> '__drizzle_migrations'`,
  )) as unknown as [{ t: string }[]];
  await db.execute(sql`SET FOREIGN_KEY_CHECKS = 0`);
  try {
    // TRUNCATE does not fire DELETE triggers, so the append-only audit table can be reset in dev.
    for (const r of rows) await db.execute(sql.raw(`TRUNCATE TABLE \`${r.t}\``));
  } finally {
    await db.execute(sql`SET FOREIGN_KEY_CHECKS = 1`);
  }
}

export async function seedDatabase(db: Db, opts: SeedOptions): Promise<SeedSummary> {
  const [existing] = await db.select({ n: sql<number>`COUNT(*)` }).from(s.organizations);
  if (Number(existing?.n) > 0) {
    throw new Error('Database already contains data. Re-run with --reset to wipe it first (dev only).');
  }

  const rng = createRng(20261015);
  const passwordHash = await hashPassword(DEMO_PASSWORD);
  const summary: SeedSummary = { organizations: 0, users: 0, vehicles: 0, vehicleDocuments: 0 };

  await db.transaction(async (tx) => {
    // Global permission catalogue.
    await tx.insert(s.permissions).values(
      ALL_PERMISSIONS.map((key) => ({ key, description: PERMISSIONS[key] })),
    );
    const permRows = await tx.select().from(s.permissions);
    const permId = new Map(permRows.map((p) => [p.key, p.id]));

    for (const fixture of [PLATFORM_ORG, KAVERI, SAHYADRI]) {
      const [org] = await tx
        .insert(s.organizations)
        .values({
          code: fixture.code,
          name: fixture.name,
          legalName: fixture.legalName,
          gstin: fixture.gstin || null,
          addressLine: fixture.addressLine,
          city: fixture.city,
          state: fixture.state,
        })
        .$returningId();
      const orgId = org!.id;
      summary.organizations++;

      await tx.insert(s.orgSettings).values([
        { orgId, key: 'compliance.expiry_warning_days', value: 15 },
        { orgId, key: 'demo.is_sample_data', value: true },
      ]);

      // Every org gets the full set of system roles so its admins can reassign people later.
      const roleId = new Map<string, number>();
      for (const key of ROLE_KEYS) {
        if (key === 'super_admin' && fixture !== PLATFORM_ORG) continue;
        const [r] = await tx
          .insert(s.roles)
          .values({ orgId, key, name: ROLE_LABELS[key], isSystem: true })
          .$returningId();
        roleId.set(key, r!.id);
        const perms = DEFAULT_ROLE_PERMISSIONS[key].map((p) => ({ roleId: r!.id, permissionId: permId.get(p)! }));
        if (perms.length) await tx.insert(s.rolePermissions).values(perms);
      }

      for (const u of fixture.users) {
        const [user] = await tx
          .insert(s.users)
          .values({ orgId, email: u.email, passwordHash, fullName: u.fullName, phone: u.phone ?? null })
          .$returningId();
        await tx.insert(s.userRoles).values({ userId: user!.id, roleId: roleId.get(u.role)! });
        summary.users++;
      }

      const branchIds: number[] = [];
      for (const b of fixture.branches) {
        const [br] = await tx.insert(s.branches).values({ orgId, ...b }).$returningId();
        branchIds.push(br!.id);
      }

      if (fixture.fleetSize > 0) {
        const counts = await seedFleet(tx as unknown as Db, rng, orgId, fixture, branchIds, opts.anchorDate);
        summary.vehicles += counts.vehicles;
        summary.vehicleDocuments += counts.documents;
      }
    }

    await tx.insert(s.auditLogs).values({
      action: 'system.seed',
      summary: `Demo data seeded (anchor ${opts.anchorDate})`,
      after: summary,
    });
  });

  return summary;
}

async function seedFleet(
  db: Db,
  rng: Rng,
  orgId: number,
  fixture: OrgFixture,
  branchIds: number[],
  anchor: string,
): Promise<{ vehicles: number; documents: number }> {
  const typeIds: { id: number; fixture: (typeof VEHICLE_TYPES)[number] }[] = [];
  for (const t of VEHICLE_TYPES) {
    const [row] = await db
      .insert(s.vehicleTypes)
      .values({
        orgId,
        name: t.name,
        bodyType: t.bodyType,
        requiredLicenceClass: t.requiredLicenceClass,
        defaultPayloadKg: t.defaultPayloadKg.toFixed(3),
      })
      .$returningId();
    typeIds.push({ id: row!.id, fixture: t });
  }

  // Fleet mix weighted toward the 10/12-wheelers that carry most freight.
  const weights = [2, 4, 6, 5, 3, 2, 3];
  const weighted = typeIds.flatMap((t, i) => Array(weights[i] ?? 1).fill(t) as typeof typeIds);
  const usedPlates = new Set<string>();
  let documents = 0;

  for (let i = 0; i < fixture.fleetSize; i++) {
    const type = weighted[i % weighted.length] === undefined ? rng.pick(typeIds) : rng.pick(weighted);
    const [make, model, kmpl] = rng.pick(type.fixture.models);
    let plate = '';
    do {
      const series = String.fromCharCode(65 + rng.int(0, 25), 65 + rng.int(0, 25));
      plate = `${rng.pick(fixture.plates)}${series}${String(rng.int(1000, 9999))}`;
    } while (usedPlates.has(plate));
    usedPlates.add(plate);

    // A handful of non-available vehicles so status filters have something to show.
    let status: VehicleStatus = 'available';
    if (i === 3 || i === 17) status = 'under_maintenance';
    if (i === 11) status = 'unavailable';
    if (i === fixture.fleetSize - 1 && fixture.fleetSize > 10) status = 'retired';

    const year = rng.int(2016, 2025);
    const payload = Math.round(type.fixture.defaultPayloadKg * (0.95 + rng.next() * 0.1));
    const odometer = (2026 - year) * rng.int(60_000, 110_000) + rng.int(0, 9_999);
    const [veh] = await db
      .insert(s.vehicles)
      .values({
        orgId,
        branchId: branchIds.length ? rng.pick(branchIds) : null,
        vehicleTypeId: type.id,
        registrationNo: plate,
        make,
        model,
        year,
        ownership: i % 9 === 8 ? 'attached' : i % 7 === 6 ? 'leased' : 'owned',
        payloadCapacityKg: payload.toFixed(3),
        volumeCapacityCbm: type.fixture.bodyType === 'container' ? '62.00' : null,
        fuelType: 'diesel',
        odometerKm: odometer.toFixed(1),
        fuelEfficiencyKmpl: kmpl.toFixed(2),
        status,
      })
      .$returningId();

    // Compliance documents with a deliberate spread: mostly valid, some expiring soon, a few
    // expired, one vehicle missing its PUC certificate.
    for (const docType of MANDATORY_VEHICLE_DOCS) {
      if (i === 7 && docType === 'pollution') continue;
      let daysToExpiry = rng.int(60, 330);
      if ((i === 2 && docType === 'insurance') || (i === 9 && docType === 'fitness')) daysToExpiry = rng.int(3, 12);
      if ((i === 5 && docType === 'pollution') || (i === 14 && docType === 'permit')) daysToExpiry = -rng.int(2, 20);
      const expiresOn = docType === 'registration' ? addDays(anchor, 365 * 10 + daysToExpiry) : addDays(anchor, daysToExpiry);
      const validityDays = docType === 'pollution' ? 180 : docType === 'registration' ? 365 * 15 : 365;
      await db.insert(s.vehicleDocuments).values({
        orgId,
        vehicleId: veh!.id,
        docType,
        documentNo: `${docType.slice(0, 3).toUpperCase()}-${plate}-${rng.int(100, 999)}`,
        issuedOn: addDays(expiresOn, -validityDays),
        expiresOn,
      });
      documents++;
    }
  }
  return { vehicles: fixture.fleetSize, documents };
}
