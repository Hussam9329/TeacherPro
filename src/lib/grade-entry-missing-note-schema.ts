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
  `DELETE FROM "GradeEntryMissingNote" note WHERE NOT EXISTS (SELECT 1 FROM "Exam" exam WHERE exam."id" = note."examId")`,
  `DO $$
  BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'GradeEntryMissingNote_examId_fkey') THEN
      ALTER TABLE "GradeEntryMissingNote"
        ADD CONSTRAINT "GradeEntryMissingNote_examId_fkey"
        FOREIGN KEY ("examId") REFERENCES "Exam"("id")
        ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
  END $$`,
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
  'جدول ملاحظات الطلاب الغير موجودين غير جاهز بعد أو يحتاج تنظيف علاقات قديمة. سيُصلح تلقائياً عند أول محاولة استخدام.';
