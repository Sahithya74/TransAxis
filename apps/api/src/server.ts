import { createServer } from 'node:http';
import { pino } from 'pino';
import { createDb, type DbHandle } from '@transaxis/database';
import { createApp, liveJobs, liveServices } from './app.js';
import { loadConfig, webOrigins } from './config/env.js';
import { JobRunner } from './lib/jobs.js';
import { attachRealtime } from './realtime/socket.js';

const config = loadConfig();
const log = pino({
  level: config.LOG_LEVEL,
  redact: { paths: ['req.headers.authorization', 'req.headers.cookie', 'res.headers["set-cookie"]', '*.password', '*.refreshToken'], censor: '[redacted]' },
});

let handle: DbHandle | undefined;
if (config.DATABASE_URL) handle = createDb(config.DATABASE_URL);

// The HTTP server exists first so the realtime channel can share its port.
const server = createServer();
const realtime = attachRealtime(server, { jwtSecret: config.JWT_ACCESS_SECRET, origins: webOrigins(config), log });
const app = createApp({
  config,
  logger: log,
  db: handle?.db,
  realtime,
  checkDatabase: handle
    ? async () => {
        await handle!.pool.query('SELECT 1');
        return true;
      }
    : undefined,
});
server.on('request', app);

let jobs: JobRunner | undefined;
const live = liveServices(app);
if (handle && live && (config.JOBS_ENABLED ?? config.NODE_ENV !== 'test')) {
  jobs = new JobRunner(handle.db, log, liveJobs(live, config));
}

server.listen(config.API_PORT, () => {
  console.log(`TransAxis API listening on http://localhost:${config.API_PORT}/api/v1`);
  if (!handle) console.warn('DATABASE_URL is not set; serving /health only (run npm run db:bootstrap).');
  jobs?.start();
});

function shutdown(signal: string) {
  console.log(`${signal} received, shutting down`);
  jobs?.stop();
  void realtime.io.close();
  server.close(async () => {
    await handle?.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
