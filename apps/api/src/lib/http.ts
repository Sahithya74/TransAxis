import type { Paginated } from '@transaxis/shared';

export function paginated<T>(data: T[], page: number, pageSize: number, total: number): Paginated<T> {
  return { data, meta: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) } };
}

/** Escapes LIKE wildcards so user search text is matched literally. */
export function escapeLike(input: string): string {
  return input.replace(/[\\%_]/g, (m) => `\\${m}`);
}

/** Splits `-field` into a direction and field name. */
export function parseSort<F extends string>(sort: string | undefined, fallback: F): { field: F; desc: boolean } {
  if (!sort) return { field: fallback, desc: false };
  return sort.startsWith('-') ? { field: sort.slice(1) as F, desc: true } : { field: sort as F, desc: false };
}

export const toNumber = (v: string | number | null | undefined): number | null =>
  v === null || v === undefined ? null : Number(v);
