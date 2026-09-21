BEGIN;

-- The checkbox belongs to one dismissal episode, never to the student's
-- academic balance. Older in-flight requests cannot follow a later dismissal.
ALTER TABLE "Student" ADD COLUMN "dismissedCheckEpoch" INTEGER NOT NULL DEFAULT 0;

CREATE FUNCTION "tp_reset_dismissed_check"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    -- Treat the persisted epoch as authoritative, including during backup
    -- upserts. A caller must not roll it back by writing an older snapshot.
    IF NEW."status" IS DISTINCT FROM OLD."status" THEN
      NEW."dismissedCheckEpoch" := OLD."dismissedCheckEpoch" + 1;
      NEW."dismissedChecked" := false;
    ELSE
      IF NEW."dismissedCheckEpoch" IS DISTINCT FROM OLD."dismissedCheckEpoch" THEN
        NEW."dismissedChecked" := OLD."dismissedChecked";
      END IF;
      NEW."dismissedCheckEpoch" := OLD."dismissedCheckEpoch";
    END IF;
  END IF;
  IF NEW."status" IS DISTINCT FROM 'مفصول' THEN
    NEW."dismissedChecked" := false;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "tp_reset_dismissed_check_trg"
BEFORE INSERT OR UPDATE OF "status", "dismissedChecked", "dismissedCheckEpoch" ON "Student"
FOR EACH ROW EXECUTE FUNCTION "tp_reset_dismissed_check"();

-- Clear only leftover live flags; all student/grade/balance/history fields
-- and the current checks of students who remain dismissed are preserved.
UPDATE "Student" SET "dismissedChecked" = false
WHERE "status" <> 'مفصول' AND "dismissedChecked" = true;

COMMIT;
