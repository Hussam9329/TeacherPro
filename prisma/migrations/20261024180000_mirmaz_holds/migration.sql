-- Additive: grades from «Mirmaz Pro» that could not be placed by themselves
-- (the student's name or the exam did not match one for certain), held for
-- a person to place in «مرماز برو». A new table only; no existing row or
-- column changes.
CREATE TABLE IF NOT EXISTS "MirmazHold" (
  "id" TEXT NOT NULL,
  "answerId" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "reason" TEXT NOT NULL,
  "reasonText" TEXT NOT NULL,
  "score" INTEGER NOT NULL,
  "studentName" TEXT NOT NULL,
  "examName" TEXT NOT NULL,
  "examDate" TEXT NOT NULL DEFAULT '',
  "examFullMark" INTEGER,
  "mzExamId" TEXT NOT NULL DEFAULT '',
  "correctedBy" TEXT NOT NULL DEFAULT '',
  "candidates" TEXT NOT NULL DEFAULT '[]',
  "examCandidates" TEXT NOT NULL DEFAULT '[]',
  "resolvedStudentId" TEXT,
  "resolvedExamId" TEXT,
  "resolvedByName" TEXT,
  "resolvedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "MirmazHold_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "MirmazHold_answerId_key" ON "MirmazHold"("answerId");
CREATE INDEX IF NOT EXISTS "MirmazHold_status_createdAt_idx" ON "MirmazHold"("status", "createdAt");
