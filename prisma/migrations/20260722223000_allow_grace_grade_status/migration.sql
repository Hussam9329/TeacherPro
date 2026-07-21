-- Allow the server to persist a scoreless exam marker for students whose
-- exam date falls inside their accounting grace window.
ALTER TABLE "Grade"
  DROP CONSTRAINT IF EXISTS "Grade_status_score_consistency";

ALTER TABLE "Grade"
  ADD CONSTRAINT "Grade_status_score_consistency"
  CHECK (
    "status" IN ('درجة', 'غائب', 'غش', 'ضمن فترة السماح')
    AND ("status" = 'درجة' OR "score" IS NULL)
  );
