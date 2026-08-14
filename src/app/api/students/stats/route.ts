export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { requirePermission } from "@/lib/server-auth";
import { db } from "@/lib/db";
import { normalizeListFilter } from "@/lib/all-filter";
import { routeErrorResponse } from "@/lib/route-helpers";
import {
  STUDENT_STATUS_ACTIVE,
  STUDENT_STATUS_ARCHIVED,
  STUDENT_STATUS_DISMISSED,
} from "@/lib/student-scope";
import {
  buildStudentRegistryLocationWhere,
  buildStudentRegistrySearchWhere,
} from "@/lib/student-registry-filters-server";
import {
  buildStudentRegistryIssueWhere,
  studentRegistryNoActiveChapterWhere,
} from "@/lib/student-registry-issue-server";

function combineStudentWhere(
  ...parts: Array<Prisma.StudentWhereInput | null | undefined>
): Prisma.StudentWhereInput {
  const valid = parts.filter(Boolean) as Prisma.StudentWhereInput[];
  if (valid.length === 0) return {};
  if (valid.length === 1) return valid[0];
  return { AND: valid };
}

type StudentStatusCountRow = {
  status: string;
  _count: { _all: number };
};

function buildStatusCounts(
  rows: StudentStatusCountRow[],
  noActiveChapter: number,
) {
  const countsByStatus = new Map(
    rows.map((row) => [row.status, row._count._all]),
  );
  const total = rows.reduce((sum, row) => sum + row._count._all, 0);
  const active = countsByStatus.get(STUDENT_STATUS_ACTIVE) || 0;
  const dismissed = countsByStatus.get(STUDENT_STATUS_DISMISSED) || 0;
  const archived = countsByStatus.get(STUDENT_STATUS_ARCHIVED) || 0;

  return {
    total,
    active,
    dismissed,
    archived,
    other: Math.max(0, total - active - dismissed - archived),
    noActiveChapter,
  };
}

export async function GET(req: NextRequest) {
  const authError = await requirePermission(req, "students.view");
  if (authError) return authError;

  try {
    const searchParams = new URL(req.url).searchParams;
    const status = normalizeListFilter(searchParams.get("status"));
    const gender = normalizeListFilter(searchParams.get("gender"));
    const filters: Prisma.StudentWhereInput[] = status ? [{ status }] : [];
    const courseId = normalizeListFilter(searchParams.get("courseId"));
    const courseProgram = normalizeListFilter(
      searchParams.get("courseProgram"),
    );
    const courseTerm = normalizeListFilter(searchParams.get("courseTerm"));
    const studyType = normalizeListFilter(searchParams.get("studyType"));
    const location = normalizeListFilter(searchParams.get("location"));
    const query = String(searchParams.get("q") || "").trim();

    if (gender) filters.push({ gender });
    if (courseId) filters.push({ courseId });
    if (courseProgram) filters.push({ courseProgram });
    if (courseProgram === "كورسات" && courseTerm) filters.push({ courseTerm });
    if (studyType) filters.push({ studyType });
    const selectedLocationWhere = buildStudentRegistryLocationWhere(location);
    if (selectedLocationWhere) filters.push(selectedLocationWhere);
    const selectedSearchWhere = buildStudentRegistrySearchWhere(query);
    if (selectedSearchWhere) filters.push(selectedSearchWhere);
    const selectedIssueWhere = await buildStudentRegistryIssueWhere(searchParams);
    if (selectedIssueWhere) filters.push(selectedIssueWhere);

    const filteredWhere = combineStudentWhere(...filters);

    const [
      systemStatusRows,
      filteredStatusRows,
      systemNoActiveChapter,
      filteredNoActiveChapter,
    ] = await Promise.all([
      db.student.groupBy({
        by: ["status"],
        _count: { _all: true },
      }),
      db.student.groupBy({
        by: ["status"],
        where: filteredWhere,
        _count: { _all: true },
      }),
      db.student.count({
        where: studentRegistryNoActiveChapterWhere(),
      }),
      db.student.count({
        where: combineStudentWhere(
          filteredWhere,
          studentRegistryNoActiveChapterWhere(),
        ),
      }),
    ]);

    const system = buildStatusCounts(systemStatusRows, systemNoActiveChapter);
    const filtered = buildStatusCounts(
      filteredStatusRows,
      filteredNoActiveChapter,
    );

    return NextResponse.json({
      system,
      filtered,
      // Keep the original filtered fields while clients migrate to the
      // explicit system/filtered scopes above.
      systemTotal: system.total,
      total: filtered.total,
      active: filtered.active,
      dismissed: filtered.dismissed,
      archived: filtered.archived,
      other: filtered.other,
      noActiveChapter: filtered.noActiveChapter,
      scope: "all" as const,
      source: "database" as const,
    });
  } catch (error) {
    return routeErrorResponse(
      error,
      "تعذر تحميل إحصائيات الطلاب من بيانات النظام حالياً.",
    );
  }
}
