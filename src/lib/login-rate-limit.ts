import { createHash } from 'node:crypto';
import { db } from '@/lib/db';
const WINDOW_SECONDS = 900;
const MAX_ATTEMPTS = 5;
function bucketKey(identifier: string): string {
  return createHash('sha256').update(identifier.toLowerCase()).digest('hex');
}
/** Reserve an attempt atomically BEFORE password verification across instances.
 * Database failure fails the login closed; there is no per-instance bypass.
 */
export async function checkLoginRateLimit(identifier: string): Promise<{ allowed: boolean; retryAfterSeconds: number }> {
  const rows = await db.$queryRaw<Array<{ attempts: number; retry: number }>>`
    INSERT INTO "LoginRateBucket" ("key", "attempts", "expiresAt")
    VALUES (${bucketKey(identifier)}, 1, CURRENT_TIMESTAMP + INTERVAL '15 minutes')
    ON CONFLICT ("key") DO UPDATE SET
      "attempts" = CASE WHEN "LoginRateBucket"."expiresAt" <= CURRENT_TIMESTAMP THEN 1 ELSE "LoginRateBucket"."attempts" + 1 END,
      "expiresAt" = CASE WHEN "LoginRateBucket"."expiresAt" <= CURRENT_TIMESTAMP THEN CURRENT_TIMESTAMP + INTERVAL '15 minutes' ELSE "LoginRateBucket"."expiresAt" END
    RETURNING "attempts", GREATEST(1, CEIL(EXTRACT(EPOCH FROM ("expiresAt" - CURRENT_TIMESTAMP))))::int AS retry
  `;
  return { allowed: rows[0].attempts <= MAX_ATTEMPTS, retryAfterSeconds: rows[0].attempts <= MAX_ATTEMPTS ? 0 : rows[0].retry || WINDOW_SECONDS };
}
export async function recordLoginFailure(_identifier: string): Promise<void> {
  // Already reserved by checkLoginRateLimit, including concurrent attempts.
}
export async function clearLoginFailures(identifier: string): Promise<void> {
  await db.loginRateBucket.deleteMany({ where: { key: bucketKey(identifier) } });
}
export function isDistributedRateLimitActive(): boolean { return true; }
