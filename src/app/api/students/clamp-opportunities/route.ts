export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/server-auth";

/**
 * PATCH /api/students/clamp-opportunities
 *
 * Retired emergency backfill. Old browser bundles used to call this route on
 * load without a preview. Keep a hard 410 response so those stale tabs cannot
 * change restored production data.
 */
export async function PATCH(req: NextRequest) {
  const authError = await requirePermission(req, "system.maintenance");
  if (authError) return authError;
  return NextResponse.json(
    {
      error:
        "تم إيقاف مسار ضبط الفرص القديم. استخدم الإصلاح الآمن من صفحة الفصول بعد المعاينة والتأكيد.",
      retiredMaintenanceEndpoint: true,
    },
    { status: 410 },
  );
}
