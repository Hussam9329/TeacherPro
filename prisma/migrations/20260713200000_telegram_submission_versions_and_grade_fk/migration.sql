-- Q86 FIX: Add TelegramSubmissionVersion table to preserve previous
-- submission page snapshots when a student re-submits exam papers.
-- Previously, the upsert overwrote `pages` and `sourceMessageIds`
-- entirely, losing the original pages forever.

CREATE TABLE IF NOT EXISTS "TelegramSubmissionVersion" (
    "id" TEXT NOT NULL,
    "submissionId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "examId" TEXT NOT NULL,
    "pages" TEXT NOT NULL DEFAULT '[]',
    "sourceMessageIds" TEXT NOT NULL DEFAULT '[]',
    "pageCount" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT '',
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TelegramSubmissionVersion_pkey" PRIMARY KEY ("id")
);

-- Index for querying versions by submission
CREATE INDEX IF NOT EXISTS "TelegramSubmissionVersion_submissionId_idx"
    ON "TelegramSubmissionVersion"("submissionId");

-- Index for querying versions by student+exam
CREATE INDEX IF NOT EXISTS "TelegramSubmissionVersion_studentId_examId_idx"
    ON "TelegramSubmissionVersion"("studentId", "examId");

-- Foreign key to TelegramExamSubmission (CASCADE on delete)
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'TelegramSubmissionVersion_submissionId_fkey') THEN
        ALTER TABLE "TelegramSubmissionVersion"
            ADD CONSTRAINT "TelegramSubmissionVersion_submissionId_fkey"
            FOREIGN KEY ("submissionId") REFERENCES "TelegramExamSubmission"("id")
            ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

-- Q88 FIX: Add a real foreign key from TelegramExamSubmission.gradeId
-- to Grade.id, with ON DELETE SET NULL so deleting a Grade clears the
-- stale gradeId instead of leaving a dead reference.
-- This is safe because gradeId is nullable and we use SET NULL (not CASCADE).
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'TelegramExamSubmission_gradeId_fkey') THEN
        ALTER TABLE "TelegramExamSubmission"
            ADD CONSTRAINT "TelegramExamSubmission_gradeId_fkey"
            FOREIGN KEY ("gradeId") REFERENCES "Grade"("id")
            ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;

-- Backfill: clear any existing dead gradeId references before the FK
-- constraint can take effect (otherwise existing dead references would
-- cause the ALTER TABLE to fail).
UPDATE "TelegramExamSubmission" sub
    SET "gradeId" = NULL
    WHERE "gradeId" IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM "Grade" g WHERE g."id" = sub."gradeId");
