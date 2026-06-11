/**
 * TeacherPro — Format Utilities
 * RTL layout with Latin (English) digits only.
 * All Arabic/Persian numerals are converted to Latin automatically.
 */

/** Arabic‑Indic digits → Latin, Persian digits → Latin */
const AR_DIGITS: Record<string, string> = {
  '\u0660': '0', '\u0661': '1', '\u0662': '2', '\u0663': '3', '\u0664': '4',
  '\u0665': '5', '\u0666': '6', '\u0667': '7', '\u0668': '8', '\u0669': '9',
  '\u06F0': '0', '\u06F1': '1', '\u06F2': '2', '\u06F3': '3', '\u06F4': '4',
  '\u06F5': '5', '\u06F6': '6', '\u06F7': '7', '\u06F8': '8', '\u06F9': '9',
};

const AR_RE = /[٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹]/g;

/** Convert any Arabic/Persian digit characters to Latin */
export function toLatinDigits(text: string): string {
  return text.replace(AR_RE, (ch) => AR_DIGITS[ch] ?? ch);
}

/** Keep phone input numeric only and limit it to 11 digits */
export function sanitizePhoneInput(value: string): string {
  return toLatinDigits(value).replace(/\D/g, '').slice(0, 11);
}

/** Iraqi phone numbers must start with 07 and contain exactly 11 digits */
export function getPhoneValidationError(value: string, label: string, required = false): string | null {
  const phone = toLatinDigits(value).trim();
  if (!phone) return required ? `${label} مطلوب` : null;
  if (!/^\d+$/.test(phone)) return `${label} يجب أن يحتوي على أرقام فقط`;
  if (!phone.startsWith('07')) return `${label} يجب أن يبدأ بـ 07`;
  if (phone.length !== 11) return `${label} يجب أن يكون 11 رقم لا أكثر ولا أقل`;
  return null;
}
