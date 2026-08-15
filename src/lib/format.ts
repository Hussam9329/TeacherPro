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

/** Display dates as year/month/day using Latin digits, e.g. 2026/6/11. */
export function formatAppDate(value: string | Date | null | undefined, fallback = '—'): string {
  const parts = getDateParts(value);
  if (!parts || !isValidDateParts(parts.year, parts.month, parts.day)) return fallback;
  return `${parts.year}/${parts.month}/${parts.day}`;
}

/** Display date-time values as 2026/6/11 08:30 while preserving the stored time part. */
export function formatAppDateTime(value: string | Date | null | undefined, fallback = '—'): string {
  if (!value) return fallback;
  const raw = value instanceof Date ? '' : toLatinDigits(String(value)).trim();
  const date = formatAppDate(value, '');
  if (!date) return fallback;

  const timeMatch = raw.match(/[T\s](\d{1,2}):(\d{2})/);
  if (timeMatch) return `${date} ${padDatePart(Number(timeMatch[1]))}:${timeMatch[2]}`;

  if (value instanceof Date && Number.isFinite(value.getTime())) {
    return `${date} ${padDatePart(value.getHours())}:${padDatePart(value.getMinutes())}`;
  }

  return date;
}

/** Convert a displayed date such as 2026/6/11 back to the ISO value used by inputs and APIs. */
export function parseAppDateInput(value: string, fallback = ''): string {
  const parts = getDateParts(value);
  if (!parts || !isValidDateParts(parts.year, parts.month, parts.day)) return fallback;
  return `${parts.year}-${padDatePart(parts.month)}-${padDatePart(parts.day)}`;
}
