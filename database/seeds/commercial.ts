import { addDays } from '@transaxis/shared';
import type { Db } from '../src/client.js';
import * as s from '../src/schema/index.js';
import type { CustomerFixture, VendorFixture } from './data/parties.js';
import type { RouteFixture } from './data/routes.js';
import { fakeGstin, fakeMobile, fakePan } from './helpers.js';
import type { Rng } from './prng.js';

export interface SeededCustomer {
  id: number;
  fixture: CustomerFixture;
  siteLocationId: number;
  contactName: string;
  contactPhone: string;
}

export interface SeededRoute {
  id: number;
  fixture: RouteFixture;
}

const CONTACT_FIRST = ['Anand', 'Kavya', 'Rohan', 'Divya', 'Harish', 'Nisha', 'Pradeep', 'Swathi', 'Vinod', 'Asha'];
const CONTACT_LAST = ['Iyer', 'Menon', 'Reddy', 'Shetty', 'Pillai', 'Rao', 'Joshi', 'Kulkarni', 'Nair', 'Das'];

/** Rough freight rate: ₹ per tonne-km, scaled for vehicle class and cargo handling. */
const perTonneKm = (cat: CustomerFixture['cargo']['category']) => (cat === 'perishable' ? 6.2 : cat === 'hazardous' ? 5.4 : cat === 'high_value' || cat === 'fragile' ? 4.8 : 4.2);

export async function seedCommercial(
  db: Db,
  rng: Rng,
  opts: {
    orgId: number;
    anchor: string;
    customers: CustomerFixture[];
    vendors: VendorFixture[];
    routes: RouteFixture[];
    depots: { name: string; city: string; state: string; site: [number, number] }[];
    reeferTypeId: number | null;
  },
): Promise<{ customers: SeededCustomer[]; routes: SeededRoute[]; depotIds: Map<string, number>; vendorIds: number[] }> {
  const { orgId, anchor } = opts;

  const routes: SeededRoute[] = [];
  for (const r of opts.routes) {
    const [row] = await db
      .insert(s.routes)
      .values({
        orgId,
        name: r.name,
        originCity: r.origin,
        destinationCity: r.destination,
        distanceKm: r.distanceKm.toFixed(1),
        expectedDurationMin: r.durationMin,
        polyline: r.polyline,
        tollEstimate: r.toll.toFixed(2),
      })
      .$returningId();
    routes.push({ id: row!.id, fixture: r });
  }

  const customers: SeededCustomer[] = [];
  for (const c of opts.customers) {
    const gstin = fakeGstin(c.stateCode, rng);
    const [row] = await db
      .insert(s.customers)
      .values({
        orgId,
        code: c.code,
        name: c.name,
        legalName: `${c.name} Private Limited`,
        gstin,
        pan: fakePan(gstin),
        billingAddress: `${c.siteName}, ${c.city}`,
        city: c.city,
        state: c.state,
        pincode: String(rng.int(500001, 641999)),
        phone: fakeMobile(rng),
        email: `accounts@${c.code.toLowerCase()}.example`,
        paymentTermsDays: c.terms,
        creditLimit: (rng.int(10, 80) * 100_000).toFixed(2),
      })
      .$returningId();
    const contactName = `${rng.pick(CONTACT_FIRST)} ${rng.pick(CONTACT_LAST)}`;
    const contactPhone = fakeMobile(rng);
    await db.insert(s.customerContacts).values([
      { orgId, customerId: row!.id, name: contactName, designation: 'Logistics Manager', phone: contactPhone, email: `logistics@${c.code.toLowerCase()}.example`, isPrimary: true },
      { orgId, customerId: row!.id, name: `${rng.pick(CONTACT_FIRST)} ${rng.pick(CONTACT_LAST)}`, designation: 'Accounts', phone: fakeMobile(rng), email: `accounts@${c.code.toLowerCase()}.example` },
    ]);
    const [loc] = await db
      .insert(s.locations)
      .values({
        orgId,
        customerId: row!.id,
        name: `${c.name}: ${c.siteName}`,
        locationType: 'customer_site',
        addressLine: c.siteName,
        city: c.city,
        state: c.state,
        lat: c.site[0].toFixed(6),
        lng: c.site[1].toFixed(6),
        contactName,
        contactPhone,
      })
      .$returningId();

    // One rate card per lane, valid for the past year and the next.
    for (const lane of c.lanes) {
      const route = routes.find((r) => r.fixture.name === lane);
      if (!route) continue;
      const perishable = c.cargo.category === 'perishable';
      await db.insert(s.customerRateCards).values({
        orgId,
        customerId: row!.id,
        originCity: route.fixture.origin,
        destinationCity: route.fixture.destination,
        vehicleTypeId: perishable ? opts.reeferTypeId : null,
        rateBasis: perishable ? 'per_trip' : 'per_tonne',
        rate: perishable
          ? (Math.round((route.fixture.distanceKm * 75) / 500) * 500).toFixed(2)
          : (Math.round((route.fixture.distanceKm * perTonneKm(c.cargo.category)) / 10) * 10).toFixed(2),
        loadingCharge: '1500.00',
        unloadingCharge: '1200.00',
        detentionFreeHours: 24,
        detentionRatePerHour: '250.00',
        validFrom: addDays(anchor, -365),
        validTo: addDays(anchor, 365),
      });
    }
    customers.push({ id: row!.id, fixture: c, siteLocationId: loc!.id, contactName, contactPhone });
  }

  const depotIds = new Map<string, number>();
  for (const d of opts.depots) {
    const [loc] = await db
      .insert(s.locations)
      .values({ orgId, name: d.name, locationType: 'depot', city: d.city, state: d.state, lat: d.site[0].toFixed(6), lng: d.site[1].toFixed(6) })
      .$returningId();
    depotIds.set(d.city, loc!.id);
  }

  const vendorIds: number[] = [];
  for (const v of opts.vendors) {
    const gstin = fakeGstin(v.stateCode, rng);
    const [row] = await db
      .insert(s.vendors)
      .values({
        orgId,
        code: v.code,
        name: v.name,
        vendorType: v.type,
        gstin,
        pan: fakePan(gstin),
        city: v.city,
        state: v.state,
        address: `${v.city} main road`,
        contactName: v.contact,
        phone: fakeMobile(rng),
        email: `${v.code.toLowerCase().replace('v-', '')}@vendor.example`,
        paymentTermsDays: v.type === 'fuel_station' ? 7 : 30,
      })
      .$returningId();
    vendorIds.push(row!.id);
  }

  return { customers, routes, depotIds, vendorIds };
}
