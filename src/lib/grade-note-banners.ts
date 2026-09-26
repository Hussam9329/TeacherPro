/**
 * قاموس بانرات ملاحظات الدرجات — نسخة مبسّطة لمستوى واجهة سجل الدرجات.
 *
 * الهدف: بدل عرض نصوص آلية طويلة ومربكة (مثل «تم تصحيح الدرجة يدوياً بدلاً
 * من التسجيل التلقائي السابق.») نعرض بانر قصير ملوّن بأيقونة واضحة.
 *
 * المبدأ:
 *  - أي ملاحظة آلية معروفة (نص قديم طويل أو نص قصير جديد) → بانر قصير بلون دال.
 *  - أي ملاحظة كتبها المستخدم بنفسه → تبقى كما هي تماماً (بانر محايد).
 *  - هذه الوحدة نقية (بدون React/أيقونات) ليعاد استخدامها في العرض والتصدير
 *    ومنطق الحفظ على السيرفر والعميل على حد سواء.
 */

export type GradeNoteBannerKey =
  | "corrected"
  | "batch-absent"
  | "auto-absent"
  | "before-registration"
  | "grace"
  | "excused"
  | "deferred";

export interface GradeNoteBannerInfo {
  key: GradeNoteBannerKey;
  /** النص القصير الظاهر داخل البانر */
  label: string;
  /** نص فرعي صغير اختياري (مثل سبب الإجازة) */
  detail?: string;
  /** شرح كامل يظهر عند التمرير (title) لمن يريد التفصيل */
  title: string;
}

/** النصوص القصيرة المعتمدة التي يولّدها السيرفر من الآن فصاعداً */
export const CANONICAL_GRADE_NOTE_TEXTS = [
  "تصحيح يدوي",
  "غياب جماعي",
  "غياب تلقائي",
  "قبل تسجيل الطالب",
  "فترة سماح",
  "إجازة",
  "درجة مؤجلة أثناء الفصل",
] as const;

/** العبارات الآلية القديمة الطويلة (تاريخية — لا يولّدها السيرفر بعدُ) */
const LEGACY_PATTERNS = {
  corrected: ["تم تصحيح الدرجة يدوياً"],
  batchAbsent: ["تسجيل جماعي كغائب"],
  autoAbsent: ["لم تُدخل درجة الطالب في امتحان سابق"],
  beforeRegistration: [
    "تسجيل تلقائي: الامتحان يسبق تاريخ تسجيل الطالب",
    "الامتحان يسبق تاريخ تسجيل الطالب",
  ],
  grace: ["تسجيل تلقائي: الطالب ضمن فترة السماح"],
  excused: [
    "تسجيل تلقائي: الطالب مجاز من هذا الامتحان",
    "الطالب مجاز من هذا الامتحان",
  ],
} as const;

/** بادئة ملاحظة «درجة مؤجلة أثناء الفصل» — النص القديم كان يلحق سبباً ثابتاً بعدها */
const PREFIX_DEFERRED = "درجة مؤجلة أثناء الفصل";
const DEFERRED_LEGACY = [
  "درجة مؤجلة أثناء فصل الطالب",
  // الصياغة الجديدة المعتمدة من صاحب النظام (تُحدَّث في السجلات القديمة)
  "تم تعليق الدرجة لان الطالب امتحن وهو مفصول",
] as const;

const containsAny = (notes: string, patterns: readonly string[]): boolean =>
  patterns.some((p) => notes.includes(p));

const PREFIX_EXCUSED_REASON = "إجازة: ";
const PREFIX_LEGACY_EXCUSED_REASON = "الطالب مجاز من هذا الامتحان: ";

/**
 * يطابق ملاحظة الدرجة مع قاموس البانرات.
 * يعيد null إذا كانت الملاحظة نصاً مخصصاً كتبه المستخدم (لا تحوَّل ولا تُمس).
 */
export function resolveGradeNoteBanner(
  notes: string | null | undefined,
): GradeNoteBannerInfo | null {
  const raw = (notes ?? "").trim();
  if (!raw) return null;

  // إجازة (مع سبب اختياري) — تفحص أولاً لأن النص الدقيق «إجازة» جزء من البادئة
  if (raw === "إجازة") {
    return {
      key: "excused",
      label: "إجازة",
      title: "الطالب مُجاز من هذا الامتحان بإجازة رسمية",
    };
  }
  if (raw.startsWith(PREFIX_EXCUSED_REASON)) {
    return {
      key: "excused",
      label: "إجازة",
      detail: raw.slice(PREFIX_EXCUSED_REASON.length).trim() || undefined,
      title: "الطالب مُجاز من هذا الامتحان بإجازة رسمية",
    };
  }
  if (raw.startsWith(PREFIX_LEGACY_EXCUSED_REASON)) {
    return {
      key: "excused",
      label: "إجازة",
      detail: raw.slice(PREFIX_LEGACY_EXCUSED_REASON.length).trim() || undefined,
      title: "الطالب مُجاز من هذا الامتحان بإجازة رسمية",
    };
  }
  if (containsAny(raw, LEGACY_PATTERNS.excused)) {
    return {
      key: "excused",
      label: "إجازة",
      title: "الطالب مُجاز من هذا الامتحان بإجازة رسمية",
    };
  }

  if (raw === "تصحيح يدوي" || containsAny(raw, LEGACY_PATTERNS.corrected)) {
    return {
      key: "corrected",
      label: "تصحيح يدوي",
      title: "أدخلها المشرف يدوياً بدلاً من التسجيل التلقائي السابق",
    };
  }

  if (raw === "غياب جماعي" || containsAny(raw, LEGACY_PATTERNS.batchAbsent)) {
    return {
      key: "batch-absent",
      label: "غياب جماعي",
      title: "سُجّل غياباً تلقائياً لعدم إدخال درجة الطالب",
    };
  }

  if (
    raw === "غياب تلقائي" ||
    containsAny(raw, LEGACY_PATTERNS.autoAbsent)
  ) {
    return {
      key: "auto-absent",
      label: "غياب تلقائي",
      title: "سُجّل غياباً تلقائياً لأن درجته لم تُدخل في امتحان سابق",
    };
  }

  if (
    raw === "قبل تسجيل الطالب" ||
    containsAny(raw, LEGACY_PATTERNS.beforeRegistration)
  ) {
    return {
      key: "before-registration",
      label: "قبل تسجيل الطالب",
      title: "تاريخ الامتحان يسبق تاريخ تسجيل الطالب في الدورة",
    };
  }

  if (raw === "فترة سماح" || containsAny(raw, LEGACY_PATTERNS.grace)) {
    return {
      key: "grace",
      label: "فترة سماح",
      title: "سُجّل تلقائياً لأن الطالب كان ضمن فترة السماح",
    };
  }

  // درجة مؤجلة أثناء الفصل — أدخلها أحد أثناء فصل الطالب، ونُقلت للسجل بعد
  // إعادة تفعيله للتوثيق فقط (النص القديم كان: البادئة + سبب ثابت طويل)
  if (raw.startsWith(PREFIX_DEFERRED) || containsAny(raw, DEFERRED_LEGACY)) {
    return {
      key: "deferred",
      label: "درجة مؤجلة",
      detail: "تم تعليق الدرجة لان الطالب امتحن وهو مفصول",
      title:
        "درجة أُدخلت أثناء فصل الطالب؛ حُفظت في السجل بعد إعادة التفعيل دون احتساب أكاديمي",
    };
  }

  // ملاحظة مخصصة كتبها المستخدم — تبقى كما هي
  return null;
}

/** هل هذه الملاحظة آلية معروفة (قديمة أو جديدة)؟ يُستعمل في منطق ورقة الإدخال */
export function isAutomaticGradeNote(
  notes: string | null | undefined,
): boolean {
  return resolveGradeNoteBanner(notes) !== null;
}

/** نص قصير مفهوم للسياقات النصية (نسخ/تصدير/ملخصات تدقيق) */
export function shortGradeNoteText(
  notes: string | null | undefined,
): string {
  const banner = resolveGradeNoteBanner(notes);
  if (!banner) return notes ?? "";
  return banner.detail ? `${banner.label}: ${banner.detail}` : banner.label;
}
