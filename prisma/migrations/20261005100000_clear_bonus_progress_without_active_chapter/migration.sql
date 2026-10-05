-- A course without exactly one active chapter has no «فرصة مكافأة» to count
-- toward. Closing a chapter now clears each student's progress together with
-- the balance; this clears the progress («نجاح 1 من 2» or a bonus waiting for
-- a missing grade) left on students whose chapter was closed before that.
-- Archived students, balances, statuses and the ledger are not touched.
-- Re-running it changes nothing.
BEGIN;

UPDATE "Student" s
SET "bonusProgress" = 0,
    "bonusWaitingExamName" = NULL
WHERE s."status" <> 'مؤرشف'
  AND (s."bonusProgress" <> 0 OR s."bonusWaitingExamName" IS NOT NULL)
  AND (
    SELECT COUNT(*)
    FROM "CourseChapter" cc
    WHERE cc."courseId" = s."courseId" AND cc."active" = true AND cc."archived" = false
  ) <> 1;

COMMIT;
