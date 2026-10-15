// Starts the API and web dev servers (and the RAG service once it exists and its venv is set up).
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import concurrently from 'concurrently';

const root = resolve(import.meta.dirname, '..');
const commands = [
  { name: 'api', command: 'npm run dev -w @transaxis/api', prefixColor: 'blue' },
  { name: 'web', command: 'npm run dev -w @transaxis/web', prefixColor: 'green' },
];

const ragPython = resolve(root, 'services/rag/.venv/Scripts/python.exe');
const ragMain = resolve(root, 'services/rag/app/main.py');
if (existsSync(ragPython) && existsSync(ragMain)) {
  commands.push({
    name: 'rag',
    command: `"${ragPython}" -m uvicorn app.main:app --host 127.0.0.1 --port 8001 --reload`,
    cwd: resolve(root, 'services/rag'),
    prefixColor: 'magenta',
  });
} else {
  console.log('[dev] RAG service not set up yet; skipping (see services/rag).');
}

const { result } = concurrently(commands, { cwd: root, killOthersOn: ['failure'], restartTries: 0 });
result.catch(() => process.exit(1));
