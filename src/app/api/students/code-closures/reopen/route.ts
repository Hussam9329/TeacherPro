export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { requirePermissionPrincipal } from "@/lib/server-auth";
import { routeErrorResponse, validationError } from "@/lib/route-helpers";
import { withDatabaseSchema } from "@/lib/schema-readiness";
import { withSerializableTransaction } from "@/lib/serializable-transaction";

const CODE_REOPENED_ACTION = "فتح كود الطالب المفصول على المنصة";

/**
 * The green «فتح الكود» button: the code was opened again on the platform, so
 * this dismissal's ☢️ mark and the «الكود مغلق» tick are cleared together and
 * ☢️ can be pressed again. The Telegram notice mark stays (it was sent).
 */
export async function PUT(req: NextRequest) {
  const principal = await requirePermissionPrincipal(req, "students.edit");
  if (principal instanceof NextResponse) return principal;

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const studentId = typeof body?.studentId === "string" ? body.studentId.trim() : "";
  const epoch = body?.expectedEpoch;
  if (!studentId || studentId.length > 128) return validationError("تعذر تحديد الطالب المطلوب.");
  if (typeof epoch !== "number" || !Number.isSafeInteger(epoch) || epoch < 0) {
    return validationError("حدّث القائمة ثم أعد المحاولة.", 409);
  }

  try {
    const result = await withDatabaseSchema(() => withSerializableTransaction(async (tx) => {
      const student = await tx.student.findUnique({
        where: { id: studentId },
        select: { id: true, name: true, code: true, status: true, dismissedChecked: true, dismissedCheckEpoch: true, closurePlatformEpoch: true },
      });
      if (!student) return { status: 404 as const };
      if (student.status !== "مفصول" || student.dismissedCheckEpoch !== epoch) return { status: 409 as const };
      // Already open: nothing to write or audit.
      if (!student.dismissedChecked && student.closurePlatformEpoch !== epoch) return { student };
      const updated = await tx.student.updateMany({
        where: { id: student.id, status: "مفصول", dismissedCheckEpoch: epoch },
        data: { closurePlatformEpoch: null, dismissedChecked: false },
      });
      if (updated.count !== 1) return { status: 409 as const };
      await tx.auditLog.create({
        data: {
          module: "سجل الطلاب",
          action: CODE_REOPENED_ACTION,
          userId: principal.id,
          userName: principal.name,
          details: JSON.stringify({ studentId: student.id, name: student.name, code: student.code,
            before: { dismissedChecked: student.dismissedChecked, closurePlatformEpoch: student.closurePlatformEpoch },
            after: { dismissedChecked: false, closurePlatformEpoch: null } }),
        },
      });
      return { student: { ...student, dismissedChecked: false, closurePlatformEpoch: null } };
    }), "Student");

    if ("status" in result) {
      return result.status === 404
        ? validationError("الطالب غير موجود.", 404)
        : validationError("تغيّرت حالة الطالب منذ فتح القائمة. حدّث القائمة ثم أعد المحاولة.", 409);
    }
    const { id, dismissedChecked, dismissedCheckEpoch, closurePlatformEpoch } = result.student;
    return NextResponse.json(
      { student: { id, dismissedChecked, dismissedCheckEpoch, closurePlatformEpoch } },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return routeErrorResponse(error, "تعذر حفظ فتح كود الطالب.");
  }
}
