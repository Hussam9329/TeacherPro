export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/server-auth";
import { db } from "@/lib/db";
import type { Prisma } from "@prisma/client";
import {
  buildDismissedHistoryScopeWhere,
  buildDismissedStudentWhere,
  composeDismissedStudentWhere,
  DISMISSED_STUDENT_PLEDGE_NOTE_KIND,
} from "@/lib/dismissed-student-filters-server";

async function collectDismissedStats(
  where: Prisma.StudentWhereInput,
): Promise<{
  total: number;
  current: number;
  former: number;
  withNotes: number;
  withPledge: number;
  withoutPledge: number;
}> {
  const [total, current, former, withNotes, pledgeRows] = await db.$transaction([
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
    db.studentNote.findMany({
      where: {
        kind: DISMISSED_STUDENT_PLEDGE_NOTE_KIND,
        student: where,
      },
      select: { studentId: true },
      distinct: ["studentId"],
    }),
  ]);
  const withPledge = pledgeRows.length;
  return {
    total,
    current,
    former,
    withNotes,
    withPledge,
    withoutPledge: Math.max(0, total - withPledge),
  };
}

export async function GET(req: NextRequest) {
  const authError = await requirePermission(req, "students.view");
  if (authError) return authError;

  const searchParams = new URL(req.url).searchParams;
  const systemWhere = buildDismissedHistoryScopeWhere(searchParams.get("historyScope"));
  const filteredWhere = buildDismissedStudentWhere(searchParams);

  const [system, filtered] = await Promise.all([
    collectDismissedStats(systemWhere),
    collectDismissedStats(filteredWhere),
  ]);

  return NextResponse.json({
    source: "database",
    stats: filtered,
    system,
    filtered,
  });
}
