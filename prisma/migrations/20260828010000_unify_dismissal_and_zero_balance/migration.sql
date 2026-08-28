-- Unify every dismissal path under one durable value. The triggers keep the
-- rolling deployment safe while older server instances are still draining.

CREATE OR REPLACE FUNCTION "normalize_student_dismissal_type"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW."status" = 'مفصول' THEN
    NEW."dismissalType" := 'فصل';
  ELSE
    NEW."dismissalType" := NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS "Student_normalize_dismissal_type" ON "Student";
CREATE TRIGGER "Student_normalize_dismissal_type"
BEFORE INSERT OR UPDATE OF "status", "dismissalType" ON "Student"
FOR EACH ROW EXECUTE FUNCTION "normalize_student_dismissal_type"();

CREATE OR REPLACE FUNCTION "normalize_student_note_dismissal_type"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF COALESCE(trim(NEW."dismissalType"), '') <> '' THEN
    NEW."dismissalType" := 'فصل';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS "StudentNote_normalize_dismissal_type" ON "StudentNote";
CREATE TRIGGER "StudentNote_normalize_dismissal_type"
BEFORE INSERT OR UPDATE OF "dismissalType" ON "StudentNote"
FOR EACH ROW EXECUTE FUNCTION "normalize_student_note_dismissal_type"();

CREATE OR REPLACE FUNCTION "normalize_exam_dismissal_penalty"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW."opportunitiesPenalty" IN ('فصل مؤقت', 'فصل نهائي') THEN
    NEW."opportunitiesPenalty" := 'فصل';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS "Exam_normalize_dismissal_penalty" ON "Exam";
CREATE TRIGGER "Exam_normalize_dismissal_penalty"
BEFORE INSERT OR UPDATE OF "opportunitiesPenalty" ON "Exam"
FOR EACH ROW EXECUTE FUNCTION "normalize_exam_dismissal_penalty"();

UPDATE "Student"
SET "dismissalType" = CASE WHEN "status" = 'مفصول' THEN 'فصل' ELSE NULL END;

UPDATE "StudentNote"
SET "dismissalType" = 'فصل'
WHERE COALESCE(trim("dismissalType"), '') <> '';

UPDATE "Exam"
SET "opportunitiesPenalty" = 'فصل'
WHERE "opportunitiesPenalty" IN ('فصل مؤقت', 'فصل نهائي');

ALTER TABLE "Student"
DROP CONSTRAINT IF EXISTS "Student_dismissal_type_allowed";

ALTER TABLE "Student"
ADD CONSTRAINT "Student_dismissal_type_allowed"
CHECK (COALESCE("dismissalType", '') IN ('', 'فصل'));
