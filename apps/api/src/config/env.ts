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

/** Express `trust proxy`: "true"/"false", a hop count, or a name/address list such as "loopback". */
const trustProxy = z.preprocess(
  (v) => {
    const s = emptyToUndefined(v);
    if (typeof s !== 'string') return s;
    if (s === 'true' || s === 'false') return s === 'true';
    return /^\d+$/.test(s) ? Number(s) : s;
  },
  z.union([z.boolean(), z.number().int().min(0), z.string()]).optional(),
);

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  /** Canonical web origin: links in emails point here. */
  WEB_ORIGIN: z.string().url().default('http://localhost:5173'),
  /** Further origins the web app is served from (comma-separated), e.g. a tunnel or LAN address. */
  EXTRA_WEB_ORIGINS: z
    .string()
    .default('')
    .transform((s) => s.split(',').map((o) => o.trim()).filter(Boolean))
    .pipe(z.array(z.string().url())),
  /** Unset: one hop in production, none otherwise. */
  TRUST_PROXY: trustProxy,
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
  /** Background jobs (GPS simulation, alert evaluation, check-ins, escalation). Off in tests. */
  JOBS_ENABLED: z.preprocess((v) => (v === undefined || v === '' ? undefined : v === 'true' || v === '1'), z.boolean().optional()),
  SIM_TICK_SECONDS: z.coerce.number().int().min(2).max(120).default(10),
  GPS_RETENTION_DAYS: z.coerce.number().int().min(1).max(365).default(14),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  /** The document search and assistant service (127.0.0.1 only). Unset: the library still stores files but nothing is searchable. */
  RAG_SERVICE_URL: z.preprocess(emptyToUndefined, z.string().url().optional()),
  /** Signs the short-lived tokens the API sends to the RAG service. */
  RAG_SERVICE_SECRET: z.preprocess(emptyToUndefined, z.string().min(32, 'RAG_SERVICE_SECRET must be at least 32 characters').optional()),
  MAX_DOCUMENT_MB: z.coerce.number().int().min(1).max(100).default(15),
  /** Encrypts authenticator secrets at rest. Unset: derived from JWT_ACCESS_SECRET (rotating that then resets two-step sign-in). */
  TOTP_ENCRYPTION_KEY: z.preprocess(emptyToUndefined, z.string().min(32, 'TOTP_ENCRYPTION_KEY must be at least 32 characters').optional()),
});

export type Env = z.infer<typeof schema>;

/** Every origin allowed to call the API with credentials. */
export const webOrigins = (config: Env): string[] => [config.WEB_ORIGIN, ...config.EXTRA_WEB_ORIGINS];

/** Parse and validate configuration. Throws one readable error listing every problem. */
export function loadConfig(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = schema.safeParse(source);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`);
    throw new Error(`Invalid environment configuration:\n${lines.join('\n')}`);
  }
  return parsed.data;
}
