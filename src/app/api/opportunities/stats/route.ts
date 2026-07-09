export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/server-auth";
import { db } from "@/lib/db";
import { routeErrorResponse } from "@/lib/route-helpers";
import {
  buildOpportunityFilters,
  composeStudentWhere,
  hasActiveChapterWhere,
  noActiveChapterWhere,
} from "@/lib/opportunity-filters-server";

export async function GET(req: NextRequest) {
  const authError = await requirePermission(req, "opportunities.view");
  if (authError) return authError;

  try {
    const { searchParams } = new URL(req.url);
    const filters = buildOpportunityFilters({
      courseId: searchParams.get("courseId"),
      status: searchParams.get("status"),
      opportunityCount: searchParams.get("opportunityCount"),
      q: searchParams.get("q"),
    });
    const baseWhere = composeStudentWhere(filters);

    const [
      total,
      hasOpportunities,
      noOpportunities,
      dismissed,
      active,
      noActiveChapter,
      activeRows,
    ] = await Promise.all([
      db.student.count({ where: baseWhere }),
      db.student.count({
        where: composeStudentWhere([
          ...filters,
          { status: "نشط", opportunities: { gt: 0 } },
        ]),
      }),
      db.student.count({
        where: composeStudentWhere([
          ...filters,
          { status: "نشط", opportunities: 0 },
        ]),
      }),
      db.student.count({
        where: composeStudentWhere([...filters, { status: "مفصول" }]),
      }),
      db.student.count({
        where: composeStudentWhere([...filters, { status: "نشط" }]),
      }),
      db.student.count({
        where: composeStudentWhere([...filters, noActiveChapterWhere()]),
      }),
      db.student.findMany({
        where: composeStudentWhere([...filters, hasActiveChapterWhere()]),
        select: { id: true, courseId: true, opportunities: true, baseOpportunities: true },
      }),
    ]);

    const courseIds = Array.from(new Set(activeRows.map((student) => student.courseId)));
    const activeLinks = courseIds.length
      ? await db.courseChapter.findMany({
          where: { courseId: { in: courseIds }, active: true, archived: false },
          select: {
            courseId: true,
            chapter: { select: { opportunities: true } },
          },
        })
      : [];

    const activeLinksByCourseId = new Map<string, typeof activeLinks>();
    for (const link of activeLinks) {
      const list = activeLinksByCourseId.get(link.courseId) || [];
      list.push(link);
      activeLinksByCourseId.set(link.courseId, list);
    }

    let overLimit = 0;
    let fullOpportunities = 0;
    let belowFullOpportunities = 0;
    let activeChapterConflicts = 0;

    for (const student of activeRows) {
      const links = activeLinksByCourseId.get(student.courseId) || [];
      if (links.length !== 1) {
        if (links.length > 1) activeChapterConflicts += 1;
        continue;
      }
      const cap = Math.max(
        0,
        Math.trunc(Number(links[0].chapter?.opportunities || student.baseOpportunities || 0)),
      );
      const opportunities = Number(student.opportunities || 0);
      if (cap <= 0) continue;
      if (opportunities > cap) overLimit += 1;
      if (opportunities >= cap) fullOpportunities += 1;
      if (opportunities < cap) belowFullOpportunities += 1;
    }

    return NextResponse.json({
      total,
      hasOpportunities,
      noOpportunities,
      dismissed,
      active,
      noActiveChapter,
      activeChapterConflicts,
      overLimit,
      fullOpportunities,
      belowFullOpportunities,
      source: "database",
    });
  } catch (error) {
    return routeErrorResponse(
      error,
      "تعذر تحميل إحصائيات الفرص من قاعدة البيانات حالياً.",
    );
  }
}
