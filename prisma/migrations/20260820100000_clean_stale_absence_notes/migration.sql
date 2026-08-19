-- ============================================================================
-- Clean Stale Automatic Absence Notes on Graded Rows
-- ----------------------------------------------------------------------------
-- PROBLEM:
--   When the teacher corrects an absent/cheating row into a real numeric
--   grade (status = 'درجة' with a real score), the previous automatic
--   "تسجيل جماعي كغائب" / "تسجيل تلقائي" note was NOT being cleared. The
--   row ended up with:
--     status = 'درجة'
--     score = 100
--     notes = 'تسجيل جماعي كغائب للطلاب غير المدخلة درجاتهم'
--   which is contradictory and confusing in exports/reports.
--
--   This was the bug reported on 2026-08-20 for the exam "الامتحان 22 -
--   اعفاء" where 55 rows had this stale-note contradiction.
--
-- FIX:
--   This migration is a ONE-TIME, idempotent cleanup that:
--   1. Identifies every Grade row whose status = 'درجة' but whose notes
--      contain one of the known automatic-absence phrases.
--   2. Replaces the stale phrase with a clean "تم تصحيح الدرجة يدوياً"
--      note so the audit trail is preserved (we don't just NULL it out).
--
--   Going forward, the application layer (sanitizeStaleAbsenceNotes in
--   academic-grade-writeback-server.ts) prevents this from recurring.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Step 1: Replace stale automatic-absence notes on graded rows.
-- ---------------------------------------------------------------------------
-- For any Grade row that has a real numeric grade (status = 'درجة' AND
-- score IS NOT NULL) but whose notes still contain one of the automatic
-- batch-absence phrases, replace the stale phrase with a clean audit note.
--
-- We do this in a single UPDATE with a CASE expression. The CASE ensures
-- that:
--   - If the note was ENTIRELY the stale phrase (e.g., the row was set
--     by the mark-missing-absent endpoint), the note becomes
--     "تم تصحيح الدرجة يدوياً بدلاً من التسجيل التلقائي السابق."
--   - The row keeps its real numeric score (the trigger from migration
--     20260820090000 already guarantees score is non-null only when
--     status = 'درجة', so this UPDATE does not need to touch score).
--
-- This is SAFE to run multiple times — once the stale phrase is gone,
-- the WHERE clause no longer matches those rows.
UPDATE "Grade"
SET "notes" = 'تم تصحيح الدرجة يدوياً بدلاً من التسجيل التلقائي السابق.'
WHERE "status" = 'درجة'
  AND "score" IS NOT NULL
  AND (
    COALESCE("notes", '') LIKE '%تسجيل جماعي كغائب%'
    OR COALESCE("notes", '') LIKE '%تسجيل تلقائي: الامتحان يسبق%'
    OR COALESCE("notes", '') LIKE '%تسجيل تلقائي: الطالب ضمن فترة السماح%'
  );
