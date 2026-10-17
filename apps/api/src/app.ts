import { randomUUID } from 'node:crypto';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import express, { type Express } from 'express';
import { rateLimit } from 'express-rate-limit';
import helmet from 'helmet';
import { pino, type Logger } from 'pino';
import { pinoHttp } from 'pino-http';
import type { Db } from '@transaxis/database';
import { webOrigins, type Env } from './config/env.js';
import { AppError, createErrorHandler, notFoundHandler } from './lib/errors.js';
import { authenticate } from './middleware/auth.js';
import { authRoutes } from './modules/auth/routes.js';
import { AuthService } from './modules/auth/service.js';
import { aiRoutes } from './modules/ai/routes.js';
import { AiService } from './modules/ai/service.js';
import { documentRoutes } from './modules/documents/routes.js';
import { DocumentService } from './modules/documents/service.js';
import { fileRoutes } from './modules/files/routes.js';
import { FileService } from './modules/files/service.js';
import { adminRoutes } from './modules/admin/routes.js';
import { AdminService } from './modules/admin/service.js';
import { searchRoutes } from './modules/search/routes.js';
import { exchangeRoutes } from './modules/exchange/routes.js';
import { ExchangeService } from './modules/exchange/service.js';
import { SearchService } from './modules/search/service.js';
import { getOrgInfo } from './lib/org.js';
import { referenceRoutes } from './modules/reference/routes.js';
import { vehicleRoutes, vehicleTypeRoutes } from './modules/vehicles/routes.js';
import { bookingRoutes } from './modules/bookings/routes.js';
import { BookingService } from './modules/bookings/service.js';
import { customerRoutes, locationRoutes, quoteRoutes, routeRoutes, vendorRoutes } from './modules/parties/routes.js';
import { tripRoutes } from './modules/trips/routes.js';
import { TripService } from './modules/trips/service.js';
import { PartyService } from './modules/parties/service.js';
import { attendanceRoutes, compensationRoutes, leaveRoutes, workerRoutes } from './modules/workers/routes.js';
import { WorkerService } from './modules/workers/service.js';
import { VehicleService } from './modules/vehicles/service.js';
import { NotificationService } from './modules/notifications/service.js';
import { notificationRoutes } from './modules/notifications/routes.js';
import { AlertService } from './modules/safety/alerts.js';
import { CheckinService } from './modules/safety/checkins.js';
import { IncidentService } from './modules/safety/incidents.js';
import { alertRoutes, checkinRoutes, incidentRoutes, tripSafetyRoutes } from './modules/safety/routes.js';
import { TrackingService } from './modules/tracking/service.js';
import { CrewPayService } from './modules/finance/crew-pay.js';
import { ExpenseService } from './modules/finance/expenses.js';
import { FuelService } from './modules/finance/fuel.js';
import { InvoiceService } from './modules/finance/invoices.js';
import { LedgerService } from './modules/finance/ledger.js';
import { ReportService } from './modules/finance/reports.js';
import { financeRoutes, reportRoutes } from './modules/finance/routes.js';
import { MaintenanceService } from './modules/maintenance/service.js';
import { maintenanceRoutes } from './modules/maintenance/routes.js';
import { PortalService } from './modules/portal/service.js';
import { portalRoutes } from './modules/portal/routes.js';
import { trackingRoutes } from './modules/tracking/routes.js';
import { buildOpenApi } from './openapi/spec.js';
import { LogOnlyProvider, type MessageProvider } from './providers/messaging.js';
import { noRealtime, type Realtime } from './realtime/socket.js';
import type { Job } from './lib/jobs.js';
import { RagClient } from './lib/rag.js';
import swaggerUi from 'swagger-ui-express';

export interface AppDeps {
  config: Env;
  logger?: Logger;
  /** Without a database only the health endpoint is served. */
  db?: Db;
  messenger?: MessageProvider;
  /** Reports whether the database answers. Injected so tests can run without MySQL. */
  checkDatabase?: () => Promise<boolean>;
  /** Push channel to browsers; a no-op unless the server attaches Socket.IO. */
  realtime?: Realtime;
  /** The document search and assistant service; built from configuration unless injected. */
  rag?: RagClient;
}

/** Services that background jobs need, exposed on the app for the server to schedule. */
export interface LiveServices {
  tracking: TrackingService;
  alerts: AlertService;
  incidents: IncidentService;
  checkins: CheckinService;
  notifications: NotificationService;
  documents: DocumentService;
}

export const liveServices = (app: Express): LiveServices | undefined => app.locals.live as LiveServices | undefined;

/** The live-operations jobs, in the order they should first run. */
export function liveJobs(s: LiveServices, config: Env): Job[] {
  return [
    { name: 'gps-simulator', everyMs: config.SIM_TICK_SECONDS * 1000, run: async (now) => void (await s.tracking.simulate(now)) },
    { name: 'tracking-evaluator', everyMs: 30_000, run: async (now) => void (await s.tracking.evaluate(now)) },
    { name: 'checkin-monitor', everyMs: 60_000, run: async (now) => void (await s.checkins.monitor(now)) },
    { name: 'notification-escalation', everyMs: 60_000, run: async (now) => void (await s.notifications.escalate(now)) },
    { name: 'gps-retention', everyMs: 3_600_000, run: async (now) => void (await s.tracking.purge(now)) },
    { name: 'document-ingest', everyMs: 15_000, run: async (now) => void (await s.documents.dispatchQueued(now)) },
  ];
}

export function createApp({ config, logger, db, messenger, checkDatabase, realtime = noRealtime, rag }: AppDeps): Express {
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
  // TRUST_PROXY overrides this, e.g. "loopback" when a local tunnel and dev proxy sit in front.
  app.set('trust proxy', config.TRUST_PROXY ?? (config.NODE_ENV === 'production' ? 1 : false));

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
  app.use(cors({ origin: webOrigins(config), credentials: true, maxAge: 600 }));
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
    // Cached for a minute and cleared when a tenant is suspended, so this costs almost nothing per request.
    const orgActive = async (orgId: number) => {
      try {
        return (await getOrgInfo(db, orgId)).status === 'active';
      } catch (err) {
        if (err instanceof AppError && err.status === 404) return false;
        throw err;
      }
    };
    const auth = authenticate(config.JWT_ACCESS_SECRET, { orgActive, requireCurrentPassword: true });
    const messages = messenger ?? new LogOnlyProvider(log, config.NODE_ENV !== 'production');
    const authService = new AuthService({ db, config, messenger: messages });
    const vehicleService = new VehicleService(db);

    api.use('/auth', authRoutes(authService, config));
    api.use('/vehicles', auth, vehicleRoutes(vehicleService));
    api.use('/vehicle-types', auth, vehicleTypeRoutes(vehicleService));
    api.use('/reference', auth, referenceRoutes(db));
    const fileService = new FileService(db, config.UPLOAD_DIR);
    api.use('/files', auth, fileRoutes(fileService, config.MAX_UPLOAD_MB));

    const workerService = new WorkerService(db);
    api.use('/workers', auth, workerRoutes(workerService));
    api.use('/leave', auth, leaveRoutes(workerService));
    api.use('/attendance', auth, attendanceRoutes(workerService));
    api.use('/compensation-policies', auth, compensationRoutes(workerService));

    const partyService = new PartyService(db);
    api.use('/customers', auth, customerRoutes(partyService));
    api.use('/quotes', auth, quoteRoutes(partyService));
    api.use('/vendors', auth, vendorRoutes(partyService));
    api.use('/locations', auth, locationRoutes(partyService));
    api.use('/routes', auth, routeRoutes(partyService));

    const bookingService = new BookingService(db);
    api.use('/bookings', auth, bookingRoutes(bookingService));

    const notifications = new NotificationService(db, realtime);
    const alerts = new AlertService(db, notifications, realtime);
    const incidents = new IncidentService(db, alerts, notifications, realtime);
    const checkins = new CheckinService(db, alerts);
    const tracking = new TrackingService({ db, config, alerts, realtime });
    const ragClient = rag ?? new RagClient(config.RAG_SERVICE_URL, config.RAG_SERVICE_SECRET);
    const documents = new DocumentService(db, config.UPLOAD_DIR, ragClient, log);
    api.use('/documents', auth, documentRoutes(documents, config.MAX_DOCUMENT_MB));
    api.use('/ai', auth, aiRoutes(new AiService(db, ragClient), config.NODE_ENV === 'test'));
    app.locals.live = { tracking, alerts, incidents, checkins, notifications, documents } satisfies LiveServices;

    const ledger = new LedgerService(db);
    const expenseService = new ExpenseService(db, ledger, notifications);
    const fuelService = new FuelService(db, ledger, notifications);
    const invoiceService = new InvoiceService(db, ledger);
    const crewPay = new CrewPayService(db, ledger, notifications);
    const reportService = new ReportService(db, invoiceService, fuelService, crewPay);
    api.use('/finance', auth, financeRoutes({ ledger, expenses: expenseService, fuel: fuelService, invoices: invoiceService, crew: crewPay, reports: reportService }));
    api.use('/reports', auth, reportRoutes(reportService));
    api.use('/maintenance', auth, maintenanceRoutes(new MaintenanceService(db, ledger, notifications)));
    api.use('/portal', auth, portalRoutes(new PortalService(db, bookingService, tracking, notifications)));

    const tripService = new TripService({ db, config, messenger: messages, files: fileService, crewPay });
    api.use('/trips', auth, tripSafetyRoutes(checkins, incidents), tripRoutes(tripService));
    api.use('/tracking', auth, trackingRoutes(tracking, alerts, incidents, checkins));
    api.use('/alerts', auth, alertRoutes(alerts));
    api.use('/incidents', auth, incidentRoutes(incidents));
    api.use('/checkins', auth, checkinRoutes(checkins));
    api.use('/notifications', auth, notificationRoutes(notifications));
    api.use('/admin', auth, adminRoutes(new AdminService(db, config.UPLOAD_DIR, ragClient)));
    api.use('/search', auth, searchRoutes(new SearchService(db)));
    api.use('/exchange', auth, exchangeRoutes(new ExchangeService(db, { vehicles: vehicleService, workers: workerService, parties: partyService })));
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
