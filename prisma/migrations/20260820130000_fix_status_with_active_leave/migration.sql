-- ============================================================================
-- Fix Grade Status When an Active StudentLeave Exists (Final Round)
-- ----------------------------------------------------------------------------
-- PROBLEM (found 2026-08-20):
--   After the previous fixes, a final audit found 7 remaining rows:
--
--   (A) 1 row: status='درجة' + notes='تسجيل تلقائي: الطالب مجاز من هذا الامتحان'
--       A graded row carrying an excused note. The previous cleanup patterns
--       looked for absence phrases but missed the excused note pattern.
--
--   (B) 4 rows: status IN ('ضمن فترة السماح', 'قبل تسجيل الطالب') AND
--       an active StudentLeave record exists for the same (studentId, examId).
--       The leave is MORE authoritative than the grace-period or pre-registration
--       marker — the student should be classified as 'مجاز'.
--
--   (C) 2 rows: status='مجاز' AND no StudentLeave AND notes is empty/NULL.
--       These were manually set to 'مجاز' without creating a StudentLeave record.
--       The previous backfill migration only caught rows with notes='الطالب
--       مجاز من هذا الامتحان.', so these slipped through.
--
-- FIX:
--   1. Replace the stale excused note on graded rows with the standard
--      "corrected manually" note.
--   2. Convert status from 'ضمن فترة السماح'/'قبل تسجيل الطالب' to 'مجاز'
--      when an active StudentLeave exists.
--   3. Backfill StudentLeave records for the orphan 'مجاز' grades and set
--      the proper note.
--
-- SAFETY:
--   - All UPDATEs are idempotent.
--   - We never touch rows with status='درجة' AND a valid score unless the
--     notes contain an obviously stale automatic phrase.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Step 1: Replace stale excused note on graded rows.
-- ---------------------------------------------------------------------------
-- Pattern: notes contains "تسجيل تلقائي" AND "مجاز" (the excused variant),
-- OR notes contains the excused replacement note we set previously, BUT the
-- row has status='درجة' with a real score.
UPDATE "Grade"
SET "notes" = 'تم تصحيح الدرجة يدوياً بدلاً من التسجيل التلقائي السابق.'
WHERE "status" = 'درجة'
  AND "score" IS NOT NULL
  AND (
    "notes" LIKE '%تسجيل تلقائي%مجاز%'
    OR "notes" LIKE '%الطالب مجاز من هذا الامتحان%'
  );

-- ---------------------------------------------------------------------------
-- Step 2: Convert 'ضمن فترة السماح' / 'قبل تسجيل الطالب' to 'مجاز' when
--         an active exam-leave exists.
-- ---------------------------------------------------------------------------
-- The leave is more authoritative — it explicitly excuses the student.
UPDATE "Grade" AS g
SET
  "status" = 'مجاز',
  "notes" = 'الطالب مجاز من هذا الامتحان.'
FROM "StudentLeave" AS sl
WHERE sl."studentId" = g."studentId"
  AND sl."examId" = g."examId"
  AND g."status" IN ('ضمن فترة السماح', 'قبل تسجيل الطالب');

-- ---------------------------------------------------------------------------
-- Step 3: Backfill StudentLeave records for orphan 'مجاز' grades.
-- ---------------------------------------------------------------------------
-- These are rows with status='مجاز' but no StudentLeave record. We set the
-- proper note and create the missing leave. ON CONFLICT DO NOTHING makes
-- this idempotent.
UPDATE "Grade"
SET "notes" = 'الطالب مجاز من هذا الامتحان.'
WHERE "status" = 'مجاز'
  AND (notes IS NULL OR notes = '')
  AND NOT EXISTS (
    SELECT 1 FROM "StudentLeave" sl
    WHERE sl."studentId" = "Grade"."studentId"
      AND sl."examId" = "Grade"."examId"
  );

INSERT INTO "StudentLeave" ("id", "studentId", "examId", "leaveType", "reason", "studyType", "date", "dateFrom", "dateTo", "notes", "createdAt")
SELECT
  'backfill_leave_' || g."studentId" || '_' || g."examId",
  g."studentId",
  g."examId",
  'exam',
  'مجاز تلقائياً من تسوية تاريخية',
  '',
  g."updatedAt",
  NULL,
  NULL,
  'تم إنشاء هذا السجل تلقائياً من تسوية تاريخية.',
  NOW()
FROM "Grade" g
WHERE g."status" = 'مجاز'
  AND NOT EXISTS (
    SELECT 1 FROM "StudentLeave" sl
    WHERE sl."studentId" = g."studentId"
      AND sl."examId" = g."examId"
  )
ON CONFLICT ("studentId", "examId") DO NOTHING;
