export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/server-auth";
import { db } from "@/lib/db";
import { baghdadDateKey } from "@/lib/baghdad-time";
import { routeErrorResponse } from "@/lib/route-helpers";
import { normalizeListFilter } from "@/lib/all-filter";
import { withFollowupTables } from "@/lib/followup-schema";
import {
  classifyGradeAcademicImpact,
  type GradeClassificationKind,
  gradeKindForCalls,
  parseCourseIds,
} from "@/lib/grade-classification";
import { studentCourseScopeWhere } from "@/lib/student-scope";
import {
  callGradeMatchesRangeForStatus,
  parseCallGradeRange,
} from "@/lib/call-grade-range";
import {
  buildImplicitCallAbsenceGrade,
  resolveCallAbsenceSource,
  type CallAbsenceSource,
} from "@/lib/call-absence";

type CallStatusFilter =
  | "all"
  | "absent"
  | "discounted"
  | "failed"
  | "cheating"
  | "passed"
  | "full"
  | "protected";

type ContactStatus = "" | "تم الاتصال" | "لم يرد" | "الرقم خاطئ";

type DbStudentLite = {
  id: string;
  name: string;
  code: string;
  phone: string | null;
  parentPhone: string | null;
  telegram: string | null;
  school: string;
  status: string;
  studyType: string | null;
  mainSite: string | null;
  subSite: string | null;
  locationScope: string | null;
  createdAt: Date;
  accountingGraceDays: number;
  gracePeriodStartDate: Date | null;
};

type DbGradeLite = {
  id: string;
  studentId: string;
  status: string;
  score: number | null;
  notes: string | null;
  academicEffectExcluded: boolean;
  academicEffectExclusionReason: string | null;
  academicEffectExclusionSource: string | null;
};

type DbExamLite = {
  id: string;
  name: string;
  type: string;
  date: Date;
  courseIds: string;
  mainSite: string | null;
  fullMark: number;
  passMark: number;
  discountMark: number;
  dismissalGrade: number | null;
  noDiscount: boolean;
  active: boolean;
  scheduledActivateAt: Date | null;
  scheduledDeactivateAt: Date | null;
};

type DbLeaveLite = {
  studentId: string;
  examId: string | null;
  leaveType: string;
  date: Date;
  dateFrom: Date | null;
  dateTo: Date | null;
};

const zeroStats = {
  total: 0,
  contacted: 0,
  unanswered: 0,
  wrong: 0,
  noAction: 0,
  source: "database" as const,
};

function normalizeCallStatusFilter(value: string | null): CallStatusFilter {
  const normalized = normalizeListFilter(value);
  // توافق مع روابط/تبويبات قديمة: المحاسبة صارت ضمن الراسبين غير المخصومين.
  if (normalized === "academic-accounting") return "failed";
  if (
    normalized === "absent" ||
    normalized === "discounted" ||
    normalized === "failed" ||
    normalized === "cheating" ||
    normalized === "passed" ||
    normalized === "full" ||
    normalized === "protected"
  ) {
    return normalized;
  }
  return "all";
}

function startOfUtcDay(value: Date): Date {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
}

function dayAfter(value: Date): Date {
  const next = startOfUtcDay(value);
  next.setUTCDate(next.getUTCDate() + 1);
  return next;
}

function normalizeContactStatus(
  call: { status: string; completed: boolean } | undefined,
): ContactStatus {
  if (!call) return "";
  const value = String(call.status || "").trim();
  if (value === "تم الاتصال" || value === "لم يرد" || value === "الرقم خاطئ")
    return value;
  return call.completed ? "تم الاتصال" : "";
}

function isDeductedImpact(kind: GradeClassificationKind): boolean {
  return (
    kind === "absent-deducted" ||
    kind === "absent-dismissal" ||
    kind === "discounted" ||
    kind === "dismissal" ||
    kind === "cheating"
  );
}

function classifyCallImpact(
  grade: DbGradeLite | undefined,
  exam: DbExamLite,
  student?: DbStudentLite,
  leaves: DbLeaveLite[] = [],
): GradeClassificationKind {
  return classifyGradeAcademicImpact(grade, exam, { student, leaves });
}

function callGradeKind(
  grade: DbGradeLite | undefined,
  exam: DbExamLite,
  student?: DbStudentLite,
  leaves: DbLeaveLite[] = [],
) {
  const impactKind = classifyCallImpact(grade, exam, student, leaves);
  return gradeKindForCalls(impactKind);
}

function gradeCategory(
  grade: DbGradeLite,
  exam: DbExamLite,
  student?: DbStudentLite,
  leaves: DbLeaveLite[] = [],
  absenceSource?: CallAbsenceSource | null,
): "absent" | "discounted" | "failed" | "academic-accounting" | "full" | "passed" | "cheating" | "protected" | "missing" {
  if (absenceSource) return "absent";
  return callGradeKind(grade, exam, student, leaves);
}

function gradeMatchesStatusFilter(
  filter: CallStatusFilter,
  grade: DbGradeLite | undefined,
  exam: DbExamLite,
  student?: DbStudentLite,
  leaves: DbLeaveLite[] = [],
  absenceSource?: CallAbsenceSource | null,
): boolean {
  if (!grade && !absenceSource) return false;
  const impactKind = classifyCallImpact(grade, exam, student, leaves);
  const kind = absenceSource ? "absent" : gradeKindForCalls(impactKind);
  // ROOT-CAUSE FIX (الإصلاح السابع — شمل المحميين في فلتر "كل الحالات"):
  // سابقاً: فلتر "all" كان يستثني kind === "missing" و kind === "protected".
  // الآن: يستثني فقط "missing" (لا توجد درجة). أما المحميون (مجاز، ضمن
  // السماح، قبل التسجيل، no-discount-protected، academic-effect-excluded)
  // فيُعرضون في "كل الحالات" ليطابق عددي سجل الدرجات. يمكن للمستخدم
  // استخدام فلتر "protected" لعرضهم منفصلين، أو الفلاتر الأخرى لاستثنائهم.
  if (filter === "all") {
    return Boolean(absenceSource) || kind !== "missing";
  }
  if (filter === "absent") return Boolean(absenceSource);
  if (filter === "discounted") return isDeductedImpact(impactKind);
  if (filter === "passed") return kind === "passed" || kind === "full";
  if (filter === "failed") {
    return !isDeductedImpact(impactKind) && (kind === "failed" || kind === "academic-accounting");
  }
  if (filter === "protected") return kind === "protected";
  return kind === filter;
}

function includesSearch(query: string, values: Array<unknown>): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return values.some((value) =>
    String(value ?? "")
      .toLowerCase()
      .includes(needle),
  );
}

function searchableValues(
  student: DbStudentLite,
  grade: DbGradeLite | undefined,
  exam: DbExamLite,
  leaves: DbLeaveLite[],
  absenceSource?: CallAbsenceSource | null,
) {
  const score = grade?.score ?? "";
  const category = grade
    ? gradeCategory(grade, exam, student, leaves, absenceSource)
    : "";
  const labelByCategory: Record<string, string> = {
    absent: "غائب الغائبين",
    discounted: "مخصوم المخصومين خصم",
    failed: "راسب غير مخصوم الراسبين غير المخصومين",
    "academic-accounting": "راسب غير مخصوم الراسبين غير المخصومين",
    full: "درجة كاملة فل مارك",
    passed: "ناجح الناجحين",
    cheating: "غش طلاب الغش",
    protected: "معفى محمي لا يدخل بالمحاسبة",
    missing: "غير مدخل",
  };
  return [
    student.name,
    student.code,
    student.phone,
    student.parentPhone,
    student.telegram,
    student.school,
    student.status,
    student.studyType,
    exam.name,
    baghdadDateKey(exam.date),
    grade?.status,
    grade?.notes,
    score,
    labelByCategory[category] || "",
  ];
}

export async function GET(req: NextRequest) {
  const authError = await requirePermission(req, "follow-up.view");
  if (authError) return authError;

  try {
    const { searchParams } = new URL(req.url);
    const courseId = normalizeListFilter(searchParams.get("courseId"));
    const examId = normalizeListFilter(searchParams.get("examId"));
    const statusFilter = normalizeCallStatusFilter(searchParams.get("statusFilter"));
    const gradeRange = parseCallGradeRange(
      searchParams.get("gradeFrom"),
      searchParams.get("gradeTo"),
    );
    const generalSearch = String(searchParams.get("q") || "").trim();
    const filterSearch = String(searchParams.get("filterQ") || "").trim();

    if (!courseId || !examId) return NextResponse.json(zeroStats);

    const exam = await db.exam.findUnique({
      where: { id: examId },
      select: {
        id: true,
        name: true,
        type: true,
        date: true,
        courseIds: true,
        mainSite: true,
        fullMark: true,
        passMark: true,
        discountMark: true,
        dismissalGrade: true,
        noDiscount: true,
        active: true,
        scheduledActivateAt: true,
        scheduledDeactivateAt: true,
      },
    });
    if (!exam) return NextResponse.json(zeroStats);
    const examCourseIds = parseCourseIds(exam.courseIds);
    if (examCourseIds.length > 0 && !examCourseIds.includes(courseId))
      return NextResponse.json(zeroStats);

    const examDayStart = startOfUtcDay(exam.date);
    const examDayEnd = dayAfter(exam.date);

    const [
      students,
      grades,
      leaves,
      calls,
      scoredAttempts,
      correctionAttempts,
      submissionAttempts,
    ] = await withFollowupTables(
      () =>
        Promise.all([
          db.student.findMany({
            where: studentCourseScopeWhere(courseId, "followup"),
            select: {
              id: true,
              name: true,
              code: true,
              phone: true,
              parentPhone: true,
              telegram: true,
              school: true,
              status: true,
              studyType: true,
              mainSite: true,
              subSite: true,
              locationScope: true,
              createdAt: true,
              accountingGraceDays: true,
              gracePeriodStartDate: true,
            },
          }),
          db.grade.findMany({
            where: {
              examId,
              student: { is: studentCourseScopeWhere(courseId, "followup") },
            },
            select: {
              id: true,
              studentId: true,
              status: true,
              score: true,
              notes: true,
              academicEffectExcluded: true,
              academicEffectExclusionReason: true,
              academicEffectExclusionSource: true,
            },
          }),
          db.studentLeave.findMany({
            where: {
              student: { is: studentCourseScopeWhere(courseId, "followup") },
              OR: [
                { examId },
                {
                  leaveType: "period",
                  dateFrom: { lt: examDayEnd },
                  dateTo: { gte: examDayStart },
                },
              ],
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
          db.studentCall.findMany({
            where: {
              examId,
              student: { is: studentCourseScopeWhere(courseId, "followup") },
            },
            orderBy: { createdAt: "desc" },
            select: {
              studentId: true,
              category: true,
              status: true,
              completed: true,
            },
          }),
          db.gradeSmartNote.findMany({
            where: {
              examId,
              score: { not: null },
              student: { is: studentCourseScopeWhere(courseId, "followup") },
            },
            select: { studentId: true },
          }),
          db.correctionSheet.findMany({
            where: {
              examId,
              student: { is: studentCourseScopeWhere(courseId, "followup") },
            },
            select: { studentId: true },
          }),
          db.telegramExamSubmission.findMany({
            where: {
              examId,
              student: { is: studentCourseScopeWhere(courseId, "followup") },
              OR: [
                { pageCount: { gt: 0 } },
                {
                  AND: [{ pages: { not: "[]" } }, { pages: { not: "" } }],
                },
              ],
            },
            select: { studentId: true },
          }),
        ]),
      "StudentCallStats",
    );

    const gradeByStudentId = new Map<string, DbGradeLite>();
    grades.forEach((grade) => gradeByStudentId.set(grade.studentId, grade));
    const attemptEvidenceStudentIds = new Set([
      ...scoredAttempts.map((note) => note.studentId),
      ...correctionAttempts.map((sheet) => sheet.studentId),
      ...submissionAttempts.map((submission) => submission.studentId),
    ]);
    const studentById = new Map<string, DbStudentLite>();
    students.forEach((student) => studentById.set(student.id, student));

    const leavesByStudentId = new Map<string, DbLeaveLite[]>();
    leaves.forEach((leave) => {
      const current = leavesByStudentId.get(leave.studentId) || [];
      current.push(leave);
      leavesByStudentId.set(leave.studentId, current);
    });

    const bestCallByStudentId = new Map<
      string,
      { status: string; completed: boolean }
    >();
    calls.forEach((call) => {
      const student = studentById.get(call.studentId);
      if (!student) return;
      const storedGrade = gradeByStudentId.get(call.studentId);
      const studentLeaves = leavesByStudentId.get(call.studentId) || [];
      const absenceSource = resolveCallAbsenceSource({
        grade: storedGrade,
        exam,
        student,
        leaves: studentLeaves,
        hasAttemptEvidence: attemptEvidenceStudentIds.has(student.id),
      });
      const grade =
        storedGrade ||
        (absenceSource === "missing"
          ? buildImplicitCallAbsenceGrade({
              studentId: student.id,
              examId: exam.id,
              examDate: exam.date,
            })
          : undefined);
      if (!grade) return;
      const category = gradeCategory(
        grade,
        exam,
        student,
        studentLeaves,
        absenceSource,
      );
      const exactCategory =
        absenceSource === "missing" ? "absent" : `grade:${grade.id}`;
      if (call.category !== exactCategory && call.category !== category) return;
      if (!bestCallByStudentId.has(call.studentId)) {
        bestCallByStudentId.set(call.studentId, call);
      }
    });

    const matchingStudents = students.filter((student) => {
      const storedGrade = gradeByStudentId.get(student.id);
      const studentLeaves = leavesByStudentId.get(student.id) || [];
      const absenceSource = resolveCallAbsenceSource({
        grade: storedGrade,
        exam,
        student,
        leaves: studentLeaves,
        hasAttemptEvidence: attemptEvidenceStudentIds.has(student.id),
      });
      const grade =
        storedGrade ||
        (absenceSource === "missing"
          ? buildImplicitCallAbsenceGrade({
              studentId: student.id,
              examId: exam.id,
              examDate: exam.date,
            })
          : undefined);
      if (
        !gradeMatchesStatusFilter(
          statusFilter,
          grade,
          exam,
          student,
          studentLeaves,
          absenceSource,
        )
      ) {
        return false;
      }
      if (!callGradeMatchesRangeForStatus(grade, gradeRange, statusFilter)) return false;
      if (
        generalSearch &&
        !includesSearch(
          generalSearch,
          searchableValues(student, grade, exam, studentLeaves, absenceSource),
        )
      )
        return false;
      if (
        filterSearch &&
        !includesSearch(
          filterSearch,
          searchableValues(student, grade, exam, studentLeaves, absenceSource),
        )
      )
        return false;
      return true;
    });

    const stats = matchingStudents.reduce(
      (acc, student) => {
        const status = normalizeContactStatus(
          bestCallByStudentId.get(student.id),
        );
        if (status === "تم الاتصال") acc.contacted += 1;
        else if (status === "لم يرد") acc.unanswered += 1;
        else if (status === "الرقم خاطئ") acc.wrong += 1;
        else acc.noAction += 1;
        return acc;
      },
      { ...zeroStats, total: matchingStudents.length },
    );

    return NextResponse.json(stats);
  } catch (error) {
    return routeErrorResponse(
      error,
      "تعذر تحميل إحصائيات المكالمات من بيانات النظام حالياً.",
    );
  }
}
