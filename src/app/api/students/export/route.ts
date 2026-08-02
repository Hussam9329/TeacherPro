export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { requirePermission } from "@/lib/server-auth";
import { db } from "@/lib/db";
import { normalizeListFilter } from "@/lib/all-filter";
import { STUDENT_STATUS_ARCHIVED } from "@/lib/student-scope";
import { buildStudentRegistryIssueWhere } from "@/lib/student-registry-issue-server";
import {
  buildStudentRegistryLocationWhere,
  buildStudentRegistrySearchWhere,
} from "@/lib/student-registry-filters-server";

async function buildStudentExportWhere(
  searchParams: URLSearchParams,
): Promise<Prisma.StudentWhereInput> {
  const and: Prisma.StudentWhereInput[] = [];
  const q = String(searchParams.get("q") || "").trim();
  const courseId = normalizeListFilter(searchParams.get("courseId"));
  const status = normalizeListFilter(searchParams.get("status"));
  const gender = normalizeListFilter(searchParams.get("gender"));
  const courseProgram = normalizeListFilter(searchParams.get("courseProgram"));
  const courseTerm = normalizeListFilter(searchParams.get("courseTerm"));
  const studyType = normalizeListFilter(searchParams.get("studyType"));
  const location = normalizeListFilter(
    searchParams.get("location") || searchParams.get("locationScope"),
  );

  if (courseId) and.push({ courseId });
  if (status) and.push({ status });
  else and.push({ status: { not: STUDENT_STATUS_ARCHIVED } });
  if (gender) and.push({ gender });
  if (courseProgram) and.push({ courseProgram });
  if (courseProgram === "كورسات" && courseTerm) and.push({ courseTerm });
  if (studyType) and.push({ studyType });

  const locationWhere = location
    ? buildStudentRegistryLocationWhere(location)
    : null;
  if (locationWhere) and.push(locationWhere);

  const searchWhere = buildStudentRegistrySearchWhere(q);
  if (searchWhere) and.unshift(searchWhere);

  const registryIssueWhere = await buildStudentRegistryIssueWhere(searchParams);
  if (registryIssueWhere) and.push(registryIssueWhere);

  return and.length > 0 ? { AND: and } : {};
}

export async function GET(req: NextRequest) {
  const authError = await requirePermission(req, "students.view");
  if (authError) return authError;

  try {
    const searchParams = new URL(req.url).searchParams;
    const where = await buildStudentExportWhere(searchParams);
    const [totalCount, students] = await Promise.all([
      db.student.count({ where }),
      db.student.findMany({
        where,
        orderBy: { createdAt: "desc" },
        include: { course: true },
      }),
    ]);

    return NextResponse.json({
      students,
      total: students.length,
      totalCount,
      capped: false,
    });
  } catch (error) {
    console.error("[API] /api/students/export error:", error);
    return NextResponse.json(
      { error: "تعذر تصدير بيانات الطلاب حالياً." },
      { status: 500 },
    );
  }
}
