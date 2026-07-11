export interface OpportunityBalanceLike {
  opportunities?: unknown;
  baseOpportunities?: unknown;
  opportunityLimit?: unknown;
  activeChapterConflictCount?: unknown;
  activeChapter?: { opportunities?: unknown } | null;
}

function normalizeOpportunityNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  return Math.max(0, Math.trunc(numeric));
}

export function getOpportunityBalance(
  source: OpportunityBalanceLike | null | undefined,
): number {
  return normalizeOpportunityNumber(source?.opportunities) ?? 0;
}

/**
 * Returns the active chapter limit when the server snapshot is available.
 * A present `opportunityLimit: null` is intentional and means the limit is
 * unavailable because the course has no unique active chapter; in that case we
 * must not silently fall back to a stale stored base.
 */
export function getOpportunityLimit(
  source: OpportunityBalanceLike | null | undefined,
): number | null {
  if (!source) return null;

  if (Object.prototype.hasOwnProperty.call(source, "opportunityLimit")) {
    return normalizeOpportunityNumber(source.opportunityLimit);
  }

  const conflictCount = normalizeOpportunityNumber(
    source.activeChapterConflictCount,
  );
  if (conflictCount !== null && conflictCount > 1) return null;

  const activeChapterLimit = normalizeOpportunityNumber(
    source.activeChapter?.opportunities,
  );
  if (activeChapterLimit !== null) return activeChapterLimit;

  // Legacy response fallback only. New server responses always carry the
  // explicit opportunityLimit property, including null for unavailable limits.
  return normalizeOpportunityNumber(source.baseOpportunities);
}

export function formatOpportunityBalance(
  source: OpportunityBalanceLike | null | undefined,
  options: {
    separator?: string;
    unavailableLimit?: string;
  } = {},
): string {
  const current = getOpportunityBalance(source);
  const limit = getOpportunityLimit(source);
  const separator = options.separator ?? "/";
  const unavailableLimit = options.unavailableLimit ?? "—";
  return `${current}${separator}${limit === null ? unavailableLimit : limit}`;
}

export function getOpportunityProgressPercent(
  source: OpportunityBalanceLike | null | undefined,
): number {
  const current = getOpportunityBalance(source);
  const limit = getOpportunityLimit(source);
  if (limit === null || limit <= 0) return 0;
  return Math.min(100, Math.max(0, (current / limit) * 100));
}
