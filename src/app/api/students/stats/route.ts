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
  visibleStudentWhere,
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

export async function GET(req: NextRequest) {
  const authError = await requirePermission(req, "students.view");
  if (authError) return authError;

  try {
    const searchParams = new URL(req.url).searchParams;
    const visibleStudentsWhere = visibleStudentWhere();
    const status = normalizeListFilter(searchParams.get("status"));
    const gender = normalizeListFilter(searchParams.get("gender"));
    const filters: Prisma.StudentWhereInput[] = [
      status ? { status } : visibleStudentsWhere,
    ];
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

    const [systemTotal, total, active, dismissed, archived, noActiveChapter] =
      await Promise.all([
        db.student.count(),
        db.student.count({ where: filteredWhere }),
        db.student.count({
          where: combineStudentWhere(filteredWhere, {
            status: STUDENT_STATUS_ACTIVE,
          }),
        }),
        db.student.count({
          where: combineStudentWhere(filteredWhere, {
            status: STUDENT_STATUS_DISMISSED,
          }),
        }),
        db.student.count({
          where: combineStudentWhere(filteredWhere, {
            status: STUDENT_STATUS_ARCHIVED,
          }),
        }),
        db.student.count({
          where: combineStudentWhere(
            filteredWhere,
            studentRegistryNoActiveChapterWhere(),
          ),
        }),
      ]);

    return NextResponse.json({
      systemTotal,
      total,
      active,
      dismissed,
      archived,
      noActiveChapter,
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
