export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/server-auth";
import { db } from "@/lib/db";
import { normalizeListFilter } from "@/lib/all-filter";
import { parseCourseIds } from "@/lib/grade-classification";
import { routeErrorResponse } from "@/lib/route-helpers";

function examIncludesCourse(exam: { courseIds: string }, courseId: string) {
  const ids = parseCourseIds(exam.courseIds);
  return ids.length === 0 || ids.includes(courseId);
}

function toClientExam<T extends { courseIds: string }>(exam: T) {
  return { ...exam, courseIds: parseCourseIds(exam.courseIds) };
}

export async function GET(req: NextRequest) {
  const authError = await requirePermission(req, "follow-up.view");
  if (authError) return authError;

  try {
    const { searchParams } = new URL(req.url);
    const courseId = normalizeListFilter(searchParams.get("courseId"));
    if (!courseId) {
      return NextResponse.json({ exams: [], source: "database" });
    }

    const exams = await db.exam.findMany({
      select: {
        id: true,
        name: true,
        type: true,
        courseIds: true,
        mainSite: true,
        date: true,
        fullMark: true,
        passMark: true,
        discountMark: true,
        opportunitiesPenalty: true,
        dismissalGrade: true,
        noDiscount: true,
        active: true,
        scheduledActivateAt: true,
        scheduledDeactivateAt: true,
      },
      orderBy: [{ date: "desc" }, { name: "asc" }],
    });

    return NextResponse.json({
      exams: exams.filter((exam) => examIncludesCourse(exam, courseId)).map(toClientExam),
      source: "database",
    });
  } catch (error) {
    return routeErrorResponse(error, "تعذر تحميل امتحانات المكالمات من بيانات النظام.");
  }
}
