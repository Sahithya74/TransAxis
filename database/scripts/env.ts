import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
export const ROOT_DIR = resolve(here, '..', '..');
export const ENV_PATH = resolve(ROOT_DIR, '.env');

/** Minimal .env loader: KEY=VALUE lines, `#` comments, no interpolation. Real env vars win. */
export function loadEnv(): void {
  if (!existsSync(ENV_PATH)) return;
  for (const line of readFileSync(ENV_PATH, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (!m) continue;
    const [, key, value] = m;
    if (key && process.env[key] === undefined) process.env[key] = value ?? '';
  }
}

/** Replace (or append) KEY=VALUE in the root .env file without touching other lines. */
export function writeEnvValue(key: string, value: string): void {
  const current = existsSync(ENV_PATH) ? readFileSync(ENV_PATH, 'utf8') : '';
  const pattern = new RegExp(`^${key}=.*$`, 'm');
  const next = pattern.test(current)
    ? current.replace(pattern, () => `${key}=${value}`)
    : `${current.replace(/\s*$/, '\n')}${key}=${value}\n`;
  writeFileSync(ENV_PATH, next, 'utf8');
  process.env[key] = value;
}

export function requireEnv(key: string): string {
  const v = process.env[key];
  if (!v) throw new Error(`Missing required environment variable ${key} (see .env.example)`);
  return v;
}
