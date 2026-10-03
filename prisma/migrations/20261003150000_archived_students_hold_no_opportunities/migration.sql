BEGIN;

-- An archived student holds no opportunities, always. Whatever writes the row
-- (a route, a recalculation, a backup restore), an archived student's balance
-- and its base are stored as 0. Only an explicit restore from the archive,
-- which changes the status, gives a balance again.
CREATE FUNCTION "tp_archived_student_no_opportunities"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW."status" = 'مؤرشف' THEN
    NEW."opportunities" := 0;
    NEW."baseOpportunities" := 0;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "tp_archived_student_no_opportunities_trg"
BEFORE INSERT OR UPDATE OF "status", "opportunities", "baseOpportunities" ON "Student"
FOR EACH ROW EXECUTE FUNCTION "tp_archived_student_no_opportunities"();

-- Students archived before this rule keep their history (opportunity logs
-- and notes); only their stored balance becomes 0.
UPDATE "Student" SET "opportunities" = 0, "baseOpportunities" = 0
WHERE "status" = 'مؤرشف' AND ("opportunities" <> 0 OR "baseOpportunities" <> 0);

COMMIT;
