export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { routeErrorResponse, validationError } from "@/lib/route-helpers";
import { requirePermissionPrincipal } from "@/lib/server-auth";
import { API_RATE_LIMITS, checkApiRateLimit } from "@/lib/api-rate-limit";
import { withDatabaseSchema } from "@/lib/schema-readiness";
import { writeRequestAuditLog } from "@/lib/audit-log-server";
import { healStaleAcademicRecords, scanStaleAcademicRecords } from "@/lib/academic-recalculate-server";

const MAX_FIX = 100;

/**
 * «فحص الحسابات»: one page of students (by id, after `cursor`) whose saved
 * record differs from what a recalculation gives now. Read-only.
 */
export async function GET(req: NextRequest) {
  const principal = await requirePermissionPrincipal(req, "system.maintenance");
  if (principal instanceof NextResponse) return principal;
  try {
    const params = new URL(req.url).searchParams;
    const cursor = String(params.get("cursor") || "").trim() || undefined;
    const limit = Number(params.get("limit") || 100);
    const result = await withDatabaseSchema(() => scanStaleAcademicRecords(db, { cursor, limit }));
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return routeErrorResponse(error, "تعذر فحص حسابات الطلاب.");
  }
}

/**
 * Recalculates and saves, through the same path a grade save takes, those
 * of the given students that are still stale. Audited with before/after.
 */
export async function POST(req: NextRequest) {
  const principal = await requirePermissionPrincipal(req, "system.maintenance");
  if (principal instanceof NextResponse) return principal;
  const rateLimitError = await checkApiRateLimit(req, API_RATE_LIMITS.studentOpportunitySync);
  if (rateLimitError) return rateLimitError;
  try {
    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    const studentIds = Array.isArray(body?.studentIds)
      ? Array.from(new Set(body.studentIds.map((id) => String(id || "").trim()).filter(Boolean)))
      : [];
    if (studentIds.length === 0) return validationError("ما في طلاب للإصلاح.");
    if (studentIds.length > MAX_FIX) return validationError(`صلّح ${MAX_FIX} طالب أو أقل بالمرة.`);
    const result = await withDatabaseSchema(() => healStaleAcademicRecords(studentIds));
    if (result.healed.length || result.stillStale.length) {
      await writeRequestAuditLog(req, "إدارة الفرص", "إعادة احتساب طلاب ما يطابق محفوظهم الحساب", {
        healed: result.healed.map((record) => ({ studentId: record.studentId, code: record.code, before: record.stored, after: record.replay })),
        stillStale: result.stillStale.map((record) => record.studentId),
      });
    }
    return NextResponse.json(result);
  } catch (error) {
    return routeErrorResponse(error, "تعذر إصلاح حسابات الطلاب.");
  }
}
