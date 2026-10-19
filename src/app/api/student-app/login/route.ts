export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { checkLoginRateLimit } from "@/lib/login-rate-limit";
import { routeErrorResponse, validationError } from "@/lib/route-helpers";
import { signConfirmTicket } from "@/lib/student-app/auth";
import {
  LOGIN_FAILED_MESSAGE,
  LOGIN_RATE_LIMITED_MESSAGE,
  clientIp,
  loginRateLimits,
  phoneRateKey,
  resolveLoginStudent,
} from "@/lib/student-app/login";
import type { PhoneMatchClient } from "@/lib/student-app/phone-match";

/** Step 1 of login: phone + code → the student's name and a short-lived ticket. */
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const phone = String(body.phone ?? "").trim().slice(0, 40);
    const code = String(body.code ?? "").trim().slice(0, 40);
    if (!phone || !code) return validationError(LOGIN_FAILED_MESSAGE, 401);

    for (const { key, maxAttempts } of loginRateLimits(phone, clientIp(req))) {
      const limit = await checkLoginRateLimit(key, maxAttempts);
      if (!limit.allowed) {
        return NextResponse.json(
          { error: LOGIN_RATE_LIMITED_MESSAGE, retryAfterSeconds: limit.retryAfterSeconds },
          { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
        );
      }
    }

    const student = await resolveLoginStudent(db as unknown as PhoneMatchClient, { phone, code });
    if (!student) return validationError(LOGIN_FAILED_MESSAGE, 401);

    return NextResponse.json({ ok: true, name: student.name, ticket: signConfirmTicket({ studentId: student.id, rateKey: phoneRateKey(phone) }) });
  } catch (error) {
    return routeErrorResponse(error, "تعذر تسجيل الدخول حالياً. حاول مرة أخرى.");
  }
}
