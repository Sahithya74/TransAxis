import { eq, sql } from 'drizzle-orm';
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
import { seedCommercial } from './commercial.js';
import { KAVERI_CUSTOMERS, KAVERI_DEPOTS, KAVERI_VENDORS, SAHYADRI_CUSTOMERS, SAHYADRI_DEPOTS, SAHYADRI_VENDORS } from './data/parties.js';
import { KAVERI_DRIVERS, KAVERI_HELPERS, SAHYADRI_DRIVERS, SAHYADRI_HELPERS } from './data/people.js';
import { KAVERI_ROUTES, SAHYADRI_ROUTES } from './data/routes.js';
import { DEMO_PASSWORD, KAVERI, PLATFORM_ORG, SAHYADRI, VEHICLE_TYPES, type OrgFixture } from './fixtures.js';
import { istAt } from './helpers.js';
import { seedOperations, type OperationsOptions, type SeededVehicle } from './operations.js';
import { seedLive } from './live.js';
import { seedDocuments } from './documents.js';
import { seedFinance } from './finance.js';
import { seedPeople } from './people.js';
import { createRng, type Rng } from './prng.js';

export interface SeedOptions {
  /** Calendar date (YYYY-MM-DD) that relative demo dates are anchored to. */
  anchorDate: string;
  /** "Now" for live trips; defaults to the current time. */
  now?: Date;
}

export interface SeedSummary {
  organizations: number;
  users: number;
  vehicles: number;
  vehicleDocuments: number;
  workers: number;
  customers: number;
  bookings: number;
  trips: number;
  activeTrips: number;
  gpsEvents: number;
  incidents: number;
  invoices: number;
  journalEntries: number;
  documents: number;
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

/** Live-trip scenarios. Indices refer to the deterministic fleet and worker lists. */
const KAVERI_ACTIVE: OperationsOptions['active'] = [
  { v: 6, d: 0, customer: 'CCW', route: 'Chennai – Bengaluru (NH48)', fill: 0.85, status: 'in_transit', startInHours: -3.25 },
  { v: 12, d: 1, h: [0], customer: 'BAC', route: 'Chennai – Hyderabad (NH16/NH65)', fill: 0.8, status: 'in_transit', startInHours: -9 },
  { v: 20, d: 2, customer: 'NPD', route: 'Chennai – Coimbatore (NH544)', fill: 0.6, status: 'in_transit', startInHours: -5 },
  { v: 18, d: 3, customer: 'CBV', route: 'Chennai – Tiruchirappalli (NH38)', fill: 0.9, status: 'delivered', startInHours: -9, deliveredHoursAgo: 1 },
  { v: 13, d: 4, customer: 'HEL', route: 'Bengaluru – Chennai (NH48)', fill: 0.6, status: 'ready', startInHours: 1 },
  { v: 6, d: 0, customer: 'KGE', route: 'Bengaluru – Chennai (NH48)', fill: 0.7, status: 'planned', after: { plan: 0, gapHours: 12 } },
  { v: 22, d: 5, h: [1], customer: 'DST', route: 'Hyderabad – Chennai (NH65/NH16)', fill: 0.8, status: 'planned', startInHours: 20 },
  {
    v: 15,
    d: 6,
    customer: 'PAF',
    route: 'Chennai – Bengaluru (NH48)',
    fill: 0.7,
    status: 'on_hold',
    startInHours: 44,
    holdReason: 'Customer requested postponement: warehouse closed for stock audit',
  },
];

const SAHYADRI_ACTIVE: OperationsOptions['active'] = [
  { v: 2, d: 0, customer: 'CAP', route: 'Pune – Bhiwandi (Expressway)', fill: 0.75, status: 'in_transit', startInHours: -2 },
  { v: 4, d: 1, customer: 'PPL', route: 'Pune – Nashik (NH60)', fill: 0.5, status: 'planned', startInHours: 22 },
];

export async function seedDatabase(db: Db, opts: SeedOptions): Promise<SeedSummary> {
  const [existing] = await db.select({ n: sql<number>`COUNT(*)` }).from(s.organizations);
  if (Number(existing?.n) > 0) {
    throw new Error('Database already contains data. Re-run with --reset to wipe it first (dev only).');
  }

  const rng = createRng(20261015);
  const now = opts.now ?? new Date();
  const anchor = opts.anchorDate;
  const passwordHash = await hashPassword(DEMO_PASSWORD);
  const summary: SeedSummary = {
    organizations: 0,
    users: 0,
    vehicles: 0,
    vehicleDocuments: 0,
    workers: 0,
    customers: 0,
    bookings: 0,
    trips: 0,
    activeTrips: 0,
    gpsEvents: 0,
    incidents: 0,
    invoices: 0,
    journalEntries: 0,
    documents: 0,
  };

  await db.transaction(async (tx) => {
    const t = tx as unknown as Db;
    // Global permission catalogue.
    await tx.insert(s.permissions).values(ALL_PERMISSIONS.map((key) => ({ key, description: PERMISSIONS[key] })));
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
        { orgId, key: 'dispatch.min_rest_hours', value: 8 },
        { orgId, key: 'dispatch.max_duty_hours', value: 12 },
        { orgId, key: 'demo.is_sample_data', value: true },
      ]);

      // Every org gets the full set of system roles so its admins can reassign people later.
      const roleId = new Map<string, number>();
      for (const key of ROLE_KEYS) {
        if (key === 'super_admin' && fixture !== PLATFORM_ORG) continue;
        const [r] = await tx.insert(s.roles).values({ orgId, key, name: ROLE_LABELS[key], isSystem: true }).$returningId();
        roleId.set(key, r!.id);
        const perms = DEFAULT_ROLE_PERMISSIONS[key].map((p) => ({ roleId: r!.id, permissionId: permId.get(p)! }));
        if (perms.length) await tx.insert(s.rolePermissions).values(perms);
      }

      const userIdByRole = new Map<string, number>();
      for (const u of fixture.users) {
        const [user] = await tx
          .insert(s.users)
          .values({ orgId, email: u.email, passwordHash, fullName: u.fullName, phone: u.phone ?? null })
          .$returningId();
        await tx.insert(s.userRoles).values({ userId: user!.id, roleId: roleId.get(u.role)! });
        userIdByRole.set(u.role, user!.id);
        summary.users++;
      }

      const branchIds: number[] = [];
      for (const b of fixture.branches) {
        const [br] = await tx.insert(s.branches).values({ orgId, ...b }).$returningId();
        branchIds.push(br!.id);
      }

      if (fixture.fleetSize === 0) continue;

      const fleet = await seedFleet(t, rng, orgId, fixture, branchIds, anchor);
      summary.vehicles += fleet.vehicles.length;
      summary.vehicleDocuments += fleet.documents;

      const isKaveri = fixture === KAVERI;
      const people = await seedPeople(t, rng, {
        orgId,
        anchor,
        branchIds,
        drivers: isKaveri ? KAVERI_DRIVERS : SAHYADRI_DRIVERS,
        helpers: isKaveri ? KAVERI_HELPERS : SAHYADRI_HELPERS,
        codePrefix: fixture.code,
        hrUserId: userIdByRole.get('hr_manager') ?? userIdByRole.get('owner') ?? null,
      });
      summary.workers += people.drivers.length + people.helpers.length;

      const reeferType = fleet.vehicles.find((v) => v.bodyType === 'reefer');
      const commercial = await seedCommercial(t, rng, {
        orgId,
        anchor,
        customers: isKaveri ? KAVERI_CUSTOMERS : SAHYADRI_CUSTOMERS,
        vendors: isKaveri ? KAVERI_VENDORS : SAHYADRI_VENDORS,
        routes: isKaveri ? KAVERI_ROUTES : SAHYADRI_ROUTES,
        depots: isKaveri ? KAVERI_DEPOTS : SAHYADRI_DEPOTS,
        reeferTypeId: reeferType?.typeId ?? null,
      });
      summary.customers += commercial.customers.length;

      const ops = await seedOperations(t, rng, {
        orgId,
        now,
        anchor,
        vehicles: fleet.vehicles,
        drivers: people.drivers,
        helpers: people.helpers,
        customers: commercial.customers,
        routes: commercial.routes,
        depotIds: commercial.depotIds,
        dispatcherUserId: userIdByRole.get('dispatcher') ?? null,
        historyCount: isKaveri ? 140 : 25,
        active: isKaveri ? KAVERI_ACTIVE : SAHYADRI_ACTIVE,
        queue: isKaveri
          ? (_now, a) => [
              { customerCode: 'NPD', route: 'Chennai – Coimbatore (NH544)', weightKg: 4200, status: 'approved', loadingAt: istAt(a, 1, 8) },
              { customerCode: 'SCH', route: 'Chennai – Hyderabad (NH16/NH65)', weightKg: 9000, status: 'approved', loadingAt: istAt(a, 2, 7) },
              { customerCode: 'DST', route: 'Hyderabad – Bengaluru (NH44)', weightKg: 20000, status: 'approved', loadingAt: istAt(a, 2, 6) },
              { customerCode: 'CCW', route: 'Chennai – Tiruchirappalli (NH38)', weightKg: 9000, status: 'approved', loadingAt: istAt(a, 1, 10) },
              { customerCode: 'MTX', route: 'Coimbatore – Chennai (NH544)', weightKg: 7000, status: 'quoted', loadingAt: istAt(a, 3, 9) },
              { customerCode: 'GDP', route: 'Hyderabad – Bengaluru (NH44)', weightKg: 12000, status: 'draft', loadingAt: istAt(a, 4, 7) },
              { customerCode: 'CBV', route: 'Chennai – Bengaluru (NH48)', weightKg: 8000, status: 'cancelled', loadingAt: istAt(a, 1, 6), cancelReason: 'Customer arranged its own vehicle' },
            ]
          : (_now, a) => [{ customerCode: 'BLP', route: 'Bhiwandi – Pune (Expressway)', weightKg: 6000, status: 'approved', loadingAt: istAt(a, 1, 9) }],
      });
      summary.bookings += ops.bookings;
      summary.trips += ops.trips;
      summary.activeTrips += ops.activeTrips;

      const live = await seedLive(t, rng, {
        orgId,
        now,
        userIdByRole,
        restrictedZone: isKaveri
          ? { name: 'Chennai Port: permit-only zone', at: [13.0945, 80.2949], radiusM: 1500 }
          : { name: 'Pune Cantonment: no heavy vehicles by day', at: [18.5089, 73.8786], radiusM: 1500 },
      });
      summary.gpsEvents += live.gpsEvents;
      summary.incidents += live.incidents;

      const fin = await seedFinance(t, rng, {
        orgId,
        now,
        tz: 'Asia/Kolkata',
        userIdByRole,
        forwardChargeCustomers: isKaveri ? ['BAC', 'HEL', 'DST'] : ['CAP'],
        tdsCustomers: isKaveri ? ['CCW', 'BAC', 'NPD', 'KGE'] : ['CAP'],
      });
      summary.invoices += fin.invoices;
      summary.journalEntries += fin.journalEntries;

      summary.documents += await seedDocuments(t, { orgId, isKaveri, uploadedBy: userIdByRole.get('owner') ?? null });

      // Link the driver and customer demo logins to their records so row scoping applies.
      const driverUser = userIdByRole.get('driver');
      if (driverUser) await tx.update(s.users).set({ workerId: people.drivers[0]!.id }).where(eq(s.users.id, driverUser));
      const customerUser = userIdByRole.get('customer');
      if (customerUser) {
        const ccw = commercial.customers.find((c) => c.fixture.code === 'CCW');
        if (ccw) await tx.update(s.users).set({ customerId: ccw.id }).where(eq(s.users.id, customerUser));
      }
    }

    await tx.insert(s.auditLogs).values({
      action: 'system.seed',
      summary: `Demo data seeded (anchor ${anchor})`,
      after: summary,
    });
  });

  return summary;
}

/**
 * Fleet types follow a fixed weighted pattern (not random) so live-trip scenarios can rely on
 * specific vehicles: index 20/21 are reefers, 18/19 containers, 22–24 trailers, and so on.
 */
async function seedFleet(
  db: Db,
  rng: Rng,
  orgId: number,
  fixture: OrgFixture,
  branchIds: number[],
  anchor: string,
): Promise<{ vehicles: SeededVehicle[]; documents: number }> {
  const types: { id: number; fixture: (typeof VEHICLE_TYPES)[number] }[] = [];
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
    types.push({ id: row!.id, fixture: t });
  }

  const weights = [2, 4, 6, 5, 3, 2, 3];
  const pattern = types.flatMap((t, i) => Array(weights[i] ?? 1).fill(t) as typeof types);
  const stride = fixture.fleetSize >= pattern.length ? 1 : 4;
  const usedPlates = new Set<string>();
  const vehicles: SeededVehicle[] = [];
  let documents = 0;

  for (let i = 0; i < fixture.fleetSize; i++) {
    const type = pattern[(i * stride) % pattern.length]!;
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

    vehicles.push({
      id: veh!.id,
      index: i,
      registrationNo: plate,
      typeId: type.id,
      typeName: type.fixture.name,
      bodyType: type.fixture.bodyType,
      requiredLicenceClass: type.fixture.requiredLicenceClass,
      payloadKg: payload,
      odometerKm: odometer,
      status,
    });
  }
  return { vehicles, documents };
}
