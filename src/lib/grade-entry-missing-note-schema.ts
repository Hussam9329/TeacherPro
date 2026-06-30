import { db } from '@/lib/db';
import { isMissingDatabaseObjectError } from '@/lib/route-helpers';

const STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS "GradeEntryMissingNote" (
    "id" TEXT NOT NULL,
    "examId" TEXT NOT NULL,
    "examName" TEXT NOT NULL DEFAULT '',
    "examDate" TEXT NOT NULL DEFAULT '',
    "text" TEXT NOT NULL,
    "userId" TEXT,
    "userName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "GradeEntryMissingNote_pkey" PRIMARY KEY ("id")
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "GradeEntryMissingNote_examId_key" ON "GradeEntryMissingNote"("examId")`,
  `CREATE INDEX IF NOT EXISTS "GradeEntryMissingNote_updatedAt_idx" ON "GradeEntryMissingNote"("updatedAt")`,
] as const;

let ensurePromise: Promise<void> | null = null;

export async function ensureGradeEntryMissingNoteSchema(): Promise<void> {
  if (!ensurePromise) {
    ensurePromise = (async () => {
      for (const stmt of STATEMENTS) {
        await db.$executeRawUnsafe(stmt);
      }
    })().catch((error) => {
      ensurePromise = null;
      throw error;
    });
  }
  await ensurePromise;
}

export async function withGradeEntryMissingNoteSchema<T>(
  operation: () => Promise<T>,
): Promise<T> {
  try {
    await ensureGradeEntryMissingNoteSchema();
    return await operation();
  } catch (error) {
    if (!isMissingDatabaseObjectError(error)) throw error;
    ensurePromise = null;
    await ensureGradeEntryMissingNoteSchema();
    return operation();
  }
}

export const gradeEntryMissingNoteSchemaMessage =
  'جدول ملاحظات الطلاب الغير موجودين غير جاهز بعد. سيُنشأ تلقائياً عند أول محاولة حفظ.';
