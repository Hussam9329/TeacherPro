export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { requirePermissionPrincipal } from "@/lib/server-auth";
import { routeErrorResponse, validationError } from "@/lib/route-helpers";
import { withDatabaseSchema } from "@/lib/schema-readiness";
import { withSerializableTransaction } from "@/lib/serializable-transaction";
import { StudentWithdrawalError, withdrawStudentInTransaction } from "@/lib/student-withdrawal-server";

/**
 * «انسحاب» (from «اغلاق الكودات» and «إدارة ملاحظات المكالمات»): adds
 * «انسحاب» to the student's name and archives them. Archiving needs the same
 * permission as «أرشفة».
 */
export async function POST(req: NextRequest) {
  const principal = await requirePermissionPrincipal(req, "students.delete");
  if (principal instanceof NextResponse) return principal;
  const body = (await req.json().catch(() => null)) as { studentId?: unknown } | null;
  const studentId = typeof body?.studentId === "string" ? body.studentId.trim() : "";
  if (!studentId || studentId.length > 128) return validationError("تعذر تحديد الطالب المطلوب.");
  try {
    const student = await withDatabaseSchema(
      () => withSerializableTransaction((tx) => withdrawStudentInTransaction(tx, studentId, principal)),
      "Student",
    );
    return NextResponse.json(
      { student: { id: student.id, name: student.name, status: student.status } },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    if (error instanceof StudentWithdrawalError) return validationError(error.message, error.status);
    return routeErrorResponse(error, "تعذر تسجيل انسحاب الطالب حالياً.");
  }
}
