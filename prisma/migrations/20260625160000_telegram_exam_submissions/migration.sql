-- Stores exam answer submissions pushed from the Telegram bot into TeacherPro.
CREATE TABLE "TelegramExamSubmission" (
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
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TelegramExamSubmission_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TelegramExamSubmission_studentId_examId_key" ON "TelegramExamSubmission"("studentId", "examId");
CREATE INDEX "TelegramExamSubmission_examId_idx" ON "TelegramExamSubmission"("examId");
CREATE INDEX "TelegramExamSubmission_studentId_idx" ON "TelegramExamSubmission"("studentId");
CREATE INDEX "TelegramExamSubmission_status_idx" ON "TelegramExamSubmission"("status");
CREATE INDEX "TelegramExamSubmission_receivedAt_idx" ON "TelegramExamSubmission"("receivedAt");

ALTER TABLE "TelegramExamSubmission"
  ADD CONSTRAINT "TelegramExamSubmission_studentId_fkey"
  FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "TelegramExamSubmission"
  ADD CONSTRAINT "TelegramExamSubmission_examId_fkey"
  FOREIGN KEY ("examId") REFERENCES "Exam"("id") ON DELETE CASCADE ON UPDATE CASCADE;
