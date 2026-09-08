BEGIN;
-- Expand only: retain every historical value. No balance or grade rewrite.
ALTER TABLE "OpportunityLog"
 ADD COLUMN IF NOT EXISTS "requestedAmount" INTEGER,
 ADD COLUMN IF NOT EXISTS "appliedAmount" INTEGER,
 ADD COLUMN IF NOT EXISTS "balanceBefore" INTEGER,
 ADD COLUMN IF NOT EXISTS "balanceAfter" INTEGER,
 ADD COLUMN IF NOT EXISTS "reversalOfLogId" TEXT,
 ADD COLUMN IF NOT EXISTS "ledgerVersion" INTEGER,
 ADD COLUMN IF NOT EXISTS "settledGradeIds" TEXT;
ALTER TABLE "Student"
 ADD COLUMN IF NOT EXISTS "dismissalType" TEXT,
 ADD COLUMN IF NOT EXISTS "gracePeriodEndedByExamId" TEXT,
 ADD COLUMN IF NOT EXISTS "gracePeriodHistoryPreserved" BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE "StudentNote" ADD COLUMN IF NOT EXISTS "dismissalType" TEXT NOT NULL DEFAULT '';
CREATE TABLE IF NOT EXISTS "GradeEntryMissingNote" (
 "id" TEXT PRIMARY KEY, "examId" TEXT NOT NULL,
 "examName" TEXT NOT NULL DEFAULT '', "examDate" TEXT NOT NULL DEFAULT '',
 "text" TEXT NOT NULL, "userId" TEXT, "userName" TEXT,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "updatedAt" TIMESTAMP(3) NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "OpportunityLog_v2_reversal_unique"
ON "OpportunityLog" ("reversalOfLogId")
WHERE "ledgerVersion" = 2 AND "reversalOfLogId" IS NOT NULL;

COMMIT;
