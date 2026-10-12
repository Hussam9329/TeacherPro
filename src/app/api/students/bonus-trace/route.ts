export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { routeErrorResponse, validationError } from "@/lib/route-helpers";
import { requireAnyPermissionPrincipal } from "@/lib/server-auth";
import { buildAcademicBonusTrace } from "@/lib/academic-recalculate-server";

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
    if (!trace) return NextResponse.json({ error: "الطالب غير موجود أو مؤرشف." }, { status: 404 });
    return NextResponse.json(trace, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return routeErrorResponse(error, "تعذر شرح فرصة المكافأة لهذا الطالب.");
  }
}
