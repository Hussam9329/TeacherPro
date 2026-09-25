export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

import { NextRequest, NextResponse } from "next/server";
import { requirePermission, requirePermissionPrincipal } from "@/lib/server-auth";
import { routeErrorResponse } from "@/lib/route-helpers";
import { withDatabaseSchema } from "@/lib/schema-readiness";
import {
  applyLegacyGraceConversion,
  dryRunLegacyGraceConversion,
  legacyGraceConversionStatus,
} from "@/lib/legacy-grace-conversion-server";

function readBatchSize(value: unknown, fallback: number, max: number): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.min(max, Math.max(10, Math.trunc(numeric)));
}

/** GET /api/grace-periods/legacy — where the one-time conversion stands. */
export async function GET(req: NextRequest) {
  const authError = await requirePermission(req, "system.maintenance");
  if (authError) return authError;
  try {
    return NextResponse.json(
      await withDatabaseSchema(() => legacyGraceConversionStatus(), "GracePeriod"),
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return routeErrorResponse(error, "تعذر قراءة حالة نقل فترات السماح القديمة.");
  }
}

/**
 * POST /api/grace-periods/legacy { mode: "dry-run" | "apply", cursor?, batchSize? }
 * Processes one batch of students ordered by id; the caller follows nextCursor
 * until hasMore is false. Dry run never writes.
 */
export async function POST(req: NextRequest) {
  const principalOrError = await requirePermissionPrincipal(req, "system.maintenance");
  if (principalOrError instanceof NextResponse) return principalOrError;
  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const cursor = body.cursor ? String(body.cursor) : null;
    if (body.mode === "apply") {
      const report = await withDatabaseSchema(
        () => applyLegacyGraceConversion(
          cursor,
          { id: principalOrError.id, name: principalOrError.name },
          readBatchSize(body.batchSize, 50, 100),
        ),
        "GracePeriod",
      );
      return NextResponse.json(report);
    }
    const report = await withDatabaseSchema(
      () => dryRunLegacyGraceConversion(cursor, readBatchSize(body.batchSize, 150, 300)),
      "GracePeriod",
    );
    return NextResponse.json(report);
  } catch (error) {
    return routeErrorResponse(error, "تعذر تنفيذ نقل فترات السماح القديمة.");
  }
}
