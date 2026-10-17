import { describe, expect, it } from 'vitest';
import { base32Decode, base32Encode, hotp, newTotpSecret, otpauthUrl, SecretBox, totpCode, totpStep, verifyTotp } from './totp.js';

// The shared secret used by the test vectors in RFC 4226 (appendix D) and RFC 6238 (appendix B).
const RFC_KEY = Buffer.from('12345678901234567890');
const RFC_SECRET = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';

describe('base32', () => {
  it('encodes the RFC secret the way authenticator apps expect', () => {
    expect(base32Encode(RFC_KEY)).toBe(RFC_SECRET);
    expect(base32Decode(RFC_SECRET).equals(RFC_KEY)).toBe(true);
  });

  it('ignores case, spaces and padding, and rejects other characters', () => {
    expect(base32Decode('gezd gnbv gy3t qojq gezd gnbv gy3t qojq====').equals(RFC_KEY)).toBe(true);
    expect(() => base32Decode('GEZD1')).toThrow(/base32/);
  });

  it('round-trips random secrets of 160 bits', () => {
    const secret = newTotpSecret();
    expect(secret).toMatch(/^[A-Z2-7]{32}$/);
    expect(base32Decode(secret)).toHaveLength(20);
  });
});

describe('HOTP (RFC 4226)', () => {
  it('matches the published values for counters 0-9', () => {
    const expected = ['755224', '287082', '359152', '969429', '338314', '254676', '287922', '162583', '399871', '520489'];
    expect(expected.map((_, counter) => hotp(RFC_KEY, counter))).toEqual(expected);
  });
});

describe('TOTP (RFC 6238, SHA-1)', () => {
  it.each([
    [59, '94287082'],
    [1111111109, '07081804'],
    [1111111111, '14050471'],
    [1234567890, '89005924'],
    [2000000000, '69279037'],
    [20000000000, '65353130'],
  ])('at %i seconds the 8-digit code is %s', (seconds, code) => {
    expect(hotp(RFC_KEY, totpStep(seconds * 1000), 8)).toBe(code);
  });

  it('gives 6-digit codes that are the low digits of the same value', () => {
    expect(totpCode(RFC_SECRET, 59_000)).toBe('287082');
  });

  it('accepts one step of clock drift either way and says which step matched', () => {
    const at = 1_700_000_000_000;
    const step = totpStep(at);
    expect(verifyTotp(RFC_SECRET, totpCode(RFC_SECRET, at), at)).toBe(step);
    expect(verifyTotp(RFC_SECRET, totpCode(RFC_SECRET, at - 30_000), at)).toBe(step - 1);
    expect(verifyTotp(RFC_SECRET, totpCode(RFC_SECRET, at + 30_000), at)).toBe(step + 1);
  });

  it('rejects codes two steps away, malformed codes and wrong codes', () => {
    const at = 1_700_000_000_000;
    expect(verifyTotp(RFC_SECRET, totpCode(RFC_SECRET, at - 60_000), at)).toBeNull();
    expect(verifyTotp(RFC_SECRET, totpCode(RFC_SECRET, at + 60_000), at)).toBeNull();
    expect(verifyTotp(RFC_SECRET, '12345', at)).toBeNull();
    expect(verifyTotp(RFC_SECRET, '12345a', at)).toBeNull();
    const right = totpCode(RFC_SECRET, at);
    const wrong = String((Number(right) + 1) % 1_000_000).padStart(6, '0');
    expect(verifyTotp(RFC_SECRET, wrong, at)).toBeNull();
  });

  it('builds an otpauth:// link with the issuer and account', () => {
    const url = new URL(otpauthUrl(RFC_SECRET, 'owner@kaveri.demo'));
    expect(url.protocol).toBe('otpauth:');
    // otpauth://totp/<label>: URL parsing puts the OTP type in the host position.
    expect(url.host).toBe('totp');
    expect(decodeURIComponent(url.pathname)).toBe('/TransAxis:owner@kaveri.demo');
    expect(url.searchParams.get('secret')).toBe(RFC_SECRET);
    expect(url.searchParams.get('issuer')).toBe('TransAxis');
    expect(url.searchParams.get('period')).toBe('30');
  });
});

describe('SecretBox', () => {
  const box = new SecretBox('a-master-secret-that-is-long-enough-1234');

  it('seals with a fresh IV each time and opens again', () => {
    const a = box.seal(RFC_SECRET);
    const b = box.seal(RFC_SECRET);
    expect(a).not.toBe(b);
    expect(a.startsWith('v1.')).toBe(true);
    expect(a).not.toContain(RFC_SECRET);
    expect(box.open(a)).toBe(RFC_SECRET);
  });

  it('refuses tampered ciphertext and a different key', () => {
    const sealed = box.seal(RFC_SECRET);
    const [v, iv, enc, tag] = sealed.split('.');
    const flipped = Buffer.from(enc!, 'base64url');
    flipped[0] = flipped[0]! ^ 1;
    expect(() => box.open([v, iv, flipped.toString('base64url'), tag].join('.'))).toThrow();
    expect(() => new SecretBox('another-master-secret-that-is-long-5678').open(sealed)).toThrow();
    expect(() => box.open('v0.a.b.c')).toThrow(/Unrecognised/);
  });
});
