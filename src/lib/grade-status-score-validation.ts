// ============================================================================
// Grade Status ↔ Score Consistency Guard — Root-Cause Fix
// ----------------------------------------------------------------------------
// PROBLEM:
//   The system had no centralized enforcement that a Grade record whose status
//   is not "درجة" must never carry a numeric score. Different code paths
//   (API routes, batch operations, Telegram submissions, UI drafts) could
//   theoretically arrive at the API surface with a contradictory payload
//   such as { status: "غائب", score: 100 }. The database CHECK constraint
//   `Grade_status_score_consistency` already rejects such a row, but the
//   error surfaced to the user was a cryptic Postgres CHECK violation that
//   looked like a server bug rather than an input validation error.
//
// FIX:
//   This module is the SINGLE SOURCE OF TRUTH for status/score consistency.
//   Every grade-writing entry point must call `assertGradeStatusScoreConsistency`
//   before persisting. The DB constraint stays as the last line of defense,
//   but the user now sees a clear Arabic message explaining exactly what is
//   wrong instead of a raw database error.
//
// ALLOWED COMBINATIONS:
//   status = "درجة"            → score MUST be a non-null integer (0..fullMark)
//   status = "غائب"            → score MUST be null
//   status = "غش"              → score MUST be null
//   status = "مجاز"            → score MUST be null
//   status = "ضمن فترة السماح" → score MUST be null
//   status = "قبل تسجيل الطالب" → score MUST be null
// ============================================================================

import { AcademicGradeWritebackError } from "@/lib/academic-grade-writeback-server";

/**
 * Statuses that represent a real, scored grade. Only this status may carry
 * a numeric `score`. Every other status is a marker (absent, cheating,
 * excused, grace period, pre-registration) and must have `score = NULL`.
 */
export const SCORED_GRADE_STATUS = "درجة" as const;

/**
 * Every status the Grade table is allowed to hold. Kept in sync with the
 * database CHECK constraint `Grade_status_score_consistency` (see
 * migration 20260723003000_allow_excused_grade_status).
 */
export const GRADE_STATUS_VALUES = [
  "درجة",
  "غائب",
  "غش",
  "مجاز",
  "ضمن فترة السماح",
  "قبل تسجيل الطالب",
] as const;

export type GradeStatus = (typeof GRADE_STATUS_VALUES)[number];

/**
 * Quick non-throwing check: does this status require score = NULL?
 */
export function statusRequiresNullScore(status: string | null | undefined): boolean {
  return Boolean(status) && status !== SCORED_GRADE_STATUS;
}

/**
 * Is the given value a known Grade status? Used to reject unknown values
 * before they reach the DB.
 */
export function isKnownGradeStatus(value: unknown): value is GradeStatus {
  return typeof value === "string" && (GRADE_STATUS_VALUES as readonly string[]).includes(value);
}

/**
 * Core assertion. Throws an `AcademicGradeWritebackError` with a clear
 * Arabic message if `status` and `score` are inconsistent.
 *
 * Rules:
 *  - status === "درجة"      → score may be a number, null, or undefined
 *                           (callers decide whether blank is allowed).
 *  - status !== "درجة"     → score MUST be null or undefined.
 *                           A non-null number is REJECTED.
 *  - unknown status        → REJECTED with a list of allowed values.
 *
 * This does NOT validate the score range (0..fullMark) — that is the
 * responsibility of the caller, who has access to the exam's fullMark.
 */
export function assertGradeStatusScoreConsistency(
  status: unknown,
  score: unknown,
): void {
  const statusStr =
    typeof status === "string" ? status.trim() : "";

  if (!isKnownGradeStatus(statusStr)) {
    throw new AcademicGradeWritebackError(
      `حالة الدرجة "${statusStr || "—"}" غير معروفة. القيم المسموح بها: ${GRADE_STATUS_VALUES.join("، ")}.`,
      400,
    );
  }

  if (statusStr === SCORED_GRADE_STATUS) {
    // "درجة" is allowed to carry a score. We do NOT enforce presence here;
    // callers decide whether a blank score is acceptable for their context.
    return;
  }

  // For every other status, score must be null/undefined/empty-string.
  // A stray number here is the exact contradiction we are preventing.
  if (score !== null && score !== undefined && String(score).trim() !== "") {
    const numeric = Number(score);
    if (!Number.isNaN(numeric) || typeof score === "string") {
      throw new AcademicGradeWritebackError(
        `تناقض في البيانات: لا يمكن حفظ درجة رقمية (${score}) مع الحالة «${statusStr}». ` +
          `الحالات غير «درجة» يجب ألا تحمل أي رقم — امسح الدرجة أولاً أو غيّر الحالة إلى «درجة».`,
        400,
      );
    }
  }
}

/**
 * Non-throwing variant: returns `true` if the combination is consistent,
 * `false` otherwise. Useful for UI guards that want to disable a button
 * without surfacing an error message.
 */
export function isGradeStatusScoreConsistent(
  status: unknown,
  score: unknown,
): boolean {
  try {
    assertGradeStatusScoreConsistency(status, score);
    return true;
  } catch {
    return false;
  }
}

/**
 * Normalize an inbound payload so the downstream writeback never sees a
 * contradictory (status != "درجة", score != null) shape. This is a defensive
 * sanitizer: if the caller somehow passed a non-null score with a marker
 * status, the score is silently dropped. The assertion above still runs as
 * the authoritative gate, but this keeps the upsert payload clean.
 *
 * Returns the (possibly rewritten) score value to persist.
 */
export function coerceConsistentScore(
  status: unknown,
  score: unknown,
): number | null {
  const statusStr =
    typeof status === "string" ? status.trim() : "";
  if (statusStr === SCORED_GRADE_STATUS) {
    if (score === null || score === undefined || String(score).trim() === "") {
      return null;
    }
    const numeric = Number(score);
    return Number.isFinite(numeric) ? numeric : null;
  }
  // Any non-"درجة" status must persist score = NULL.
  return null;
}
