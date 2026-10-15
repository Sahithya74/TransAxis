import { sql } from 'drizzle-orm';
import { bigint, datetime } from 'drizzle-orm/mysql-core';

/** Auto-increment surrogate primary key. IDs never leave the org scope unchecked. */
export const idCol = (name = 'id') =>
  bigint(name, { mode: 'number', unsigned: true }).autoincrement().primaryKey();

/** Unsigned BIGINT column used for foreign keys. */
export const refCol = (name: string) => bigint(name, { mode: 'number', unsigned: true });

/** UTC timestamp with millisecond precision; set by the database. */
export const createdAtCol = () =>
  datetime('created_at', { mode: 'date', fsp: 3 })
    .notNull()
    .default(sql`CURRENT_TIMESTAMP(3)`);

export const updatedAtCol = () =>
  datetime('updated_at', { mode: 'date', fsp: 3 })
    .notNull()
    .default(sql`CURRENT_TIMESTAMP(3)`)
    .$onUpdateFn(() => new Date());

export const dt = (name: string) => datetime(name, { mode: 'date', fsp: 3 });
