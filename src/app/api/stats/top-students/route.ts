export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { requireAnyPermission } from "@/lib/server-auth";
import { db } from "@/lib/db";
import { baghdadDateKey, baghdadTodayKey } from "@/lib/baghdad-time";
import { routeErrorResponse, validationError } from "@/lib/route-helpers";
import { withDatabaseSchema } from "@/lib/schema-readiness";
import { rankTopStudents, TOP_STUDENT_EXAM_TYPES, type TopStudentsAttendance } from "@/lib/top-students";

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const LIMITS = [10, 20, 50];
const ACTIVE = "نشط";

/**
 * GET /api/stats/top-students — «الطلبة المتميزين» of one course.
 *   courseId (required) · chapterId · types=cumulative|withFinals
 *   period=last&last=1..10, or period=range&from=YYYY-MM-DD&to=YYYY-MM-DD
 *   attendance=all|zero · limit=10|20|50 · gender · studyType · courseProgram · locationScope
 * Active students only. Answers with the course's chapters (for the filter)
 * and the exams that were counted.
 */
export async function GET(req: NextRequest) {
  const authError = await requireAnyPermission(req, ["students.view", "grades.view"]);
  if (authError) return authError;

  const params = new URL(req.url).searchParams;
  const courseId = String(params.get("courseId") || "").trim();
  if (!courseId) return validationError("اختر الدورة.");
  const chapterId = String(params.get("chapterId") || "").trim();
  const types: string[] = params.get("types") === "withFinals" ? [...TOP_STUDENT_EXAM_TYPES] : ["تراكمي"];
  const period = params.get("period") === "range" ? "range" : "last";
  const last = Math.min(10, Math.max(1, Math.trunc(Number(params.get("last") || 3)) || 3));
  const from = String(params.get("from") || "");
  const to = String(params.get("to") || "");
  if (period === "range" && ((from && !DAY.test(from)) || (to && !DAY.test(to)))) return validationError("التاريخ غير صحيح.");
  if (period === "range" && from && to && from > to) return validationError("تاريخ البداية بعد تاريخ النهاية.");
  const attendance: TopStudentsAttendance = params.get("attendance") === "zero" ? "zero" : "all";
  const limit = LIMITS.includes(Number(params.get("limit"))) ? Number(params.get("limit")) : 10;
  const studentFilter = (key: string) => {
    const value = String(params.get(key) || "").trim();
    return value ? { [key]: value } : {};
  };

  try {
    const body = await withDatabaseSchema(async () => {
      const today = baghdadTodayKey();
      const course = await db.course.findUnique({ where: { id: courseId }, select: { id: true, name: true } });
      if (!course) return null;

      // The course's exams of the chosen types, held by today.
      const links = await db.examCourse.findMany({
        where: { courseId, exam: { type: { in: types } } },
        select: {
          chapterId: true,
          chapter: { select: { id: true, name: true } },
          exam: { select: { id: true, name: true, date: true, type: true, fullMark: true } },
        },
      });
      const chapters = new Map<string, string>();
      for (const link of links) if (link.chapter) chapters.set(link.chapter.id, link.chapter.name);

      let exams = links
        .filter((link) => !chapterId || link.chapterId === chapterId)
        .map((link) => ({ ...link.exam, date: baghdadDateKey(link.exam.date) || "" }))
        .filter((exam) => exam.date && exam.date <= today);
      if (period === "range") {
        exams = exams.filter((exam) => (!from || exam.date >= from) && (!to || exam.date <= to));
      } else {
        exams = exams.sort((a, b) => b.date.localeCompare(a.date) || b.name.localeCompare(a.name, "ar")).slice(0, last);
      }

      const students = await db.student.findMany({
        where: {
          courseId,
          status: ACTIVE,
          ...studentFilter("gender"),
          ...studentFilter("studyType"),
          ...studentFilter("courseProgram"),
          ...studentFilter("locationScope"),
        },
        select: { id: true, name: true, code: true, createdAt: true },
      });
      const grades = exams.length && students.length
        ? await db.grade.findMany({
          where: { examId: { in: exams.map((exam) => exam.id) }, studentId: { in: students.map((student) => student.id) } },
          select: { studentId: true, examId: true, status: true, score: true },
        })
        : [];

      const result = rankTopStudents({
        exams,
        students: students.map((student) => ({ ...student, createdAt: baghdadDateKey(student.createdAt) || null })),
        grades,
        attendance,
        limit,
      });
      return {
        course,
        chapters: [...chapters.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name, "ar")),
        ...result,
        generatedAt: new Date().toISOString(),
      };
    }, "Grade");
    if (!body) return validationError("الدورة غير موجودة.", 404);
    return NextResponse.json(body, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return routeErrorResponse(error, "تعذر تحميل الطلبة المتميزين.");
  }
}
