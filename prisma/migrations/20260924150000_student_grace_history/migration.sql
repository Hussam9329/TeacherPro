-- Additive only: existing balances, grades, statuses, notes and grace dates stay intact.
-- History is populated transactionally when a grace window is replaced or ended.
ALTER TABLE "Student"
  ADD COLUMN "gracePeriodHistory" JSONB NOT NULL DEFAULT '[]';
ALTER TABLE "Student"
  ADD CONSTRAINT "Student_gracePeriodHistory_array"
  CHECK (jsonb_typeof("gracePeriodHistory") = 'array');
