export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { clearLoginFailures } from "@/lib/login-rate-limit";
import { routeErrorResponse, validationError } from "@/lib/route-helpers";
import { generateDeviceToken, verifyConfirmTicket } from "@/lib/student-app/auth";
import { clientIp } from "@/lib/student-app/login";

const CONFIRM_FAILED_MESSAGE = "انتهت مهلة التأكيد. أعد تسجيل الدخول.";

/** Step 2 of login: the student confirmed "this is me" → create the device token. */
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const ticket = verifyConfirmTicket(String(body.ticket ?? ""));
    if (!ticket) return validationError(CONFIRM_FAILED_MESSAGE, 401);

    const student = await db.student.findUnique({
      where: { id: ticket.studentId },
      select: { id: true, name: true },
    });
    if (!student) return validationError(CONFIRM_FAILED_MESSAGE, 401);

    const { token, tokenHash } = generateDeviceToken();
    await db.studentDevice.create({
      data: {
        studentId: student.id,
        tokenHash,
        deviceName: String(body.deviceName ?? "").trim().slice(0, 80),
        platform: String(body.platform ?? "").trim().slice(0, 20),
      },
    });
    for (const key of [ticket.rateKey, `student-app-ip:${clientIp(req)}`]) {
      if (key) await clearLoginFailures(key);
    }
    return NextResponse.json({ ok: true, token, student: { id: student.id, name: student.name } });
  } catch (error) {
    return routeErrorResponse(error, "تعذر إكمال تسجيل الدخول حالياً. حاول مرة أخرى.");
  }
}
