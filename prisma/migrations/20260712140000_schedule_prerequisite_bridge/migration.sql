BEGIN;
-- New prerequisite bridge: original July migration consumed these columns
-- before the historical scheduling migration created them. Safe on production.
ALTER TABLE "Exam" ADD COLUMN IF NOT EXISTS "scheduledActivateAt" TIMESTAMP(3);

COMMIT;
