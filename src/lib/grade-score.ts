/** Empty values are missing grades, never numeric zero. */
export function numericGradeScore(value: unknown): number | null {
  if (typeof value !== "number" && typeof value !== "string") return null;
  if (typeof value === "string" && !value.trim()) return null;
  const score = Number(value);
  return Number.isFinite(score) ? score : null;
}
