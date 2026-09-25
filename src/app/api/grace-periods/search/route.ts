export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/server-auth";
import { routeErrorResponse } from "@/lib/route-helpers";
import { withDatabaseSchema } from "@/lib/schema-readiness";
import { buildStudentRegistrySearchWhere } from "@/lib/student-registry-filters-server";

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
        course: { select: { name: true } },
      },
      orderBy: [{ name: "asc" }, { code: "asc" }],
      take: 20,
    }), "Student");
    return NextResponse.json(
      {
        students: students.map((student) => ({
          id: student.id,
          name: student.name,
          code: student.code,
          status: student.status,
          telegram: student.telegram || "",
          courseName: student.course?.name || "",
        })),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return routeErrorResponse(error, "تعذر البحث عن الطالب.");
  }
}
