/**
 * Canonical handling for "all" filter values across the app.
 *
 * UI select components often need a non-empty value such as "all" or
 * "__none__". Server routes must never treat those sentinel values as real
 * database values, otherwise "الكل" becomes an accidental narrow filter.
 */
const ALL_FILTER_SENTINELS = new Set([
  "all",
  "__all__",
  "__none__",
  "الكل",
  "كل",
]);

export function normalizeListFilter(value: unknown): string {
  const text = String(value ?? "").trim();
  if (!text) return "";
  return ALL_FILTER_SENTINELS.has(text) ? "" : text;
}

export function isAllListFilter(value: unknown): boolean {
  return normalizeListFilter(value) === "";
}
