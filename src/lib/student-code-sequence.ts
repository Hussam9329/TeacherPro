import type { Prisma } from "@prisma/client";

function normalizeCount(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.min(1000, Math.max(1, Math.trunc(value)));
}

function formatStudentCode(value: bigint | number | string): string {
  const numeric = BigInt(value);
  return `BIO-${numeric.toString().padStart(3, "0")}`;
}

/**
 * Allocate one or more globally unique student codes from PostgreSQL.
 * PostgreSQL sequences are atomic across requests and app instances, and are
 * intentionally not rolled back: a failed registration can leave a harmless
 * gap, but two requests can never receive the same sequence value.
 */
export async function allocateStudentCodes(
  tx: Prisma.TransactionClient,
  requestedCount = 1,
): Promise<string[]> {
  const count = normalizeCount(requestedCount);
  const rows = await tx.$queryRaw<
    Array<{ position: number; value: bigint | number | string }>
  >`
    SELECT series AS position, nextval('"Student_code_seq"') AS value
    FROM generate_series(1, ${count}) AS series
    ORDER BY series
  `;

  return rows.map((row) => formatStudentCode(row.value));
}

export function isStudentCodeUniqueConflict(error: unknown): boolean {
  const prismaError = error as { code?: string; meta?: { target?: unknown } };
  if (prismaError?.code !== "P2002") return false;
  const targetValue = prismaError.meta?.target;
  const target = Array.isArray(targetValue)
    ? targetValue.join(",")
    : String(targetValue ?? "");
  return (
    /(^|[,._-])code($|[,._-])/i.test(target) || /Student_code/i.test(target)
  );
}

/**
 * A sequence collision is only possible when legacy/manual data bypassed the
 * application. Advancing to the next sequence value is safe, but schema repair
 * and sequence reconciliation remain migration-only responsibilities.
 */
export async function retryStudentCodeConflict<T>(
  operation: () => Promise<T>,
  maxAttempts = 5,
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (!isStudentCodeUniqueConflict(error) || attempt === maxAttempts) {
        throw error;
      }
      // The failed transaction already consumed a sequence value. Retrying the
      // complete transaction advances to the next value without runtime DDL.
    }
  }
  throw lastError;
}
