import { describe, expect, it } from 'vitest';
import { addDays, startOfDayIn, summariseCompliance, todayIn, tzOffsetMinutes } from './compliance.js';
import {
  normaliseRegistration,
  vehicleCreateSchema,
  vehicleDocumentInputSchema,
  vehicleUpdateSchema,
} from '../schemas/vehicles.js';

const allValid = (expiresOn: string | null) =>
  (['registration', 'insurance', 'fitness', 'permit', 'pollution'] as const).map((docType) => ({ docType, expiresOn }));

describe('summariseCompliance', () => {
  it('is ok when every mandatory document is valid beyond the warning window', () => {
    const s = summariseCompliance(allValid('2027-01-01'), '2026-10-15');
    expect(s.state).toBe('ok');
    expect(s.nextExpiry).toBe('2027-01-01');
  });

  it('flags a document that expired yesterday', () => {
    const docs = allValid('2027-01-01').map((d) => (d.docType === 'insurance' ? { ...d, expiresOn: '2026-10-14' } : d));
    const s = summariseCompliance(docs, '2026-10-15');
    expect(s.state).toBe('expired');
    expect(s.expired).toEqual(['insurance']);
  });

  it('treats a document expiring today as still valid but expiring', () => {
    const docs = allValid('2027-01-01').map((d) => (d.docType === 'pollution' ? { ...d, expiresOn: '2026-10-15' } : d));
    const s = summariseCompliance(docs, '2026-10-15');
    expect(s.state).toBe('expiring');
    expect(s.expiringSoon).toEqual(['pollution']);
  });

  it('reports missing mandatory documents', () => {
    const s = summariseCompliance([{ docType: 'insurance', expiresOn: '2027-01-01' }], '2026-10-15');
    expect(s.state).toBe('missing');
    expect(s.missing).toEqual(['registration', 'fitness', 'permit', 'pollution']);
  });

  it('uses the latest renewal when several documents of a type exist', () => {
    const docs = [
      ...allValid('2027-06-01').filter((d) => d.docType !== 'fitness'),
      { docType: 'fitness' as const, expiresOn: '2026-01-01' },
      { docType: 'fitness' as const, expiresOn: '2027-03-01' },
    ];
    expect(summariseCompliance(docs, '2026-10-15').state).toBe('ok');
  });

  it('treats a document without expiry as valid', () => {
    expect(summariseCompliance(allValid(null), '2026-10-15')).toMatchObject({ state: 'ok', nextExpiry: null });
  });

  it('expired wins over missing and expiring', () => {
    const s = summariseCompliance(
      [
        { docType: 'insurance', expiresOn: '2026-01-01' },
        { docType: 'fitness', expiresOn: '2026-10-20' },
      ],
      '2026-10-15',
    );
    expect(s.state).toBe('expired');
  });
});

describe('date helpers', () => {
  it('adds days across month and leap-year boundaries', () => {
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
  });

  it('computes the local date in Asia/Kolkata', () => {
    // 20:00 UTC on 15 Oct is 01:30 on 16 Oct in India.
    expect(todayIn('Asia/Kolkata', new Date('2026-10-15T20:00:00Z'))).toBe('2026-10-16');
  });
});

describe('vehicle schemas', () => {
  it('normalises registration numbers', () => {
    expect(normaliseRegistration('tn-01 ab 1234')).toBe('TN01AB1234');
    const parsed = vehicleCreateSchema.parse({ registrationNo: 'ka 05 ef 2201', vehicleTypeId: 1, payloadCapacityKg: '9000' });
    expect(parsed.registrationNo).toBe('KA05EF2201');
    expect(parsed.payloadCapacityKg).toBe(9000);
    expect(parsed.ownership).toBe('owned');
  });

  it('does not inject create defaults into a partial update', () => {
    expect(vehicleUpdateSchema.parse({ status: 'under_maintenance' })).toEqual({ status: 'under_maintenance' });
    expect(vehicleUpdateSchema.safeParse({}).success).toBe(false);
  });

  it('rejects zero or negative capacity', () => {
    expect(vehicleCreateSchema.safeParse({ registrationNo: 'TN01AB1234', vehicleTypeId: 1, payloadCapacityKg: 0 }).success).toBe(false);
  });

  it('rejects an expiry before the issue date and impossible dates', () => {
    expect(vehicleDocumentInputSchema.safeParse({ docType: 'insurance', issuedOn: '2026-05-01', expiresOn: '2026-04-30' }).success).toBe(false);
    expect(vehicleDocumentInputSchema.safeParse({ docType: 'insurance', expiresOn: '2026-02-30' }).success).toBe(false);
  });
});

describe('day boundaries in an organisation timezone', () => {
  it('starts an IST day at 18:30 UTC the evening before', () => {
    expect(tzOffsetMinutes('Asia/Kolkata', new Date('2026-10-15T12:00:00Z'))).toBe(330);
    expect(startOfDayIn('2026-10-16', 'Asia/Kolkata').toISOString()).toBe('2026-10-15T18:30:00.000Z');
  });

  it('follows daylight saving time', () => {
    expect(startOfDayIn('2026-07-01', 'Europe/London').toISOString()).toBe('2026-06-30T23:00:00.000Z');
    expect(startOfDayIn('2026-12-01', 'Europe/London').toISOString()).toBe('2026-12-01T00:00:00.000Z');
    // The day DST starts in New York still begins at local midnight (05:00 UTC, before the 2 a.m. change).
    expect(startOfDayIn('2026-03-08', 'America/New_York').toISOString()).toBe('2026-03-08T05:00:00.000Z');
  });
});
