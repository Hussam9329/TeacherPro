-- Remove dismissal sub-types from runtime authority while keeping the physical
-- compatibility columns for one rolling deployment. Historical audit/archive
-- evidence is intentionally not rewritten.

ALTER TABLE "Student"
  DROP CONSTRAINT IF EXISTS "Student_dismissal_type_allowed";

DROP TRIGGER IF EXISTS "Student_normalize_dismissal_type" ON "Student";
DROP TRIGGER IF EXISTS "StudentNote_normalize_dismissal_type" ON "StudentNote";
DROP TRIGGER IF EXISTS "Exam_normalize_dismissal_penalty" ON "Exam";
DROP FUNCTION IF EXISTS "normalize_student_dismissal_type"();
DROP FUNCTION IF EXISTS "normalize_student_note_dismissal_type"();
DROP FUNCTION IF EXISTS "normalize_exam_dismissal_penalty"();

UPDATE "Student" SET "dismissalType" = NULL
WHERE "dismissalType" IS NOT NULL;

UPDATE "StudentNote" SET "dismissalType" = ''
WHERE COALESCE("dismissalType", '') <> '';

UPDATE "Exam" SET "opportunitiesPenalty" = '0'
WHERE "opportunitiesPenalty" IN ('فصل', 'فصل مؤقت', 'فصل نهائي');

-- Preserve the original event and add a canonical policy event. This lets the
-- new engine replay two opportunities without falsifying old audit evidence.
INSERT INTO "OpportunityLog" (
  "id", "studentId", "examId", "action", "amount", "reason", "date",
  "chapterId", "chapterNameSnapshot"
)
SELECT
  'two-opportunity-policy-' || md5(source."id"),
  source."studentId",
  source."examId",
  CASE
    WHEN source."action" = 'فرصة أخيرة بعد تعهد'
      OR COALESCE(source."reason", '') LIKE '%تعهد%'
    THEN 'رصيد بعد تعهد'
    ELSE 'رصيد إعادة التفعيل'
  END,
  2,
  CASE
    WHEN source."action" = 'فرصة أخيرة بعد تعهد'
      OR COALESCE(source."reason", '') LIKE '%تعهد%'
    THEN 'تسوية السياسة الحالية: رصيد فرصتين بعد تعهد ولي الأمر'
    ELSE 'تسوية السياسة الحالية: رصيد فرصتين بعد إعادة التفعيل'
  END,
  source."date",
  source."chapterId",
  source."chapterNameSnapshot"
FROM "OpportunityLog" AS source
WHERE source."action" IN ('فرصة أخيرة بعد تعهد', 'إعادة تفعيل بفرصتين')
ON CONFLICT ("id") DO NOTHING;

-- Older instances may remain live while Vercel builds. Neutralize their
-- legacy column writes until a later deployment can physically drop columns.
CREATE OR REPLACE FUNCTION "neutralize_student_dismissal_type"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW."dismissalType" := NULL;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS "Student_neutralize_dismissal_type" ON "Student";
CREATE TRIGGER "Student_neutralize_dismissal_type"
BEFORE INSERT OR UPDATE OF "dismissalType" ON "Student"
FOR EACH ROW EXECUTE FUNCTION "neutralize_student_dismissal_type"();

CREATE OR REPLACE FUNCTION "neutralize_student_note_dismissal_type"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW."dismissalType" := '';
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS "StudentNote_neutralize_dismissal_type" ON "StudentNote";
CREATE TRIGGER "StudentNote_neutralize_dismissal_type"
BEFORE INSERT OR UPDATE OF "dismissalType" ON "StudentNote"
FOR EACH ROW EXECUTE FUNCTION "neutralize_student_note_dismissal_type"();

CREATE OR REPLACE FUNCTION "normalize_legacy_exam_dismissal_penalty"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW."opportunitiesPenalty" IN ('فصل', 'فصل مؤقت', 'فصل نهائي') THEN
    NEW."opportunitiesPenalty" := '0';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS "Exam_normalize_legacy_dismissal_penalty" ON "Exam";
CREATE TRIGGER "Exam_normalize_legacy_dismissal_penalty"
BEFORE INSERT OR UPDATE OF "opportunitiesPenalty" ON "Exam"
FOR EACH ROW EXECUTE FUNCTION "normalize_legacy_exam_dismissal_penalty"();
