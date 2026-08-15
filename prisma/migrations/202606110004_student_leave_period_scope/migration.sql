-- Student leave can be linked to a specific exam or to a date range.
ALTER TABLE "StudentLeave" ADD COLUMN IF NOT EXISTS "leaveType" TEXT NOT NULL DEFAULT 'exam';
ALTER TABLE "StudentLeave" ADD COLUMN IF NOT EXISTS "dateFrom" TIMESTAMP(3);
ALTER TABLE "StudentLeave" ADD COLUMN IF NOT EXISTS "dateTo" TIMESTAMP(3);
ALTER TABLE "StudentLeave" ALTER COLUMN "examId" DROP NOT NULL;

UPDATE "StudentLeave"
SET "leaveType" = COALESCE(NULLIF("leaveType", ''), 'exam'),
    "dateFrom" = COALESCE("dateFrom", "date"),
    "dateTo" = COALESCE("dateTo", "date");

CREATE INDEX IF NOT EXISTS "StudentLeave_dateFrom_idx" ON "StudentLeave"("dateFrom");
CREATE INDEX IF NOT EXISTS "StudentLeave_dateTo_idx" ON "StudentLeave"("dateTo");
