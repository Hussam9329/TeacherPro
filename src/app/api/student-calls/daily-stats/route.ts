export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getAuthPrincipal, oversees } from "@/lib/server-auth";
import { routeErrorResponse, validationError } from "@/lib/route-helpers";
import { withDatabaseSchema } from "@/lib/schema-readiness";
import { baghdadTodayKey } from "@/lib/baghdad-time";
import { parseCourseIds } from "@/lib/grade-classification";
import { CALL_CLIENT_PROTOCOL } from "@/lib/call-batch";
import {
  CALL_ACTION_CLEARED,
  CALL_ACTION_LOG_MODULE,
  CALL_ACTION_SET,
  baghdadDayRange,
  buildCallDailyStats,
} from "@/lib/call-daily-stats";
import { GET as callCandidates } from "../candidates/route";

/** «إحصائيات المكالمات» is for the admin («مدير عام») and the supervisors. */
async function requireOverseer(req: NextRequest) {
  const principal = await getAuthPrincipal(req);
  if (!principal) return NextResponse.json({ error: "سجّل الدخول أولاً." }, { status: 401 });
  if (!oversees(principal)) return NextResponse.json({ error: "إحصائيات المكالمات للمدير العام والمشرفين فقط." }, { status: 403 });
  return principal;
}

function readDay(value: unknown): string | null {
  const day = String(value || "").trim() || baghdadTodayKey();
  return baghdadDayRange(day) ? day : null;
}

/**
 * The number «المكالمات» shows for a course and an exam with «المخصومين»
 * chosen: the same list, asked for its count only.
 */
async function discountedCount(req: NextRequest, courseId: string, examId: string): Promise<number | null> {
  const url = new URL("/api/student-calls/candidates", req.url);
  url.search = new URLSearchParams({
    courseId,
    examId,
    statusFilter: "discounted",
    page: "1",
    pageSize: "1",
    client: String(CALL_CLIENT_PROTOCOL),
  }).toString();
  const response = await callCandidates(new NextRequest(url, { headers: req.headers }));
  if (!response.ok) return null;
  const body = (await response.json().catch(() => null)) as { totalCount?: unknown } | null;
  return typeof body?.totalCount === "number" ? body.totalCount : null;
}

/**
 * One Baghdad day: each employee's actions by course, and each course against
 * its required number — the «المخصومين» of the course's latest exam on that
 * day. Today's number follows the list; a past day keeps the number recorded
 * for it (recorded the first time the day is seen).
 */
export async function GET(req: NextRequest) {
  const principal = await requireOverseer(req);
  if (principal instanceof NextResponse) return principal;
  try {
    const day = readDay(new URL(req.url).searchParams.get("day"));
    if (!day) return validationError("التاريخ غير صحيح.");
    const today = baghdadTodayKey();
    const range = baghdadDayRange(day)!;
    const stats = await withDatabaseSchema(async () => {
      const [lines, courses, recorded, exams] = await Promise.all([
        db.auditLog.findMany({
          where: { module: CALL_ACTION_LOG_MODULE, action: { in: [CALL_ACTION_SET, CALL_ACTION_CLEARED] }, time: { gte: range.from, lt: range.to } },
          select: { time: true, action: true, details: true, userId: true, userName: true },
          orderBy: { time: "asc" },
        }),
        db.course.findMany({ where: { active: true }, select: { id: true, name: true }, orderBy: { createdAt: "asc" } }),
        db.callDailyTarget.findMany({ where: { day }, select: { courseId: true, target: true, examName: true } }),
        // Exams held on or before the day (an exam's date is its Baghdad day).
        db.exam.findMany({
          where: { date: { lt: new Date(Date.parse(`${day}T00:00:00Z`) + 24 * 60 * 60 * 1000) } },
          select: { id: true, name: true, date: true, courseIds: true },
          orderBy: [{ date: "desc" }, { name: "asc" }],
        }),
      ]);

      // The required number of each course for the day.
      const targets = new Map<string, number>();
      const targetExams = new Map<string, string>();
      const recordedByCourse = new Map(recorded.map((row) => [row.courseId, row]));
      for (const course of courses) {
        const saved = recordedByCourse.get(course.id);
        if (saved && day !== today) {
          targets.set(course.id, saved.target);
          targetExams.set(course.id, saved.examName);
          continue;
        }
        const exam = exams.find((item) => {
          const ids = parseCourseIds(item.courseIds);
          return ids.length === 0 || ids.includes(course.id);
        });
        if (!exam) continue;
        const count = await discountedCount(req, course.id, exam.id);
        if (count === null) continue;
        targets.set(course.id, count);
        targetExams.set(course.id, exam.name);
        if (day <= today) {
          await db.callDailyTarget.upsert({
            where: { day_courseId: { day, courseId: course.id } },
            create: { day, courseId: course.id, target: count, examId: exam.id, examName: exam.name, updatedById: principal.id, updatedByName: principal.name || "" },
            update: { target: count, examId: exam.id, examName: exam.name },
          });
        }
      }

      const studentIds = new Set<string>();
      for (const line of lines) {
        try {
          const id = String((JSON.parse(line.details || "{}") as Record<string, unknown>).studentId || "");
          if (id) studentIds.add(id);
        } catch {
          // A line that is not JSON is not a call action.
        }
      }
      const students = studentIds.size
        ? await db.student.findMany({ where: { id: { in: [...studentIds] } }, select: { id: true, courseId: true } })
        : [];
      const otherCourseIds = [...new Set(students.map((student) => student.courseId))].filter((id) => !courses.some((course) => course.id === id));
      const otherCourses = otherCourseIds.length
        ? await db.course.findMany({ where: { id: { in: otherCourseIds } }, select: { id: true, name: true } })
        : [];
      return buildCallDailyStats({
        lines,
        studentCourse: new Map(students.map((student) => [student.id, student.courseId])),
        courses,
        courseNames: new Map(otherCourses.map((course) => [course.id, course.name])),
        targets,
        targetExams,
      });
    }, "CallDailyTarget");
    return NextResponse.json({ day, today, ...stats }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return routeErrorResponse(error, "تعذر تحميل إحصائيات المكالمات.");
  }
}
