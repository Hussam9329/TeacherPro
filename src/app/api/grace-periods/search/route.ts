export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/server-auth";
import { routeErrorResponse } from "@/lib/route-helpers";
import { withDatabaseSchema } from "@/lib/schema-readiness";
import { buildStudentRegistrySearchWhere } from "@/lib/student-registry-filters-server";
import { baghdadTodayKey } from "@/lib/baghdad-time";
import { gracePeriodState, type GracePeriodRange } from "@/lib/grace-periods";
import { loadActiveGracePeriodsByStudent } from "@/lib/grace-periods-server";

/** Where the student stands with grace today, for the search result badge. */
function graceSummary(periods: GracePeriodRange[] | undefined, today: string) {
  const current = (periods || []).find((period) => gracePeriodState(period, today) === "current");
  if (current) return { graceState: "current" as const, graceEndDate: current.endDate };
  return { graceState: periods?.length ? ("past" as const) : ("none" as const), graceEndDate: null };
}

/** Student search for the grace-management screen, using TeacherPro's shared search definition. */
export async function GET(req: NextRequest) {
  const authError = await requirePermission(req, "students.view");
  if (authError) return authError;
  try {
    const query = String(new URL(req.url).searchParams.get("q") || "").trim();
    if (query.length < 2) return NextResponse.json({ students: [] });
    const where = buildStudentRegistrySearchWhere(query);
    const students = await withDatabaseSchema(() => db.student.findMany({
      where: where || undefined,
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
    const periodsByStudent = await loadActiveGracePeriodsByStudent(db, students.map((student) => student.id));
    const today = baghdadTodayKey();
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
