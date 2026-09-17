-- Guard future writes only. Keep existing balances and historical rows intact.
-- Old writers omitted chapterId, which bypassed the active-chapter guard and
-- could recreate an already-corrected deduction in the same transaction as a
-- wrong Student update. Reject the write so that the whole transaction rolls back.
CREATE OR REPLACE FUNCTION tp_guard_active_chapter_opportunity()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW."examId" IS NOT NULL
  AND (NEW.action IN ('خصم تلقائي','فصل تلقائي') OR NEW.reason LIKE 'تلقائي:%') THEN
  -- Only the authenticated, confirmed backup-restore transaction sets this
  -- existing server-owned flag. A backup must retain its original history.
  IF current_setting('teacherpro.restore_snapshot', true) = 'on' THEN
   RETURN NEW;
  END IF;

  IF NULLIF(btrim(NEW."chapterId"), '') IS NULL THEN
   IF TG_OP = 'INSERT' THEN
    RAISE EXCEPTION 'An automatic exam opportunity log requires a chapter'
     USING ERRCODE='23514', CONSTRAINT='tp_automatic_opportunity_chapter_required';
   END IF;
   -- Unchanged legacy rows remain readable and can receive unrelated metadata.
   -- They cannot lose known provenance or be repurposed as another penalty.
   IF NULLIF(btrim(OLD."chapterId"), '') IS NOT NULL
    OR ROW(NEW."studentId", NEW."examId", NEW.action, NEW.reason, NEW.amount, NEW.date)
      IS DISTINCT FROM
       ROW(OLD."studentId", OLD."examId", OLD.action, OLD.reason, OLD.amount, OLD.date) THEN
    RAISE EXCEPTION 'An automatic exam opportunity log requires a chapter'
     USING ERRCODE='23514', CONSTRAINT='tp_automatic_opportunity_chapter_required';
   END IF;
  END IF;

  -- Retain the existing scope check. Explicitly scoped historical entries are
  -- kept as history; they must never masquerade as a current-chapter effect.
  IF EXISTS (
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
 END IF;
 RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER tp_active_chapter_opportunity_scope
BEFORE INSERT OR UPDATE OF "studentId","examId","chapterId",action,reason,amount,date ON "OpportunityLog"
FOR EACH ROW EXECUTE FUNCTION tp_guard_active_chapter_opportunity();
