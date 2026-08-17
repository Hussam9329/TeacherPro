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

/**
 * Counts ALL manual grades for an exam including pending ones (الدرجات المعلقة).
 * 
 * This includes:
 * - Numeric grades with status "درجة" and valid score
 * - Pending grades with status "درجة" but null score (ورقة معلقة)
 * - Any manually entered grade that belongs to this exam
 * 
 * Excludes automatic system statuses:
 * - "غائب" (absent)
 * - "غش" (cheating)
 * - "مجاز" (on leave)
 * - "ضمن فترة السماح" (grace period - automatic)
 * - "قبل تسجيل الطالب" (pre-registration - automatic)
 */
export function countAllManualGradesForExam(
  grades: readonly GradeCountRow[],
  examId: string,
): { numeric: number; pending: number; total: number } {
  if (!examId) return { numeric: 0, pending: 0, total: 0 };

  const numericStudentIds = new Set<string>();
  const pendingStudentIds = new Set<string>();

  // الحالات التلقائية التي يجب استبعادها
  const automaticStatuses = new Set([
    "غائب",
    "غش", 
    "مجاز",
    "ضمن فترة السماح",
    "قبل تسجيل الطالب",
  ]);

  for (const grade of grades) {
    // تخطي الدرجات التي لا تخص هذا الامتحان
    if (grade.examId !== examId) continue;

    // تخطي الحالات التلقائية للنظام
    if (automaticStatuses.has(grade.status)) continue;

    // إذا كانت الحالة "درجة" (يدوية)
    if (grade.status === "درجة") {
      // تحقق إذا كانت درجة رقمية (محفوظة)
      if (
        typeof grade.score === "number" &&
        Number.isFinite(grade.score)
      ) {
        numericStudentIds.add(grade.studentId);
      } else if (grade.score === null || grade.score === undefined) {
        // درجة معلقة (لم تدخل بعد)
        pendingStudentIds.add(grade.studentId);
      }
    }
  }

  return {
    numeric: numericStudentIds.size,
    pending: pendingStudentIds.size,
    total: numericStudentIds.size + pendingStudentIds.size,
  };
}
