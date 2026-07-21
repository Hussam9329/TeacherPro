const REPLAY_SAFE_POST_ENDPOINTS = new Set([
  "/api/grades",
  "/api/grades/mark-missing-absent",
  "/api/student-calls",
  "/api/correction-sheets",
  "/api/students/academic-repair",
  "/api/logs/clear",
]);

function endpointPath(endpoint: string): string {
  const raw = String(endpoint || "").trim();
  const withoutQuery = raw.split("?", 1)[0];
  return withoutQuery.startsWith("/") ? withoutQuery : `/api/${withoutQuery}`;
}

/**
 * POST requests are replayed only when their server operation is an upsert or
 * otherwise idempotent. Replaying an uncertain create/bulk action can duplicate
 * rows after the first response is lost even though its transaction committed.
 */
export function mutationCanBeReplayed(
  endpoint: string,
  method: "POST" | "PUT" | "DELETE",
  payload?: unknown,
): boolean {
  if (method === "DELETE") return false;
  const record = payload && typeof payload === "object"
    ? payload as Record<string, unknown>
    : {};
  const hasGuard = [
    "previewToken",
    "academicImpactPreviewToken",
    "activationPreviewToken",
    "expectedMutationToken",
    "expectedUpdatedAt",
    "expectMissing",
  ].some((key) => record[key] !== undefined && record[key] !== "");
  if (hasGuard) return false;
  if (method === "PUT") return true;
  return REPLAY_SAFE_POST_ENDPOINTS.has(endpointPath(endpoint));
}
