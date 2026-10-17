import type { Request } from 'express';
import { and, asc, eq, inArray } from 'drizzle-orm';
import type { ZodType } from 'zod';
import { branches, customers, organizations, vehicles, vehicleTypes, workers, type Db } from '@transaxis/database';
import {
  customerCreateSchema,
  MAX_IMPORT_ROWS,
  normaliseRegistration,
  vehicleCreateSchema,
  workerCreateSchema,
  type ExchangeEntity,
  type ImportResultDto,
  type ImportRowResult,
  type Permission,
} from '@transaxis/shared';
import { audit } from '../../lib/audit.js';
import type { RequestContext } from '../../lib/context.js';
import { CsvParseError, parseCsv, toCsvText, unguardCell } from '../../lib/csv.js';
import { AppError } from '../../lib/errors.js';
import { getOrgInfo, orgToday } from '../../lib/org.js';
import type { PartyService } from '../parties/service.js';
import type { VehicleService } from '../vehicles/service.js';
import type { WorkerService } from '../workers/service.js';

/** How one CSV column maps to a field of the record. */
interface Column {
  header: string;
  /** Field in the create schema; resolved references use the id field (vehicleTypeId, branchId). */
  field: string;
  example: string;
  required?: boolean;
  /** Personal or pay details: exported and imported only with `workers:sensitive`. */
  sensitive?: boolean;
  /** Written on export but ignored on import (it's set by the system). */
  exportOnly?: boolean;
  kind?: 'enum' | 'date' | 'branch' | 'vehicleType';
}

type Row = Record<string, unknown>;

interface EntityDef {
  read: Permission;
  write: Permission;
  /** The column that identifies a record; existing keys are skipped on import. */
  key: string;
  normaliseKey: (s: string) => string;
  columns: Column[];
  schema: ZodType;
}

const DEFS: Record<ExchangeEntity, EntityDef> = {
  vehicles: {
    read: 'vehicles:read',
    write: 'vehicles:write',
    key: 'registration_no',
    normaliseKey: normaliseRegistration,
    schema: vehicleCreateSchema,
    columns: [
      { header: 'registration_no', field: 'registrationNo', example: 'TN01AB1234', required: true },
      { header: 'vehicle_type', field: 'vehicleTypeId', example: '(a vehicle type name)', required: true, kind: 'vehicleType' },
      { header: 'branch', field: 'branchId', example: '', kind: 'branch' },
      { header: 'make', field: 'make', example: 'Tata' },
      { header: 'model', field: 'model', example: 'Signa 4825.TK' },
      { header: 'year', field: 'year', example: '2022' },
      { header: 'ownership', field: 'ownership', example: 'owned', kind: 'enum' },
      { header: 'payload_capacity_kg', field: 'payloadCapacityKg', example: '25000', required: true },
      { header: 'volume_capacity_cbm', field: 'volumeCapacityCbm', example: '' },
      { header: 'fuel_type', field: 'fuelType', example: 'diesel', kind: 'enum' },
      { header: 'odometer_km', field: 'odometerKm', example: '120500' },
      { header: 'fuel_efficiency_kmpl', field: 'fuelEfficiencyKmpl', example: '3.8' },
      { header: 'notes', field: 'notes', example: '' },
      { header: 'status', field: 'status', example: '', exportOnly: true },
    ],
  },
  workers: {
    read: 'workers:read',
    write: 'workers:write',
    key: 'employee_code',
    normaliseKey: (s) => s.trim().toUpperCase(),
    schema: workerCreateSchema,
    columns: [
      { header: 'employee_code', field: 'employeeCode', example: 'DRV-101', required: true },
      { header: 'worker_type', field: 'workerType', example: 'driver', required: true, kind: 'enum' },
      { header: 'full_name', field: 'fullName', example: 'Selvam Kumar', required: true },
      { header: 'phone', field: 'phone', example: '+91 98400 12345', required: true },
      { header: 'alt_phone', field: 'altPhone', example: '' },
      { header: 'branch', field: 'branchId', example: '', kind: 'branch' },
      { header: 'employment_status', field: 'employmentStatus', example: 'active', kind: 'enum' },
      { header: 'joined_on', field: 'joinedOn', example: '2024-04-01', kind: 'date' },
      { header: 'left_on', field: 'leftOn', example: '', kind: 'date' },
      { header: 'medical_valid_until', field: 'medicalValidUntil', example: '', kind: 'date' },
      { header: 'notes', field: 'notes', example: '' },
      { header: 'date_of_birth', field: 'dateOfBirth', example: '1988-06-15', kind: 'date', sensitive: true },
      { header: 'address', field: 'address', example: '', sensitive: true },
      { header: 'blood_group', field: 'bloodGroup', example: 'O+', sensitive: true },
      { header: 'emergency_contact_name', field: 'emergencyContactName', example: '', sensitive: true },
      { header: 'emergency_contact_phone', field: 'emergencyContactPhone', example: '', sensitive: true },
      { header: 'emergency_contact_relation', field: 'emergencyContactRelation', example: '', sensitive: true },
      { header: 'base_monthly_salary', field: 'baseMonthlySalary', example: '24000', sensitive: true },
    ],
  },
  customers: {
    read: 'customers:read',
    write: 'customers:write',
    key: 'code',
    normaliseKey: (s) => s.trim().toUpperCase(),
    schema: customerCreateSchema,
    columns: [
      { header: 'code', field: 'code', example: 'CUST-101', required: true },
      { header: 'name', field: 'name', example: 'Example Industries', required: true },
      { header: 'legal_name', field: 'legalName', example: 'Example Industries Pvt Ltd' },
      { header: 'gstin', field: 'gstin', example: '33AAACE1234F1Z5' },
      { header: 'pan', field: 'pan', example: '' },
      { header: 'billing_address', field: 'billingAddress', example: '' },
      { header: 'city', field: 'city', example: 'Chennai' },
      { header: 'state', field: 'state', example: 'Tamil Nadu' },
      { header: 'pincode', field: 'pincode', example: '600001' },
      { header: 'phone', field: 'phone', example: '' },
      { header: 'email', field: 'email', example: 'accounts@example.in' },
      { header: 'payment_terms_days', field: 'paymentTermsDays', example: '30' },
      { header: 'credit_limit', field: 'creditLimit', example: '500000' },
      { header: 'status', field: 'status', example: 'active', kind: 'enum' },
      { header: 'notes', field: 'notes', example: '' },
    ],
  },
};

/** Headers are matched loosely: "Registration No", "registration-no" and "registration_no" are the same. */
const headerKey = (h: string) => h.trim().toLowerCase().replace(/[\s-]+/g, '_');

/** Accepts YYYY-MM-DD, and DD/MM/YYYY or DD-MM-YYYY as spreadsheets in India usually write dates. */
function normaliseDate(v: string): string {
  const m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(v);
  return m ? `${m[3]}-${m[2]!.padStart(2, '0')}-${m[1]!.padStart(2, '0')}` : v;
}

const lookup = (rows: { id: number; name: string }[]) => new Map(rows.map((r) => [r.name.trim().toLowerCase(), r.id]));

export interface ExchangeServices {
  vehicles: VehicleService;
  workers: WorkerService;
  parties: PartyService;
}

/** CSV export and two-step import (check, then create) for vehicles, workers and customers. */
export class ExchangeService {
  constructor(
    private readonly db: Db,
    private readonly services: ExchangeServices,
  ) {}

  definition(entity: ExchangeEntity) {
    return DEFS[entity];
  }

  private columnsFor(ctx: RequestContext, entity: ExchangeEntity, purpose: 'export' | 'import') {
    const sensitive = ctx.permissions.has('workers:sensitive');
    return DEFS[entity].columns.filter((c) => (sensitive || !c.sensitive) && (purpose === 'export' || !c.exportOnly));
  }

  async filename(ctx: RequestContext, entity: ExchangeEntity, suffix = '') {
    const [org] = await this.db.select({ code: organizations.code }).from(organizations).where(eq(organizations.id, ctx.orgId));
    return `${entity}${suffix}-${(org?.code ?? 'org').toLowerCase()}-${orgToday(await getOrgInfo(this.db, ctx.orgId))}.csv`;
  }

  /** A header row plus one example row, so people can see the expected formats. */
  template(ctx: RequestContext, entity: ExchangeEntity): string {
    const cols = this.columnsFor(ctx, entity, 'import');
    return toCsvText(
      cols.map((c) => c.header),
      [cols.map((c) => c.example)],
    );
  }

  private async exportRows(ctx: RequestContext, entity: ExchangeEntity): Promise<Row[]> {
    const org = ctx.orgId;
    if (entity === 'vehicles') {
      const rows = await this.db
        .select({ v: vehicles, type: vehicleTypes.name, branch: branches.name })
        .from(vehicles)
        .innerJoin(vehicleTypes, eq(vehicleTypes.id, vehicles.vehicleTypeId))
        .leftJoin(branches, eq(branches.id, vehicles.branchId))
        .where(eq(vehicles.orgId, org))
        .orderBy(asc(vehicles.registrationNo));
      return rows.map(({ v, type, branch }) => ({ ...v, vehicleTypeId: type, branchId: branch }));
    }
    if (entity === 'workers') {
      const rows = await this.db
        .select({ w: workers, branch: branches.name })
        .from(workers)
        .leftJoin(branches, eq(branches.id, workers.branchId))
        .where(eq(workers.orgId, org))
        .orderBy(asc(workers.employeeCode));
      return rows.map(({ w, branch }) => ({ ...w, branchId: branch }));
    }
    return this.db.select().from(customers).where(eq(customers.orgId, org)).orderBy(asc(customers.code));
  }

  async export(ctx: RequestContext, entity: ExchangeEntity, req: Request): Promise<string> {
    const cols = this.columnsFor(ctx, entity, 'export');
    const rows = await this.exportRows(ctx, entity);
    await audit(this.db, req, { action: `export.${entity}`, entityType: entity, summary: `Exported ${rows.length} ${entity} to CSV` });
    return toCsvText(
      cols.map((c) => c.header),
      rows.map((r) => cols.map((c) => r[c.field] ?? null)),
    );
  }

  private async existingKeys(ctx: RequestContext, entity: ExchangeEntity, keys: string[]): Promise<Set<string>> {
    if (!keys.length) return new Set();
    const org = ctx.orgId;
    const found =
      entity === 'vehicles'
        ? (await this.db.select({ k: vehicles.registrationNo }).from(vehicles).where(and(eq(vehicles.orgId, org), inArray(vehicles.registrationNo, keys)))).map((r) => r.k)
        : entity === 'workers'
          ? (await this.db.select({ k: workers.employeeCode }).from(workers).where(and(eq(workers.orgId, org), inArray(workers.employeeCode, keys)))).map((r) => r.k)
          : (await this.db.select({ k: customers.code }).from(customers).where(and(eq(customers.orgId, org), inArray(customers.code, keys)))).map((r) => r.k);
    return new Set(found.map((k) => k.toUpperCase()));
  }

  /**
   * Checks every row with the same rules as the forms, and with `commit` creates the valid new ones
   * through the normal services (so numbering, audit and business rules all apply). Nothing is written
   * while any row has an error.
   */
  async import(ctx: RequestContext, entity: ExchangeEntity, csv: string, commit: boolean, req: Request): Promise<ImportResultDto> {
    const def = DEFS[entity];
    let parsed;
    try {
      parsed = parseCsv(csv);
    } catch (err) {
      if (err instanceof CsvParseError) throw AppError.validation(err.message, [{ path: 'csv', message: err.message }]);
      throw err;
    }
    const [header, ...data] = parsed;
    if (!header) throw AppError.validation('The file has no header row', [{ path: 'csv', message: 'Add the header row from the template' }]);
    if (data.length > MAX_IMPORT_ROWS) throw AppError.validation(`At most ${MAX_IMPORT_ROWS} rows per import; split the file`, [{ path: 'csv', message: 'Too many rows' }]);

    const cols = this.columnsFor(ctx, entity, 'import');
    const allCols = DEFS[entity].columns;
    const index = new Map<string, number>();
    header.cells.forEach((h, i) => index.set(headerKey(h), i));
    const warnings: string[] = [];
    const missing = cols.filter((c) => c.required && !index.has(c.header)).map((c) => c.header);
    if (missing.length) {
      throw AppError.validation(`Required columns are missing: ${missing.join(', ')}`, [{ path: 'csv', message: 'Use the headers from the template' }]);
    }
    const known = new Set(allCols.map((c) => c.header));
    const unknown = header.cells.map(headerKey).filter((h) => h && !known.has(h));
    if (unknown.length) warnings.push(`Ignored columns that aren't part of the format: ${unknown.join(', ')}`);
    const hiddenSensitive = allCols.filter((c) => c.sensitive && !cols.includes(c) && index.has(c.header));
    if (hiddenSensitive.length) warnings.push(`Ignored personal and pay columns, which need HR access: ${hiddenSensitive.map((c) => c.header).join(', ')}`);
    const exportOnly = allCols.filter((c) => c.exportOnly && index.has(c.header));
    if (exportOnly.length) warnings.push(`Ignored ${exportOnly.map((c) => c.header).join(', ')}: it is set by the system`);

    const [typeRows, branchRows] = await Promise.all([
      entity === 'vehicles' ? this.db.select({ id: vehicleTypes.id, name: vehicleTypes.name }).from(vehicleTypes).where(eq(vehicleTypes.orgId, ctx.orgId)) : [],
      entity !== 'customers' ? this.db.select({ id: branches.id, name: branches.name }).from(branches).where(eq(branches.orgId, ctx.orgId)) : [],
    ]);
    const types = lookup(typeRows);
    const branchIds = lookup(branchRows);

    // Build and validate each row.
    const checked = data.map((row) => {
      const messages: string[] = [];
      const raw: Row = {};
      for (const c of cols) {
        const i = index.get(c.header);
        const cell = i === undefined ? '' : unguardCell(row.cells[i] ?? '').trim();
        if (cell === '') continue;
        if (c.kind === 'vehicleType') {
          const id = types.get(cell.toLowerCase());
          if (id) raw[c.field] = id;
          else messages.push(`${c.header}: unknown vehicle type "${cell}" (use one of: ${typeRows.map((t) => t.name).join(', ')})`);
        } else if (c.kind === 'branch') {
          const id = branchIds.get(cell.toLowerCase());
          if (id) raw[c.field] = id;
          else messages.push(`${c.header}: unknown branch "${cell}"`);
        } else if (c.kind === 'enum') {
          raw[c.field] = cell.toLowerCase().replace(/\s+/g, '_');
        } else if (c.kind === 'date') {
          raw[c.field] = normaliseDate(cell);
        } else {
          raw[c.field] = cell;
        }
      }
      const result = def.schema.safeParse(raw);
      if (!result.success) {
        for (const issue of result.error.issues) {
          const field = String(issue.path[0] ?? '');
          const header = allCols.find((c) => c.field === field)?.header ?? field;
          // A reference that failed to resolve already has a clearer message.
          if (messages.some((m) => m.startsWith(`${header}:`))) continue;
          const missing = issue.code === 'invalid_type' && /received undefined/.test(issue.message);
          messages.push(`${header || 'row'}: ${missing ? 'required' : issue.message}`);
        }
      }
      const keyCol = cols.find((c) => c.header === def.key)!;
      const keyCell = index.has(def.key) ? unguardCell(row.cells[index.get(def.key)!] ?? '').trim() : '';
      const key = keyCell ? def.normaliseKey(keyCell) : null;
      return { line: row.line, key, input: result.success ? (result.data as Row) : null, messages, keyField: keyCol.field };
    });

    // Duplicates inside the file are errors; records that already exist are skipped.
    const seen = new Map<string, number>();
    for (const r of checked) {
      if (!r.key) continue;
      const first = seen.get(r.key);
      if (first !== undefined) r.messages.push(`${def.key} ${r.key} also appears on line ${first}`);
      else seen.set(r.key, r.line);
    }
    const existing = await this.existingKeys(ctx, entity, [...seen.keys()]);

    const rows: ImportRowResult[] = checked.map((r) => ({
      line: r.line,
      key: r.key,
      status: r.messages.length ? 'error' : r.key && existing.has(r.key) ? 'skip' : 'create',
      messages: r.messages.length ? r.messages : r.key && existing.has(r.key) ? ['Already exists; left unchanged'] : [],
    }));
    const errors = rows.filter((r) => r.status === 'error').length;
    const result: ImportResultDto = {
      entity,
      committed: false,
      total: rows.length,
      toCreate: rows.filter((r) => r.status === 'create').length,
      skipped: rows.filter((r) => r.status === 'skip').length,
      errors,
      created: 0,
      warnings,
      rows,
    };
    if (!commit) return result;
    if (errors) {
      result.warnings.push(`Nothing was imported because ${errors} ${errors === 1 ? 'row has' : 'rows have'} errors. Fix them and try again.`);
      return result;
    }

    for (const [i, row] of rows.entries()) {
      if (row.status !== 'create') continue;
      const input = checked[i]!.input!;
      try {
        if (entity === 'vehicles') await this.services.vehicles.create(ctx, input as never, req);
        else if (entity === 'workers') await this.services.workers.create(ctx, input as never, req);
        else await this.services.parties.createCustomer(ctx, input as never, req);
        row.status = 'created';
        result.created++;
      } catch (err) {
        row.status = 'failed';
        if (err instanceof AppError) {
          // Someone may have added the same record since the check; report it and carry on.
          row.messages = [err.message];
          continue;
        }
        // Anything unexpected (the database went away) stops the import; later rows are not attempted.
        row.messages = ['Could not be saved'];
        for (const later of rows.slice(i + 1)) {
          if (later.status !== 'create') continue;
          later.status = 'failed';
          later.messages = ['Not imported: the import stopped at an earlier row'];
        }
        result.warnings.push('The import stopped early because of an unexpected error. Rows marked as failed were not imported.');
        break;
      }
    }
    result.committed = true;
    await audit(this.db, req, {
      action: `import.${entity}`,
      entityType: entity,
      summary: `Imported ${result.created} ${entity} from CSV (${result.skipped} skipped)`,
      after: { created: result.created, skipped: result.skipped, failed: rows.filter((r) => r.status === 'failed').length },
    });
    return result;
  }
}
