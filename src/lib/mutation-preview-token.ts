import { createHash } from "node:crypto";

function canonicalize(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return Object.keys(record)
      .sort()
      .reduce<Record<string, unknown>>((result, key) => {
        if (record[key] !== undefined) result[key] = canonicalize(record[key]);
        return result;
      }, {});
  }
  if (typeof value === "number" && !Number.isFinite(value)) return null;
  return value;
}

/**
 * Builds an opaque fingerprint for a preview and every database value that
 * influenced it. The server always rebuilds the same fingerprint inside the
 * write transaction; a changed snapshot is therefore rejected before writes.
 */
export function buildMutationPreviewToken(
  scope: string,
  snapshot: unknown,
): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        version: 1,
        scope,
        snapshot: canonicalize(snapshot),
      }),
    )
    .digest("hex");
}
