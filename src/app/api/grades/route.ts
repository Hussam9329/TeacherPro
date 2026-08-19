export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

import {
  isExamWithinStudentGraceWindow,
  isStudentCurrentlyInGrace,
} from "@/lib/student-grace";
import { Prisma } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { getAuthPrincipal, requirePermission } from "@/lib/server-auth";
import { db } from "@/lib/db";
import {
  normalizeArabicText,
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
import {
  AcademicGradeWritebackError,
  syncAcademicGradeWriteback,
} from "@/lib/academic-grade-writeback-server";
import { withSerializableTransaction } from "@/lib/serializable-transaction";
import { baghdadDateKey } from "@/lib/baghdad-time";
import { getExamEntryAvailability } from "@/lib/exam-utils";
import {
  isProtectedSmartNoteHistoricalGrade,
  type GradeSmartNoteCategory,
  upsertGradeSmartNote,
} from "@/lib/grade-smart-notes-server";
import { reconcileExpiredGracePendingGrades } from "@/lib/grade-smart-note-grace-expiry-server";
import { assertGradeStatusScoreConsistency } from "@/lib/grade-status-score-validation";

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

/**
 * ROOT-CAUSE FIX (الإصلاح السادس — تطابق سجل الدرجات مع فلتر المكالمات):
 *
 * Wrapper around buildGradeWhere that auto-adds a `student.courseId IN
 * exam.courseIds` filter when an `examId` is present but no explicit
 * `courseId` was passed. This makes the grade-records page match the
 * behavior of the calls page, which uses `studentCourseScopeWhere`.
 *
 * Without this fix, grade-records shows 1785 rows for exam 16 (including
 * 72 historical grades of students who transferred out), while the calls
 * page shows 1713 (current course students only).
 */
async function buildGradeWhereWithExamCourseFilter(
  searchParams: URLSearchParams,
): Promise<Prisma.GradeWhereInput> {
  const where = buildGradeWhere(searchParams);

  const examId = normalizeListFilter(searchParams.get("examId"));
  const explicitCourseId = normalizeListFilter(searchParams.get("courseId"));

  // If the caller already passed a courseId filter, don't override it.
  if (!examId || explicitCourseId) return where;

  // Load the exam's courseIds and add a student.courseId filter.
  const exam = await db.exam.findUnique({
    where: { id: examId },
    select: { courseIds: true },
  });
  if (!exam) return where;

  const parsedCourseIds = examCourseIds(exam.courseIds);
  if (parsedCourseIds.length === 0) return where;

  // Merge the course filter into the existing where clause.
  const existingStudentFilter =
    (where as { student?: { is?: Prisma.StudentWhereInput } }).student?.is;
  const courseFilter: Prisma.StudentWhereInput = {
    courseId: { in: parsedCourseIds },
  };
  const mergedStudentFilter = existingStudentFilter
    ? { AND: [existingStudentFilter, courseFilter] }
    : courseFilter;

  return {
    ...(where as Record<string, unknown>),
    student: { is: mergedStudentFilter },
  } as Prisma.GradeWhereInput;
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

class GradeWriteConflictError extends Error {
  constructor() {
    super(
      "تغيرت الدرجة بعد فتحها للتعديل. تم إيقاف الحفظ قبل أي كتابة؛ حدّث السجل وراجع القيمة الجديدة.",
    );
    this.name = "GradeWriteConflictError";
  }
}

type NumericGradeAttemptContext = {
  student: {
    id: string;
    name: string;
    code: string;
    courseId: string;
    status: string;
    createdAt: Date;
    accountingGraceDays: number;
    gracePeriodStartDate: Date | null;
  };
  exam: {
    id: string;
    name: string;
    date: Date;
    fullMark: number;
    courseIds: string;
    active: boolean;
    scheduledActivateAt: Date | null;
    scheduledDeactivateAt: Date | null;
  };
  category: GradeSmartNoteCategory | null;
  reason: string;
};

function examCourseIds(value: string | null | undefined): string[] {
  try {
    const parsed = JSON.parse(value || "[]");
    if (Array.isArray(parsed)) return parsed.map(String).filter(Boolean);
  } catch {
    // Older rows may contain a comma-separated list.
  }
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function numericGradeScore(value: unknown, fullMark: number): number {
  const text = value === null || value === undefined ? "" : String(value).trim();
  const score = Number(text);
  if (!text || !Number.isFinite(score) || !Number.isInteger(score)) {
    throw new AcademicGradeWritebackError(
      "الدرجات الكسرية أو غير الرقمية غير مدعومة. أدخل عدداً صحيحاً.",
    );
  }
  if (score < 0 || score > fullMark) {
    throw new AcademicGradeWritebackError(
      `الدرجة يجب أن تكون رقماً بين 0 و ${fullMark}`,
    );
  }
  return score;
}

async function inspectNumericGradeAttempt(
  tx: Prisma.TransactionClient,
  studentId: string,
  examId: string,
  scoreValue: unknown,
): Promise<NumericGradeAttemptContext & { score: number }> {
  const [student, exam] = await Promise.all([
    tx.student.findUnique({
      where: { id: studentId },
      select: {
        id: true,
        name: true,
        code: true,
        courseId: true,
        status: true,
        createdAt: true,
        accountingGraceDays: true,
        gracePeriodStartDate: true,
      },
    }),
    tx.exam.findUnique({
      where: { id: examId },
      select: {
        id: true,
        name: true,
        date: true,
        fullMark: true,
        courseIds: true,
        active: true,
        scheduledActivateAt: true,
        scheduledDeactivateAt: true,
      },
    }),
  ]);
  if (!student) {
    throw new AcademicGradeWritebackError(
      "الطالب المرتبط بالدرجة غير موجود.",
      404,
    );
  }
  if (!exam) {
    throw new AcademicGradeWritebackError(
      "الامتحان المرتبط بالدرجة غير موجود.",
      404,
    );
  }
  if (student.status === "مؤرشف") {
    throw new AcademicGradeWritebackError(
      "الطالب مؤرشف ولا يمكن اعتماد درجات على ملفه المقروء فقط.",
    );
  }
  const availability = getExamEntryAvailability(exam);
  if (!availability.available) {
    throw new AcademicGradeWritebackError(
      `لا يمكن اعتماد الدرجة: ${availability.reason}`,
    );
  }
  const linkedCourseIds = examCourseIds(exam.courseIds);
  if (linkedCourseIds.length > 0 && !linkedCourseIds.includes(student.courseId)) {
    throw new AcademicGradeWritebackError("الطالب ليس ضمن دورات هذا الامتحان.");
  }
  const score = numericGradeScore(scoreValue, Number(exam.fullMark || 0));
  const leaves = await tx.studentLeave.findMany({
    where: { studentId },
    select: {
      examId: true,
      leaveType: true,
      date: true,
      dateFrom: true,
      dateTo: true,
    },
  });
  const beforeRegistration = isExamBeforeStudentRegistration(student, exam);
  const onLeave = leaves.some((leave) => leaveAppliesToExam(leave, exam));
  const withinGrace = isExamWithinGracePeriod(student, exam);

  let category: NumericGradeAttemptContext["category"] = null;
  let reason = "";
  // ⚠️ مهم: الدرجات قبل التسجيل (beforeRegistration) لا يجب أن تكون معلقة أبداً!
  // 
  // عندما يكون الامتحان قبل تاريخ تسجيل الطالب:
  // - category يبقى null (لا Smart Note!)
  // - الدرجة تمر مباشرة لـ syncAcademicGradeWriteback
  // - هناك تُحفظ كـ "درجة" عادية مع academicEffectExcluded = true
  // - هذا يضمن عدم ظهورها كـ "درجة معلّقة" في لوحة الدرجات الذكية
  //
  // 🚫 لا تضف: else if (beforeRegistration) { category = "BEFORE_REGISTRATION_PENDING"; }
  // هذا سيُعيد المشكلة التي أصلحناها!
  //
  // الامتحان السابق للتسجيل حالة تاريخية بلا أثر أكاديمي، لكنه لا يلغي
  // الرقم الذي أدخله الموظف. يمر مباشرة إلى Grade ويُوسم بالاستثناء الدائم
  // داخل syncAcademicGradeWriteback، حتى لو كان الطالب حالياً مجازاً أو مفصولاً.
  if (!beforeRegistration) {
    if (onLeave) {
      category = "LEAVE_PENDING";
      reason = "محاولة إدخال درجة لطالب لديه إجازة تغطي هذا الامتحان.";
    } else if (student.status === "مفصول") {
      category = "DISMISSED_PENDING";
      reason = "محاولة إدخال درجة رقمية لطالب مفصول؛ حُفظت للمراجعة دون أثر أكاديمي.";
    } else if (withinGrace) {
      category = "GRACE_SCORED";
      reason = "درجة حقيقية داخل فترة السماح؛ محفوظة للمتابعة دون أثر أكاديمي.";
    }
  }

  return { student, exam, category, reason, score };
}

function dateKey(value: unknown): string {
  return baghdadDateKey(value as Date | string | null | undefined);
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
  return grade.status === "غائب" || grade.status === "غش" || grade.status === "مجاز" || grade.status === "ضمن فترة السماح" || grade.status === "قبل تسجيل الطالب";
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
    const where = await buildGradeWhereWithExamCourseFilter(searchParams);
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

  const principal = await getAuthPrincipal(req);
  if (!principal) {
    return NextResponse.json(
      { error: "يجب تسجيل الدخول أولاً." },
      { status: 401 },
    );
  }

  try {
    await ensureExamSchema();
    await ensureFollowupTables();

    const body = (await req.json()) as Record<string, unknown>;
    const studentId = String(body.studentId || "").trim();
    const examId = String(body.examId || "").trim();
    if (!studentId || !examId) {
      return validationError("تعذر تحديد الطالب أو الامتحان المطلوب.");
    }
    if (!["درجة", "غائب", "غش"].includes(String(body.status || ""))) {
      return validationError("حالة الدرجة غير صحيحة");
    }

    // ROOT-CAUSE FIX: Reject any contradictory (status != "درجة", score != null)
    // payload BEFORE we enter the transaction. The DB trigger and CHECK
    // constraint are the last line of defense, but a clean Arabic error here
    // is far more useful than a raw Postgres CHECK violation surfaced later.
    try {
      assertGradeStatusScoreConsistency(body.status, body.score);
    } catch (error) {
      if (error instanceof AcademicGradeWritebackError) {
        return validationError(error.message, error.status);
      }
      throw error;
    }

    // Q100 FIX: Use SERIALIZABLE isolation with retry to prevent concurrent
    // recalculation conflicts. Two parallel writes to the same student
    // (e.g. teacher edits a grade while admin adds an opportunity) would
    // otherwise race in READ COMMITTED and the last writer wins, silently
    // corrupting the student's opportunity balance and dismissal status.
    const result = await withSerializableTransaction(
      async (tx) => {
        const existingGrade = await tx.grade.findUnique({
          where: { studentId_examId: { studentId, examId } },
          select: { updatedAt: true },
        });

        // Protected numeric attempts are captured as structured smart notes
        // before optimistic-concurrency checks. They do not affect academic
        // accounting. A grace attempt remains PENDING while the student's
        // current grace window is open, then is promoted automatically to an
        // excluded Grade. If the window already ended, promotion happens in
        // this same transaction so the UI never reports a false pending save.
        const numericAttempt =
          String(body.status || "") === "درجة"
            ? await inspectNumericGradeAttempt(
                tx,
                studentId,
                examId,
                body.score,
              )
            : null;
        if (numericAttempt?.category) {
          const smartNote = await upsertGradeSmartNote({
            tx,
            category: numericAttempt.category,
            status: "PENDING",
            student: numericAttempt.student,
            exam: numericAttempt.exam,
            score: numericAttempt.score,
            reason: numericAttempt.reason,
            actor: {
              id: principal.id,
              name: principal.name || principal.username,
            },
          });

          if (smartNote.status !== "PENDING") {
            const resolvedGrade = await tx.grade.findUnique({
              where: { smartNoteId: smartNote.id },
            });
            // Compatibility with the first smart-note deployment: it created
            // a PROCESSED excluded Grade immediately. Do not delete or demote
            // those production rows. While grace is still open, a new direct
            // entry simply corrects the linked score and note in place, while
            // preserving PROCESSED + every permanent exclusion field.
            if (
              smartNote.category === "GRACE_SCORED" &&
              smartNote.status === "PROCESSED" &&
              resolvedGrade &&
              isStudentCurrentlyInGrace(numericAttempt.student)
            ) {
              const [updatedGrade, updatedSmartNote] = await Promise.all([
                tx.grade.update({
                  where: { id: resolvedGrade.id },
                  data: {
                    status: "درجة",
                    score: numericAttempt.score,
                    notes: numericAttempt.reason,
                  },
                }),
                tx.gradeSmartNote.update({
                  where: { id: smartNote.id },
                  data: {
                    score: numericAttempt.score,
                    reason: numericAttempt.reason,
                    attemptedById: principal.id,
                    attemptedByName: principal.name || principal.username,
                    attemptedAt: new Date(),
                  },
                }),
              ]);
              return {
                capturedAsSmartNote: false as const,
                pendingSmartNote: false as const,
                grade: updatedGrade,
                smartNote: updatedSmartNote,
                academicRecalculation: null,
                grandfatheredGraceGrade: true as const,
                message:
                  "تم تحديث الدرجة مباشرة مع بقائها مستبعدة دائماً من الأثر الأكاديمي.",
              };
            }
            if (resolvedGrade) {
              return {
                capturedAsSmartNote: false as const,
                pendingSmartNote: false as const,
                grade: resolvedGrade,
                smartNote,
                academicRecalculation: null,
                idempotentReplay: true as const,
                message:
                  "هذه المحاولة عولجت مسبقاً؛ أُعيدت النتيجة المحفوظة دون تكرار أي كتابة.",
              };
            }
            return {
              capturedAsSmartNote: true as const,
              pendingSmartNote: false as const,
              smartNoteConflict: true as const,
              grade: null,
              smartNote,
              academicRecalculation: null,
              idempotentReplay: true as const,
              message:
                smartNote.resolution ||
                "هذه المحاولة عولجت مسبقاً ولا يمكن فتحها مجدداً من ورقة الإدخال.",
            };
          }

          if (numericAttempt.category === "GRACE_SCORED") {
            const graceMigration = await reconcileExpiredGracePendingGrades({
              tx,
              noteIds: [smartNote.id],
              actor: {
                id: principal.id,
                name: principal.name || principal.username,
              },
            });
            const resolvedSmartNote = await tx.gradeSmartNote.findUnique({
              where: { id: smartNote.id },
              include: { resolutionGrade: true },
            });
            if (
              graceMigration.processed > 0 &&
              resolvedSmartNote?.resolutionGrade
            ) {
              return {
                capturedAsSmartNote: false as const,
                pendingSmartNote: false as const,
                grade: resolvedSmartNote.resolutionGrade,
                smartNote: resolvedSmartNote,
                academicRecalculation: null,
                message:
                  "انتهت فترة السماح؛ نُقلت الدرجة مباشرة إلى سجل الطالب وهي مستبعدة دائماً من الأثر الأكاديمي.",
              };
            }
            if (graceMigration.conflicts > 0) {
              return {
                capturedAsSmartNote: true as const,
                pendingSmartNote: false as const,
                smartNoteConflict: true as const,
                grade: null,
                smartNote: resolvedSmartNote || smartNote,
                academicRecalculation: null,
                message:
                  "لم تُستبدل الدرجة لأن للطالب سجلاً فعلياً محفوظاً لهذا الامتحان.",
              };
            }
          }

          return {
            capturedAsSmartNote: true as const,
            pendingSmartNote: true as const,
            grade: null,
            smartNote,
            academicRecalculation: null,
            message:
              "تم حفظ الدرجة كملاحظة ذكية معلّقة للمراجعة دون اعتمادها أو احتساب أي أثر أكاديمي.",
          };
        }

        const expectedUpdatedAt = String(body.expectedUpdatedAt || "").trim();
        const expectMissing = body.expectMissing === true;
        if (
          (expectMissing && existingGrade) ||
          (expectedUpdatedAt &&
            (!existingGrade ||
              existingGrade.updatedAt.toISOString() !== expectedUpdatedAt))
        ) {
          throw new GradeWriteConflictError();
        }
        const writeback = await syncAcademicGradeWriteback({
          tx,
          studentId,
          examId,
          status: body.status,
          score: body.score,
          notes: body.notes,
          academicAccountingChecked: body.academicAccountingChecked,
          sourceLabel: "تسجيل الدرجات",
          allowBlankGrade: false,
          blockOnLeave: true,
          enforceExamAvailability: true,
          // الواجهة تسمح بتصحيح الدرجة التي سببت فصل الطالب. نسمح بذلك
          // فقط إذا كان لهذا الطالب سجل موجود فعلاً في الامتحان؛ إنشاء
          // درجة جديدة لطالب مفصول يبقى ممنوعاً.
          allowDismissedExistingGradeCorrection: Boolean(existingGrade),
        });
        if (!writeback) {
          throw new AcademicGradeWritebackError(
            "يجب إدخال درجة صحيحة قبل حفظ السجل.",
          );
        }

        return { ...writeback, capturedAsSmartNote: false as const };
      },
    );

    if (result.capturedAsSmartNote) {
      await writeRequestAuditLog(
        req,
        "الدرجات",
        "حفظ محاولة درجة كملاحظة ذكية معلّقة",
        {
          smartNoteId: result.smartNote.id,
          category: result.smartNote.category,
          studentId: result.smartNote.studentId,
          examId: result.smartNote.examId,
          score: result.smartNote.score,
          status: result.smartNote.status,
        },
      );
      if ("smartNoteConflict" in result && result.smartNoteConflict) {
        return NextResponse.json(
          {
            ...result,
            error: result.message,
            requiresFreshGrade: true,
          },
          { status: 409 },
        );
      }
      return NextResponse.json(result, { status: 202 });
    }

    await writeRequestAuditLog(req, "الدرجات", "حفظ درجة وإعادة احتساب الطالب", {
      gradeId: result.grade.id,
      studentId: result.grade.studentId,
      examId: result.grade.examId,
      status: result.grade.status,
      score: result.grade.score,
      recalculatedStudents: result.academicRecalculation?.students?.length || 0,
      smartNoteId: result.smartNote?.id || null,
    });
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    if (error instanceof GradeWriteConflictError) {
      return NextResponse.json(
        { error: error.message, requiresFreshGrade: true },
        { status: 409 },
      );
    }
    if (error instanceof AcademicGradeWritebackError) {
      return validationError(error.message, error.status);
    }
    // أرجع تفاصيل الخطأ لسهولة التشخيص
    const err = error as { code?: string; message?: string; meta?: unknown };
    console.error("[API] POST /api/grades error:", JSON.stringify({
      code: err?.code,
      message: err?.message,
      meta: err?.meta,
      stack: (error as Error)?.stack?.split('\n').slice(0, 5),
    }));
    // لو خطأ migration غير مطبّق
    if (err?.code === 'P2021' || err?.code === 'P2022' || String(err?.message || '').includes('does not exist')) {
      return NextResponse.json(
        {
          error: "تعذر حفظ الدرجة لأن ترحيلات قاعدة البيانات الأخيرة غير مطبّقة. شغّل `npm run db:deploy` على الخادم.",
          code: err?.code,
          detail: err?.message,
        },
        { status: 503 },
      );
    }
    return NextResponse.json(
      {
        error: "تعذر حفظ الدرجة حالياً.",
        code: err?.code,
        detail: err?.message,
      },
      { status: 500 },
    );
  }
}

export async function PUT(req: NextRequest) {
  const authError = await requirePermission(req, "grades.edit");
  if (authError) return authError;

  try {
    await ensureExamSchema();
    await ensureFollowupTables();

    const body = (await req.json()) as Record<string, unknown>;
    const gradeId = String(body.id || "").trim();
    const lookupStudentId = String(body.studentId || "").trim();
    const lookupExamId = String(body.examId || "").trim();
    if (!gradeId && (!lookupStudentId || !lookupExamId)) {
      return validationError("تعذر تحديد الدرجة المطلوبة");
    }

    const targetGrade = gradeId
      ? await db.grade.findUnique({ where: { id: gradeId } })
      : await db.grade.findUnique({
          where: {
            studentId_examId: {
              studentId: lookupStudentId,
              examId: lookupExamId,
            },
          },
        });
    if (!targetGrade) {
      return validationError("سجل الدرجة غير موجود أو تم حذفه مسبقاً", 404);
    }

    // علاقة الدرجة ثابتة. تعديل السجل لا يجوز أن ينقله إلى طالب أو امتحان آخر.
    if (
      body.studentId !== undefined &&
      String(body.studentId || "").trim() !== targetGrade.studentId
    ) {
      return validationError(
        "لا يمكن نقل الدرجة إلى طالب آخر. احذف السجل وأنشئ درجة جديدة بعد التحقق من الطالب.",
      );
    }
    if (
      body.examId !== undefined &&
      String(body.examId || "").trim() !== targetGrade.examId
    ) {
      return validationError(
        "لا يمكن نقل الدرجة إلى امتحان آخر. احذف السجل وأنشئ درجة جديدة بعد التحقق من الامتحان.",
      );
    }

    const hasAcademicMutation = body.status !== undefined || body.score !== undefined;
    const hasMetadataMutation =
      body.notes !== undefined || body.academicAccountingChecked !== undefined;
    if (!hasAcademicMutation && !hasMetadataMutation) {
      return validationError("لا توجد تعديلات صالحة على سجل الدرجة.");
    }

    if (body.status !== undefined && !["درجة", "غائب", "غش"].includes(String(body.status))) {
      return validationError("حالة الدرجة غير صحيحة");
    }

    // ROOT-CAUSE FIX: Even on PUT, never accept a contradictory
    // (status != "درجة", score != null) payload. The effective score may
    // come from the request body OR the existing row when the caller only
    // sends `status` — so we validate BOTH branches explicitly below.
    try {
      // Branch A: caller supplied a new score in this request.
      if (body.score !== undefined) {
        assertGradeStatusScoreConsistency(body.status, body.score);
      }
      // Branch B: caller changed status but did not send a new score.
      // In that case the writeback layer preserves the existing score,
      // which would create a contradiction if the new status is not "درجة".
      // Reject this explicitly so the caller knows to send score: null.
      else if (
        body.status !== undefined &&
        String(body.status).trim() !== "درجة" &&
        targetGrade.score !== null &&
        targetGrade.score !== undefined
      ) {
        throw new AcademicGradeWritebackError(
          `لا يمكن تغيير الحالة إلى «${body.status}» لأن الطالب لديه درجة رقمية محفوظة (${targetGrade.score}). ` +
            `أرسل الحقل score: null مع الطلب لمسح الدرجة، أو غيّر الحالة إلى «درجة» مع درجة جديدة.`,
          400,
        );
      }
    } catch (error) {
      if (error instanceof AcademicGradeWritebackError) {
        return validationError(error.message, error.status);
      }
      throw error;
    }

    // Q100 FIX: SERIALIZABLE isolation with retry on conflict.
    const result = await withSerializableTransaction(async (tx) => {
      const freshTargetGrade = await tx.grade.findUnique({
        where: { id: targetGrade.id },
      });
      if (!freshTargetGrade) {
        throw new AcademicGradeWritebackError(
          "سجل الدرجة لم يعد موجوداً. حدّث الصفحة ثم حاول مجدداً.",
          404,
        );
      }
      const expectedUpdatedAt = String(body.expectedUpdatedAt || "").trim();
      if (
        expectedUpdatedAt &&
        freshTargetGrade.updatedAt.toISOString() !== expectedUpdatedAt
      ) {
        throw new GradeWriteConflictError();
      }
      if (!hasAcademicMutation) {
        const grade = await tx.grade.update({
          where: { id: freshTargetGrade.id },
          data: {
            ...(body.notes !== undefined ? { notes: String(body.notes || "") } : {}),
            ...(body.academicAccountingChecked !== undefined
              ? { academicAccountingChecked: Boolean(body.academicAccountingChecked) }
              : {}),
          },
        });
        return { grade, academicRecalculation: null };
      }

      const nextStatus = String(body.status ?? freshTargetGrade.status);
      if (
        isProtectedSmartNoteHistoricalGrade(freshTargetGrade) &&
        nextStatus !== "درجة"
      ) {
        throw new AcademicGradeWritebackError(
          "هذه درجة تاريخية مستبعدة من الأثر الأكاديمي. يمكن تصحيح رقمها أو ملاحظتها فقط، ولا يمكن تحويلها إلى غياب أو غش.",
          409,
        );
      }
      const nextScore =
        nextStatus === "درجة"
          ? body.score !== undefined
            ? body.score
            : freshTargetGrade.score
          : null;
      const writeback = await syncAcademicGradeWriteback({
        tx,
        studentId: freshTargetGrade.studentId,
        examId: freshTargetGrade.examId,
        status: nextStatus,
        score: nextScore,
        notes: body.notes !== undefined ? body.notes : freshTargetGrade.notes,
        academicAccountingChecked:
          body.academicAccountingChecked !== undefined
            ? body.academicAccountingChecked
            : freshTargetGrade.academicAccountingChecked,
        sourceLabel: "تعديل سجل الدرجات",
        allowBlankGrade: false,
        blockOnLeave: true,
        enforceExamAvailability: true,
        allowDismissedExistingGradeCorrection: true,
      });
      if (!writeback) {
        throw new AcademicGradeWritebackError(
          "يجب إدخال درجة صحيحة قبل حفظ التعديل.",
        );
      }
      return writeback;
    });

    await writeRequestAuditLog(req, "الدرجات", "تعديل درجة وإعادة احتساب الطالب", {
      gradeId: result.grade.id,
      studentId: result.grade.studentId,
      examId: result.grade.examId,
      status: result.grade.status,
      score: result.grade.score,
      relationshipChanged: false,
      recalculatedStudents: result.academicRecalculation?.students?.length || 0,
      accountingReviewInformationalOnly:
        body.academicAccountingChecked !== undefined && !hasAcademicMutation,
    });
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof GradeWriteConflictError) {
      return NextResponse.json(
        { error: error.message, requiresFreshGrade: true },
        { status: 409 },
      );
    }
    if (error instanceof AcademicGradeWritebackError) {
      return validationError(error.message, error.status);
    }
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
    const expectedUpdatedAt = String(
      searchParams.get("expectedUpdatedAt") || "",
    ).trim();

    const status = searchParams.get("status");

    if (examId && status === "غائب" && !studentId && !id) {
      // Q100 FIX: SERIALIZABLE isolation with retry on conflict.
      const result = await withSerializableTransaction(async (tx) => {
        const targetGrades = await tx.grade.findMany({
          where: {
            examId,
            status: "غائب",
            academicEffectExcluded: false,
          },
          select: { id: true, studentId: true },
        });
        const studentIds: string[] = Array.from(
          new Set(targetGrades.map((grade: { studentId: string }) => String(grade.studentId))),
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
          where: {
            examId,
            status: "غائب",
            academicEffectExcluded: false,
          },
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
      // Q100 FIX: SERIALIZABLE isolation with retry on conflict.
      const result = await withSerializableTransaction(async (tx) => {
        const targetGrade = await tx.grade.findUnique({
          where: { id },
          select: {
            id: true,
            studentId: true,
            updatedAt: true,
            academicEffectExcluded: true,
            academicEffectExclusionSource: true,
          },
        });
        if (targetGrade && isProtectedSmartNoteHistoricalGrade(targetGrade)) {
          throw new AcademicGradeWritebackError(
            "لا يمكن حذف هذه الدرجة التاريخية لأنها محفوظة للتوثيق ومستبعدة دائماً من الأثر الأكاديمي.",
            409,
          );
        }
        if (
          targetGrade &&
          expectedUpdatedAt &&
          targetGrade.updatedAt.toISOString() !== expectedUpdatedAt
        ) {
          throw new GradeWriteConflictError();
        }
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
      // وجود id يعني أن الطلب يستهدف هذا السجل حصراً. لا ننتقل إلى حذف
      // studentId/examId إذا اختفى السجل؛ فقد تكون درجة أحدث أُنشئت مكانه.
      await writeRequestAuditLog(req, "الدرجات", "حذف درجة وإعادة احتساب الطالب", {
        gradeId: id,
        deleted: result.deleted,
        affectedStudents: result.studentIds?.length || 0,
        studentIds: result.studentIds,
      });
      return NextResponse.json(result);
    }
    if (studentId && examId) {
      // Q100 FIX: SERIALIZABLE isolation with retry on conflict.
      const result = await withSerializableTransaction(async (tx) => {
        const targetGrade = await tx.grade.findUnique({
          where: { studentId_examId: { studentId, examId } },
          select: {
            id: true,
            studentId: true,
            academicEffectExcluded: true,
            academicEffectExclusionSource: true,
          },
        });
        if (targetGrade && isProtectedSmartNoteHistoricalGrade(targetGrade)) {
          throw new AcademicGradeWritebackError(
            "لا يمكن حذف هذه الدرجة التاريخية لأنها محفوظة للتوثيق ومستبعدة دائماً من الأثر الأكاديمي.",
            409,
          );
        }
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
    if (error instanceof AcademicGradeWritebackError) {
      return validationError(error.message, error.status);
    }
    return routeErrorResponse(error, "تعذر حذف الدرجة حالياً.");
  }
}
