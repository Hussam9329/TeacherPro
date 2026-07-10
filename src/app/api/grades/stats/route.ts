export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { Prisma } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/server-auth";
import { db } from "@/lib/db";
import { normalizeListFilter } from "@/lib/all-filter";
import { normalizeArabicText, routeErrorResponse } from "@/lib/route-helpers";
import { parseCourseIds, isGradeEnteredUnified } from "@/lib/grade-classification";
import { mergeStudentWhere, studentScopeWhere } from "@/lib/student-scope";
import {
  isExamOnOrAfterStudentRegistration,
  splitSelection,
  studentMatchesExamMainSites,
} from "@/lib/exam-utils";

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

function normalizeDateLike(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.toISOString() : null;
  return String(value);
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

    const studentWhereParts: Prisma.StudentWhereInput[] = [studentScopeWhere("visible")];
    if (selectedExam) {
      const examCourseIds = parseCourseIds(selectedExam.courseIds);
      if (courseId) studentWhereParts.push({ courseId });
      else if (examCourseIds.length > 0)
        studentWhereParts.push({ courseId: { in: examCourseIds } });
    } else if (courseId) {
      studentWhereParts.push({ courseId });
    }
    if (courseProgram) studentWhereParts.push({ courseProgram });
    if (courseProgram === "كورسات" && courseTerm)
      studentWhereParts.push({ courseTerm });
    if (studyType) studentWhereParts.push({ studyType });

    const students = await db.student.findMany({
      where: mergeStudentWhere(...studentWhereParts),
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
    const selectedExamForHelpers = selectedExam
      ? { ...selectedExam, date: normalizeDateLike(selectedExam.date) }
      : null;
    const scopedStudents = students.filter((student) => {
      if (selectedExam && selectedExamForHelpers) {
        const examCourseIds = parseCourseIds(selectedExam.courseIds);
        if (
          examCourseIds.length > 0 &&
          !examCourseIds.includes(student.courseId)
        )
          return false;
        const studentForHelpers = {
          ...student,
          createdAt: normalizeDateLike(student.createdAt),
        };
        if (!isExamOnOrAfterStudentRegistration(studentForHelpers, selectedExamForHelpers))
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
      if (isGradeEnteredUnified(grade, grade.exam))
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
      "تعذر تحميل إحصائيات الدرجات من بيانات النظام حالياً.",
    );
  }
}
