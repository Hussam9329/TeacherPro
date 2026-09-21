export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requirePermission, requirePermissionPrincipal } from "@/lib/server-auth";
import { routeErrorResponse, validationError } from "@/lib/route-helpers";
import { withDatabaseSchema } from "@/lib/schema-readiness";
import { withSerializableTransaction } from "@/lib/serializable-transaction";
import { DismissedCheckError, parseDismissedCheckInput, updateDismissedCheck } from "@/lib/dismissed-check-server";

export async function GET(req: NextRequest) {
  const authError = await requirePermission(req, "students.view");
  if (authError) return authError;
  const ids = Array.from(new Set(new URL(req.url).searchParams.getAll("id")));
  if (!ids.length || ids.length > 100 || ids.some((id) => !id.trim() || id.length > 128)) {
    return validationError("قائمة الطلاب غير صحيحة.");
  }
  try {
    const students = await withDatabaseSchema(() => db.student.findMany({
      where: { id: { in: ids } },
      select: { id: true, status: true, dismissedChecked: true },
    }), "Student");
    return NextResponse.json({ students }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return routeErrorResponse(error, "تعذر تحميل تأشير الطلاب.");
  }
}

export async function PUT(req: NextRequest) {
  const principal = await requirePermissionPrincipal(req, "students.edit");
  if (principal instanceof NextResponse) return principal;
  try {
    const input = parseDismissedCheckInput(await req.json().catch(() => null));
    const student = await withDatabaseSchema(
      () => withSerializableTransaction((tx) => updateDismissedCheck(tx, input, principal)),
      "Student",
    );
    return NextResponse.json({ student }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof DismissedCheckError) return validationError(error.message, error.status);
    return routeErrorResponse(error, "تعذر حفظ تأشير الطالب.");
  }
}
