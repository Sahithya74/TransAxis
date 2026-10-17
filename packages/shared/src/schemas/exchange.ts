import { z } from 'zod';

/** Records that can be exported to and imported from CSV. */
export const EXCHANGE_ENTITIES = ['vehicles', 'workers', 'customers'] as const;
export type ExchangeEntity = (typeof EXCHANGE_ENTITIES)[number];

export const EXCHANGE_LABELS: Record<ExchangeEntity, string> = { vehicles: 'vehicles', workers: 'drivers and workers', customers: 'customers' };

/** Most rows one import accepts; larger files should be split. */
export const MAX_IMPORT_ROWS = 2000;

/**
 * An import is checked first (`commit: false`) and only written when asked again with `commit: true`.
 * The file travels as text so the browser can read it locally and show what will happen before upload.
 */
export const importRequestSchema = z.object({
  csv: z.string().min(1, 'The file is empty').max(900_000, 'The file is too large; split it into files under 900 KB'),
  commit: z.boolean().default(false),
});

export interface ImportRowResult {
  /** Line in the file (the header is line 1). */
  line: number;
  /** The record's key: registration number, employee code or customer code. */
  key: string | null;
  /** create/skip/error before committing; created/failed after. */
  status: 'create' | 'skip' | 'error' | 'created' | 'failed';
  messages: string[];
}

export interface ImportResultDto {
  entity: ExchangeEntity;
  committed: boolean;
  total: number;
  toCreate: number;
  skipped: number;
  errors: number;
  created: number;
  /** File-level notes, such as columns that were ignored. */
  warnings: string[];
  rows: ImportRowResult[];
}
