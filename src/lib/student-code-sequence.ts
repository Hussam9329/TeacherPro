import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";

const STUDENT_CODE_SEQUENCE = '"Student_code_seq"';
const STUDENT_CODE_LOCK_KEY = "teacherpro:student-code-sequence:v1";

type SequenceGlobal = typeof globalThis & {
  teacherProStudentCodeSequenceReady?: Promise<void>;
};

const sequenceGlobal = globalThis as SequenceGlobal;

function normalizeCount(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.min(1000, Math.max(1, Math.trunc(value)));
}

function formatStudentCode(value: bigint | number | string): string {
  const numeric = BigInt(value);
  return `BIO-${numeric.toString().padStart(3, "0")}`;
}

async function synchronizeStudentCodeSequence(): Promise<void> {
  await db.$transaction(async (tx) => {
    // The database lock makes initialization/catch-up safe across all running
    // app instances, not only inside the current Node.js process.
    await tx.$executeRawUnsafe(
      `SELECT pg_advisory_xact_lock(hashtext('${STUDENT_CODE_LOCK_KEY}'))`,
    );
    await tx.$executeRawUnsafe(
      `CREATE SEQUENCE IF NOT EXISTS ${STUDENT_CODE_SEQUENCE} AS BIGINT START WITH 1 INCREMENT BY 1 MINVALUE 1`,
    );

    const [maxRow] = await tx.$queryRaw<
      Array<{ maxCode: bigint | number | string | null }>
    >`
      SELECT COALESCE(
        MAX((substring("code" from '^BIO-([0-9]+)$'))::bigint),
        0
      ) AS "maxCode"
      FROM "Student"
      WHERE "code" ~ '^BIO-[0-9]+$'
    `;
    const [sequenceRow] = await tx.$queryRawUnsafe<
      Array<{ last_value: bigint | number | string; is_called: boolean }>
    >(`SELECT last_value, is_called FROM ${STUDENT_CODE_SEQUENCE}`);

    const maxCode = BigInt(maxRow?.maxCode ?? 0);
    const lastValue = BigInt(sequenceRow?.last_value ?? 1);
    const currentNextValue = sequenceRow?.is_called
      ? lastValue + BigInt(1)
      : lastValue;
    const requiredNextValue = maxCode + BigInt(1);

    if (requiredNextValue > currentNextValue) {
      await tx.$queryRaw<Array<{ value: bigint }>>`
        SELECT setval('"Student_code_seq"', ${requiredNextValue}, false) AS value
      `;
    }
  });
}

/**
 * Prepare/catch up the sequence once per app instance. The migration remains
 * the primary setup path; this guarded fallback prevents registration outages
 * on deployments that start the app before running migrations.
 */
export async function ensureStudentCodeSequenceReady(
  forceResync = false,
): Promise<void> {
  if (forceResync)
    sequenceGlobal.teacherProStudentCodeSequenceReady = undefined;
  if (!sequenceGlobal.teacherProStudentCodeSequenceReady) {
    sequenceGlobal.teacherProStudentCodeSequenceReady =
      synchronizeStudentCodeSequence().catch((error) => {
        sequenceGlobal.teacherProStudentCodeSequenceReady = undefined;
        throw error;
      });
  }
  await sequenceGlobal.teacherProStudentCodeSequenceReady;
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
 * A sequence collision is only possible when legacy/manual data was inserted
 * without advancing the sequence. Catch up to the real maximum and retry the
 * complete transaction; all other uniqueness errors are returned normally.
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
      await ensureStudentCodeSequenceReady(true);
    }
  }
  throw lastError;
}
