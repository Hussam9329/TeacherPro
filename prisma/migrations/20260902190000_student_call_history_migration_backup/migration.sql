-- TP-PATCH-03 — Call History Migration
-- Permanent, non-destructive backup storage for the one-time logical
-- StudentCall deduplication. This migration creates backup infrastructure only;
-- it does NOT merge or delete any StudentCall rows automatically on deploy.

CREATE TABLE IF NOT EXISTS "StudentCallHistoryMigrationRun" (
  "id" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'running',
  "backupCount" INTEGER NOT NULL DEFAULT 0,
  "mergedGroups" INTEGER NOT NULL DEFAULT 0,
  "deletedRows" INTEGER NOT NULL DEFAULT 0,
  "summary" JSONB,
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMP(3),
  CONSTRAINT "StudentCallHistoryMigrationRun_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "StudentCallHistoryBackup" (
  "id" TEXT NOT NULL,
  "migrationRunId" TEXT NOT NULL,
  "sourceCallId" TEXT NOT NULL,
  "studentId" TEXT NOT NULL,
  "examId" TEXT,
  "category" TEXT NOT NULL DEFAULT '',
  "target" TEXT NOT NULL DEFAULT '',
  "phone" TEXT NOT NULL DEFAULT '',
  "status" TEXT NOT NULL DEFAULT '',
  "completed" BOOLEAN NOT NULL DEFAULT false,
  "completedAt" TIMESTAMP(3),
  "notes" TEXT NOT NULL DEFAULT '',
  "sourceCreatedAt" TIMESTAMP(3) NOT NULL,
  "backedUpAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "StudentCallHistoryBackup_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "StudentCallHistoryBackup_migrationRunId_sourceCallId_key"
  ON "StudentCallHistoryBackup"("migrationRunId", "sourceCallId");
CREATE INDEX IF NOT EXISTS "StudentCallHistoryMigrationRun_startedAt_idx"
  ON "StudentCallHistoryMigrationRun"("startedAt");
CREATE INDEX IF NOT EXISTS "StudentCallHistoryBackup_migrationRunId_idx"
  ON "StudentCallHistoryBackup"("migrationRunId");
CREATE INDEX IF NOT EXISTS "StudentCallHistoryBackup_studentId_examId_idx"
  ON "StudentCallHistoryBackup"("studentId", "examId");
CREATE INDEX IF NOT EXISTS "StudentCallHistoryBackup_sourceCallId_idx"
  ON "StudentCallHistoryBackup"("sourceCallId");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'StudentCallHistoryBackup_migrationRunId_fkey'
  ) THEN
    ALTER TABLE "StudentCallHistoryBackup"
      ADD CONSTRAINT "StudentCallHistoryBackup_migrationRunId_fkey"
      FOREIGN KEY ("migrationRunId")
      REFERENCES "StudentCallHistoryMigrationRun"("id")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;
