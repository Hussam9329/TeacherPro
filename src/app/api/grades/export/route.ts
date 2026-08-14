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
  type GradeClassificationKind,
  gradeMatchesStatusFilterUnified,
  parseCourseIds,
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

type CompleteExportStudent = Prisma.StudentGetPayload<{
  include: { studentLeaves: true };
}>;

type CompleteExportExam = Prisma.ExamGetPayload<{
  include: { examCourses: { select: { courseId: true } } };
}>;

type CompleteExportGrade = Prisma.GradeGetPayload<Record<string, never>>;

type CompleteGradeExportRow = {
  grade: CompleteExportGrade | null;
  student: CompleteExportStudent;
  exam: CompleteExportExam;
  statusText: string;
  predictedActionText: string;
};

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

function exportClassificationKind(
  grade: GradeWithRelations,
): GradeClassificationKind {
  return classifyGradeAcademicImpact(grade, grade.exam, {
    student: grade.student,
    leaves: grade.student.studentLeaves,
  });
}

function protectedGradeActionText(kind: GradeClassificationKind): string {
  if (kind === "academic-effect-excluded") {
    return "لا إجراء - مستبعد من الأثر الأكاديمي";
  }
  if (kind === "excused") return "لا إجراء - الطالب مجاز";
  if (kind === "before-registration") {
    return "لا إجراء - الامتحان قبل تسجيل الطالب";
  }
  if (kind === "grace-period") {
    return "لا إجراء - الطالب ضمن فترة السماح";
  }
  if (kind === "unavailable-exam") {
    return "لا إجراء حالياً - الامتحان غير متاح أو غير محتسب";
  }
  if (kind === "no-discount-protected") {
    return "لا إجراء - الامتحان بلا خصم";
  }
  return "";
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

function completeExportStudentWhere(
  searchParams: URLSearchParams,
): Prisma.StudentWhereInput {
  const and: Prisma.StudentWhereInput[] = [
    { status: { not: STUDENT_STATUS_ARCHIVED } },
  ];
  const courseId = normalizeListFilter(searchParams.get("courseId"));
  const courseProgram = normalizeListFilter(searchParams.get("courseProgram"));
  const courseTerm = normalizeListFilter(searchParams.get("courseTerm"));
  const studyType = normalizeListFilter(searchParams.get("studyType"));
  if (courseId) and.push({ courseId });
  if (courseProgram) and.push({ courseProgram });
  if (courseProgram === "كورسات" && courseTerm) and.push({ courseTerm });
  if (studyType) and.push({ studyType });
  return { AND: and };
}

function completeExportExamCourseIds(exam: CompleteExportExam): string[] {
  return Array.from(
    new Set([
      ...parseCourseIds(exam.courseIds),
      ...exam.examCourses.map((link) => String(link.courseId || "")),
    ].filter(Boolean)),
  );
}

function studentMatchesExportNameLetter(
  student: CompleteExportStudent,
  rawLetter: string,
): boolean {
  if (!rawLetter || rawLetter === "all") return true;
  const letter = normalizeArabicText(rawLetter).slice(0, 1);
  const first = normalizeArabicText(student.name).slice(0, 1);
  return Boolean(letter && first === letter);
}

function completeExportRowMatchesQuery(
  rawQuery: string,
  student: CompleteExportStudent,
  exam: CompleteExportExam,
  grade: CompleteExportGrade | null,
): boolean {
  const query = rawQuery.trim();
  if (!query) return true;
  const normalizedQuery = normalizeArabicText(query).toLocaleLowerCase();
  const plainQuery = query.toLocaleLowerCase();
  const compactQuery = plainQuery.replace(/\s+/g, "").replace(/^@/, "");
  return [
    student.name,
    student.code,
    student.phone,
    student.parentPhone,
    student.telegram,
    student.school,
    student.mainSite,
    student.subSite,
    student.locationScope,
    exam.name,
    grade?.notes,
  ].some((value) => {
    const text = String(value || "").toLocaleLowerCase();
    const compactText = text.replace(/\s+/g, "").replace(/^@/, "");
    return (
      text.includes(plainQuery) ||
      (compactQuery.length > 0 && compactText.includes(compactQuery)) ||
      (normalizedQuery.length > 0 &&
        normalizeArabicText(text).toLocaleLowerCase().includes(normalizedQuery))
    );
  });
}

function missingGradePenalty(exam: CompleteExportExam): number {
  if (exam.noDiscount) return 0;
  const numeric = Number(exam.opportunitiesPenalty);
  return Number.isFinite(numeric) && numeric > 0
    ? Math.max(1, Math.trunc(numeric))
    : 1;
}

function predictedMissingActionText(
  student: CompleteExportStudent,
  exam: CompleteExportExam,
): string {
  if (student.status === "مفصول") {
    return "لا إجراء جديد - الطالب مفصول حالياً";
  }
  const kind = classifyGradeAcademicImpact(
    { status: "غائب", score: null },
    exam,
    { student, leaves: student.studentLeaves },
  );
  if (kind === "excused") return "لا إجراء - الطالب مجاز";
  if (kind === "before-registration") {
    return "لا إجراء - الامتحان قبل تسجيل الطالب";
  }
  if (kind === "grace-period") {
    return "لا إجراء - الطالب ضمن فترة السماح";
  }
  if (kind === "unavailable-exam") {
    return "لا إجراء حالياً - الامتحان غير متاح أو غير محتسب";
  }
  if (kind === "no-discount-protected") {
    return "لا إجراء - الامتحان بلا خصم";
  }
  if (kind === "absent-dismissal") {
    return "فصل تلقائي عند تسجيله غائباً";
  }
  if (kind === "absent-deducted") {
    const penalty = missingGradePenalty(exam);
    const opportunities = Math.max(0, Number(student.opportunities || 0));
    const remaining = Math.max(0, opportunities - penalty);
    return remaining === 0
      ? `فصل تلقائي لانتهاء الفرص عند تسجيل الغياب (خصم ${penalty})`
      : `خصم ${penalty} فرصة؛ المتبقي المتوقع ${remaining}`;
  }
  return "يُحدد الإجراء عند تسجيل الغياب";
}

async function completeGradeExportRows(searchParams: URLSearchParams) {
  const requestedExamId = normalizeListFilter(searchParams.get("examId"));
  const requestedCourseId = normalizeListFilter(searchParams.get("courseId"));
  const nameLetter = normalizeListFilter(searchParams.get("nameLetter"));
  const query = String(searchParams.get("q") || "").trim();
  const statusFilter = normalizeGradeStatusFilter(searchParams);

  const [students, examCandidates] = await Promise.all([
    db.student.findMany({
      where: completeExportStudentWhere(searchParams),
      include: { studentLeaves: true },
      orderBy: [{ name: "asc" }, { code: "asc" }],
    }),
    db.exam.findMany({
      where: requestedExamId ? { id: requestedExamId } : {},
      include: { examCourses: { select: { courseId: true } } },
      orderBy: [{ date: "desc" }, { name: "asc" }],
    }),
  ]);

  const exams = examCandidates.filter((exam) => {
    const courseIds = completeExportExamCourseIds(exam);
    return !requestedCourseId || courseIds.includes(requestedCourseId);
  });
  if (students.length === 0 || exams.length === 0) return [];

  const eligiblePairs = exams.flatMap((exam) => {
    const courseIds = completeExportExamCourseIds(exam);
    return students
      .filter((student) => courseIds.includes(student.courseId))
      .map((student) => ({ student, exam }));
  });
  if (eligiblePairs.length === 0) return [];

  const studentIds = Array.from(
    new Set(eligiblePairs.map(({ student }) => student.id)),
  );
  const examIds = Array.from(new Set(exams.map((exam) => exam.id)));
  const grades = await db.grade.findMany({
    where: { studentId: { in: studentIds }, examId: { in: examIds } },
  });
  const gradeByStudentExam = new Map(
    grades.map((grade) => [`${grade.studentId}:${grade.examId}`, grade]),
  );

  const rows: CompleteGradeExportRow[] = [];
  for (const { student, exam } of eligiblePairs) {
    const storedGrade =
      gradeByStudentExam.get(`${student.id}:${exam.id}`) || null;
    const grade =
      storedGrade && isGradeEnteredForExport(storedGrade, exam)
        ? storedGrade
        : null;
    if (!studentMatchesExportNameLetter(student, nameLetter)) continue;
    if (!completeExportRowMatchesQuery(query, student, exam, grade)) continue;
    if (!grade && statusFilter !== "all") continue;
    if (grade && statusFilter !== "all") {
      const hydratedGrade = { ...grade, student, exam } as GradeWithRelations;
      if (!gradeMatchesExportStatusFilter(statusFilter, hydratedGrade)) continue;
    }
    const gradeKind = grade
      ? exportClassificationKind({
          ...grade,
          student,
          exam,
        } as GradeWithRelations)
      : null;
    rows.push({
      grade,
      student,
      exam,
      // A leave is authoritative even if an old grade marker still says
      // absent/score. The exported report must not show an excused student as
      // deducted because a client cache does not contain the leave row.
      statusText:
        gradeKind === "excused" ? "مجاز" : grade?.status || "لم يمتحن",
      predictedActionText: gradeKind !== null
        ? protectedGradeActionText(gradeKind)
        : predictedMissingActionText(student, exam),
    });
  }
  return rows;
}

export async function GET(req: NextRequest) {
  const authError = await requirePermission(req, "grades.view");
  if (authError) return authError;

  try {
    const searchParams = new URL(req.url).searchParams;
    if (searchParams.get("includeAllStudents") === "1") {
      const rows = await completeGradeExportRows(searchParams);
      return NextResponse.json({
        rows,
        total: rows.length,
        totalCount: rows.length,
        capped: false,
        includesStudentsWithoutGrades: true,
      });
    }
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
