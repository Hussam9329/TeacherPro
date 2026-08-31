export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/server-auth";

/**
 * Retired student-repair endpoint.
 *
 * Older browser bundles could call this route automatically. Keep an
 * authenticated, non-retryable 410 response so no stale tab or queued request
 * can alter restored student balances.
 */
export async function PATCH(req: NextRequest) {
  const authError = await requirePermission(req, "system.maintenance");
  if (authError) return authError;

  return NextResponse.json(
    {
      error:
        "تم إيقاف إصلاح الطلاب القديم نهائياً. لا يوجد إجراء جماعي لتعديل فرص الطلاب.",
      retiredMaintenanceEndpoint: true,
    },
    {
      status: 410,
      headers: { "x-teacherpro-retryable": "0" },
    },
  );
}

export const POST = PATCH;
