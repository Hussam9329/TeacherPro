export const TEXT_ONLY_PATTERN = "^[\\p{L}\\p{M}][\\p{L}\\p{M}\\s'.،\\-]*$";

const arabicMarks = /[\u064B-\u065F\u0670]/g;
const hamzaMap: Record<string, string> = {
  أ: "ا",
  إ: "ا",
  آ: "ا",
  ٱ: "ا",
  ؤ: "و",
  ئ: "ي",
  ة: "ه",
  ى: "ي",
};

export function normalizeForSearch(value: unknown): string {
  return String(value ?? "")
    .toLocaleLowerCase("ar-IQ")
    .normalize("NFKD")
    .replace(arabicMarks, "")
    .replace(/[أإآٱؤئىة]/g, (char) => hamzaMap[char] ?? char)
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/[\s\-_]+/g, " ")
    .trim();
}


export function searchAny(query: string, fields: unknown[]): boolean {
  const normalizedQuery = normalizeForSearch(query);
  if (!normalizedQuery) return true;
  return fields.some((field) =>
    normalizeForSearch(field).includes(normalizedQuery),
  );
}

export function isTextOnly(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return false;
  return new RegExp(TEXT_ONLY_PATTERN, "u").test(trimmed);
}

export function getRequiredTextError(
  value: string,
  fieldLabel: string,
): string | null {
  if (!value.trim()) return `${fieldLabel}: هذا الحقل مطلوب`;
  if (!isTextOnly(value))
    return `${fieldLabel}: يجب إدخال نص فقط بدون أرقام أو رموز غير مسموحة`;
  return null;
}

export function hasMeaningfulDraftValue(
  values: Record<string, unknown>,
  ignoredKeys: string[] = [],
): boolean {
  const ignored = new Set(ignoredKeys);
  return Object.entries(values).some(([key, value]) => {
    if (ignored.has(key)) return false;
    if (typeof value === "string") return value.trim() !== "";
    return value !== null && value !== undefined && value !== false;
  });
}
