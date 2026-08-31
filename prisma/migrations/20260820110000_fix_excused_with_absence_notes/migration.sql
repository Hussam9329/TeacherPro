-- ============================================================================
-- Fix Excused Students Carrying Absent Notes / Absent Status
-- ----------------------------------------------------------------------------
-- PROBLEM (reported 2026-08-20):
--   Two related contradictions were found in the Grade table:
--
--   (A) status='مجاز' + notes='تسجيل جماعي كغائب...' (331 rows in production)
--       The student has an active StudentLeave, but the grade record carries
--       the stale "automatic batch absence" note. The status is correctly
--       "مجاز", but the note text contradicts the status, confusing users
--       in exports/reports.
--
--   (B) status='غائب' (or 'غش') + active StudentLeave (119 rows in production)
--       The student has an active StudentLeave for this exam, but the grade
--       status is still "غائب"/"غش". This is the DANGEROUS case: the academic
--       recalc treats the grade as a real absence → false opportunity deduction
--       or even false dismissal. The student's status was not "مفصول" only
--       because they were saved by a manual "إعادة تعيين" opportunity log,
--       but the next recalc could re-dismiss them.
--
-- FIX:
--   1. For (A): replace the stale absence note on "مجاز" rows with an
--      authoritative excused note ("الطالب مجاز من هذا الامتحان.").
--   2. For (B): convert the status from "غائب"/"غش" to "مجاز" AND replace
--      the stale note. This is the critical fix: it stops the false dismissal.
--
--   Going forward, the application layer (sanitizeStaleAbsenceNotes +
--   mark-missing-absent leave-skip + syncAcademicGradeWriteback coercion)
--   prevents this from recurring.
--
-- SAFETY:
--   - All UPDATEs are idempotent — safe to run multiple times.
--   - We only touch rows whose status IS NOT "درجة" (no real numeric grade).
--   - We use COALESCE for NULL safety.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Step 1: Fix status='مجاز' rows that carry a stale absence note.
-- ---------------------------------------------------------------------------
-- This handles case (A) — the status is already correct ("مجاز"), but the
-- note text is misleading. We replace it with an authoritative excused note.
-- The LIKE patterns use % wildcards between words to catch both the strict
-- Arabic phrase "تسجيل جماعي كغائب" and any whitespace variations.
UPDATE "Grade"
SET "notes" = 'الطالب مجاز من هذا الامتحان.'
WHERE "status" = 'مجاز'
  AND (
    COALESCE("notes", '') LIKE '%تسجيل%كغائب%'
    OR COALESCE("notes", '') LIKE '%تسجيل تلقائي%'
    OR COALESCE("notes", '') LIKE '%جماعي%كغائب%'
  );

-- ---------------------------------------------------------------------------
-- Step 2: Fix status='غائب'/'غش' rows where the student has an active leave.
-- ---------------------------------------------------------------------------
-- This handles case (B) — the dangerous case. The student has a StudentLeave
-- for this exam (or a period leave covering the exam date), but the grade
-- status is still "غائب" or "غش". The recalc would treat this as a real
-- absence, deducting opportunities or dismissing the student.
--
-- We convert the status to "مجاز" AND replace the stale note with the
-- authoritative excused note. The student's existing opportunities balance
-- is NOT touched here — a subsequent recalculateStudentsAcademicState call
-- will recompute it from scratch (and will no longer find a "غائب" grade
-- for this exam).
UPDATE "Grade" AS g
SET
  "status" = 'مجاز',
  "notes" = 'الطالب مجاز من هذا الامتحان.'
FROM "StudentLeave" AS sl
WHERE sl."studentId" = g."studentId"
  AND sl."examId" = g."examId"
  AND g."status" IN ('غائب', 'غش');

-- Also fix period leaves: a student with a "period" leave whose date range
-- covers the exam date should not have a "غائب" grade for that exam.
-- Postgres UPDATE ... FROM doesn't allow joining the target table from the
-- FROM clause, so we collect the target grade IDs in a subquery first.
DO $$
DECLARE
  target_ids text[];
BEGIN
  SELECT array_agg(DISTINCT g.id) INTO target_ids
  FROM "Grade" g
  JOIN "StudentLeave" sl ON sl."studentId" = g."studentId"
  JOIN "Exam" e ON e."id" = g."examId"
  WHERE sl."leaveType" = 'period'
    AND sl."dateFrom" IS NOT NULL
    AND sl."dateTo" IS NOT NULL
    AND e."date" >= sl."dateFrom"
    AND e."date" <= sl."dateTo"
    AND g."status" IN ('غائب', 'غش');

  IF target_ids IS NOT NULL AND array_length(target_ids, 1) > 0 THEN
    UPDATE "Grade"
    SET
      "status" = 'مجاز',
      "notes" = 'الطالب مجاز من هذا الامتحان.'
    WHERE id = ANY(target_ids);
  END IF;
END
$$;
