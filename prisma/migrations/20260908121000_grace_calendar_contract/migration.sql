BEGIN;
-- Match student-grace.ts: Baghdad calendar days, exclusive end, max 30 days.
-- Prisma timestamps are UTC instants stored as timestamp without time zone.
CREATE OR REPLACE FUNCTION "tp_end_active_grace_on_numeric_grade"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_closed BOOLEAN := FALSE;
  v_today DATE := (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Baghdad')::date;
BEGIN
  IF current_setting('teacherpro.restore_snapshot', true) = 'on' THEN RETURN NEW; END IF;
  IF NEW."status" <> 'درجة' OR NEW."score" IS NULL OR NEW."academicEffectExcluded" THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND NEW."score" IS NOT DISTINCT FROM OLD."score"
    AND NEW."status" IS NOT DISTINCT FROM OLD."status"
    AND NEW."studentId" IS NOT DISTINCT FROM OLD."studentId"
    AND NEW."examId" IS NOT DISTINCT FROM OLD."examId"
    AND NEW."academicEffectExcluded" IS NOT DISTINCT FROM OLD."academicEffectExcluded"
  THEN RETURN NEW; END IF;

  UPDATE "Student" s SET "accountingGraceDays" = 0,
    "gracePeriodStartDate" = NULL, "gracePeriodEndedAt" = CURRENT_TIMESTAMP AT TIME ZONE 'UTC'
  FROM "Exam" e
  WHERE s."id" = NEW."studentId" AND e."id" = NEW."examId"
    AND s."status" <> 'مؤرشف' AND s."gracePeriodEndedAt" IS NULL
    AND (e."date" + INTERVAL '3 hours')::date >= (s."createdAt" + INTERVAL '3 hours')::date
    AND v_today >= ((CASE WHEN s."accountingGraceDays" > 0
        THEN COALESCE(s."gracePeriodStartDate", s."createdAt") ELSE s."createdAt" END) + INTERVAL '3 hours')::date
    AND v_today < ((CASE WHEN s."accountingGraceDays" > 0
        THEN COALESCE(s."gracePeriodStartDate", s."createdAt") ELSE s."createdAt" END) + INTERVAL '3 hours')::date
        + CASE WHEN s."accountingGraceDays" > 0 THEN LEAST(30, s."accountingGraceDays") ELSE 3 END;
  v_closed := FOUND;
  IF v_closed THEN
    UPDATE "GradeSmartNote" SET "status" = 'REJECTED', "updatedAt" = CURRENT_TIMESTAMP AT TIME ZONE 'UTC',
      "resolvedAt" = CURRENT_TIMESTAMP AT TIME ZONE 'UTC',
      "resolution" = 'انتهت فترة السماح بإدخال درجة رقمية رسمية.'
    WHERE "studentId" = NEW."studentId" AND "category" = 'GRACE_SCORED' AND "status" = 'PENDING';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS "tp_end_active_grace_on_numeric_grade_trg" ON "Grade";
CREATE TRIGGER "tp_end_active_grace_on_numeric_grade_trg"
BEFORE INSERT OR UPDATE OF "score", "status", "studentId", "examId", "academicEffectExcluded"
ON "Grade" FOR EACH ROW EXECUTE FUNCTION "tp_end_active_grace_on_numeric_grade"();

COMMIT;
