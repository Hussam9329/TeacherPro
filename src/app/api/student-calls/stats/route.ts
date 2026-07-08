export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/server-auth";
import { db } from "@/lib/db";
import { routeErrorResponse } from "@/lib/route-helpers";
import { normalizeListFilter } from "@/lib/all-filter";
import { withFollowupTables } from "@/lib/followup-schema";
import {
  classifyGradeAcademicImpact,
  gradeKindForCalls,
  parseCourseIds,
} from "@/lib/grade-classification";
import { studentCourseScopeWhere } from "@/lib/student-scope";

type CallStatusFilter =
  | "all"
  | "absent"
  | "discounted"
  | "failed"
  | "cheating"
  | "passed"
  | "full";

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
  createdAt: Date;
  accountingGraceDays: number;
};

type DbGradeLite = {
  id: string;
  studentId: string;
  status: string;
  score: number | null;
  notes: string | null;
};

type DbExamLite = {
  id: string;
  name: string;
  type: string;
  date: Date;
  courseIds: string;
  fullMark: number;
  passMark: number;
  discountMark: number;
  dismissalGrade: number | null;
  noDiscount: boolean;
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
    normalized === "full"
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

function callGradeKind(
  grade: DbGradeLite | undefined,
  exam: DbExamLite,
  student?: DbStudentLite,
  leaves: DbLeaveLite[] = [],
) {
  return gradeKindForCalls(
    classifyGradeAcademicImpact(grade, exam, { student, leaves }),
  );
}

function gradeCategory(
  grade: DbGradeLite,
  exam: DbExamLite,
  student?: DbStudentLite,
  leaves: DbLeaveLite[] = [],
): "absent" | "discounted" | "failed" | "academic-accounting" | "full" | "passed" | "cheating" | "protected" | "missing" {
  return callGradeKind(grade, exam, student, leaves);
}

function gradeMatchesStatusFilter(
  filter: CallStatusFilter,
  grade: DbGradeLite | undefined,
  exam: DbExamLite,
  student?: DbStudentLite,
  leaves: DbLeaveLite[] = [],
): boolean {
  if (!grade) return false;
  const kind = callGradeKind(grade, exam, student, leaves);
  if (kind === "missing" || kind === "protected") return false;
  if (filter === "all") return true;
  if (filter === "passed") return kind === "passed" || kind === "full";
  if (filter === "failed") return kind === "failed" || kind === "academic-accounting";
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
) {
  const score = grade?.score ?? "";
  const category = grade ? gradeCategory(grade, exam, student, leaves) : "";
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
    exam.date?.toISOString?.().slice(0, 10),
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
        fullMark: true,
        passMark: true,
        discountMark: true,
        dismissalGrade: true,
        noDiscount: true,
      },
    });
    if (!exam) return NextResponse.json(zeroStats);
    const examCourseIds = parseCourseIds(exam.courseIds);
    if (examCourseIds.length > 0 && !examCourseIds.includes(courseId))
      return NextResponse.json(zeroStats);

    const examDayStart = startOfUtcDay(exam.date);
    const examDayEnd = dayAfter(exam.date);

    const [students, grades, leaves, calls] = await withFollowupTables(
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
              createdAt: true,
              accountingGraceDays: true,
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
        ]),
      "StudentCallStats",
    );

    const gradeByStudentId = new Map<string, DbGradeLite>();
    grades.forEach((grade) => gradeByStudentId.set(grade.studentId, grade));

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
      const grade = gradeByStudentId.get(call.studentId);
      const student = students.find((item) => item.id === call.studentId);
      if (!grade || !student) return;
      const category = gradeCategory(grade, exam, student, leavesByStudentId.get(call.studentId) || []);
      const exactCategory = `grade:${grade.id}`;
      if (call.category !== exactCategory && call.category !== category) return;
      if (!bestCallByStudentId.has(call.studentId)) {
        bestCallByStudentId.set(call.studentId, call);
      }
    });

    const matchingStudents = students.filter((student) => {
      const grade = gradeByStudentId.get(student.id);
      const studentLeaves = leavesByStudentId.get(student.id) || [];
      if (!gradeMatchesStatusFilter(statusFilter, grade, exam, student, studentLeaves)) return false;
      if (
        generalSearch &&
        !includesSearch(generalSearch, searchableValues(student, grade, exam, studentLeaves))
      )
        return false;
      if (
        filterSearch &&
        !includesSearch(filterSearch, searchableValues(student, grade, exam, studentLeaves))
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
      "تعذر تحميل إحصائيات المكالمات من قاعدة البيانات حالياً.",
    );
  }
}
