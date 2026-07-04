-- Stores exam answer submissions pushed from the Telegram bot into TeacherPro.
-- Idempotent on purpose: production databases may have had this table prepared
-- automatically by the app before `prisma migrate deploy` is run.
CREATE TABLE IF NOT EXISTS "TelegramExamSubmission" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "examId" TEXT NOT NULL,
    "gradeId" TEXT,
    "telegramUserId" TEXT NOT NULL DEFAULT '',
    "telegramUsername" TEXT NOT NULL DEFAULT '',
    "telegramChatId" TEXT NOT NULL DEFAULT '',
    "sourceMessageIds" TEXT NOT NULL DEFAULT '[]',
    "pages" TEXT NOT NULL DEFAULT '[]',
    "pageCount" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'بانتظار التصحيح',
    "notes" TEXT NOT NULL DEFAULT '',
    "submittedAt" TIMESTAMP(3),
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE "TelegramExamSubmission" ADD COLUMN IF NOT EXISTS "id" TEXT;
ALTER TABLE "TelegramExamSubmission" ADD COLUMN IF NOT EXISTS "studentId" TEXT;
ALTER TABLE "TelegramExamSubmission" ADD COLUMN IF NOT EXISTS "examId" TEXT;
ALTER TABLE "TelegramExamSubmission" ADD COLUMN IF NOT EXISTS "gradeId" TEXT;
ALTER TABLE "TelegramExamSubmission" ADD COLUMN IF NOT EXISTS "telegramUserId" TEXT NOT NULL DEFAULT '';
ALTER TABLE "TelegramExamSubmission" ADD COLUMN IF NOT EXISTS "telegramUsername" TEXT NOT NULL DEFAULT '';
ALTER TABLE "TelegramExamSubmission" ADD COLUMN IF NOT EXISTS "telegramChatId" TEXT NOT NULL DEFAULT '';
ALTER TABLE "TelegramExamSubmission" ADD COLUMN IF NOT EXISTS "sourceMessageIds" TEXT NOT NULL DEFAULT '[]';
ALTER TABLE "TelegramExamSubmission" ADD COLUMN IF NOT EXISTS "pages" TEXT NOT NULL DEFAULT '[]';
ALTER TABLE "TelegramExamSubmission" ADD COLUMN IF NOT EXISTS "pageCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "TelegramExamSubmission" ADD COLUMN IF NOT EXISTS "status" TEXT NOT NULL DEFAULT 'بانتظار التصحيح';
ALTER TABLE "TelegramExamSubmission" ADD COLUMN IF NOT EXISTS "notes" TEXT NOT NULL DEFAULT '';
ALTER TABLE "TelegramExamSubmission" ADD COLUMN IF NOT EXISTS "submittedAt" TIMESTAMP(3);
ALTER TABLE "TelegramExamSubmission" ADD COLUMN IF NOT EXISTS "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "TelegramExamSubmission" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'TelegramExamSubmission_pkey') THEN
    ALTER TABLE "TelegramExamSubmission"
      ADD CONSTRAINT "TelegramExamSubmission_pkey" PRIMARY KEY ("id");
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "TelegramExamSubmission_studentId_examId_key" ON "TelegramExamSubmission"("studentId", "examId");
CREATE INDEX IF NOT EXISTS "TelegramExamSubmission_examId_idx" ON "TelegramExamSubmission"("examId");
CREATE INDEX IF NOT EXISTS "TelegramExamSubmission_studentId_idx" ON "TelegramExamSubmission"("studentId");
CREATE INDEX IF NOT EXISTS "TelegramExamSubmission_status_idx" ON "TelegramExamSubmission"("status");
CREATE INDEX IF NOT EXISTS "TelegramExamSubmission_receivedAt_idx" ON "TelegramExamSubmission"("receivedAt");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'TelegramExamSubmission_studentId_fkey') THEN
    ALTER TABLE "TelegramExamSubmission"
      ADD CONSTRAINT "TelegramExamSubmission_studentId_fkey"
      FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'TelegramExamSubmission_examId_fkey') THEN
    ALTER TABLE "TelegramExamSubmission"
      ADD CONSTRAINT "TelegramExamSubmission_examId_fkey"
      FOREIGN KEY ("examId") REFERENCES "Exam"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
