import { hash, verify } from '@node-rs/argon2';

// Argon2id (the library default) with OWASP's recommended minimum: 19 MiB memory, 2 iterations.
const OPTIONS = { memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const;

export function hashPassword(plain: string): Promise<string> {
  return hash(plain, OPTIONS);
}

/** Returns false (never throws) for a wrong password or a malformed stored hash. */
export async function verifyPassword(storedHash: string, plain: string): Promise<boolean> {
  try {
    return await verify(storedHash, plain);
  } catch {
    return false;
  }
}
