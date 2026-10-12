export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { routeErrorResponse, validationError } from "@/lib/route-helpers";
import { requireAnyPermissionPrincipal, requirePermissionPrincipal } from "@/lib/server-auth";
import { API_RATE_LIMITS, checkApiRateLimit } from "@/lib/api-rate-limit";
import { withDatabaseSchema } from "@/lib/schema-readiness";
import { withSerializableTransaction } from "@/lib/serializable-transaction";
import { writeRequestAuditLog } from "@/lib/audit-log-server";
import { archivedStudentLockedResponse, assertStudentsNotArchived, isArchivedStudentError } from "@/lib/archived-student-guard";
import { buildAcademicBonusTrace, recalculateStudentsAcademicState } from "@/lib/academic-recalculate-server";
import type { AcademicBonusTrace } from "@/lib/academic-types";

const NOT_FOUND = "الطالب غير موجود أو مؤرشف.";

/** The saved record differs from what a recalculation gives now. */
function isStale(trace: AcademicBonusTrace): boolean {
  return trace.stored.opportunities !== trace.replay.opportunities ||
    trace.stored.bonuses !== trace.replay.bonuses ||
    trace.stored.status !== trace.replay.status ||
    trace.stored.bonusProgress !== trace.replay.bonusProgress;
}

const snapshot = (side: AcademicBonusTrace["stored"]) => ({
  opportunities: side.opportunities, bonuses: side.bonuses, status: side.status, bonusProgress: side.bonusProgress,
});

/**
 * «ليش ما تكافأ؟»: replays one student read-only and explains every
 * «فرصة مكافأة» decision, result by result. Staff only; nothing is written.
 */
export async function GET(req: NextRequest) {
  const principalOrError = await requireAnyPermissionPrincipal(req, ["opportunities.view", "opportunities.manage"]);
  if (principalOrError instanceof NextResponse) return principalOrError;
  try {
    const studentId = String(new URL(req.url).searchParams.get("studentId") || "").trim();
    if (!studentId) return validationError("الطالب مطلوب.");
    const trace = await buildAcademicBonusTrace(db, studentId);
    if (!trace) return NextResponse.json({ error: NOT_FOUND }, { status: 404 });
    return NextResponse.json(trace, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return routeErrorResponse(error, "تعذر شرح فرصة المكافأة لهذا الطالب.");
  }
}

/**
 * «احسب الطالب من جديد»: only when the saved record differs from the
 * replay, runs for this one student the same recalculation a grade save
 * runs, saves it, and returns the fresh explanation.
 */
export async function POST(req: NextRequest) {
  const principal = await requirePermissionPrincipal(req, "opportunities.manage");
  if (principal instanceof NextResponse) return principal;
  const rateLimitError = await checkApiRateLimit(req, API_RATE_LIMITS.studentOpportunitySync);
  if (rateLimitError) return rateLimitError;
  try {
    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    const studentId = String(body?.studentId || "").trim();
    if (!studentId) return validationError("الطالب مطلوب.");
    const before = await buildAcademicBonusTrace(db, studentId);
    if (!before) return NextResponse.json({ error: NOT_FOUND }, { status: 404 });
    if (!isStale(before)) return NextResponse.json({ ...before, recalculated: false });
    await withDatabaseSchema(() => withSerializableTransaction(async (tx) => {
      await assertStudentsNotArchived(tx, [studentId]);
      await recalculateStudentsAcademicState([studentId], { tx });
    }));
    const after = await buildAcademicBonusTrace(db, studentId);
    if (!after) return NextResponse.json({ error: NOT_FOUND }, { status: 404 });
    await writeRequestAuditLog(req, "إدارة الفرص", "إعادة احتساب طالب ما يطابق محفوظه الحساب", {
      studentId,
      before: snapshot(before.stored),
      after: snapshot(after.stored),
    });
    return NextResponse.json({ ...after, recalculated: true });
  } catch (error) {
    if (isArchivedStudentError(error)) return archivedStudentLockedResponse();
    return routeErrorResponse(error, "تعذر إعادة احتساب الطالب.");
  }
}
