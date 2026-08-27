import { db } from "@/lib/db";
import { withSerializableTransaction } from "@/lib/serializable-transaction";
import { recalculateStudentsForExam } from "@/lib/academic-recalculate-server";

export type ScheduledExamActivationSettlement = {
  scanned: number;
  activated: number;
  recalculatedStudents: number;
  examIds: string[];
};

/**
 * Materializes exams whose scheduled activation time has passed and rebuilds
 * every persisted academic side effect that depends on exam availability.
 * getExamStatus() already treats a due schedule as active for reads, but the
 * student's stored opportunities/dismissal state can only become consistent
 * after the academic engine runs. This job closes that time-transition gap.
 *
 * The update is conditional and each exam is settled in a SERIALIZABLE
 * transaction, so repeated/overlapping cron runs are idempotent.
 */
export async function settleDueScheduledExamActivations(
  input: { now?: Date; batchSize?: number } = {},
): Promise<ScheduledExamActivationSettlement> {
  const now = input.now || new Date();
  const batchSize = Math.max(1, Math.min(100, Math.trunc(input.batchSize || 25)));
  const due = await db.exam.findMany({
    where: {
      active: false,
      scheduledActivateAt: { not: null, lte: now },
    },
    select: { id: true },
    orderBy: [{ scheduledActivateAt: "asc" }, { id: "asc" }],
    take: batchSize,
  });

  const result: ScheduledExamActivationSettlement = {
    scanned: due.length,
    activated: 0,
    recalculatedStudents: 0,
    examIds: [],
  };

  for (const candidate of due) {
    const settled = await withSerializableTransaction(async (tx) => {
      const exam = await tx.exam.findUnique({
        where: { id: candidate.id },
        select: {
          id: true,
          name: true,
          active: true,
          scheduledActivateAt: true,
        },
      });
      if (
        !exam ||
        exam.active ||
        !exam.scheduledActivateAt ||
        exam.scheduledActivateAt > now
      ) {
        return null;
      }

      const claimed = await tx.exam.updateMany({
        where: {
          id: exam.id,
          active: false,
          scheduledActivateAt: { not: null, lte: now },
        },
        data: { active: true },
      });
      if (claimed.count !== 1) return null;

      const recalculation = await recalculateStudentsForExam(exam.id, { tx });
      await tx.auditLog.create({
        data: {
          module: "الامتحانات",
          action: "تفعيل امتحان مجدول تلقائياً",
          details: `${exam.name} - ${exam.id} - إعادة احتساب ${recalculation.students.length} طالب`,
          userName: "TeacherPro - Academic Cron",
        },
      });
      return {
        examId: exam.id,
        recalculatedStudents: recalculation.students.length,
      };
    });

    if (!settled) continue;
    result.activated += 1;
    result.recalculatedStudents += settled.recalculatedStudents;
    result.examIds.push(settled.examId);
  }

  return result;
}
