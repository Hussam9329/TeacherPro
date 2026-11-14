/**
 * Reads PostgreSQL details out of a Prisma error.
 *
 * With the `pg` driver adapter (engineType "client"), Prisma no longer puts the
 * PostgreSQL code in `meta.code` or the unique columns in `meta.target`; they
 * arrive under `meta.driverAdapterError.cause`. These helpers read both shapes,
 * so error handling does not depend on which engine produced the error.
 */
type DatabaseErrorLike = {
  code?: unknown;
  message?: unknown;
  meta?: {
    code?: unknown;
    target?: unknown;
    database_error?: unknown;
    driverAdapterError?: {
      cause?: {
        code?: unknown;
        originalCode?: unknown;
        originalMessage?: unknown;
        constraint?: { fields?: unknown; index?: unknown };
      };
    };
  };
};

function adapterCause(error: unknown) {
  return (error as DatabaseErrorLike | null | undefined)?.meta?.driverAdapterError?.cause;
}

/** The PostgreSQL SQLSTATE (e.g. "40001", "23P01"), or "" when unknown. */
export function databaseErrorCode(error: unknown): string {
  const meta = (error as DatabaseErrorLike | null | undefined)?.meta;
  const cause = adapterCause(error);
  return String(meta?.code ?? cause?.originalCode ?? cause?.code ?? "");
}

/** The error message together with the database's own message. */
export function databaseErrorMessage(error: unknown): string {
  const candidate = error as DatabaseErrorLike | null | undefined;
  return [candidate?.message, candidate?.meta?.database_error, adapterCause(error)?.originalMessage]
    .filter((part) => part !== undefined && part !== null && part !== "")
    .map(String)
    .join(" ");
}

/**
 * The columns or index of a violated unique constraint (P2002), comma-joined
 * without quotes, e.g. "phoneKey" or "Student_code_key"; "" when unknown.
 */
export function uniqueConstraintTarget(error: unknown): string {
  const target = (error as DatabaseErrorLike | null | undefined)?.meta?.target;
  const constraint = adapterCause(error)?.constraint;
  const value = target ?? constraint?.fields ?? constraint?.index;
  const parts = Array.isArray(value) ? value : value === undefined || value === null ? [] : [value];
  return parts.map((part) => String(part).replace(/"/g, "")).join(",");
}
