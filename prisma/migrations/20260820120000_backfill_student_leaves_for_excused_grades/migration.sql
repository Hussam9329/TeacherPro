-- ============================================================================
-- Backfill StudentLeave Records for Excused Grades Without a Leave
-- ----------------------------------------------------------------------------
-- PROBLEM (reported 2026-08-20):
--   The migration 20260820110000_fix_excused_with_absence_notes converted
--   grades with status='غائب'/'غش' to status='مجاز' when the student had an
--   active StudentLeave. But it did NOT create StudentLeave records for
--   grades that already had status='مجاز' but no matching StudentLeave row.
--
--   This left the data in an inconsistent state:
--     - grade.status = 'مجاز' (correct, student is excused)
--     - but no StudentLeave row exists for this student/exam pair
--
--   The UI's classification function in teacher-store.ts fell through to
--   the score-based checks, returning "فصل" for a final exam with score=0
--   (because score=null→0). This is the bug reported for روان ياسر.
--
--   This migration ALSO handles grades that were converted to 'مجاز' by the
--   previous migration but had no corresponding StudentLeave (the rare
--   case where the grade was originally 'غائب' and a leave was added later
--   but the grade status was not updated until our previous migration).
--
-- FIX:
--   1. For every grade with status='مجاز' AND notes='الطالب مجاز من هذا الامتحان.'
--      AND no matching StudentLeave row → create a StudentLeave record
--      with leaveType='exam' and a generic reason.
--
--   2. This makes the data consistent: every 'مجاز' grade has a real leave
--      record that the UI can rely on.
--
-- SAFETY:
--   - Idempotent: ON CONFLICT skips rows that already exist.
--   - We use the unique constraint @@unique([studentId, examId]) on
--     StudentLeave to prevent duplicates.
--   - We only create leaves for grades that explicitly carry the "مجاز"
--     marker AND have the new "الطالب مجاز من هذا الامتحان." note (which
--     our previous cleanup set). This avoids creating spurious leaves for
--     any other 'مجاز' rows.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Step 1: Backfill StudentLeave records for converted grades.
-- ---------------------------------------------------------------------------
-- We use INSERT ... ON CONFLICT DO NOTHING because:
--   1. The StudentLeave table has @@unique([studentId, examId]).
--   2. Some students may already have a leave for this exam (we don't touch it).
--   3. For students without a leave, we create one with a generic reason.

INSERT INTO "StudentLeave" ("id", "studentId", "examId", "leaveType", "reason", "studyType", "date", "dateFrom", "dateTo", "notes", "createdAt")
SELECT
  -- Generate a deterministic ID so re-running the migration is idempotent
  -- even if ON CONFLICT somehow misses (it shouldn't, but defensive).
  'backfill_leave_' || g."studentId" || '_' || g."examId",
  g."studentId",
  g."examId",
  'exam',
  'مجاز تلقائياً من تسوية تاريخية',
  '',
  g."updatedAt",
  NULL,
  NULL,
  'تم إنشاء هذا السجل تلقائياً من تسوية تاريخية للدرجات المحوّلة من غائب إلى مجاز.',
  NOW()
FROM "Grade" g
WHERE g."status" = 'مجاز'
  AND g."notes" = 'الطالب مجاز من هذا الامتحان.'
  AND NOT EXISTS (
    SELECT 1 FROM "StudentLeave" sl
    WHERE sl."studentId" = g."studentId"
      AND sl."examId" = g."examId"
  )
ON CONFLICT ("studentId", "examId") DO NOTHING;
