export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/server-auth";
import { db } from "@/lib/db";
import { routeErrorResponse, validationError } from "@/lib/route-helpers";

type ExamLite = {
  id: string;
  type: string;
  date: Date;
  fullMark: number;
  passMark: number;
  discountMark: number;
  dismissalGrade: number | null;
  noDiscount: boolean;
};

type StudentLite = {
  id: string;
  courseId: string;
  createdAt: Date;
  accountingGraceDays: number;
  opportunities: number;
  baseOpportunities: number;
};

type GradeLite = {
  id: string;
  examId: string;
  status: string;
  score: number | null;
  exam: ExamLite;
};

function dayKey(value: Date | string | null | undefined): string {
  if (!value) return "";
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.toISOString().slice(0, 10) : "";
  const date = new Date(value);
  if (Number.isFinite(date.getTime())) return date.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

function normalizeGraceDays(value: unknown): number {
  const numeric = Number(value ?? 0);
  if (!Number.isFinite(numeric)) return 0;
  return Math.min(30, Math.max(0, Math.trunc(numeric)));
}

function parseDateOnly(value: Date | string | null | undefined): Date | null {
  const key = dayKey(value);
  const match = key.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const [, year, month, day] = match;
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day), 0, 0, 0, 0));
  return Number.isFinite(date.getTime()) ? date : null;
}

function isExamWithinStudentGracePeriod(student: StudentLite, exam: ExamLite): boolean {
  const days = normalizeGraceDays(student.accountingGraceDays);
  if (days <= 0) return false;
  const start = parseDateOnly(student.createdAt);
  const examDate = parseDateOnly(exam.date);
  if (!start || !examDate) return false;
  const endExclusive = new Date(start);
  endExclusive.setUTCDate(endExclusive.getUTCDate() + days);
  return examDate >= start && examDate < endExclusive;
}

/**
 * إحصائيات كروت ملف الطالب من قاعدة البيانات مباشرة.
 * لا تعتمد على مصفوفات grades/opportunityLogs المحملة في الصفحة الحالية.
 */
export async function GET(req: NextRequest) {
  const authError = await requirePermission(req, "students.view");
  if (authError) return authError;

  try {
    const { searchParams } = new URL(req.url);
    const studentId = String(searchParams.get("studentId") || "").trim();
    if (!studentId) return validationError("studentId مطلوب");

    const [
      student,
      grades,
      opportunityLogs,
      actionNotes,
      callsCount,
      leavesCount,
      pledgesCount,
      notesCount,
    ] = await Promise.all([
      db.student.findUnique({
        where: { id: studentId },
        select: {
          id: true,
          courseId: true,
          createdAt: true,
          accountingGraceDays: true,
          opportunities: true,
          baseOpportunities: true,
        },
      }) as Promise<StudentLite | null>,
      db.grade.findMany({
        where: { studentId },
        select: {
          id: true,
          examId: true,
          status: true,
          score: true,
          exam: {
            select: {
              id: true,
              type: true,
              date: true,
              fullMark: true,
              passMark: true,
              discountMark: true,
              dismissalGrade: true,
              noDiscount: true,
            },
          },
        },
      }) as Promise<GradeLite[]>,
      db.opportunityLog.findMany({
        where: { studentId },
        select: { action: true },
      }),
      db.studentNote.count({ where: { studentId, kind: "إجراء" } }).catch(() => 0),
      db.studentCall.count({ where: { studentId } }).catch(() => 0),
      db.studentLeave.count({ where: { studentId } }).catch(() => 0),
      db.studentNote.count({ where: { studentId, kind: "تعهد ولي الأمر" } }).catch(() => 0),
      db.studentNote.count({ where: { studentId } }).catch(() => 0),
    ]);

    if (!student) return validationError("الطالب غير موجود");

    const realActiveChapterLink = await db.courseChapter.findFirst({
      where: { courseId: student.courseId, active: true, archived: false },
      select: { id: true },
    });

    const accountableGrades = grades.filter((grade) => {
      if (isExamWithinStudentGracePeriod(student, grade.exam)) return false;
      if (grade.exam.noDiscount) return false;
      return true;
    });

    const absent = accountableGrades.filter((grade) => grade.status === "غائب").length;
    const success = accountableGrades.filter(
      (grade) => grade.status === "درجة" && grade.score !== null && Number(grade.score) >= Number(grade.exam.passMark || 0),
    ).length;
    const failed = accountableGrades.filter((grade) => {
      if (grade.status !== "درجة" || grade.score === null) return false;
      const score = Number(grade.score);
      const passMark = Number(grade.exam.passMark || 0);
      const discountMark = Number(grade.exam.discountMark || 0);
      if (!Number.isFinite(score)) return false;
      return grade.exam.noDiscount
        ? score < passMark
        : score > discountMark && score < passMark;
    }).length;
    const graceGrades = grades.filter((grade) => isExamWithinStudentGracePeriod(student, grade.exam)).length;
    const noDiscountGrades = grades.filter(
      (grade) => !isExamWithinStudentGracePeriod(student, grade.exam) && grade.exam.noDiscount,
    ).length;
    const deductedMovements = opportunityLogs.filter(
      (log) => log.action === "خصم" || log.action === "خصم تلقائي",
    ).length;
    const addedMovements = opportunityLogs.length - deductedMovements;
    const dismissalActions = opportunityLogs.filter((log) =>
      String(log.action || "").includes("فصل"),
    ).length;
    const reactivationActions = opportunityLogs.filter((log) =>
      String(log.action || "").includes("إعادة تفعيل") || String(log.action || "").includes("فرصة أخيرة"),
    ).length;
    const timelineCount =
      1 +
      grades.length +
      opportunityLogs.length +
      Number(callsCount || 0) +
      Number(leavesCount || 0) +
      Number(notesCount || 0) +
      Number(actionNotes || 0);

    return NextResponse.json({
      studentId,
      grades: grades.length,
      exams: new Set(grades.map((grade) => grade.examId)).size,
      absent,
      absences: absent,
      success,
      failed,
      graceGrades,
      noDiscountGrades,
      opportunities: student.opportunities,
      baseOpportunities: student.baseOpportunities,
      hasActiveChapter: Boolean(realActiveChapterLink),
      deductedMovements,
      deductions: deductedMovements,
      addedMovements,
      calls: Number(callsCount || 0),
      leaves: Number(leavesCount || 0),
      pledges: Number(pledgesCount || 0),
      notes: Number(notesCount || 0),
      dismissals: dismissalActions,
      reactivations: reactivationActions,
      timeline: timelineCount,
      actions: Number(actionNotes || 0) + opportunityLogs.length,
      source: "database" as const,
      generatedAt: new Date().toISOString(),
    });
  } catch (error) {
    return routeErrorResponse(error, "تعذر تحميل إحصائيات ملف الطالب من قاعدة البيانات.");
  }
}
