import type { Prisma } from "@prisma/client";

export class DismissedCheckError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
    this.name = "DismissedCheckError";
  }
}

export type DismissedCheckInput = {
  studentId: string;
  checked: boolean;
  expectedChecked: boolean;
  expectedEpoch: number;
};

export function parseDismissedCheckInput(body: unknown): DismissedCheckInput {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new DismissedCheckError("بيانات اغلاق كود غير صحيحة.", 400);
  }
  const row = body as Record<string, unknown>;
  if (typeof row.studentId !== "string" || !row.studentId.trim() || row.studentId.length > 128) {
    throw new DismissedCheckError("تعذر تحديد الطالب المطلوب.", 400);
  }
  if (typeof row.checked !== "boolean" || typeof row.expectedChecked !== "boolean") {
    throw new DismissedCheckError("يرجى تحديد حالة اغلاق كود الصحيحة.", 400);
  }
  if (row.expectedEpoch === undefined) {
    throw new DismissedCheckError("حدّث سجل الطلاب قبل تغيير حالة اغلاق كود.", 409);
  }
  if (typeof row.expectedEpoch !== "number" || !Number.isSafeInteger(row.expectedEpoch) || row.expectedEpoch < 0) {
    throw new DismissedCheckError("نسخة حالة اغلاق كود غير صحيحة.", 400);
  }
  return { studentId: row.studentId.trim(), checked: row.checked, expectedChecked: row.expectedChecked, expectedEpoch: row.expectedEpoch };
}

/** Caller owns the transaction: the flag and its audit either both commit or neither does. */
export async function updateDismissedCheck(
  tx: Prisma.TransactionClient,
  input: DismissedCheckInput,
  actor: { id: string; name: string },
) {
  const student = await tx.student.findUnique({
    where: { id: input.studentId },
    select: { id: true, name: true, code: true, status: true, dismissedChecked: true, dismissedCheckEpoch: true },
  });
  if (!student) throw new DismissedCheckError("الطالب غير موجود.", 404);
  if (student.status !== "مفصول") {
    throw new DismissedCheckError("تغيّرت حالة الطالب؛ اغلاق كود متاح للمفصولين فقط.", 409);
  }
  if (student.dismissedCheckEpoch !== input.expectedEpoch) {
    throw new DismissedCheckError("تغيّرت حالة الطالب منذ فتح السجل. حدّث السجل قبل اغلاق كود.", 409);
  }
  // Explicit assignment is safely idempotent when two operators request the same value.
  if (student.dismissedChecked === input.checked) {
    return { id: student.id, status: student.status, dismissedChecked: student.dismissedChecked, dismissedCheckEpoch: student.dismissedCheckEpoch };
  }
  if (student.dismissedChecked !== input.expectedChecked) {
    throw new DismissedCheckError("غيّر مستخدم آخر حالة اغلاق كود. راجع الحالة ثم أعد المحاولة.", 409);
  }
  const updated = await tx.student.updateMany({
    where: { id: student.id, status: "مفصول", dismissedChecked: input.expectedChecked, dismissedCheckEpoch: input.expectedEpoch },
    data: { dismissedChecked: input.checked },
  });
  if (updated.count !== 1) {
    throw new DismissedCheckError("تغيّرت بيانات الطالب أثناء الحفظ. حدّث السجل ثم أعد المحاولة.", 409);
  }
  await tx.auditLog.create({
    data: {
      module: "سجل الطلاب",
      action: input.checked ? "اغلاق كود الطالب المفصول" : "إلغاء اغلاق كود الطالب المفصول",
      userId: actor.id,
      userName: actor.name,
      details: JSON.stringify({ studentId: student.id, name: student.name, code: student.code,
        before: { dismissedChecked: student.dismissedChecked },
        after: { dismissedChecked: input.checked } }),
    },
  });
  return { id: student.id, status: student.status, dismissedChecked: input.checked, dismissedCheckEpoch: student.dismissedCheckEpoch };
}
