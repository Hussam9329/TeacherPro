import type { Prisma } from "@prisma/client";
import {
  ARCHIVED_STUDENT_STATUS,
  buildStudentArchiveSummary,
  getStudentDeleteImpactInTransaction,
} from "@/lib/student-delete-impact";
import { getStudentUniqueKeys } from "@/lib/student-utils";

/** The word added to a withdrawn student's name: «حسام خليل» → «حسام خليل انسحاب». */
export const WITHDRAWAL_WORD = "انسحاب";

export class StudentWithdrawalError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
    this.name = "StudentWithdrawalError";
  }
}

/** The name with «انسحاب» at its end, added once. */
export function withdrawnStudentName(name: string): string {
  const trimmed = name.trim();
  return new RegExp(`(^|\\s)${WITHDRAWAL_WORD}$`).test(trimmed) ? trimmed : `${trimmed} ${WITHDRAWAL_WORD}`;
}

/**
 * «انسحاب»: the student's name gets «انسحاب» and the student is archived, in
 * one transaction (the caller's), exactly as «أرشفة» does it: opportunities
 * go to 0, an archive note and an audit line are written. Both happen or
 * neither does.
 */
export async function withdrawStudentInTransaction(
  tx: Prisma.TransactionClient,
  studentId: string,
  actor: { id: string; name: string },
) {
  const impact = await getStudentDeleteImpactInTransaction(tx, studentId);
  if (!impact) throw new StudentWithdrawalError("تعذر العثور على الطالب المطلوب.", 404);
  if (impact.student.status === ARCHIVED_STUDENT_STATUS) {
    throw new StudentWithdrawalError("الطالب مؤرشف مسبقاً.", 409);
  }

  const current = await tx.student.findUnique({
    where: { id: studentId },
    select: { name: true, phone: true, telegram: true, opportunities: true },
  });
  if (!current) throw new StudentWithdrawalError("تعذر العثور على الطالب المطلوب.", 404);

  const name = withdrawnStudentName(current.name);
  const { nameKey } = getStudentUniqueKeys({ id: studentId, name, phone: current.phone, telegram: current.telegram });
  if (nameKey) {
    const sameName = await tx.student.findFirst({ where: { nameKey, id: { not: studentId } }, select: { name: true, code: true } });
    if (sameName) {
      throw new StudentWithdrawalError(`يوجد طالب آخر باسم «${sameName.name}» (${sameName.code})؛ عدّل أحد الاسمين ثم أعد المحاولة.`, 409);
    }
  }

  const relationSummary = buildStudentArchiveSummary(impact.counts);
  const balanceBefore = Math.max(0, Number(current.opportunities ?? 0));
  const student = await tx.student.update({
    where: { id: studentId },
    data: {
      name,
      nameKey,
      // An archived student holds no opportunities, as with «أرشفة».
      status: ARCHIVED_STUDENT_STATUS,
      opportunities: 0,
      baseOpportunities: 0,
    },
  });
  await tx.studentNote.create({
    data: {
      studentId,
      kind: "أرشفة",
      text: `انسحاب الطالب: أُضيفت كلمة «${WITHDRAWAL_WORD}» لاسمه وأُرشف. الاسم السابق: ${current.name}. الحالة السابقة: ${impact.student.status || "غير محددة"}. الفرص قبل الأرشفة: ${balanceBefore}، وأصبحت 0.`,
      sourceType: "student-archive",
      sourceId: studentId,
    },
  });
  await tx.auditLog.create({
    data: {
      module: "سجل الطلاب",
      action: "انسحاب طالب وأرشفته",
      details: `${current.name} ← ${name} - ${impact.student.code} - ${relationSummary}`,
      userId: actor.id,
      userName: actor.name,
    },
  });
  return student;
}
