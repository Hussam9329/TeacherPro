export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireBotToken } from "@/lib/bot-integration-auth";
import { normalizeTelegramIdentifier } from "@/lib/student-utils";
import { routeErrorResponse, validationError } from "@/lib/route-helpers";
import {
  getExamEntryAvailability,
  isExamOnOrAfterStudentRegistration,
  splitSelection,
  studentMatchesExamMainSites,
} from "@/lib/exam-utils";

function textValue(value: unknown, max = 200): string {
  return String(value ?? "").trim().slice(0, max);
}

function parseCourseIds(value: string | null | undefined): string[] {
  try {
    const parsed = JSON.parse(value || "[]");
    return Array.isArray(parsed) ? parsed.map(String).filter(Boolean) : [];
  } catch {
    return String(value || "")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  }
}

async function resolveStudent(body: Record<string, unknown>) {
  const studentId = textValue(body.studentId ?? body.student_id, 120);
  if (studentId) return db.student.findUnique({ where: { id: studentId }, include: { course: true } });

  const telegram = body.telegram as Record<string, unknown> | undefined;
  const telegramCandidates = [
    textValue(body.telegramUserId ?? body.telegram_user_id ?? telegram?.id, 80),
    textValue(body.telegramUsername ?? body.telegram_username ?? telegram?.username, 120),
  ]
    .map(normalizeTelegramIdentifier)
    .filter(Boolean);

  if (telegramCandidates.length === 0) return null;

  return db.student.findFirst({
    where: { telegramKey: { in: telegramCandidates } },
    include: { course: true },
  });
}

export async function POST(req: NextRequest) {
  const tokenError = requireBotToken(req);
  if (tokenError) return tokenError;

  try {
    const body = (await req.json()) as Record<string, unknown>;
    const student = await resolveStudent(body);
    if (!student) return validationError("الطالب غير مرتبط أو غير موجود في TeacherPro.", 404);
    if (student.status === "مفصول") {
      return validationError("الطالب مفصول ولا يمكن للبوت اعتماد امتحان أو درجة له قبل إعادة التفعيل.");
    }
    if (student.status === "مؤرشف") {
      return validationError("ملف الطالب مؤرشف ومتاح للقراءة فقط.");
    }

    const [candidateExams, takenGrades, takenSubmissions, activeChapterLinks] = await Promise.all([
      db.exam.findMany({ orderBy: { date: "desc" } }),
      db.grade.findMany({ where: { studentId: student.id }, select: { examId: true } }),
      db.telegramExamSubmission.findMany({ where: { studentId: student.id }, select: { examId: true } }).catch(() => []),
      db.courseChapter.findMany({
        where: { courseId: student.courseId, active: true, archived: false },
        select: { id: true },
      }),
    ]);

    if (activeChapterLinks.length !== 1) {
      return validationError(
        activeChapterLinks.length === 0
          ? "دورة الطالب لا تحتوي فصلاً نشطاً، لذلك لا يمكن عرض امتحانات البوت."
          : "دورة الطالب تحتوي تعارضاً في الفصول النشطة، لذلك تم إيقاف امتحانات البوت لحماية الرصيد.",
        409,
      );
    }

    const takenExamIds = new Set([
      ...takenGrades.map((item) => item.examId),
      ...takenSubmissions.map((item) => item.examId),
    ]);

    const exams = candidateExams
      .filter((exam) => {
        if (takenExamIds.has(exam.id)) return false;
        if (!getExamEntryAvailability(exam).available) return false;
        if (!isExamOnOrAfterStudentRegistration(student, exam)) return false;
        if (!studentMatchesExamMainSites(student, splitSelection(exam.mainSite))) return false;
        const courseIds = parseCourseIds(exam.courseIds);
        return courseIds.length === 0 || courseIds.includes(student.courseId);
      })
      .map((exam) => ({
        id: exam.id,
        name: exam.name,
        type: exam.type,
        courseIds: parseCourseIds(exam.courseIds),
        date: exam.date,
        fullMark: exam.fullMark,
        passMark: exam.passMark,
        active: exam.active,
        availability: getExamEntryAvailability(exam),
      }));

    return NextResponse.json({
      ok: true,
      student: {
        id: student.id,
        name: student.name,
        phone: student.phone,
        telegram: student.telegram,
        code: student.code,
        courseId: student.courseId,
        courseName: student.course?.name || "",
      },
      exams,
    });
  } catch (error) {
    return routeErrorResponse(error, "تعذر تحميل امتحانات البوت من TeacherPro حالياً.");
  }
}
