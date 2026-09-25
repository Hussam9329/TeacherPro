-- Explicit owner-authorized recovery, never a migration, GET, or scheduled task.
-- Supply exactly one reviewed retained_dismissal_repair_plan(payload jsonb)
-- inside a SERIALIZABLE transaction. Hashes use md5(coalesce(string_agg(
-- to_jsonb(row)::text, ',' ORDER BY row.id), '')). Student _rowHash hashes one row.
DO $$
DECLARE
 plan jsonb; item jsonb; evidence jsonb; expected jsonb; source_log jsonb;
 old_audit jsonb; old_details jsonb; actual_hash text; run_id text;
 checkpoint jsonb; transition_log jsonb;
 target_ids text[]; table_name text; expected_id text; n integer;
 removed_logs jsonb; inserted_logs jsonb; before_student jsonb; after_student jsonb;
 immutable_before jsonb := '{}'::jsonb; immutable_after jsonb := '{}'::jsonb;
 other_students_before text; other_students_after text; remaining_logs_before text;
 remaining_logs_after text; all_removal_ids text[]; all_insert_ids text[];
BEGIN
 IF current_setting('transaction_isolation') <> 'serializable' THEN
  RAISE EXCEPTION 'Retained dismissal repair requires a SERIALIZABLE transaction';
 END IF;
 IF (SELECT count(*) FROM retained_dismissal_repair_plan) <> 1 THEN
  RAISE EXCEPTION 'Exactly one reviewed retained dismissal plan is required';
 END IF;
 SELECT payload INTO plan FROM retained_dismissal_repair_plan;
 run_id := plan->>'repairId';
 IF run_id IS DISTINCT FROM 'retained_dismissal_20260917_v1' THEN
  RAISE EXCEPTION 'Unreviewed retained dismissal repair';
 END IF;
 -- Grade writers take the Grade lock before writing Student state. Include all
 -- replay sources and audit evidence so the review remains true during apply.
 LOCK TABLE "Grade", "Student", "OpportunityLog", "StudentLeave", "StudentNote",
  "GradeSmartNote", "Exam", "ExamCourse", "CourseChapter", "Chapter", "AuditLog"
  IN SHARE ROW EXCLUSIVE MODE;
 IF EXISTS (SELECT 1 FROM "AuditLog" WHERE id=run_id) THEN RETURN; END IF;
 IF jsonb_typeof(plan->'items') IS DISTINCT FROM 'array' THEN
  RAISE EXCEPTION 'Repair items must be an array';
 END IF;
 SELECT array_agg(x->>'studentId') INTO target_ids FROM jsonb_array_elements(plan->'items') x;
 IF coalesce(cardinality(target_ids),0)=0 OR array_position(target_ids,NULL) IS NOT NULL
  OR cardinality(target_ids)<>(SELECT count(DISTINCT x) FROM unnest(target_ids) x) THEN
  RAISE EXCEPTION 'Empty or duplicate repair targets';
 END IF;
 -- Each target is protected by an exact full Student hash, including fields
 -- intentionally omitted from the locally reviewed, privacy-minimized snapshot.
 expected := plan->'expected'->'Student';
 IF jsonb_typeof(expected) IS DISTINCT FROM 'array' OR jsonb_array_length(expected)<>cardinality(target_ids)
  OR (SELECT count(DISTINCT x->>'id') FROM jsonb_array_elements(expected) x)<>cardinality(target_ids) THEN
  RAISE EXCEPTION 'Missing or duplicate Student fingerprints';
 END IF;
 FOR item IN SELECT x FROM jsonb_array_elements(expected) x LOOP
  SELECT md5(to_jsonb(s)::text) INTO actual_hash FROM "Student" s WHERE s.id=item->>'id';
  IF NOT ((item->>'id')=ANY(target_ids)) OR actual_hash IS NULL
   OR actual_hash IS DISTINCT FROM item->>'_rowHash' THEN
   RAISE EXCEPTION 'Stale repair snapshot: Student changed';
  END IF;
 END LOOP;
 FOREACH table_name IN ARRAY ARRAY['Grade','OpportunityLog','StudentLeave','StudentNote','GradeSmartNote'] LOOP
  expected := plan->'expected'->table_name;
  IF jsonb_typeof(expected) IS DISTINCT FROM 'array' OR jsonb_array_length(expected)<>cardinality(target_ids)
   OR (SELECT count(DISTINCT x->>'studentId') FROM jsonb_array_elements(expected) x)<>cardinality(target_ids) THEN
   RAISE EXCEPTION 'Missing or duplicate fingerprints for %',table_name;
  END IF;
  FOR item IN SELECT x FROM jsonb_array_elements(expected) x LOOP
   expected_id := item->>'studentId';
   EXECUTE format('SELECT md5(coalesce(string_agg(to_jsonb(t)::text,'','' ORDER BY t.id),'''')) FROM %I t WHERE t."studentId"=$1',table_name)
    INTO actual_hash USING expected_id;
   IF NOT (expected_id=ANY(target_ids)) OR actual_hash IS DISTINCT FROM item->>'hash' THEN
    RAISE EXCEPTION 'Stale repair snapshot: % changed',table_name;
   END IF;
  END LOOP;
 END LOOP;
 FOREACH table_name IN ARRAY ARRAY['Exam','ExamCourse','CourseChapter','Chapter'] LOOP
  EXECUTE format('SELECT md5(coalesce(string_agg(to_jsonb(t)::text,'','' ORDER BY t.id),'''')) FROM %I t',table_name) INTO actual_hash;
  IF actual_hash IS DISTINCT FROM plan->'expected'->>table_name THEN
   RAISE EXCEPTION 'Stale repair snapshot: % changed',table_name;
  END IF;
 END LOOP;
 SELECT md5(coalesce(string_agg(to_jsonb(s)::text,',' ORDER BY s.id),'')) INTO other_students_before
  FROM "Student" s WHERE NOT (s.id=ANY(target_ids));
 -- These entire tables, not just target rows, must stay byte-for-byte intact.
 FOREACH table_name IN ARRAY ARRAY['Grade','GradeSmartNote','StudentLeave','Exam','ExamCourse','CourseChapter','Chapter'] LOOP
  EXECUTE format('SELECT md5(coalesce(string_agg(to_jsonb(t)::text,'','' ORDER BY t.id),'''')) FROM %I t',table_name) INTO actual_hash;
  immutable_before := immutable_before || jsonb_build_object(table_name,actual_hash);
 END LOOP;
 SELECT coalesce(array_agg(r.value),'{}'::text[]) INTO all_removal_ids
  FROM jsonb_array_elements(plan->'items') i CROSS JOIN LATERAL jsonb_array_elements_text(i->'removeLogIds') r;
 SELECT coalesce(array_agg(id),'{}'::text[]) INTO all_insert_ids FROM (
  SELECT l->>'id' id FROM jsonb_array_elements(plan->'items') i CROSS JOIN LATERAL jsonb_array_elements(i->'insertLogs') l
  UNION ALL SELECT i->'balanceCheckpoint'->>'id' FROM jsonb_array_elements(plan->'items') i
   WHERE jsonb_typeof(i->'balanceCheckpoint')='object'
 ) inserted_ids;
 IF cardinality(all_removal_ids)<>(SELECT count(DISTINCT x) FROM unnest(all_removal_ids) x)
  OR cardinality(all_insert_ids)<>(SELECT count(DISTINCT x) FROM unnest(all_insert_ids) x)
  OR array_position(all_insert_ids,NULL) IS NOT NULL THEN
  RAISE EXCEPTION 'Duplicate or missing opportunity log IDs';
 END IF;
 SELECT md5(coalesce(string_agg(to_jsonb(l)::text,',' ORDER BY l.id),'')) INTO remaining_logs_before
  FROM "OpportunityLog" l WHERE NOT (l.id=ANY(all_removal_ids));

 FOR item IN SELECT x FROM jsonb_array_elements(plan->'items') x LOOP
  evidence := item->'evidence';
  checkpoint := item->'balanceCheckpoint';
  SELECT to_jsonb(s) INTO before_student FROM "Student" s WHERE s.id=item->>'studentId';
  IF item->'before'->>'status' IS DISTINCT FROM 'مفصول'
   OR before_student->>'status' IS DISTINCT FROM 'مفصول'
   OR (before_student->>'opportunities')::integer IS DISTINCT FROM (item->'before'->>'opportunities')::integer
   OR before_student->>'dismissalReason' IS DISTINCT FROM item->'before'->>'dismissalReason'
   OR item->'after'->>'status' IS DISTINCT FROM 'نشط'
   OR item->'after'->>'dismissalReason' IS DISTINCT FROM ''
   OR NOT EXISTS (SELECT 1 FROM "CourseChapter" cc WHERE cc."courseId"=before_student->>'courseId'
    AND cc.active AND NOT cc.archived AND cc."chapterId"=item->>'chapterId') THEN
   RAISE EXCEPTION 'Student or active chapter does not match reviewed restoration';
  END IF;
  IF jsonb_typeof(item->'after'->'opportunities') IS DISTINCT FROM 'number'
   OR (item->'after'->>'opportunities') !~ '^[0-9]+$'
   OR (item->'after'->>'opportunities')::integer<(item->'before'->>'opportunities')::integer
   OR (item->'after'->>'opportunities')::integer>(SELECT opportunities FROM "Chapter" WHERE id=item->>'chapterId') THEN
   RAISE EXCEPTION 'Repair cannot reduce balances, exceed the chapter cap, or create a dismissal';
  END IF;
  SELECT to_jsonb(l) INTO source_log FROM "OpportunityLog" l
   WHERE l.id=evidence->>'sourceDismissalLogId' AND l."studentId"=item->>'studentId';
  IF source_log IS NULL OR source_log->>'action' IS DISTINCT FROM 'فصل تلقائي'
   OR source_log->>'examId' IS DISTINCT FROM evidence->>'sourceExamId'
   OR regexp_replace(source_log->>'reason','^تلقائي:\s*','') IS DISTINCT FROM before_student->>'dismissalReason'
   OR NOT EXISTS (SELECT 1 FROM "ExamCourse" ec WHERE ec."examId"=source_log->>'examId'
    AND ec."courseId"=before_student->>'courseId' AND ec."chapterId"=evidence->>'sourceChapterId')
   OR (source_log->>'chapterId' IS NOT NULL AND source_log->>'chapterId' IS DISTINCT FROM evidence->>'sourceChapterId')
   OR evidence->'originalChapterReplay'->>'status' IS DISTINCT FROM 'نشط'
   OR evidence->'originalChapterReplay'->>'opportunities' IS NULL
   OR (evidence->'originalChapterReplay'->>'opportunities') !~ '^[0-9]+$'
   OR evidence->'currentChapterReplay'->>'status' IS DISTINCT FROM 'نشط'
   OR evidence->'currentChapterReplay'->'opportunities' IS DISTINCT FROM item->'after'->'opportunities' THEN
   RAISE EXCEPTION 'Restoration requires exact automatic dismissal and successful original/current chapter replay evidence';
  END IF;
  old_details := NULL;
  IF evidence->>'kind'='missing-chapter-transition' THEN
   SELECT to_jsonb(l) INTO transition_log FROM "OpportunityLog" l JOIN "Student" source_student ON source_student.id=l."studentId"
    WHERE l.id=evidence->>'sourceTransitionLogId' AND source_student."courseId"=before_student->>'courseId';
   IF transition_log IS NULL OR md5(transition_log::text) IS DISTINCT FROM evidence->>'sourceTransitionLogHash'
    OR transition_log->>'chapterId' IS DISTINCT FROM item->>'chapterId'
    OR transition_log->>'action' IS DISTINCT FROM 'إعادة تعيين'
    OR transition_log->>'ledgerVersion' IS DISTINCT FROM '2'
    OR coalesce(transition_log->>'reason','') NOT LIKE 'تسوية تاريخية: تحويل فصل يدوي؛%'
    OR transition_log->>'examId' IS NOT NULL
    OR transition_log->>'balanceAfter' IS DISTINCT FROM '3'
    OR jsonb_typeof(checkpoint) IS DISTINCT FROM 'object'
    OR checkpoint->>'id' IS DISTINCT FROM run_id||'_checkpoint_'||(item->>'studentId')
    OR checkpoint->>'studentId' IS DISTINCT FROM item->>'studentId'
    OR checkpoint->>'chapterId' IS DISTINCT FROM item->>'chapterId'
    OR checkpoint->>'action' IS DISTINCT FROM 'إعادة تعيين'
    OR checkpoint->>'ledgerVersion' IS DISTINCT FROM '2'
    OR checkpoint->>'examId' IS NOT NULL
    OR checkpoint->>'amount' IS DISTINCT FROM '3'
    OR checkpoint->>'balanceAfter' IS DISTINCT FROM '3'
    OR checkpoint->>'reason' IS DISTINCT FROM transition_log->>'reason'
    OR (checkpoint->>'date')::timestamptz IS DISTINCT FROM (transition_log->>'date')::timestamptz
    OR checkpoint->>'settledGradeIds' IS DISTINCT FROM '[]'
    OR checkpoint->>'requestedAmount' IS NOT NULL OR checkpoint->>'appliedAmount' IS NOT NULL
    OR checkpoint->>'balanceBefore' IS NOT NULL OR checkpoint->>'reversalOfLogId' IS NOT NULL
    OR (before_student->>'createdAt')::timestamptz>(transition_log->>'date')::timestamptz
    OR item->'repeatedReplayStable' IS DISTINCT FROM 'true'::jsonb
    OR item->'ordinaryReplayStable' IS DISTINCT FROM 'true'::jsonb
    OR NOT EXISTS (SELECT 1 FROM "CourseChapter" cc
     CROSS JOIN LATERAL jsonb_array_elements(cc.archive::jsonb) entries(history_entry)
     WHERE cc.id=evidence->>'originArchiveCourseChapterId'
      AND cc."courseId"=before_student->>'courseId' AND cc."chapterId"=item->>'originChapterId'
      AND cc."chapterId"<>item->>'chapterId'
      AND history_entry=evidence->'originArchiveEntry' AND history_entry->>'studentId'=item->>'studentId'
      AND (history_entry->>'date')::date=(transition_log->>'date')::date)
    OR EXISTS (SELECT 1 FROM "OpportunityLog" l WHERE l."studentId"=item->>'studentId'
      AND l."chapterId"=item->>'chapterId' AND (l.action IN ('إعادة تعيين','رصيد إعادة التفعيل','رصيد بعد تعهد')
       OR l.reason LIKE 'تسوية تاريخية:%'))
    OR EXISTS (SELECT 1 FROM "OpportunityLog" l WHERE l."studentId"=item->>'studentId'
      AND l.action='خصم' AND l.reason LIKE 'فصل الطالب%')
    OR EXISTS (SELECT 1 FROM "StudentNote" n WHERE n."studentId"=item->>'studentId'
      AND n.kind='إجراء' AND n.text LIKE 'فصل الطالب%') THEN
    RAISE EXCEPTION 'Missing transition repair requires the exact course opening checkpoint, empty settled grades, archive, and stable replays';
   END IF;
  ELSIF checkpoint IS NOT NULL AND checkpoint<>'null'::jsonb THEN
   RAISE EXCEPTION 'Only a proven missing chapter transition may insert a checkpoint';
  ELSIF evidence->>'kind'='verified-historical-replay' THEN
   -- Separately reviewed historical cases without the September 10 audit need
   -- a matching transition archive with a positive original balance. This does
   -- not authorize a new checkpoint, reset, pledge, or any grade settlement.
   IF evidence->>'sourceChapterId'=item->>'chapterId'
    OR coalesce(source_log->>'reason','') NOT LIKE 'تلقائي: مخالفة بعد انتهاء الفرص%'
    OR item->'repeatedReplayStable' IS DISTINCT FROM 'true'::jsonb
    OR item->'ordinaryReplayStable' IS DISTINCT FROM 'true'::jsonb
    OR NOT EXISTS (SELECT 1 FROM "CourseChapter" cc
     CROSS JOIN LATERAL jsonb_array_elements(cc.archive::jsonb) entries(history_entry)
     JOIN "Exam" e ON e.id=source_log->>'examId'
     WHERE cc.id=evidence->>'originArchiveCourseChapterId'
      AND cc."courseId"=before_student->>'courseId' AND cc."chapterId"=evidence->>'sourceChapterId'
      AND history_entry=evidence->'originArchiveEntry' AND history_entry->>'studentId'=item->>'studentId'
      AND history_entry->>'date'=evidence->>'transitionDate'
      AND (history_entry->>'opportunities')::integer>0
      AND history_entry->'opportunities'=evidence->'originalChapterReplay'->'opportunities'
      AND (e.date AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Baghdad')::date<(history_entry->>'date')::date)
    OR EXISTS (SELECT 1 FROM "OpportunityLog" l WHERE l."studentId"=item->>'studentId'
      AND l.action='خصم' AND l.reason LIKE 'فصل الطالب%')
    OR EXISTS (SELECT 1 FROM "StudentNote" n WHERE n."studentId"=item->>'studentId'
      AND n.kind='إجراء' AND n.text LIKE 'فصل الطالب%') THEN
    RAISE EXCEPTION 'Historical restoration requires exact positive transition archive, stable replays, and no manual dismissal';
   END IF;
  ELSE
   SELECT to_jsonb(a) INTO old_audit FROM "AuditLog" a WHERE a.id=evidence->>'priorCorrectionAuditId';
   old_details := (old_audit->>'details')::jsonb;
   IF old_audit IS NULL OR md5(old_audit::text) IS DISTINCT FROM evidence->>'priorCorrectionAuditHash'
   OR old_details->>'repairId' IS DISTINCT FROM 'chapter_scope_20260910_v2'
   OR old_details->>'studentId' IS DISTINCT FROM item->>'studentId'
   OR old_details->'before'->>'status' IS DISTINCT FROM 'مفصول'
   OR old_details->'after'->>'status' IS DISTINCT FROM 'نشط'
   OR NOT EXISTS (SELECT 1 FROM jsonb_array_elements(old_details->'removedLogs') l
    WHERE l->>'action'='فصل تلقائي' AND l->>'studentId'=item->>'studentId'
     AND l->>'id'=source_log->>'id'
     AND l->>'examId'=source_log->>'examId'
     AND regexp_replace(l->>'reason','^تلقائي:\s*','')=before_student->>'dismissalReason') THEN
    RAISE EXCEPTION 'A matching durable prior correction is required';
   END IF;
  END IF;
  IF jsonb_typeof(item->'removeLogIds') IS DISTINCT FROM 'array'
   OR jsonb_typeof(item->'insertLogs') IS DISTINCT FROM 'array'
   OR NOT (item->'removeLogIds' ? (source_log->>'id')) THEN
   RAISE EXCEPTION 'The proven stale dismissal must be removed';
  END IF;
  SELECT coalesce(jsonb_agg(to_jsonb(l) ORDER BY l.id),'[]'::jsonb) INTO removed_logs FROM "OpportunityLog" l
   WHERE item->'removeLogIds' ? l.id AND l."studentId"=item->>'studentId'
    AND l.action IN ('خصم تلقائي','فصل تلقائي') AND l.reason LIKE 'تلقائي:%'
    AND (l.id=source_log->>'id' OR l."chapterId"=item->>'chapterId'
     OR EXISTS (SELECT 1 FROM jsonb_array_elements(old_details->'removedLogs') previous
      JOIN "ExamCourse" ec ON ec."examId"=l."examId" AND ec."courseId"=before_student->>'courseId'
      WHERE previous->>'id'=l.id AND previous->>'studentId'=l."studentId"
       AND previous->>'examId'=l."examId" AND previous->>'action'=l.action
       AND previous->>'reason'=l.reason AND ec."chapterId" IS NOT NULL
       AND ec."chapterId"<>evidence->>'sourceChapterId'));
  IF jsonb_array_length(removed_logs)<>jsonb_array_length(item->'removeLogIds') THEN
   RAISE EXCEPTION 'A proposed removal is missing, manual, unrelated, or an unproven historical effect';
  END IF;
  inserted_logs := item->'insertLogs';
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(inserted_logs) l
   WHERE l->>'studentId' IS DISTINCT FROM item->>'studentId'
    OR l->>'chapterId' IS DISTINCT FROM item->>'chapterId'
    OR l->>'action' IS DISTINCT FROM 'خصم تلقائي'
    OR coalesce(l->>'reason','') NOT LIKE 'تلقائي:%'
    OR jsonb_typeof(l->'amount') IS DISTINCT FROM 'number' OR (l->>'amount') !~ '^[1-9][0-9]*$'
    OR l->>'date' IS NULL OR coalesce(l->>'id','')=''
    OR NOT EXISTS (SELECT 1 FROM "ExamCourse" ec JOIN "Exam" e ON e.id=ec."examId"
     WHERE ec."courseId"=before_student->>'courseId' AND ec."chapterId"=item->>'chapterId'
      AND ec."examId"=l->>'examId' AND e.active AND NOT e."noDiscount")
    OR NOT EXISTS (SELECT 1 FROM "Grade" g WHERE g."studentId"=item->>'studentId'
     AND g."examId"=l->>'examId' AND g.status<>'مجاز' AND NOT g."academicEffectExcluded")
    OR EXISTS (SELECT 1 FROM "OpportunityLog" existing WHERE existing.id=l->>'id' AND NOT (item->'removeLogIds' ? existing.id))) THEN
   RAISE EXCEPTION 'Proposed log is not a new valid automatic deduction in the active chapter';
  END IF;
  DELETE FROM "OpportunityLog" WHERE "studentId"=item->>'studentId' AND item->'removeLogIds' ? id;
  GET DIAGNOSTICS n=ROW_COUNT;
  IF n<>jsonb_array_length(removed_logs) THEN RAISE EXCEPTION 'Removal count changed'; END IF;
  INSERT INTO "OpportunityLog" (id,"studentId","examId",action,amount,reason,date,"chapterId","chapterNameSnapshot")
   SELECT l->>'id',l->>'studentId',l->>'examId',l->>'action',(l->>'amount')::integer,l->>'reason',
    (l->>'date')::timestamptz AT TIME ZONE 'UTC',l->>'chapterId',l->>'chapterNameSnapshot'
   FROM jsonb_array_elements(inserted_logs) l;
  IF evidence->>'kind'='missing-chapter-transition' THEN
   INSERT INTO "OpportunityLog" (id,"studentId","examId",action,amount,reason,date,"chapterId","chapterNameSnapshot","ledgerVersion","balanceAfter","settledGradeIds") VALUES
    (checkpoint->>'id',item->>'studentId',NULL,'إعادة تعيين',3,checkpoint->>'reason',
     (checkpoint->>'date')::timestamptz AT TIME ZONE 'UTC',item->>'chapterId',checkpoint->>'chapterNameSnapshot',2,3,'[]');
  END IF;
  UPDATE "Student" SET status='نشط',opportunities=(item->'after'->>'opportunities')::integer,
   "dismissalReason"=NULL,"dismissalType"=NULL WHERE id=item->>'studentId';
  SELECT to_jsonb(s) INTO after_student FROM "Student" s WHERE s.id=item->>'studentId';
  -- dismissedChecked/dismissedCheckEpoch are trigger-managed by
  -- tp_reset_dismissed_check on status transitions, so they may legitimately
  -- change during a reviewed restoration; any other field must not move.
  IF (before_student-ARRAY['status','opportunities','dismissalReason','dismissalType','dismissedChecked','dismissedCheckEpoch']) IS DISTINCT FROM
   (after_student-ARRAY['status','opportunities','dismissalReason','dismissalType','dismissedChecked','dismissedCheckEpoch']) THEN
   RAISE EXCEPTION 'Restoration changed unrelated target fields';
  END IF;
  -- Neutral history: deliberately no reactivation/reset opportunity command.
  INSERT INTO "StudentNote" (id,"studentId",kind,text,"sourceType","sourceId") VALUES
   (run_id||'_note_'||(item->>'studentId'),item->>'studentId','إجراء',
    'تصحيح حالة فصل قديمة غير صحيحة بعد مراجعة السجل. الرصيد الصحيح: '||(item->'after'->>'opportunities'),
    'repair',run_id);
  INSERT INTO "AuditLog" (id,module,action,details,"userName") VALUES
   (run_id||'_'||(item->>'studentId'),'الفرص','تصحيح حالة فصل قديمة غير صحيحة',
    jsonb_build_object('repairId',run_id,'studentId',item->>'studentId','chapterId',item->>'chapterId',
     'before',item->'before','after',item->'after','studentBefore',before_student,'studentAfter',after_student,
     'removedLogs',removed_logs,'insertedLogs',inserted_logs,'balanceCheckpoint',checkpoint,'evidence',evidence)::text,'إصلاح النظام بتوجيه المالك');
 END LOOP;
 SELECT md5(coalesce(string_agg(to_jsonb(s)::text,',' ORDER BY s.id),'')) INTO other_students_after
  FROM "Student" s WHERE NOT (s.id=ANY(target_ids));
 SELECT md5(coalesce(string_agg(to_jsonb(l)::text,',' ORDER BY l.id),'')) INTO remaining_logs_after
  FROM "OpportunityLog" l WHERE NOT (l.id=ANY(all_insert_ids));
 FOREACH table_name IN ARRAY ARRAY['Grade','GradeSmartNote','StudentLeave','Exam','ExamCourse','CourseChapter','Chapter'] LOOP
  EXECUTE format('SELECT md5(coalesce(string_agg(to_jsonb(t)::text,'','' ORDER BY t.id),'''')) FROM %I t',table_name) INTO actual_hash;
  immutable_after := immutable_after || jsonb_build_object(table_name,actual_hash);
 END LOOP;
 IF immutable_before IS DISTINCT FROM immutable_after OR other_students_before IS DISTINCT FROM other_students_after
  OR remaining_logs_before IS DISTINCT FROM remaining_logs_after THEN
  RAISE EXCEPTION 'Repair changed a protected table, unrelated student, or preserved opportunity log';
 END IF;
 INSERT INTO "AuditLog" (id,module,action,details,"userName") VALUES
  (run_id,'الفرص','إكمال تصحيح حالات الفصل القديمة غير الصحيحة',
   jsonb_build_object('repairId',run_id,'students',cardinality(target_ids),'studentIds',to_jsonb(target_ids),
    'sourceFingerprint',md5((plan->'expected')::text),'nonTargetStudentChanges',0,'gradeChanges',0,
    'smartNoteChanges',0,'protectedFingerprints',immutable_after,'removedLogs',cardinality(all_removal_ids),
    'insertedLogs',cardinality(all_insert_ids))::text,'إصلاح النظام بتوجيه المالك');
END;
$$;
