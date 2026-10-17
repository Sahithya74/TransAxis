import { and, desc, eq, inArray, like, ne, or } from 'drizzle-orm';
import { bookings, customers, documents, invoices, trips, vehicles, workers, type Db } from '@transaxis/database';
import { readableClassifications, type SearchResultDto } from '@transaxis/shared';
import type { RequestContext } from '../../lib/context.js';
import { escapeLike } from '../../lib/http.js';

const PER_TYPE = 5;

/**
 * One box that finds vehicles, people, customers, bookings, trips, invoices and documents. Each kind is
 * searched only when the person may read it, and always within their organisation.
 */
export class SearchService {
  constructor(private readonly db: Db) {}

  async search(ctx: RequestContext, raw: string): Promise<SearchResultDto[]> {
    const q = raw.trim();
    if (q.length < 2) return [];
    const has = (p: Parameters<typeof ctx.permissions.has>[0]) => ctx.permissions.has(p);
    const t = `%${escapeLike(q)}%`;
    // Registration numbers are typed with or without spaces and dashes ("TN 01 AB 1234").
    const plate = `%${escapeLike(q.replace(/[\s-]/g, '').toUpperCase())}%`;
    const org = ctx.orgId;
    const jobs: Promise<SearchResultDto[]>[] = [];

    if (has('vehicles:read')) {
      jobs.push(
        this.db
          .select({ id: vehicles.id, reg: vehicles.registrationNo, make: vehicles.make, model: vehicles.model, status: vehicles.status })
          .from(vehicles)
          .where(and(eq(vehicles.orgId, org), or(like(vehicles.registrationNo, plate), like(vehicles.make, t), like(vehicles.model, t))))
          .limit(PER_TYPE)
          .then((rows) =>
            rows.map((v) => ({ type: 'vehicle', id: v.id, title: v.reg, subtitle: [v.make, v.model].filter(Boolean).join(' ') || v.status.replace(/_/g, ' '), link: `/vehicles/${v.id}` }) as const),
          ),
      );
    }
    if (has('workers:read')) {
      jobs.push(
        this.db
          .select({ id: workers.id, name: workers.fullName, code: workers.employeeCode, type: workers.workerType })
          .from(workers)
          .where(and(eq(workers.orgId, org), or(like(workers.fullName, t), like(workers.employeeCode, t), like(workers.phone, t))))
          .limit(PER_TYPE)
          .then((rows) => rows.map((w) => ({ type: 'worker', id: w.id, title: w.name, subtitle: `${w.code} · ${w.type}`, link: `/workers/${w.id}` }) as const)),
      );
    }
    if (has('customers:read')) {
      jobs.push(
        this.db
          .select({ id: customers.id, name: customers.name, code: customers.code, city: customers.city })
          .from(customers)
          .where(and(eq(customers.orgId, org), or(like(customers.name, t), like(customers.code, t), like(customers.gstin, t))))
          .limit(PER_TYPE)
          .then((rows) => rows.map((c) => ({ type: 'customer', id: c.id, title: c.name, subtitle: [c.code, c.city].filter(Boolean).join(' · '), link: `/parties/customers/${c.id}` }) as const)),
      );
    }
    if (has('bookings:read')) {
      jobs.push(
        this.db
          .select({ id: bookings.id, no: bookings.bookingNo, status: bookings.status, customer: customers.name })
          .from(bookings)
          .innerJoin(customers, eq(customers.id, bookings.customerId))
          .where(and(eq(bookings.orgId, org), or(like(bookings.bookingNo, t), like(bookings.customerRef, t))))
          .orderBy(desc(bookings.id))
          .limit(PER_TYPE)
          .then((rows) => rows.map((b) => ({ type: 'booking', id: b.id, title: b.no, subtitle: `${b.customer} · ${b.status.replace(/_/g, ' ')}`, link: `/bookings/${b.id}` }) as const)),
      );
    }
    if (has('trips:read')) {
      jobs.push(
        this.db
          .select({ id: trips.id, no: trips.tripNo, status: trips.status, reg: vehicles.registrationNo })
          .from(trips)
          .leftJoin(vehicles, eq(vehicles.id, trips.vehicleId))
          .where(and(eq(trips.orgId, org), like(trips.tripNo, t)))
          .orderBy(desc(trips.id))
          .limit(PER_TYPE)
          .then((rows) => rows.map((r) => ({ type: 'trip', id: r.id, title: r.no, subtitle: [r.reg, r.status.replace(/_/g, ' ')].filter(Boolean).join(' · '), link: `/trips/${r.id}` }) as const)),
      );
    }
    if (has('finance:read')) {
      jobs.push(
        this.db
          .select({ id: invoices.id, no: invoices.invoiceNo, status: invoices.status, customer: customers.name })
          .from(invoices)
          .innerJoin(customers, eq(customers.id, invoices.customerId))
          .where(and(eq(invoices.orgId, org), like(invoices.invoiceNo, t)))
          .orderBy(desc(invoices.id))
          .limit(PER_TYPE)
          .then((rows) => rows.map((i) => ({ type: 'invoice', id: i.id, title: i.no, subtitle: `${i.customer} · ${i.status.replace(/_/g, ' ')}`, link: `/invoices/${i.id}` }) as const)),
      );
    }
    const classes = readableClassifications(has);
    if (classes.length) {
      jobs.push(
        this.db
          .select({ id: documents.id, title: documents.title, name: documents.originalName, type: documents.docType })
          .from(documents)
          .where(
            and(
              eq(documents.orgId, org),
              inArray(documents.classification, classes),
              ne(documents.status, 'superseded'),
              or(like(documents.title, t), like(documents.originalName, t)),
            ),
          )
          .orderBy(desc(documents.id))
          .limit(PER_TYPE)
          .then((rows) => rows.map((d) => ({ type: 'document', id: d.id, title: d.title, subtitle: d.name, link: `/documents?view=${d.id}` }) as const)),
      );
    }

    const groups = await Promise.all(jobs);
    // Exact matches on a number or plate first, then the rest in their group order.
    const exact = (r: SearchResultDto) => r.title.replace(/[\s-]/g, '').toLowerCase() === q.replace(/[\s-]/g, '').toLowerCase();
    return groups.flat().sort((a, b) => Number(exact(b)) - Number(exact(a)));
  }
}
