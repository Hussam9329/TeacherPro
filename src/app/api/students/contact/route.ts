export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { Prisma } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { requirePermissionPrincipal } from "@/lib/server-auth";
import { routeErrorResponse, validationError } from "@/lib/route-helpers";
import { withDatabaseSchema } from "@/lib/schema-readiness";
import { withSerializableTransaction } from "@/lib/serializable-transaction";
import { getPhoneValidationError, sanitizePhoneInput } from "@/lib/format";
import { getStudentDuplicateMessage, getStudentUniqueKeys, sanitizeTelegramInput } from "@/lib/student-utils";
import { ARCHIVED_STUDENT_STATUS } from "@/lib/student-delete-impact";
import { archivedStudentLockedResponse } from "@/lib/archived-student-guard";
import { studentEditChanges, studentEditChangesSuffix } from "@/lib/student-edit-changes";

class ContactEditError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
    this.name = "ContactEditError";
  }
}
class ArchivedStudent extends Error {}

const FIELDS = { username: "يوزر تيليجرام", phone: "رقم الطالب", parentPhone: "رقم ولي الأمر" } as const;
type ContactField = keyof typeof FIELDS;

/**
 * One contact of a student — the Telegram username, the student's number or
 * the parent's number — changed from a card («سجل الطلاب», «إغلاق الكودات»,
 * «إدارة ملاحظات المكالمات») without the full student edit. Only that field
 * is written, checked as the registry edit checks it, with the same
 * permission (students.edit) and the same «تعديل بيانات طالب» log line.
 */
export async function PUT(req: NextRequest) {
  const principal = await requirePermissionPrincipal(req, "students.edit");
  if (principal instanceof NextResponse) return principal;
  try {
    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    const studentId = typeof body?.studentId === "string" ? body.studentId.trim() : "";
    if (!studentId || studentId.length > 128) return validationError("تعذر تحديد الطالب المطلوب.");
    const field = String(body?.field || "") as ContactField;
    if (!(field in FIELDS)) return validationError("الحقل المطلوب تعديله غير معروف.");
    if (typeof body?.value !== "string" || body.value.length > 64) return validationError(`${FIELDS[field]} غير صحيح.`);

    let value: string | null;
    if (field === "username") {
      // As the registry keeps it: no «@» or spaces; a number is a Telegram id, not a username.
      const cleaned = sanitizeTelegramInput(body.value).replace(/\s+/g, "");
      if (/^\d+$/.test(cleaned)) return validationError("اكتب اليوزر (حروف)، مو الرقم.");
      value = cleaned || null;
    } else {
      const phoneError = getPhoneValidationError(body.value, FIELDS[field], true);
      if (phoneError) return validationError(phoneError);
      value = sanitizePhoneInput(body.value);
    }

    const student = await withDatabaseSchema(
      () => withSerializableTransaction(async (tx) => {
        const current = await tx.student.findUnique({ where: { id: studentId } });
        if (!current) throw new ContactEditError("الطالب غير موجود.", 404);
        if (current.status === ARCHIVED_STUDENT_STATUS) throw new ArchivedStudent();
        if ((current[field] || null) === value) return current;
        const data: Prisma.StudentUpdateInput = { [field]: value };
        if (field === "phone") {
          // The student's number identifies the student, as in the registry.
          const identity = { id: current.id, name: current.name, phone: value, telegram: current.telegram };
          const { phoneKey } = getStudentUniqueKeys(identity);
          const others = phoneKey
            ? await tx.student.findMany({ where: { phoneKey, NOT: { id: current.id } }, select: { id: true, name: true, phone: true, telegram: true }, take: 5 })
            : [];
          const duplicate = getStudentDuplicateMessage(others, identity, current.id);
          if (duplicate) throw new ContactEditError(duplicate, 409);
          data.phoneKey = phoneKey;
        }
        const updated = await tx.student.update({ where: { id: current.id }, data });
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
      { student: { id: student.id, [field]: student[field] } },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    if (error instanceof ArchivedStudent) return archivedStudentLockedResponse();
    if (error instanceof ContactEditError) return validationError(error.message, error.status);
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return validationError("رقم الطالب مسجّل لطالب ثاني.", 409);
    }
    return routeErrorResponse(error, "تعذر حفظ بيانات التواصل.");
  }
}
