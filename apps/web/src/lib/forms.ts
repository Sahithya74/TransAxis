import type { z } from 'zod';
import { ApiError } from './api';

export type FieldErrors = Record<string, string>;

/** First message per field from a zod parse failure. */
export function zodFieldErrors(error: z.ZodError): FieldErrors {
  const out: FieldErrors = {};
  for (const issue of error.issues) {
    const key = issue.path.join('.') || '_form';
    out[key] ??= issue.message;
  }
  return out;
}

/** Maps the API error envelope's `details: [{path, message}]` onto form fields. */
export function apiFieldErrors(err: unknown): { fields: FieldErrors; message: string } {
  if (err instanceof ApiError) {
    const fields: FieldErrors = {};
    if (Array.isArray(err.details)) {
      for (const d of err.details as { path?: string; message?: string }[]) {
        if (d?.path && d.message) fields[d.path] ??= d.message;
      }
    }
    return { fields, message: err.message };
  }
  return { fields: {}, message: 'Could not reach the server. Check your connection and try again.' };
}

/** Converts form strings to the payload the API expects: '' becomes null, numbers stay strings for zod coercion. */
export function blankToNull<T extends Record<string, unknown>>(values: T): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(values)) out[k] = typeof v === 'string' && v.trim() === '' ? null : v;
  return out as T;
}
