/**
 * Simple in-memory rate limiter for login brute-force protection.
 *
 * Vercel serverless functions may reuse module scope across invocations
 * on the same instance, so this is a best-effort per-instance limiter.
 * For stricter limits, consider Upstash Redis or Vercel KV with sliding
 * window algorithm — but for a small school admin tool this is enough.
 */

type AttemptRecord = {
  failures: number[]; // unix-ms timestamps of failures within the window
};

const WINDOW_MS = 5 * 60 * 1000; // 5 minutes
const MAX_FAILURES = 5; // 5 failed attempts within the window → block

const buckets = new Map<string, AttemptRecord>();

function pruneOldFailures(record: AttemptRecord, now: number): number[] {
  const cutoff = now - WINDOW_MS;
  record.failures = record.failures.filter((ts) => ts > cutoff);
  return record.failures;
}

export function checkLoginRateLimit(identifier: string): {
  allowed: boolean;
  retryAfterSeconds: number;
} {
  const now = Date.now();
  const key = identifier.toLowerCase();
  const record = buckets.get(key) || { failures: [] };
  pruneOldFailures(record, now);

  if (record.failures.length >= MAX_FAILURES) {
    const oldestRelevant = record.failures[0];
    const retryAfterMs = WINDOW_MS - (now - oldestRelevant);
    return {
      allowed: false,
      retryAfterSeconds: Math.max(1, Math.ceil(retryAfterMs / 1000)),
    };
  }

  return { allowed: true, retryAfterSeconds: 0 };
}

export function recordLoginFailure(identifier: string): void {
  const now = Date.now();
  const key = identifier.toLowerCase();
  const record = buckets.get(key) || { failures: [] };
  pruneOldFailures(record, now);
  record.failures.push(now);
  buckets.set(key, record);

  // Opportunistic GC: drop empty/expired buckets to keep memory bounded.
  if (buckets.size > 1000) {
    for (const [k, v] of buckets) {
      if (pruneOldFailures(v, now).length === 0) {
        buckets.delete(k);
      }
    }
  }
}

export function clearLoginFailures(identifier: string): void {
  buckets.delete(identifier.toLowerCase());
}
