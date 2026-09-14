-- Existing exams intentionally remain ineligible for Telegram submission until
-- both window endpoints are configured by an administrator.
ALTER TABLE "Exam"
  ADD COLUMN IF NOT EXISTS "telegramOpenAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "telegramCloseAt" TIMESTAMP(3);
