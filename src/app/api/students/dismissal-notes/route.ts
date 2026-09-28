export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { requirePermissionPrincipal } from "@/lib/server-auth";
import { routeErrorResponse, validationError } from "@/lib/route-helpers";
import { withDatabaseSchema } from "@/lib/schema-readiness";
import { withSerializableTransaction } from "@/lib/serializable-transaction";
import { attachStudentOpportunitySnapshots } from "@/lib/student-opportunity-snapshot-server";
import { studentsWithGracePeriodsForResponse } from "@/lib/grace-periods-server";
import { buildStudentMutationToken, withStudentMutationToken } from "@/lib/student-mutation-token";

const MAX_DISMISSAL_NOTES_LENGTH = 2000;

class DismissalNotesError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
    this.name = "DismissalNotesError";
  }
}

/**
 * «ملاحظات الفصل» of a currently dismissed student. The general student edit
 * never writes dismissal fields, so the notes have this narrow endpoint: it
 * changes the notes only, for a student who is still dismissed, and records
 * the change in the audit log.
 */
export async function PUT(req: NextRequest) {
  const principal = await requirePermissionPrincipal(req, "students.edit");
  if (principal instanceof NextResponse) return principal;
  try {
    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    const studentId = typeof body?.studentId === "string" ? body.studentId.trim() : "";
    if (!studentId || studentId.length > 128) return validationError("تعذر تحديد الطالب المطلوب.");
    if (typeof body?.dismissalNotes !== "string") return validationError("ملاحظات الفصل غير صحيحة.");
    const dismissalNotes = body.dismissalNotes.trim();
    if (dismissalNotes.length > MAX_DISMISSAL_NOTES_LENGTH) {
      return validationError(`ملاحظات الفصل أطول من ${MAX_DISMISSAL_NOTES_LENGTH} حرف.`);
    }
    const expectedMutationToken = typeof body?.expectedMutationToken === "string" ? body.expectedMutationToken.trim() : "";

    const student = await withDatabaseSchema(
      () => withSerializableTransaction(async (tx) => {
        const current = await tx.student.findUnique({ where: { id: studentId } });
        if (!current) throw new DismissalNotesError("الطالب غير موجود.", 404);
        if (current.status !== "مفصول") {
          throw new DismissalNotesError("ملاحظات الفصل تُعدّل للطالب المفصول حالياً فقط.", 409);
        }
        if (
          expectedMutationToken &&
          expectedMutationToken !== buildStudentMutationToken(current as unknown as Record<string, unknown>)
        ) {
          throw new DismissalNotesError("تغيّر سجل الطالب بعد فتحه. حدّث السجل ثم أعد المحاولة.", 409);
        }
        if (String(current.dismissalNotes || "").trim() === dismissalNotes) return current;
        const updated = await tx.student.update({
          where: { id: current.id },
          data: { dismissalNotes },
        });
        await tx.auditLog.create({
          data: {
            module: "إدارة المفصولين",
            action: "تعديل ملاحظات الفصل",
            userId: principal.id,
            userName: principal.name,
            details: JSON.stringify({
              studentId: current.id,
              name: current.name,
              code: current.code,
              before: { dismissalNotes: current.dismissalNotes || "" },
              after: { dismissalNotes },
            }),
          },
        });
        return updated;
      }),
      "Student",
    );

    const [studentForResponse] = await studentsWithGracePeriodsForResponse(
      await attachStudentOpportunitySnapshots([student]),
    );
    return NextResponse.json(
      {
        student: withStudentMutationToken(
          studentForResponse as unknown as Record<string, unknown>,
          student as unknown as Record<string, unknown>,
        ),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    if (error instanceof DismissalNotesError) return validationError(error.message, error.status);
    return routeErrorResponse(error, "تعذر حفظ ملاحظات الفصل.");
  }
}
