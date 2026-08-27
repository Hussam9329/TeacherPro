export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { routeErrorResponse } from "@/lib/route-helpers";
import { settleDueScheduledExamActivations } from "@/lib/scheduled-exam-activation-server";
import { reconcileExpiredGracePendingGrades } from "@/lib/grade-smart-note-grace-expiry-server";

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
 * Daily academic maintenance for the two time-driven transitions that cannot
 * rely on a user write request: scheduled exam activation and expiry of grace
 * smart notes. Both operations are idempotent and internally transactional.
 */
export async function GET(req: NextRequest) {
  if (!isAuthorizedCron(req)) {
    return NextResponse.json(
      { error: "غير مصرح بتشغيل الصيانة الأكاديمية المجدولة." },
      { status: 401 },
    );
  }

  try {
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

    const graceSettlement = {
      processed: 0,
      conflicts: 0,
      rejected: 0,
      stillInGrace: 0,
      eligibleRemaining: 0,
      processedNoteIds: [] as string[],
      conflictNoteIds: [] as string[],
      rejectedNoteIds: [] as string[],
      gradeIds: [] as string[],
      batches: 0,
    };
    for (let batch = 0; batch < 10; batch += 1) {
      const result = await reconcileExpiredGracePendingGrades({
        actor: { name: "TeacherPro - الصيانة الأكاديمية اليومية" },
        batchSize: 100,
      });
      graceSettlement.processed += result.processed;
      graceSettlement.conflicts += result.conflicts;
      graceSettlement.rejected += result.rejected;
      graceSettlement.stillInGrace = result.stillInGrace;
      graceSettlement.eligibleRemaining = result.eligibleRemaining;
      graceSettlement.processedNoteIds.push(...result.processedNoteIds);
      graceSettlement.conflictNoteIds.push(...result.conflictNoteIds);
      graceSettlement.rejectedNoteIds.push(...result.rejectedNoteIds);
      graceSettlement.gradeIds.push(...result.gradeIds);
      graceSettlement.batches += 1;
      if (result.eligibleRemaining === 0) break;
    }

    return NextResponse.json(
      {
        ok: true,
        scheduledActivation,
        graceSettlement,
        settledAt: new Date().toISOString(),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return routeErrorResponse(error, "تعذر إكمال الصيانة الأكاديمية المجدولة.");
  }
}
