BEGIN;
-- The application, engine and reports already use Exam.courseIds. Preserve
-- that visible scope and make ExamCourse its enforced relational projection.
-- Grade history for transferred students is deliberately left untouched.
INSERT INTO "AuditLog" ("id", "module", "action", "details", "time")
SELECT 'p1_exam_links_' || e."id", 'صيانة النظام', 'توحيد روابط دورات الامتحان مع نطاقه المعتمد',
 jsonb_build_object('examId', e."id", 'courseIds', e."courseIds", 'previousLinks',
   (SELECT COALESCE(jsonb_agg(to_jsonb(ec)), '[]'::jsonb) FROM "ExamCourse" ec WHERE ec."examId" = e."id"))::text,
 CURRENT_TIMESTAMP
FROM "Exam" e
WHERE EXISTS (SELECT 1 FROM "ExamCourse" ec WHERE ec."examId" = e."id" AND NOT (e."courseIds"::jsonb ? ec."courseId"))
ON CONFLICT ("id") DO NOTHING;

CREATE OR REPLACE FUNCTION "tp_sync_exam_course_projection"() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
 IF jsonb_typeof(NEW."courseIds"::jsonb) <> 'array' THEN RAISE EXCEPTION 'Exam.courseIds must be an array'; END IF;
 DELETE FROM "ExamCourse" ec WHERE ec."examId" = NEW."id" AND NOT (NEW."courseIds"::jsonb ? ec."courseId");
 INSERT INTO "ExamCourse" ("id", "examId", "courseId")
 SELECT 'examcourse_' || md5(NEW."id" || ':' || value), NEW."id", value
 FROM jsonb_array_elements_text(NEW."courseIds"::jsonb)
 ON CONFLICT ("examId", "courseId") DO NOTHING;
 RETURN NEW;
END;
$$;
CREATE TRIGGER "tp_sync_exam_course_projection_trg" AFTER INSERT OR UPDATE OF "courseIds" ON "Exam"
FOR EACH ROW EXECUTE FUNCTION "tp_sync_exam_course_projection"();
-- Run the same projection once; no student, grade, or balance changes.
UPDATE "Exam" SET "courseIds" = "courseIds";

CREATE OR REPLACE FUNCTION "tp_check_exam_course_projection"() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE v_exam TEXT; v_scope JSONB;
BEGIN
 v_exam := CASE WHEN TG_OP = 'DELETE' THEN OLD."examId" ELSE NEW."examId" END;
 SELECT "courseIds"::jsonb INTO v_scope FROM "Exam" WHERE "id" = v_exam;
 IF NOT FOUND THEN RETURN NULL; END IF;
 IF EXISTS (SELECT 1 FROM "ExamCourse" WHERE "examId" = v_exam AND NOT (v_scope ? "courseId"))
 OR EXISTS (SELECT 1 FROM jsonb_array_elements_text(v_scope) c WHERE NOT EXISTS
   (SELECT 1 FROM "ExamCourse" ec WHERE ec."examId" = v_exam AND ec."courseId" = c.value))
 THEN RAISE EXCEPTION 'Exam course projection mismatch for %', v_exam USING ERRCODE = '23514'; END IF;
 IF TG_OP = 'UPDATE' AND OLD."examId" <> NEW."examId" THEN
   RAISE EXCEPTION 'Move an exam course link using delete and insert' USING ERRCODE = '23514';
 END IF;
 RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER "tp_exam_course_projection_guard" AFTER INSERT OR UPDATE OR DELETE ON "ExamCourse"
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "tp_check_exam_course_projection"();

COMMIT;
