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
 * «الدرجات الكاملة» chosen: the same list, asked for its count only — and how
 * many of them are there only because no grade is entered yet.
 */
async function callListCount(req: NextRequest, courseId: string, examId: string, statusFilter: "discounted" | "full"): Promise<{ total: number; missing: number } | null> {
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
  const body = (await response.json().catch(() => null)) as { totalCount?: unknown; missingCount?: unknown } | null;
  if (typeof body?.totalCount !== "number") return null;
  const missing = typeof body.missingCount === "number" ? Math.min(body.missingCount, body.totalCount) : 0;
  return { total: body.totalCount, missing };
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

const timeOfLine = (line: { time: Date } | undefined) => (line ? line.time.getTime() : 0);

/**
 * One Baghdad day, cumulative and final exams only (a daily exam never shows):
 * each employee's actions by course that day, and each course against its
 * latest cumulative exam — the required number is one number for the exam,
 * its «المخصومين». The part with an entered grade is kept: while the exam is
 * the course's latest it only grows (grades entered late), never drops while
 * the calls go on, and once a newer exam comes it stays as it is. Students
 * with no grade entered yet (an absence from the day after the exam) are
 * added as they are now, so entering a passing grade for one takes them out.
 * The work done counts every day of the exam up to the end of the chosen one.
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
      const shownExams = [...new Map([...shown.values()].map((exam) => [exam.id, exam])).values()];
      // The old numbers per day are not read: they counted students with no
      // grade entered yet, which would stay in the number for good.
      const saved = await db.callExamTarget.findMany({
        where: { examId: { in: shownExams.map((exam) => exam.id) }, recorded: { not: null } },
        select: { courseId: true, examId: true, recorded: true },
      });
      const savedTarget = new Map(saved.map((row) => [`${row.courseId}|${row.examId}`, row.recorded as number]));

      // Courses are counted three at a time instead of one after another: each
      // one loads its whole list twice, so the page waited for the sum of all.
      const courseResults = new Array<CallCourseExam | null>(courses.length).fill(null);
      let nextCourse = 0;
      const countCourse = async (course: (typeof courses)[number]): Promise<CallCourseExam | null> => {
        const exam = shown.get(course.id);
        if (!exam) return null;
        const key = `${course.id}|${exam.id}`;
        const [discounted, full] = await Promise.all([
          callListCount(req, course.id, exam.id, "discounted"),
          callListCount(req, course.id, exam.id, "full"),
        ]);
        const kept = savedTarget.get(key) ?? null;
        const isLatest = current.get(course.id)?.id === exam.id;
        // «المخصومين» with an entered grade: only the latest exam follows the
        // list, and only upwards; an older one keeps its number (or takes one
        // the first time it is seen).
        const recorded = discounted === null ? null : discounted.total - discounted.missing;
        const wanted = isLatest
          ? (recorded === null ? kept : Math.max(kept ?? 0, recorded))
          : (kept ?? recorded);
        let stored = wanted;
        if (wanted !== null && wanted !== savedTarget.get(key)) {
          // "recorded" is the kept part; a row from before it (null) is
          // counted again from the list instead of trusted.
          const rows = await db.$queryRaw<Array<{ recorded: number }>>`
            INSERT INTO "CallExamTarget" ("id", "courseId", "examId", "target", "recorded", "examName", "updatedById", "updatedByName", "updatedAt")
            VALUES (${randomUUID()}, ${course.id}, ${exam.id}, ${wanted}::integer, ${wanted}::integer, ${exam.name}, ${principal.id}, ${principal.name || ""}, NOW())
            ON CONFLICT ("courseId", "examId") DO UPDATE SET
              "recorded" = CASE
                WHEN "CallExamTarget"."recorded" IS NULL THEN EXCLUDED."recorded"
                WHEN ${isLatest}::boolean THEN GREATEST("CallExamTarget"."recorded", EXCLUDED."recorded")
                ELSE "CallExamTarget"."recorded" END,
              "target" = CASE
                WHEN "CallExamTarget"."recorded" IS NULL THEN EXCLUDED."recorded"
                WHEN ${isLatest}::boolean THEN GREATEST("CallExamTarget"."recorded", EXCLUDED."recorded")
                ELSE "CallExamTarget"."recorded" END,
              "examName" = EXCLUDED."examName",
              "updatedAt" = NOW()
            RETURNING "recorded"`;
          stored = rows[0]?.recorded ?? wanted;
        }
        // Students with no grade entered yet count as they are now.
        const target = stored === null ? null : stored + (discounted?.missing ?? 0);
        return { examId: exam.id, examName: exam.name, target, discounted: discounted?.total ?? null, full: full?.total ?? null };
      };
      await Promise.all(
        Array.from({ length: Math.min(3, courses.length) }, async () => {
          while (nextCourse < courses.length) {
            const index = nextCourse++;
            courseResults[index] = await countCourse(courses[index]);
          }
        }),
      );
      // Same order as before: the courses' own order.
      const courseExams = new Map<string, CallCourseExam>();
      courses.forEach((course, index) => {
        const result = courseResults[index];
        if (result) courseExams.set(course.id, result);
      });

      // The calls log up to the end of the day: the whole day (the employees),
      // and before it only each shown exam's own lines from its date on (the
      // courses count every day of their exam).
      const DAY_MS = 24 * 60 * 60 * 1000;
      const lines = await db.auditLog.findMany({
        where: {
          module: CALL_ACTION_LOG_MODULE,
          action: { in: [CALL_ACTION_SET, CALL_ACTION_CLEARED] },
          time: { lt: range.to },
          OR: [
            { time: { gte: range.from } },
            ...shownExams.map((exam) => ({
              time: { gte: new Date(exam.date.getTime() - DAY_MS) },
              details: { contains: `"examId":${JSON.stringify(exam.id)}` },
            })),
          ],
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
      const [students, moves] = studentIds.length
        ? await Promise.all([
          db.student.findMany({ where: { id: { in: studentIds } }, select: { id: true, courseId: true } }),
          // A student moved to another course: their calls before the move
          // stay with the course they were in.
          db.studentEnrollmentArchive.findMany({
            where: { studentId: { in: studentIds }, resetKind: "course-transfer", createdAt: { gte: new Date(timeOfLine(lines[0])) } },
            select: { studentId: true, fromCourseId: true, createdAt: true },
            orderBy: { createdAt: "asc" },
          }),
        ])
        : [[], []];
      const courseMoves = new Map<string, Array<{ at: Date; fromCourseId: string }>>();
      for (const move of moves) {
        courseMoves.set(move.studentId, [...(courseMoves.get(move.studentId) || []), { at: move.createdAt, fromCourseId: move.fromCourseId }]);
      }
      const otherCourseIds = [...new Set([...students.map((student) => student.courseId), ...moves.map((move) => move.fromCourseId)])]
        .filter((id) => !courses.some((course) => course.id === id));
      const otherCourses = otherCourseIds.length
        ? await db.course.findMany({ where: { id: { in: otherCourseIds } }, select: { id: true, name: true } })
        : [];
      return buildCallDailyStats({
        lines,
        day: range,
        examTypes: new Map(examTypes.map((exam) => [exam.id, exam.type])),
        studentCourse: new Map(students.map((student) => [student.id, student.courseId])),
        courseMoves,
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
