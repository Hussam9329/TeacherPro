    -- TeacherPro: authoritative database contract for grace-period numeric grades.
    -- A numeric grade written while grace is currently active ends grace in the same
    -- database transaction. This protects every API, leave restoration, import,
    -- maintenance script, and future code path from bypassing the business rule.

    CREATE OR REPLACE FUNCTION "tp_end_active_grace_on_numeric_grade"()
    RETURNS TRIGGER
    LANGUAGE plpgsql
    AS $$
    DECLARE
      v_grace_closed BOOLEAN := FALSE;
    BEGIN
      IF NEW."score" IS NULL THEN
        RETURN NEW;
      END IF;

IF TG_OP = 'UPDATE'
   AND NEW."score" IS NOT DISTINCT FROM OLD."score"
   AND NEW."academicEffectExcluded" IS NOT DISTINCT FROM OLD."academicEffectExcluded" THEN
  RETURN NEW;
END IF;
      UPDATE "Student" AS s
         SET "accountingGraceDays" = 0, "gracePeriodStartDate" = NULL, "gracePeriodEndedAt" = COALESCE(s."gracePeriodEndedAt", CURRENT_TIMESTAMP)
       WHERE s."id" = NEW."studentId"
         AND s."gracePeriodEndedAt" IS NULL
         AND COALESCE(s."gracePeriodStartDate", s."createdAt") IS NOT NULL
         AND CURRENT_TIMESTAMP >= COALESCE(s."gracePeriodStartDate", s."createdAt")
         AND CURRENT_TIMESTAMP <= (
               COALESCE(s."gracePeriodStartDate", s."createdAt")
               + (CASE
                    WHEN COALESCE(s."accountingGraceDays", 0) > 0 THEN s."accountingGraceDays"
                    ELSE 3
                  END) * INTERVAL '1 day'
             );

      v_grace_closed := FOUND;

      IF v_grace_closed THEN

    -- داخل السماح، الدرجة الرقمية الرسمية محتسبة دائمًا.
    NEW."academicEffectExcluded" := FALSE;
    UPDATE "GradeSmartNote"
       SET "status" = 'REJECTED', "updatedAt" = CURRENT_TIMESTAMP
     WHERE "studentId" = NEW."studentId"
       AND "reason" = 'GRACE_SCORED'
       AND "status" = 'PENDING';
      END IF;

      RETURN NEW;
    END;
    $$;

    DROP TRIGGER IF EXISTS "tp_end_active_grace_on_numeric_grade_trg" ON "Grade";

    CREATE TRIGGER "tp_end_active_grace_on_numeric_grade_trg"
    BEFORE INSERT OR UPDATE OF "score", "studentId", "academicEffectExcluded"
    ON "Grade"
    FOR EACH ROW
    EXECUTE FUNCTION "tp_end_active_grace_on_numeric_grade"();

    COMMENT ON FUNCTION "tp_end_active_grace_on_numeric_grade"() IS
      'Numeric official grades atomically end an active student grace period and cannot remain academically excluded because of grace.';
