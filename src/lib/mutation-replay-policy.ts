const REPLAY_SAFE_POST_ENDPOINTS = new Set([
  "/api/grades",
  "/api/grades/mark-missing-absent",
  "/api/student-calls",
  "/api/correction-sheets",
]);

const NON_REPLAYABLE_MAINTENANCE_ENDPOINTS = new Set([
  "/api/students/academic-repair",
  "/api/students/fix-zero-opportunities",
  "/api/students/clamp-opportunities",
  "/api/course-chapters/second-chapter-transition",
  "/api/logs/clear",
]);

function endpointPath(endpoint: string): string {
  const raw = String(endpoint || "").trim();
  const withoutQuery = raw.split("?", 1)[0];
  return withoutQuery.startsWith("/") ? withoutQuery : `/api/${withoutQuery}`;
}

export function isMaintenanceRepairEndpoint(endpoint: string): boolean {
  return NON_REPLAYABLE_MAINTENANCE_ENDPOINTS.has(endpointPath(endpoint));
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
  if (isMaintenanceRepairEndpoint(endpoint)) return false;
  if (method === "DELETE") return false;
  const record = payload && typeof payload === "object"
    ? payload as Record<string, unknown>
    : {};
  if (method === "POST" && record.previewOnly === true) return true;
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
