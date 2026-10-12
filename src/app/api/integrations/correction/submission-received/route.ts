export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { routeErrorResponse, validationError } from "@/lib/route-helpers";
import { requireCorrectionToken } from "@/lib/correction-integration-auth";
import {
  auditCorrection,
  bodyTooLarge,
  claimCorrectionKey,
  correctionServicePrincipal,
  correctionSnapshot,
  finishCorrectionKey,
  noActiveChapter,
  readText,
  receiveCorrectionSubmission,
  releaseCorrectionKey,
} from "@/lib/correction-integration-server";

/**
 * The Correction app received a student's paper; the grade comes later.
 * TeacherPro records it with its own rules (see receiveCorrectionSubmission)
 * and never ends a grace period or touches a pending note for it.
 * The same submissionId again returns the stored reply.
 */
export async function POST(req: NextRequest) {
  const tokenError = requireCorrectionToken(req);
  if (tokenError) return tokenError;
  const tooLarge = bodyTooLarge(req);
  if (tooLarge) return tooLarge;
  try {
    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    const studentId = readText(body?.studentId);
    const examId = readText(body?.examId);
    const submissionId = readText(body?.submissionId);
    const submittedAt = readText(body?.submittedAt, 64);
    if (!studentId || !examId || !submissionId) return validationError("studentId و examId و submissionId مطلوبة.");

    const account = await correctionServicePrincipal();
    if ("error" in account) return account.error;
    const before = await correctionSnapshot(db, studentId, examId);
    const chapterError = await noActiveChapter(studentId, examId, before.courseId);
    if (chapterError) return chapterError;

    const key = `submission:${submissionId}`;
    const request = JSON.stringify({ kind: "submission", studentId, examId });
    const claim = await claimCorrectionKey({ key, kind: "submission", studentId, examId, request, before });
    if (!claim.claimed) return claim.reply;

    // Safe to run again after a request that died: the decision is made
    // inside the write's own transaction.
    const receipt = await receiveCorrectionSubmission({ studentId, examId, submissionId, before: claim.before });
    if (!receipt.body.ok) {
      await releaseCorrectionKey(key);
      return NextResponse.json(receipt.body, { status: receipt.status });
    }
    const done = await finishCorrectionKey(key, receipt);
    if (receipt.body.status === "received") {
      await auditCorrection(account.principal, "استلام ورقة من Correction وإعادة احتساب الطالب", {
        submissionId, submittedAt, studentId, examId,
        previousStatus: receipt.body.previousStatus, gradeId: receipt.body.gradeId,
        opportunitiesBefore: receipt.body.opportunitiesBefore, opportunitiesAfter: receipt.body.opportunitiesAfter,
      });
    }
    return done;
  } catch (error) {
    return routeErrorResponse(error, "تعذر تسجيل استلام الورقة.");
  }
}
