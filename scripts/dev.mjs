// Starts the API and web dev servers, plus the RAG service when its environment is set up (npm run rag:setup).
import concurrently from 'concurrently';
import { ragCommand, ROOT } from './rag.mjs';

const commands = [
  { name: 'api', command: 'npm run dev -w @transaxis/api', prefixColor: 'blue' },
  { name: 'web', command: 'npm run dev -w @transaxis/web', prefixColor: 'green' },
];
const rag = ragCommand({ reload: true });
if (rag) commands.push(rag);

const { result } = concurrently(commands, { cwd: ROOT, killOthersOn: ['failure'], restartTries: 0 });
result.catch(() => process.exit(1));
