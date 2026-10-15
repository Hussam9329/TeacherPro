export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { randomUUID } from "node:crypto";
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
  CALL_STATS_EXAM_TYPES,
  baghdadDayRange,
  buildCallDailyStats,
  callLogExamIds,
  callLogStudentIds,
  isCallStatsExamType,
  type CallCourseExam,
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
 * The number «المكالمات» shows for a course and an exam with «المخصومين» or
 * «الدرجات الكاملة» chosen: the same list, asked for its count only.
 */
async function callListCount(req: NextRequest, courseId: string, examId: string, statusFilter: "discounted" | "full"): Promise<number | null> {
  const url = new URL("/api/student-calls/candidates", req.url);
  url.search = new URLSearchParams({
    courseId,
    examId,
    statusFilter,
    page: "1",
    pageSize: "1",
    client: String(CALL_CLIENT_PROTOCOL),
  }).toString();
  const response = await callCandidates(new NextRequest(url, { headers: req.headers }));
  if (!response.ok) return null;
  const body = (await response.json().catch(() => null)) as { totalCount?: unknown } | null;
  return typeof body?.totalCount === "number" ? body.totalCount : null;
}

type StatsExam = { id: string; name: string; date: Date; courseIds: string };

/** The course's latest cumulative (or final) exam held before `end`. */
function latestExam(exams: StatsExam[], courseId: string, end: number): StatsExam | undefined {
  return exams.find((exam) => {
    if (exam.date.getTime() >= end) return false;
    const ids = parseCourseIds(exam.courseIds);
    return ids.length === 0 || ids.includes(courseId);
  });
}

/** The end of a Baghdad day for exam dates (an exam's date is its Baghdad day). */
const examDayEnd = (day: string) => Date.parse(`${day}T00:00:00Z`) + 24 * 60 * 60 * 1000;

/**
 * One Baghdad day, cumulative and final exams only (a daily exam never shows):
 * each employee's actions by course that day, and each course against its
 * latest cumulative exam — the required number is one number for the exam,
 * its «المخصومين». While the exam is the course's latest the number only
 * grows (grades entered late), never drops while the calls go on; once a
 * newer exam comes it stays as it is. The work done counts every day of the
 * exam up to the end of the chosen one.
 */
export async function GET(req: NextRequest) {
  const principal = await requireOverseer(req);
  if (principal instanceof NextResponse) return principal;
  try {
    const day = readDay(new URL(req.url).searchParams.get("day"));
    if (!day) return validationError("التاريخ غير صحيح.");
    const today = baghdadTodayKey();
    const range = baghdadDayRange(day)!;
    const dayEnd = examDayEnd(day);
    const todayEnd = examDayEnd(today);
    const stats = await withDatabaseSchema(async () => {
      const [courses, exams] = await Promise.all([
        db.course.findMany({ where: { active: true }, select: { id: true, name: true }, orderBy: { createdAt: "asc" } }),
        db.exam.findMany({
          where: { type: { in: [...CALL_STATS_EXAM_TYPES] }, date: { lt: new Date(Math.max(dayEnd, todayEnd)) } },
          select: { id: true, name: true, date: true, courseIds: true },
          orderBy: [{ date: "desc" }, { name: "asc" }],
        }),
      ]);

      // Each course's exam on the day, and its latest exam now.
      const shown = new Map<string, StatsExam>();
      const current = new Map<string, StatsExam>();
      for (const course of courses) {
        const exam = latestExam(exams, course.id, dayEnd);
        if (exam) shown.set(course.id, exam);
        const latest = latestExam(exams, course.id, todayEnd);
        if (latest) current.set(course.id, latest);
      }
      const shownExamIds = [...new Set([...shown.values()].map((exam) => exam.id))];
      const [saved, legacy] = await Promise.all([
        db.callExamTarget.findMany({ where: { examId: { in: shownExamIds } }, select: { courseId: true, examId: true, target: true } }),
        // The numbers recorded per day before: the largest one starts the exam's number.
        db.callDailyTarget.groupBy({ by: ["courseId", "examId"], where: { examId: { in: shownExamIds } }, _max: { target: true } }),
      ]);
      const savedTarget = new Map(saved.map((row) => [`${row.courseId}|${row.examId}`, row.target]));
      const legacyTarget = new Map(legacy.map((row) => [`${row.courseId}|${row.examId}`, row._max.target ?? null]));

      const courseExams = new Map<string, CallCourseExam>();
      for (const course of courses) {
        const exam = shown.get(course.id);
        if (!exam) continue;
        const key = `${course.id}|${exam.id}`;
        const [discounted, full] = await Promise.all([
          callListCount(req, course.id, exam.id, "discounted"),
          callListCount(req, course.id, exam.id, "full"),
        ]);
        const kept = savedTarget.get(key) ?? legacyTarget.get(key) ?? null;
        const isLatest = current.get(course.id)?.id === exam.id;
        // Only the latest exam follows the list, and only upwards; an older
        // one keeps its number (or takes one the first time it is seen).
        const wanted = isLatest
          ? (discounted === null ? kept : Math.max(kept ?? 0, discounted))
          : (kept ?? discounted);
        let target = wanted;
        if (wanted !== null && wanted !== savedTarget.get(key)) {
          const rows = await db.$queryRaw<Array<{ target: number }>>`
            INSERT INTO "CallExamTarget" ("id", "courseId", "examId", "target", "examName", "updatedById", "updatedByName", "updatedAt")
            VALUES (${randomUUID()}, ${course.id}, ${exam.id}, ${wanted}::integer, ${exam.name}, ${principal.id}, ${principal.name || ""}, NOW())
            ON CONFLICT ("courseId", "examId") DO UPDATE SET
              "target" = CASE WHEN ${isLatest}::boolean THEN GREATEST("CallExamTarget"."target", EXCLUDED."target") ELSE "CallExamTarget"."target" END,
              "examName" = EXCLUDED."examName",
              "updatedAt" = CASE WHEN EXCLUDED."target" > "CallExamTarget"."target" AND ${isLatest}::boolean THEN NOW() ELSE "CallExamTarget"."updatedAt" END
            RETURNING "target"`;
          target = rows[0]?.target ?? wanted;
        }
        courseExams.set(course.id, { examId: exam.id, examName: exam.name, target, discounted, full });
      }

      // The calls log up to the end of the day, from the oldest exam shown on
      // (the courses count every day of their exam; the employees only the day).
      const oldestShown = Math.min(range.from.getTime(), ...[...shown.values()].map((exam) => exam.date.getTime() - 24 * 60 * 60 * 1000));
      const lines = await db.auditLog.findMany({
        where: {
          module: CALL_ACTION_LOG_MODULE,
          action: { in: [CALL_ACTION_SET, CALL_ACTION_CLEARED] },
          time: { gte: new Date(oldestShown), lt: range.to },
        },
        select: { time: true, action: true, details: true, userId: true, userName: true },
        orderBy: { time: "asc" },
      });
      const examIds = callLogExamIds(lines);
      const examTypes = examIds.length
        ? await db.exam.findMany({ where: { id: { in: examIds } }, select: { id: true, type: true } })
        : [];
      const countedExamIds = new Set(examTypes.filter((exam) => isCallStatsExamType(exam.type)).map((exam) => exam.id));
      const studentIds = callLogStudentIds(lines.filter((line) => {
        try {
          return countedExamIds.has(String((JSON.parse(line.details || "{}") as Record<string, unknown>).examId || ""));
        } catch {
          return false;
        }
      }));
      const students = studentIds.length
        ? await db.student.findMany({ where: { id: { in: studentIds } }, select: { id: true, courseId: true } })
        : [];
      const otherCourseIds = [...new Set(students.map((student) => student.courseId))].filter((id) => !courses.some((course) => course.id === id));
      const otherCourses = otherCourseIds.length
        ? await db.course.findMany({ where: { id: { in: otherCourseIds } }, select: { id: true, name: true } })
        : [];
      return buildCallDailyStats({
        lines,
        day: range,
        examTypes: new Map(examTypes.map((exam) => [exam.id, exam.type])),
        studentCourse: new Map(students.map((student) => [student.id, student.courseId])),
        courses,
        courseNames: new Map(otherCourses.map((course) => [course.id, course.name])),
        courseExams,
      });
    }, "CallExamTarget");
    return NextResponse.json({ day, today, ...stats }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return routeErrorResponse(error, "تعذر تحميل إحصائيات المكالمات.");
  }
}
