export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { Prisma } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/server-auth";
import { db } from "@/lib/db";
import { normalizeListFilter } from "@/lib/all-filter";
import { normalizeArabicText, routeErrorResponse } from "@/lib/route-helpers";

function parseCourseIds(value: string | null | undefined): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(String).filter(Boolean) : [];
  } catch {
    return [];
  }
}

function splitSelection(value?: string | null): string[] {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function dateKey(value: unknown): string {
  return String(value || "").slice(0, 10);
}

function firstArabicLetter(value: unknown): string {
  const text = String(value || "").trim();
  if (!text) return "";
  return text[0]
    .replace(/[إأآٱ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/ى/g, "ي");
}

function matchesArabicLetterFilter(name: unknown, letter: string): boolean {
  if (!letter || letter === "all") return true;
  return firstArabicLetter(name) === letter;
}

function includesSearch(query: string, values: unknown[]): boolean {
  const needle = normalizeArabicText(query).toLowerCase();
  if (!needle) return true;
  return values.some((value) =>
    normalizeArabicText(String(value ?? ""))
      .toLowerCase()
      .includes(needle),
  );
}

function normalizeExamSiteValue(value?: string | null): string {
  const raw = normalizeArabicText(String(value || "").trim());
  if (!raw || raw === normalizeArabicText("الكل")) return raw || "";
  if (
    ["اونلاين", "الكتروني", "إلكتروني"].map(normalizeArabicText).includes(raw)
  )
    return normalizeArabicText("أونلاين");
  return raw;
}

function studentMatchesExamMainSites(
  student: {
    mainSite?: string | null;
    subSite?: string | null;
    locationScope?: string | null;
  },
  selectedMainSites: string[],
): boolean {
  const normalizedSelection = selectedMainSites
    .map(normalizeExamSiteValue)
    .filter(Boolean);
  if (
    normalizedSelection.length === 0 ||
    normalizedSelection.includes(normalizeExamSiteValue("الكل"))
  )
    return true;
  const values = new Set(
    [student.mainSite, student.subSite, student.locationScope]
      .map(normalizeExamSiteValue)
      .filter(Boolean),
  );
  return normalizedSelection.some((site) => values.has(site));
}

function isExamOnOrAfterStudentRegistration(
  student: { createdAt?: Date | string | null },
  exam: { date?: Date | string | null },
): boolean {
  const registeredAt = dateKey(student.createdAt);
  const examDate = dateKey(exam.date);
  if (!registeredAt || !examDate) return true;
  return examDate >= registeredAt;
}

function isGradeEntered(
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

function buildStudentSearchValues(
  student: {
    name: string;
    code: string;
    telegram: string | null;
    phone: string | null;
    parentPhone: string | null;
    school: string;
    subSite: string | null;
    locationScope: string | null;
    mainSite: string | null;
  },
  examName?: string,
) {
  return [
    student.name,
    student.code,
    student.telegram,
    student.phone,
    student.parentPhone,
    student.school,
    student.subSite,
    student.locationScope,
    student.mainSite,
    examName,
  ];
}

export async function GET(req: NextRequest) {
  const authError = await requirePermission(req, "grades.view");
  if (authError) return authError;

  try {
    const { searchParams } = new URL(req.url);
    const examId = normalizeListFilter(searchParams.get("examId"));
    const courseId = normalizeListFilter(searchParams.get("courseId"));
    const courseProgram = normalizeListFilter(
      searchParams.get("courseProgram"),
    );
    const courseTerm = normalizeListFilter(searchParams.get("courseTerm"));
    const studyType = normalizeListFilter(searchParams.get("studyType"));
    const nameLetter =
      normalizeListFilter(searchParams.get("nameLetter")) || "all";
    const q = String(searchParams.get("q") || "").trim();

    const selectedExam = examId
      ? await db.exam.findUnique({ where: { id: examId } })
      : null;

    const studentWhere: Prisma.StudentWhereInput = {};
    if (selectedExam) {
      const examCourseIds = parseCourseIds(selectedExam.courseIds);
      if (courseId) studentWhere.courseId = courseId;
      else if (examCourseIds.length > 0)
        studentWhere.courseId = { in: examCourseIds };
    } else if (courseId) {
      studentWhere.courseId = courseId;
    }
    if (courseProgram) studentWhere.courseProgram = courseProgram;
    if (courseProgram === "كورسات" && courseTerm)
      studentWhere.courseTerm = courseTerm;
    if (studyType) studentWhere.studyType = studyType;

    const students = await db.student.findMany({
      where: studentWhere,
      select: {
        id: true,
        name: true,
        code: true,
        telegram: true,
        phone: true,
        parentPhone: true,
        school: true,
        courseId: true,
        courseProgram: true,
        courseTerm: true,
        studyType: true,
        mainSite: true,
        subSite: true,
        locationScope: true,
        createdAt: true,
      },
    });

    const selectedMainSites = selectedExam
      ? splitSelection(selectedExam.mainSite)
      : [];
    const scopedStudents = students.filter((student) => {
      if (selectedExam) {
        const examCourseIds = parseCourseIds(selectedExam.courseIds);
        if (
          examCourseIds.length > 0 &&
          !examCourseIds.includes(student.courseId)
        )
          return false;
        if (!isExamOnOrAfterStudentRegistration(student, selectedExam))
          return false;
        if (!studentMatchesExamMainSites(student, selectedMainSites))
          return false;
      }
      if (!matchesArabicLetterFilter(student.name, nameLetter)) return false;
      if (
        q &&
        !includesSearch(
          q,
          buildStudentSearchValues(student, selectedExam?.name),
        )
      )
        return false;
      return true;
    });

    const scopedStudentIds = scopedStudents.map((student) => student.id);
    if (scopedStudentIds.length === 0) {
      return NextResponse.json({
        withGrade: 0,
        withoutGrade: 0,
        total: 0,
        source: "database" as const,
      });
    }

    const grades = await db.grade.findMany({
      where: {
        studentId: { in: scopedStudentIds },
        ...(selectedExam ? { examId: selectedExam.id } : {}),
      },
      select: {
        studentId: true,
        status: true,
        score: true,
        exam: { select: { fullMark: true } },
      },
    });

    const enteredStudentIds = new Set<string>();
    grades.forEach((grade) => {
      if (isGradeEntered(grade, grade.exam))
        enteredStudentIds.add(grade.studentId);
    });

    const withGrade = scopedStudents.filter((student) =>
      enteredStudentIds.has(student.id),
    ).length;
    const total = scopedStudents.length;

    return NextResponse.json({
      withGrade,
      withoutGrade: Math.max(0, total - withGrade),
      total,
      source: "database" as const,
    });
  } catch (error) {
    return routeErrorResponse(
      error,
      "تعذر تحميل إحصائيات الدرجات من قاعدة البيانات حالياً.",
    );
  }
}
