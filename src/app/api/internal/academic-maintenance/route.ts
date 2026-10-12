export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

import { db } from "@/lib/db";
import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { routeErrorResponse } from "@/lib/route-helpers";
import { settleDueScheduledExamActivations } from "@/lib/scheduled-exam-activation-server";
import { healStaleAcademicRecordsWithin } from "@/lib/academic-recalculate-server";
import { writeSystemAuditLog } from "@/lib/audit-log-server";

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
 * Daily academic maintenance for what cannot rely on a user write request:
 * scheduled exam activation, then self-healing of saved records that differ
 * from the calculation (a result written to the database outside the app,
 * or an input changed without recalculating). Grace periods need no nightly
 * work; they are evaluated from exam dates at read time.
 */
export async function GET(req: NextRequest) {
  if (!isAuthorizedCron(req)) {
    return NextResponse.json(
      { error: "غير مصرح بتشغيل الصيانة الأكاديمية المجدولة." },
      { status: 401 },
    );
  }

  const startedAt = Date.now();
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

    // Leave room under maxDuration for the response and the audit line.
    const staleRecords = await healStaleAcademicRecordsWithin({
      deadline: startedAt + 90_000,
      day: Math.floor(startedAt / 86_400_000),
    });
    if (staleRecords.healed.length || staleRecords.stillStale.length) {
      await writeSystemAuditLog("إدارة الفرص", "إصلاح تلقائي لطلاب ما يطابق محفوظهم الحساب", {
        scanned: staleRecords.scanned,
        complete: staleRecords.complete,
        healed: staleRecords.healed.map((record) => ({ studentId: record.studentId, code: record.code, before: record.stored, after: record.replay })),
        stillStale: staleRecords.stillStale.map((record) => record.studentId),
      });
    }

    return NextResponse.json(
      {
        ok: true,
        scheduledActivation,
        staleRecords: {
          scanned: staleRecords.scanned,
          complete: staleRecords.complete,
          healed: staleRecords.healed.length,
          stillStale: staleRecords.stillStale.length,
        },
        settledAt: new Date().toISOString(),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return routeErrorResponse(error, "تعذر إكمال الصيانة الأكاديمية المجدولة.");
  }
}
