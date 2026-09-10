-- Owner-authorized recovery of 23 deleted absence records, with NO student or
-- opportunity-ledger writes. Supply temp table absence_restore_source(payload
-- jsonb) inside a SERIALIZABLE transaction, after the bulk-clear fix is READY.
DO $$
DECLARE
 source_rows jsonb; restored_rows jsonb; skipped_rows jsonb;
 students_before jsonb; students_after jsonb;
 ledger_before text; ledger_after text; run_id text := 'restore_dismissed_exam8_20260910_v1';
BEGIN
 IF EXISTS (SELECT 1 FROM "AuditLog" WHERE id=run_id) THEN RETURN; END IF;
 IF (SELECT count(*) FROM absence_restore_source) <> 1 THEN
  RAISE EXCEPTION 'One original absence snapshot is required';
 END IF;
 SELECT payload INTO source_rows FROM absence_restore_source;
 IF jsonb_typeof(source_rows) IS DISTINCT FROM 'array' OR jsonb_array_length(source_rows) <> 23
  OR (SELECT count(DISTINCT g->>'id') FROM jsonb_array_elements(source_rows) g) <> 23
  OR (SELECT count(DISTINCT g->>'studentId') FROM jsonb_array_elements(source_rows) g) <> 23
  OR EXISTS (SELECT 1 FROM jsonb_array_elements(source_rows) g
   WHERE g->>'examId' IS DISTINCT FROM 'cmtppnemd0000jj04boni2ewu'
    OR g->>'status' IS DISTINCT FROM 'غائب' OR g->>'score' IS NOT NULL
    OR g->>'smartNoteId' IS NOT NULL) THEN
  RAISE EXCEPTION 'Only the 23 reviewed original exam-eight absences can be restored';
 END IF;
 -- Grade writers lock this table before recalculating students; use the same
 -- order, then lock only the 23 target students against status changes.
 LOCK TABLE "Grade" IN SHARE ROW EXCLUSIVE MODE;
 PERFORM s.id FROM "Student" s JOIN jsonb_array_elements(source_rows) g
  ON s.id=g->>'studentId' ORDER BY s.id FOR UPDATE OF s;
 IF (SELECT count(*) FROM "Student" s JOIN jsonb_array_elements(source_rows) g
   ON s.id=g->>'studentId' WHERE s.status='مفصول') <> 23 THEN
  RAISE EXCEPTION 'A student status changed; refresh the reviewed restoration';
 END IF;
 SELECT jsonb_agg(to_jsonb(s) ORDER BY s.id) INTO students_before FROM "Student" s;
 SELECT md5(coalesce(jsonb_agg(to_jsonb(l) ORDER BY l.id),'[]'::jsonb)::text) INTO ledger_before FROM "OpportunityLog" l;
 IF EXISTS (SELECT 1 FROM "Grade" existing JOIN jsonb_array_elements(source_rows) g
   ON existing.id=g->>'id' WHERE existing."studentId" IS DISTINCT FROM g->>'studentId'
    OR existing."examId" IS DISTINCT FROM g->>'examId') THEN
  RAISE EXCEPTION 'An original grade ID is already used by another record';
 END IF;
 SELECT coalesce(jsonb_agg(to_jsonb(existing) ORDER BY existing.id),'[]'::jsonb) INTO skipped_rows
  FROM "Grade" existing JOIN jsonb_array_elements(source_rows) g
   ON existing."studentId"=g->>'studentId' AND existing."examId"=g->>'examId';
 WITH inserted AS (
  INSERT INTO "Grade" (id,status,score,notes,"academicAccountingChecked","academicEffectExcluded",
   "academicEffectExclusionReason","academicEffectExclusionSource","createdAt","updatedAt","studentId","examId","smartNoteId")
  SELECT g.id,g.status,g.score,g.notes,g."academicAccountingChecked",g."academicEffectExcluded",
   g."academicEffectExclusionReason",g."academicEffectExclusionSource",g."createdAt",g."updatedAt",g."studentId",g."examId",g."smartNoteId"
  FROM jsonb_populate_recordset(NULL::"Grade",source_rows) g
  WHERE NOT EXISTS (SELECT 1 FROM "Grade" existing WHERE existing."studentId"=g."studentId" AND existing."examId"=g."examId")
  RETURNING *
 ) SELECT coalesce(jsonb_agg(to_jsonb(inserted) ORDER BY id),'[]'::jsonb) INTO restored_rows FROM inserted;
 IF jsonb_array_length(restored_rows) + jsonb_array_length(skipped_rows) <> 23 THEN
  RAISE EXCEPTION 'The restoration did not account for all 23 records';
 END IF;
 IF EXISTS (SELECT 1 FROM jsonb_array_elements(restored_rows) restored
  JOIN jsonb_array_elements(source_rows) original ON restored->>'id'=original->>'id'
  WHERE restored IS DISTINCT FROM original) THEN
  RAISE EXCEPTION 'A restored record differs from its original snapshot';
 END IF;
 SELECT jsonb_agg(to_jsonb(s) ORDER BY s.id) INTO students_after FROM "Student" s;
 SELECT md5(coalesce(jsonb_agg(to_jsonb(l) ORDER BY l.id),'[]'::jsonb)::text) INTO ledger_after FROM "OpportunityLog" l;
 IF students_after IS DISTINCT FROM students_before OR ledger_after IS DISTINCT FROM ledger_before THEN
  RAISE EXCEPTION 'Restoration must not change students or opportunity logs';
 END IF;
 INSERT INTO "AuditLog" (id,module,action,details,"userName") VALUES
  (run_id,'الدرجات','استعادة سجلات غياب المفصولين في الامتحان الثامن',
   jsonb_build_object('examId','cmtppnemd0000jj04boni2ewu','restoredCount',jsonb_array_length(restored_rows),
    'preservedExistingCount',jsonb_array_length(skipped_rows),'restoredGrades',restored_rows,
    'preservedExistingGrades',skipped_rows,'studentChanges',0,'opportunityLogChanges',0,
    'studentFingerprint',md5(students_before::text),'opportunityLogFingerprint',ledger_before)::text,'إصلاح النظام بتوجيه المالك');
END;
$$;
