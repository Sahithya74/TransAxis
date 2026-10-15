import { z } from 'zod';

export const idSchema = z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER);
export const idParamSchema = z.object({ id: idSchema });

/** ISO calendar date (YYYY-MM-DD) that is also a real date. */
export const isoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD')
  .refine((s) => !Number.isNaN(Date.parse(`${s}T00:00:00Z`)) && new Date(`${s}T00:00:00Z`).toISOString().startsWith(s), 'Not a valid date');

export const optionalText = (max: number) =>
  z.preprocess(
    (v) => (typeof v === 'string' && v.trim() === '' ? null : v),
    z.string().trim().max(max).nullable().optional(),
  );

/** Builds a list-query schema with a whitelisted sort field set. `-field` sorts descending. */
export function listQuerySchema<const S extends readonly [string, ...string[]]>(sortFields: S) {
  const sortValues = sortFields.flatMap((f) => [f, `-${f}`]) as [string, ...string[]];
  return z.object({
    page: z.coerce.number().int().min(1).max(10_000).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(25),
    sort: z.enum(sortValues).optional(),
    q: z.string().trim().max(100).optional(),
  });
}

export interface Paginated<T> {
  data: T[];
  meta: { page: number; pageSize: number; total: number; totalPages: number };
}
