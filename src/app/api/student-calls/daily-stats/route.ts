export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getAuthPrincipal, oversees } from "@/lib/server-auth";
import { routeErrorResponse, validationError } from "@/lib/route-helpers";
import { withDatabaseSchema } from "@/lib/schema-readiness";
import { baghdadTodayKey } from "@/lib/baghdad-time";
import {
  CALL_ACTION_CLEARED,
  CALL_ACTION_LOG_MODULE,
  CALL_ACTION_SET,
  baghdadDayRange,
  buildCallDailyStats,
} from "@/lib/call-daily-stats";

const MAX_TARGET = 100000;

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

/** One Baghdad day: each employee's actions by course, and each course against its target. */
export async function GET(req: NextRequest) {
  const principal = await requireOverseer(req);
  if (principal instanceof NextResponse) return principal;
  try {
    const day = readDay(new URL(req.url).searchParams.get("day"));
    if (!day) return validationError("التاريخ غير صحيح.");
    const range = baghdadDayRange(day)!;
    const stats = await withDatabaseSchema(async () => {
      const [lines, courses, targets] = await Promise.all([
        db.auditLog.findMany({
          where: { module: CALL_ACTION_LOG_MODULE, action: { in: [CALL_ACTION_SET, CALL_ACTION_CLEARED] }, time: { gte: range.from, lt: range.to } },
          select: { time: true, action: true, details: true, userId: true, userName: true },
          orderBy: { time: "asc" },
        }),
        db.course.findMany({ where: { active: true }, select: { id: true, name: true }, orderBy: { createdAt: "asc" } }),
        db.callDailyTarget.findMany({ where: { day }, select: { courseId: true, target: true } }),
      ]);
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
        targets: new Map(targets.map((item) => [item.courseId, item.target])),
      });
    }, "CallDailyTarget");
    return NextResponse.json({ day, today: baghdadTodayKey(), ...stats }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return routeErrorResponse(error, "تعذر تحميل إحصائيات المكالمات.");
  }
}

/** The calls a course needs on a day; an empty value removes it. */
export async function PUT(req: NextRequest) {
  const principal = await requireOverseer(req);
  if (principal instanceof NextResponse) return principal;
  try {
    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    const day = readDay(body?.day);
    if (!day) return validationError("التاريخ غير صحيح.");
    const courseId = typeof body?.courseId === "string" ? body.courseId.trim() : "";
    if (!courseId || courseId.length > 128) return validationError("تعذر تحديد الدورة.");
    const raw = body?.target;
    const target = raw === null || raw === "" || raw === undefined ? null : Number(raw);
    if (target !== null && (!Number.isInteger(target) || target < 0 || target > MAX_TARGET)) {
      return validationError("العدد المطلوب لازم يكون رقم صحيح من 0 فما فوق.");
    }
    const saved = await withDatabaseSchema(async () => {
      const course = await db.course.findUnique({ where: { id: courseId }, select: { id: true } });
      if (!course) return null;
      if (target === null) {
        await db.callDailyTarget.deleteMany({ where: { day, courseId } });
        return { day, courseId, target: null };
      }
      const row = await db.callDailyTarget.upsert({
        where: { day_courseId: { day, courseId } },
        create: { day, courseId, target, updatedById: principal.id, updatedByName: principal.name || principal.username || "" },
        update: { target, updatedById: principal.id, updatedByName: principal.name || principal.username || "" },
      });
      return { day, courseId, target: row.target };
    }, "CallDailyTarget");
    if (!saved) return validationError("الدورة غير موجودة.", 404);
    return NextResponse.json(saved, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return routeErrorResponse(error, "تعذر حفظ العدد المطلوب.");
  }
}
