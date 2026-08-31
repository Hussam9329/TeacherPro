-- Grace period start date — allows grace periods to start from the day
-- the admin sets them, not from the student's registration date.
--
-- New students automatically get 3 days of grace from createdAt (handled
-- in code, not in DB). When the admin manually sets accountingGraceDays > 0,
-- gracePeriodStartDate is set to NOW(), and the grace window becomes
-- [gracePeriodStartDate, gracePeriodStartDate + accountingGraceDays).
--
-- If gracePeriodStartDate is NULL, the grace window falls back to
-- [createdAt, createdAt + max(3, accountingGraceDays)] for backward compat.

ALTER TABLE "Student" ADD COLUMN IF NOT EXISTS "gracePeriodStartDate" TIMESTAMP(3);

-- Backfill: set gracePeriodStartDate to NOW() for all students who
-- currently have accountingGraceDays > 0. This resets their grace period
-- to start from today (the migration run date), which is the desired
-- behavior per the user's request.
UPDATE "Student"
  SET "gracePeriodStartDate" = NOW()
  WHERE "accountingGraceDays" > 0
    AND "gracePeriodStartDate" IS NULL;
