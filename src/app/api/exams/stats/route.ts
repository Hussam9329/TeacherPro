export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/server-auth";
import { db } from "@/lib/db";
import { withFollowupTables } from "@/lib/followup-schema";
import { routeErrorResponse } from "@/lib/route-helpers";
import {
  classifyGradeAcademicImpact,
  dayKey,
  isProtectedGradeKind,
} from "@/lib/grade-classification";
import { STUDENT_STATUS_ARCHIVED } from "@/lib/student-scope";
import { ensureExamSchema } from "@/lib/exam-schema";

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
  status: string;
  createdAt: Date;
  accountingGraceDays: number;
  gracePeriodStartDate: Date | null;
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

function dayAfter(value: Date): Date {
  const next = new Date(value);
  next.setUTCDate(next.getUTCDate() + 1);
  return next;
}

function classifyForExamStats(
  grade: GradeRow,
  exam: ExamRow,
  leaves: LeaveRow[],
): "pass" | "notPassed" | "protected" {
  const kind = classifyGradeAcademicImpact(grade, exam, {
    student: grade.student,
    leaves,
  });
  if (kind === "passed" || kind === "full-mark") return "pass";
  if (isProtectedGradeKind(kind)) return "protected";
  return "notPassed";
}

/**
 * إحصائيات بطاقات سجل الامتحانات من بيانات النظام مباشرة.
 * تستخدم نفس تصنيف الدرجات المركزي حتى لا تختلف الأرقام عن التصدير والمكالمات.
 */
export async function GET(req: NextRequest) {
  const authError = await requirePermission(req, "exams.view");
  if (authError) return authError;

  try {
    await ensureExamSchema();
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
      examIds.map((id) => [
        id,
        { total: 0, passCount: 0, notPassedCount: 0, protectedCount: 0 } satisfies ExamStat,
      ]),
    );
    if (examIds.length === 0) {
      return NextResponse.json({
        statsByExamId: {},
        source: "database" as const,
        generatedAt: new Date().toISOString(),
      });
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
        where: {
          examId: { in: examIds },
          student: { is: { status: { not: STUDENT_STATUS_ARCHIVED } } },
        },
        select: {
          id: true,
          examId: true,
          studentId: true,
          status: true,
          score: true,
          student: {
            select: {
              id: true,
              status: true,
              createdAt: true,
              accountingGraceDays: true,
              gracePeriodStartDate: true,
            },
          },
        },
      }) as Promise<GradeRow[]>,
      withFollowupTables(
        () => db.studentLeave.findMany({
          where: {
            ...leaveWhere,
            student: { is: { status: { not: STUDENT_STATUS_ARCHIVED } } },
          },
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
      const relevantLeaves = (leavesByStudent.get(grade.studentId) || []).filter(
        (leave) => leave.examId === grade.examId || (leave.leaveType === "period" && dayKey(exam.date)),
      );
      const kind = classifyForExamStats(grade, exam, relevantLeaves);
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
    return routeErrorResponse(error, "تعذر تحميل إحصائيات الامتحانات من بيانات النظام.");
  }
}
