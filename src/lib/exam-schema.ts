import { isMissingDatabaseObjectError } from '@/lib/route-helpers';
import { ensureExamCourseLinksSchema } from '@/lib/exam-course-links';
import { ensureAcademicSchema } from '@/lib/academic-schema';
import { runSerializedSchemaRepair } from '@/lib/schema-repair-lock';

const EXAM_SCHEMA_STATEMENTS = [
  `ALTER TABLE "Exam" ADD COLUMN IF NOT EXISTS "noDiscount" BOOLEAN NOT NULL DEFAULT false`,
  `ALTER TABLE "Exam" ADD COLUMN IF NOT EXISTS "scheduledActivateAt" TIMESTAMP(3)`,
  `ALTER TABLE "Exam" ADD COLUMN IF NOT EXISTS "scheduledDeactivateAt" TIMESTAMP(3)`,
] as const;

let ensureExamSchemaPromise: Promise<void> | null = null;

/**
 * Keeps production databases that missed the latest Prisma migration usable.
 * These fields are read by Prisma in grade validation and academic
 * recalculation. Keeping all Exam compatibility columns here lets an older
 * production database recover before the first Prisma query touches them.
 */
export async function ensureExamSchema(): Promise<void> {
  if (!ensureExamSchemaPromise) {
    ensureExamSchemaPromise = (async () => {
      await ensureAcademicSchema();
      await runSerializedSchemaRepair(EXAM_SCHEMA_STATEMENTS);
      await ensureExamCourseLinksSchema();
    })().catch((error) => {
      ensureExamSchemaPromise = null;
      throw error;
    });
  }

  await ensureExamSchemaPromise;
}

export async function withExamSchema<T>(operation: () => Promise<T>, label: string): Promise<T> {
  try {
    await ensureExamSchema();
    return await operation();
  } catch (error) {
    if (!isMissingDatabaseObjectError(error)) throw error;

    console.warn(`[API] ${label} exam schema is out of date. Updating Exam columns and retrying.`, error);
    await ensureExamSchema();
    return operation();
  }
}
