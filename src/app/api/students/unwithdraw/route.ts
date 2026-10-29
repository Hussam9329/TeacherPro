export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { studentsWithGracePeriodsForResponse } from "@/lib/grace-periods-server";
import { requirePermissionPrincipal } from "@/lib/server-auth";
import { routeErrorResponse, validationError } from "@/lib/route-helpers";
import { withDatabaseSchema } from "@/lib/schema-readiness";
import { withSerializableTransaction } from "@/lib/serializable-transaction";
import { ArchiveRestoreError } from "@/lib/student-archive-restore-server";
import { attachStudentOpportunitySnapshots } from "@/lib/student-opportunity-snapshot-server";
import { withStudentMutationToken } from "@/lib/student-mutation-token";
import { StudentWithdrawalError, unwithdrawStudentInTransaction } from "@/lib/student-withdrawal-server";

/**
 * «الغاء الانسحاب» (on archived students' cards in «سجل الطلاب»): removes
 * «انسحاب» from the name and restores the student to the state they held
 * before withdrawal. Restoring needs the same permission as «استعادة من الأرشيف».
 */
export async function POST(req: NextRequest) {
  const principal = await requirePermissionPrincipal(req, "students.edit");
  if (principal instanceof NextResponse) return principal;
  const body = (await req.json().catch(() => null)) as { studentId?: unknown } | null;
  const studentId = typeof body?.studentId === "string" ? body.studentId.trim() : "";
  if (!studentId || studentId.length > 128) return validationError("تعذر تحديد الطالب المطلوب.");
  try {
    const result = await withDatabaseSchema(
      () => withSerializableTransaction((tx) => unwithdrawStudentInTransaction(tx, studentId, principal)),
      "Student",
    );
    const [student] = await studentsWithGracePeriodsForResponse(
      await attachStudentOpportunitySnapshots([result.student]),
    );
    return NextResponse.json(
      {
        ok: true,
        ...result,
        student: withStudentMutationToken(
          student as unknown as Record<string, unknown>,
          result.student as unknown as Record<string, unknown>,
        ),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    if (error instanceof StudentWithdrawalError) return validationError(error.message, error.status);
    if (error instanceof ArchiveRestoreError) return validationError(error.message, error.statusCode);
    return routeErrorResponse(error, "تعذر الغاء انسحاب الطالب حالياً.");
  }
}
