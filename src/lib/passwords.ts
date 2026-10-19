import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from 'node:crypto';

export const PASSWORD_HASH_PREFIX = 'scrypt$1';

const SCRYPT_KEY_LENGTH = 64;
const SCRYPT_OPTIONS: ScryptOptions = { N: 16384, r: 8, p: 1 };

async function deriveScrypt(password: string, salt: Buffer, options: ScryptOptions = SCRYPT_OPTIONS): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    scrypt(password, salt, SCRYPT_KEY_LENGTH, options, (error, derivedKey) => {
      if (error) reject(error);
      else resolve(derivedKey as Buffer);
    });
  });
}

function encode(value: Buffer): string {
  return value.toString('base64url');
}

function decode(value: string): Buffer {
  return Buffer.from(value, 'base64url');
}

export function isPasswordHash(value: unknown): value is string {
  return typeof value === 'string' && value.startsWith(`${PASSWORD_HASH_PREFIX}$`);
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await deriveScrypt(password, salt);
  return `${PASSWORD_HASH_PREFIX}$${SCRYPT_OPTIONS.N}$${SCRYPT_OPTIONS.r}$${SCRYPT_OPTIONS.p}$${encode(salt)}$${encode(hash)}`;
}

/**
 * What is stored for a code typed by a person: always a fresh hash. A value
 * that already looks like a hash is hashed too, so nobody can plant a hash
 * (and its parameters) of their own choosing.
 */
export async function normalizePasswordForStorage(password: string): Promise<string> {
  return hashPassword(password);
}

export async function verifyPassword(password: string, storedPassword: string | null | undefined): Promise<boolean> {
  if (!storedPassword) return false;

  // Plain-text codes are converted to hashes before any login is checked
  // (upgradePlaintextPasswords); one is never compared as text.
  if (!isPasswordHash(storedPassword)) return false;

  const parts = storedPassword.split('$');
  if (parts.length !== 7 || `${parts[0]}$${parts[1]}` !== PASSWORD_HASH_PREFIX) return false;

  const n = Number(parts[2]);
  const r = Number(parts[3]);
  const p = Number(parts[4]);
  if (!Number.isFinite(n) || !Number.isFinite(r) || !Number.isFinite(p)) return false;

  try {
    const salt = decode(parts[5]);
    const expectedHash = decode(parts[6]);
    const actualHash = await deriveScrypt(password, salt, { N: n, r, p });
    if (actualHash.length !== expectedHash.length) return false;
    return timingSafeEqual(actualHash, expectedHash);
  } catch {
    return false;
  }
}
