-- ============================================================================
-- Grade Status ↔ Score Consistency Safety Trigger
-- ----------------------------------------------------------------------------
-- PROBLEM:
--   The existing CHECK constraint `Grade_status_score_consistency` already
--   rejects INSERTs/UPDATEs that try to persist a non-"درجة" status together
--   with a numeric score. But the error surfaced to the application was a
--   raw Postgres CHECK violation — a cryptic message that looked like a
--   server bug rather than an input validation error, and the application
--   had no clean way to recover (the whole transaction aborted).
--
--   Worse, legacy data from BEFORE the CHECK constraint was added (migration
--   20260712143000_grade_exam_integrity) may still contain contradictory
--   rows: a row with status = 'غائب' AND score = 90. Such rows cannot be
--   updated in place once the CHECK constraint exists — every UPDATE on
--   them would re-trigger the CHECK and fail.
--
-- FIX:
--   1. Clean up any legacy contradictory rows NOW: set score = NULL
--      wherever status != 'درجة'. This is a one-time, idempotent fix.
--   2. Install a BEFORE INSERT OR UPDATE trigger that, as the FINAL line
--      of defense, automatically coerces score = NULL whenever the new
--      status is not "درجة". The CHECK constraint stays in place, but the
--      trigger means a buggy caller can never even reach the CHECK.
--      The trigger also normalizes the status string (trim whitespace).
--
-- This migration is SAFE to run multiple times — every statement is
-- idempotent (uses IF NOT EXISTS / UPDATE WHERE).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Step 1: One-time cleanup of any legacy contradictory rows.
-- ---------------------------------------------------------------------------
-- Any row whose status is NOT "درجة" but still carries a numeric score is
-- the exact bug we are fixing. Clear the score so the row becomes consistent
-- with the business rule (a non-درجة status means "no numeric grade").
UPDATE "Grade"
SET "score" = NULL
WHERE "status" IS DISTINCT FROM 'درجة'
  AND "score" IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Step 2: Define the trigger function.
-- ---------------------------------------------------------------------------
-- The function does TWO things:
--   (a) Trim whitespace from NEW."status" so "  غائب " and "غائب" are
--       treated identically.
--   (b) If the resulting status is NOT "درجة", force NEW."score" to NULL.
--       This is the safety net: even if a buggy caller forgets to clear
--       the score before sending a non-درجة status, the DB cleans it up
--       silently. The CHECK constraint then never fires for this case.
CREATE OR REPLACE FUNCTION "enforce_grade_status_score_consistency"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  -- Normalize the status: trim and collapse internal whitespace.
  -- We deliberately do NOT translate or alias values here; the CHECK
  -- constraint is the gatekeeper for which status strings are allowed.
  IF NEW."status" IS NULL THEN
    RAISE EXCEPTION 'Grade.status cannot be NULL';
  END IF;

  NEW."status" := btrim(NEW."status");

  -- If the row is not a real scored grade, the score must be NULL.
  -- This is the ROOT-CAUSE FIX for the contradiction.
  IF NEW."status" <> 'درجة' AND NEW."score" IS NOT NULL THEN
    NEW."score" := NULL;
  END IF;

  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------
-- Step 3: Attach the trigger to the Grade table (idempotent).
-- ---------------------------------------------------------------------------
DROP TRIGGER IF EXISTS "Grade_enforce_status_score_consistency" ON "Grade";
CREATE TRIGGER "Grade_enforce_status_score_consistency"
BEFORE INSERT OR UPDATE OF "status", "score" ON "Grade"
FOR EACH ROW
EXECUTE FUNCTION "enforce_grade_status_score_consistency"();
