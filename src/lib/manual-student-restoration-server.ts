import type { Prisma } from "@prisma/client";
import { migrateDismissedPendingGradesAfterActivation } from "./grade-smart-note-reactivation-server";
import { manualRestorationAmount } from "./manual-restoration";

export class StudentActionError extends Error {
  constructor(message: string, public readonly statusCode = 409) {
    super(message);
    this.name = "StudentActionError";
  }
}

/** Both explicit recovery entry points use this one atomic operation. The
 * caller owns the SERIALIZABLE transaction and checks students.edit permission. */
export async function restoreDismissedStudentManually(
  tx: Prisma.TransactionClient,
  input: {
    studentId: string;
    amount: unknown;
    reason: string;
    actor: { id: string; name: string };
  },
) {
  const amount = manualRestorationAmount(input.amount);
  if (amount === null) throw new StudentActionError("أدخل عدداً صحيحاً من الفرص، فرصة واحدة على الأقل.", 400);
  const reason = input.reason.trim();
  if (!reason || reason.length > 2000) {
    throw new StudentActionError("أدخل سبب الاستعادة بما لا يتجاوز 2000 حرف.", 400);
  }
  const student = await tx.student.findUnique({ where: { id: input.studentId } });
  if (!student) throw new StudentActionError("الطالب غير موجود أو تم حذفه.", 404);
  if (student.status !== "مفصول") {
    throw new StudentActionError("الاستعادة اليدوية مخصصة للطالب المفصول حالياً. حدّث السجل وراجع حالة الطالب.");
  }
  const links = await tx.courseChapter.findMany({
    where: { courseId: student.courseId, active: true, archived: false },
    select: { chapter: { select: { id: true, name: true, opportunities: true } } },
    take: 2,
  });
  const chapter = links.length === 1 ? links[0].chapter : null;
  if (!chapter || chapter.opportunities <= 0) {
    throw new StudentActionError("لا يمكن استعادة الطالب قبل تثبيت فصل نشط واحد بفرص صالحة لدورته.");
  }
  if (amount > chapter.opportunities) {
    throw new StudentActionError(`عدد فرص الاستعادة يجب ألا يتجاوز سقف الفصل الحالي (${chapter.opportunities}).`, 400);
  }

  const now = new Date();
  const updatedStudent = await tx.student.update({
    where: { id: student.id },
    data: {
      status: "نشط", dismissalReason: "", dismissalNotes: "",
      opportunities: amount, baseOpportunities: chapter.opportunities,
    },
  });
  const pendingGradeMigration = await migrateDismissedPendingGradesAfterActivation(
    tx, student.id, input.actor, now,
  );
  // All grades already present at recovery remain history. Their edits must
  // not spend the restored balance a second time, including same-day exams.
  const settledGrades = await tx.grade.findMany({ where: { studentId: student.id }, select: { id: true } });
  const common = {
    studentId: student.id, examId: null, date: now, ledgerVersion: 2,
    chapterId: chapter.id, chapterNameSnapshot: chapter.name,
    balanceBefore: student.opportunities, balanceAfter: amount,
  };
  const reactivationLog = await tx.opportunityLog.create({
    data: { ...common, action: "إعادة تفعيل", amount: 0, reason },
  });
  const balanceLog = await tx.opportunityLog.create({
    data: {
      ...common, action: "رصيد إعادة التفعيل", amount, requestedAmount: amount,
      appliedAmount: amount - student.opportunities,
      settledGradeIds: JSON.stringify(settledGrades.map(grade => grade.id)), reason,
    },
  });
  const studentNote = await tx.studentNote.create({
    data: {
      studentId: student.id, kind: "إجراء", sourceType: "student-status-action", sourceId: student.id,
      text: `${reason} — أصبح الطالب نشطاً برصيد ${amount} من الفرص. سبب الفصل السابق: ${student.dismissalReason || "بدون سبب مسجل"}${student.dismissalNotes ? `؛ ملاحظات الفصل السابق: ${student.dismissalNotes}` : ""}`,
    },
  });
  await tx.auditLog.create({
    data: {
      module: "إدارة المفصولين", action: "استعادة الطالب المفصول يدوياً",
      details: `${student.name} - ${student.code} | مفصول ← نشط | الفرص: ${student.opportunities} ← ${amount} | السبب: ${reason}`,
      userId: input.actor.id, userName: input.actor.name,
    },
  });
  return {
    student: updatedStudent, opportunityLogs: [reactivationLog, balanceLog],
    opportunityLog: balanceLog, studentNotes: [studentNote], pendingGradeMigration,
    reactivated: true as const,
  };
}
