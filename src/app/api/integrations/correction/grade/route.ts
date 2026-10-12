export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { routeErrorResponse, validationError } from "@/lib/route-helpers";
import { AUTH_COOKIE_NAME } from "@/lib/server-auth";
import { BONUS_OPPORTUNITY_ACTION } from "@/lib/bonus-opportunity";
import { requireCorrectionToken } from "@/lib/correction-integration-auth";
import {
  auditCorrection,
  bodyTooLarge,
  claimCorrectionKey,
  correctionServicePrincipal,
  correctionSnapshot,
  earnedBonus,
  finishCorrectionKey,
  mintCorrectionSession,
  noActiveChapter,
  readText,
  releaseCorrectionKey,
  type CorrectionSnapshot,
} from "@/lib/correction-integration-server";
import { POST as manualGradeEntry } from "@/app/api/grades/route";

const STATUSES = new Set(["درجة", "غائب", "غش"]);

type RecalculatedStudent = { id: string; opportunities?: number; status?: string };
type RecalculatedLog = { id: string; studentId: string; action: string };

/**
 * The Correction app's final result for one paper, after the reviewer
 * approved it. It runs the grade entry screen's own handler as the
 * «correction» account — the same checks, the same pending note for a
 * dismissed student, the same recalculation of opportunities, «فرصة مكافأة»
 * and dismissal, the same log line — and returns the student's real
 * balance before and after, for the message to the student.
 * The idempotency key is reserved before anything is written: the same key
 * again returns the stored reply and never saves twice.
 */
export async function POST(req: NextRequest) {
  const tokenError = requireCorrectionToken(req);
  if (tokenError) return tokenError;
  const tooLarge = bodyTooLarge(req);
  if (tooLarge) return tooLarge;
  let key = "";
  try {
    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    const studentId = readText(body?.studentId);
    const examId = readText(body?.examId);
    const idempotencyKey = readText(body?.idempotencyKey);
    const status = readText(body?.status) || "درجة";
    const rawScore = body?.score;
    const score = rawScore === null || rawScore === undefined || rawScore === ""
      ? null
      : typeof rawScore === "string" && Number.isFinite(Number(rawScore)) ? Number(rawScore) : rawScore;
    const notes = body?.notes === undefined ? undefined : String(body.notes ?? "").slice(0, 500);
    const confirmEndLeave = body?.confirmEndLeave === true;
    if (!studentId || !examId) return validationError("studentId و examId مطلوبة.");
    if (!idempotencyKey) return validationError("idempotencyKey مطلوب (مثلاً <submissionId>:<deliveryVersion>).");
    if (!STATUSES.has(status)) return validationError("status لازم يكون «درجة» أو «غائب» أو «غش».");

    const account = await correctionServicePrincipal();
    if ("error" in account) return account.error;
    const before = await correctionSnapshot(db, studentId, examId);
    const chapterError = await noActiveChapter(studentId, examId, before.courseId);
    if (chapterError) return chapterError;

    // The grade entry screen lets a dismissed student's absence or cheating
    // be recorded only on the exam that dismissed them.
    if (before.studentStatus === "مفصول" && status !== "درجة") {
      const [exam, effect] = await Promise.all([
        db.exam.findUnique({ where: { id: examId }, select: { name: true } }),
        db.opportunityLog.findFirst({ where: { studentId, examId, reason: { startsWith: "تلقائي" } }, select: { id: true } }),
      ]);
      const allowed = Boolean(before.grade && exam && (before.dismissalReason.includes(exam.name) || effect));
      if (!allowed) {
        return NextResponse.json({
          ok: false, studentId, examId, idempotencyKey, code: "DISMISSED_STUDENT_LOCKED",
          error: "الطالب مفصول؛ ما ينحفظ له غياب أو غش إلا على الامتحان اللي فصله.",
        }, { status: 409 });
      }
    }

    key = `grade:${idempotencyKey}`;
    const request = JSON.stringify({ kind: "grade", studentId, examId, status, score, notes: notes ?? null, confirmEndLeave });
    const claim = await claimCorrectionKey({ key, kind: "grade", studentId, examId, request, before });
    if (!claim.claimed) {
      key = "";
      return claim.reply;
    }
    const base = { studentId, examId, idempotencyKey };
    const reply = <T extends Record<string, unknown>>(fields: T, from: CorrectionSnapshot, after: { opportunities: number | null; studentStatus: string | null; bonusIds: string[] }) => ({
      ok: true,
      ...base,
      ...fields,
      previousStatus: from.grade?.status ?? null,
      previousScore: from.grade?.score ?? null,
      opportunitiesBefore: from.opportunities,
      opportunitiesAfter: after.opportunities,
      studentStatusBefore: from.studentStatus,
      studentStatusAfter: after.studentStatus,
      bonusEarned: earnedBonus(from, after.bonusIds),
    });

    // A retry of a request that died after saving: the grade is already
    // what was asked, so nothing runs again.
    if (claim.takeover) {
      const now = await correctionSnapshot(db, studentId, examId);
      if (now.grade && now.grade.status === status && (status !== "درجة" || now.grade.score === score)) {
        const saved = reply({ storedAs: "grade", gradeId: now.grade.id, smartNoteId: null, storedStatus: now.grade.status, storedScore: now.grade.score, message: "" },
          claim.before, { opportunities: now.opportunities, studentStatus: now.studentStatus, bonusIds: now.bonusLogIds });
        const done = await finishCorrectionKey(key, { status: 200, body: saved });
        key = "";
        return done;
      }
    }

    const manual = await manualGradeEntry(new NextRequest(new URL("/api/grades", req.url), {
      method: "POST",
      headers: new Headers({
        "content-type": "application/json",
        cookie: `${AUTH_COOKIE_NAME}=${await mintCorrectionSession(account.userId)}`,
      }),
      body: JSON.stringify({ studentId, examId, status, score, ...(notes !== undefined ? { notes } : {}), ...(confirmEndLeave ? { confirmEndLeave: true } : {}) }),
    }));
    const result = (await manual.json().catch(() => ({}))) as Record<string, unknown>;

    if (manual.status !== 201 && manual.status !== 202) {
      // Refused (or failed) before anything was saved: the key is free again.
      await releaseCorrectionKey(key);
      key = "";
      const accountProblem = manual.status === 401 || manual.status === 403;
      return NextResponse.json({
        ok: false,
        ...base,
        code: accountProblem ? "CORRECTION_ACCOUNT_UNAVAILABLE" : result.code ?? undefined,
        requiresFreshGrade: result.requiresFreshGrade === true || undefined,
        error: accountProblem ? "حساب correction ما يگدر يدخل درجات هسه." : String(result.error || result.message || "تعذر حفظ الدرجة."),
      }, { status: accountProblem ? 503 : manual.status });
    }

    // «Before» as the save's own transaction saw it: another save for the
    // same student in between is not credited to this one.
    const inside = result.studentBefore as { opportunities: number | null; status: string | null; bonusLogIds: string[]; grade: { status: string; score: number | null } | null } | undefined;
    const from: CorrectionSnapshot = inside
      ? { ...claim.before, opportunities: inside.opportunities, studentStatus: inside.status, bonusLogIds: inside.bonusLogIds, grade: inside.grade ? { id: "", ...inside.grade } : null }
      : claim.before;
    const pending = manual.status === 202;
    const grade = result.grade as { id?: string; status?: string; score?: number | null } | null | undefined;
    const recalculation = result.academicRecalculation as { students?: RecalculatedStudent[]; automaticOpportunityLogs?: RecalculatedLog[] } | null | undefined;
    const student = recalculation?.students?.find((item) => item.id === studentId);
    const bonusIds = [
      ...from.bonusLogIds,
      ...(recalculation?.automaticOpportunityLogs || []).filter((log) => log.studentId === studentId && log.action === BONUS_OPPORTUNITY_ACTION).map((log) => log.id),
    ];
    const storedStatus = pending ? null : grade?.status ?? null;
    const storedScore = pending ? null : grade?.score ?? null;
    const asked = storedStatus === status && (status !== "درجة" || storedScore === score);
    const storedAs = pending ? "pending_note" : result.idempotentReplay ? "already_resolved" : asked ? "grade" : "changed_by_rules";
    const saved = reply({
      storedAs,
      gradeId: pending ? null : grade?.id ?? null,
      smartNoteId: (result.smartNote as { id?: string } | null | undefined)?.id ?? null,
      storedStatus,
      storedScore,
      message: String(result.message || ""),
    }, from, {
      opportunities: student ? Number(student.opportunities ?? 0) : from.opportunities,
      studentStatus: student?.status ?? from.studentStatus,
      bonusIds: student ? bonusIds : from.bonusLogIds,
    });
    const done = await finishCorrectionKey(key, { status: 200, body: saved });
    key = "";
    await auditCorrection(account.principal, "نتيجة من Correction", {
      idempotencyKey, studentId, examId, storedAs, gradeId: saved.gradeId, smartNoteId: saved.smartNoteId,
    });
    return done;
  } catch (error) {
    // Left claimed on purpose: if the grade was saved, a retry after the
    // claim goes stale finds it and replies without saving again.
    return routeErrorResponse(error, "تعذر حفظ درجة Correction.");
  }
}
