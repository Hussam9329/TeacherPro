-- Remove the Electronic Correction feature from the database schema.
-- Drops every table that existed exclusively for Electronic Correction:
--   * "TelegramSubmissionVersion" (page snapshots of bot submissions)
--   * "TelegramExamSubmissionVersion" (legacy snapshot table name)
--   * "TelegramExamSubmission" (exam papers received from the Telegram bot)
--   * "CorrectionSheet" (electronic correction sheets)
-- Child tables are dropped first so their foreign keys to Student, Exam,
-- Grade and AppUser are removed with them. Shared tables (Student, Exam,
-- Grade, AppUser, ...) are untouched.

DROP TABLE IF EXISTS "TelegramSubmissionVersion";
DROP TABLE IF EXISTS "TelegramExamSubmissionVersion";
DROP TABLE IF EXISTS "TelegramExamSubmission";
DROP TABLE IF EXISTS "CorrectionSheet";
