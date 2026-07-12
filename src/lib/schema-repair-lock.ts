import { db } from "@/lib/db";

const SCHEMA_REPAIR_LOCK_ID = 724_202_607_12;

/**
 * Serializes compatibility DDL across all serverless functions. Separate Vercel
 * instances do not share JavaScript promises, so an in-process guard alone
 * cannot prevent concurrent ALTER TABLE / ADD CONSTRAINT races.
 */
export async function runSerializedSchemaRepair(
  statements: readonly string[],
): Promise<void> {
  await db.$transaction(
    async (tx) => {
      await tx.$queryRawUnsafe(
        `SELECT pg_advisory_xact_lock(${SCHEMA_REPAIR_LOCK_ID})`,
      );
      for (const statement of statements) {
        await tx.$executeRawUnsafe(statement);
      }
    },
    { maxWait: 30_000, timeout: 45_000 },
  );
}
