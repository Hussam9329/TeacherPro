export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/server-auth";
import { routeErrorResponse } from "@/lib/route-helpers";
import { normalizeBoolean } from "@/lib/opportunity-filters-server";
import { withSerializableTransaction } from "@/lib/serializable-transaction";
import { buildBulkOpportunityPreview } from "@/lib/bulk-opportunity-preview-server";

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
    const reactivateDismissedOnAdd = normalizeBoolean(
      searchParams.get("reactivateDismissedOnAdd"),
      actionType === "add" && !excludeDismissed,
    );
    const preview = await withSerializableTransaction((tx) =>
      buildBulkOpportunityPreview(tx, {
        courseId: String(searchParams.get("courseId") || "").trim(),
        status: String(searchParams.get("status") || "").trim(),
        opportunityCount: String(
          searchParams.get("opportunityCount") || "",
        ).trim(),
        q: String(searchParams.get("q") || "").trim(),
        actionType,
        excludeDismissed,
        excludeFullOpportunities,
        reactivateDismissedOnAdd,
      }),
    );

    return NextResponse.json({
      totalMatching: preview.totalMatching,
      eligibleWithActiveChapter: preview.eligibleWithActiveChapter,
      noActiveChapter: preview.noActiveChapter,
      activeChapterConflicts: preview.activeChapterConflicts,
      zeroOpportunityLimit: preview.zeroOpportunityLimit,
      invalidOpportunitySource: preview.invalidOpportunitySource,
      excludedDismissed: preview.excludedDismissed,
      excludedFullOpportunities: preview.excludedFullOpportunities,
      skipped: preview.skipped,
      targetCount: preview.targetCount,
      previewToken: preview.previewToken,
      source: "database",
    });
  } catch (error) {
    return routeErrorResponse(
      error,
      "تعذر احتساب نطاق عملية الفرص الجماعية من بيانات النظام.",
    );
  }
}
