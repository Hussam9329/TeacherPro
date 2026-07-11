/**
 * TeacherPro — القاموس المركزي للغة الواجهة.
 *
 * هذا الملف خاص بالنصوص التي يراها المستخدم فقط. لا تُغيّر أسماء الحقول،
 * قيم قاعدة البيانات، مسارات API، أو مفاتيح الصلاحيات عند استعماله.
 */

export const TEACHERPRO_TERMS = Object.freeze({
  missingStudents: "الطلاب غير الموجودين",
  cards: "البطاقات",
  card: "بطاقة",
  telegram: "تيليجرام",
  recordedGrades: "درجات مسجلة",
  programType: "نوع البرنامج",
  temporaryDismissal: "فصل مؤقت",
  finalDismissal: "فصل نهائي",
  savedOpportunities: "فرص محفوظة",
});

export const TEACHERPRO_ACTION_COPY = Object.freeze({
  saving: "جارٍ الحفظ",
  saved: "تم الحفظ",
  failed: "تعذر الحفظ",
  retry: "إعادة المحاولة",
  refreshing: "جارٍ تحديث البيانات",
  refreshed: "تم تحديث البيانات",
  refreshFailed: "تعذر تحديث البيانات",
});

export const TEACHERPRO_COUNT_SCOPE_COPY = Object.freeze({
  system: "إجمالي البيانات في النظام",
  filtered: "المطابقون للفلاتر",
  page: "المعروض في الصفحة",
  context: "ضمن الاختيار الحالي",
});

export type TeacherProActionStatus =
  | "idle"
  | "saving"
  | "saved"
  | "failed";

export interface TeacherProActionStatusDetail {
  status: TeacherProActionStatus;
  label: string;
  description?: string;
  at: number;
}

const UI_REPLACEMENTS: Array<[RegExp, string]> = [
  [/الطلاب\s+الغير\s+موجودين/g, TEACHERPRO_TERMS.missingStudents],
  [/الطلاب\s+غير\s+المتواجدين/g, TEACHERPRO_TERMS.missingStudents],
  [/تليكرام|تلغرام|تلكرام|تيليگرام/gi, TEACHERPRO_TERMS.telegram],
  [/كروت/g, TEACHERPRO_TERMS.cards],
  [/كارت/g, TEACHERPRO_TERMS.card],
  [/نوع الدراسة/g, TEACHERPRO_TERMS.programType],
  [/درجة محفوظة/g, "درجة مسجلة"],
  [/درجات محفوظة(?!\s+احتياط)/g, TEACHERPRO_TERMS.recordedGrades],
  [/الفرص الحالية/g, TEACHERPRO_TERMS.savedOpportunities],
  [/فرص الطالب الحالية/g, TEACHERPRO_TERMS.savedOpportunities],
  [/Permission\s*ID/gi, "رمز الصلاحية"],
  [/Server[- ]?first/gi, "بعد التحقق من الحفظ"],
  [/Database\s*Direct/gi, "بيانات النظام"],
  [/Sync\s*Scope/gi, "نطاق التحديث"],
  [/localStorage/gi, "التخزين المؤقت"],
  [/\bCache\b/gi, "البيانات المؤقتة"],
  [/كاش/g, "بيانات مؤقتة"],
  [/من قاعدة البيانات مباشرة/g, "من بيانات النظام"],
  [/من قاعدة البيانات/g, "من بيانات النظام"],
  [/قاعدة البيانات مباشرة/g, "بيانات النظام"],
  [/بعد تأكيد قاعدة البيانات/g, "بعد التحقق من الحفظ"],
  [/بعد موافقة الخادم/g, "بعد تأكيد الحفظ"],
  [/بعد تأكيد الخادم/g, "بعد التحقق من الحفظ"],
  [/من الخادم/g, "من النظام"],
  [/الخادم/g, "النظام"],
  [/السيرفر/g, "النظام"],
  [/\bJSON\b/g, "تفاصيل تقنية"],
  [/\bDB\b/g, "النظام"],
];

/** يحوّل النصوص التقنية والمتضاربة إلى لغة بشرية موحّدة للواجهة فقط. */
export function humanizeTeacherProText(value: string): string {
  let output = String(value ?? "");
  for (const [pattern, replacement] of UI_REPLACEMENTS) {
    output = output.replace(pattern, replacement);
  }
  return output.replace(/\s{2,}/g, " ").trim();
}

const MUTATION_WORDS =
  /حفظ|إضافة|تعديل|حذف|تفعيل|تعطيل|ربط|فصل|إعادة تفعيل|تسجيل|استيراد|تطبيق|تنفيذ|تحديث|تغيير|خصم|إلغاء|إيقاف|إكمال|أرشفة|جدولة|رفع|إنشاء/;
const LOAD_WORDS = /تحميل|جلب|عرض|تحديث البيانات|الاتصال|المزامنة/;
const EXPORT_WORDS = /تصدير|طباعة|نسخ/;

export function isTeacherProMutationMessage(value: string): boolean {
  return MUTATION_WORDS.test(humanizeTeacherProText(value));
}

export function isTeacherProLoadMessage(value: string): boolean {
  return LOAD_WORDS.test(humanizeTeacherProText(value));
}

export function isTeacherProExportMessage(value: string): boolean {
  return EXPORT_WORDS.test(humanizeTeacherProText(value));
}

export function teacherProSuccessToastCopy(message: string): {
  title: string;
  description?: string;
  actionStatus?: TeacherProActionStatusDetail;
} {
  const clean = humanizeTeacherProText(message);
  if (
    isTeacherProExportMessage(clean) ||
    /تسجيل الخروج|نسخ|فتح تقرير|المعاينة|صلاحيات المدير/.test(clean)
  ) {
    return { title: clean };
  }
  if (!isTeacherProMutationMessage(clean)) return { title: clean };
  return {
    title: TEACHERPRO_ACTION_COPY.saved,
    description: clean === TEACHERPRO_ACTION_COPY.saved ? undefined : clean,
    actionStatus: {
      status: "saved",
      label: TEACHERPRO_ACTION_COPY.saved,
      description: clean,
      at: Date.now(),
    },
  };
}

export function teacherProErrorToastCopy(message: string): {
  title: string;
  description?: string;
  actionStatus?: TeacherProActionStatusDetail;
} {
  const clean = humanizeTeacherProText(message) ||
    "تعذر تنفيذ العملية حالياً.";

  if (isTeacherProLoadMessage(clean)) {
    return {
      title: TEACHERPRO_ACTION_COPY.refreshFailed,
      description: `${clean} لم تتغير البيانات المعروضة. اختر «${TEACHERPRO_ACTION_COPY.retry}».`,
    };
  }

  if (isTeacherProMutationMessage(clean) || /تعذر|لا يمكن|فشل|رفض|خطأ/.test(clean)) {
    const alreadyExplainsSavedState = /لم يتم حفظ|لم يُحفظ|لم تحفظ|احتفظ/.test(clean);
    const description = [
      clean,
      alreadyExplainsSavedState ? "" : "لم يتم حفظ أي تغيير.",
      `تحقق من البيانات ثم اختر «${TEACHERPRO_ACTION_COPY.retry}».`,
    ]
      .filter(Boolean)
      .join(" ");
    return {
      title: TEACHERPRO_ACTION_COPY.failed,
      description,
      actionStatus: {
        status: "failed",
        label: TEACHERPRO_ACTION_COPY.failed,
        description,
        at: Date.now(),
      },
    };
  }

  return { title: clean };
}

export function emitTeacherProActionStatus(
  detail: Omit<TeacherProActionStatusDetail, "at"> & { at?: number },
): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<TeacherProActionStatusDetail>(
      "teacherpro:user-action-status",
      {
        detail: { ...detail, at: detail.at ?? Date.now() },
      },
    ),
  );
}
