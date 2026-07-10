export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/server-auth";
import { db } from "@/lib/db";
import { routeErrorResponse } from "@/lib/route-helpers";
import {
  buildOpportunityFilters,
  composeStudentWhere,
  fullOpportunityLimitForStudent,
  hasActiveChapterWhere,
  noActiveChapterWhere,
  normalizeBoolean,
} from "@/lib/opportunity-filters-server";

export async function GET(req: NextRequest) {
  const authError = await requirePermission(req, "opportunities.view");
  if (authError) return authError;

  try {
    const { searchParams } = new URL(req.url);
    const actionType =
      searchParams.get("actionType") === "deduct" ? "deduct" : "add";
    const excludeDismissed = normalizeBoolean(
      searchParams.get("excludeDismissed"),
      true,
    );
    const excludeFullOpportunities = normalizeBoolean(
      searchParams.get("excludeFullOpportunities"),
      true,
    );
    const filters = buildOpportunityFilters({
      courseId: searchParams.get("courseId"),
      status: searchParams.get("status"),
      opportunityCount: searchParams.get("opportunityCount"),
      q: searchParams.get("q"),
    });

    const baseWhere = composeStudentWhere(filters);
    const eligibleBaseWhere = composeStudentWhere([
      ...filters,
      hasActiveChapterWhere(),
    ]);

    const [totalMatching, noActiveChapter, dismissedInEligibleBase, rows] =
      await Promise.all([
        db.student.count({ where: baseWhere }),
        db.student.count({
          where: composeStudentWhere([...filters, noActiveChapterWhere()]),
        }),
        db.student.count({
          where: composeStudentWhere([
            ...filters,
            hasActiveChapterWhere(),
            { status: "مفصول" },
          ]),
        }),
        db.student.findMany({
          where: eligibleBaseWhere,
          select: {
            id: true,
            status: true,
            opportunities: true,
            baseOpportunities: true,
          },
        }),
      ]);

    const excludedDismissed = excludeDismissed ? dismissedInEligibleBase : 0;
    const excludedFullOpportunities =
      actionType === "deduct" && excludeFullOpportunities
        ? rows.filter(
            (student) =>
              Number(student.opportunities || 0) >=
              fullOpportunityLimitForStudent(student),
          ).length
        : 0;
    const targetCount = rows.filter((student) => {
      if (excludeDismissed && student.status === "مفصول") {
        return false;
      }
      if (actionType === "deduct" && excludeFullOpportunities) {
        return (
          Number(student.opportunities || 0) <
          fullOpportunityLimitForStudent(student)
        );
      }
      return true;
    }).length;

    return NextResponse.json({
      totalMatching,
      eligibleWithActiveChapter: rows.length,
      noActiveChapter,
      excludedDismissed,
      excludedFullOpportunities,
      skipped: Math.max(0, totalMatching - targetCount),
      targetCount,
      source: "database",
    });
  } catch (error) {
    return routeErrorResponse(
      error,
      "تعذر احتساب نطاق عملية الفرص الجماعية من بيانات النظام.",
    );
  }
}
