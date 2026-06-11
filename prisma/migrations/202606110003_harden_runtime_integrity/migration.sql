-- Harden runtime data integrity.
-- 1) Convert any legacy "مجاز" grade statuses to "غائب"; StudentLeave is now the single source of excuses.
UPDATE "Grade" SET "status" = 'غائب' WHERE "status" = 'مجاز';

-- 2) Remove duplicate correction sheets before adding the database-level unique constraint.
-- Keep one sheet per student/exam pair.
DELETE FROM "CorrectionSheet" a
USING "CorrectionSheet" b
WHERE a."studentId" = b."studentId"
  AND a."examId" = b."examId"
  AND a."id" > b."id";

CREATE UNIQUE INDEX IF NOT EXISTS "CorrectionSheet_studentId_examId_key"
  ON "CorrectionSheet"("studentId", "examId");

CREATE INDEX IF NOT EXISTS "CorrectionSheet_examId_idx" ON "CorrectionSheet"("examId");
CREATE INDEX IF NOT EXISTS "CorrectionSheet_correctorId_idx" ON "CorrectionSheet"("correctorId");
