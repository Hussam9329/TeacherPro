export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import type { Student } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { routeErrorResponse, validationError } from "@/lib/route-helpers";
import { requireStudentDevice } from "@/lib/student-app/auth";

const MAX_TOKEN_LENGTH = 4096;

/**
 * The app reports its native push token (APNs on iOS, FCM on Android) after
 * the student allowed notifications. `null` clears it. A native token belongs
 * to one installation: an older device row still holding it (a reinstall
 * made a new sign-in) loses it, so nobody is pushed twice.
 */
export async function POST(req: NextRequest) {
  try {
    const session = await requireStudentDevice<Student>(req, db);
    if (session instanceof Response) return session;
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    if (!("pushToken" in body)) return validationError("رمز الإشعارات مطلوب.");
    const raw = body.pushToken;
    if (raw !== null && typeof raw !== "string") return validationError("رمز الإشعارات غير صالح.");
    const pushToken = raw === null ? null : raw.trim();
    if (pushToken !== null && (!pushToken || pushToken.length > MAX_TOKEN_LENGTH)) {
      return validationError("رمز الإشعارات غير صالح.");
    }
    if (pushToken) {
      await db.studentDevice.updateMany({
        where: { pushToken, id: { not: session.device.id } },
        data: { pushToken: null },
      });
    }
    if (session.device.pushToken !== pushToken) {
      await db.studentDevice.update({ where: { id: session.device.id }, data: { pushToken } });
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    return routeErrorResponse(error, "تعذر حفظ رمز الإشعارات حالياً.");
  }
}
