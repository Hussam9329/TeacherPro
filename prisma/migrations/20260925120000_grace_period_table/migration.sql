-- Additive: introduces the single source of grace-period protection.
-- Existing students, grades, balances and the legacy Student grace columns
-- stay untouched; the legacy columns are read only by the audited conversion.
CREATE TABLE "GracePeriod" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'manual',
    "note" TEXT NOT NULL DEFAULT '',
    "createdById" TEXT,
    "createdByName" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedById" TEXT,
    "updatedByName" TEXT NOT NULL DEFAULT '',
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cancelledAt" TIMESTAMP(3),
    "cancelledById" TEXT,
    "cancelledByName" TEXT NOT NULL DEFAULT '',
    "cancelReason" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "GracePeriod_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "GracePeriod_date_order" CHECK ("endDate" >= "startDate"),
    CONSTRAINT "GracePeriod_source_check" CHECK ("source" IN ('manual', 'legacy'))
);

CREATE INDEX "GracePeriod_studentId_startDate_idx"
ON "GracePeriod"("studentId", "startDate");

CREATE INDEX "GracePeriod_cancelledAt_idx"
ON "GracePeriod"("cancelledAt");

ALTER TABLE "GracePeriod"
ADD CONSTRAINT "GracePeriod_studentId_fkey"
FOREIGN KEY ("studentId") REFERENCES "Student"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

-- Two active periods of the same student may never protect the same day.
CREATE OR REPLACE FUNCTION "tp_grace_period_no_overlap"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."cancelledAt" IS NOT NULL THEN RETURN NEW; END IF;
  IF EXISTS (
    SELECT 1 FROM "GracePeriod" g
    WHERE g."studentId" = NEW."studentId"
      AND g."id" <> NEW."id"
      AND g."cancelledAt" IS NULL
      AND g."startDate" <= NEW."endDate"
      AND NEW."startDate" <= g."endDate"
  ) THEN
    RAISE EXCEPTION 'GRACE_PERIOD_OVERLAP' USING ERRCODE = '23P01';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "tp_grace_period_no_overlap_trg"
BEFORE INSERT OR UPDATE OF "studentId", "startDate", "endDate", "cancelledAt"
ON "GracePeriod" FOR EACH ROW EXECUTE FUNCTION "tp_grace_period_no_overlap"();

-- Grades can no longer end or change grace. The legacy trigger stays attached
-- (build migrations are additive only) but becomes a no-op, so no grade write,
-- leave restore or exam edit can touch grace outside the management screen.
CREATE OR REPLACE FUNCTION "tp_end_active_grace_on_numeric_grade"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION "tp_end_active_grace_on_numeric_grade"() IS
  'Retired: grace periods live in "GracePeriod" and are never changed by grades.';
