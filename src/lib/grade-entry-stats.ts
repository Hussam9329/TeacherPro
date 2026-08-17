import type { Grade } from "@/lib/teacher-store";

type GradeCountRow = Pick<
  Grade,
  "studentId" | "examId" | "status" | "score"
>;

/**
 * Counts the official numeric grades entered for one exam.
 *
 * Automatic rows such as grace-period, absence, leave use a non-numeric status
 * and are deliberately not included. A manually entered zero still counts.
 * 
 * NOTE: Pre-registration grades with status "درجة" ARE included because they
 * were manually entered by the teacher. Only pure automatic statuses are excluded.
 */
export function countManualNumericGradesForExam(
  grades: readonly GradeCountRow[],
  examId: string,
) {
  if (!examId) return 0;

  const gradedStudentIds = new Set<string>();
  
  // الحالات التلقائية البحتة التي يجب استبعادها فقط
  // (الدرجات قبل التسجيل التي أدخلها المعلم يدوياً تُحتسب!)
  const purelyAutomaticStatuses = new Set([
    "غائب",      // غياب تلقائي
    "غش",        // غش تلقائي
    "مجاز",      // إجازة تلقائية
    "ضمن فترة السماح", // فترة سماح تلقائية
  ]);

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
 * Counts ALL manual grades for an exam including pending ones.
 * 
 * This includes:
 * - Numeric grades with status "درجة" and valid score ✅
 * - Pre-registration numeric grades (status "درجة" or "قبل تسجيل الطالب") ✅ 🆕
 * - Pending grades with status "درجة" but null score (ورقة معلقة)
 * 
 * Excludes ONLY purely automatic system statuses:
 * - "غائب" (absent - system generated)
 * - "غش" (cheating - system generated)
 * - "مجاز" (on leave - system generated)
 * - "ضمن فترة السماح" (grace period - system generated)
 * 
 * IMPORTANT: "قبل تسجيل الطالب" WITH a numeric score IS included because
 * it was manually entered by the teacher! 🆕
 */
export function countAllManualGradesForExam(
  grades: readonly GradeCountRow[],
  examId: string,
): { numeric: number; preRegistration: number; pending: number; total: number } {
  if (!examId) return { numeric: 0, preRegistration: 0, pending: 0, total: 0 };

  const numericStudentIds = new Set<string>();
  const preRegistrationStudentIds = new Set<string>();
  const pendingStudentIds = new Set<string>();

  // الحالات التلقائية البحتة فقط (النظام يولدها تلقائياً بدون تدخل المعلم)
  const purelyAutomaticStatuses = new Set([
    "غائب",
    "غش", 
    "مجاز",
    "ضمن فترة السماح",
  ]);

  for (const grade of grades) {
    // تخطي الدرجات التي لا تخص هذا الامتحان
    if (grade.examId !== examId) continue;

    // تخطي الحالات التلقائية البحتة للنظام
    if (purelyAutomaticStatuses.has(grade.status)) continue;

    // === حالة 1: درجة عادية محفوظة (درجة + رقمية) ===
    if (grade.status === "درجة") {
      if (
        typeof grade.score === "number" &&
        Number.isFinite(grade.score)
      ) {
        numericStudentIds.add(grade.studentId);
      } else if (grade.score === null || grade.score === undefined) {
        // درجة معلقة (ورقة بدون درجة بعد)
        pendingStudentIds.add(grade.studentId);
      }
    }
    
    // === حالة 2: درجة قبل التسجيل (قبل تسجيل الطالب + رقمية) 🆕 ===
    else if (
      grade.status === "قبل تسجيل الطالب" &&
      typeof grade.score === "number" &&
      Number.isFinite(grade.score)
    ) {
      // هذه الدرجة أدخلها المعلم يدوياً -> تُحتسب!
      preRegistrationStudentIds.add(grade.studentId);
    }
  }

  const totalNumeric = numericStudentIds.size + preRegistrationStudentIds.size;
  const totalAll = totalNumeric + pendingStudentIds.size;

  return {
    numeric: numericStudentIds.size,
    preRegistration: preRegistrationStudentIds.size,
    pending: pendingStudentIds.size,
    total: totalAll,
  };
}
