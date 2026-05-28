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

/** Format a Date into a locale‑friendly string with Latin digits */
export function formatDateLatin(date: Date | string, options?: Intl.DateTimeFormatOptions): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  const fmt = new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    ...options,
  });
  return toLatinDigits(fmt.format(d));
}

/** Format a Date with time, Latin digits only */
export function formatDateTimeLatin(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  const datePart = formatDateLatin(d);
  const timePart = toLatinDigits(
    new Intl.DateTimeFormat('en-GB', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(d)
  );
  return `${datePart} ${timePart}`;
}

/** Format a time string (HH:mm) with Latin digits */
export function formatTimeLatin(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  return toLatinDigits(
    new Intl.DateTimeFormat('en-GB', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(d)
  );
}

/** Format a number with commas, Latin digits */
export function formatNumberLatin(n: number): string {
  return toLatinDigits(n.toLocaleString('en-GB'));
}

/** Parse user input: convert any Arabic/Persian digits to Latin, strip non‑numeric except allowed */
export function sanitizeNumericInput(value: string, allowedExtra = '.-'): string {
  const latin = toLatinDigits(value);
  return latin.replace(new RegExp(`[^0-9${allowedExtra}]`, 'g'), '');
}

/** Direction wrapper for numbers/times inside RTL: adds LRM marks */
export function ltrNum(text: string): string {
  return `\u200E${text}\u200E`;
}
