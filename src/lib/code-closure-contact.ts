import { toLatinDigits } from "./format";

/** The platform page where a dismissed student's code is closed. */
export const MZ_ACTIVE_USERS_URL = "https://www.mz-academy.com/ar/teachers/users/active";

export type ClosureContactStep = "platform" | "telegram";

/** 07705550679 → 009647705550679, the form the platform search expects. "" when unusable. */
export function mzPlatformPhone(phone: string | null | undefined): string {
  const digits = toLatinDigits(phone).replace(/\D/g, "");
  let international = "";
  if (digits.startsWith("00964")) international = digits;
  else if (digits.startsWith("964")) international = `00${digits}`;
  else if (digits.startsWith("0")) international = `00964${digits.slice(1)}`;
  else if (digits.startsWith("7")) international = `00964${digits}`;
  return /^00964\d{9,10}$/.test(international) ? international : "";
}

/** A missing exam or result stays as its placeholder so it is filled before sending. */
export function buildDismissalNotice(examName?: string | null, outcome?: string | null): string {
  return [
    "🚨 **تبليغ رسمي**",
    "",
    "تم **فصلك وإغلاق الكود الخاص بك من المنصة** بسبب استنفاد الفرص، وذلك نتيجة:",
    "",
    `**الامتحان:** ${examName?.trim() || "[اسم الامتحان]"}`,
    `**الحالة:** ${outcome?.trim() || "[الدرجة / غياب / غش]"}`,
    "",
    "يرجى التواصل مع **معرّف قسم الفرص** أدناه، لغرض توقيع التعهد واتخاذ الإجراءات اللازمة لإلغاء الفصل وإعادة فتح الكود:",
    "",
    "**@hf_chances**",
    "",
    "يرجى مراجعة القسم بأقرب وقت ممكن لإكمال الإجراءات.",
    "",
    "**ملاحظة:** في حال كان الفصل أو إغلاق الكود قد حدث **عن طريق الخطأ**، يرجى أيضًا التواصل مع **معرّف قسم الفرص** أعلاه، حيث تتم مراجعة الحالة ومعالجة المشكلة من خلال القسم حصراً.",
  ].join("\n");
}

/** Opens the chat in the Telegram app with the notice ready in the message box. */
export function telegramNoticeHref(chatHref: string, notice: string): string {
  return chatHref ? `${chatHref}&text=${encodeURIComponent(notice)}` : "";
}

/**
 * Copies before the click opens another tab or app. The synchronous copy
 * finishes while this page still has focus; the async API is the fallback.
 */
export function copyTextNow(text: string): boolean {
  if (typeof document === "undefined" || !text) return false;
  const area = document.createElement("textarea");
  area.value = text;
  area.setAttribute("readonly", "");
  area.style.position = "fixed";
  area.style.opacity = "0";
  document.body.appendChild(area);
  area.select();
  let copied = false;
  try {
    copied = document.execCommand("copy");
  } catch {
    copied = false;
  }
  area.remove();
  if (!copied && typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    void navigator.clipboard.writeText(text).catch(() => undefined);
    return true;
  }
  return copied;
}
