import { db } from '@/lib/db';
import { isMissingDatabaseObjectError } from '@/lib/route-helpers';
import { ensureExamCourseLinksSchema } from '@/lib/exam-course-links';

const EXAM_SCHEMA_STATEMENTS = [
  `ALTER TABLE "Exam" ADD COLUMN IF NOT EXISTS "noDiscount" BOOLEAN NOT NULL DEFAULT false`,
] as const;

let ensureExamSchemaPromise: Promise<void> | null = null;

/**
 * Keeps production databases that missed the latest Prisma migration usable.
 * The noDiscount field is read by Prisma whenever an Exam is selected, so a
 * missing column breaks /api/exams, /api/backup, and any relation including Exam.
 */
export async function ensureExamSchema(): Promise<void> {
  if (!ensureExamSchemaPromise) {
    ensureExamSchemaPromise = (async () => {
      for (const statement of EXAM_SCHEMA_STATEMENTS) {
        await db.$executeRawUnsafe(statement);
      }
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
