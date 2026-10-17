import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { and, eq } from 'drizzle-orm';
import { pino } from 'pino';
import { io as connect } from 'socket.io-client';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { driverCheckins, notifications, safetyAlerts, trips } from '@transaxis/database';
import type { IncidentDto, LiveVehicleDto, SafetyAlertDto, TripListItemDto } from '@transaxis/shared';
import { liveServices, type LiveServices } from '../src/app.js';
import { JobRunner } from '../src/lib/jobs.js';
import { attachRealtime } from '../src/realtime/socket.js';
import { bearer, createTestApp, hasDb, login, type LoggedIn, type TestApp } from './helpers.js';

const minutes = (m: number, from = Date.now()) => new Date(from + m * 60_000);

describe.skipIf(!hasDb)('live operations (integration)', () => {
  let t: TestApp;
  let live: LiveServices;
  let control: LoggedIn;
  let dispatch: LoggedIn;
  let owner: LoggedIn;
  let driver: LoggedIn;
  let hr: LoggedIn;
  let otherOrg: LoggedIn;
  let running: TripListItemDto[];

  beforeAll(async () => {
    t = createTestApp();
    live = liveServices(t.app)!;
    [control, dispatch, owner, driver, hr, otherOrg] = (await Promise.all(
      ['control@kaveri.demo', 'dispatch@kaveri.demo', 'owner@kaveri.demo', 'driver@kaveri.demo', 'hr@kaveri.demo', 'owner@sahyadri.demo'].map((e) => login(t.app, e)),
    )) as [LoggedIn, LoggedIn, LoggedIn, LoggedIn, LoggedIn, LoggedIn];
    running = (await request(t.app).get('/api/v1/trips').query({ status: 'in_transit', pageSize: 50 }).set(bearer(dispatch.token))).body.data;
  });
  afterAll(async () => {
    await t.close();
  });

  const alertsFor = async (token: string, query: Record<string, string | number> = {}) =>
    (await request(t.app).get('/api/v1/alerts').query({ pageSize: 100, ...query }).set(bearer(token))).body.data as SafetyAlertDto[];

  describe('tracking', () => {
    it('seeds trips on the road with a simulated GPS trail', async () => {
      expect(running.length).toBeGreaterThan(0);
      const res = await request(t.app).get('/api/v1/tracking/vehicles').set(bearer(control.token));
      expect(res.status).toBe(200);
      expect(res.body.simulated).toBe(true);
      const onTrip = (res.body.data as LiveVehicleDto[]).filter((v) => v.trip?.status === 'in_transit');
      expect(onTrip.length).toBe(running.length);
      for (const v of onTrip) {
        expect(v.position?.isSimulated).toBe(true);
        expect(v.eta?.method).toMatch(/historical|fallback/);
      }
    });

    it('moves vehicles each simulator tick and pushes nothing for vehicles off duty', async () => {
      expect(await live.tracking.simulate(new Date())).toBeGreaterThan(0);
      const track = await request(t.app).get(`/api/v1/tracking/trips/${running[0]!.id}`).set(bearer(control.token));
      expect(track.status).toBe(200);
      expect(track.body.breadcrumb.length).toBeGreaterThan(10);
      expect(track.body.plannedPath.length).toBeGreaterThan(2);
    });

    it('lets crew follow only their own trip, and accepts phone positions only during it', async () => {
      const mine = await request(t.app).get('/api/v1/trips').query({ pageSize: 50 }).set(bearer(driver.token));
      const ownRunning = (mine.body.data as TripListItemDto[]).find((x) => x.status === 'in_transit')!;
      expect((await request(t.app).get(`/api/v1/tracking/trips/${ownRunning.id}`).set(bearer(driver.token))).status).toBe(200);
      const someoneElses = running.find((r) => r.id !== ownRunning.id)!;
      expect((await request(t.app).get(`/api/v1/tracking/trips/${someoneElses.id}`).set(bearer(driver.token))).status).toBe(404);
      expect((await request(t.app).get('/api/v1/tracking/vehicles').set(bearer(driver.token))).status).toBe(403);

      const pos = await request(t.app).post('/api/v1/tracking/positions').set(bearer(driver.token)).send({ lat: 12.95, lng: 79.4, speedKmph: 48, accuracyM: 12 });
      expect(pos.status).toBe(201);
      expect(pos.body.tripId).toBe(ownRunning.id);
      expect((await request(t.app).post('/api/v1/tracking/positions').set(bearer(dispatch.token)).send({ lat: 12.9, lng: 79.4 })).status).toBe(403);
    });

    it('hides other organisations\' vehicles and trips', async () => {
      const theirs = (await request(t.app).get('/api/v1/tracking/vehicles').set(bearer(otherOrg.token))).body.data as LiveVehicleDto[];
      expect(theirs.some((v) => running.some((r) => r.vehicle.id === v.vehicleId))).toBe(false);
      expect((await request(t.app).get(`/api/v1/tracking/trips/${running[0]!.id}`).set(bearer(otherOrg.token))).status).toBe(404);
    });
  });

  describe('alerts', () => {
    it('raises one alert per condition, refreshes it, and clears warnings when the condition ends', async () => {
      const future = minutes(40);
      await live.tracking.evaluate(future); // no fix in the last 40 minutes of "future" time
      const stale = (await alertsFor(control.token, { alertType: 'gps_stale', status: 'active' })).filter((a) => running.some((r) => r.id === a.trip?.id));
      expect(stale.length).toBe(running.length);

      await live.tracking.evaluate(minutes(41));
      const again = (await alertsFor(control.token, { alertType: 'gps_stale', status: 'active' })).filter((a) => running.some((r) => r.id === a.trip?.id));
      expect(again.length).toBe(stale.length);
      expect(again[0]!.occurrences).toBeGreaterThan(1);

      // Fresh fixes arrive; the warnings resolve themselves.
      const now = minutes(42);
      await live.tracking.simulate(now);
      await live.tracking.evaluate(now);
      const cleared = await alertsFor(control.token, { alertType: 'gps_stale', status: 'resolved' });
      expect(cleared.filter((a) => a.autoResolved && running.some((r) => r.id === a.trip?.id)).length).toBeGreaterThanOrEqual(stale.length);
    });

    it('enforces who may read and act on alerts', async () => {
      const [a] = await live.alerts.raise(t.handle.db, {
        orgId: control.body.organization.id,
        type: 'route_deviation',
        severity: 'critical',
        title: 'Off the planned route: test',
        detail: '9.0 km from the planned route.',
        tripId: running[0]!.id,
        dedupeKey: `test:${Date.now()}`,
      }).then((r) => [r]);
      expect((await request(t.app).get('/api/v1/alerts').set(bearer(driver.token))).status).toBe(403);
      expect((await request(t.app).get(`/api/v1/alerts/${a!.id}`).set(bearer(otherOrg.token))).status).toBe(404);
      expect((await request(t.app).post(`/api/v1/alerts/${a!.id}/acknowledge`).set(bearer(owner.token)).send({})).status).toBe(403);
      const ack = await request(t.app).post(`/api/v1/alerts/${a!.id}/acknowledge`).set(bearer(control.token)).send({});
      expect(ack.body).toMatchObject({ status: 'acknowledged', acknowledgedBy: 'Priya Venkatesh' });
      expect((await request(t.app).post(`/api/v1/alerts/${a!.id}/resolve`).set(bearer(control.token)).send({ note: '' })).status).toBe(400);
      const done = await request(t.app).post(`/api/v1/alerts/${a!.id}/resolve`).set(bearer(dispatch.token)).send({ note: 'Diversion confirmed by phone' });
      expect(done.body).toMatchObject({ status: 'resolved', resolutionNote: 'Diversion confirmed by phone', autoResolved: false });
      // Critical alerts are never auto-resolved by the evaluator.
      expect(done.body.resolvedBy).toBe('Arjun Ramesh');
    });

    it('notifies everyone who can read alerts, once per alert', async () => {
      const key = `notify-test:${Date.now()}`;
      const orgId = control.body.organization.id;
      const first = await live.alerts.raise(t.handle.db, { orgId, type: 'overspeed', severity: 'warning', title: 'Overspeeding: test', dedupeKey: key });
      const second = await live.alerts.raise(t.handle.db, { orgId, type: 'overspeed', severity: 'warning', title: 'Overspeeding: test', dedupeKey: key });
      expect(first.created).toBe(true);
      expect(second).toEqual({ id: first.id, created: false });
      const rows = await t.handle.db.select().from(notifications).where(eq(notifications.dedupeKey, `alert:${first.id}`));
      const recipients = rows.map((r) => r.userId).sort();
      expect(recipients).toEqual(expect.arrayContaining([control.body.user.id, dispatch.body.user.id, owner.body.user.id]));
      expect(recipients).not.toContain(hr.body.user.id);
      expect(new Set(recipients).size).toBe(recipients.length);
    });
  });

  describe('incidents and SOS', () => {
    it('opens an incident from an alert and walks the status workflow', async () => {
      const raised = await live.alerts.raise(t.handle.db, { orgId: control.body.organization.id, type: 'unexpected_stop', severity: 'warning', title: 'Unplanned stop: test', tripId: running[0]!.id, dedupeKey: `inc-test:${Date.now()}` });
      const created = await request(t.app)
        .post('/api/v1/incidents')
        .set(bearer(control.token))
        .send({ incidentType: 'breakdown', severity: 'medium', title: 'Clutch failure', tripId: running[0]!.id, alertId: raised.id });
      expect(created.status).toBe(201);
      const inc = created.body as IncidentDto;
      expect(inc.incidentNo).toMatch(/^INC-\d{4}-\d{6}$/);
      expect(inc.vehicle?.id).toBe(running[0]!.vehicle.id);
      const [linked] = await t.handle.db.select().from(safetyAlerts).where(eq(safetyAlerts.id, raised.id));
      expect(linked).toMatchObject({ incidentId: inc.id, status: 'acknowledged' });

      expect((await request(t.app).patch(`/api/v1/incidents/${inc.id}`).set(bearer(control.token)).send({ status: 'closed' })).status).toBe(422);
      expect((await request(t.app).patch(`/api/v1/incidents/${inc.id}`).set(bearer(control.token)).send({ status: 'resolved' })).status).toBe(400);
      const escalated = await request(t.app).patch(`/api/v1/incidents/${inc.id}`).set(bearer(control.token)).send({ status: 'escalated', note: 'Needs a replacement truck' });
      expect(escalated.body.status).toBe('escalated');
      const ownerNotes = await t.handle.db.select().from(notifications).where(and(eq(notifications.userId, owner.body.user.id), eq(notifications.entityId, inc.id)));
      expect(ownerNotes.some((n) => n.title.startsWith('Escalated'))).toBe(true);
      const resolved = await request(t.app).patch(`/api/v1/incidents/${inc.id}`).set(bearer(control.token)).send({ status: 'resolved', resolution: 'Replacement truck sent; load transferred' });
      expect(resolved.body).toMatchObject({ status: 'resolved', resolution: 'Replacement truck sent; load transferred' });
      expect(resolved.body.updates.map((u: { kind: string }) => u.kind)).toEqual(['status_change', 'escalation', 'created']);
      const stale = await request(t.app).patch(`/api/v1/incidents/${inc.id}`).set(bearer(control.token)).send({ status: 'closed', version: inc.version });
      expect(stale.status).toBe(409);
    });

    it('lets a driver raise SOS on their own trip only, and never claims emergency services were called', async () => {
      const mine = (await request(t.app).get('/api/v1/trips').query({ status: 'in_transit' }).set(bearer(driver.token))).body.data[0] as TripListItemDto;
      const sos = await request(t.app).post(`/api/v1/trips/${mine.id}/sos`).set(bearer(driver.token)).send({ note: 'Being followed by a car', lat: 12.9, lng: 79.1 });
      expect(sos.status).toBe(201);
      expect(sos.body.message).toMatch(/No emergency services were contacted/);
      expect(sos.body.incident).toMatchObject({ incidentType: 'sos', severity: 'critical', status: 'open' });
      const alerts = await alertsFor(control.token, { alertType: 'sos', status: 'open' });
      expect(alerts.some((a) => a.trip?.id === mine.id && a.severity === 'critical' && a.incidentId === sos.body.incident.id)).toBe(true);

      const other = running.find((r) => r.id !== mine.id)!;
      expect((await request(t.app).post(`/api/v1/trips/${other.id}/sos`).set(bearer(driver.token)).send({})).status).toBe(404);
      // Drivers can report incidents but cannot read the incident desk.
      expect((await request(t.app).get('/api/v1/incidents').set(bearer(driver.token))).status).toBe(403);
    });

    it('escalates critical notifications nobody acknowledged', async () => {
      const escalated = await live.notifications.escalate(minutes(15));
      expect(escalated).toBeGreaterThan(0);
      const forOwner = await request(t.app).get('/api/v1/notifications').query({ pageSize: 100 }).set(bearer(owner.token));
      expect(forOwner.body.data.some((n: { title: string }) => n.title.startsWith('Not acknowledged for 10+ min'))).toBe(true);
      expect(await live.notifications.escalate(minutes(16))).toBe(0);
    });
  });

  describe('check-ins', () => {
    it('schedules check-ins, flags a missed one and clears it when the driver checks in', async () => {
      const mine = (await request(t.app).get('/api/v1/trips').query({ status: 'in_transit' }).set(bearer(driver.token))).body.data[0] as TripListItemDto;
      await live.checkins.monitor(new Date());
      const [pending] = await t.handle.db.select().from(driverCheckins).where(and(eq(driverCheckins.tripId, mine.id), eq(driverCheckins.status, 'pending')));
      expect(pending).toBeDefined();

      await live.checkins.monitor(minutes(25, pending!.dueAt.getTime()));
      const missed = await request(t.app).get('/api/v1/checkins').query({ status: 'missed' }).set(bearer(control.token));
      expect(missed.body.data.some((c: { trip: { id: number } }) => c.trip.id === mine.id)).toBe(true);
      expect((await alertsFor(control.token, { alertType: 'missed_checkin', status: 'open', tripId: mine.id })).length).toBe(1);

      const ok = await request(t.app).post(`/api/v1/trips/${mine.id}/checkins`).set(bearer(driver.token)).send({ note: 'Stopped for tea' });
      expect(ok.status).toBe(201);
      expect(ok.body.status).toBe('ok');
      expect((await alertsFor(control.token, { alertType: 'missed_checkin', status: 'active', tripId: mine.id })).length).toBe(0);
      const [trip] = await t.handle.db.select().from(trips).where(eq(trips.id, mine.id));
      expect(trip!.status).toBe('in_transit');
    });
  });

  describe('notifications', () => {
    it('are private to their recipient', async () => {
      const list = await request(t.app).get('/api/v1/notifications').set(bearer(control.token));
      expect(list.body.unread).toBeGreaterThan(0);
      const n = list.body.data[0];
      expect((await request(t.app).post(`/api/v1/notifications/${n.id}/read`).set(bearer(dispatch.token))).status).toBe(404);
      const read = await request(t.app).post(`/api/v1/notifications/${n.id}/acknowledge`).set(bearer(control.token));
      expect(read.body.readAt).toBeTruthy();
      expect(read.body.acknowledgedAt).toBeTruthy();
      await request(t.app).post('/api/v1/notifications/read-all').set(bearer(control.token));
      expect((await request(t.app).get('/api/v1/notifications').set(bearer(control.token))).body.unread).toBe(0);
    });
  });

  describe('background jobs', () => {
    it('run a job in only one process at a time', async () => {
      let runs = 0;
      const job = { name: `test-job-${Date.now()}`, everyMs: 60_000, run: async () => void runs++ };
      const silent = pino({ level: 'silent' });
      const a = new JobRunner(t.handle.db, silent, [job]);
      const b = new JobRunner(t.handle.db, silent, [job]);
      Object.defineProperty(b, 'owner', { value: 'other-host:1' });
      expect(await a.tick(job)).toBe(true);
      expect(await b.tick(job)).toBe(false);
      expect(await a.tick(job)).toBe(true); // the holder renews its own lease
      expect(await b.tick(job, minutes(5))).toBe(true); // an expired lease is taken over
      expect(runs).toBe(3);
    });
  });

  describe('realtime channel', () => {
    let server: Server;
    let url: string;
    let realtime: ReturnType<typeof attachRealtime>;
    beforeAll(async () => {
      server = createServer();
      realtime = attachRealtime(server, { jwtSecret: process.env.JWT_ACCESS_SECRET!, origins: ['http://localhost:5173'], log: pino({ level: 'silent' }) });
      await new Promise<void>((r) => server.listen(0, r));
      url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    });
    afterAll(async () => {
      await realtime.io.close();
    });

    const client = (token?: string) => connect(url, { path: '/socket.io', transports: ['websocket'], auth: token ? { token } : {}, reconnection: false, forceNew: true });

    it('rejects sockets without a valid token', async () => {
      const s = client('not-a-token');
      const err = await new Promise<Error>((r) => s.on('connect_error', r));
      expect(err.message).toBe('unauthenticated');
      s.close();
    });

    it('delivers events only to users holding the permission, in the same organisation', async () => {
      const sockets = { control: client(control.token), hr: client(hr.token), other: client(otherOrg.token) };
      await Promise.all(Object.values(sockets).map((s) => new Promise((r) => s.on('connect', () => r(null)))));
      const got: Record<string, unknown[]> = { control: [], hr: [], other: [] };
      for (const [k, s] of Object.entries(sockets)) s.on('positions', (p: unknown) => got[k]!.push(p));
      realtime.toPermission(control.body.organization.id, 'tracking:read', 'positions', [{ vehicleId: 1 }]);
      await new Promise((r) => setTimeout(r, 300));
      expect(got.control).toHaveLength(1);
      expect(got.hr).toHaveLength(0); // HR cannot track vehicles
      expect(got.other).toHaveLength(0); // another organisation's owner
      for (const s of Object.values(sockets)) s.close();
    });
  });
});
