export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/server-auth";
import { db } from "@/lib/db";
import { routeErrorResponse } from "@/lib/route-helpers";
import { buildDismissedStudentWhere } from "@/lib/dismissed-student-filters-server";
import { attachStudentOpportunitySnapshots } from "@/lib/student-opportunity-snapshot-server";
import { withStudentMutationToken } from "@/lib/student-mutation-token";

function positiveInteger(
  searchParams: URLSearchParams,
  key: string,
  fallback: number,
): number {
  const value = Number(searchParams.get(key) ?? fallback);
  if (!Number.isFinite(value) || value <= 0) return fallback;
  return Math.trunc(value);
}

export async function GET(req: NextRequest) {
  const authError = await requirePermission(req, "students.view");
  if (authError) return authError;

  try {
    const searchParams = new URL(req.url).searchParams;
    const page = positiveInteger(searchParams, "page", 1);
    const pageSize = Math.min(
      100,
      positiveInteger(searchParams, "pageSize", 50),
    );
    const where = buildDismissedStudentWhere(searchParams);

    const [totalCount, students] = await db.$transaction([
      db.student.count({ where }),
      db.student.findMany({
        where,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
    const studentsWithOpportunity = await attachStudentOpportunitySnapshots(
      students,
    );

    return NextResponse.json({
      students: studentsWithOpportunity.map((student) =>
        withStudentMutationToken(
          student as unknown as Record<string, unknown>,
        ),
      ),
      totalCount,
      page,
      pageSize,
      totalPages,
      hasMore: page < totalPages,
      source: "database" as const,
    });
  } catch (error) {
    return routeErrorResponse(
      error,
      "تعذر تحميل قائمة الطلاب المفصولين من بيانات النظام.",
    );
  }
}
