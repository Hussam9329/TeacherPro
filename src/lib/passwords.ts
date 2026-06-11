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

function timingSafeStringEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  if (leftBuffer.length !== rightBuffer.length) return false;
  return timingSafeEqual(leftBuffer, rightBuffer);
}

export function isPasswordHash(value: unknown): value is string {
  return typeof value === 'string' && value.startsWith(`${PASSWORD_HASH_PREFIX}$`);
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await deriveScrypt(password, salt);
  return `${PASSWORD_HASH_PREFIX}$${SCRYPT_OPTIONS.N}$${SCRYPT_OPTIONS.r}$${SCRYPT_OPTIONS.p}$${encode(salt)}$${encode(hash)}`;
}

export async function normalizePasswordForStorage(passwordOrHash: string): Promise<string> {
  return isPasswordHash(passwordOrHash) ? passwordOrHash : hashPassword(passwordOrHash);
}

export async function verifyPassword(password: string, storedPassword: string | null | undefined): Promise<boolean> {
  if (!storedPassword) return false;

  if (!isPasswordHash(storedPassword)) {
    return timingSafeStringEqual(password, storedPassword);
  }

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
