export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/server-auth";
import { db } from "@/lib/db";
import { routeErrorResponse } from "@/lib/route-helpers";
import { normalizeListFilter } from "@/lib/all-filter";
import { withFollowupTables } from "@/lib/followup-schema";

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
  date: Date;
  courseIds: string;
  fullMark: number;
  passMark: number;
  discountMark: number;
  noDiscount: boolean;
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

function parseCourseIds(value: string | null | undefined): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(String).filter(Boolean) : [];
  } catch {
    return [];
  }
}

function gradeMatchesStatusFilter(
  filter: CallStatusFilter,
  grade: DbGradeLite | undefined,
  exam: DbExamLite,
): boolean {
  if (filter === "all") return true;
  if (!grade) return false;
  const score =
    grade.status === "درجة" && grade.score !== null
      ? Number(grade.score)
      : null;
  const fullMark = Number(exam.fullMark || 0);
  const passMark = Number(exam.passMark || 0);
  const discountMark = Number(exam.discountMark || 0);

  switch (filter) {
    case "absent":
      return grade.status === "غائب";
    case "cheating":
      return grade.status === "غش";
    case "full":
      return score !== null && score === fullMark;
    case "passed":
      return score !== null && score >= passMark;
    case "discounted":
      return score !== null && !exam.noDiscount && score <= discountMark;
    case "failed":
      if (score === null) return false;
      if (exam.noDiscount) return score < passMark;
      return score > discountMark && score < passMark;
    case "academic-accounting":
      if (score === null || exam.noDiscount) return false;
      return score > discountMark && score < passMark;
    default:
      return true;
  }
}

function gradeCategory(
  grade: DbGradeLite | undefined,
  exam: DbExamLite,
): string {
  if (!grade) return "";
  if (grade.status === "غائب") return "غائب الغائبين";
  if (grade.status === "غش") return "غش طلاب الغش";
  if (grade.status === "درجة" && grade.score !== null) {
    const score = Number(grade.score);
    if (Number.isFinite(score)) {
      if (!exam.noDiscount && score <= Number(exam.discountMark || 0))
        return "مخصوم المخصومين خصم";
      if (score < Number(exam.passMark || 0)) return "راسب غير مخصوم الراسبين غير المخصومين";
      if (score === Number(exam.fullMark || 0)) return "درجة كاملة فل مارك";
      return "ناجح الناجحين";
    }
  }
  return "درجة مسجلة";
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
    gradeCategory(grade, exam),
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
        date: true,
        courseIds: true,
        fullMark: true,
        passMark: true,
        discountMark: true,
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

    const [students, grades] = await Promise.all([
      db.student.findMany({
        where: { courseId, status: { notIn: ["مفصول", "مؤرشف"] } },
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
          student: { is: { courseId, status: { notIn: ["مفصول", "مؤرشف"] } } },
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
    ]);

    const gradeByStudentId = new Map<string, DbGradeLite>();
    grades.forEach((grade) => gradeByStudentId.set(grade.studentId, grade));

    const matchingStudents = students.filter((student) => {
      const grade = gradeByStudentId.get(student.id);
      if (!gradeMatchesStatusFilter(statusFilter, grade, exam)) return false;
      if (
        generalSearch &&
        !includesSearch(generalSearch, searchableValues(student, grade, exam))
      )
        return false;
      if (
        filterSearch &&
        !includesSearch(filterSearch, searchableValues(student, grade, exam))
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
