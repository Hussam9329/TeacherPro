-- Persist follow-up records that were previously stored only in client state.
-- The statements are intentionally idempotent so a partially prepared production
-- database can still finish deploying this migration safely.
CREATE TABLE IF NOT EXISTS "StudentLeave" (
  "id" TEXT NOT NULL,
  "studentId" TEXT NOT NULL,
  "examId" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "studyType" TEXT NOT NULL DEFAULT '',
  "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "notes" TEXT NOT NULL DEFAULT '',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "StudentLeave_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "StudentCall" (
  "id" TEXT NOT NULL,
  "studentId" TEXT NOT NULL,
  "examId" TEXT NOT NULL,
  "category" TEXT NOT NULL DEFAULT '',
  "target" TEXT NOT NULL DEFAULT '',
  "phone" TEXT NOT NULL DEFAULT '',
  "completed" BOOLEAN NOT NULL DEFAULT false,
  "completedAt" TIMESTAMP(3),
  "notes" TEXT NOT NULL DEFAULT '',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "StudentCall_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "StudentNote" (
  "id" TEXT NOT NULL,
  "studentId" TEXT NOT NULL,
  "kind" TEXT NOT NULL DEFAULT '',
  "text" TEXT NOT NULL,
  "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "StudentNote_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "StudentLeave" ADD COLUMN IF NOT EXISTS "studentId" TEXT NOT NULL;
ALTER TABLE "StudentLeave" ADD COLUMN IF NOT EXISTS "examId" TEXT NOT NULL;
ALTER TABLE "StudentLeave" ADD COLUMN IF NOT EXISTS "reason" TEXT NOT NULL;
ALTER TABLE "StudentLeave" ADD COLUMN IF NOT EXISTS "studyType" TEXT NOT NULL DEFAULT '';
ALTER TABLE "StudentLeave" ADD COLUMN IF NOT EXISTS "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "StudentLeave" ADD COLUMN IF NOT EXISTS "notes" TEXT NOT NULL DEFAULT '';
ALTER TABLE "StudentLeave" ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE "StudentCall" ADD COLUMN IF NOT EXISTS "studentId" TEXT NOT NULL;
ALTER TABLE "StudentCall" ADD COLUMN IF NOT EXISTS "examId" TEXT NOT NULL;
ALTER TABLE "StudentCall" ADD COLUMN IF NOT EXISTS "category" TEXT NOT NULL DEFAULT '';
ALTER TABLE "StudentCall" ADD COLUMN IF NOT EXISTS "target" TEXT NOT NULL DEFAULT '';
ALTER TABLE "StudentCall" ADD COLUMN IF NOT EXISTS "phone" TEXT NOT NULL DEFAULT '';
ALTER TABLE "StudentCall" ADD COLUMN IF NOT EXISTS "completed" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "StudentCall" ADD COLUMN IF NOT EXISTS "completedAt" TIMESTAMP(3);
ALTER TABLE "StudentCall" ADD COLUMN IF NOT EXISTS "notes" TEXT NOT NULL DEFAULT '';
ALTER TABLE "StudentCall" ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE "StudentNote" ADD COLUMN IF NOT EXISTS "studentId" TEXT NOT NULL;
ALTER TABLE "StudentNote" ADD COLUMN IF NOT EXISTS "kind" TEXT NOT NULL DEFAULT '';
ALTER TABLE "StudentNote" ADD COLUMN IF NOT EXISTS "text" TEXT NOT NULL;
ALTER TABLE "StudentNote" ADD COLUMN IF NOT EXISTS "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE UNIQUE INDEX IF NOT EXISTS "StudentLeave_studentId_examId_key" ON "StudentLeave"("studentId", "examId");
CREATE INDEX IF NOT EXISTS "StudentLeave_studentId_idx" ON "StudentLeave"("studentId");
CREATE INDEX IF NOT EXISTS "StudentLeave_examId_idx" ON "StudentLeave"("examId");
CREATE INDEX IF NOT EXISTS "StudentLeave_date_idx" ON "StudentLeave"("date");

CREATE INDEX IF NOT EXISTS "StudentCall_studentId_idx" ON "StudentCall"("studentId");
CREATE INDEX IF NOT EXISTS "StudentCall_examId_idx" ON "StudentCall"("examId");
CREATE INDEX IF NOT EXISTS "StudentCall_createdAt_idx" ON "StudentCall"("createdAt");

CREATE INDEX IF NOT EXISTS "StudentNote_studentId_idx" ON "StudentNote"("studentId");
CREATE INDEX IF NOT EXISTS "StudentNote_date_idx" ON "StudentNote"("date");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'StudentLeave_studentId_fkey') THEN
    ALTER TABLE "StudentLeave" ADD CONSTRAINT "StudentLeave_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'StudentLeave_examId_fkey') THEN
    ALTER TABLE "StudentLeave" ADD CONSTRAINT "StudentLeave_examId_fkey" FOREIGN KEY ("examId") REFERENCES "Exam"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'StudentCall_studentId_fkey') THEN
    ALTER TABLE "StudentCall" ADD CONSTRAINT "StudentCall_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'StudentCall_examId_fkey') THEN
    ALTER TABLE "StudentCall" ADD CONSTRAINT "StudentCall_examId_fkey" FOREIGN KEY ("examId") REFERENCES "Exam"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'StudentNote_studentId_fkey') THEN
    ALTER TABLE "StudentNote" ADD CONSTRAINT "StudentNote_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
