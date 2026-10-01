export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { requirePermissionPrincipal } from "@/lib/server-auth";
import { routeErrorResponse, validationError } from "@/lib/route-helpers";
import { withDatabaseSchema } from "@/lib/schema-readiness";
import { withSerializableTransaction } from "@/lib/serializable-transaction";

const STEPS = {
  platform: { column: "closurePlatformEpoch", action: "فتح المنصة ونسخ هاتف الطالب المفصول" },
  telegram: { column: "closureTelegramEpoch", action: "فتح تبليغ الفصل في تليكرام" },
} as const;

/**
 * Marks one contact step on a code-closure card as done for the current
 * dismissal episode. It never touches the student's status, the shared
 * closed-code flag, or anything academic.
 */
export async function PUT(req: NextRequest) {
  const principal = await requirePermissionPrincipal(req, "students.edit");
  if (principal instanceof NextResponse) return principal;

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const studentId = typeof body?.studentId === "string" ? body.studentId.trim() : "";
  const stepName = typeof body?.step === "string" && Object.hasOwn(STEPS, body.step) ? body.step as keyof typeof STEPS : null;
  const epoch = body?.expectedEpoch;
  if (!studentId || studentId.length > 128) return validationError("تعذر تحديد الطالب المطلوب.");
  if (!stepName) return validationError("إجراء التواصل غير صحيح.");
  if (typeof epoch !== "number" || !Number.isSafeInteger(epoch) || epoch < 0) {
    return validationError("حدّث قائمة اغلاق الكودات ثم أعد المحاولة.", 409);
  }
  const step = STEPS[stepName];

  try {
    const result = await withDatabaseSchema(() => withSerializableTransaction(async (tx) => {
      const student = await tx.student.findUnique({
        where: { id: studentId },
        select: { id: true, name: true, code: true, status: true, dismissedCheckEpoch: true, closurePlatformEpoch: true, closureTelegramEpoch: true },
      });
      if (!student) return { status: 404 as const };
      if (student.status !== "مفصول" || student.dismissedCheckEpoch !== epoch) return { status: 409 as const };
      if (student[step.column] === epoch) return { student };
      const updated = await tx.student.updateMany({
        where: { id: student.id, status: "مفصول", dismissedCheckEpoch: epoch },
        data: { [step.column]: epoch },
      });
      if (updated.count !== 1) return { status: 409 as const };
      await tx.auditLog.create({
        data: {
          module: "سجل الطلاب",
          action: step.action,
          userId: principal.id,
          userName: principal.name,
          details: JSON.stringify({ studentId: student.id, name: student.name, code: student.code }),
        },
      });
      return { student: { ...student, [step.column]: epoch } };
    }), "Student");

    if ("status" in result) {
      return result.status === 404
        ? validationError("الطالب غير موجود.", 404)
        : validationError("تغيّرت حالة الطالب منذ فتح القائمة. حدّث القائمة ثم أعد المحاولة.", 409);
    }
    const { id, dismissedCheckEpoch, closurePlatformEpoch, closureTelegramEpoch } = result.student;
    return NextResponse.json(
      { student: { id, dismissedCheckEpoch, closurePlatformEpoch, closureTelegramEpoch } },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return routeErrorResponse(error, "تعذر حفظ علامة التواصل مع الطالب.");
  }
}
