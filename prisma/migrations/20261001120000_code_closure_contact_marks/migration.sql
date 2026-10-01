-- Additive: the two contact steps on a code-closure card. Each column stores
-- the dismissal episode (dismissedCheckEpoch) the step was done in, so a later
-- dismissal of the same student starts unmarked. No existing data changes.
ALTER TABLE "Student" ADD COLUMN "closurePlatformEpoch" INTEGER;
ALTER TABLE "Student" ADD COLUMN "closureTelegramEpoch" INTEGER;
