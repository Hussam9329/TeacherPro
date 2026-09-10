-- Future writes only: do not rewrite any existing balance or ledger record.
CREATE OR REPLACE FUNCTION tp_guard_active_chapter_opportunity()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW."examId" IS NOT NULL
  AND (NEW.action IN ('خصم تلقائي','فصل تلقائي') OR NEW.reason LIKE 'تلقائي:%')
  AND EXISTS (
   SELECT 1 FROM "Student" s JOIN "CourseChapter" cc ON cc."courseId"=s."courseId"
    WHERE s.id=NEW."studentId" AND s.status <> 'مؤرشف'
     AND cc.active AND NOT cc.archived AND cc."chapterId"=NEW."chapterId"
     AND NOT EXISTS (
      SELECT 1 FROM "ExamCourse" ec WHERE ec."examId"=NEW."examId"
       AND ec."courseId"=s."courseId" AND ec."chapterId"=NEW."chapterId"
     )
  ) THEN
  RAISE EXCEPTION 'An exam outside the active chapter cannot create a current opportunity penalty'
   USING ERRCODE='23514', CONSTRAINT='tp_active_chapter_opportunity_scope';
 END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER tp_active_chapter_opportunity_scope
BEFORE INSERT OR UPDATE OF "studentId","examId","chapterId",action,reason ON "OpportunityLog"
FOR EACH ROW EXECUTE FUNCTION tp_guard_active_chapter_opportunity();
