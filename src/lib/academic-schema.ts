import { runSerializedSchemaRepair } from "@/lib/schema-repair-lock";

const ACADEMIC_SCHEMA_STATEMENTS = [
  `ALTER TABLE "Student" ADD COLUMN IF NOT EXISTS "nameKey" TEXT`,
  `ALTER TABLE "Student" ADD COLUMN IF NOT EXISTS "phoneKey" TEXT`,
  `ALTER TABLE "Student" ADD COLUMN IF NOT EXISTS "telegramKey" TEXT`,
  `ALTER TABLE "Student" ADD COLUMN IF NOT EXISTS "baseOpportunities" INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE "Student" ADD COLUMN IF NOT EXISTS "accountingGraceDays" INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE "Student" ADD COLUMN IF NOT EXISTS "gracePeriodStartDate" TIMESTAMP(3)`,
  `ALTER TABLE "CourseChapter" ADD COLUMN IF NOT EXISTS "archived" BOOLEAN NOT NULL DEFAULT false`,
  `ALTER TABLE "CourseChapter" ADD COLUMN IF NOT EXISTS "archive" TEXT NOT NULL DEFAULT '[]'`,
  `ALTER TABLE "Grade" ADD COLUMN IF NOT EXISTS "academicAccountingChecked" BOOLEAN NOT NULL DEFAULT false`,
  `ALTER TABLE "OpportunityLog" ADD COLUMN IF NOT EXISTS "chapterNameSnapshot" TEXT`,
  // A partially prepared database may already contain duplicated derived keys.
  // Keep the oldest canonical owner and clear only the derived key on the rest;
  // no student record or user-entered value is deleted.
  `WITH ranked AS (
     SELECT "id", ROW_NUMBER() OVER (PARTITION BY "nameKey" ORDER BY "createdAt", "id") AS rn
     FROM "Student" WHERE "nameKey" IS NOT NULL AND "nameKey" <> ''
   )
   UPDATE "Student" student SET "nameKey" = NULL
   FROM ranked WHERE student."id" = ranked."id" AND ranked.rn > 1`,
  `WITH ranked AS (
     SELECT "id", ROW_NUMBER() OVER (PARTITION BY "phoneKey" ORDER BY "createdAt", "id") AS rn
     FROM "Student" WHERE "phoneKey" IS NOT NULL AND "phoneKey" <> ''
   )
   UPDATE "Student" student SET "phoneKey" = NULL
   FROM ranked WHERE student."id" = ranked."id" AND ranked.rn > 1`,
  `WITH ranked AS (
     SELECT "id", ROW_NUMBER() OVER (PARTITION BY "telegramKey" ORDER BY "createdAt", "id") AS rn
     FROM "Student" WHERE "telegramKey" IS NOT NULL AND "telegramKey" <> ''
   )
   UPDATE "Student" student SET "telegramKey" = NULL
   FROM ranked WHERE student."id" = ranked."id" AND ranked.rn > 1`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "Student_nameKey_key" ON "Student"("nameKey")`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "Student_phoneKey_key" ON "Student"("phoneKey")`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "Student_telegramKey_key" ON "Student"("telegramKey")`,

  // ---------------------------------------------------------------------------
  // ROOT-CAUSE FIX: Grade status ↔ score consistency safety net.
  // ---------------------------------------------------------------------------
  // Even though the CHECK constraint `Grade_status_score_consistency`
  // (added by migration 20260712143000) already rejects contradictory rows
  // (status != 'درجة' AND score IS NOT NULL), and the application layer
  // also validates via `assertGradeStatusScoreConsistency`, this trigger is
  // the FINAL defense. It silently coerces score = NULL whenever a non-'درجة'
  // status is persisted, so a buggy caller or a hand-written SQL UPDATE can
  // never produce the contradiction. The CHECK constraint never even fires
  // for this case because the trigger runs BEFORE the constraint check.
  //
  // The first statement is a one-time cleanup of any legacy contradictory
  // rows that pre-date the CHECK constraint. It is idempotent.
  `UPDATE "Grade"
   SET "score" = NULL
   WHERE "status" IS DISTINCT FROM 'درجة'
     AND "score" IS NOT NULL`,

  `CREATE OR REPLACE FUNCTION "enforce_grade_status_score_consistency"()
   RETURNS trigger
   LANGUAGE plpgsql
   AS $$
   BEGIN
     IF NEW."status" IS NULL THEN
       RAISE EXCEPTION 'Grade.status cannot be NULL';
     END IF;
     NEW."status" := btrim(NEW."status");
     IF NEW."status" <> 'درجة' AND NEW."score" IS NOT NULL THEN
       NEW."score" := NULL;
     END IF;
     RETURN NEW;
   END;
   $$`,

  `DROP TRIGGER IF EXISTS "Grade_enforce_status_score_consistency" ON "Grade"`,

  `CREATE TRIGGER "Grade_enforce_status_score_consistency"
   BEFORE INSERT OR UPDATE OF "status", "score" ON "Grade"
   FOR EACH ROW
   EXECUTE FUNCTION "enforce_grade_status_score_consistency"()`,
] as const;

let ensurePromise: Promise<void> | null = null;

export async function ensureAcademicSchema(): Promise<void> {
  if (!ensurePromise) {
    ensurePromise = runSerializedSchemaRepair(ACADEMIC_SCHEMA_STATEMENTS).catch(
      (error) => {
        ensurePromise = null;
        throw error;
      },
    );
  }
  await ensurePromise;
}
