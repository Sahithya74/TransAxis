import { createHash, randomBytes } from 'node:crypto';

/** URL-safe random token (default 256 bits). Used for refresh and password-reset tokens. */
export const randomToken = (bytes = 32): string => randomBytes(bytes).toString('base64url');

/** Tokens are stored only as SHA-256 hashes, so a database leak does not expose live sessions. */
export const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex');
