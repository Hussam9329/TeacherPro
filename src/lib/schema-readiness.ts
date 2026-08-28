import { Prisma } from '@prisma/client';

import { db } from '@/lib/db';
import {
  DATABASE_MIGRATION_REQUIRED_CODE,
  isMissingDatabaseObjectError,
} from '@/lib/route-helpers';

/**
 * The last migration whose successful completion guarantees every table and
 * column used by the application. Keep this in sync with the newest migration.
 */
export const REQUIRED_DATABASE_MIGRATION =
  '20260828010000_unify_dismissal_and_zero_balance';

const SCHEMA_NOT_READY_MESSAGE =
  'نسخة قاعدة البيانات أقدم من نسخة النظام. يلزم مسؤول النظام تطبيق تحديثات قاعدة البيانات قبل إعادة المحاولة.';

export class DatabaseMigrationRequiredError extends Error {
  readonly code = DATABASE_MIGRATION_REQUIRED_CODE;

  constructor(message = SCHEMA_NOT_READY_MESSAGE, options?: ErrorOptions) {
    super(message, options);
    this.name = 'DatabaseMigrationRequiredError';
  }
}

type MigrationReadinessRow = {
  ready: boolean;
};

let readinessPromise: Promise<void> | null = null;

async function verifyRequiredMigration(): Promise<void> {
  try {
    const rows = await db.$queryRaw<MigrationReadinessRow[]>(Prisma.sql`
      SELECT EXISTS (
        SELECT 1
        FROM "_prisma_migrations"
        WHERE "migration_name" = ${REQUIRED_DATABASE_MIGRATION}
          AND "finished_at" IS NOT NULL
          AND "rolled_back_at" IS NULL
      ) AS "ready"
    `);

    if (rows[0]?.ready !== true) {
      throw new DatabaseMigrationRequiredError();
    }
  } catch (error) {
    if (error instanceof DatabaseMigrationRequiredError) throw error;
    throw new DatabaseMigrationRequiredError(SCHEMA_NOT_READY_MESSAGE, {
      cause: error,
    });
  }
}

/**
 * Read-only runtime guard. It never creates, alters, cleans, or retries schema
 * objects. A successful check is cached for the lifetime of the server process.
 */
export async function assertDatabaseSchemaReady(): Promise<void> {
  if (!readinessPromise) {
    readinessPromise = verifyRequiredMigration().catch((error) => {
      readinessPromise = null;
      throw error;
    });
  }

  await readinessPromise;
}

export async function withDatabaseSchema<T>(
  operation: () => Promise<T>,
  context = 'database operation',
): Promise<T> {
  await assertDatabaseSchemaReady();
  try {
    return await operation();
  } catch (error) {
    if (!isMissingDatabaseObjectError(error)) throw error;
    console.error(
      `[Database schema] Missing object while running ${context}.`,
      error,
    );
    throw new DatabaseMigrationRequiredError(
      SCHEMA_NOT_READY_MESSAGE,
      { cause: error },
    );
  }
}
