import { db } from "@/lib/db";

export const telegramSubmissionSchemaMessage =
  "جدول مستلمات بوت تيليجرام غير جاهز بعد. حاولت TeacherPro تجهيزه تلقائياً؛ إذا بقي التحذير ظاهراً شغّل prisma migrate deploy أو امنح مستخدم بيانات النظام صلاحية إنشاء الجداول.";

type EnsureResult = { ok: true } | { ok: false; error: unknown };

let ensurePromise: Promise<EnsureResult> | null = null;

async function execute(statement: string) {
  await db.$executeRawUnsafe(statement);
}

async function ensureTelegramSubmissionSchemaNow(): Promise<EnsureResult> {
  try {
    await execute(`
      CREATE TABLE IF NOT EXISTS "TelegramExamSubmission" (
        "id" TEXT NOT NULL,
        "studentId" TEXT NOT NULL,
        "examId" TEXT NOT NULL,
        "gradeId" TEXT,
        "telegramUserId" TEXT NOT NULL DEFAULT '',
        "telegramUsername" TEXT NOT NULL DEFAULT '',
        "telegramChatId" TEXT NOT NULL DEFAULT '',
        "matchType" TEXT NOT NULL DEFAULT 'manual_review',
        "matchSource" TEXT NOT NULL DEFAULT '',
        "matchDetails" TEXT NOT NULL DEFAULT '',
        "sourceMessageIds" TEXT NOT NULL DEFAULT '[]',
        "pages" TEXT NOT NULL DEFAULT '[]',
        "pageCount" INTEGER NOT NULL DEFAULT 0,
        "status" TEXT NOT NULL DEFAULT 'بانتظار التصحيح',
        "notes" TEXT NOT NULL DEFAULT '',
        "submittedAt" TIMESTAMP(3),
        "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await execute(
      `ALTER TABLE "TelegramExamSubmission" ADD COLUMN IF NOT EXISTS "id" TEXT;`,
    );
    await execute(
      `ALTER TABLE "TelegramExamSubmission" ADD COLUMN IF NOT EXISTS "studentId" TEXT;`,
    );
    await execute(
      `ALTER TABLE "TelegramExamSubmission" ADD COLUMN IF NOT EXISTS "examId" TEXT;`,
    );
    await execute(
      `ALTER TABLE "TelegramExamSubmission" ADD COLUMN IF NOT EXISTS "gradeId" TEXT;`,
    );
    await execute(
      `ALTER TABLE "TelegramExamSubmission" ADD COLUMN IF NOT EXISTS "telegramUserId" TEXT NOT NULL DEFAULT '';`,
    );
    await execute(
      `ALTER TABLE "TelegramExamSubmission" ADD COLUMN IF NOT EXISTS "telegramUsername" TEXT NOT NULL DEFAULT '';`,
    );
    await execute(
      `ALTER TABLE "TelegramExamSubmission" ADD COLUMN IF NOT EXISTS "telegramChatId" TEXT NOT NULL DEFAULT '';`,
    );
    await execute(
      `ALTER TABLE "TelegramExamSubmission" ADD COLUMN IF NOT EXISTS "matchType" TEXT NOT NULL DEFAULT 'manual_review';`,
    );
    await execute(
      `ALTER TABLE "TelegramExamSubmission" ADD COLUMN IF NOT EXISTS "matchSource" TEXT NOT NULL DEFAULT '';`,
    );
    await execute(
      `ALTER TABLE "TelegramExamSubmission" ADD COLUMN IF NOT EXISTS "matchDetails" TEXT NOT NULL DEFAULT '';`,
    );
    await execute(
      `ALTER TABLE "TelegramExamSubmission" ADD COLUMN IF NOT EXISTS "sourceMessageIds" TEXT NOT NULL DEFAULT '[]';`,
    );
    await execute(
      `ALTER TABLE "TelegramExamSubmission" ADD COLUMN IF NOT EXISTS "pages" TEXT NOT NULL DEFAULT '[]';`,
    );
    await execute(
      `ALTER TABLE "TelegramExamSubmission" ADD COLUMN IF NOT EXISTS "pageCount" INTEGER NOT NULL DEFAULT 0;`,
    );
    await execute(
      `ALTER TABLE "TelegramExamSubmission" ADD COLUMN IF NOT EXISTS "status" TEXT NOT NULL DEFAULT 'بانتظار التصحيح';`,
    );
    await execute(
      `ALTER TABLE "TelegramExamSubmission" ADD COLUMN IF NOT EXISTS "notes" TEXT NOT NULL DEFAULT '';`,
    );
    await execute(
      `ALTER TABLE "TelegramExamSubmission" ADD COLUMN IF NOT EXISTS "submittedAt" TIMESTAMP(3);`,
    );
    await execute(
      `ALTER TABLE "TelegramExamSubmission" ADD COLUMN IF NOT EXISTS "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;`,
    );
    await execute(
      `ALTER TABLE "TelegramExamSubmission" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;`,
    );

    await execute(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'TelegramExamSubmission_pkey'
        ) THEN
          ALTER TABLE "TelegramExamSubmission"
            ADD CONSTRAINT "TelegramExamSubmission_pkey" PRIMARY KEY ("id");
        END IF;
      END $$;
    `);

    await execute(
      `CREATE UNIQUE INDEX IF NOT EXISTS "TelegramExamSubmission_studentId_examId_key" ON "TelegramExamSubmission"("studentId", "examId");`,
    );
    await execute(
      `CREATE INDEX IF NOT EXISTS "TelegramExamSubmission_examId_idx" ON "TelegramExamSubmission"("examId");`,
    );
    await execute(
      `CREATE INDEX IF NOT EXISTS "TelegramExamSubmission_studentId_idx" ON "TelegramExamSubmission"("studentId");`,
    );
    await execute(
      `CREATE INDEX IF NOT EXISTS "TelegramExamSubmission_status_idx" ON "TelegramExamSubmission"("status");`,
    );
    await execute(
      `CREATE INDEX IF NOT EXISTS "TelegramExamSubmission_receivedAt_idx" ON "TelegramExamSubmission"("receivedAt");`,
    );

    await execute(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'TelegramExamSubmission_studentId_fkey'
        ) THEN
          ALTER TABLE "TelegramExamSubmission"
            ADD CONSTRAINT "TelegramExamSubmission_studentId_fkey"
            FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;
        END IF;
      END $$;
    `);

    await execute(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'TelegramExamSubmission_examId_fkey'
        ) THEN
          ALTER TABLE "TelegramExamSubmission"
            ADD CONSTRAINT "TelegramExamSubmission_examId_fkey"
            FOREIGN KEY ("examId") REFERENCES "Exam"("id") ON DELETE CASCADE ON UPDATE CASCADE;
        END IF;
      END $$;
    `);

    return { ok: true };
  } catch (error) {
    console.warn(
      "[telegram-submissions] Failed to ensure TelegramExamSubmission schema.",
      error,
    );
    return { ok: false, error };
  }
}

export function ensureTelegramSubmissionSchema(): Promise<EnsureResult> {
  if (!ensurePromise) ensurePromise = ensureTelegramSubmissionSchemaNow();
  return ensurePromise;
}

export function resetTelegramSubmissionSchemaEnsureCache() {
  ensurePromise = null;
}
