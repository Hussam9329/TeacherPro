/**
 * Student app login: the typed phone must match the student's own phone or
 * the parent phone (bot normalization), AND the student code must match.
 * Callers never learn which half failed.
 */
import { findStudentsByPhone, normalizeIraqiPhone, phoneMatchRanks, type PhoneMatchClient, type StudentPhoneMatch } from "./phone-match.ts";

export type LoginInput = { phone: string; code: string };

export function normalizeStudentCode(code: string): string {
  return String(code ?? "").trim().toUpperCase();
}

export async function resolveLoginStudent(
  client: PhoneMatchClient,
  input: LoginInput,
): Promise<StudentPhoneMatch | null> {
  const code = normalizeStudentCode(input.code);
  const ranks = phoneMatchRanks(String(input.phone ?? ""));
  if (!code || ranks.size === 0) return null;
  const matches = await findStudentsByPhone(client, ranks);
  const byCode = matches.filter((s) => normalizeStudentCode(s.code) === code);
  return byCode.length === 1 ? byCode[0] : null;
}

export function clientIp(req: { headers: { get(name: string): string | null } }): string {
  const forwarded = req.headers.get("x-forwarded-for") || "";
  const first = forwarded.split(",")[0]?.trim();
  return first || "local";
}

export const LOGIN_FAILED_MESSAGE = "رقم الهاتف أو الرمز غير صحيح";
export const LOGIN_RATE_LIMITED_MESSAGE = "محاولات كثيرة. حاول بعد قليل.";

export type LoginRateLimit = { key: string; maxAttempts: number };

/** Five attempts per typed phone (any IP), and a roomier ceiling per IP because
 * Iraqi carriers put whole neighbourhoods behind one NAT address. */
export const PHONE_MAX_ATTEMPTS = 5;
export const IP_MAX_ATTEMPTS = 40;

export function phoneRateKey(phone: string): string {
  return `student-app:${normalizeIraqiPhone(String(phone ?? "")).slice(0, 20) || "none"}`;
}

export function loginRateLimits(phone: string, ip: string): LoginRateLimit[] {
  return [
    { key: phoneRateKey(phone), maxAttempts: PHONE_MAX_ATTEMPTS },
    { key: `student-app-ip:${ip}`, maxAttempts: IP_MAX_ATTEMPTS },
  ];
}
