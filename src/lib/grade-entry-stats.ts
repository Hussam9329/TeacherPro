import type { Grade } from "@/lib/teacher-store";

type GradeCountRow = Pick<
  Grade,
  "studentId" | "examId" | "status" | "score"
>;

/**
 * Counts the official numeric grades entered for one exam.
 *
 * Automatic rows such as grace-period, absence, leave, and pre-registration
 * use a non-numeric status and/or a null score, so they are deliberately not
 * included. A manually entered zero is still a real numeric grade and counts.
 */
export function countManualNumericGradesForExam(
  grades: readonly GradeCountRow[],
  examId: string,
) {
  if (!examId) return 0;

  const gradedStudentIds = new Set<string>();
  for (const grade of grades) {
    if (
      grade.examId !== examId ||
      grade.status !== "درجة" ||
      typeof grade.score !== "number" ||
      !Number.isFinite(grade.score)
    ) {
      continue;
    }
    gradedStudentIds.add(grade.studentId);
  }

  return gradedStudentIds.size;
}
