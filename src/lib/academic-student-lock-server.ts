import type { Prisma } from "@prisma/client";

function uniqueSortedIds(values: Array<string | null | undefined>): string[] {
  return Array.from(
    new Set(values.map((value) => String(value || "").trim()).filter(Boolean)),
  ).sort();
}

/**
 * Serialize all academic mutations for a student inside the current PostgreSQL
 * transaction. Sorting prevents deadlocks when a bulk operation locks multiple
 * students at once.
 */
export async function lockStudentsAcademicState(
  tx: Prisma.TransactionClient,
  rawStudentIds: Array<string | null | undefined>,
): Promise<string[]> {
  const studentIds = uniqueSortedIds(rawStudentIds);
  for (const studentId of studentIds) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${studentId}))`;
  }
  return studentIds;
}
