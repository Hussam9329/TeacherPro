export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/server-auth";
import { parseCourseIds } from "@/lib/exam-course-links";
import { routeErrorResponse, validationError } from "@/lib/route-helpers";
import { withDatabaseSchema } from "@/lib/schema-readiness";

/** Fresh, read-only form context. Leave staff need not also have exams.view,
 * and the startup exam cache may predate a change to an exam or enrollment. */
export async function GET(req: NextRequest) {
  const authError = await requirePermission(req, "follow-up.view");
  if (authError) return authError;

  const studentId = new URL(req.url).searchParams.get("studentId")?.trim();
  if (!studentId) return validationError("اختر الطالب لتحميل امتحاناته.");

  try {
    const context = await withDatabaseSchema(async () => {
      const student = await db.student.findUnique({ where: { id: studentId } });
      if (!student) return null;

      // Do not filter active exams, registration dates, or sites here: an
      // exam-specific leave accepts the course's exams. Period coverage adds
      // the student's site in the preview, matching getAffectedExamIds.
      const exams = await db.exam.findMany({
        select: {
          id: true,
          name: true,
          type: true,
          date: true,
          courseIds: true,
          mainSite: true,
          active: true,
        },
        orderBy: [{ date: "asc" }, { name: "asc" }, { id: "asc" }],
      });

      return {
        student,
        exams: exams
          .map((exam) => ({ ...exam, courseIds: parseCourseIds(exam.courseIds) }))
          .filter((exam) => exam.courseIds.includes(student.courseId)),
      };
    }, "Student leave form context");

    if (!context) return validationError("الطالب غير موجود أو تم حذفه.", 404);
    return NextResponse.json(context, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    return routeErrorResponse(error, "تعذر تحميل امتحانات الطالب. أعد المحاولة.");
  }
}
