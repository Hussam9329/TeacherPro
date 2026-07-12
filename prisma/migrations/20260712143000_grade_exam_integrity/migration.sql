-- This migration reads the scheduling columns below. They must exist here,
-- before they are referenced; a later migration cannot repair an earlier
-- failed migration because Prisma stops at the first failure.
ALTER TABLE "Exam" ADD COLUMN IF NOT EXISTS "scheduledActivateAt" TIMESTAMP(3);
ALTER TABLE "Exam" ADD COLUMN IF NOT EXISTS "scheduledDeactivateAt" TIMESTAMP(3);

-- Normalize legacy rows so non-numeric grade statuses never retain a hidden score.
UPDATE "Grade"
SET "score" = NULL
WHERE "status" IN ('غائب', 'غش')
  AND "score" IS NOT NULL;

-- Quarantine legacy grades that were entered before an exam became available.
-- Future-dated or future-scheduled exams with existing grades must be activated
-- explicitly from the UI, where the user sees and confirms the recalculation impact.
UPDATE "Exam" AS exam
SET
  "active" = FALSE,
  "scheduledActivateAt" = NULL
WHERE EXISTS (
  SELECT 1 FROM "Grade" AS grade WHERE grade."examId" = exam."id"
)
AND (
  exam."date"::date > (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Baghdad')::date
  OR exam."scheduledActivateAt" > CURRENT_TIMESTAMP
);

-- Keep grade status/score consistency even if a future route bypasses application validation.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'Grade_status_score_consistency'
  ) THEN
    ALTER TABLE "Grade"
      ADD CONSTRAINT "Grade_status_score_consistency"
      CHECK (
        "status" IN ('درجة', 'غائب', 'غش')
        AND ("status" = 'درجة' OR "score" IS NULL)
      );
  END IF;
END
$$;

-- A grade is an immutable relation between one student and one exam.
-- Correcting the relationship requires deleting the mistaken row and creating a validated row.
CREATE OR REPLACE FUNCTION "prevent_grade_relation_change"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW."studentId" IS DISTINCT FROM OLD."studentId"
     OR NEW."examId" IS DISTINCT FROM OLD."examId" THEN
    RAISE EXCEPTION 'Grade studentId/examId relation is immutable';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS "Grade_prevent_relation_change" ON "Grade";
CREATE TRIGGER "Grade_prevent_relation_change"
BEFORE UPDATE OF "studentId", "examId" ON "Grade"
FOR EACH ROW
EXECUTE FUNCTION "prevent_grade_relation_change"();
