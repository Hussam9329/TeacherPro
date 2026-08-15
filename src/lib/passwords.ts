import {
  randomBytes,
  scrypt,
  timingSafeEqual,
  type ScryptOptions,
} from "node:crypto";

export const PASSWORD_HASH_PREFIX = "scrypt$1";

const SCRYPT_KEY_LENGTH = 64;
const SCRYPT_OPTIONS: ScryptOptions = { N: 16384, r: 8, p: 1 };

async function deriveScrypt(
  password: string,
  salt: Buffer,
  options: ScryptOptions = SCRYPT_OPTIONS,
): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    scrypt(password, salt, SCRYPT_KEY_LENGTH, options, (error, derivedKey) => {
      if (error) reject(error);
      else resolve(derivedKey as Buffer);
    });
  });
}

function encode(value: Buffer): string {
  return value.toString("base64url");
}

function decode(value: string): Buffer {
  return Buffer.from(value, "base64url");
}

function timingSafeStringEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  if (leftBuffer.length !== rightBuffer.length) return false;
  return timingSafeEqual(leftBuffer, rightBuffer);
}

export function isPasswordHash(value: unknown): value is string {
  return (
    typeof value === "string" && value.startsWith(`${PASSWORD_HASH_PREFIX}$`)
  );
}

export type PasswordPolicyResult =
  { ok: true } | { ok: false; message: string };

const COMMON_WEAK_PASSWORDS = new Set([
  "password",
  "password123",
  "12345678",
  "123456789",
  "qwerty123",
  "admin123",
  "adminadmin",
  "teacherpro",
  "11111111",
  "00000000",
]);

export function validatePasswordStrength(
  password: string,
  context: { username?: string; name?: string } = {},
): PasswordPolicyResult {
  const value = String(password || "");
  if (value.length < 12)
    return {
      ok: false,
      message: "رمز المرور يجب أن يتكون من 12 خانة على الأقل.",
    };
  if (value.length > 128)
    return { ok: false, message: "رمز المرور طويل جداً." };
  if (
    !/[A-Za-z]/.test(value) ||
    !/[0-9]/.test(value) ||
    !/[^A-Za-z0-9\s]/.test(value)
  ) {
    return {
      ok: false,
      message:
        "رمز المرور يجب أن يحتوي حروفاً وأرقاماً ورمزاً خاصاً واحداً على الأقل.",
    };
  }
  if (/\s/.test(value))
    return { ok: false, message: "رمز المرور لا يجوز أن يحتوي مسافات." };
  const lowered = value.toLowerCase();
  if (COMMON_WEAK_PASSWORDS.has(lowered) || /(.)\1{5,}/.test(value)) {
    return {
      ok: false,
      message: "رمز المرور ضعيف أو شائع جداً. اختر رمزاً مختلفاً.",
    };
  }
  for (const candidate of [context.username, context.name]) {
    const normalized = String(candidate || "")
      .trim()
      .toLowerCase();
    if (normalized.length >= 3 && lowered.includes(normalized)) {
      return {
        ok: false,
        message: "رمز المرور لا يجوز أن يحتوي اسم المستخدم أو الاسم الشخصي.",
      };
    }
  }
  return { ok: true };
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await deriveScrypt(password, salt);
  return `${PASSWORD_HASH_PREFIX}$${SCRYPT_OPTIONS.N}$${SCRYPT_OPTIONS.r}$${SCRYPT_OPTIONS.p}$${encode(salt)}$${encode(hash)}`;
}

export async function normalizePasswordForStorage(
  passwordOrHash: string,
): Promise<string> {
  return isPasswordHash(passwordOrHash)
    ? passwordOrHash
    : hashPassword(passwordOrHash);
}

export async function verifyPassword(
  password: string,
  storedPassword: string | null | undefined,
): Promise<boolean> {
  if (!storedPassword) return false;

  if (!isPasswordHash(storedPassword)) {
    return timingSafeStringEqual(password, storedPassword);
  }

  const parts = storedPassword.split("$");
  if (parts.length !== 7 || `${parts[0]}$${parts[1]}` !== PASSWORD_HASH_PREFIX)
    return false;

  const n = Number(parts[2]);
  const r = Number(parts[3]);
  const p = Number(parts[4]);
  if (!Number.isFinite(n) || !Number.isFinite(r) || !Number.isFinite(p))
    return false;

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
