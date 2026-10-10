export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { requirePermissionPrincipal } from "@/lib/server-auth";
import { routeErrorResponse, validationError } from "@/lib/route-helpers";
import { withDatabaseSchema } from "@/lib/schema-readiness";
import { withSerializableTransaction } from "@/lib/serializable-transaction";
import { sanitizeTelegramInput } from "@/lib/student-utils";
import { ARCHIVED_STUDENT_STATUS } from "@/lib/student-delete-impact";
import { archivedStudentLockedResponse } from "@/lib/archived-student-guard";
import { studentEditChanges, studentEditChangesSuffix } from "@/lib/student-edit-changes";

class UsernameEditError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
    this.name = "UsernameEditError";
  }
}
class ArchivedStudent extends Error {}

/**
 * The student's Telegram username («يوزر تيليجرام»), changed from a card in
 * «إغلاق الكودات» or «إدارة ملاحظات المكالمات» without the full student
 * edit: only the username is written, with the same permission and the same
 * «تعديل بيانات طالب» line in the log as the registry edit.
 */
export async function PUT(req: NextRequest) {
  const principal = await requirePermissionPrincipal(req, "students.edit");
  if (principal instanceof NextResponse) return principal;
  try {
    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    const studentId = typeof body?.studentId === "string" ? body.studentId.trim() : "";
    if (!studentId || studentId.length > 128) return validationError("تعذر تحديد الطالب المطلوب.");
    if (typeof body?.username !== "string" || body.username.length > 64) return validationError("اليوزر غير صحيح.");
    // As the registry keeps it: no «@» or spaces; a number is a Telegram id, not a username.
    const cleaned = sanitizeTelegramInput(body.username).replace(/\s+/g, "");
    if (/^\d+$/.test(cleaned)) return validationError("اكتب اليوزر (حروف)، مو الرقم.");
    const username = cleaned || null;

    const student = await withDatabaseSchema(
      () => withSerializableTransaction(async (tx) => {
        const current = await tx.student.findUnique({ where: { id: studentId } });
        if (!current) throw new UsernameEditError("الطالب غير موجود.", 404);
        if (current.status === ARCHIVED_STUDENT_STATUS) throw new ArchivedStudent();
        if ((current.username || null) === username) return current;
        const updated = await tx.student.update({ where: { id: current.id }, data: { username } });
        await tx.auditLog.create({
          data: {
            module: "سجل الطلاب",
            action: "تعديل بيانات طالب",
            details: `${current.name} - ${current.code} - بدون تصفير${studentEditChangesSuffix(studentEditChanges(current, updated))}`,
            userId: principal.id,
            userName: principal.name,
          },
        });
        return updated;
      }),
      "Student",
    );
    return NextResponse.json(
      { student: { id: student.id, username: student.username } },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    if (error instanceof ArchivedStudent) return archivedStudentLockedResponse();
    if (error instanceof UsernameEditError) return validationError(error.message, error.status);
    return routeErrorResponse(error, "تعذر حفظ يوزر تيليجرام.");
  }
}
