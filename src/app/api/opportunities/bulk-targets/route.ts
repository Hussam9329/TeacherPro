export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/server-auth";
import { db } from "@/lib/db";
import { routeErrorResponse } from "@/lib/route-helpers";
import {
  buildOpportunityFilters,
  composeStudentWhere,
  normalizeBoolean,
} from "@/lib/opportunity-filters-server";
import { attachStudentOpportunitySnapshots } from "@/lib/student-opportunity-snapshot-server";

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

    const rows = await db.student.findMany({
      where: composeStudentWhere(filters),
      select: {
        id: true,
        status: true,
        courseId: true,
        opportunities: true,
        baseOpportunities: true,
      },
    });
    const snapshots = await attachStudentOpportunitySnapshots<
      (typeof rows)[number]
    >(rows);
    const eligibleRows = snapshots.filter(
      (student) => student.opportunityHealth === "ready",
    );

    const noActiveChapter = snapshots.filter(
      (student) => student.opportunityHealth === "missing-active-chapter",
    ).length;
    const activeChapterConflicts = snapshots.filter(
      (student) => student.opportunityHealth === "active-chapter-conflict",
    ).length;
    const zeroOpportunityLimit = snapshots.filter(
      (student) => student.opportunityHealth === "zero-limit",
    ).length;
    const invalidOpportunitySource =
      noActiveChapter + activeChapterConflicts + zeroOpportunityLimit;

    const excludedDismissed = excludeDismissed
      ? eligibleRows.filter((student) => student.status === "مفصول").length
      : 0;
    const excludedFullOpportunities =
      actionType === "deduct" && excludeFullOpportunities
        ? eligibleRows.filter((student) => student.isOpportunityFull).length
        : 0;

    const targetCount = eligibleRows.filter((student) => {
      if (excludeDismissed && student.status === "مفصول") return false;
      if (
        actionType === "deduct" &&
        excludeFullOpportunities &&
        student.isOpportunityFull
      ) {
        return false;
      }
      return true;
    }).length;

    return NextResponse.json({
      totalMatching: rows.length,
      eligibleWithActiveChapter: eligibleRows.length,
      noActiveChapter,
      activeChapterConflicts,
      zeroOpportunityLimit,
      invalidOpportunitySource,
      excludedDismissed,
      excludedFullOpportunities,
      skipped: Math.max(0, rows.length - targetCount),
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
