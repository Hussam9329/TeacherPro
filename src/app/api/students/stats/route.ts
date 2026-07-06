export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/server-auth";
import { db } from "@/lib/db";
import { routeErrorResponse } from "@/lib/route-helpers";
import {
  STUDENT_STATUS_ACTIVE,
  STUDENT_STATUS_ARCHIVED,
  STUDENT_STATUS_DISMISSED,
  visibleStudentWhere,
} from "@/lib/student-scope";

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

    const visibleStudentsWhere = visibleStudentWhere();

    const [total, active, dismissed, archived, noActiveChapter] =
      await Promise.all([
        db.student.count({ where: visibleStudentsWhere }),
        db.student.count({ where: { status: STUDENT_STATUS_ACTIVE } }),
        db.student.count({ where: { status: STUDENT_STATUS_DISMISSED } }),
        db.student.count({ where: { status: STUDENT_STATUS_ARCHIVED } }),
        db.student.count({
          where: {
            ...visibleStudentsWhere,
            ...(activeCourseIds.length
              ? { courseId: { notIn: activeCourseIds } }
              : {}),
          },
        }),
      ]);

    return NextResponse.json({
      total,
      active,
      dismissed,
      archived,
      noActiveChapter,
      scope: "visible-except-archived" as const,
      source: "database" as const,
    });
  } catch (error) {
    return routeErrorResponse(
      error,
      "تعذر تحميل إحصائيات الطلاب من قاعدة البيانات حالياً.",
    );
  }
}
