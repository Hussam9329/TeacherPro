-- Additive: «إحصائيات المكالمات» keeps one required number per course and
-- cumulative exam instead of one per day. A new table only; the old daily
-- numbers stay where they are (read as a starting point). No existing row or
-- column changes.
CREATE TABLE IF NOT EXISTS "CallExamTarget" (
  "id" TEXT NOT NULL,
  "courseId" TEXT NOT NULL,
  "examId" TEXT NOT NULL,
  "target" INTEGER NOT NULL,
  "examName" TEXT NOT NULL DEFAULT '',
  "updatedById" TEXT,
  "updatedByName" TEXT NOT NULL DEFAULT '',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CallExamTarget_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "CallExamTarget_courseId_examId_key" ON "CallExamTarget"("courseId", "examId");
CREATE INDEX IF NOT EXISTS "CallExamTarget_examId_idx" ON "CallExamTarget"("examId");
