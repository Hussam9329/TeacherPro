-- TeacherPro operational integrity hardening: leaves, opportunity movements,
-- Telegram submission versions/relations, and bounded student state values.

ALTER TABLE "OpportunityLog" ADD COLUMN IF NOT EXISTS "requestedAmount" INTEGER;
ALTER TABLE "OpportunityLog" ADD COLUMN IF NOT EXISTS "appliedAmount" INTEGER;
ALTER TABLE "OpportunityLog" ADD COLUMN IF NOT EXISTS "balanceBefore" INTEGER;
ALTER TABLE "OpportunityLog" ADD COLUMN IF NOT EXISTS "balanceAfter" INTEGER;
ALTER TABLE "OpportunityLog" ADD COLUMN IF NOT EXISTS "reversalOfLogId" TEXT;

UPDATE "OpportunityLog"
SET "requestedAmount" = COALESCE("requestedAmount", ABS("amount")),
    "appliedAmount" = COALESCE("appliedAmount", ABS("amount"));

CREATE UNIQUE INDEX IF NOT EXISTS "OpportunityLog_reversalOfLogId_key"
  ON "OpportunityLog"("reversalOfLogId");
CREATE INDEX IF NOT EXISTS "OpportunityLog_studentId_date_idx"
  ON "OpportunityLog"("studentId", "date");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'OpportunityLog_reversalOfLogId_fkey') THEN
    ALTER TABLE "OpportunityLog"
      ADD CONSTRAINT "OpportunityLog_reversalOfLogId_fkey"
      FOREIGN KEY ("reversalOfLogId") REFERENCES "OpportunityLog"("id")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

-- Clean invalid legacy values before constraining future writes.
UPDATE "Student" SET "status" = 'نشط' WHERE "status" NOT IN ('نشط', 'مفصول', 'مؤرشف');
UPDATE "Student" SET "dismissalType" = ''
WHERE COALESCE("dismissalType", '') NOT IN ('', 'فصل مؤقت', 'فصل نهائي');

-- Normalize legacy leave rows before adding strict shape constraints.
UPDATE "StudentLeave"
SET "leaveType" = CASE WHEN "examId" IS NOT NULL THEN 'exam' ELSE 'period' END
WHERE "leaveType" NOT IN ('exam', 'period')
   OR ("leaveType" = 'exam' AND "examId" IS NULL)
   OR ("leaveType" = 'period' AND "examId" IS NOT NULL);

UPDATE "StudentLeave"
SET "leaveType" = 'period',
    "dateFrom" = COALESCE("dateFrom", "dateTo", "date", CURRENT_TIMESTAMP),
    "dateTo" = COALESCE("dateTo", "dateFrom", "date", CURRENT_TIMESTAMP)
WHERE "examId" IS NULL;

UPDATE "StudentLeave"
SET "dateFrom" = LEAST("dateFrom", "dateTo"),
    "dateTo" = GREATEST("dateFrom", "dateTo")
WHERE "leaveType" = 'period'
  AND "dateFrom" IS NOT NULL
  AND "dateTo" IS NOT NULL
  AND "dateFrom" > "dateTo";

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Student_status_allowed') THEN
    ALTER TABLE "Student" ADD CONSTRAINT "Student_status_allowed"
      CHECK ("status" IN ('نشط', 'مفصول', 'مؤرشف'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Student_dismissal_type_allowed') THEN
    ALTER TABLE "Student" ADD CONSTRAINT "Student_dismissal_type_allowed"
      CHECK (COALESCE("dismissalType", '') IN ('', 'فصل مؤقت', 'فصل نهائي'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Student_leave_type_allowed') THEN
    ALTER TABLE "StudentLeave" ADD CONSTRAINT "Student_leave_type_allowed"
      CHECK ("leaveType" IN ('exam', 'period'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Student_leave_shape_valid') THEN
    ALTER TABLE "StudentLeave" ADD CONSTRAINT "Student_leave_shape_valid"
      CHECK (
        ("leaveType" = 'exam' AND "examId" IS NOT NULL)
        OR
        ("leaveType" = 'period' AND "examId" IS NULL AND "dateFrom" IS NOT NULL AND "dateTo" IS NOT NULL AND "dateFrom" <= "dateTo")
      );
  END IF;
END $$;

-- Serialize leave writes per student and reject overlapping period leaves at DB level.
CREATE OR REPLACE FUNCTION "guard_student_leave_integrity"()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext(NEW."studentId"));
  IF NEW."leaveType" = 'period' AND EXISTS (
    SELECT 1 FROM "StudentLeave" existing
    WHERE existing."studentId" = NEW."studentId"
      AND existing."leaveType" = 'period'
      AND existing."id" <> COALESCE(NEW."id", '')
      AND existing."dateFrom" <= NEW."dateTo"
      AND existing."dateTo" >= NEW."dateFrom"
  ) THEN
    RAISE EXCEPTION 'Overlapping student leave period';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS "StudentLeave_guard_integrity" ON "StudentLeave";
CREATE TRIGGER "StudentLeave_guard_integrity"
BEFORE INSERT OR UPDATE ON "StudentLeave"
FOR EACH ROW EXECUTE FUNCTION "guard_student_leave_integrity"();

-- Telegram submission gradeId becomes an actual optional foreign key.
UPDATE "TelegramExamSubmission" submission
SET "gradeId" = NULL
WHERE "gradeId" IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM "Grade" grade WHERE grade."id" = submission."gradeId");
CREATE INDEX IF NOT EXISTS "TelegramExamSubmission_gradeId_idx"
  ON "TelegramExamSubmission"("gradeId");
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'TelegramExamSubmission_gradeId_fkey') THEN
    ALTER TABLE "TelegramExamSubmission"
      ADD CONSTRAINT "TelegramExamSubmission_gradeId_fkey"
      FOREIGN KEY ("gradeId") REFERENCES "Grade"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "TelegramExamSubmissionVersion" (
  "id" TEXT NOT NULL,
  "submissionId" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "sourceMessageIds" TEXT NOT NULL DEFAULT '[]',
  "pages" TEXT NOT NULL DEFAULT '[]',
  "pageCount" INTEGER NOT NULL DEFAULT 0,
  "status" TEXT NOT NULL DEFAULT 'بانتظار التصحيح',
  "notes" TEXT NOT NULL DEFAULT '',
  "telegramUserId" TEXT NOT NULL DEFAULT '',
  "telegramUsername" TEXT NOT NULL DEFAULT '',
  "telegramChatId" TEXT NOT NULL DEFAULT '',
  "submittedAt" TIMESTAMP(3),
  "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TelegramExamSubmissionVersion_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "TelegramExamSubmissionVersion_submissionId_version_key"
  ON "TelegramExamSubmissionVersion"("submissionId", "version");
CREATE INDEX IF NOT EXISTS "TelegramExamSubmissionVersion_submissionId_createdAt_idx"
  ON "TelegramExamSubmissionVersion"("submissionId", "createdAt");
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'TelegramExamSubmissionVersion_submissionId_fkey') THEN
    ALTER TABLE "TelegramExamSubmissionVersion"
      ADD CONSTRAINT "TelegramExamSubmissionVersion_submissionId_fkey"
      FOREIGN KEY ("submissionId") REFERENCES "TelegramExamSubmission"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
