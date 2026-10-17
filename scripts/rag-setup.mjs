// Creates services/rag/.venv and installs the RAG service's packages. Safe to run again.
//   npm run rag:setup              runtime and test packages
//   npm run rag:setup -- --semantic  also local semantic embeddings (EMBEDDING_PROVIDER=fastembed)
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { RAG_DIR, ragPython } from './rag.mjs';

const run = (cmd, args) => {
  console.log(`> ${cmd} ${args.join(' ')}`);
  const r = spawnSync(cmd, args, { cwd: RAG_DIR, stdio: 'inherit' });
  if (r.status !== 0) process.exit(r.status ?? 1);
};

if (!ragPython()) {
  const python = process.platform === 'win32' ? 'python' : 'python3';
  const check = spawnSync(python, ['-c', 'import sys; sys.exit(0 if sys.version_info >= (3, 10) else 1)']);
  if (check.status !== 0) {
    console.error('Python 3.10 or newer is needed for the RAG service. Install it from python.org and try again.');
    process.exit(1);
  }
  run(python, ['-m', 'venv', '.venv']);
}
const py = ragPython();
run(py, ['-m', 'pip', 'install', '--upgrade', 'pip', '-q']);
run(py, ['-m', 'pip', 'install', '-r', 'requirements-dev.txt', '-q']);
if (process.argv.includes('--semantic')) run(py, ['-m', 'pip', 'install', '-r', 'requirements-semantic.txt', '-q']);
console.log(`RAG service ready in ${resolve(RAG_DIR, '.venv')}. It starts with npm run dev and npm run share.`);
