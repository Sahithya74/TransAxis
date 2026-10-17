// Runs only the RAG service (npm run rag), or its tests (npm run test:rag).
import { spawnSync } from 'node:child_process';
import { RAG_DIR, ragCommand, ragPython } from './rag.mjs';

if (!ragPython()) {
  console.error('The RAG service is not set up. Run `npm run rag:setup` first.');
  process.exit(1);
}
const testing = process.argv.includes('--test');
const command = testing ? `"${ragPython()}" -m pytest -q` : ragCommand({ reload: true }).command;
const r = spawnSync(command, { cwd: RAG_DIR, stdio: 'inherit', shell: true });
process.exit(r.status ?? 1);
