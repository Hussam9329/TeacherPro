export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { requireAnyPermission } from "@/lib/server-auth";
import { db } from "@/lib/db";
import { routeErrorResponse } from "@/lib/route-helpers";
import { loadPledgeList, type PledgeListQuery } from "@/lib/pledge-limit-server";
import { PLEDGE_LIMIT_PER_CHAPTER } from "@/lib/pledge-limit";

function pick<T extends string>(value: string | null, allowed: readonly T[], fallback: T): T {
  return allowed.includes(value as T) ? (value as T) : fallback;
}

/** «قائمة التعهدات»: every pledge, grouped per student and chapter. */
export async function GET(req: NextRequest) {
  const authError = await requireAnyPermission(req, ["opportunities.view", "students.view"]);
  if (authError) return authError;
  try {
    const params = new URL(req.url).searchParams;
    const query: PledgeListQuery = {
      courseIds: String(params.get("courseIds") || "").split(",").map((id) => id.trim()).filter(Boolean),
      chapterScope: pick(params.get("chapter"), ["active", "all"] as const, "active"),
      count: pick(params.get("count"), ["", "1", "2", "limit"] as const, ""),
      status: pick(params.get("status"), ["", "active", "dismissed", "archived"] as const, ""),
      q: String(params.get("q") || "").slice(0, 200),
      sort: pick(params.get("sort"), ["count", "last", "name"] as const, "count"),
    };
    const rows = await loadPledgeList(db, query);
    return NextResponse.json({
      rows,
      totalStudents: new Set(rows.map((row) => row.studentId)).size,
      totalPledges: rows.reduce((sum, row) => sum + row.count, 0),
      limitReached: rows.filter((row) => row.limitReached).length,
      limit: PLEDGE_LIMIT_PER_CHAPTER,
    });
  } catch (error) {
    return routeErrorResponse(error, "تعذر تحميل قائمة التعهدات.");
  }
}
