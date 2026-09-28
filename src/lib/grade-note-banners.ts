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
  | "auto-absent"
  | "before-registration"
  | "grace"
  | "excused"
  | "deferred"
  | "promoted";

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
  "غياب تلقائي",
  "قبل تسجيل الطالب",
  "فترة سماح",
  "إجازة",
  "درجة مؤجلة أثناء الفصل",
] as const;

/** العبارات الآلية القديمة الطويلة (تاريخية — لا يولّدها السيرفر بعدُ) */
const LEGACY_PATTERNS = {
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
const PREFIX_EXCUSED_TEACHER_NOTE = "إجازة — ";
const PREFIX_LEGACY_EXCUSED_REASON = "الطالب مجاز من هذا الامتحان: ";

/** ملاحظة اعتماد درجة امتحان سابق لتسجيل الطالب (أداة الصيانة). */
const PREFIX_PROMOTED_PRE_REGISTRATION = "درجة مدخلة يدوياً لامتحان سابق لتسجيل الطالب";

/**
 * بادئات داخلية يعتمد عليها الحساب (grade-settlement.ts): تبقى محفوظة في
 * الدرجة كما هي، ولا تُعرض للمستخدم. يُعرض ما بعدها فقط، ويعيدها الحفظ.
 */
export const INTERNAL_GRADE_NOTE_PREFIXES = [
  "تسوية تاريخية بلا أثر:",
  "أثر أكاديمي فعّال بعد التسوية:",
] as const;

/** النص الافتراضي الذي تضعه أداة الإصلاح بعد البادئة حين لا توجد ملاحظة. */
const INTERNAL_PREFIX_FILLER = "غياب امتحان حالي";

/**
 * يفصل البادئة الداخلية عن الجزء الذي يراه المستخدم. الجزء الظاهر لا يُقصّ
 * من نهايته، حتى تبقى الكتابة داخل خانة الملاحظات طبيعية.
 */
export function splitInternalGradeNote(notes: string | null | undefined): {
  prefix: string;
  visible: string;
} {
  const raw = notes ?? "";
  const start = raw.trimStart();
  const prefix = INTERNAL_GRADE_NOTE_PREFIXES.find((item) => start.startsWith(item));
  if (!prefix) return { prefix: "", visible: raw };
  const rest = start.slice(prefix.length).replace(/^\s+/, "");
  return { prefix, visible: rest.trim() === INTERNAL_PREFIX_FILLER ? "" : rest };
}

/** الملاحظة كما يراها المستخدم: بلا البادئات الداخلية. */
export function visibleGradeNote(notes: string | null | undefined): string {
  return splitInternalGradeNote(notes).visible.trim();
}

/** قيمة خانة تعديل الملاحظة: الجزء الظاهر فقط. */
export function editableGradeNote(notes: string | null | undefined): string {
  return splitInternalGradeNote(notes).visible;
}

/**
 * يعيد البادئة الداخلية للملاحظة الأصلية بعد تعديلها من الخانة، فتعديل
 * الملاحظة من الواجهة لا يمسح أبداً ما يعتمد عليه الحساب.
 */
export function withInternalGradeNotePrefix(
  original: string | null | undefined,
  edited: string | null | undefined,
): string {
  const { prefix, visible } = splitInternalGradeNote(original);
  const next = edited ?? "";
  if (!prefix) return next;
  // لم يتغيّر شيء: تبقى الملاحظة الأصلية حرفياً.
  if (next === visible) return original ?? "";
  return next.trim() ? `${prefix} ${next}` : prefix;
}

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
  if (raw.startsWith(PREFIX_EXCUSED_TEACHER_NOTE)) {
    return {
      key: "excused",
      label: "إجازة",
      detail: raw.slice(PREFIX_EXCUSED_TEACHER_NOTE.length).trim() || undefined,
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

  if (raw.startsWith(PREFIX_PROMOTED_PRE_REGISTRATION)) {
    return {
      key: "promoted",
      label: "درجة قبل التسجيل (معتمدة)",
      title:
        "درجة امتحان سابق لتسجيل الطالب؛ قُدّم تاريخ تسجيله إلى تاريخ الامتحان واعتُمدت الدرجة محتسبة",
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
  const visible = visibleGradeNote(notes);
  const banner = resolveGradeNoteBanner(visible);
  if (!banner) return visible;
  return banner.detail ? `${banner.label}: ${banner.detail}` : banner.label;
}

const EXCUSED_NOTE = "إجازة";
const EXCUSED_NOTE_SEPARATOR = " — ";

/**
 * الجزء الذي كتبه الأستاذ من ملاحظة الدرجة. الملاحظات الآلية تعطي ""، وملاحظة
 * «إجازة: السبب — ملاحظة» سابقة تعطي «ملاحظة» فقط، فإعادة الحفظ لا تضيّع ما
 * كتبه الأستاذ ولا تكرّره.
 */
export function teacherPartOfGradeNote(
  notes: string | null | undefined,
  isOtherAutomatic: (note: string) => boolean = () => false,
): string {
  const raw = (notes ?? "").trim();
  if (!raw) return "";
  if (
    raw === EXCUSED_NOTE ||
    raw.startsWith(PREFIX_EXCUSED_REASON) ||
    raw.startsWith(PREFIX_EXCUSED_TEACHER_NOTE)
  ) {
    const separator = raw.indexOf(EXCUSED_NOTE_SEPARATOR);
    return separator >= 0 ? raw.slice(separator + EXCUSED_NOTE_SEPARATOR.length).trim() : "";
  }
  if (isAutomaticGradeNote(raw) || isOtherAutomatic(raw)) return "";
  return raw;
}

/**
 * ملاحظة الدرجة لطالب مُجاز سُجّل له غياب أو غش: سبب الإجازة التي تغطي
 * الامتحان، ثم ما كتبه الأستاذ إن وُجد — «إجازة: السبب — ملاحظة».
 */
export function composeExcusedGradeNote(
  reason: string | null | undefined,
  teacherSource: string | null | undefined,
  isOtherAutomatic?: (note: string) => boolean,
): string {
  const leaveReason = (reason ?? "").trim();
  const teacherNote = teacherPartOfGradeNote(teacherSource, isOtherAutomatic);
  if (leaveReason) {
    return teacherNote
      ? `${PREFIX_EXCUSED_REASON}${leaveReason}${EXCUSED_NOTE_SEPARATOR}${teacherNote}`
      : `${PREFIX_EXCUSED_REASON}${leaveReason}`;
  }
  return teacherNote ? `${PREFIX_EXCUSED_TEACHER_NOTE}${teacherNote}` : EXCUSED_NOTE;
}
