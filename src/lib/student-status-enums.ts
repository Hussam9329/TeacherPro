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
