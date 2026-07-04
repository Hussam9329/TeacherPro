export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/server-auth";
import { db } from "@/lib/db";
import { routeErrorResponse } from "@/lib/route-helpers";

export async function GET(req: NextRequest) {
  const authError = await requirePermission(req, "students.view");
  if (authError) return authError;

  try {
    const activeCourseLinks = await db.courseChapter.findMany({
      where: { active: true, archived: false },
      select: { courseId: true },
      distinct: ["courseId"],
    });
    const activeCourseIds = activeCourseLinks.map((link) => link.courseId);

    const [total, active, dismissed, noActiveChapter] = await Promise.all([
      db.student.count(),
      db.student.count({ where: { status: "نشط" } }),
      db.student.count({ where: { status: "مفصول" } }),
      db.student.count({
        where: activeCourseIds.length
          ? { courseId: { notIn: activeCourseIds } }
          : {},
      }),
    ]);

    return NextResponse.json({
      total,
      active,
      dismissed,
      noActiveChapter,
      source: "database" as const,
    });
  } catch (error) {
    return routeErrorResponse(error, "تعذر تحميل إحصائيات الطلاب من قاعدة البيانات حالياً.");
  }
}
