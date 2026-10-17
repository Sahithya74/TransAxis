import { describe, expect, it } from 'vitest';
import { fmtDateTime, fmtMoney, fmtMoneyCompact, fmtRelative, fromLocalInput, inrInWords, toLocalInput } from './format';

describe('org-timezone datetime inputs', () => {
  it('shows a UTC instant as IST wall-clock time and converts back exactly', () => {
    const iso = '2026-10-15T03:30:00.000Z'; // 09:00 IST
    expect(toLocalInput(iso, 'Asia/Kolkata')).toBe('2026-10-15T09:00');
    expect(fromLocalInput('2026-10-15T09:00', 'Asia/Kolkata')).toBe(iso);
  });

  it('handles the IST day boundary', () => {
    expect(toLocalInput('2026-10-15T20:00:00.000Z', 'Asia/Kolkata')).toBe('2026-10-16T01:30');
    expect(fromLocalInput('2026-10-16T01:30', 'Asia/Kolkata')).toBe('2026-10-15T20:00:00.000Z');
  });

  it('works for timezones with DST', () => {
    const iso = '2026-07-01T12:00:00.000Z';
    expect(fromLocalInput(toLocalInput(iso, 'Europe/London'), 'Europe/London')).toBe(iso);
  });

  it('treats empty input as empty', () => {
    expect(toLocalInput(null)).toBe('');
    expect(fromLocalInput('')).toBe('');
  });
});

describe('formatting', () => {
  it('formats rupees in the Indian grouping', () => {
    expect(fmtMoney('2300000.00')).toBe('₹23,00,000');
    expect(fmtMoney(null)).toBe('—');
  });

  it('formats datetimes in IST regardless of the browser timezone', () => {
    expect(fmtDateTime('2026-10-15T03:30:00.000Z', 'Asia/Kolkata')).toContain('09:00');
  });

  it('describes relative times', () => {
    const now = Date.parse('2026-10-15T00:00:00Z');
    expect(fmtRelative('2026-10-15T03:00:00Z', now)).toBe('in 3 h');
    expect(fmtRelative('2026-10-13T00:00:00Z', now)).toBe('2 d ago');
  });
});

describe('invoice amounts', () => {
  it('spells rupees and paise the Indian way', () => {
    expect(inrInWords('123456.70')).toBe('Rupees One Lakh Twenty Three Thousand Four Hundred Fifty Six and Seventy Paise Only');
    expect(inrInWords(10_500_000)).toBe('Rupees One Crore Five Lakh Only');
    expect(inrInWords('0.05')).toBe('Rupees Zero and Five Paise Only');
    expect(inrInWords(1000)).toBe('Rupees One Thousand Only');
  });

  it('abbreviates large amounts in lakh and crore', () => {
    expect(fmtMoneyCompact(1_234_567)).toBe('₹12.3L');
    expect(fmtMoneyCompact(98_765_432)).toBe('₹9.9Cr');
    expect(fmtMoneyCompact(null)).toBe('—');
  });
});
