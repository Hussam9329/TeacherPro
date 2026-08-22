-- A numeric grade entered while a student is currently in grace immediately
-- terminates that grace period. This timestamp is the durable distinction
-- between "no manual grace configured" (which still gets the automatic
-- new-student window) and "grace explicitly ended".
ALTER TABLE "Student"
  ADD COLUMN IF NOT EXISTS "gracePeriodEndedAt" TIMESTAMP(3);
