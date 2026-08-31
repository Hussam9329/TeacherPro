// ============================================================================
// Student Status Enum
// ----------------------------------------------------------------------------
// الفصل في TeacherPro حالة واحدة فقط: "مفصول". لا يوجد تصنيف فرعي للفصل.
// تاريخ الفصل/إعادة التفعيل يُحفظ في السجلات، بينما الحالة الحالية تبقى واحدة
// من: نشط، مفصول، مؤرشف.
// ============================================================================

export const STUDENT_STATUS_VALUES = ["نشط", "مفصول", "مؤرشف"] as const;

export type StudentStatus = (typeof STUDENT_STATUS_VALUES)[number];

export const STUDENT_STATUS_ACTIVE: StudentStatus = "نشط";
export const STUDENT_STATUS_DISMISSED: StudentStatus = "مفصول";
export const STUDENT_STATUS_ARCHIVED: StudentStatus = "مؤرشف";

export function validateStudentStatus(value: unknown): StudentStatus {
  const v = typeof value === "string" ? value.trim() : "";
  if (!STUDENT_STATUS_VALUES.includes(v as StudentStatus)) {
    throw new Error(
      `قيمة الحالة "${v}" غير صالحة. القيم المسموح بها: ${STUDENT_STATUS_VALUES.join("، ")}.`,
    );
  }
  return v as StudentStatus;
}

export function isValidStudentStatus(value: unknown): boolean {
  return (
    typeof value === "string" &&
    (STUDENT_STATUS_VALUES as readonly string[]).includes(value)
  );
}
