-- Contract step: run only after the compatible P2 deployment is READY.
-- Unknown dependencies block DROP; no CASCADE and no data deletion is allowed.
BEGIN;
DO $$
DECLARE object_name TEXT; row_present BOOLEAN;
BEGIN
 FOREACH object_name IN ARRAY ARRAY['DemoCopy','Site'] LOOP
  IF to_regclass(format('%I',object_name)) IS NULL THEN CONTINUE; END IF;
  EXECUTE format('LOCK TABLE %I IN ACCESS EXCLUSIVE MODE',object_name);
  EXECUTE format('SELECT EXISTS(SELECT 1 FROM %I)',object_name) INTO row_present;
  IF row_present THEN RAISE EXCEPTION 'Retired table % is not empty; contract aborted',object_name; END IF;
  INSERT INTO "AuditLog" (id,module,action,details,"time")
  SELECT 'p2_retired_empty_'||object_name,'صيانة النظام','إزالة جدول قديم فارغ بعد نشر النسخة المتوافقة',
   jsonb_build_object('table',object_name,'rows',0,'columns',(SELECT jsonb_agg(to_jsonb(c)) FROM information_schema.columns c WHERE c.table_schema='public' AND c.table_name=object_name))::text,CURRENT_TIMESTAMP;
  EXECUTE format('DROP TABLE %I',object_name);
 END LOOP;
END;
$$;
COMMIT;
