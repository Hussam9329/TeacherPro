type GradeWithNumericScore = {
  status?: string | null;
  score?: number | null;
};

export type CallGradeRange = {
  from: number | null;
  to: number | null;
  active: boolean;
  invalid: boolean;
};

function parseOptionalGradeBound(value: string | null | undefined): number | null {
  const text = String(value ?? "").trim();
  if (!text) return null;
  const parsed = Number(text);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

export function parseCallGradeRange(
  gradeFrom: string | null | undefined,
  gradeTo: string | null | undefined,
): CallGradeRange {
  const from = parseOptionalGradeBound(gradeFrom);
  const to = parseOptionalGradeBound(gradeTo);
  return {
    from,
    to,
    active: from !== null || to !== null,
    invalid: from !== null && to !== null && from > to,
  };
}

export function callGradeMatchesRange(
  grade: GradeWithNumericScore | undefined,
  range: CallGradeRange,
): boolean {
  if (!range.active) return true;
  if (range.invalid || grade?.status !== "درجة" || grade.score === null || grade.score === undefined) {
    return false;
  }

  const score = Number(grade.score);
  if (!Number.isFinite(score)) return false;
  if (range.from !== null && score < range.from) return false;
  if (range.to !== null && score > range.to) return false;
  return true;
}

export function callGradeMatchesRangeForStatus(
  grade: GradeWithNumericScore | undefined,
  range: CallGradeRange,
  statusFilter: string,
): boolean {
  // الغياب ليس درجة رقمية. بقاء قيمة قديمة في حقلي من/إلى يجب ألا يحوّل
  // فلتر الغائبين إلى نتيجة فارغة.
  if (statusFilter === "absent" || statusFilter === "cheating") return true;
  return callGradeMatchesRange(grade, range);
}
