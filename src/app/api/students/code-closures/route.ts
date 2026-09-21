export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/server-auth";
import { routeErrorResponse } from "@/lib/route-helpers";
import { withDatabaseSchema } from "@/lib/schema-readiness";

export async function GET(req: NextRequest) {
  const authError = await requirePermission(req, "students.view");
  if (authError) return authError;

  try {
    // Return one complete snapshot, including existing checked flags. The dialog
    // filters this list locally; pagination or separate count queries could hide
    // pending students or produce counts from a different moment in time.
    const students = await withDatabaseSchema(() => db.student.findMany({
      where: { status: "مفصول" },
      select: {
        id: true,
        name: true,
        code: true,
        status: true,
        dismissedChecked: true,
        dismissedCheckEpoch: true,
        courseId: true,
        course: { select: { id: true, name: true } },
        dismissalReason: true,
      },
      orderBy: [{ name: "asc" }, { id: "asc" }],
    }), "Student");
    const checkedCount = students.reduce((count, student) => count + Number(student.dismissedChecked), 0);

    return NextResponse.json({
      students,
      totalCount: students.length,
      checkedCount,
      uncheckedCount: students.length - checkedCount,
      generatedAt: new Date().toISOString(),
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return routeErrorResponse(error, "تعذر تحميل قائمة اغلاق الكودات.");
  }
}
