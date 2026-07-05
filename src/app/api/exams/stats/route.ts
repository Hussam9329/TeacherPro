export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/server-auth";
import { db } from "@/lib/db";
import { withFollowupTables } from "@/lib/followup-schema";
import { routeErrorResponse } from "@/lib/route-helpers";

type ExamRow = {
  id: string;
  type: string;
  date: Date;
  fullMark: number;
  passMark: number;
  discountMark: number;
  dismissalGrade: number | null;
  noDiscount: boolean;
};

type StudentRow = {
  id: string;
  createdAt: Date;
  accountingGraceDays: number;
};

type GradeRow = {
  id: string;
  examId: string;
  studentId: string;
  status: string;
  score: number | null;
  student: StudentRow;
};

type LeaveRow = {
  studentId: string;
  examId: string | null;
  leaveType: string;
  date: Date;
  dateFrom: Date | null;
  dateTo: Date | null;
};

type ExamStat = {
  total: number;
  passCount: number;
  notPassedCount: number;
  protectedCount: number;
};

function dayKey(value: Date | string | null | undefined): string {
  if (!value) return "";
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.toISOString().slice(0, 10) : "";
  const date = new Date(value);
  if (Number.isFinite(date.getTime())) return date.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

function dayAfter(value: Date): Date {
  const next = new Date(value);
  next.setUTCDate(next.getUTCDate() + 1);
  return next;
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

function isExamWithinStudentGracePeriod(student: StudentRow, exam: ExamRow): boolean {
  const days = normalizeGraceDays(student.accountingGraceDays);
  if (days <= 0) return false;
  const start = parseDateOnly(student.createdAt);
  const examDate = parseDateOnly(exam.date);
  if (!start || !examDate) return false;
  const endExclusive = new Date(start);
  endExclusive.setUTCDate(endExclusive.getUTCDate() + days);
  return examDate >= start && examDate < endExclusive;
}

function isExamOnOrAfterStudentRegistration(student: StudentRow, exam: ExamRow): boolean {
  const registeredAt = parseDateOnly(student.createdAt);
  const examDate = parseDateOnly(exam.date);
  if (!registeredAt || !examDate) return true;
  return examDate >= registeredAt;
}

function isGradeEntered(grade: GradeRow, exam: ExamRow): boolean {
  if (grade.status === "درجة") {
    const score = Number(grade.score);
    return Number.isFinite(score) && score >= 0 && score <= Number(exam.fullMark || 0);
  }
  return grade.status === "غائب" || grade.status === "غش";
}

function leaveAppliesToExam(leave: LeaveRow, studentId: string, exam: ExamRow): boolean {
  if (leave.studentId !== studentId) return false;
  if ((leave.leaveType || "exam") === "period") {
    const examDate = dayKey(exam.date);
    const from = dayKey(leave.dateFrom || leave.date);
    const to = dayKey(leave.dateTo || leave.dateFrom || leave.date);
    return Boolean(examDate && from && to && examDate >= from && examDate <= to);
  }
  return leave.examId === exam.id;
}

function classifyForExamStats(grade: GradeRow, exam: ExamRow, leaves: LeaveRow[]): "pass" | "notPassed" | "protected" {
  if (leaves.some((leave) => leaveAppliesToExam(leave, grade.studentId, exam))) return "protected";
  if (!isGradeEntered(grade, exam)) return "protected";
  if (isExamWithinStudentGracePeriod(grade.student, exam)) return "protected";
  if (!isExamOnOrAfterStudentRegistration(grade.student, exam)) return "protected";
  if (grade.status === "غش") return "notPassed";
  if (exam.noDiscount) {
    if (grade.status === "درجة" && Number(grade.score || 0) >= Number(exam.passMark || 0)) return "pass";
    return "protected";
  }
  if (grade.status === "غائب") return "notPassed";

  const score = Number(grade.score) || 0;
  if (exam.type === "فاينل") {
    if (score === 0 || (exam.dismissalGrade !== null && score <= Number(exam.dismissalGrade))) return "notPassed";
    if (score >= Number(exam.passMark || 0)) return "pass";
    return "notPassed";
  }
  if (score >= Number(exam.passMark || 0)) return "pass";
  return "notPassed";
}

/**
 * إحصائيات كروت سجل الامتحانات من قاعدة البيانات مباشرة.
 * لا تستخدم مصفوفة الدرجات المحلية لأن التحميل الأول لا يجلب كل الدرجات.
 */
export async function GET(req: NextRequest) {
  const authError = await requirePermission(req, "exams.view");
  if (authError) return authError;

  try {
    const { searchParams } = new URL(req.url);
    const requestedIds = String(searchParams.get("examIds") || "")
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean);

    const examWhere = requestedIds.length ? { id: { in: requestedIds } } : {};
    const exams = (await db.exam.findMany({
      where: examWhere,
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
    })) as ExamRow[];

    const examIds = exams.map((exam) => exam.id);
    const emptyStats = Object.fromEntries(
      examIds.map((id) => [id, { total: 0, passCount: 0, notPassedCount: 0, protectedCount: 0 } satisfies ExamStat]),
    );
    if (examIds.length === 0) {
      return NextResponse.json({ statsByExamId: {}, source: "database" as const, generatedAt: new Date().toISOString() });
    }

    const examDates = exams.map((exam) => exam.date).filter((date): date is Date => date instanceof Date);
    const minExamDate = examDates.length ? new Date(Math.min(...examDates.map((date) => date.getTime()))) : null;
    const maxExamDate = examDates.length ? new Date(Math.max(...examDates.map((date) => date.getTime()))) : null;

    const leaveWhere = {
      OR: [
        { examId: { in: examIds } },
        ...(minExamDate && maxExamDate
          ? [
              {
                leaveType: "period",
                dateFrom: { lte: dayAfter(maxExamDate) },
                dateTo: { gte: minExamDate },
              },
            ]
          : []),
      ],
    };

    const [grades, leaves] = await Promise.all([
      db.grade.findMany({
        where: { examId: { in: examIds } },
        select: {
          id: true,
          examId: true,
          studentId: true,
          status: true,
          score: true,
          student: {
            select: {
              id: true,
              createdAt: true,
              accountingGraceDays: true,
            },
          },
        },
      }) as Promise<GradeRow[]>,
      withFollowupTables(
        () => db.studentLeave.findMany({
          where: leaveWhere,
          select: {
            studentId: true,
            examId: true,
            leaveType: true,
            date: true,
            dateFrom: true,
            dateTo: true,
          },
        }),
        "ExamStatsStudentLeave",
      ) as Promise<LeaveRow[]>,
    ]);

    const examById = new Map(exams.map((exam) => [exam.id, exam]));
    const leavesByStudent = new Map<string, LeaveRow[]>();
    leaves.forEach((leave) => {
      const current = leavesByStudent.get(leave.studentId) || [];
      current.push(leave);
      leavesByStudent.set(leave.studentId, current);
    });

    const statsByExamId: Record<string, ExamStat> = { ...emptyStats };
    grades.forEach((grade) => {
      const exam = examById.get(grade.examId);
      if (!exam) return;
      const stat = statsByExamId[grade.examId] || { total: 0, passCount: 0, notPassedCount: 0, protectedCount: 0 };
      stat.total += 1;
      const kind = classifyForExamStats(grade, exam, leavesByStudent.get(grade.studentId) || []);
      if (kind === "pass") stat.passCount += 1;
      else if (kind === "protected") stat.protectedCount += 1;
      else stat.notPassedCount += 1;
      statsByExamId[grade.examId] = stat;
    });

    return NextResponse.json({
      statsByExamId,
      source: "database" as const,
      generatedAt: new Date().toISOString(),
    });
  } catch (error) {
    return routeErrorResponse(error, "تعذر تحميل إحصائيات الامتحانات من قاعدة البيانات.");
  }
}
