import { createServer } from 'node:http';
import { createDb, type DbHandle } from '@transaxis/database';
import { createApp } from './app.js';
import { loadConfig } from './config/env.js';

const config = loadConfig();

let handle: DbHandle | undefined;
if (config.DATABASE_URL) handle = createDb(config.DATABASE_URL);

const app = createApp({
  config,
  db: handle?.db,
  checkDatabase: handle
    ? async () => {
        await handle!.pool.query('SELECT 1');
        return true;
      }
    : undefined,
});

const server = createServer(app);
server.listen(config.API_PORT, () => {
  console.log(`TransAxis API listening on http://localhost:${config.API_PORT}/api/v1`);
  if (!handle) console.warn('DATABASE_URL is not set; serving /health only (run npm run db:bootstrap).');
});

function shutdown(signal: string) {
  console.log(`${signal} received, shutting down`);
  server.close(async () => {
    await handle?.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
