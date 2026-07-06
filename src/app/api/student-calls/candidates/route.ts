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
  | "academic-accounting"
  | "cheating"
  | "passed"
  | "full";

type DbStudentLite = {
  id: string;
  name: string;
  code: string;
  school: string;
  phone: string | null;
  parentPhone: string | null;
  telegram: string | null;
  status: string;
  studyType: string | null;
  createdAt: Date;
  accountingGraceDays: number;
};

type DbGradeLite = {
  id: string;
  studentId: string;
  examId: string;
  status: string;
  score: number | null;
  notes: string | null;
  academicAccountingChecked: boolean;
  createdAt: Date;
  updatedAt: Date;
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

const CALL_STUDENT_NOTE_CATEGORY = "call-student-note";

function parsePositiveInt(
  value: string | null,
  fallback: number,
  max: number,
): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return Math.min(Math.floor(parsed), max);
}

function startOfUtcDay(value: Date): Date {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
}

function dayAfter(value: Date): Date {
  const next = startOfUtcDay(value);
  next.setUTCDate(next.getUTCDate() + 1);
  return next;
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

function gradeMatchesStatusFilter(
  filter: CallStatusFilter,
  grade: DbGradeLite | undefined,
  exam: DbExamLite,
  student?: DbStudentLite,
  leaves: DbLeaveLite[] = [],
): boolean {
  if (filter === "all") return true;
  if (!grade) return false;
  const kind = callGradeKind(grade, exam, student, leaves);
  if (filter === "full") return kind === "full";
  return kind === filter;
}

function gradeCategory(
  grade: DbGradeLite | undefined,
  exam: DbExamLite,
  student?: DbStudentLite,
  leaves: DbLeaveLite[] = [],
): string {
  const kind = callGradeKind(grade, exam, student, leaves);
  if (kind === "absent") return "غائب الغائبين";
  if (kind === "cheating") return "غش طلاب الغش";
  if (kind === "discounted") return "مخصوم المخصومين خصم";
  if (kind === "failed") return "راسب غير مخصوم الراسبين غير المخصومين";
  if (kind === "full") return "درجة كاملة فل مارك";
  if (kind === "passed") return "ناجح الناجحين";
  if (kind === "protected") return "معفى محمي لا يدخل بالمحاسبة";
  return grade ? "درجة مسجلة" : "";
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
    grade?.score,
    gradeCategory(grade, exam, student, leaves),
  ];
}

export async function GET(req: NextRequest) {
  const authError = await requirePermission(req, "follow-up.view");
  if (authError) return authError;

  try {
    const { searchParams } = new URL(req.url);
    const courseId = normalizeListFilter(searchParams.get("courseId"));
    const examId = normalizeListFilter(searchParams.get("examId"));
    const statusFilter = (normalizeListFilter(
      searchParams.get("statusFilter"),
    ) || "all") as CallStatusFilter;
    const generalSearch = String(searchParams.get("q") || "").trim();
    const filterSearch = String(searchParams.get("filterQ") || "").trim();
    const page = parsePositiveInt(searchParams.get("page"), 1, 1_000_000);
    const pageSize = parsePositiveInt(searchParams.get("pageSize"), 120, 200);

    if (!courseId || !examId) {
      return NextResponse.json({
        students: [],
        grades: [],
        studentCalls: [],
        totalCount: 0,
        page,
        pageSize,
        totalPages: 1,
        hasMore: false,
        source: "database",
      });
    }

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
    if (!exam) {
      return NextResponse.json({
        students: [],
        grades: [],
        studentCalls: [],
        totalCount: 0,
        page,
        pageSize,
        totalPages: 1,
        hasMore: false,
        source: "database",
      });
    }
    const examCourseIds = parseCourseIds(exam.courseIds);
    if (examCourseIds.length > 0 && !examCourseIds.includes(courseId)) {
      return NextResponse.json({
        students: [],
        grades: [],
        studentCalls: [],
        totalCount: 0,
        page,
        pageSize,
        totalPages: 1,
        hasMore: false,
        source: "database",
      });
    }

    const examDayStart = startOfUtcDay(exam.date);
    const examDayEnd = dayAfter(exam.date);

    const [students, grades, leaves] = await Promise.all([
      db.student.findMany({
        where: studentCourseScopeWhere(courseId, "followup"),
        orderBy: [{ name: "asc" }, { createdAt: "desc" }],
        select: {
          id: true,
          name: true,
          school: true,
          gender: true,
          phone: true,
          parentPhone: true,
          telegram: true,
          courseProgram: true,
          courseTerm: true,
          studyType: true,
          locationScope: true,
          baghdadMode: true,
          mainSite: true,
          subSite: true,
          code: true,
          status: true,
          dismissalType: true,
          dismissalReason: true,
          dismissalNotes: true,
          opportunities: true,
          baseOpportunities: true,
          accountingGraceDays: true,
          createdAt: true,
          courseId: true,
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
          examId: true,
          status: true,
          score: true,
          notes: true,
          academicAccountingChecked: true,
          createdAt: true,
          updatedAt: true,
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
    ]);

    const gradeByStudentId = new Map<string, DbGradeLite>();
    grades.forEach((grade) => gradeByStudentId.set(grade.studentId, grade));

    const leavesByStudentId = new Map<string, DbLeaveLite[]>();
    leaves.forEach((leave) => {
      const current = leavesByStudentId.get(leave.studentId) || [];
      current.push(leave);
      leavesByStudentId.set(leave.studentId, current);
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

    const totalCount = matchingStudents.length;
    const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
    const pagedStudents = matchingStudents.slice(
      (page - 1) * pageSize,
      page * pageSize,
    );
    const pagedStudentIds = pagedStudents.map((student) => student.id);
    const pagedStudentIdSet = new Set(pagedStudentIds);
    const pagedGrades = grades.filter((grade) =>
      pagedStudentIdSet.has(grade.studentId),
    );

    const studentCalls = pagedStudentIds.length
      ? await withFollowupTables(
          () =>
            db.studentCall.findMany({
              where: {
                studentId: { in: pagedStudentIds },
                OR: [{ examId }, { category: CALL_STUDENT_NOTE_CATEGORY }],
              },
              orderBy: { createdAt: "desc" },
            }),
          "StudentCallCandidates",
        )
      : [];

    return NextResponse.json({
      students: pagedStudents,
      grades: pagedGrades,
      studentCalls,
      totalCount,
      page,
      pageSize,
      totalPages,
      hasMore: page < totalPages,
      source: "database",
    });
  } catch (error) {
    return routeErrorResponse(
      error,
      "تعذر تحميل طلاب المكالمات من قاعدة البيانات حالياً.",
    );
  }
}
