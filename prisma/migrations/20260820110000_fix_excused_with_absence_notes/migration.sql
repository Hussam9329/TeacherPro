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
UPDATE "Grade"
SET "notes" = 'الطالب مجاز من هذا الامتحان.'
WHERE "status" = 'مجاز'
  AND (
    COALESCE("notes", '') LIKE '%تسجيل جماعي كغائب%'
    OR COALESCE("notes", '') LIKE '%تسجيل تلقائي: الامتحان يسبق%'
    OR COALESCE("notes", '') LIKE '%تسجيل تلقائي: الطالب ضمن فترة السماح%'
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
UPDATE "Grade" AS g
SET
  "status" = 'مجاز',
  "notes" = 'الطالب مجاز من هذا الامتحان.'
FROM "StudentLeave" AS sl
JOIN "Exam" AS e ON e."id" = g."examId"
WHERE sl."studentId" = g."studentId"
  AND sl."leaveType" = 'period'
  AND sl."dateFrom" IS NOT NULL
  AND sl."dateTo" IS NOT NULL
  AND e."date" >= sl."dateFrom"
  AND e."date" <= sl."dateTo"
  AND g."status" IN ('غائب', 'غش');
