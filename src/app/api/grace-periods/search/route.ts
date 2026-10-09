export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireAnyPermission } from "@/lib/server-auth";
import { GRACE_VIEW_PERMISSIONS } from "@/lib/permission-catalog";
import { routeErrorResponse } from "@/lib/route-helpers";
import { withDatabaseSchema } from "@/lib/schema-readiness";
import { buildStudentRegistrySearchWhere } from "@/lib/student-registry-filters-server";
import { baghdadTodayKey } from "@/lib/baghdad-time";
import { gracePeriodState, isEndedNewStudentGrace, type GracePeriodRange } from "@/lib/grace-periods";
import { toGracePeriodRange } from "@/lib/grace-periods-server";

/** Where the student stands with grace today, for the search result badge. */
function graceSummary(periods: GracePeriodRange[] | undefined, today: string) {
  const current = (periods || []).find((period) => gracePeriodState(period, today) === "current");
  if (current) return { graceState: "current" as const, graceEndDate: current.endDate };
  return { graceState: periods?.length ? ("past" as const) : ("none" as const), graceEndDate: null };
}

/** Student search for the grace-management screen, using TeacherPro's shared search definition. */
export async function GET(req: NextRequest) {
  const authError = await requireAnyPermission(req, GRACE_VIEW_PERMISSIONS);
  if (authError) return authError;
  try {
    const query = String(new URL(req.url).searchParams.get("q") || "").trim();
    if (query.length < 2) return NextResponse.json({ students: [] });
    const where = buildStudentRegistrySearchWhere(query);
    // Archived students are hidden from the search.
    const students = await withDatabaseSchema(() => db.student.findMany({
      where: { AND: [where || {}, { status: { not: "مؤرشف" } }] },
      select: {
        id: true,
        name: true,
        code: true,
        status: true,
        telegram: true,
        username: true,
        createdAt: true,
        course: { select: { name: true } },
      },
      orderBy: [{ name: "asc" }, { code: "asc" }],
      take: 20,
    }), "Student");
    const today = baghdadTodayKey();
    // An ended automatic period of a new student gives no red light.
    const periodsByStudent = new Map<string, GracePeriodRange[]>();
    const periodRows = students.length ? await db.gracePeriod.findMany({
      where: { studentId: { in: students.map((student) => student.id) }, cancelledAt: null },
      select: { id: true, studentId: true, startDate: true, endDate: true, note: true },
      orderBy: [{ studentId: "asc" }, { startDate: "asc" }],
    }) : [];
    for (const row of periodRows) {
      const period = { ...toGracePeriodRange(row), note: row.note };
      if (isEndedNewStudentGrace(period, today)) continue;
      periodsByStudent.set(row.studentId, [...(periodsByStudent.get(row.studentId) || []), period]);
    }
    return NextResponse.json(
      {
        today,
        students: students.map((student) => ({
          id: student.id,
          name: student.name,
          code: student.code,
          status: student.status,
          telegram: student.telegram || "",
          username: student.username || "",
          createdAt: student.createdAt.toISOString(),
          courseName: student.course?.name || "",
          ...graceSummary(periodsByStudent.get(student.id), today),
        })),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return routeErrorResponse(error, "تعذر البحث عن الطالب.");
  }
}
