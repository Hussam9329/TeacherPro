-- Add per-course-type study type mapping while keeping the legacy union column.
ALTER TABLE "Course" ADD COLUMN "studyTypesByProgram" TEXT NOT NULL DEFAULT '{}';

-- Backfill old courses: every selected course type keeps the previously selected study types.
UPDATE "Course"
SET "studyTypesByProgram" = (
  SELECT COALESCE(jsonb_object_agg(program, COALESCE("availableStudyTypes"::jsonb, '[]'::jsonb)), '{}'::jsonb)::text
  FROM jsonb_array_elements_text(COALESCE("availablePrograms"::jsonb, '[]'::jsonb)) AS program
)
WHERE "studyTypesByProgram" = '{}';
