export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { isExamWithinStudentGraceWindow } from "@/lib/student-grace";
import { NextRequest, NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { requirePermission } from "@/lib/server-auth";
import { db } from "@/lib/db";
import { normalizeArabicText } from "@/lib/route-helpers";
import { normalizeListFilter } from "@/lib/all-filter";
import {
  classifyGradeAcademicImpact,
  gradeMatchesStatusFilterUnified,
} from "@/lib/grade-classification";
import { STUDENT_STATUS_ARCHIVED } from "@/lib/student-scope";

function buildGradeSearchWhere(
  rawQuery: string,
): Prisma.GradeWhereInput | null {
  const query = rawQuery.trim();
  if (!query) return null;

  const normalizedQuery = normalizeArabicText(query);
  const compactQuery = query.replace(/\s+/g, "");
  const telegramQuery = query.startsWith("@") ? query : `@${query}`;

  const studentSearch: Prisma.StudentWhereInput[] = [
    { name: { contains: query, mode: "insensitive" } },
    { code: { startsWith: query, mode: "insensitive" } },
    { phone: { startsWith: compactQuery, mode: "insensitive" } },
    { parentPhone: { startsWith: compactQuery, mode: "insensitive" } },
    { telegram: { startsWith: telegramQuery, mode: "insensitive" } },
  ];

  if (normalizedQuery)
    studentSearch.push({
      nameKey: { contains: normalizedQuery, mode: "insensitive" },
    });
  if (compactQuery.length >= 7) {
    studentSearch.push(
      { phone: { contains: compactQuery, mode: "insensitive" } },
      { parentPhone: { contains: compactQuery, mode: "insensitive" } },
    );
  }

  return {
    OR: [
      { notes: { contains: query, mode: "insensitive" } },
      { student: { is: { OR: studentSearch } } },
      { exam: { is: { name: { contains: query, mode: "insensitive" } } } },
    ],
  };
}

function buildNameLetterWhere(letter: string): Prisma.GradeWhereInput | null {
  const rawLetter = letter.trim();
  if (!rawLetter || rawLetter === "all") return null;
  const normalizedLetter = normalizeArabicText(rawLetter).slice(0, 1);
  const studentWhere: Prisma.StudentWhereInput[] = [
    { name: { startsWith: rawLetter, mode: "insensitive" } },
  ];
  if (normalizedLetter)
    studentWhere.push({
      nameKey: { startsWith: normalizedLetter, mode: "insensitive" },
    });
  return { student: { is: { OR: studentWhere } } };
}

function buildGradeExportWhere(
  searchParams: URLSearchParams,
): Prisma.GradeWhereInput {
  const and: Prisma.GradeWhereInput[] = [];
  const examId = normalizeListFilter(searchParams.get("examId"));
  const studentId = normalizeListFilter(searchParams.get("studentId"));
  const status = normalizeListFilter(searchParams.get("status"));
  const courseId = normalizeListFilter(searchParams.get("courseId"));
  const courseProgram = normalizeListFilter(searchParams.get("courseProgram"));
  const courseTerm = normalizeListFilter(searchParams.get("courseTerm"));
  const studyType = normalizeListFilter(searchParams.get("studyType"));
  const q = String(searchParams.get("q") || "").trim();
  const nameLetter = normalizeListFilter(searchParams.get("nameLetter"));

  if (examId) and.push({ examId });
  if (studentId) and.push({ studentId });
  if (status) and.push({ status });

  const studentAnd: Prisma.StudentWhereInput[] = [
    { status: { not: STUDENT_STATUS_ARCHIVED } },
  ];
  if (courseId) studentAnd.push({ courseId });
  if (courseProgram) studentAnd.push({ courseProgram });
  if (courseProgram === "كورسات" && courseTerm) studentAnd.push({ courseTerm });
  if (studyType) studentAnd.push({ studyType });
  if (studentAnd.length > 0) {
    and.push({
      student: {
        is: studentAnd.length === 1 ? studentAnd[0] : { AND: studentAnd },
      },
    });
  }

  const letterWhere = buildNameLetterWhere(nameLetter);
  if (letterWhere) and.push(letterWhere);

  const searchWhere = buildGradeSearchWhere(q);
  if (searchWhere) and.push(searchWhere);

  return and.length > 0 ? { AND: and } : {};
}

type GradeStatusFilter =
  | "all"
  | "excused"
  | "grace-period"
  | "absent"
  | "cheating"
  | "discounted"
  | "failed"
  | "academic-accounting"
  | "passed"
  | "full-mark"
  | "has-grade";

type GradeWithRelations = Prisma.GradeGetPayload<{
  include: { student: { include: { studentLeaves: true } }; exam: true };
}>;

const databaseComputedGradeFilters = new Set<GradeStatusFilter>([
  "excused",
  "grace-period",
  "discounted",
  "failed",
  "academic-accounting",
  "passed",
  "full-mark",
  "has-grade",
]);

function dateKey(value: unknown): string {
  return String(value || "").slice(0, 10);
}

function isGradeEnteredForExport(
  grade: { status?: string | null; score?: number | null },
  exam: { fullMark?: number | null },
): boolean {
  if (grade.status === "درجة") {
    const score = Number(grade.score);
    return (
      Number.isFinite(score) &&
      score >= 0 &&
      score <= Number(exam.fullMark || 0)
    );
  }
  return grade.status === "غائب" || grade.status === "غش" || grade.status === "مجاز" || grade.status === "ضمن فترة السماح" || grade.status === "قبل تسجيل الطالب";
}

function isExamBeforeStudentRegistration(
  student: { createdAt?: Date | string | null },
  exam: { date?: Date | string | null },
): boolean {
  const registeredAt = dateKey(student.createdAt);
  const examDate = dateKey(exam.date);
  return Boolean(registeredAt && examDate && examDate < registeredAt);
}

function isExamWithinGracePeriod(
  student: {
    createdAt?: Date | string | null;
    accountingGraceDays?: number | null;
    gracePeriodStartDate?: Date | string | null;
  },
  exam: { date?: Date | string | null },
): boolean {
  return isExamWithinStudentGraceWindow(student, exam);
}

function leaveAppliesToExam(
  leave: {
    examId?: string | null;
    leaveType?: string | null;
    date?: Date | string | null;
    dateFrom?: Date | string | null;
    dateTo?: Date | string | null;
  },
  exam: { id: string; date?: Date | string | null },
): boolean {
  if ((leave.leaveType || "exam") === "period") {
    const examDate = dateKey(exam.date);
    const from = dateKey(leave.dateFrom || leave.date);
    const to = dateKey(leave.dateTo || leave.dateFrom || leave.date);
    return Boolean(
      examDate && from && to && examDate >= from && examDate <= to,
    );
  }
  return leave.examId === exam.id;
}

function exportClassificationKind(grade: GradeWithRelations): string {
  return classifyGradeAcademicImpact(grade, grade.exam, {
    student: grade.student,
    leaves: grade.student.studentLeaves,
  });
}

function gradeMatchesExportStatusFilter(
  filter: GradeStatusFilter,
  grade: GradeWithRelations,
): boolean {
  return gradeMatchesStatusFilterUnified(filter, grade, grade.exam, {
    student: grade.student,
    leaves: grade.student.studentLeaves,
  });
}

function normalizeGradeStatusFilter(
  searchParams: URLSearchParams,
): GradeStatusFilter {
  const raw = normalizeListFilter(searchParams.get("statusFilter"));
  const allowed: GradeStatusFilter[] = [
    "all",
    "excused",
    "grace-period",
    "absent",
    "cheating",
    "discounted",
    "failed",
    "academic-accounting",
    "passed",
    "full-mark",
    "has-grade",
  ];
  return allowed.includes(raw as GradeStatusFilter)
    ? (raw as GradeStatusFilter)
    : "all";
}

export async function GET(req: NextRequest) {
  const authError = await requirePermission(req, "grades.view");
  if (authError) return authError;

  try {
    const searchParams = new URL(req.url).searchParams;
    const where = buildGradeExportWhere(searchParams);
    const statusFilter = normalizeGradeStatusFilter(searchParams);

    if (databaseComputedGradeFilters.has(statusFilter)) {
      const allGrades = await db.grade.findMany({
        where,
        orderBy: { updatedAt: "desc" },
        include: { student: { include: { studentLeaves: true } }, exam: true },
      });
      const grades = allGrades.filter((grade) =>
        gradeMatchesExportStatusFilter(statusFilter, grade),
      );
      return NextResponse.json({
        grades,
        total: grades.length,
        totalCount: grades.length,
        capped: false,
      });
    }

    const finalWhere: Prisma.GradeWhereInput =
      statusFilter === "absent"
        ? { AND: [where, { status: "غائب" }] }
        : statusFilter === "cheating"
          ? { AND: [where, { status: "غش" }] }
          : where;
    const [totalCount, grades] = await Promise.all([
      db.grade.count({ where: finalWhere }),
      db.grade.findMany({
        where: finalWhere,
        orderBy: { updatedAt: "desc" },
        include: { student: true, exam: true },
      }),
    ]);

    return NextResponse.json({
      grades,
      total: grades.length,
      totalCount,
      capped: false,
    });
  } catch (error) {
    console.error("[API] /api/grades/export error:", error);
    return NextResponse.json(
      { error: "تعذر تصدير بيانات الدرجات حالياً." },
      { status: 500 },
    );
  }
}
