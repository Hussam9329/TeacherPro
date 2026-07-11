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
import { attachStudentOpportunitySnapshots } from "@/lib/student-opportunity-snapshot-server";
import type { Prisma } from "@prisma/client";

type OpportunityCountSet = {
  total: number;
  hasOpportunities: number;
  noOpportunities: number;
  dismissed: number;
  active: number;
  noActiveChapter: number;
  activeChapterConflicts: number;
  zeroOpportunityLimit: number;
  overLimit: number;
  fullOpportunities: number;
  belowFullOpportunities: number;
};

async function collectOpportunityCounts(
  filters: Prisma.StudentWhereInput[],
): Promise<OpportunityCountSet> {
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
      select: {
        id: true,
        courseId: true,
        opportunities: true,
        baseOpportunities: true,
      },
    }),
  ]);

  const snapshots = await attachStudentOpportunitySnapshots(activeRows);
  let overLimit = 0;
  let fullOpportunities = 0;
  let belowFullOpportunities = 0;
  let activeChapterConflicts = 0;
  let zeroOpportunityLimit = 0;

  for (const student of snapshots) {
    if (student.opportunityHealth === "active-chapter-conflict") {
      activeChapterConflicts += 1;
      continue;
    }
    if (student.opportunityHealth === "zero-limit") {
      zeroOpportunityLimit += 1;
      continue;
    }
    if (student.opportunityHealth !== "ready") continue;

    if (student.isOpportunityOverLimit) overLimit += 1;
    if (student.isOpportunityFull) fullOpportunities += 1;
    else belowFullOpportunities += 1;
  }

  return {
    total,
    hasOpportunities,
    noOpportunities,
    dismissed,
    active,
    noActiveChapter,
    activeChapterConflicts,
    zeroOpportunityLimit,
    overLimit,
    fullOpportunities,
    belowFullOpportunities,
  };
}

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

    const filtered = await collectOpportunityCounts(filters);
    const system = filters.length
      ? await collectOpportunityCounts([])
      : filtered;

    return NextResponse.json({
      ...filtered,
      filtered,
      system,
      source: "database",
    });
  } catch (error) {
    return routeErrorResponse(
      error,
      "تعذر تحميل إحصائيات الفرص حالياً.",
    );
  }
}
