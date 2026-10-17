import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { BookingDto, CustomerDto, TripDto, VehicleDto, WorkerDto } from '@transaxis/shared';
import { bearer, createTestApp, hasDb, login, type TestApp } from './helpers.js';

const PNG = Buffer.from(
  '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d6a4d70000000049454e44ae426082',
  'hex',
);

describe.skipIf(!hasDb)('bookings and trip lifecycle (integration)', () => {
  let t: TestApp;
  let dispatch: string;
  let finance: string;
  let driver: string; // Murugan Selvam (driver@kaveri.demo)
  let otherOrg: string;
  let fleet: VehicleDto[];
  let people: WorkerDto[];
  let customersByCode: Map<string, CustomerDto>;

  const hoursFromNow = (h: number) => new Date(Date.now() + h * 3_600_000).toISOString();
  const vehicle = (pred: (v: VehicleDto) => boolean) => {
    const v = fleet.find(pred);
    if (!v) throw new Error('no matching vehicle in seed');
    return v;
  };
  const okVehicle = (bodyType: string, minKg = 0, exclude: number[] = []) =>
    vehicle((v) => v.vehicleType.bodyType === bodyType && v.status === 'available' && v.compliance.state === 'ok' && v.payloadCapacityKg >= minKg && !exclude.includes(v.id));
  const person = (name: string) => people.find((p) => p.fullName === name)!;

  async function approvedBooking(o: { code: string; weightKg: number; category?: string; inDays: number; requiresTemperatureControl?: boolean }): Promise<BookingDto> {
    const c = customersByCode.get(o.code)!;
    const created = await request(t.app)
      .post('/api/v1/bookings')
      .set(bearer(dispatch))
      .send({
        customerId: c.id,
        loadingWindowStart: hoursFromNow(o.inDays * 24),
        deliveryDeadline: hoursFromNow(o.inDays * 24 + 30),
        requiresTemperatureControl: o.requiresTemperatureControl ?? false,
        stops: [
          { stopType: 'pickup', name: 'Origin site', city: 'Chennai' },
          { stopType: 'drop', name: 'Destination site', city: 'Bengaluru', contactPhone: '+91 98000 11111' },
        ],
        cargo: [{ description: 'Test cargo', category: o.category ?? 'general', quantity: 10, unit: 'pallets', weightKg: o.weightKg }],
        charges: [{ chargeType: 'loading', amount: 1500 }],
      });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const quoted = await request(t.app).post(`/api/v1/bookings/${created.body.id}/quote`).set(bearer(dispatch)).send({ rateBasis: 'per_tonne', rate: 1450 });
    expect(quoted.status).toBe(200);
    const approved = await request(t.app).post(`/api/v1/bookings/${created.body.id}/actions`).set(bearer(dispatch)).send({ action: 'approve' });
    expect(approved.status).toBe(200);
    return approved.body;
  }

  const createTrip = (body: Record<string, unknown>, token = dispatch) => request(t.app).post('/api/v1/trips').set(bearer(token)).send(body);
  const window = (startH: number, durH = 10) => ({ plannedStart: hoursFromNow(startH), plannedEnd: hoursFromNow(startH + durH) });
  const codes = (res: request.Response) => [...(res.body.error?.details?.blocks ?? []), ...(res.body.error?.details?.warnings ?? [])].map((v: { code: string }) => v.code);

  beforeAll(async () => {
    t = createTestApp();
    [dispatch, finance, driver, otherOrg] = (
      await Promise.all(['dispatch@kaveri.demo', 'finance@kaveri.demo', 'driver@kaveri.demo', 'owner@sahyadri.demo'].map((e) => login(t.app, e)))
    ).map((s) => s.token) as [string, string, string, string];
    fleet = (await request(t.app).get('/api/v1/vehicles').query({ pageSize: 100 }).set(bearer(dispatch))).body.data;
    people = (await request(t.app).get('/api/v1/workers').query({ pageSize: 100 }).set(bearer(dispatch))).body.data;
    const cs = (await request(t.app).get('/api/v1/customers').query({ pageSize: 100 }).set(bearer(dispatch))).body.data as CustomerDto[];
    customersByCode = new Map(cs.map((c) => [c.code, c]));
  });
  afterAll(async () => {
    await t.close();
  });

  // ------------------------------------------------------------------ bookings

  describe('bookings', () => {
    it('derives route, weight and the hazardous flag from the payload', async () => {
      const c = customersByCode.get('SCH')!;
      const res = await request(t.app)
        .post('/api/v1/bookings')
        .set(bearer(dispatch))
        .send({
          customerId: c.id,
          isHazardous: false,
          loadingWindowStart: hoursFromNow(200),
          deliveryDeadline: hoursFromNow(230),
          stops: [
            { stopType: 'pickup', name: 'Plant', city: 'Chennai' },
            { stopType: 'via', name: 'Hub', city: 'Nellore' },
            { stopType: 'drop', name: 'Depot', city: 'Hyderabad' },
          ],
          cargo: [
            { description: 'Solvent drums', category: 'hazardous', quantity: 20, unit: 'drums', weightKg: 4000 },
            { description: 'Empty pallets', quantity: 10, unit: 'pallets', weightKg: 250.5 },
          ],
        });
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ status: 'draft', originCity: 'Chennai', destinationCity: 'Hyderabad', totalWeightKg: 4250.5, isHazardous: true });
      expect(res.body.bookingNo).toMatch(/^BKG-\d{4}-\d{6}$/);
      expect(res.body.availableActions).toEqual(expect.arrayContaining(['quote', 'cancel']));
    });

    it('quotes, voids the quote on edit, approves and then locks editing', async () => {
      const c = customersByCode.get('CCW')!;
      const payload = {
        customerId: c.id,
        loadingWindowStart: hoursFromNow(210),
        deliveryDeadline: hoursFromNow(240),
        stops: [
          { stopType: 'pickup', name: 'Ennore', city: 'Chennai' },
          { stopType: 'drop', name: 'Nelamangala', city: 'Bengaluru' },
        ],
        cargo: [{ description: 'Cement', quantity: 200, unit: 'bags', weightKg: 10000 }],
        charges: [{ chargeType: 'loading', amount: 1500 }],
      };
      const b = (await request(t.app).post('/api/v1/bookings').set(bearer(dispatch)).send(payload)).body as BookingDto;
      const quoted = await request(t.app).post(`/api/v1/bookings/${b.id}/quote`).set(bearer(dispatch)).send({ rateBasis: 'per_tonne', rate: 1450 });
      expect(quoted.body).toMatchObject({ status: 'quoted', quotedAmount: '16000.00' });

      const edited = await request(t.app).put(`/api/v1/bookings/${b.id}`).set(bearer(dispatch)).set('if-match', String(quoted.body.version)).send({ ...payload, customerRef: 'PO-2' });
      expect(edited.body).toMatchObject({ status: 'draft', quotedAmount: null, customerRef: 'PO-2' });

      const stale = await request(t.app).put(`/api/v1/bookings/${b.id}`).set(bearer(dispatch)).set('if-match', String(quoted.body.version)).send(payload);
      expect(stale.status).toBe(409);

      await request(t.app).post(`/api/v1/bookings/${b.id}/quote`).set(bearer(dispatch)).send({ rateBasis: 'per_trip', rate: 18000 });
      const approved = await request(t.app).post(`/api/v1/bookings/${b.id}/actions`).set(bearer(dispatch)).send({ action: 'approve', approvedAmount: 19000 });
      expect(approved.body).toMatchObject({ status: 'approved', approvedAmount: '19000.00', editable: false });
      expect((await request(t.app).put(`/api/v1/bookings/${b.id}`).set(bearer(dispatch)).send(payload)).status).toBe(422);
    });

    it('requires a reason to cancel and refuses invalid actions', async () => {
      const b = await approvedBooking({ code: 'PAF', weightKg: 5000, inDays: 12 });
      expect((await request(t.app).post(`/api/v1/bookings/${b.id}/actions`).set(bearer(dispatch)).send({ action: 'cancel' })).status).toBe(400);
      expect((await request(t.app).post(`/api/v1/bookings/${b.id}/actions`).set(bearer(dispatch)).send({ action: 'close' })).status).toBe(422);
      const cancelled = await request(t.app).post(`/api/v1/bookings/${b.id}/actions`).set(bearer(dispatch)).send({ action: 'cancel', reason: 'Customer withdrew' });
      expect(cancelled.body.status).toBe('cancelled');
    });

    it('issues unique booking numbers under concurrent creation', async () => {
      const c = customersByCode.get('CBV')!;
      const body = {
        customerId: c.id,
        loadingWindowStart: hoursFromNow(300),
        deliveryDeadline: hoursFromNow(320),
        stops: [
          { stopType: 'pickup', name: 'Ambattur plant', city: 'Chennai' },
          { stopType: 'drop', name: 'Thuvakudi godown', city: 'Tiruchirappalli' },
        ],
        cargo: [{ description: 'Water jars', quantity: 100, unit: 'jars', weightKg: 2100 }],
      };
      const results = await Promise.all(Array.from({ length: 8 }, () => request(t.app).post('/api/v1/bookings').set(bearer(dispatch)).send(body)));
      expect(results.map((r) => r.status)).toEqual(Array(8).fill(201));
      expect(new Set(results.map((r) => r.body.bookingNo)).size).toBe(8);
    });

    it('hides other organisations\' bookings', async () => {
      const mine = (await request(t.app).get('/api/v1/bookings').set(bearer(dispatch))).body.data[0];
      expect((await request(t.app).get(`/api/v1/bookings/${mine.id}`).set(bearer(otherOrg))).status).toBe(404);
    });

    it('filters by loading date in the organisation timezone, not UTC', async () => {
      // 02:00 IST on 10 March is 20:30 UTC on 9 March; it belongs to 10 March for an Indian operator.
      const created = await request(t.app)
        .post('/api/v1/bookings')
        .set(bearer(dispatch))
        .send({
          customerId: customersByCode.get('KGE')!.id,
          customerRef: 'TZ-EDGE',
          loadingWindowStart: '2027-03-10T02:00:00+05:30',
          deliveryDeadline: '2027-03-11T02:00:00+05:30',
          stops: [
            { stopType: 'pickup', name: 'Quarry', city: 'Hosur' },
            { stopType: 'drop', name: 'Yard', city: 'Chennai' },
          ],
          cargo: [{ description: 'Granite slabs', quantity: 12, unit: 'slabs', weightKg: 9000 }],
        });
      expect(created.status).toBe(201);
      const ids = async (day: string) =>
        (await request(t.app).get('/api/v1/bookings').query({ from: day, to: day, q: 'TZ-EDGE' }).set(bearer(dispatch))).body.data.map((b: BookingDto) => b.id);
      expect(await ids('2027-03-10')).toContain(created.body.id);
      expect(await ids('2027-03-09')).not.toContain(created.body.id);
    });
  });

  // ------------------------------------------------------------------ reference data

  // ------------------------------------------------------------------ assignment rules

  describe('assignment rules', () => {
    it('blocks cargo heavier than the vehicle payload', async () => {
      const b = await approvedBooking({ code: 'DST', weightKg: 20000, inDays: 15 });
      const small = vehicle((v) => v.vehicleType.name === '6-Wheeler 9T Open' && v.status === 'available' && v.compliance.state === 'ok');
      const res = await createTrip({ bookingId: b.id, vehicleId: small.id, driverId: person('Karthik Raja').id, ...window(15 * 24) });
      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('ASSIGNMENT_BLOCKED');
      expect(codes(res)).toContain('VEHICLE_OVER_CAPACITY');
    });

    it('blocks a driver whose licence class does not cover the vehicle, and an expired licence', async () => {
      const b = await approvedBooking({ code: 'CCW', weightKg: 9000, inDays: 16 });
      const trailer = okVehicle('trailer');
      const wrongClass = await createTrip({ bookingId: b.id, vehicleId: trailer.id, driverId: person('Karthik Raja').id, ...window(16 * 24) });
      expect(codes(wrongClass)).toContain('DRIVER_LICENCE_CLASS');
      const truck = okVehicle('open', 16000);
      const expired = await createTrip({ bookingId: b.id, vehicleId: truck.id, driverId: person('Ramesh Naidu').id, ...window(16 * 24) });
      expect(codes(expired)).toContain('DRIVER_LICENCE_EXPIRED');
    });

    it('blocks vehicles with expired compliance documents', async () => {
      const b = await approvedBooking({ code: 'CCW', weightKg: 3000, inDays: 17 });
      const lapsed = vehicle((v) => v.compliance.state === 'expired' && v.status === 'available');
      const res = await createTrip({ bookingId: b.id, vehicleId: lapsed.id, driverId: person('Karthik Raja').id, ...window(17 * 24) });
      expect(codes(res)).toContain('VEHICLE_DOC_EXPIRED');
    });

    it('requires a hazmat-trained driver and a reefer where needed', async () => {
      const haz = await approvedBooking({ code: 'SCH', weightKg: 6000, category: 'hazardous', inDays: 18 });
      const truck = okVehicle('open', 9000);
      const noHazmat = await createTrip({ bookingId: haz.id, vehicleId: truck.id, driverId: person('Karthik Raja').id, ...window(18 * 24) });
      expect(codes(noHazmat)).toContain('DRIVER_NO_HAZMAT');

      const cold = await approvedBooking({ code: 'NPD', weightKg: 3000, category: 'perishable', inDays: 18, requiresTemperatureControl: true });
      const notReefer = await createTrip({ bookingId: cold.id, vehicleId: truck.id, driverId: person('Senthil Nathan').id, ...window(18 * 24 + 30) });
      expect(codes(notReefer)).toContain('VEHICLE_NOT_REEFER');
    });

    it('blocks drivers on approved leave', async () => {
      const b = await approvedBooking({ code: 'CCW', weightKg: 3000, inDays: 0.5 });
      const res = await createTrip({ bookingId: b.id, vehicleId: okVehicle('open', 3000).id, driverId: person('Mohan Das').id, ...window(12) });
      expect(codes(res)).toContain('DRIVER_ON_LEAVE');
    });

    it('needs an override reason (and permission) for warnings', async () => {
      const b = await approvedBooking({ code: 'CCW', weightKg: 6000, inDays: 20 });
      const truck = okVehicle('open', 9000);
      const unverified = person('Mahesh Hegde');
      const body = { bookingId: b.id, vehicleId: truck.id, driverId: unverified.id, ...window(20 * 24) };
      const noReason = await createTrip(body);
      expect(noReason.status).toBe(422);
      expect(noReason.body.error.code).toBe('OVERRIDE_REQUIRED');
      expect(codes(noReason)).toContain('DRIVER_LICENCE_UNVERIFIED');

      const ok = await createTrip({ ...body, overrideReason: 'Licence sighted at the depot; online verification pending' });
      expect(ok.status).toBe(201);
      expect(ok.body).toMatchObject({ status: 'planned', overrideReason: expect.stringContaining('Licence sighted') });
      const booking = await request(t.app).get(`/api/v1/bookings/${b.id}`).set(bearer(dispatch));
      expect(booking.body.status).toBe('planned');
      expect(booking.body.lrNumber).toMatch(/^LR-/);
    });

    it('prevents double-booking a vehicle under concurrent requests', async () => {
      const [a, b] = await Promise.all([approvedBooking({ code: 'CCW', weightKg: 4000, inDays: 22 }), approvedBooking({ code: 'PAF', weightKg: 4000, inDays: 22 })]);
      const truck = okVehicle('open', 9000, []);
      const [r1, r2] = await Promise.all([
        createTrip({ bookingId: a.id, vehicleId: truck.id, driverId: person('Arunachalam K').id, ...window(22 * 24) }),
        createTrip({ bookingId: b.id, vehicleId: truck.id, driverId: person('Dinesh Reddy').id, ...window(22 * 24 + 2) }),
      ]);
      const statuses = [r1.status, r2.status].sort();
      expect(statuses).toEqual([201, 422]);
      const loser = r1.status === 422 ? r1 : r2;
      expect(codes(loser)).toContain('VEHICLE_CONFLICT');
    });

    it('ranks candidates with the reasons each one fails', async () => {
      const cold = await approvedBooking({ code: 'NPD', weightKg: 3000, category: 'perishable', inDays: 25, requiresTemperatureControl: true });
      const w = window(25 * 24);
      const res = await request(t.app).get('/api/v1/trips/candidates').query({ bookingId: cold.id, ...w }).set(bearer(dispatch));
      expect(res.status).toBe(200);
      expect(res.body.vehicles[0].blocks).toEqual([]);
      expect(fleet.find((v) => v.id === res.body.vehicles[0].id)!.vehicleType.bodyType).toBe('reefer');
      const open = res.body.vehicles.find((v: { id: number }) => fleet.find((f) => f.id === v.id)!.vehicleType.bodyType === 'open');
      expect(open.blocks.map((b: { code: string }) => b.code)).toContain('VEHICLE_NOT_REEFER');
      expect(res.body.drivers.find((d: { label: string }) => d.label === 'Ramesh Naidu').blocks.map((b: { code: string }) => b.code)).toContain('DRIVER_LICENCE_EXPIRED');
      expect((await request(t.app).get('/api/v1/trips/candidates').query({ bookingId: cold.id, ...w }).set(bearer(driver))).status).toBe(403);
    });
  });

  // ------------------------------------------------------------------ lifecycle

  describe('trip lifecycle', () => {
    let trip: TripDto;
    let truck: VehicleDto;

    it('plans a trip for the driver demo account', async () => {
      const b = await approvedBooking({ code: 'CCW', weightKg: 8000, inDays: 30 });
      truck = okVehicle('closed', 3000, []) ?? okVehicle('open', 9000);
      const container = fleet.find((v) => v.vehicleType.bodyType === 'container' && v.status === 'available' && v.compliance.state === 'ok')!;
      const res = await createTrip({ bookingId: b.id, vehicleId: container.id, driverId: person('Murugan Selvam').id, ...window(30 * 24) });
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      trip = res.body;
      truck = container;
      expect(trip.tripNo).toMatch(/^TRP-/);
      expect(trip.stops).toHaveLength(2);
      expect(trip.availableActions).toEqual(expect.arrayContaining(['hold', 'cancel']));
      expect((await request(t.app).get(`/api/v1/vehicles/${container.id}`).set(bearer(dispatch))).body.status).toBe('assigned');
    });

    it('refuses to dispatch before inspection, and inspections need every item and a seal for closed bodies', async () => {
      const early = await request(t.app).post(`/api/v1/trips/${trip.id}/actions`).set(bearer(dispatch)).send({ action: 'dispatch', odometer: 1 });
      expect(early.status).toBe(422);
      const partial = await request(t.app).post(`/api/v1/trips/${trip.id}/inspections`).set(bearer(driver)).send({ inspectionType: 'pre_trip', items: [{ key: 'tyres', result: 'pass' }] });
      expect(partial.status).toBe(400);
      const template = ['tyres', 'brakes', 'lights', 'horn', 'mirrors', 'fluids', 'fuel', 'documents', 'extinguisher', 'first_aid', 'load_secured', 'tracker'];
      const noSeal = await request(t.app)
        .post(`/api/v1/trips/${trip.id}/inspections`)
        .set(bearer(driver))
        .send({ inspectionType: 'pre_trip', items: template.map((key) => ({ key, result: 'pass' })) });
      expect(noSeal.status).toBe(400);
      const failed = await request(t.app)
        .post(`/api/v1/trips/${trip.id}/inspections`)
        .set(bearer(driver))
        .send({ inspectionType: 'pre_trip', items: template.map((key) => ({ key, result: key === 'brakes' ? 'fail' : 'pass' })), sealNumbers: ['TEST-SEAL-1'] });
      expect(failed.status).toBe(201);
      expect(failed.body.status).toBe('planned');
      const passed = await request(t.app)
        .post(`/api/v1/trips/${trip.id}/inspections`)
        .set(bearer(driver))
        .send({ inspectionType: 'pre_trip', items: template.map((key) => ({ key, result: 'pass' })) });
      expect(passed.body.status).toBe('ready');
      expect(passed.body.seals[0]).toMatchObject({ sealNo: 'TEST-SEAL-1', intact: null });
    });

    it('lets the assigned driver dispatch with an odometer reading and returns the OTP once', async () => {
      const low = await request(t.app).post(`/api/v1/trips/${trip.id}/actions`).set(bearer(driver)).send({ action: 'dispatch', odometer: 1 });
      expect(low.status).toBe(422);
      const odo = truck.odometerKm + 2;
      const res = await request(t.app).post(`/api/v1/trips/${trip.id}/actions`).set(bearer(driver)).send({ action: 'dispatch', odometer: odo });
      expect(res.status).toBe(200);
      expect(res.body.trip.status).toBe('in_transit');
      expect(res.body.otp.otp).toMatch(/^\d{6}$/);
      expect(res.body.otp.delivery.status).toBe('sent');
      expect(t.messenger.sent.at(-1)!.body).toContain(res.body.otp.otp);
      expect((await request(t.app).get(`/api/v1/trips/${trip.id}`).set(bearer(dispatch))).body).not.toHaveProperty('otp');
      // The trip cannot be cancelled once it has left.
      expect((await request(t.app).post(`/api/v1/trips/${trip.id}/actions`).set(bearer(dispatch)).send({ action: 'cancel', reason: 'Testing cancel' })).status).toBe(422);
      (trip as TripDto & { otp?: string }).otp = res.body.otp.otp;
    });

    it('counts wrong OTPs, demands the seal check and delivers with the right OTP', async () => {
      const wrong = await request(t.app).post(`/api/v1/trips/${trip.id}/pod`).set(bearer(driver)).send({ otp: '000000', recipientName: 'Stores', sealsIntact: true });
      expect(wrong.status).toBe(422);
      expect(wrong.body.error).toMatchObject({ code: 'OTP_INVALID', details: { attemptsLeft: 4 } });
      const otp = (trip as TripDto & { otp?: string }).otp!;
      const noSeal = await request(t.app).post(`/api/v1/trips/${trip.id}/pod`).set(bearer(driver)).send({ otp, recipientName: 'Stores' });
      expect(noSeal.status).toBe(400);
      const ok = await request(t.app).post(`/api/v1/trips/${trip.id}/pod`).set(bearer(driver)).send({ otp, recipientName: 'Stores manager', sealsIntact: true });
      expect(ok.status).toBe(200);
      expect(ok.body).toMatchObject({ status: 'delivered', podStatus: 'verified_otp', pod: { method: 'otp', recipientName: 'Stores manager' } });
      expect(ok.body.seals[0].intact).toBe(true);
      const booking = await request(t.app).get(`/api/v1/bookings/${trip.booking!.id}`).set(bearer(dispatch));
      expect(booking.body.status).toBe('delivered');
    });

    it('completes with a closing odometer, releasing the vehicle; finance reconciles and closes', async () => {
      const back = await request(t.app).post(`/api/v1/trips/${trip.id}/actions`).set(bearer(driver)).send({ action: 'complete', odometer: 1 });
      expect(back.status).toBe(422);
      const done = await request(t.app).post(`/api/v1/trips/${trip.id}/actions`).set(bearer(driver)).send({ action: 'complete', odometer: truck.odometerKm + 360 });
      expect(done.body.trip.status).toBe('completed');
      expect((await request(t.app).get(`/api/v1/vehicles/${truck.id}`).set(bearer(dispatch))).body).toMatchObject({ status: 'available', odometerKm: truck.odometerKm + 360 });
      expect((await request(t.app).post(`/api/v1/trips/${trip.id}/actions`).set(bearer(driver)).send({ action: 'reconcile' })).status).toBe(403);
      expect((await request(t.app).post(`/api/v1/trips/${trip.id}/actions`).set(bearer(finance)).send({ action: 'reconcile' })).body.trip.status).toBe('reconciled');
      const closed = await request(t.app).post(`/api/v1/trips/${trip.id}/actions`).set(bearer(finance)).send({ action: 'close' });
      expect(closed.body.trip.status).toBe('closed');
      expect(closed.body.trip.history.map((h: { toStatus: string }) => h.toStatus)).toEqual(['planned', 'planned', 'ready', 'in_transit', 'delivered', 'completed', 'reconciled', 'closed'].filter((s, i, a) => i === 0 || s !== a[i - 1]));
    });
  });

  describe('OTP lockout and override', () => {
    it('locks after 5 wrong OTPs; only dispatch can override, and only with a photo', async () => {
      // Use a seeded in-transit trip (its OTP is unknowable by design).
      const live = (await request(t.app).get('/api/v1/trips').query({ status: 'in_transit', pageSize: 50 }).set(bearer(dispatch))).body.data.find(
        (x: { driver: { fullName: string } }) => x.driver.fullName === 'Rajesh Kumar',
      );
      for (let i = 0; i < 5; i++) await request(t.app).post(`/api/v1/trips/${live.id}/pod`).set(bearer(dispatch)).send({ otp: '111111', recipientName: 'Gate security' });
      const locked = await request(t.app).post(`/api/v1/trips/${live.id}/pod`).set(bearer(dispatch)).send({ otp: '111111', recipientName: 'Gate security' });
      expect(locked.body.error.code).toBe('OTP_LOCKED');

      const reissued = await request(t.app).post(`/api/v1/trips/${live.id}/otp`).set(bearer(dispatch));
      expect(reissued.body.otp).toMatch(/^\d{6}$/);
      expect((await request(t.app).get(`/api/v1/trips/${live.id}`).set(bearer(dispatch))).body.otpAttemptsLeft).toBe(5);

      const noPhoto = await request(t.app).post(`/api/v1/trips/${live.id}/pod/override`).set(bearer(dispatch)).send({ recipientName: 'Plant gate', reason: 'Consignee phone switched off; verified by call to logistics manager' });
      expect(noPhoto.status).toBe(400);
      const photo = await request(t.app).post('/api/v1/files').set(bearer(dispatch)).field('category', 'trip_document').field('tripId', String(live.id)).attach('file', PNG, 'pod.png');
      expect(photo.status).toBe(201);
      expect((await request(t.app).post(`/api/v1/trips/${live.id}/pod/override`).set(bearer(driver)).send({ recipientName: 'Gate', reason: 'Driver trying to override', photoFileIds: [photo.body.id] })).status).toBe(403);
      const ok = await request(t.app)
        .post(`/api/v1/trips/${live.id}/pod/override`)
        .set(bearer(dispatch))
        .send({ recipientName: 'Plant gate', reason: 'Consignee phone switched off; verified by call to logistics manager', photoFileIds: [photo.body.id] });
      expect(ok.body).toMatchObject({ status: 'delivered', podStatus: 'override', pod: { method: 'override' } });
    });
  });

  describe('cancellation', () => {
    it('cancelling a planned trip frees the vehicle and returns the booking to the queue', async () => {
      const b = await approvedBooking({ code: 'PAF', weightKg: 3000, inDays: 35 });
      const truck = okVehicle('open', 9000);
      const created = (await createTrip({ bookingId: b.id, vehicleId: truck.id, driverId: person('Dinesh Reddy').id, ...window(35 * 24) })).body as TripDto;
      const cancelled = await request(t.app).post(`/api/v1/trips/${created.id}/actions`).set(bearer(dispatch)).send({ action: 'cancel', reason: 'Vehicle reallocated' });
      expect(cancelled.body.trip.status).toBe('cancelled');
      expect((await request(t.app).get(`/api/v1/bookings/${b.id}`).set(bearer(dispatch))).body.status).toBe('approved');
      // Same vehicle can now be planned in that window.
      const again = await createTrip({ bookingId: b.id, vehicleId: truck.id, driverId: person('Dinesh Reddy').id, ...window(35 * 24) });
      expect(again.status).toBe(201);
      // Cancelling the booking cascades to its planned trip.
      const bc = await request(t.app).post(`/api/v1/bookings/${b.id}/actions`).set(bearer(dispatch)).send({ action: 'cancel', reason: 'Order cancelled' });
      expect(bc.body.status).toBe('cancelled');
      expect((await request(t.app).get(`/api/v1/trips/${again.body.id}`).set(bearer(dispatch))).body.status).toBe('cancelled');
    });
  });

  describe('row scoping', () => {
    it('drivers see only their own trips', async () => {
      const mine = (await request(t.app).get('/api/v1/trips').query({ pageSize: 100 }).set(bearer(driver))).body.data as TripDto[];
      expect(mine.length).toBeGreaterThan(0);
      expect(mine.every((x) => x.driver.fullName === 'Murugan Selvam')).toBe(true);
      const someoneElse = (await request(t.app).get('/api/v1/trips').query({ status: 'in_transit' }).set(bearer(dispatch))).body.data.find(
        (x: TripDto) => x.driver.fullName !== 'Murugan Selvam',
      );
      expect((await request(t.app).get(`/api/v1/trips/${someoneElse.id}`).set(bearer(driver))).status).toBe(404);
      expect((await request(t.app).post(`/api/v1/trips/${someoneElse.id}/events`).set(bearer(driver)).send({ eventType: 'note', note: 'hi' })).status).toBe(404);
    });

    it('another organisation cannot see the trip', async () => {
      const any = (await request(t.app).get('/api/v1/trips').set(bearer(dispatch))).body.data[0];
      expect((await request(t.app).get(`/api/v1/trips/${any.id}`).set(bearer(otherOrg))).status).toBe(404);
    });

    it('records milestones on the driver\'s own running trip', async () => {
      const mine = (await request(t.app).get('/api/v1/trips').query({ status: 'in_transit' }).set(bearer(driver))).body.data[0] as TripDto;
      const res = await request(t.app).post(`/api/v1/trips/${mine.id}/events`).set(bearer(driver)).send({ eventType: 'delay_reported', note: 'Traffic at Krishnagiri toll' });
      expect(res.status).toBe(201);
      expect(res.body.events[0]).toMatchObject({ eventType: 'delay_reported', source: 'driver_app' });
    });
  });
});
