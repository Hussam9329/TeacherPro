import type { Grade } from "@/lib/teacher-store";

type GradeCountRow = Pick<
  Grade,
  "studentId" | "examId" | "status" | "score"
>;

/**
 * Counts ALL manual grades for an exam including pending ones.
 * 
 * This includes:
 * - Numeric grades with status "درجة" and valid score ✅
 * - Pre-registration numeric grades (status "درجة" or "قبل تسجيل الطالب") ✅ 🆕
 * - Pending grades with status "درجة" but null score (ورقة معلقة)
 * - Pending grades with status "درجة معلّقة" (الدرجات المعلقة للمراجعة) ✅🆕
 * 
 * Excludes ONLY purely automatic system statuses:
 * - "غائب" (absent - system generated)
 * - "غش" (cheating - system generated)
 * - "مجاز" (on leave - system generated)
 * - "ضمن فترة السماح" (grace period - system generated)
 * 
 * IMPORTANT: 
 * - "قبل تسجيل الطالب" WITH a numeric score IS included because it was manually entered!
 * - "درجة معلّقة" ALWAYS counts as pending regardless of score value!
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

    // === حالة 0: درجة معلّقة (درجة معلّقة) -> دائماً تُحتسب كمعلقة 🆕===
    if (grade.status === "درجة معلّقة") {
      pendingStudentIds.add(grade.studentId);
      continue;
    }

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
