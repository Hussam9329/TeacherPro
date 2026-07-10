ALTER TABLE "TelegramExamSubmission" ADD COLUMN IF NOT EXISTS "matchType" TEXT NOT NULL DEFAULT 'manual_review';
ALTER TABLE "TelegramExamSubmission" ADD COLUMN IF NOT EXISTS "matchSource" TEXT NOT NULL DEFAULT '';
ALTER TABLE "TelegramExamSubmission" ADD COLUMN IF NOT EXISTS "matchDetails" TEXT NOT NULL DEFAULT '';
