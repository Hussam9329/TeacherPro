import type { Prisma } from "@prisma/client";
import { buildMutationPreviewToken } from "@/lib/mutation-preview-token";
import { withSerializableTransaction } from "@/lib/serializable-transaction";

export type StudentDeleteImpactCounts = {
  grades: number;
  leaves: number;
  calls: number;
  notes: number;
  opportunityLogs: number;
  correctionSheets: number;
  telegramSubmissions: number;
  gradeSmartNotes: number;
};

export type StudentDeleteImpact = {
  student: {
    id: string;
    name: string;
    code: string;
    status: string;
  };
  counts: StudentDeleteImpactCounts;
  totalRelations: number;
  hasRelations: boolean;
  archiveRecommended: boolean;
  blockingReasons: string[];
  previewToken: string;
};

export const ARCHIVED_STUDENT_STATUS = "مؤرشف";

const impactLabels: Array<[keyof StudentDeleteImpactCounts, string]> = [
  ["grades", "درجات"],
  ["leaves", "إجازات"],
  ["calls", "مكالمات"],
  ["notes", "ملاحظات"],
  ["opportunityLogs", "سجلات فرص"],
  ["correctionSheets", "أوراق تصحيح"],
  ["telegramSubmissions", "مستلمات بوت"],
  ["gradeSmartNotes", "ملاحظات درجات ذكية"],
];

export function buildStudentArchiveSummary(
  counts: StudentDeleteImpactCounts,
): string {
  const parts = impactLabels
    .map(([key, label]) => [Number(counts[key] || 0), label] as const)
    .filter(([count]) => count > 0)
    .map(([count, label]) => `${count} ${label}`);

  return parts.length ? parts.join("، ") : "لا توجد بيانات مرتبطة";
}

export async function getStudentDeleteImpactInTransaction(
  tx: Prisma.TransactionClient,
  studentId: string,
): Promise<StudentDeleteImpact | null> {
  const studentSnapshot = await tx.student.findUnique({
    where: { id: studentId },
  });
  if (!studentSnapshot) return null;

  const [
    grades,
    leaves,
    calls,
    notes,
    opportunityLogs,
    correctionSheets,
    telegramSubmissions,
    gradeSmartNotes,
  ] = await Promise.all([
    tx.grade.count({ where: { studentId } }),
    tx.studentLeave.count({ where: { studentId } }),
    tx.studentCall.count({ where: { studentId } }),
    tx.studentNote.count({ where: { studentId } }),
    tx.opportunityLog.count({ where: { studentId } }),
    tx.correctionSheet.count({ where: { studentId } }),
    tx.telegramExamSubmission.count({ where: { studentId } }),
    tx.gradeSmartNote.count({ where: { studentId } }),
  ]);

  const counts: StudentDeleteImpactCounts = {
    grades,
    leaves,
    calls,
    notes,
    opportunityLogs,
    correctionSheets,
    telegramSubmissions,
    gradeSmartNotes,
  };
  const totalRelations = Object.values(counts).reduce(
    (sum, count) => sum + Number(count || 0),
    0,
  );

  return {
    student: {
      id: studentSnapshot.id,
      name: studentSnapshot.name,
      code: studentSnapshot.code,
      status: studentSnapshot.status,
    },
    counts,
    totalRelations,
    hasRelations: totalRelations > 0,
    archiveRecommended: true,
    blockingReasons: impactLabels
      .filter(([key]) => Number(counts[key] || 0) > 0)
      .map(([key, label]) => `${label}: ${counts[key]}`),
    previewToken: buildMutationPreviewToken(
      `student-archive:${studentSnapshot.id}`,
      { student: studentSnapshot, counts },
    ),
  };
}

export async function getStudentDeleteImpact(
  studentId: string,
): Promise<StudentDeleteImpact | null> {
  return withSerializableTransaction((tx) =>
    getStudentDeleteImpactInTransaction(tx, studentId),
  );
}
