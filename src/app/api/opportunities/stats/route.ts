export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/server-auth";
import { db } from "@/lib/db";
import { routeErrorResponse } from "@/lib/route-helpers";
import {
  buildOpportunityFilters,
  composeStudentWhere,
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

    const [total, hasOpportunities, noOpportunities, dismissed, active] =
      await Promise.all([
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
      ]);

    return NextResponse.json({
      total,
      hasOpportunities,
      noOpportunities,
      dismissed,
      active,
      source: "database",
    });
  } catch (error) {
    return routeErrorResponse(
      error,
      "تعذر تحميل إحصائيات الفرص من قاعدة البيانات حالياً.",
    );
  }
}
