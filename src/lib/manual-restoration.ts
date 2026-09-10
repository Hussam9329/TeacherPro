export const DEFAULT_MANUAL_RESTORATION_REASON =
  "استعادة الطالب المفصول يدويا بسبب خطأ عفوي";

export function manualRestorationAmount(value: unknown): number | null {
  if (typeof value !== "number" && typeof value !== "string") return null;
  if (String(value).trim() === "") return null;
  const amount = Number(value);
  return Number.isSafeInteger(amount) && amount > 0 ? amount : null;
}
