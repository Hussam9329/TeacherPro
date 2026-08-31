export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

import { NextRequest, NextResponse } from "next/server";
import { getAuthPrincipal, requirePermission } from "@/lib/server-auth";
import { writeRequestAuditLog } from "@/lib/audit-log-server";
import { routeErrorResponse } from "@/lib/route-helpers";
import { withSerializableTransaction } from "@/lib/serializable-transaction";
import { promotePendingPreRegistrationGrades } from "@/lib/pre-registration-grade-promotion-server";

export async function POST(req: NextRequest) {
  const authError = await requirePermission(req, "grades.edit");
  if (authError) return authError;

  const principal = await getAuthPrincipal(req);
  if (!principal) {
    return NextResponse.json(
      { error: "يجب تسجيل الدخول أولاً." },
      { status: 401 },
    );
  }

  try {
    const result = await withSerializableTransaction((tx) =>
      promotePendingPreRegistrationGrades(tx, {
        id: principal.id,
        name: principal.name || principal.username,
      }),
    );
    await writeRequestAuditLog(
      req,
      "الدرجات",
      "ترقية درجات ما قبل التسجيل المعلّقة إلى سجل الطالب",
      result,
    );
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return routeErrorResponse(
      error,
      "تعذر ترقية درجات ما قبل التسجيل المعلّقة حالياً.",
    );
  }
}
