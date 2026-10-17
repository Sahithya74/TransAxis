import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes, timingSafeEqual } from 'node:crypto';

/** Time-based one-time passwords (RFC 6238: HMAC-SHA1, 30-second steps, 6 digits), as authenticator apps use. */

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const STEP_SECONDS = 30;

export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(text: string): Buffer {
  const clean = text.toUpperCase().replace(/[\s=]/g, '');
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const idx = ALPHABET.indexOf(ch);
    if (idx < 0) throw new Error('Invalid base32 secret');
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** A new 160-bit secret, base32-encoded for authenticator apps. */
export const newTotpSecret = () => base32Encode(randomBytes(20));

export function hotp(key: Buffer, counter: number, digits = 6): string {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const mac = createHmac('sha1', key).update(msg).digest();
  const offset = mac[mac.length - 1]! & 0xf;
  const code = (mac.readUInt32BE(offset) & 0x7fffffff) % 10 ** digits;
  return String(code).padStart(digits, '0');
}

export const totpStep = (at = Date.now()) => Math.floor(at / 1000 / STEP_SECONDS);

export function totpCode(secret: string, at = Date.now()): string {
  return hotp(base32Decode(secret), totpStep(at));
}

/**
 * Checks a code against the current step and one step either side (phone clocks drift). Returns the step
 * that matched, so the caller can refuse a code that has already been used, or null.
 */
export function verifyTotp(secret: string, code: string, at = Date.now(), window = 1): number | null {
  if (!/^\d{6}$/.test(code)) return null;
  const key = base32Decode(secret);
  const now = totpStep(at);
  for (let d = -window; d <= window; d++) {
    const expected = hotp(key, now + d);
    if (timingSafeEqual(Buffer.from(expected), Buffer.from(code))) return now + d;
  }
  return null;
}

export function otpauthUrl(secret: string, account: string, issuer = 'TransAxis'): string {
  const label = `${encodeURIComponent(issuer)}:${encodeURIComponent(account)}`;
  return `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=${STEP_SECONDS}`;
}

/**
 * Encrypts TOTP secrets at rest (AES-256-GCM). The key is derived from a server secret with HKDF, so a
 * database dump alone doesn't reveal anyone's second factor.
 */
export class SecretBox {
  private readonly key: Buffer;

  constructor(masterSecret: string) {
    this.key = Buffer.from(hkdfSync('sha256', masterSecret, 'transaxis', 'totp-secret-v1', 32));
  }

  seal(plain: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    return ['v1', iv.toString('base64url'), enc.toString('base64url'), cipher.getAuthTag().toString('base64url')].join('.');
  }

  open(sealed: string): string {
    const [version, iv, enc, tag] = sealed.split('.');
    if (version !== 'v1' || !iv || !enc || !tag) throw new Error('Unrecognised sealed secret');
    const decipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(iv, 'base64url'));
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(enc, 'base64url')), decipher.final()]).toString('utf8');
  }
}
