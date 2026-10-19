/**
 * Device-token authentication for the student mobile app. A device holds a
 * random bearer token; TeacherPro stores only its sha256 and can revoke it.
 * Login confirmation uses a short-lived HMAC ticket so no device row exists
 * until the student has said "yes, that is me".
 */
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const SESSION_REVOKED_CODE = "SESSION_REVOKED";
const SESSION_REVOKED_MESSAGE = "انتهت الجلسة. سجّل الدخول مرة أخرى.";
const LAST_SEEN_TOUCH_MS = 10 * 60 * 1000;
const CONFIRM_TICKET_TTL_MS = 5 * 60 * 1000;

type HeaderReader = { headers: { get(name: string): string | null } };

export type StudentDeviceRow = {
  id: string;
  studentId: string;
  tokenHash: string;
  deviceName: string;
  platform: string;
  createdAt: Date;
  lastSeenAt: Date;
  revokedAt: Date | null;
  pushToken: string | null;
};

export type StudentDeviceClient<TStudent> = {
  studentDevice: {
    findUnique(args: {
      where: { tokenHash: string };
      include: { student: true };
    }): Promise<(StudentDeviceRow & { student: TStudent }) | null>;
    update(args: { where: { id: string }; data: { lastSeenAt: Date } }): Promise<unknown>;
  };
};

export function hashDeviceToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function generateDeviceToken(): { token: string; tokenHash: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, tokenHash: hashDeviceToken(token) };
}

export function readBearerToken(req: HeaderReader): string {
  const auth = req.headers.get("authorization") || "";
  return auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";
}

/** A plain Web `Response`, so this module stays importable outside Next (tests). */
export function sessionRevokedResponse(): Response {
  return Response.json(
    { error: SESSION_REVOKED_MESSAGE, code: SESSION_REVOKED_CODE },
    { status: 401 },
  );
}

export async function requireStudentDevice<TStudent>(
  req: HeaderReader,
  client: StudentDeviceClient<TStudent>,
): Promise<{ student: TStudent; device: StudentDeviceRow } | Response> {
  const token = readBearerToken(req);
  if (!token) return sessionRevokedResponse();
  const row = await client.studentDevice.findUnique({
    where: { tokenHash: hashDeviceToken(token) },
    include: { student: true },
  });
  if (!row || row.revokedAt) return sessionRevokedResponse();
  const { student, ...device } = row;
  if (Date.now() - device.lastSeenAt.getTime() > LAST_SEEN_TOUCH_MS) {
    await client.studentDevice.update({ where: { id: device.id }, data: { lastSeenAt: new Date() } });
  }
  return { student, device };
}

/** Same precedence and dev fallback as staff sessions (src/lib/server-auth.ts). */
function ticketSecret(): string {
  const env = process.env;
  const secret = (env.TEACHERPRO_AUTH_SECRET || env.AUTH_SECRET || env.NEXTAUTH_SECRET || "").trim();
  if (secret) return secret;
  if (env.NODE_ENV === "production") throw new Error("TEACHERPRO_AUTH_SECRET مطلوب في بيئة الإنتاج لتوقيع جلسات الدخول.");
  return "teacherpro-local-dev-secret";
}

function sign(payload: string): string {
  return createHmac("sha256", ticketSecret()).update(payload).digest("base64url");
}

export function signConfirmTicket(payload: { studentId: string; rateKey?: string | null; exp?: number }): string {
  const body = Buffer.from(
    JSON.stringify({
      studentId: payload.studentId,
      rateKey: payload.rateKey ?? null,
      exp: payload.exp ?? Date.now() + CONFIRM_TICKET_TTL_MS,
    }),
  ).toString("base64url");
  return `${body}.${sign(body)}`;
}

export function verifyConfirmTicket(ticket: string): { studentId: string; rateKey: string | null } | null {
  const [body, signature, ...rest] = String(ticket ?? "").split(".");
  if (!body || !signature || rest.length) return null;
  const expected = sign(body);
  if (expected.length !== signature.length || !timingSafeEqual(Buffer.from(expected), Buffer.from(signature))) {
    return null;
  }
  try {
    const parsed = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as { studentId?: unknown; rateKey?: unknown; exp?: unknown };
    if (typeof parsed.studentId !== "string" || typeof parsed.exp !== "number" || parsed.exp < Date.now()) return null;
    return { studentId: parsed.studentId, rateKey: typeof parsed.rateKey === "string" ? parsed.rateKey : null };
  } catch {
    return null;
  }
}
