export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/server-auth";
import { db } from "@/lib/db";
import { routeErrorResponse } from "@/lib/route-helpers";
import { normalizeListFilter } from "@/lib/all-filter";
import { withFollowupTables } from "@/lib/followup-schema";

type CallStatusFilter =
  "all" | "absent" | "discounted" | "failed" | "cheating" | "passed" | "full";

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
  date: Date;
  courseIds: string;
  fullMark: number;
  passMark: number;
  discountMark: number;
  noDiscount: boolean;
};

const zeroStats = {
  total: 0,
  contacted: 0,
  unanswered: 0,
  wrong: 0,
  noAction: 0,
  source: "database" as const,
};

function parseCourseIds(value: string | null | undefined): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(String).filter(Boolean) : [];
  } catch {
    return [];
  }
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

function gradeCategory(
  grade: DbGradeLite,
  exam: DbExamLite,
): "absent" | "discounted" | "failed" | "full" | "passed" | "cheating" {
  if (grade.status === "غائب") return "absent";
  if (grade.status === "غش") return "cheating";
  if (grade.status === "درجة" && grade.score !== null) {
    const score = Number(grade.score);
    if (Number.isFinite(score)) {
      if (!exam.noDiscount && score <= Number(exam.discountMark || 0))
        return "discounted";
      if (score < Number(exam.passMark || 0)) return "failed";
      if (score === Number(exam.fullMark || 0)) return "full";
      return "passed";
    }
  }
  return "passed";
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
      if (exam.noDiscount) return score >= 1 && score < passMark;
      return score >= 1 && score <= discountMark;
    default:
      return true;
  }
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
  const score = grade?.score ?? "";
  const category = grade ? gradeCategory(grade, exam) : "";
  const labelByCategory: Record<string, string> = {
    absent: "غائب الغائبين",
    discounted: "مخصوم المخصومين خصم",
    failed: "راسب الراسبين",
    full: "درجة كاملة فل مارك",
    passed: "ناجح الناجحين",
    cheating: "غش طلاب الغش",
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
    const statusFilter = (normalizeListFilter(
      searchParams.get("statusFilter"),
    ) || "all") as CallStatusFilter;
    const generalSearch = String(searchParams.get("q") || "").trim();
    const filterSearch = String(searchParams.get("filterQ") || "").trim();

    if (!courseId || !examId) return NextResponse.json(zeroStats);

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
    if (!exam) return NextResponse.json(zeroStats);
    const examCourseIds = parseCourseIds(exam.courseIds);
    if (examCourseIds.length > 0 && !examCourseIds.includes(courseId))
      return NextResponse.json(zeroStats);

    const [students, grades, calls] = await withFollowupTables(
      () =>
        Promise.all([
          db.student.findMany({
            where: { courseId, status: { notIn: ["مفصول", "مؤرشف"] } },
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
            },
          }),
          db.grade.findMany({
            where: {
              examId,
              student: {
                is: { courseId, status: { notIn: ["مفصول", "مؤرشف"] } },
              },
            },
            select: {
              id: true,
              studentId: true,
              status: true,
              score: true,
              notes: true,
            },
          }),
          db.studentCall.findMany({
            where: {
              examId,
              student: {
                is: { courseId, status: { notIn: ["مفصول", "مؤرشف"] } },
              },
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

    const bestCallByStudentId = new Map<
      string,
      { status: string; completed: boolean }
    >();
    calls.forEach((call) => {
      const grade = gradeByStudentId.get(call.studentId);
      if (!grade) return;
      const category = gradeCategory(grade, exam);
      const exactCategory = `grade:${grade.id}`;
      if (call.category !== exactCategory && call.category !== category) return;
      if (!bestCallByStudentId.has(call.studentId)) {
        bestCallByStudentId.set(call.studentId, call);
      }
    });

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
