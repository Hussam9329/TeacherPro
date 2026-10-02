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
 * Copies `text` before the click opens another tab or app (the new tab takes
 * the focus the clipboard needs). The helper box goes inside the open dialog
 * next to the clicked element: a modal's focus trap pulls focus back from
 * <body>, and the browser then copied the old selection (e.g. the student's
 * name) or nothing while reporting success. A copy listener writes the exact
 * text, and success is only reported when that write really happened.
 */
export function copyText(text: string, near?: Element | null): Promise<boolean> {
  if (typeof document === "undefined" || !text) return Promise.resolve(false);
  const host = near?.closest('[role="dialog"]') ?? document.body;
  const previous = document.activeElement as HTMLElement | null;
  const area = document.createElement("textarea");
  area.value = text;
  area.setAttribute("readonly", "");
  area.style.cssText = "position:fixed;top:0;left:0;opacity:0;pointer-events:none";
  host.appendChild(area);
  let written = false;
  const onCopy = (event: ClipboardEvent) => {
    if (!event.clipboardData) return;
    event.clipboardData.setData("text/plain", text);
    event.preventDefault();
    written = true;
  };
  document.addEventListener("copy", onCopy, true);
  try {
    area.focus({ preventScroll: true });
    area.select();
    area.setSelectionRange(0, text.length);
    document.execCommand("copy");
  } catch {
    written = false;
  } finally {
    document.removeEventListener("copy", onCopy, true);
    area.remove();
    previous?.focus?.({ preventScroll: true });
  }
  if (written) return Promise.resolve(true);
  if (typeof navigator === "undefined" || !navigator.clipboard?.writeText) return Promise.resolve(false);
  return navigator.clipboard.writeText(text).then(() => true, () => false);
}
