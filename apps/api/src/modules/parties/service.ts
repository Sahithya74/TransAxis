import type { Request } from 'express';
import { and, asc, desc, eq, gte, inArray, isNull, like, lte, or, sql, type SQL } from 'drizzle-orm';
import type { z } from 'zod';
import {
  bookings,
  customerContacts,
  customerRateCards,
  customers,
  isDuplicateKeyError,
  locations,
  routes,
  vehicleTypes,
  vendors,
  type Db,
} from '@transaxis/database';
import {
  computeQuote,
  type ContactDto,
  type CustomerDto,
  type LocationDto,
  type Paginated,
  type QuoteDto,
  type RateCardDto,
  type RouteDto,
  type VendorDto,
} from '@transaxis/shared';
import type {
  contactInputSchema,
  customerCreateSchema,
  customerListQuerySchema,
  customerUpdateSchema,
  locationInputSchema,
  locationListQuerySchema,
  quoteRequestSchema,
  rateCardInputSchema,
  routeInputSchema,
  vendorCreateSchema,
  vendorListQuerySchema,
  vendorUpdateSchema,
} from '@transaxis/shared';
import { audit, changedFields } from '../../lib/audit.js';
import type { RequestContext } from '../../lib/context.js';
import { AppError } from '../../lib/errors.js';
import { escapeLike, paginated, parseSort, toNumber } from '../../lib/http.js';
import { getOrgInfo, orgToday } from '../../lib/org.js';

const OPEN_BOOKING = ['draft', 'quoted', 'approved', 'planned', 'in_transit', 'on_hold'] as const;
const dec = (n: number | null | undefined, scale: number) => (n === null || n === undefined ? n : n.toFixed(scale));

export class PartyService {
  constructor(private readonly db: Db) {}

  // ------------------------------------------------------------------ customers

  async listCustomers(ctx: RequestContext, q: z.infer<typeof customerListQuerySchema>): Promise<Paginated<CustomerDto>> {
    const conds: SQL[] = [eq(customers.orgId, ctx.orgId)];
    if (q.status) conds.push(eq(customers.status, q.status));
    if (q.q) {
      const t = `%${escapeLike(q.q)}%`;
      conds.push(or(like(customers.name, t), like(customers.code, t), like(customers.gstin, t), like(customers.city, t))!);
    }
    const where = and(...conds);
    const cols = { name: customers.name, code: customers.code, createdAt: customers.createdAt } as const;
    const sort = parseSort<keyof typeof cols>(q.sort, 'name');
    const [count] = await this.db.select({ n: sql<number>`COUNT(*)` }).from(customers).where(where);
    const rows = await this.db
      .select()
      .from(customers)
      .where(where)
      .orderBy(sort.desc ? desc(cols[sort.field]) : asc(cols[sort.field]))
      .limit(q.pageSize)
      .offset((q.page - 1) * q.pageSize);
    const open = await this.openBookingCounts(rows.map((r) => r.id));
    return paginated(rows.map((r) => toCustomerDto(r, open.get(r.id) ?? 0)), q.page, q.pageSize, Number(count?.n ?? 0));
  }

  async getCustomer(ctx: RequestContext, id: number): Promise<CustomerDto & { contacts: ContactDto[]; rateCards: RateCardDto[]; locations: LocationDto[] }> {
    const c = await this.customerRow(ctx, id);
    const open = await this.openBookingCounts([id]);
    const contacts = await this.db.select().from(customerContacts).where(eq(customerContacts.customerId, id)).orderBy(desc(customerContacts.isPrimary), asc(customerContacts.name));
    return {
      ...toCustomerDto(c, open.get(id) ?? 0),
      contacts: contacts.map((x) => ({ id: x.id, name: x.name, designation: x.designation, phone: x.phone, email: x.email, isPrimary: x.isPrimary })),
      rateCards: await this.rateCards(ctx, id),
      locations: await this.listLocations(ctx, { customerId: id }),
    };
  }

  async createCustomer(ctx: RequestContext, input: z.infer<typeof customerCreateSchema>, req: Request): Promise<CustomerDto> {
    try {
      const [row] = await this.db
        .insert(customers)
        .values({ ...this.customerColumns(input), orgId: ctx.orgId, code: input.code, name: input.name, paymentTermsDays: input.paymentTermsDays, status: input.status })
        .$returningId();
      await audit(this.db, req, { action: 'customer.created', entityType: 'customer', entityId: row!.id, summary: input.name, after: input });
      return this.getCustomer(ctx, row!.id);
    } catch (err) {
      if (isDuplicateKeyError(err)) throw AppError.conflict(`Customer code ${input.code} is already in use`, [{ path: 'code', message: 'Already in use' }]);
      throw err;
    }
  }

  async updateCustomer(ctx: RequestContext, id: number, input: z.infer<typeof customerUpdateSchema>, req: Request): Promise<CustomerDto> {
    const existing = await this.customerRow(ctx, id);
    const patch = this.customerColumns(input);
    const diff = changedFields(existing, patch);
    if (diff) {
      try {
        await this.db.update(customers).set(patch).where(and(eq(customers.id, id), eq(customers.orgId, ctx.orgId)));
      } catch (err) {
        if (isDuplicateKeyError(err)) throw AppError.conflict(`Customer code ${input.code} is already in use`);
        throw err;
      }
      await audit(this.db, req, { action: 'customer.updated', entityType: 'customer', entityId: id, summary: existing.name, ...diff });
    }
    return this.getCustomer(ctx, id);
  }

  async addContact(ctx: RequestContext, customerId: number, input: z.infer<typeof contactInputSchema>, req: Request): Promise<void> {
    await this.customerRow(ctx, customerId);
    await this.db.transaction(async (tx) => {
      if (input.isPrimary) await tx.update(customerContacts).set({ isPrimary: false }).where(eq(customerContacts.customerId, customerId));
      await tx.insert(customerContacts).values({
        orgId: ctx.orgId,
        customerId,
        name: input.name,
        designation: input.designation ?? null,
        phone: input.phone ?? null,
        email: input.email ?? null,
        isPrimary: input.isPrimary,
      });
      await audit(tx, req, { action: 'customer.contact_added', entityType: 'customer', entityId: customerId, summary: input.name });
    });
  }

  // ------------------------------------------------------------------ rate cards and quotes

  async rateCards(ctx: RequestContext, customerId: number): Promise<RateCardDto[]> {
    await this.customerRow(ctx, customerId);
    const rows = await this.db
      .select({ r: customerRateCards, t: { id: vehicleTypes.id, name: vehicleTypes.name } })
      .from(customerRateCards)
      .leftJoin(vehicleTypes, eq(vehicleTypes.id, customerRateCards.vehicleTypeId))
      .where(and(eq(customerRateCards.customerId, customerId), eq(customerRateCards.orgId, ctx.orgId)))
      .orderBy(asc(customerRateCards.originCity), asc(customerRateCards.destinationCity), desc(customerRateCards.validFrom));
    return rows.map(({ r, t }) => toRateCardDto(r, t?.id ? t : null));
  }

  async addRateCard(ctx: RequestContext, customerId: number, input: z.infer<typeof rateCardInputSchema>, req: Request): Promise<void> {
    await this.customerRow(ctx, customerId);
    if (input.vehicleTypeId) {
      const [t] = await this.db.select({ id: vehicleTypes.id }).from(vehicleTypes).where(and(eq(vehicleTypes.id, input.vehicleTypeId), eq(vehicleTypes.orgId, ctx.orgId)));
      if (!t) throw AppError.validation('Unknown vehicle type', [{ path: 'vehicleTypeId', message: 'Not found' }]);
    }
    const [row] = await this.db
      .insert(customerRateCards)
      .values({
        orgId: ctx.orgId,
        customerId,
        originCity: input.originCity,
        destinationCity: input.destinationCity,
        vehicleTypeId: input.vehicleTypeId ?? null,
        rateBasis: input.rateBasis,
        rate: input.rate.toFixed(2),
        loadingCharge: input.loadingCharge.toFixed(2),
        unloadingCharge: input.unloadingCharge.toFixed(2),
        detentionFreeHours: input.detentionFreeHours,
        detentionRatePerHour: input.detentionRatePerHour.toFixed(2),
        validFrom: input.validFrom,
        validTo: input.validTo ?? null,
        notes: input.notes ?? null,
      })
      .$returningId();
    await audit(this.db, req, { action: 'rate_card.created', entityType: 'customer', entityId: customerId, summary: `${input.originCity} → ${input.destinationCity}`, after: { rateCardId: row!.id, ...input } });
  }

  /**
   * Finds the active rate card for a lane (a card for the exact vehicle type wins over a generic one;
   * the most recent validFrom wins among equals) and prices it with the shared, explainable formula.
   */
  async quote(ctx: RequestContext, q: z.infer<typeof quoteRequestSchema>): Promise<QuoteDto> {
    await this.customerRow(ctx, q.customerId);
    const org = await getOrgInfo(this.db, ctx.orgId);
    const on = q.onDate ?? orgToday(org);
    const rows = await this.db
      .select({ r: customerRateCards, t: { id: vehicleTypes.id, name: vehicleTypes.name } })
      .from(customerRateCards)
      .leftJoin(vehicleTypes, eq(vehicleTypes.id, customerRateCards.vehicleTypeId))
      .where(
        and(
          eq(customerRateCards.orgId, ctx.orgId),
          eq(customerRateCards.customerId, q.customerId),
          eq(customerRateCards.originCity, q.originCity),
          eq(customerRateCards.destinationCity, q.destinationCity),
          lte(customerRateCards.validFrom, on),
          or(isNull(customerRateCards.validTo), gte(customerRateCards.validTo, on)),
          q.vehicleTypeId ? or(isNull(customerRateCards.vehicleTypeId), eq(customerRateCards.vehicleTypeId, q.vehicleTypeId)) : isNull(customerRateCards.vehicleTypeId),
        ),
      )
      .orderBy(desc(sql`${customerRateCards.vehicleTypeId} IS NOT NULL`), desc(customerRateCards.validFrom))
      .limit(1);
    const match = rows[0];
    if (!match) {
      return { rateCard: null, quote: null, message: `No active rate card for ${q.originCity} → ${q.destinationCity} on ${on}. Price this booking manually.` };
    }
    let distance = q.distanceKm ?? null;
    if (match.r.rateBasis === 'per_km' && distance === null) {
      const [route] = await this.db
        .select({ d: routes.distanceKm })
        .from(routes)
        .where(and(eq(routes.orgId, ctx.orgId), eq(routes.originCity, q.originCity), eq(routes.destinationCity, q.destinationCity), eq(routes.isActive, true)))
        .limit(1);
      distance = route ? Number(route.d) : null;
      if (distance === null) return { rateCard: toRateCardDto(match.r, match.t?.id ? match.t : null), quote: null, message: 'This lane is priced per km but no route distance is known. Enter the distance.' };
    }
    const extras = [
      ...(Number(match.r.loadingCharge) > 0 ? [{ label: 'Loading', amount: match.r.loadingCharge }] : []),
      ...(Number(match.r.unloadingCharge) > 0 ? [{ label: 'Unloading', amount: match.r.unloadingCharge }] : []),
    ];
    const quote = computeQuote({ rateBasis: match.r.rateBasis, rate: match.r.rate, totalWeightKg: q.totalWeightKg, distanceKm: distance, extraCharges: extras });
    return { rateCard: toRateCardDto(match.r, match.t?.id ? match.t : null), quote, message: `Priced from the rate card valid from ${match.r.validFrom}.` };
  }

  // ------------------------------------------------------------------ vendors

  async listVendors(ctx: RequestContext, q: z.infer<typeof vendorListQuerySchema>): Promise<Paginated<VendorDto>> {
    const conds: SQL[] = [eq(vendors.orgId, ctx.orgId)];
    if (q.vendorType) conds.push(eq(vendors.vendorType, q.vendorType));
    if (q.status) conds.push(eq(vendors.status, q.status));
    if (q.q) {
      const t = `%${escapeLike(q.q)}%`;
      conds.push(or(like(vendors.name, t), like(vendors.code, t), like(vendors.city, t))!);
    }
    const where = and(...conds);
    const cols = { name: vendors.name, code: vendors.code, vendorType: vendors.vendorType } as const;
    const sort = parseSort<keyof typeof cols>(q.sort, 'name');
    const [count] = await this.db.select({ n: sql<number>`COUNT(*)` }).from(vendors).where(where);
    const rows = await this.db
      .select()
      .from(vendors)
      .where(where)
      .orderBy(sort.desc ? desc(cols[sort.field]) : asc(cols[sort.field]))
      .limit(q.pageSize)
      .offset((q.page - 1) * q.pageSize);
    return paginated(rows.map(toVendorDto), q.page, q.pageSize, Number(count?.n ?? 0));
  }

  async getVendor(ctx: RequestContext, id: number): Promise<VendorDto> {
    return toVendorDto(await this.vendorRow(ctx, id));
  }

  async createVendor(ctx: RequestContext, input: z.infer<typeof vendorCreateSchema>, req: Request): Promise<VendorDto> {
    try {
      const [row] = await this.db
        .insert(vendors)
        .values({ ...this.vendorColumns(input), orgId: ctx.orgId, code: input.code, name: input.name, vendorType: input.vendorType, paymentTermsDays: input.paymentTermsDays, status: input.status })
        .$returningId();
      await audit(this.db, req, { action: 'vendor.created', entityType: 'vendor', entityId: row!.id, summary: input.name, after: input });
      return this.getVendor(ctx, row!.id);
    } catch (err) {
      if (isDuplicateKeyError(err)) throw AppError.conflict(`Vendor code ${input.code} is already in use`, [{ path: 'code', message: 'Already in use' }]);
      throw err;
    }
  }

  async updateVendor(ctx: RequestContext, id: number, input: z.infer<typeof vendorUpdateSchema>, req: Request): Promise<VendorDto> {
    const existing = await this.vendorRow(ctx, id);
    const patch = this.vendorColumns(input);
    const diff = changedFields(existing, patch);
    if (diff) {
      try {
        await this.db.update(vendors).set(patch).where(and(eq(vendors.id, id), eq(vendors.orgId, ctx.orgId)));
      } catch (err) {
        if (isDuplicateKeyError(err)) throw AppError.conflict(`Vendor code ${input.code} is already in use`);
        throw err;
      }
      await audit(this.db, req, { action: 'vendor.updated', entityType: 'vendor', entityId: id, summary: existing.name, ...diff });
    }
    return this.getVendor(ctx, id);
  }

  // ------------------------------------------------------------------ locations and routes

  async listLocations(ctx: RequestContext, q: z.infer<typeof locationListQuerySchema>): Promise<LocationDto[]> {
    const conds: SQL[] = [eq(locations.orgId, ctx.orgId), eq(locations.isActive, true)];
    if (q.customerId) conds.push(eq(locations.customerId, q.customerId));
    if (q.city) conds.push(eq(locations.city, q.city));
    if (q.q) {
      const t = `%${escapeLike(q.q)}%`;
      conds.push(or(like(locations.name, t), like(locations.city, t))!);
    }
    const rows = await this.db
      .select({ l: locations, c: { id: customers.id, name: customers.name } })
      .from(locations)
      .leftJoin(customers, eq(customers.id, locations.customerId))
      .where(and(...conds))
      .orderBy(asc(locations.city), asc(locations.name))
      .limit(500);
    return rows.map(({ l, c }) => ({
      id: l.id,
      name: l.name,
      locationType: l.locationType,
      customer: c?.id ? c : null,
      addressLine: l.addressLine,
      city: l.city,
      state: l.state,
      pincode: l.pincode,
      lat: toNumber(l.lat),
      lng: toNumber(l.lng),
      contactName: l.contactName,
      contactPhone: l.contactPhone,
      isActive: l.isActive,
    }));
  }

  async createLocation(ctx: RequestContext, input: z.infer<typeof locationInputSchema>, req: Request): Promise<void> {
    if (input.customerId) await this.customerRow(ctx, input.customerId);
    const [row] = await this.db
      .insert(locations)
      .values({
        orgId: ctx.orgId,
        customerId: input.customerId ?? null,
        name: input.name,
        locationType: input.locationType,
        addressLine: input.addressLine ?? null,
        city: input.city,
        state: input.state ?? null,
        pincode: input.pincode ?? null,
        lat: dec(input.lat, 6) ?? null,
        lng: dec(input.lng, 6) ?? null,
        contactName: input.contactName ?? null,
        contactPhone: input.contactPhone ?? null,
        isActive: input.isActive,
      })
      .$returningId();
    await audit(this.db, req, { action: 'location.created', entityType: 'location', entityId: row!.id, summary: input.name });
  }

  async listRoutes(ctx: RequestContext): Promise<RouteDto[]> {
    const rows = await this.db.select().from(routes).where(eq(routes.orgId, ctx.orgId)).orderBy(asc(routes.name));
    return rows.map(toRouteDto);
  }

  async createRoute(ctx: RequestContext, input: z.infer<typeof routeInputSchema>, req: Request): Promise<RouteDto> {
    try {
      const [row] = await this.db
        .insert(routes)
        .values({
          orgId: ctx.orgId,
          name: input.name,
          originCity: input.originCity,
          destinationCity: input.destinationCity,
          distanceKm: input.distanceKm.toFixed(1),
          expectedDurationMin: input.expectedDurationMin,
          polyline: input.polyline,
          tollEstimate: dec(input.tollEstimate, 2) ?? null,
          isActive: input.isActive,
        })
        .$returningId();
      await audit(this.db, req, { action: 'route.created', entityType: 'route', entityId: row!.id, summary: input.name });
      const [r] = await this.db.select().from(routes).where(eq(routes.id, row!.id));
      return toRouteDto(r!);
    } catch (err) {
      if (isDuplicateKeyError(err)) throw AppError.conflict(`A route named "${input.name}" already exists`);
      throw err;
    }
  }

  // ------------------------------------------------------------------ helpers

  private async customerRow(ctx: RequestContext, id: number) {
    const [c] = await this.db.select().from(customers).where(and(eq(customers.id, id), eq(customers.orgId, ctx.orgId))).limit(1);
    if (!c) throw AppError.notFound('Customer');
    return c;
  }

  private async vendorRow(ctx: RequestContext, id: number) {
    const [v] = await this.db.select().from(vendors).where(and(eq(vendors.id, id), eq(vendors.orgId, ctx.orgId))).limit(1);
    if (!v) throw AppError.notFound('Vendor');
    return v;
  }

  private async openBookingCounts(ids: number[]) {
    const map = new Map<number, number>();
    if (!ids.length) return map;
    const rows = await this.db
      .select({ id: bookings.customerId, n: sql<number>`COUNT(*)` })
      .from(bookings)
      .where(and(inArray(bookings.customerId, ids), inArray(bookings.status, [...OPEN_BOOKING])))
      .groupBy(bookings.customerId);
    for (const r of rows) map.set(r.id, Number(r.n));
    return map;
  }

  private customerColumns(i: Partial<z.infer<typeof customerCreateSchema>>) {
    return {
      code: i.code,
      name: i.name,
      legalName: i.legalName,
      gstin: i.gstin,
      pan: i.pan,
      billingAddress: i.billingAddress,
      city: i.city,
      state: i.state,
      pincode: i.pincode,
      phone: i.phone,
      email: i.email,
      paymentTermsDays: i.paymentTermsDays,
      creditLimit: i.creditLimit === undefined ? undefined : (dec(i.creditLimit, 2) ?? null),
      status: i.status,
      notes: i.notes,
    };
  }

  private vendorColumns(i: Partial<z.infer<typeof vendorCreateSchema>>) {
    return {
      code: i.code,
      name: i.name,
      vendorType: i.vendorType,
      gstin: i.gstin,
      pan: i.pan,
      address: i.address,
      city: i.city,
      state: i.state,
      contactName: i.contactName,
      phone: i.phone,
      email: i.email,
      paymentTermsDays: i.paymentTermsDays,
      status: i.status,
      notes: i.notes,
    };
  }
}

function toCustomerDto(r: typeof customers.$inferSelect, openBookings: number): CustomerDto {
  return {
    id: r.id,
    code: r.code,
    name: r.name,
    legalName: r.legalName,
    gstin: r.gstin,
    pan: r.pan,
    billingAddress: r.billingAddress,
    city: r.city,
    state: r.state,
    pincode: r.pincode,
    phone: r.phone,
    email: r.email,
    paymentTermsDays: r.paymentTermsDays,
    creditLimit: r.creditLimit,
    status: r.status,
    notes: r.notes,
    openBookings,
    createdAt: r.createdAt.toISOString(),
  };
}

function toVendorDto(r: typeof vendors.$inferSelect): VendorDto {
  return {
    id: r.id,
    code: r.code,
    name: r.name,
    vendorType: r.vendorType,
    gstin: r.gstin,
    pan: r.pan,
    address: r.address,
    city: r.city,
    state: r.state,
    contactName: r.contactName,
    phone: r.phone,
    email: r.email,
    paymentTermsDays: r.paymentTermsDays,
    status: r.status,
    notes: r.notes,
  };
}

function toRateCardDto(r: typeof customerRateCards.$inferSelect, t: { id: number; name: string } | null): RateCardDto {
  return {
    id: r.id,
    customerId: r.customerId,
    originCity: r.originCity,
    destinationCity: r.destinationCity,
    vehicleType: t,
    rateBasis: r.rateBasis,
    rate: r.rate,
    loadingCharge: r.loadingCharge,
    unloadingCharge: r.unloadingCharge,
    detentionFreeHours: r.detentionFreeHours,
    detentionRatePerHour: r.detentionRatePerHour,
    validFrom: r.validFrom,
    validTo: r.validTo,
    notes: r.notes,
  };
}

export function toRouteDto(r: typeof routes.$inferSelect): RouteDto {
  return {
    id: r.id,
    name: r.name,
    originCity: r.originCity,
    destinationCity: r.destinationCity,
    distanceKm: Number(r.distanceKm),
    expectedDurationMin: r.expectedDurationMin,
    polyline: r.polyline,
    tollEstimate: r.tollEstimate,
    isActive: r.isActive,
  };
}
