export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/server-auth";
import { routeErrorResponse } from "@/lib/route-helpers";
import {
  buildDismissedHistoryScopeWhere,
  buildDismissedStudentWhere,
  composeDismissedStudentWhere,
} from "@/lib/dismissed-student-filters-server";

async function collectDismissedStats(where: Prisma.StudentWhereInput) {
  const [total, current, former, withNotes] =
    await db.$transaction([
      db.student.count({ where }),
      db.student.count({
        where: composeDismissedStudentWhere([
          where,
          buildDismissedHistoryScopeWhere("current"),
        ]),
      }),
      db.student.count({
        where: composeDismissedStudentWhere([
          where,
          buildDismissedHistoryScopeWhere("former"),
        ]),
      }),
      db.student.count({
        where: composeDismissedStudentWhere([
          where,
          { dismissalNotes: { not: "" } },
        ]),
      }),
    ]);
  return {
    total,
    current,
    former,
    withNotes,
  };
}

export async function GET(req: NextRequest) {
  const authError = await requirePermission(req, "students.view");
  if (authError) return authError;

  try {
    const searchParams = new URL(req.url).searchParams;
    const systemWhere = buildDismissedHistoryScopeWhere("all");
    const filteredWhere = buildDismissedStudentWhere(searchParams);
    const [system, filtered] = await Promise.all([
      collectDismissedStats(systemWhere),
      collectDismissedStats(filteredWhere),
    ]);

    return NextResponse.json(
      {
        source: "database" as const,
        stats: filtered,
        system,
        filtered,
      },
      {
        headers: { "Cache-Control": "private, no-store, max-age=0" },
      },
    );
  } catch (error) {
    return routeErrorResponse(
      error,
      "تعذر تحميل إحصائيات إدارة المفصولين من بيانات النظام.",
    );
  }
}
