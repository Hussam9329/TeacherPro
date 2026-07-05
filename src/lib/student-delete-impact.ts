import { db } from "@/lib/db";

export type StudentDeleteImpactCounts = {
  grades: number;
  leaves: number;
  calls: number;
  notes: number;
  opportunityLogs: number;
  correctionSheets: number;
  telegramSubmissions: number;
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

export async function getStudentDeleteImpact(
  studentId: string,
): Promise<StudentDeleteImpact | null> {
  const student = await db.student.findUnique({
    where: { id: studentId },
    select: { id: true, name: true, code: true, status: true },
  });
  if (!student) return null;

  const [
    grades,
    leaves,
    calls,
    notes,
    opportunityLogs,
    correctionSheets,
    telegramSubmissions,
  ] = await db.$transaction([
    db.grade.count({ where: { studentId } }),
    db.studentLeave.count({ where: { studentId } }),
    db.studentCall.count({ where: { studentId } }),
    db.studentNote.count({ where: { studentId } }),
    db.opportunityLog.count({ where: { studentId } }),
    db.correctionSheet.count({ where: { studentId } }),
    db.telegramExamSubmission.count({ where: { studentId } }),
  ]);

  const counts: StudentDeleteImpactCounts = {
    grades,
    leaves,
    calls,
    notes,
    opportunityLogs,
    correctionSheets,
    telegramSubmissions,
  };
  const totalRelations = Object.values(counts).reduce(
    (sum, count) => sum + Number(count || 0),
    0,
  );

  return {
    student,
    counts,
    totalRelations,
    hasRelations: totalRelations > 0,
    archiveRecommended: true,
    blockingReasons: impactLabels
      .filter(([key]) => Number(counts[key] || 0) > 0)
      .map(([key, label]) => `${label}: ${counts[key]}`),
  };
}
