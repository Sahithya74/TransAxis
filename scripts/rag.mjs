// Shared by dev.mjs, share.mjs and `npm run rag`: how to find and start the local RAG service.
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

export const ROOT = resolve(import.meta.dirname, '..');
export const RAG_DIR = resolve(ROOT, 'services/rag');

/** The virtual environment's Python, or null when `npm run rag:setup` hasn't been run yet. */
export function ragPython() {
  const candidates = [resolve(RAG_DIR, '.venv/Scripts/python.exe'), resolve(RAG_DIR, '.venv/bin/python')];
  return candidates.find((p) => existsSync(p)) ?? null;
}

/** The port in RAG_SERVICE_URL (or RAG_PORT), read from the environment or the root .env file. */
export function ragPort() {
  const envFile = resolve(ROOT, '.env');
  if (existsSync(envFile)) {
    try {
      process.loadEnvFile(envFile);
    } catch {
      /* unreadable .env: fall back to defaults */
    }
  }
  try {
    const url = process.env.RAG_SERVICE_URL ? new URL(process.env.RAG_SERVICE_URL) : null;
    if (url?.port) return Number(url.port);
  } catch {
    /* malformed URL: fall through */
  }
  return Number(process.env.RAG_PORT) || 8001;
}

/**
 * A `concurrently` command that runs the service on 127.0.0.1 only, or null (with a hint) when it isn't
 * set up. It is never exposed directly: the API is its only client.
 */
export function ragCommand({ reload = false } = {}) {
  const python = ragPython();
  if (!python) {
    console.log('[rag] Document search and the assistant are off: run `npm run rag:setup` once to install them.');
    return null;
  }
  return {
    name: 'rag',
    command: `"${python}" -m uvicorn app.main:create_app --factory --host 127.0.0.1 --port ${ragPort()}${reload ? ' --reload --reload-dir app' : ''}`,
    cwd: RAG_DIR,
    prefixColor: 'magenta',
  };
}
