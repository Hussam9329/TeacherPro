export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { requireAnyPermission } from "@/lib/server-auth";
import { db } from "@/lib/db";
import { ARCHIVED_STUDENT_STATUS } from "@/lib/student-delete-impact";
import {
  isExamOnOrAfterStudentRegistration,
  splitSelection,
  studentMatchesExamMainSites,
} from "@/lib/exam-utils";
import { routeErrorResponse, validationError } from "@/lib/route-helpers";

function parseCourseIds(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String).filter(Boolean);
  const text = String(value || "");
  if (!text.trim()) return [];
  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) return parsed.map(String).filter(Boolean);
  } catch {
    // دعم نسخ قديمة خزنتها كقائمة مفصولة بفواصل.
  }
  return text
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function dateKey(value: unknown): string {
  return String(value || "").slice(0, 10);
}

function dayAfter(date: Date): Date {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + 1);
  return next;
}

export async function GET(req: NextRequest) {
  const authError = await requireAnyPermission(req, [
    "grades.add",
    "grades.view",
    "grades.edit",
  ]);
  if (authError) return authError;

  try {
    const { searchParams } = new URL(req.url);
    const examId = String(searchParams.get("examId") || "").trim();
    if (!examId) return validationError("يجب اختيار الامتحان أولاً");

    const exam = await db.exam.findUnique({ where: { id: examId } });
    if (!exam) return validationError("الامتحان غير موجود", 404);

    const linkedCourseIds = parseCourseIds(exam.courseIds);
    if (linkedCourseIds.length === 0) {
      return NextResponse.json({
        exam,
        students: [],
        grades: [],
        studentLeaves: [],
        opportunityLogs: [],
        courseChapters: [],
        source: "database",
      });
    }

    const courseChapters = await db.courseChapter.findMany({
      where: {
        courseId: { in: linkedCourseIds },
        active: true,
        archived: false,
      },
      include: { course: true, chapter: true },
    });
    const activeCourseIds = Array.from(
      new Set(courseChapters.map((link) => link.courseId)),
    );

    if (activeCourseIds.length === 0) {
      return NextResponse.json({
        exam,
        students: [],
        grades: [],
        studentLeaves: [],
        opportunityLogs: [],
        courseChapters,
        source: "database",
      });
    }

    const selectedMainSites = splitSelection(exam.mainSite);
    // Normalize exam for the date-comparison helpers (which expect date strings,
    // not Date objects returned by Prisma).
    const examForHelpers = {
      ...exam,
      date: exam.date instanceof Date ? exam.date.toISOString() : exam.date ? String(exam.date) : null,
      scheduledActivateAt: exam.scheduledActivateAt instanceof Date ? exam.scheduledActivateAt.toISOString() : exam.scheduledActivateAt ?? null,
      scheduledDeactivateAt: exam.scheduledDeactivateAt instanceof Date ? exam.scheduledDeactivateAt.toISOString() : exam.scheduledDeactivateAt ?? null,
    };
    const possibleStudentsRaw = await db.student.findMany({
      where: {
        courseId: { in: activeCourseIds },
        status: { not: ARCHIVED_STUDENT_STATUS },
      },
      orderBy: { name: "asc" },
    });

    // Normalize createdAt to ISO string for isExamOnOrAfterStudentRegistration,
    // which expects a string | null | undefined (not a Date).
    const possibleStudents = possibleStudentsRaw.map((s) => ({
      ...s,
      createdAt:
        s.createdAt instanceof Date
          ? s.createdAt.toISOString()
          : s.createdAt
            ? String(s.createdAt)
            : null,
    }));

    const students = possibleStudents.filter(
      (student) =>
        isExamOnOrAfterStudentRegistration(student, examForHelpers) &&
        studentMatchesExamMainSites(student, selectedMainSites),
    );
    const studentIds = students.map((student) => student.id);

    const examDate = new Date(`${dateKey(exam.date)}T00:00:00.000Z`);
    const nextExamDate = dayAfter(examDate);

    const [grades, studentLeaves, opportunityLogs] = await Promise.all([
      db.grade.findMany({ where: { examId }, orderBy: { updatedAt: "desc" } }),
      studentIds.length
        ? db.studentLeave.findMany({
            where: {
              studentId: { in: studentIds },
              OR: [
                { examId },
                {
                  leaveType: "period",
                  dateFrom: { lt: nextExamDate },
                  dateTo: { gte: examDate },
                },
              ],
            },
            orderBy: [{ dateFrom: "desc" }, { date: "desc" }],
            include: { student: true, exam: true },
          })
        : Promise.resolve([]),
      studentIds.length
        ? db.opportunityLog.findMany({
            where: {
              studentId: { in: studentIds },
              OR: [{ examId }, { action: "إعادة تفعيل" }],
            },
            orderBy: { date: "desc" },
          })
        : Promise.resolve([]),
    ]);

    return NextResponse.json({
      exam,
      students,
      grades,
      studentLeaves,
      opportunityLogs,
      courseChapters,
      source: "database",
    });
  } catch (error) {
    return routeErrorResponse(error, "تعذر تحميل ورقة إدخال الدرجات حالياً.");
  }
}
