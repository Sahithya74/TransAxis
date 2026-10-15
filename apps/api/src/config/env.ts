import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

const here = dirname(fileURLToPath(import.meta.url));
/** Monorepo root. Relative paths in configuration (e.g. UPLOAD_DIR) are resolved against it. */
export const ROOT_DIR = resolve(here, '..', '..', '..', '..');
const rootEnv = resolve(ROOT_DIR, '.env');

// Load the monorepo .env if present. Real environment variables always take precedence.
if (existsSync(rootEnv)) {
  try {
    process.loadEnvFile(rootEnv);
  } catch {
    /* unreadable .env: fall through to validation, which reports what is missing */
  }
}

const emptyToUndefined = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? undefined : v);
const optionalString = z.preprocess(emptyToUndefined, z.string().optional());

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  WEB_ORIGIN: z.string().url().default('http://localhost:5173'),
  DATABASE_URL: optionalString,
  DATABASE_URL_TEST: optionalString,
  JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET must be at least 32 characters'),
  ACCESS_TOKEN_TTL_MINUTES: z.coerce.number().int().min(1).max(120).default(15),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().min(1).max(90).default(14),
  UPLOAD_DIR: z
    .string()
    .default('./storage/uploads')
    .transform((p) => resolve(ROOT_DIR, p)),
  API_DOCS_ENABLED: z.preprocess(
    (v) => (v === undefined || v === '' ? undefined : v === 'true' || v === '1'),
    z.boolean().optional(),
  ),
  MAX_UPLOAD_MB: z.coerce.number().int().min(1).max(200).default(20),
  TELEMATICS_PROVIDER: z.enum(['simulated', 'none']).default('simulated'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
});

export type Env = z.infer<typeof schema>;

/** Parse and validate configuration. Throws one readable error listing every problem. */
export function loadConfig(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = schema.safeParse(source);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`);
    throw new Error(`Invalid environment configuration:\n${lines.join('\n')}`);
  }
  return parsed.data;
}
