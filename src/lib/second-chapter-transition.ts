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

export function isSecondChapterProtectedOpportunityReason(
  value: unknown,
): boolean {
  return SECOND_CHAPTER_PROTECTED_OPPORTUNITY_REASONS.includes(
    String(value || "") as (typeof SECOND_CHAPTER_PROTECTED_OPPORTUNITY_REASONS)[number],
  );
}
