import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { databaseErrorCode, databaseErrorMessage } from "@/lib/database-error";

function isRetryableTransactionConflict(error: unknown): boolean {
  const candidate = error as { code?: string } | null | undefined;
  const databaseCode = databaseErrorCode(error);
  const message = databaseErrorMessage(error);
  return (
    candidate?.code === "P2034" ||
    databaseCode === "40001" ||
    databaseCode === "40P01" ||
    /serialization failure|deadlock detected/i.test(message)
  );
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

/**
 * Execute a database mutation at PostgreSQL SERIALIZABLE isolation and retry
 * only serialization/deadlock conflicts. This makes previewed bulk effects
 * safe against concurrent registrations, transfers, and chapter changes.
 */
export async function withSerializableTransaction<T>(
  operation: (tx: Prisma.TransactionClient) => Promise<T>,
  maxAttempts = 5,
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await db.$transaction(operation, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        maxWait: 10_000,
        timeout: 120_000,
      });
    } catch (error) {
      lastError = error;
      if (!isRetryableTransactionConflict(error) || attempt === maxAttempts) {
        throw error;
      }
      await delay(Math.min(100, attempt * 20));
    }
  }
  throw lastError;
}
