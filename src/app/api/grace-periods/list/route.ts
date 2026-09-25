export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/server-auth";
import { routeErrorResponse } from "@/lib/route-helpers";
import { withDatabaseSchema } from "@/lib/schema-readiness";
import { buildStudentRegistrySearchWhere } from "@/lib/student-registry-filters-server";
import { baghdadTodayKey } from "@/lib/baghdad-time";
import { normalizeGracePeriodListFilter } from "@/lib/grace-periods";
import { graceDateColumn, toGracePeriodRange } from "@/lib/grace-periods-server";

const LIST_LIMIT = 300;

const periodSelect = {
  id: true,
  studentId: true,
  startDate: true,
  endDate: true,
  source: true,
  student: {
    select: { name: true, code: true, status: true, course: { select: { name: true } } },
  },
} satisfies Prisma.GracePeriodSelect;

/**
 * GET /api/grace-periods/list?filter=all|current|past&q=
 * Read-only smart list of active (not cancelled) grace periods. Ongoing
 * periods come first, ending soonest; ended ones follow, most recent first.
 */
export async function GET(req: NextRequest) {
  const authError = await requirePermission(req, "students.view");
  if (authError) return authError;
  try {
    const params = new URL(req.url).searchParams;
    const filter = normalizeGracePeriodListFilter(params.get("filter"));
    const query = String(params.get("q") || "").trim();
    const studentWhere = query.length >= 2 ? buildStudentRegistrySearchWhere(query) : null;
    const today = baghdadTodayKey();
    const todayColumn = graceDateColumn(today);

    const base: Prisma.GracePeriodWhereInput = {
      cancelledAt: null,
      ...(studentWhere ? { student: studentWhere } : {}),
    };
    const currentWhere: Prisma.GracePeriodWhereInput = { ...base, endDate: { gte: todayColumn } };
    const pastWhere: Prisma.GracePeriodWhereInput = { ...base, endDate: { lt: todayColumn } };

    const result = await withDatabaseSchema(async () => {
      const [currentCount, pastCount, current, past] = await Promise.all([
        db.gracePeriod.count({ where: currentWhere }),
        db.gracePeriod.count({ where: pastWhere }),
        filter === "past"
          ? Promise.resolve([])
          : db.gracePeriod.findMany({
              where: currentWhere,
              select: periodSelect,
              orderBy: [{ endDate: "asc" }, { startDate: "asc" }],
              take: LIST_LIMIT,
            }),
        filter === "current"
          ? Promise.resolve([])
          : db.gracePeriod.findMany({
              where: pastWhere,
              select: periodSelect,
              orderBy: [{ endDate: "desc" }, { startDate: "desc" }],
              take: LIST_LIMIT,
            }),
      ]);
      return { currentCount, pastCount, rows: [...current, ...past].slice(0, LIST_LIMIT) };
    }, "GracePeriod");

    const total =
      filter === "current" ? result.currentCount
      : filter === "past" ? result.pastCount
      : result.currentCount + result.pastCount;

    return NextResponse.json(
      {
        today,
        filter,
        counts: {
          all: result.currentCount + result.pastCount,
          current: result.currentCount,
          past: result.pastCount,
        },
        truncated: total > result.rows.length,
        periods: result.rows.map((row) => ({
          ...toGracePeriodRange(row),
          source: row.source,
          studentId: row.studentId,
          studentName: row.student.name,
          studentCode: row.student.code,
          studentStatus: row.student.status,
          courseName: row.student.course?.name || "",
        })),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return routeErrorResponse(error, "تعذر تحميل قائمة فترات السماح.");
  }
}
