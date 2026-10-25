export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { routeErrorResponse, validationError } from "@/lib/route-helpers";
import { requireMirmazToken } from "@/lib/mirmaz-integration-auth";
import {
  bodyTooLarge,
  claimCorrectionKey,
  correctionSnapshot,
  finishCorrectionKey,
  readText,
  releaseCorrectionKey,
} from "@/lib/correction-integration-server";
import { writeAuditLog } from "@/lib/audit-log-server";
import {
  earlierPlacement,
  holdMirmazGrade,
  mirmazKey,
  mirmazServicePrincipal,
  mirmazSessionCookie,
  placeMirmazGrade,
  placedChoices,
  recordSavedMirmazGrade,
  saveThroughGradeEntry,
  type ExamCandidate,
  type MirmazExam,
  type StudentCandidate,
} from "@/lib/mirmaz-integration-server";

/**
 * A grade from «Mirmaz Pro», sent (through Mirmaz Pro's own server) right
 * after the paper is corrected on Mirmaz. TeacherPro finds the student by
 * name exactly as «أداة مرماز» does, and the one exam of their course on
 * that day; then saves it with the grade entry screen's own handler as the
 * «mirmaz» account. Anything not certain is held for «مرماز برو».
 *
 * Body: { answerId, score, student: { name }, exam: { id, name, datetime, fullMark }, correctedBy }
 * Reply: { ok, stored: "grade" | "already" | "hold", studentName?, examName?, reasonText? }
 * The same paper and score again never saves twice.
 */
export async function POST(req: NextRequest) {
  const tokenError = requireMirmazToken(req);
  if (tokenError) return tokenError;
  const tooLarge = bodyTooLarge(req);
  if (tooLarge) return tooLarge;
  let key = "";
  try {
    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    const answerId = readText(body?.answerId, 30);
    const score = Number(body?.score);
    const studentName = readText((body?.student as Record<string, unknown> | undefined)?.name);
    const rawExam = (body?.exam ?? {}) as Record<string, unknown>;
    const fullMark = Number(rawExam.fullMark);
    const exam: MirmazExam = {
      id: readText(rawExam.id, 40),
      name: readText(rawExam.name),
      datetime: readText(rawExam.datetime, 40),
      fullMark: Number.isInteger(fullMark) && fullMark > 0 ? fullMark : null,
    };
    const correctedBy = readText(body?.correctedBy, 120);
    if (!/^\d+$/.test(answerId)) return validationError("answerId مطلوب.");
    if (!studentName) return validationError("اسم الطالب مطلوب.");
    if (!exam.name) return validationError("اسم الامتحان مطلوب.");
    if (!Number.isInteger(score) || score < 0 || (exam.fullMark !== null && score > exam.fullMark)) {
      return validationError("الدرجة لازم تكون رقم صحيح ضمن الدرجة الكاملة.");
    }

    const hold = async (reason: string, reasonText: string, candidates: StudentCandidate[] = [], examCandidates: ExamCandidate[] = []) => {
      await holdMirmazGrade({ answerId, reason, reasonText, score, studentName, exam, correctedBy, candidates, examCandidates });
      return NextResponse.json({ ok: true, answerId, stored: "hold", reason, reasonText });
    };

    const account = await mirmazServicePrincipal();
    if ("error" in account) return NextResponse.json({ ok: false, code: "MIRMAZ_ACCOUNT_UNAVAILABLE", error: account.error }, { status: 503 });

    // A re-correction goes where this paper went before (placed by itself, or by a person).
    const earlier = await earlierPlacement(answerId);
    let studentId: string;
    let examId: string;
    if (earlier) {
      ({ studentId, examId } = earlier);
    } else {
      const placement = await placeMirmazGrade(studentName, exam);
      if (placement.kind === "hold") return hold(placement.reason, placement.reasonText, placement.candidates, placement.examCandidates);
      ({ studentId, examId } = placement);
    }

    // A result already there is never overwritten by itself, unless it came
    // from this same paper (a re-correction).
    const before = await correctionSnapshot(db, studentId, examId);
    const current = before.grade;
    if (current && current.status === "درجة" && current.score === score) {
      await recordSavedMirmazGrade({ answerId, score, studentName, exam, correctedBy, studentId, examId, note: "الدرجة كانت موجودة أصلاً بنفس القيمة" });
      return NextResponse.json({ ok: true, answerId, stored: "already" });
    }
    const hasResult = current && (current.score !== null || current.status !== "درجة");
    if (hasResult && !earlier) {
      const what = current!.score !== null ? `درجة ${current!.score}` : `«${current!.status}»`;
      const choices = await placedChoices(studentId, examId);
      return hold("EXISTING_RESULT", `الطالب عنده ${what} بهذا الامتحان؛ تأكد قبل ما تبدّلها.`, choices.candidates, choices.examCandidates);
    }

    key = mirmazKey(answerId, score);
    const request = JSON.stringify({ kind: "mirmaz-grade", studentId, examId, score });
    const claim = await claimCorrectionKey({ key, kind: "mirmaz-grade", studentId, examId, request, before });
    if (!claim.claimed) {
      key = "";
      return claim.reply;
    }

    const saved = await saveThroughGradeEntry(req.url, await mirmazSessionCookie(account.userId), studentId, examId, score);
    if (!saved.ok) {
      // A rule refused it (closed exam, dismissed student…): nothing was
      // written, so the key is free, and a person decides in «مرماز برو».
      await releaseCorrectionKey(key);
      key = "";
      if (saved.status === 401 || saved.status === 403) {
        return NextResponse.json({ ok: false, code: "MIRMAZ_ACCOUNT_UNAVAILABLE", error: "حساب mirmaz ما يگدر يدخل درجات هسه." }, { status: 503 });
      }
      const choices = await placedChoices(studentId, examId);
      return hold("SAVE_REFUSED", `TeacherPro ما قبل الحفظ: ${saved.error}`, choices.candidates, choices.examCandidates);
    }

    const pending = saved.status === 202; // TeacherPro kept it as a pending note (its own rule)
    const [student, target] = await Promise.all([
      db.student.findUnique({ where: { id: studentId }, select: { name: true } }),
      db.exam.findUnique({ where: { id: examId }, select: { name: true } }),
    ]);
    const reply = {
      ok: true,
      answerId,
      stored: pending ? "pending_note" : "grade",
      studentName: student?.name ?? "",
      examName: target?.name ?? "",
      message: String(saved.result.message || ""),
    };
    const done = await finishCorrectionKey(key, { status: 200, body: reply });
    key = "";
    await recordSavedMirmazGrade({
      answerId, score, studentName, exam, correctedBy, studentId, examId,
      note: pending ? "انحفظت كملاحظة معلّقة (حسب قواعد TeacherPro)" : "",
    });
    await writeAuditLog(account.principal, "الدرجات", "درجة من Mirmaz Pro", { answerId, studentId, examId, score, correctedBy, stored: reply.stored });
    return done;
  } catch (error) {
    // Left claimed on purpose: if the grade was saved, a retry after the
    // claim goes stale finds the stored reply and never saves twice.
    return routeErrorResponse(error, "تعذر استلام درجة Mirmaz Pro.");
  }
}
