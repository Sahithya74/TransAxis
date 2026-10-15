import { randomUUID } from 'node:crypto';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import express, { type Express } from 'express';
import { rateLimit } from 'express-rate-limit';
import helmet from 'helmet';
import { pino, type Logger } from 'pino';
import { pinoHttp } from 'pino-http';
import type { Db } from '@transaxis/database';
import type { Env } from './config/env.js';
import { AppError, createErrorHandler, notFoundHandler } from './lib/errors.js';
import { authenticate } from './middleware/auth.js';
import { authRoutes } from './modules/auth/routes.js';
import { AuthService } from './modules/auth/service.js';
import { fileRoutes } from './modules/files/routes.js';
import { FileService } from './modules/files/service.js';
import { referenceRoutes } from './modules/reference/routes.js';
import { vehicleRoutes, vehicleTypeRoutes } from './modules/vehicles/routes.js';
import { VehicleService } from './modules/vehicles/service.js';
import { buildOpenApi } from './openapi/spec.js';
import { LogOnlyProvider, type MessageProvider } from './providers/messaging.js';
import swaggerUi from 'swagger-ui-express';

export interface AppDeps {
  config: Env;
  logger?: Logger;
  /** Without a database only the health endpoint is served. */
  db?: Db;
  messenger?: MessageProvider;
  /** Reports whether the database answers. Injected so tests can run without MySQL. */
  checkDatabase?: () => Promise<boolean>;
}

export function createApp({ config, logger, db, messenger, checkDatabase }: AppDeps): Express {
  const log =
    logger ??
    pino({
      level: config.LOG_LEVEL,
      redact: {
        paths: [
          'req.headers.authorization',
          'req.headers.cookie',
          'res.headers["set-cookie"]',
          '*.password',
          '*.refreshToken',
        ],
        censor: '[redacted]',
      },
    });

  const app = express();
  app.disable('x-powered-by');
  // The API sits behind a single reverse proxy in production; trust it for client IPs only.
  app.set('trust proxy', config.NODE_ENV === 'production' ? 1 : false);

  app.use((req, res, next) => {
    const incoming = req.headers['x-request-id'];
    const id = typeof incoming === 'string' && /^[\w-]{8,64}$/.test(incoming) ? incoming : randomUUID();
    (req as { id?: string }).id = id;
    res.setHeader('x-request-id', id);
    next();
  });
  app.use(
    pinoHttp({
      logger: log,
      genReqId: (req) => (req as { id?: string }).id ?? randomUUID(),
      autoLogging: { ignore: (req) => req.url?.endsWith('/health') ?? false },
    }),
  );
  app.use(helmet());
  app.use(cors({ origin: config.WEB_ORIGIN, credentials: true, maxAge: 600 }));
  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());

  // Broad per-IP ceiling; stricter limits are applied to auth routes in the auth module.
  app.use(
    '/api/v1',
    rateLimit({
      windowMs: 60_000,
      limit: config.NODE_ENV === 'test' ? 10_000 : 600,
      standardHeaders: 'draft-7',
      legacyHeaders: false,
      handler: (_req, _res, next) =>
        next(new AppError(429, 'RATE_LIMITED', 'Too many requests, please slow down')),
    }),
  );

  const api = express.Router();

  api.get('/health', async (_req, res) => {
    let database: 'up' | 'down' | 'not_configured' = 'not_configured';
    if (checkDatabase) {
      try {
        database = (await checkDatabase()) ? 'up' : 'down';
      } catch {
        database = 'down';
      }
    }
    const ok = database !== 'down';
    res.status(ok ? 200 : 503).json({
      status: ok ? 'ok' : 'degraded',
      service: 'transaxis-api',
      time: new Date().toISOString(),
      checks: { database },
    });
  });

  if (db) {
    const auth = authenticate(config.JWT_ACCESS_SECRET);
    const authService = new AuthService({
      db,
      config,
      messenger: messenger ?? new LogOnlyProvider(log, config.NODE_ENV !== 'production'),
    });
    const vehicleService = new VehicleService(db);

    api.use('/auth', authRoutes(authService, config));
    api.use('/vehicles', auth, vehicleRoutes(vehicleService));
    api.use('/vehicle-types', auth, vehicleTypeRoutes(vehicleService));
    api.use('/reference', auth, referenceRoutes(db));
    api.use('/files', auth, fileRoutes(new FileService(db, config.UPLOAD_DIR), config.MAX_UPLOAD_MB));
  }

  // API reference: on by default outside production, opt-in with API_DOCS_ENABLED=true in production.
  if (config.API_DOCS_ENABLED ?? config.NODE_ENV !== 'production') {
    const spec = buildOpenApi('/api/v1');
    api.get('/openapi.json', (_req, res) => res.json(spec));
    api.use('/docs', swaggerUi.serve, swaggerUi.setup(spec, { customSiteTitle: 'TransAxis API' }));
  }

  app.use('/api/v1', api);
  app.use(notFoundHandler);
  app.use(createErrorHandler(log));
  return app;
}
