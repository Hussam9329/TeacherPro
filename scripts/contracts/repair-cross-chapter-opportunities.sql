-- Explicit, reviewed repair only. The caller supplies a temporary table named
-- chapter_scope_repair_plan(payload jsonb), inside a SERIALIZABLE transaction.
-- Never part of a migration, build, GET, or scheduled reconciliation.
DO $$
DECLARE
 plan jsonb; item jsonb; actual jsonb; expected_rows jsonb;
 target_ids text[]; table_name text; run_id text; before_assignment jsonb;
 after_assignment jsonb; removed_logs jsonb; inserted_logs jsonb; n integer;
BEGIN
 IF (SELECT count(*) FROM chapter_scope_repair_plan) <> 1 THEN
  RAISE EXCEPTION 'Exactly one reviewed repair plan is required';
 END IF;
 SELECT payload INTO plan FROM chapter_scope_repair_plan;
 run_id := plan->>'repairId';
 IF run_id IS DISTINCT FROM 'chapter_scope_20260910_v1' THEN
  RAISE EXCEPTION 'Unreviewed chapter repair';
 END IF;
 -- Serialize with ordinary writers and protect the reviewed source snapshot.
 -- The batch only updates identified rows; all other balances stay untouched.
 LOCK TABLE "Student", "Grade", "OpportunityLog", "Exam", "ExamCourse",
  "CourseChapter", "Chapter", "StudentLeave", "StudentNote"
  IN SHARE ROW EXCLUSIVE MODE;
 IF EXISTS (SELECT 1 FROM "AuditLog" WHERE id = run_id) THEN RETURN; END IF;
 SELECT array_agg(x->>'studentId') INTO target_ids FROM jsonb_array_elements(plan->'items') x;
 IF coalesce(cardinality(target_ids),0) = 0 OR cardinality(target_ids) <>
  (SELECT count(DISTINCT x) FROM unnest(target_ids) x) THEN
  RAISE EXCEPTION 'Empty or duplicate repair targets';
 END IF;
 FOREACH table_name IN ARRAY ARRAY['Student','Grade','OpportunityLog','StudentLeave','StudentNote','Exam','ExamCourse','CourseChapter','Chapter'] LOOP
  expected_rows := plan->'expected'->table_name;
  IF jsonb_typeof(expected_rows) IS DISTINCT FROM 'array' THEN
   RAISE EXCEPTION 'Missing expected snapshot for %', table_name;
  END IF;
  IF table_name IN ('Exam','ExamCourse','CourseChapter','Chapter') THEN
   EXECUTE format('SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.id),''[]''::jsonb) FROM %I t',table_name) INTO actual;
  ELSE
   EXECUTE format('SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.id),''[]''::jsonb) FROM %I t WHERE %I = ANY($1)',table_name,CASE WHEN table_name='Student' THEN 'id' ELSE 'studentId' END) INTO actual USING target_ids;
  END IF;
  SELECT coalesce(jsonb_agg(x ORDER BY x->>'id'),'[]'::jsonb) INTO expected_rows FROM jsonb_array_elements(expected_rows) x;
  IF actual IS DISTINCT FROM expected_rows THEN
   RAISE EXCEPTION 'Stale repair snapshot: % changed; nothing was applied',table_name;
  END IF;
 END LOOP;
 before_assignment := plan->'assignment'->'before';
 after_assignment := plan->'assignment'->'after';
 IF before_assignment->>'examId' IS DISTINCT FROM 'cmt1hg0sx0000l104pb1asisz'
  OR before_assignment->>'courseId' IS DISTINCT FROM 'c_mqry9o7z_78jc7b'
  OR before_assignment->>'chapterId' IS NOT NULL
  OR after_assignment->>'chapterId' IS DISTINCT FROM 'ch_mqhfvbi1_6l36qw'
  OR (before_assignment - 'chapterId' - 'chapterSource') IS DISTINCT FROM (after_assignment - 'chapterId' - 'chapterSource') THEN
  RAISE EXCEPTION 'Unreviewed exam assignment';
 END IF;
 UPDATE "ExamCourse" SET "chapterId"=after_assignment->>'chapterId',
  "chapterSource"=after_assignment->>'chapterSource' WHERE id=before_assignment->>'id';
 GET DIAGNOSTICS n = ROW_COUNT;
 IF n <> 1 THEN RAISE EXCEPTION 'Assignment target is missing'; END IF;

 FOR item IN SELECT x FROM jsonb_array_elements(plan->'items') x LOOP
  IF NOT EXISTS (SELECT 1 FROM "Student" s JOIN "CourseChapter" cc ON cc."courseId"=s."courseId"
    WHERE s.id=item->>'studentId' AND s.status <> 'مؤرشف' AND cc.active AND NOT cc.archived
      AND cc."chapterId"=item->>'chapterId'
      AND s.opportunities=(item->'before'->>'opportunities')::integer
      AND s.status=item->'before'->>'status'
      AND s."dismissalReason" IS NOT DISTINCT FROM item->'before'->>'dismissalReason') THEN
   RAISE EXCEPTION 'Student or active chapter does not match reviewed repair';
  END IF;
  IF (item->'after'->>'opportunities')::integer < (item->'before'->>'opportunities')::integer
    OR (item->'after'->>'opportunities')::integer < 0
    OR (item->'after'->>'opportunities')::integer > (SELECT opportunities FROM "Chapter" WHERE id=item->>'chapterId')
    OR item->'after'->>'status' NOT IN ('نشط','مفصول')
    OR (item->'after'->>'status'='مفصول' AND (item->'after'->>'opportunities')::integer<>0)
    OR (item->'before'->>'status'='نشط' AND item->'after'->>'status'<>'نشط') THEN
   RAISE EXCEPTION 'Repair cannot reduce balances or create a new dismissal';
  END IF;
  -- Each target must have an actual automatic log from outside its chapter.
  IF NOT EXISTS (SELECT 1 FROM "OpportunityLog" l
    JOIN "Student" s ON s.id=l."studentId"
    JOIN "ExamCourse" ec ON ec."examId"=l."examId" AND ec."courseId"=s."courseId"
    WHERE s.id=item->>'studentId' AND l."chapterId"=item->>'chapterId'
     AND ec."chapterId" IS DISTINCT FROM l."chapterId"
     AND (l.action IN ('خصم تلقائي','فصل تلقائي') OR l.reason LIKE 'تلقائي:%')
     AND item->'suspectLogIds' ? l.id AND item->'removeLogIds' ? l.id) THEN
   RAISE EXCEPTION 'No proven cross-chapter effect for target';
  END IF;
  SELECT coalesce(jsonb_agg(to_jsonb(l) ORDER BY l.id),'[]'::jsonb) INTO removed_logs
   FROM "OpportunityLog" l WHERE item->'removeLogIds' ? l.id
    AND l."studentId"=item->>'studentId' AND l."chapterId"=item->>'chapterId'
    AND (l.action IN ('خصم تلقائي','فصل تلقائي') OR l.reason LIKE 'تلقائي:%');
  IF jsonb_array_length(removed_logs) <> jsonb_array_length(item->'removeLogIds') THEN
   RAISE EXCEPTION 'A proposed removal is missing, manual, historical, or belongs to another student';
  END IF;
  inserted_logs := item->'insertLogs';
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(inserted_logs) l
   WHERE l->>'studentId' IS DISTINCT FROM item->>'studentId'
    OR l->>'chapterId' IS DISTINCT FROM item->>'chapterId'
    OR l->>'action' NOT IN ('خصم تلقائي','فصل تلقائي')
    OR NOT EXISTS (SELECT 1 FROM "ExamCourse" ec JOIN "Student" s ON s."courseId"=ec."courseId"
      WHERE s.id=item->>'studentId' AND ec."examId"=l->>'examId' AND ec."chapterId"=item->>'chapterId')) THEN
   RAISE EXCEPTION 'Proposed automatic effect is outside the active chapter';
  END IF;
  INSERT INTO "AuditLog" (id,module,action,details,"userName") VALUES
   (run_id||'_'||(item->>'studentId'),'الفرص','تصحيح أثر امتحان من فصل سابق',
    jsonb_build_object('repairId',run_id,'studentId',item->>'studentId','before',item->'before',
      'after',item->'after','removedLogs',removed_logs,'insertedLogs',inserted_logs)::text,'إصلاح النظام');
  DELETE FROM "OpportunityLog" WHERE item->'removeLogIds' ? id;
  INSERT INTO "OpportunityLog" (id,"studentId","examId",action,amount,reason,date,"chapterId","chapterNameSnapshot")
   SELECT l->>'id',l->>'studentId',l->>'examId',l->>'action',(l->>'amount')::integer,
    l->>'reason',(l->>'date')::timestamptz AT TIME ZONE 'UTC',l->>'chapterId',l->>'chapterNameSnapshot'
   FROM jsonb_array_elements(inserted_logs) l;
  UPDATE "Student" SET opportunities=(item->'after'->>'opportunities')::integer,
    status=item->'after'->>'status',"dismissalReason"=nullif(item->'after'->>'dismissalReason','')
   WHERE id=item->>'studentId';
 END LOOP;
 INSERT INTO "AuditLog" (id,module,action,details,"userName") VALUES
  (run_id,'الفرص','إكمال تصحيح خصومات الفصول السابقة',
   jsonb_build_object('students',cardinality(target_ids),'assignmentBefore',before_assignment,
    'assignmentAfter',after_assignment,'sourceFingerprint',md5((plan->'expected')::text))::text,'إصلاح النظام');
END;
$$;
