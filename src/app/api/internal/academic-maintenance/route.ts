export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

import { db } from "@/lib/db";
import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { routeErrorResponse } from "@/lib/route-helpers";
import { settleDueScheduledExamActivations } from "@/lib/scheduled-exam-activation-server";

function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return (
    leftBuffer.length === rightBuffer.length &&
    timingSafeEqual(leftBuffer, rightBuffer)
  );
}

function isAuthorizedCron(req: NextRequest): boolean {
  const secret = String(process.env.CRON_SECRET || "").trim();
  const authorization = String(req.headers.get("authorization") || "").trim();
  if (!secret || !authorization.startsWith("Bearer ")) return false;
  return safeEqual(authorization.slice("Bearer ".length), secret);
}

/**
 * Daily academic maintenance for the time-driven transition that cannot rely
 * on a user write request: scheduled exam activation. Grace periods need no
 * nightly work; they are evaluated from exam dates at read time.
 */
export async function GET(req: NextRequest) {
  if (!isAuthorizedCron(req)) {
    return NextResponse.json(
      { error: "غير مصرح بتشغيل الصيانة الأكاديمية المجدولة." },
      { status: 401 },
    );
  }

  try {
    await db.loginRateBucket.deleteMany({ where: { expiresAt: { lt: new Date() } } });
    const scheduledActivation = {
      scanned: 0,
      activated: 0,
      recalculatedStudents: 0,
      examIds: [] as string[],
      batches: 0,
    };
    for (let batch = 0; batch < 10; batch += 1) {
      const result = await settleDueScheduledExamActivations({ batchSize: 25 });
      scheduledActivation.scanned += result.scanned;
      scheduledActivation.activated += result.activated;
      scheduledActivation.recalculatedStudents += result.recalculatedStudents;
      scheduledActivation.examIds.push(...result.examIds);
      scheduledActivation.batches += 1;
      if (result.scanned < 25 || result.activated === 0) break;
    }

    return NextResponse.json(
      {
        ok: true,
        scheduledActivation,
        settledAt: new Date().toISOString(),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return routeErrorResponse(error, "تعذر إكمال الصيانة الأكاديمية المجدولة.");
  }
}
