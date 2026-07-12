export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireBotToken } from "@/lib/bot-integration-auth";
import { normalizeTelegramIdentifier } from "@/lib/student-utils";
import { routeErrorResponse, validationError } from "@/lib/route-helpers";
import { evaluateStudentExamEligibility, examCourseIds } from "@/lib/student-exam-eligibility-server";

function text(value: unknown, max = 200) { return String(value ?? "").trim().slice(0, max); }
async function resolveStudent(body: Record<string, unknown>) {
  const studentId = text(body.studentId ?? body.student_id, 120);
  if (studentId) return db.student.findUnique({ where: { id: studentId }, include: { course: true } });
  const telegram = body.telegram as Record<string, unknown> | undefined;
  const candidates = [text(body.telegramUserId ?? body.telegram_user_id ?? telegram?.id, 80), text(body.telegramUsername ?? body.telegram_username ?? telegram?.username, 120)].map(normalizeTelegramIdentifier).filter(Boolean);
  if (!candidates.length) return null;
  const matches = await db.student.findMany({ where: { telegramKey: { in: candidates } }, include: { course: true }, take: 2 });
  if (matches.length !== 1) return null;
  return matches[0];
}

export async function POST(req: NextRequest) {
  const tokenError = requireBotToken(req); if (tokenError) return tokenError;
  try {
    const body = (await req.json()) as Record<string, unknown>;
    const student = await resolveStudent(body);
    if (!student) return validationError("الطالب غير مرتبط بصورة فريدة أو غير موجود.", 404);
    if (student.status !== "نشط") return validationError(student.status === "مؤرشف" ? "ملف الطالب مؤرشف." : "الطالب مفصول ويجب إعادة تفعيله أولاً.", 409);

    const [candidateExams, actualGrades, submissions] = await Promise.all([
      db.exam.findMany({ include: { examCourses: { select: { courseId: true } } }, orderBy: { date: "desc" } }),
      db.grade.findMany({ where: { studentId: student.id, OR: [{ status: { in: ["غائب", "غش"] } }, { status: "درجة", score: { not: null } }] }, select: { examId: true } }),
      db.telegramExamSubmission.findMany({ where: { studentId: student.id, pageCount: { gt: 0 }, status: { notIn: ["ملغي", "محذوف"] } }, select: { examId: true, status: true } }).catch(() => []),
    ]);
    const unavailableIds = new Set([...actualGrades.map((item) => item.examId), ...submissions.map((item) => item.examId)]);
    const exams = [] as Array<Record<string, unknown>>;
    for (const exam of candidateExams) {
      if (unavailableIds.has(exam.id)) continue;
      const eligibility = await evaluateStudentExamEligibility(db, student, exam, { requireActiveChapter: true, checkAvailability: true, checkRegistration: true, checkLeave: true });
      if (!eligibility.eligible) continue;
      exams.push({ id: exam.id, name: exam.name, type: exam.type, courseIds: examCourseIds(exam), date: exam.date, fullMark: exam.fullMark, passMark: exam.passMark, active: exam.active, availability: eligibility.availability, withinGrace: eligibility.withinGrace, eligibilityCode: eligibility.code });
    }
    return NextResponse.json({ ok: true, student: { id: student.id, name: student.name, phone: student.phone, telegram: student.telegram, code: student.code, courseId: student.courseId, courseName: student.course?.name || "", accountingGraceDays: student.accountingGraceDays }, exams });
  } catch (error) { return routeErrorResponse(error, "تعذر تحميل امتحانات البوت حالياً."); }
}
