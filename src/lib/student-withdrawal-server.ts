import type { Prisma } from "@prisma/client";
import {
  ARCHIVED_STUDENT_STATUS,
  buildStudentArchiveSummary,
  getStudentDeleteImpactInTransaction,
} from "@/lib/student-delete-impact";
import { restoreArchivedStudentInTransaction } from "@/lib/student-archive-restore-server";
import { getStudentUniqueKeys } from "@/lib/student-utils";
import { statusBeforeWithdrawal, unwithdrawnStudentName, WITHDRAWAL_WORD, withdrawnStudentName } from "@/lib/withdrawal-rules";

export { statusBeforeWithdrawal, unwithdrawnStudentName, WITHDRAWAL_WORD, withdrawnStudentName };

export class StudentWithdrawalError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
    this.name = "StudentWithdrawalError";
  }
}

/** The name key for `name`, refused when another student already holds it. */
async function freeNameKey(
  tx: Prisma.TransactionClient,
  student: { id: string; phone: string | null; telegram: string | null },
  name: string,
) {
  const { nameKey } = getStudentUniqueKeys({ id: student.id, name, phone: student.phone, telegram: student.telegram });
  if (nameKey) {
    const sameName = await tx.student.findFirst({ where: { nameKey, id: { not: student.id } }, select: { name: true, code: true } });
    if (sameName) {
      throw new StudentWithdrawalError(`يوجد طالب آخر باسم «${sameName.name}» (${sameName.code})؛ عدّل أحد الاسمين ثم أعد المحاولة.`, 409);
    }
  }
  return nameKey;
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
  const nameKey = await freeNameKey(tx, { id: studentId, phone: current.phone, telegram: current.telegram }, name);

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

/**
 * «الغاء الانسحاب», the exact reverse of «انسحاب», in the caller's
 * transaction: «انسحاب» leaves the end of the name, and the student leaves
 * the archive through «استعادة من الأرشيف» back to the state they held
 * before: «مفصول» with the same reason, or «نشط». A note and an audit line
 * record it.
 */
export async function unwithdrawStudentInTransaction(
  tx: Prisma.TransactionClient,
  studentId: string,
  actor: { id: string; name: string },
) {
  const student = await tx.student.findUnique({ where: { id: studentId } });
  if (!student) throw new StudentWithdrawalError("تعذر العثور على الطالب المطلوب.", 404);
  if (student.status !== ARCHIVED_STUDENT_STATUS) {
    throw new StudentWithdrawalError("الطالب غير مؤرشف؛ «الغاء الانسحاب» للمؤرشفين فقط.", 409);
  }
  const name = unwithdrawnStudentName(student.name);
  if (!name) {
    throw new StudentWithdrawalError(`اسم الطالب لا ينتهي بكلمة «${WITHDRAWAL_WORD}»؛ استخدم «استعادة من الأرشيف».`, 409);
  }
  const nameKey = await freeNameKey(tx, student, name);
  const previousStatus = statusBeforeWithdrawal(student);

  const { updatedStudent, activeChapter, academicRecalculation } = await restoreArchivedStudentInTransaction(tx, student, {
    status: previousStatus,
    data: { name, nameKey },
  });
  const studentNote = await tx.studentNote.create({
    data: {
      studentId,
      kind: "استعادة",
      text: `الغاء انسحاب الطالب: شِيلت كلمة «${WITHDRAWAL_WORD}» من اسمه ورجع من الأرشيف لحالته قبل الانسحاب (${previousStatus}). الاسم السابق: ${student.name}. أُعيد احتساب ملفه حسب الفصل النشط: ${activeChapter.name}، وحالته الآن: ${updatedStudent.status}.`,
      sourceType: "student-archive-restore",
      sourceId: studentId,
    },
  });
  await tx.auditLog.create({
    data: {
      module: "سجل الطلاب",
      action: "الغاء انسحاب طالب",
      details: `${student.name} ← ${name} - ${student.code} - ${updatedStudent.status} - رصيد ${updatedStudent.opportunities}/${updatedStudent.baseOpportunities}`,
      userId: actor.id,
      userName: actor.name,
    },
  });
  return {
    student: updatedStudent,
    studentNotes: [studentNote],
    opportunityLogs: academicRecalculation.automaticOpportunityLogs,
  };
}
