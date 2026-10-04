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

/** Convert Arabic/Persian digits; missing optional values stay empty. */
export function toLatinDigits(text: string | null | undefined): string {
  return (text ?? '').replace(AR_RE, (ch) => AR_DIGITS[ch] ?? ch);
}

/** Keep phone input numeric only and limit it to 11 digits */
export function sanitizePhoneInput(value: string | null | undefined): string {
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

/** Gregorian month names as people say them here: «8 أكتوبر 2026». */
export const APP_MONTHS = [
  'يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو',
  'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر',
] as const;

function padDatePart(value: number): string {
  return String(value).padStart(2, '0');
}

function getDateParts(value: string | Date | null | undefined): { year: number; month: number; day: number } | null {
  if (!value) return null;

  if (value instanceof Date) {
    if (!Number.isFinite(value.getTime())) return null;
    return { year: value.getFullYear(), month: value.getMonth() + 1, day: value.getDate() };
  }

  const raw = toLatinDigits(String(value)).trim();
  if (!raw) return null;

  const isoMatch = raw.match(/^(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})/);
  if (isoMatch) {
    return { year: Number(isoMatch[1]), month: Number(isoMatch[2]), day: Number(isoMatch[3]) };
  }

  const namedMatch = raw.match(/^(\d{1,2})\s+(\S+)\s+(\d{4})$/);
  if (namedMatch) {
    const month = APP_MONTHS.indexOf(namedMatch[2] as (typeof APP_MONTHS)[number]) + 1;
    if (month > 0) return { year: Number(namedMatch[3]), month, day: Number(namedMatch[1]) };
  }

  const browserDateMatch = raw.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})$/);
  if (browserDateMatch) {
    return { year: Number(browserDateMatch[3]), month: Number(browserDateMatch[1]), day: Number(browserDateMatch[2]) };
  }

  const parsed = new Date(raw);
  if (!Number.isFinite(parsed.getTime())) return null;
  return { year: parsed.getFullYear(), month: parsed.getMonth() + 1, day: parsed.getDate() };
}

function isValidDateParts(year: number, month: number, day: number): boolean {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return false;
  if (year < 1900 || year > 2200 || month < 1 || month > 12 || day < 1 || day > 31) return false;
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
}

/** Display dates as «8 أكتوبر 2026», with Latin digits. */
export function formatAppDate(value: string | Date | null | undefined, fallback = '—'): string {
  const parts = getDateParts(value);
  if (!parts || !isValidDateParts(parts.year, parts.month, parts.day)) return fallback;
  return `${parts.day} ${APP_MONTHS[parts.month - 1]} ${parts.year}`;
}

/** «14:20» → «2:20 م». */
export function formatAppTime(hhmm: string | null | undefined): string {
  const match = /^(\d{1,2}):(\d{2})/.exec(toLatinDigits(hhmm).trim());
  if (!match) return '';
  const hours = Number(match[1]);
  if (hours > 23) return '';
  return `${hours % 12 || 12}:${match[2]} ${hours < 12 ? 'ص' : 'م'}`;
}

/** The numeric form, 2026/6/11, for text that is sorted or read back. */
export function formatNumericAppDate(value: string | Date | null | undefined, fallback = '—'): string {
  const parts = getDateParts(value);
  if (!parts || !isValidDateParts(parts.year, parts.month, parts.day)) return fallback;
  return `${parts.year}/${parts.month}/${parts.day}`;
}

/** Convert a displayed date such as 2026/6/11 back to the ISO value used by inputs and APIs. */
export function parseAppDateInput(value: string, fallback = ''): string {
  const parts = getDateParts(value);
  if (!parts || !isValidDateParts(parts.year, parts.month, parts.day)) return fallback;
  return `${parts.year}-${padDatePart(parts.month)}-${padDatePart(parts.day)}`;
}
