-- Additive: the exam a day's required number was counted from («المخصومين»
-- of the course's latest exam). Two new columns with defaults; no existing
-- row or column changes.
ALTER TABLE "CallDailyTarget" ADD COLUMN "examId" TEXT NOT NULL DEFAULT '';
ALTER TABLE "CallDailyTarget" ADD COLUMN "examName" TEXT NOT NULL DEFAULT '';
