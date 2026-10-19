export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { routeErrorResponse } from "@/lib/route-helpers";
import { hashDeviceToken, readBearerToken } from "@/lib/student-app/auth";

/** Revokes this device. Unknown or already revoked tokens still answer ok. */
export async function POST(req: NextRequest) {
  try {
    const token = readBearerToken(req);
    if (token) {
      await db.studentDevice.updateMany({
        where: { tokenHash: hashDeviceToken(token), revokedAt: null },
        data: { revokedAt: new Date() },
      });
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    return routeErrorResponse(error, "تعذر تسجيل الخروج حالياً.");
  }
}
