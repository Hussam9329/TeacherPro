export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { requirePermission } from "@/lib/server-auth";
import { db } from "@/lib/db";
import { normalizeListFilter } from "@/lib/all-filter";
import { getStudentLocationFilterOptions } from "@/lib/student-list-filters";

/**
 * Returns distinct location options for student filtering without loading all
 * students in the browser. The returned options respect the previous filters
 * (course → program → term → study type → status), so the UI never offers an
 * impossible dependent option.
 */
export async function GET(req: NextRequest) {
  const authError = await requirePermission(req, "students.view");
  if (authError) return authError;

  try {
    const searchParams = new URL(req.url).searchParams;
    const and: Prisma.StudentWhereInput[] = [];

    const status = normalizeListFilter(searchParams.get("status"));
    if (status) and.push({ status });
    else and.push({ status: { not: "مؤرشف" } });

    const courseId = normalizeListFilter(searchParams.get("courseId"));
    if (courseId) and.push({ courseId });

    const courseProgram = normalizeListFilter(
      searchParams.get("courseProgram"),
    );
    if (courseProgram) and.push({ courseProgram });

    const courseTerm = normalizeListFilter(searchParams.get("courseTerm"));
    if (courseProgram === "كورسات" && courseTerm) and.push({ courseTerm });

    const studyType = normalizeListFilter(searchParams.get("studyType"));
    if (studyType) and.push({ studyType });

    const results = await db.student.findMany({
      where: and.length ? { AND: and } : {},
      select: { locationScope: true, subSite: true, mainSite: true },
      distinct: ["locationScope", "subSite", "mainSite"],
    });

    const locationOptions = getStudentLocationFilterOptions(results);

    return NextResponse.json({
      locationOptions,
      // Backward compatibility for older UI code that read locations[].scope.
      locations: locationOptions.map((value) => ({
        scope: value,
        value,
        subSite: "",
      })),
    });
  } catch (error) {
    console.error("[API] /api/students/filter-options error:", error);
    return NextResponse.json(
      { error: "تعذر تحميل خيارات الفلترة حالياً." },
      { status: 500 },
    );
  }
}
