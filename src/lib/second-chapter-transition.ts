export const SECOND_CHAPTER_TRANSITION_MARKER_ID =
  "second_chapter_transition_summer_exemption_v1_20260814";

export const SECOND_CHAPTER_TRANSITION_MARKER_ACTION =
  "تنفيذ وحيد لانتقال الدورة الصيفية وطلاب الاعفاء إلى الفصل الثاني";

export const SECOND_CHAPTER_TRANSITION_NOTE_SOURCE =
  "second-chapter-transition-snapshot";

export const SECOND_CHAPTER_SETTLEMENT_REASON =
  "تسوية تاريخية: انتقال مؤكد إلى الفصل الثاني - الانسجة؛ تجاهل آثار امتحانات الفصل السابق وبدء رصيد جديد بثلاث فرص";

export const SECOND_CHAPTER_REACTIVATION_REASON =
  "تثبيت إعادة التفعيل بعد الانتقال إلى الفصل الثاني - الانسجة: لا يعاد الفصل بسبب سجلات الفصل السابق";

export const SECOND_CHAPTER_PROTECTED_OPPORTUNITY_REASONS = [
  SECOND_CHAPTER_SETTLEMENT_REASON,
  SECOND_CHAPTER_REACTIVATION_REASON,
] as const;

/**
 * Generic historical settlement reason used when a course switches its active
 * chapter through the regular `/api/course-chapters/activate` flow (i.e. any
 * future chapter transition for any course — not only the one-off summer/
 * exemption transition).
 *
 * The academic engine treats any opportunity log whose reason starts with
 * "تسوية تاريخية:" as a historical settlement boundary. Grades whose exam date
 * is on or before that boundary are skipped during recalculation. This is what
 * prevents a fresh chapter from immediately re-dismissing students because of
 * penalties accumulated in the previous chapter.
 *
 * Keeping the prefix identical to {@link SECOND_CHAPTER_SETTLEMENT_REASON}
 * means the engine's existing protection logic applies automatically; we do
 * not need a parallel recalculation path.
 */
export const CHAPTER_TRANSITION_SETTLEMENT_REASON =
  "تسوية تاريخية: تحويل فصل يدوي؛ تجاهل آثار امتحانات الفصل السابق وبدء رصيد جديد من الفصل النشط الجديد";

/**
 * Audit-log identifier minted once per chapter transition execution. It lets
 * us trace every batch of settlement logs created through the regular
 * activate flow, and lets a future admin see exactly when a chapter was
 * switched without re-reading the opportunity log table.
 */
export const CHAPTER_TRANSITION_AUDIT_SOURCE =
  "course-chapter-activate-transition";

export function isSecondChapterProtectedOpportunityReason(
  value: unknown,
): boolean {
  return SECOND_CHAPTER_PROTECTED_OPPORTUNITY_REASONS.includes(
    String(value || "") as (typeof SECOND_CHAPTER_PROTECTED_OPPORTUNITY_REASONS)[number],
  );
}
