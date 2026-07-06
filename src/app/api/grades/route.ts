export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { Prisma } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/server-auth";
import { db } from "@/lib/db";
import {
  normalizeArabicText,
  requireText,
  routeErrorResponse,
  validationError,
} from "@/lib/route-helpers";
import { ensureExamSchema } from "@/lib/exam-schema";
import { ensureFollowupTables } from "@/lib/followup-schema";
import { normalizeListFilter } from "@/lib/all-filter";
import { recalculateStudentsAcademicState } from "@/lib/academic-recalculate-server";
import { gradeMatchesStatusFilterUnified } from "@/lib/grade-classification";
import { STUDENT_STATUS_ARCHIVED } from "@/lib/student-scope";
import { writeRequestAuditLog } from "@/lib/audit-log-server";

async function validateGradePayload(body: Record<string, unknown>) {
  const studentError = requireText(body.studentId, "الطالب");
  if (studentError) return studentError;
  const examError = requireText(body.examId, "الامتحان");
  if (examError) return examError;
  if (!["درجة", "غائب", "غش"].includes(String(body.status ?? "")))
    return "حالة الدرجة غير صحيحة";

  // تحقق أن الطالب موجود فعلاً ضمن قائمة courseIds للامتحان
  const [exam, student] = await Promise.all([
    db.exam.findUnique({
      where: { id: String(body.examId) },
      select: { id: true, date: true, fullMark: true, courseIds: true },
    }),
    db.student.findUnique({
      where: { id: String(body.studentId) },
      select: { id: true, courseId: true, status: true, dismissalType: true },
    }),
  ]);
  if (!exam) return "الامتحان غير موجود";
  if (!student) return "الطالب غير موجود";

  // منع إدخال درجة لطالب مفصول — لا يجوز محاسبته أكاديمياً بعد الفصل.
  // العميل مسؤول عن تقديم زر "إعادة تفعيل" قبل السماح بإدخال درجات جديدة.
  if (student.status === "مفصول") {
    return "الطالب مفصول ولا يمكن إدخال درجات له. أعد تفعيل الطالب أولاً.";
  }

  let courseIds: string[] = [];
  try {
    const parsed = JSON.parse(exam.courseIds || "[]");
    if (Array.isArray(parsed)) courseIds = parsed.map(String).filter(Boolean);
  } catch {
    courseIds = [];
  }
  if (courseIds.length > 0 && !courseIds.includes(student.courseId)) {
    return "الطالب ليس ضمن دورات هذا الامتحان";
  }

  const leaveMessage = await getGradeBlockedByLeaveMessage(student.id, exam);
  if (leaveMessage) return leaveMessage;

  if (body.status === "درجة") {
    const score = Number(body.score);
    const fullMark = Number(exam.fullMark || 0);
    if (!Number.isFinite(score) || score < 0 || score > fullMark) {
      return `الدرجة يجب أن تكون رقماً بين 0 و ${fullMark}`;
    }
  }
  return null;
}

function parsePositiveInt(
  value: string | null,
  fallback: number,
  max: number,
): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return Math.min(Math.floor(parsed), max);
}

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

  if (normalizedQuery) {
    studentSearch.push({
      nameKey: { contains: normalizedQuery, mode: "insensitive" },
    });
  }
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
  if (normalizedLetter) {
    studentWhere.push({
      nameKey: { startsWith: normalizedLetter, mode: "insensitive" },
    });
  }

  return { student: { is: { OR: studentWhere } } };
}

function buildGradeWhere(
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
  const search = String(searchParams.get("q") || "").trim();
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

  const searchWhere = buildGradeSearchWhere(search);
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

function startOfUtcDay(value: Date | string | null | undefined): Date | null {
  const key = dateKey(value);
  if (!key) return null;
  const date = new Date(`${key}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) ? date : null;
}

function endOfUtcDayExclusive(
  value: Date | string | null | undefined,
): Date | null {
  const start = startOfUtcDay(value);
  if (!start) return null;
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 1);
  return end;
}

function buildStudentLeaveWhereForExam(
  studentId: string,
  exam: { id: string; date?: Date | string | null },
): Prisma.StudentLeaveWhereInput {
  const examDayStart = startOfUtcDay(exam.date);
  const examDayEnd = endOfUtcDayExclusive(exam.date);
  const periodWhere: Prisma.StudentLeaveWhereInput[] = [];

  if (examDayStart && examDayEnd) {
    periodWhere.push({
      leaveType: "period",
      dateFrom: { lt: examDayEnd },
      dateTo: { gte: examDayStart },
    });
  }

  return {
    studentId,
    OR: [{ examId: exam.id }, ...periodWhere],
  };
}

async function getGradeBlockedByLeaveMessage(
  studentId: string,
  exam: { id: string; date?: Date | string | null },
): Promise<string | null> {
  const leave = await db.studentLeave.findFirst({
    where: buildStudentLeaveWhereForExam(studentId, exam),
    select: { id: true, leaveType: true, reason: true },
  });
  if (!leave) return null;
  return "لا يمكن إدخال درجة لطالب مجاز.";
}

function isGradeEnteredForServer(
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
  return grade.status === "غائب" || grade.status === "غش";
}

function isExamBeforeStudentRegistration(
  student: { createdAt?: Date | string | null },
  exam: { date?: Date | string | null },
): boolean {
  const registeredAt = dateKey(student.createdAt);
  const examDate = dateKey(exam.date);
  if (!registeredAt || !examDate) return false;
  return examDate < registeredAt;
}

function isExamWithinGracePeriod(
  student: {
    createdAt?: Date | string | null;
    accountingGraceDays?: number | null;
  },
  exam: { date?: Date | string | null },
): boolean {
  const days = Math.max(
    0,
    Math.trunc(Number(student.accountingGraceDays || 0)),
  );
  if (days <= 0) return false;
  const start = new Date(`${dateKey(student.createdAt)}T00:00:00.000Z`);
  const examDate = new Date(`${dateKey(exam.date)}T00:00:00.000Z`);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(examDate.getTime()))
    return false;
  const endExclusive = new Date(start);
  endExclusive.setUTCDate(endExclusive.getUTCDate() + days);
  return examDate >= start && examDate < endExclusive;
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

function serverClassificationKind(grade: GradeWithRelations): string {
  const student = grade.student;
  const exam = grade.exam;
  if (student.studentLeaves.some((leave) => leaveAppliesToExam(leave, exam)))
    return "excused";
  if (!isGradeEnteredForServer(grade, exam)) return "missing";
  if (isExamWithinGracePeriod(student, exam)) return "grace";
  if (isExamBeforeStudentRegistration(student, exam)) return "grace";
  if (grade.status === "غش") return "cheat";
  if (exam.noDiscount) {
    if (
      grade.status === "درجة" &&
      Number(grade.score || 0) >= Number(exam.passMark || 0)
    )
      return "pass";
    return "no-discount";
  }
  if (grade.status === "غائب") {
    if (exam.type === "فاينل") return "dismissal";
    return "deducted";
  }
  const score = Number(grade.score) || 0;
  if (exam.type === "فاينل") {
    if (
      score === 0 ||
      (exam.dismissalGrade !== null && score <= Number(exam.dismissalGrade))
    )
      return "dismissal";
    if (score >= Number(exam.passMark || 0)) return "pass";
    return "fail";
  }
  if (score >= Number(exam.passMark || 0)) return "pass";
  if (
    score > Number(exam.discountMark || 0) &&
    score < Number(exam.passMark || 0)
  )
    return "academic-accounting";
  return "deducted";
}

function gradeMatchesServerStatusFilter(
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
    const { searchParams } = new URL(req.url);
    const page = parsePositiveInt(searchParams.get("page"), 1, 1_000_000);
    const pageSize = parsePositiveInt(searchParams.get("pageSize"), 100, 500);
    const statusFilter = normalizeGradeStatusFilter(searchParams);

    // The old UI-only filters (full mark / discounted / failed / accounting / grace)
    // must be computed over the complete database result, then paginated after that.
    // Otherwise page 1 only is filtered locally and totals/exports become incomplete.
    const where = buildGradeWhere(searchParams);
    const needsDatabaseComputedFilter =
      databaseComputedGradeFilters.has(statusFilter);

    if (needsDatabaseComputedFilter) {
      const allGrades = await db.grade.findMany({
        where,
        orderBy: { updatedAt: "desc" },
        include: { student: { include: { studentLeaves: true } }, exam: true },
      });
      const matchingGrades = allGrades.filter((grade) =>
        gradeMatchesServerStatusFilter(statusFilter, grade),
      );
      const totalCount = matchingGrades.length;
      const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
      const grades = matchingGrades.slice(
        (page - 1) * pageSize,
        page * pageSize,
      );

      return NextResponse.json({
        grades,
        totalCount,
        page,
        pageSize,
        totalPages,
        hasMore: page < totalPages,
      });
    }

    const finalWhere: Prisma.GradeWhereInput =
      statusFilter === "absent"
        ? { AND: [where, { status: "غائب" }] }
        : statusFilter === "cheating"
          ? { AND: [where, { status: "غش" }] }
          : where;
    const skip = (page - 1) * pageSize;

    const [totalCount, grades] = await Promise.all([
      db.grade.count({ where: finalWhere }),
      db.grade.findMany({
        where: finalWhere,
        orderBy: { updatedAt: "desc" },
        skip,
        take: pageSize,
        include: { student: true, exam: true },
      }),
    ]);
    const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));

    return NextResponse.json({
      grades,
      totalCount,
      page,
      pageSize,
      totalPages,
      hasMore: page < totalPages,
    });
  } catch (error) {
    return routeErrorResponse(error, "تعذر تحميل الدرجات حالياً.");
  }
}

export async function POST(req: NextRequest) {
  const authError = await requirePermission(req, "grades.add");
  if (authError) return authError;

  try {
    await ensureExamSchema();
    await ensureFollowupTables();

    const body = await req.json();
    const validationMessage = await validateGradePayload(body);
    if (validationMessage) return validationError(validationMessage);
    const checked =
      body.academicAccountingChecked === undefined
        ? undefined
        : Boolean(body.academicAccountingChecked);
    const result = await db.$transaction(async (tx) => {
      const grade = await tx.grade.upsert({
        where: {
          studentId_examId: { studentId: body.studentId, examId: body.examId },
        },
        update: {
          status: body.status,
          score:
            body.score === null || body.score === undefined
              ? null
              : Number(body.score),
          notes: body.notes,
          ...(checked !== undefined
            ? { academicAccountingChecked: checked }
            : {}),
        },
        create: {
          // Never trust client-provided IDs on create. Offline/client IDs stay local only;
          // the server reconciles records by the unique studentId + examId pair.
          studentId: body.studentId,
          examId: body.examId,
          status: body.status,
          score:
            body.score === null || body.score === undefined
              ? null
              : Number(body.score),
          notes: body.notes,
          academicAccountingChecked: Boolean(body.academicAccountingChecked),
        },
      });
      const academicRecalculation = await recalculateStudentsAcademicState(
        [grade.studentId],
        { tx },
      );
      return { grade, academicRecalculation };
    });
    await writeRequestAuditLog(req, "الدرجات", "حفظ درجة وإعادة احتساب الطالب", {
      gradeId: result.grade.id,
      studentId: result.grade.studentId,
      examId: result.grade.examId,
      status: result.grade.status,
      score: result.grade.score,
      recalculatedStudents: result.academicRecalculation?.students?.length || 0,
    });
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return routeErrorResponse(error, "تعذر حفظ الدرجة حالياً.");
  }
}

export async function PUT(req: NextRequest) {
  const authError = await requirePermission(req, "grades.edit");
  if (authError) return authError;

  try {
    await ensureExamSchema();
    await ensureFollowupTables();

    const body = await req.json();
    const { id, ...data } = body;
    delete data.accountingChecked;

    const gradeId = String(id || "").trim();
    const fallbackStudentId = String(data.studentId || "").trim();
    const fallbackExamId = String(data.examId || "").trim();
    if (!gradeId && (!fallbackStudentId || !fallbackExamId))
      return validationError("تعذر تحديد الدرجة المطلوبة");

    if (data.academicAccountingChecked !== undefined)
      data.academicAccountingChecked = Boolean(data.academicAccountingChecked);
    if (
      data.status !== undefined &&
      !["درجة", "غائب", "غش"].includes(String(data.status))
    )
      return validationError("حالة الدرجة غير صحيحة");
    if (data.score !== undefined)
      data.score = data.score === null ? null : Number(data.score);

    const current = gradeId
      ? await db.grade.findUnique({
          where: { id: gradeId },
          include: { exam: true },
        })
      : null;
    const fallbackCurrent =
      !current && fallbackStudentId && fallbackExamId
        ? await db.grade.findUnique({
            where: {
              studentId_examId: {
                studentId: fallbackStudentId,
                examId: fallbackExamId,
              },
            },
            include: { exam: true },
          })
        : null;
    const targetGrade = current || fallbackCurrent;
    if (!targetGrade)
      return validationError("سجل الدرجة غير موجود أو تم حذفه مسبقاً", 404);

    if (data.status === "درجة" || data.score !== undefined) {
      const nextStatus = String(data.status ?? targetGrade.status);
      const nextScore =
        data.score !== undefined ? data.score : targetGrade.score;
      if (nextStatus === "درجة") {
        const fullMark = Number(targetGrade.exam.fullMark || 0);
        if (
          !Number.isFinite(Number(nextScore)) ||
          Number(nextScore) < 0 ||
          Number(nextScore) > fullMark
        ) {
          return validationError(
            `الدرجة يجب أن تكون رقماً بين 0 و ${fullMark}`,
          );
        }
      }
    }

    const leaveMessage = await getGradeBlockedByLeaveMessage(
      targetGrade.studentId,
      targetGrade.exam,
    );
    if (leaveMessage) return validationError(leaveMessage);

    const result = await db.$transaction(async (tx) => {
      const grade = await tx.grade.update({
        where: { id: targetGrade.id },
        data,
      });
      const academicRecalculation = await recalculateStudentsAcademicState(
        [grade.studentId],
        { tx },
      );
      return { grade, academicRecalculation };
    });
    await writeRequestAuditLog(req, "الدرجات", "تعديل درجة وإعادة احتساب الطالب", {
      gradeId: result.grade.id,
      studentId: result.grade.studentId,
      examId: result.grade.examId,
      status: result.grade.status,
      score: result.grade.score,
      recalculatedStudents: result.academicRecalculation?.students?.length || 0,
    });
    return NextResponse.json(result);
  } catch (error) {
    return routeErrorResponse(error, "تعذر تحديث الدرجة حالياً.");
  }
}

export async function DELETE(req: NextRequest) {
  const authError = await requirePermission(req, "grades.delete");
  if (authError) return authError;

  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");
    const studentId = searchParams.get("studentId");
    const examId = searchParams.get("examId");

    const status = searchParams.get("status");

    if (examId && status === "غائب" && !studentId && !id) {
      const result = await db.$transaction(async (tx) => {
        const targetGrades = await tx.grade.findMany({
          where: { examId, status: "غائب" },
          select: { id: true, studentId: true },
        });
        const studentIds = Array.from(
          new Set(targetGrades.map((grade) => grade.studentId)),
        );
        if (targetGrades.length === 0) {
          return {
            ok: true,
            deleted: 0,
            studentIds: [],
            academicRecalculation: null,
          };
        }
        const deletedAbsences = await tx.grade.deleteMany({
          where: { examId, status: "غائب" },
        });
        const academicRecalculation = await recalculateStudentsAcademicState(
          studentIds,
          { tx },
        );
        return {
          ok: true,
          deleted: deletedAbsences.count,
          studentIds,
          academicRecalculation,
        };
      });
      await writeRequestAuditLog(req, "الدرجات", "حذف غيابات امتحان وإعادة احتساب الطلاب", {
        examId,
        status,
        deleted: result.deleted,
        affectedStudents: result.studentIds?.length || 0,
      });
      return NextResponse.json(result);
    }

    if (id) {
      const result = await db.$transaction(async (tx) => {
        const targetGrade = await tx.grade.findUnique({
          where: { id },
          select: { id: true, studentId: true },
        });
        const deletedById = await tx.grade.deleteMany({ where: { id } });
        const academicRecalculation =
          targetGrade && deletedById.count > 0
            ? await recalculateStudentsAcademicState([targetGrade.studentId], {
                tx,
              })
            : null;
        return {
          ok: true,
          deleted: deletedById.count,
          studentIds: targetGrade ? [targetGrade.studentId] : [],
          academicRecalculation,
        };
      });
      if (result.deleted > 0 || !studentId || !examId) {
        await writeRequestAuditLog(req, "الدرجات", "حذف درجة وإعادة احتساب الطالب", {
          gradeId: id,
          deleted: result.deleted,
          affectedStudents: result.studentIds?.length || 0,
          studentIds: result.studentIds,
        });
        return NextResponse.json(result);
      }
    }
    if (studentId && examId) {
      const result = await db.$transaction(async (tx) => {
        const targetGrade = await tx.grade.findUnique({
          where: { studentId_examId: { studentId, examId } },
          select: { id: true, studentId: true },
        });
        const deletedByPair = await tx.grade.deleteMany({
          where: { studentId, examId },
        });
        const academicRecalculation =
          targetGrade && deletedByPair.count > 0
            ? await recalculateStudentsAcademicState([targetGrade.studentId], {
                tx,
              })
            : null;
        return {
          ok: true,
          deleted: deletedByPair.count,
          studentIds: targetGrade ? [targetGrade.studentId] : [],
          academicRecalculation,
        };
      });
      await writeRequestAuditLog(req, "الدرجات", "حذف درجة وإعادة احتساب الطالب", {
        studentId,
        examId,
        deleted: result.deleted,
        affectedStudents: result.studentIds?.length || 0,
        studentIds: result.studentIds,
      });
      return NextResponse.json(result);
    }
    return validationError("تعذر تحديد الدرجة المطلوبة");
  } catch (error) {
    return routeErrorResponse(error, "تعذر حذف الدرجة حالياً.");
  }
}
