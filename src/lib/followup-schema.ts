import { isMissingDatabaseObjectError } from "@/lib/route-helpers";
import { ensureAcademicSchema } from "@/lib/academic-schema";
import { runSerializedSchemaRepair } from "@/lib/schema-repair-lock";

const FOLLOWUP_SCHEMA_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS "StudentLeave" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "examId" TEXT,
    "leaveType" TEXT NOT NULL DEFAULT 'exam',
    "reason" TEXT NOT NULL,
    "studyType" TEXT NOT NULL DEFAULT '',
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dateFrom" TIMESTAMP(3),
    "dateTo" TIMESTAMP(3),
    "notes" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "StudentLeave_pkey" PRIMARY KEY ("id")
  )`,
  `CREATE TABLE IF NOT EXISTS "StudentCall" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "examId" TEXT,
    "category" TEXT NOT NULL DEFAULT '',
    "target" TEXT NOT NULL DEFAULT '',
    "phone" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT '',
    "completed" BOOLEAN NOT NULL DEFAULT false,
    "completedAt" TIMESTAMP(3),
    "notes" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "StudentCall_pkey" PRIMARY KEY ("id")
  )`,
  `CREATE TABLE IF NOT EXISTS "StudentNote" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT '',
    "text" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sourceType" TEXT NOT NULL DEFAULT '',
    "sourceId" TEXT NOT NULL DEFAULT '',
    "dismissalKey" TEXT NOT NULL DEFAULT '',
    "dismissalType" TEXT NOT NULL DEFAULT '',
    "dismissalReason" TEXT NOT NULL DEFAULT '',
    "dismissalDate" TIMESTAMP(3),
    CONSTRAINT "StudentNote_pkey" PRIMARY KEY ("id")
  )`,
  `CREATE TABLE IF NOT EXISTS "StudentLeaveGradeBackup" (
    "id" TEXT NOT NULL,
    "leaveId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "examId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "score" INTEGER,
    "notes" TEXT,
    "academicAccountingChecked" BOOLEAN NOT NULL DEFAULT false,
    "gradeCreatedAt" TIMESTAMP(3),
    "gradeUpdatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "StudentLeaveGradeBackup_pkey" PRIMARY KEY ("id")
  )`,
  `ALTER TABLE "StudentLeaveGradeBackup" ADD COLUMN IF NOT EXISTS "leaveId" TEXT`,
  `ALTER TABLE "StudentLeaveGradeBackup" ADD COLUMN IF NOT EXISTS "studentId" TEXT`,
  `ALTER TABLE "StudentLeaveGradeBackup" ADD COLUMN IF NOT EXISTS "examId" TEXT`,
  `ALTER TABLE "StudentLeaveGradeBackup" ADD COLUMN IF NOT EXISTS "status" TEXT NOT NULL DEFAULT 'درجة'`,
  `ALTER TABLE "StudentLeaveGradeBackup" ADD COLUMN IF NOT EXISTS "score" INTEGER`,
  `ALTER TABLE "StudentLeaveGradeBackup" ADD COLUMN IF NOT EXISTS "notes" TEXT`,
  `ALTER TABLE "StudentLeaveGradeBackup" ADD COLUMN IF NOT EXISTS "academicAccountingChecked" BOOLEAN NOT NULL DEFAULT false`,
  `ALTER TABLE "StudentLeaveGradeBackup" ADD COLUMN IF NOT EXISTS "gradeCreatedAt" TIMESTAMP(3)`,
  `ALTER TABLE "StudentLeaveGradeBackup" ADD COLUMN IF NOT EXISTS "gradeUpdatedAt" TIMESTAMP(3)`,
  `ALTER TABLE "StudentLeaveGradeBackup" ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP`,
  // Merge legacy duplicate exam leaves without losing their grade backups.
  `WITH ranked AS (
     SELECT "id",
            FIRST_VALUE("id") OVER (
              PARTITION BY "studentId", "examId"
              ORDER BY "createdAt" DESC, "id" DESC
            ) AS keep_id,
            ROW_NUMBER() OVER (
              PARTITION BY "studentId", "examId"
              ORDER BY "createdAt" DESC, "id" DESC
            ) AS rn
     FROM "StudentLeave"
     WHERE "examId" IS NOT NULL
   ), duplicate_map AS (
     SELECT "id" AS duplicate_id, keep_id FROM ranked WHERE rn > 1
   )
   DELETE FROM "StudentLeaveGradeBackup" duplicate_backup
   USING duplicate_map map, "StudentLeaveGradeBackup" kept_backup
   WHERE duplicate_backup."leaveId" = map.duplicate_id
     AND kept_backup."leaveId" = map.keep_id
     AND kept_backup."studentId" = duplicate_backup."studentId"
     AND kept_backup."examId" = duplicate_backup."examId"`,
  `WITH ranked AS (
     SELECT "id",
            FIRST_VALUE("id") OVER (
              PARTITION BY "studentId", "examId"
              ORDER BY "createdAt" DESC, "id" DESC
            ) AS keep_id,
            ROW_NUMBER() OVER (
              PARTITION BY "studentId", "examId"
              ORDER BY "createdAt" DESC, "id" DESC
            ) AS rn
     FROM "StudentLeave"
     WHERE "examId" IS NOT NULL
   ), duplicate_map AS (
     SELECT "id" AS duplicate_id, keep_id FROM ranked WHERE rn > 1
   )
   UPDATE "StudentLeaveGradeBackup" backup
   SET "leaveId" = map.keep_id
   FROM duplicate_map map
   WHERE backup."leaveId" = map.duplicate_id`,
  `WITH ranked AS (
     SELECT "id", ROW_NUMBER() OVER (
       PARTITION BY "leaveId", "studentId", "examId"
       ORDER BY "createdAt" DESC, "id" DESC
     ) AS rn
     FROM "StudentLeaveGradeBackup"
   )
   DELETE FROM "StudentLeaveGradeBackup" backup
   USING ranked
   WHERE backup."id" = ranked."id" AND ranked.rn > 1`,
  `WITH ranked AS (
     SELECT "id", ROW_NUMBER() OVER (
       PARTITION BY "studentId", "examId"
       ORDER BY "createdAt" DESC, "id" DESC
     ) AS rn
     FROM "StudentLeave"
     WHERE "examId" IS NOT NULL
   )
   DELETE FROM "StudentLeave" leave_row
   USING ranked
   WHERE leave_row."id" = ranked."id" AND ranked.rn > 1`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "StudentLeave_studentId_examId_key" ON "StudentLeave"("studentId", "examId")`,
  `CREATE INDEX IF NOT EXISTS "StudentLeave_studentId_idx" ON "StudentLeave"("studentId")`,
  `CREATE INDEX IF NOT EXISTS "StudentLeave_examId_idx" ON "StudentLeave"("examId")`,
  `CREATE INDEX IF NOT EXISTS "StudentLeave_date_idx" ON "StudentLeave"("date")`,
  `ALTER TABLE "StudentLeave" ADD COLUMN IF NOT EXISTS "leaveType" TEXT NOT NULL DEFAULT 'exam'`,
  `ALTER TABLE "StudentLeave" ADD COLUMN IF NOT EXISTS "dateFrom" TIMESTAMP(3)`,
  `ALTER TABLE "StudentLeave" ADD COLUMN IF NOT EXISTS "dateTo" TIMESTAMP(3)`,
  `ALTER TABLE "StudentLeave" ALTER COLUMN "examId" DROP NOT NULL`,
  `UPDATE "StudentLeave" SET "leaveType" = COALESCE(NULLIF("leaveType", ''), 'exam') WHERE "leaveType" IS NULL OR "leaveType" = ''`,
  `UPDATE "StudentLeave" SET "dateFrom" = "date" WHERE "dateFrom" IS NULL`,
  `UPDATE "StudentLeave" SET "dateTo" = "date" WHERE "dateTo" IS NULL`,
  `CREATE INDEX IF NOT EXISTS "StudentLeave_dateFrom_idx" ON "StudentLeave"("dateFrom")`,
  `CREATE INDEX IF NOT EXISTS "StudentLeave_dateTo_idx" ON "StudentLeave"("dateTo")`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "StudentLeaveGradeBackup_leaveId_studentId_examId_key" ON "StudentLeaveGradeBackup"("leaveId", "studentId", "examId")`,
  `CREATE INDEX IF NOT EXISTS "StudentLeaveGradeBackup_leaveId_idx" ON "StudentLeaveGradeBackup"("leaveId")`,
  `CREATE INDEX IF NOT EXISTS "StudentLeaveGradeBackup_studentId_examId_idx" ON "StudentLeaveGradeBackup"("studentId", "examId")`,
  `ALTER TABLE "StudentCall" ADD COLUMN IF NOT EXISTS "status" TEXT NOT NULL DEFAULT ''`,
  `ALTER TABLE "StudentCall" ALTER COLUMN "examId" DROP NOT NULL`,
  `UPDATE "StudentCall" SET "status" = CASE WHEN "completed" THEN 'تم الاتصال' ELSE 'لم يرد' END WHERE COALESCE("status", '') = ''`,
  `CREATE INDEX IF NOT EXISTS "StudentCall_studentId_idx" ON "StudentCall"("studentId")`,
  `CREATE INDEX IF NOT EXISTS "StudentCall_examId_idx" ON "StudentCall"("examId")`,
  `CREATE INDEX IF NOT EXISTS "StudentCall_createdAt_idx" ON "StudentCall"("createdAt")`,
  `ALTER TABLE "StudentNote" ADD COLUMN IF NOT EXISTS "sourceType" TEXT NOT NULL DEFAULT ''`,
  `ALTER TABLE "StudentNote" ADD COLUMN IF NOT EXISTS "sourceId" TEXT NOT NULL DEFAULT ''`,
  `ALTER TABLE "StudentNote" ADD COLUMN IF NOT EXISTS "dismissalKey" TEXT NOT NULL DEFAULT ''`,
  `ALTER TABLE "StudentNote" ADD COLUMN IF NOT EXISTS "dismissalType" TEXT NOT NULL DEFAULT ''`,
  `ALTER TABLE "StudentNote" ADD COLUMN IF NOT EXISTS "dismissalReason" TEXT NOT NULL DEFAULT ''`,
  `ALTER TABLE "StudentNote" ADD COLUMN IF NOT EXISTS "dismissalDate" TIMESTAMP(3)`,
  `CREATE INDEX IF NOT EXISTS "StudentNote_studentId_idx" ON "StudentNote"("studentId")`,
  `CREATE INDEX IF NOT EXISTS "StudentNote_date_idx" ON "StudentNote"("date")`,
  `CREATE INDEX IF NOT EXISTS "StudentNote_sourceType_idx" ON "StudentNote"("sourceType")`,
  `CREATE INDEX IF NOT EXISTS "StudentNote_sourceId_idx" ON "StudentNote"("sourceId")`,
  `CREATE INDEX IF NOT EXISTS "StudentNote_dismissalKey_idx" ON "StudentNote"("dismissalKey")`,
  `DELETE FROM "StudentLeaveGradeBackup" backup
    WHERE NOT EXISTS (SELECT 1 FROM "StudentLeave" leave WHERE leave."id" = backup."leaveId")
       OR NOT EXISTS (SELECT 1 FROM "Student" student WHERE student."id" = backup."studentId")
       OR NOT EXISTS (SELECT 1 FROM "Exam" exam WHERE exam."id" = backup."examId")`,
  `DO $$
  BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'StudentLeave_studentId_fkey') THEN
      ALTER TABLE "StudentLeave" ADD CONSTRAINT "StudentLeave_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE NOT VALID;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'StudentLeave_examId_fkey') THEN
      ALTER TABLE "StudentLeave" ADD CONSTRAINT "StudentLeave_examId_fkey" FOREIGN KEY ("examId") REFERENCES "Exam"("id") ON DELETE CASCADE ON UPDATE CASCADE NOT VALID;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'StudentCall_studentId_fkey') THEN
      ALTER TABLE "StudentCall" ADD CONSTRAINT "StudentCall_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE NOT VALID;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'StudentCall_examId_fkey') THEN
      ALTER TABLE "StudentCall" ADD CONSTRAINT "StudentCall_examId_fkey" FOREIGN KEY ("examId") REFERENCES "Exam"("id") ON DELETE CASCADE ON UPDATE CASCADE NOT VALID;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'StudentNote_studentId_fkey') THEN
      ALTER TABLE "StudentNote" ADD CONSTRAINT "StudentNote_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE NOT VALID;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'StudentLeaveGradeBackup_leaveId_fkey') THEN
      ALTER TABLE "StudentLeaveGradeBackup" ADD CONSTRAINT "StudentLeaveGradeBackup_leaveId_fkey" FOREIGN KEY ("leaveId") REFERENCES "StudentLeave"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'StudentLeaveGradeBackup_studentId_fkey') THEN
      ALTER TABLE "StudentLeaveGradeBackup" ADD CONSTRAINT "StudentLeaveGradeBackup_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'StudentLeaveGradeBackup_examId_fkey') THEN
      ALTER TABLE "StudentLeaveGradeBackup" ADD CONSTRAINT "StudentLeaveGradeBackup_examId_fkey" FOREIGN KEY ("examId") REFERENCES "Exam"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
  END $$`,
] as const;

let ensureFollowupTablesPromise: Promise<void> | null = null;

/**
 * Creates the follow-up tables on existing production databases that were created
 * before Prisma migrations were introduced. This keeps Vercel builds safe while
 * allowing the app to self-heal the missing tables on first use.
 */
export async function ensureFollowupTables(): Promise<void> {
  if (!ensureFollowupTablesPromise) {
    ensureFollowupTablesPromise = (async () => {
      await ensureAcademicSchema();
      await runSerializedSchemaRepair(FOLLOWUP_SCHEMA_STATEMENTS);
    })().catch((error) => {
      ensureFollowupTablesPromise = null;
      throw error;
    });
  }

  await ensureFollowupTablesPromise;
}

export async function withFollowupTables<T>(
  operation: () => Promise<T>,
  label: string,
): Promise<T> {
  try {
    await ensureFollowupTables();
    return await operation();
  } catch (error) {
    if (!isMissingDatabaseObjectError(error)) throw error;

    console.warn(
      `[API] ${label} table/column is unavailable. Creating follow-up tables and retrying.`,
      error,
    );
    await ensureFollowupTables();
    return operation();
  }
}
