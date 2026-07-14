import argon2 from "argon2";

// OWASP Password Storage Cheat Sheet minimums for argon2id:
// m >= 19 MiB (19456 KiB), t >= 2, p >= 1. Pinned so hashes stay
// deterministic across argon2 npm minor bumps.
const ARGON2_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
} as const;

export function hashPassword(plain: string): Promise<string> {
  return argon2.hash(plain, ARGON2_OPTIONS);
}

export function verifyPassword(hash: string, plain: string): Promise<boolean> {
  return argon2.verify(hash, plain);
}
