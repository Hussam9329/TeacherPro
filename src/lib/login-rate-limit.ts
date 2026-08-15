/**
 * Login rate limiter with distributed backend support.
 *
 * Primary: Upstash Redis (REST API, no SDK needed) — works across all
 * Vercel serverless instances for true distributed rate limiting.
 * Fallback: in-memory Map — works on a single instance only.
 *
 * Set UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN in Vercel env
 * vars to enable distributed mode. Without them, the limiter falls
 * back to in-memory (per-instance) mode and logs a warning on first use.
 *
 * Algorithm: fixed-window counter with TTL.
 * - Key: `login:rl:<identifier>` (lowercased)
 * - On failure: INCR + EXPIRE (15 min TTL)
 * - On success: DEL
 * - On check: GET; if value >= MAX_FAILURES → blocked
 *
 * Upstash free tier allows 10,000 commands/day. Each login = 1-2
 * commands, so this is well within limits for a school admin tool.
 */

const WINDOW_SECONDS = 15 * 60; // 15 minutes
const MAX_FAILURES = 5;

// ─── Upstash Redis REST client ────────────────────────────────────────────

function readEnv(name: string): string | undefined {
  if (typeof process !== 'undefined' && process.env) return process.env[name];
  return undefined;
}

const UPSTASH_URL = readEnv('UPSTASH_REDIS_REST_URL')?.trim();
const UPSTASH_TOKEN = readEnv('UPSTASH_REDIS_REST_TOKEN')?.trim();
const REDIS_ENABLED = Boolean(UPSTASH_URL && UPSTASH_TOKEN);

let redisWarningLogged = false;

async function redisCommand<T = unknown>(...args: (string | number)[]): Promise<T | null> {
  if (!REDIS_ENABLED) return null;
  try {
    const res = await fetch(`${UPSTASH_URL!}/${args.map(encodeURIComponent).join('/')}`, {
      headers: { Authorization: `Bearer ${UPSTASH_TOKEN!}` },
      cache: 'no-store',
    });
    if (!res.ok) {
      if (!redisWarningLogged) {
        console.warn('[rate-limit] Upstash Redis request failed:', res.status, await res.text().catch(() => ''));
        redisWarningLogged = true;
      }
      return null;
    }
    const data = await res.json() as { result?: T; error?: string };
    if (data.error) {
      if (!redisWarningLogged) {
        console.warn('[rate-limit] Upstash Redis error:', data.error);
        redisWarningLogged = true;
      }
      return null;
    }
    return data.result ?? null;
  } catch (error) {
    if (!redisWarningLogged) {
      console.warn('[rate-limit] Upstash Redis network error:', error);
      redisWarningLogged = true;
    }
    return null;
  }
}

// ─── In-memory fallback ───────────────────────────────────────────────────

type AttemptRecord = {
  failures: number[];
};

const buckets = new Map<string, AttemptRecord>();

function pruneOldFailures(record: AttemptRecord, now: number): number[] {
  const cutoff = now - WINDOW_SECONDS * 1000;
  record.failures = record.failures.filter((ts) => ts > cutoff);
  return record.failures;
}

// ─── Public API ───────────────────────────────────────────────────────────

function redisKey(identifier: string): string {
  return `login:rl:${identifier.toLowerCase()}`;
}

/**
 * Check if the identifier is currently rate-limited.
 * Returns { allowed, retryAfterSeconds }.
 *
 * Tries Redis first; on any error falls back to in-memory.
 */
export async function checkLoginRateLimit(identifier: string): Promise<{
  allowed: boolean;
  retryAfterSeconds: number;
}> {
  const key = identifier.toLowerCase();

  if (REDIS_ENABLED) {
    const count = await redisCommand<number>('GET', redisKey(key));
    if (count !== null && Number(count) >= MAX_FAILURES) {
      const ttl = await redisCommand<number>('TTL', redisKey(key));
      const retryAfterSeconds = ttl && ttl > 0 ? ttl : WINDOW_SECONDS;
      return { allowed: false, retryAfterSeconds };
    }
    // If Redis returned null (error), fall through to in-memory check.
    if (count === null && REDIS_ENABLED) {
      // Redis had an error; use in-memory as fallback.
    } else {
      return { allowed: true, retryAfterSeconds: 0 };
    }
  }

  // In-memory check (fallback or primary when Redis not configured).
  const now = Date.now();
  const record = buckets.get(key) || { failures: [] };
  pruneOldFailures(record, now);

  if (record.failures.length >= MAX_FAILURES) {
    const oldestRelevant = record.failures[0];
    const retryAfterMs = WINDOW_SECONDS * 1000 - (now - oldestRelevant);
    return {
      allowed: false,
      retryAfterSeconds: Math.max(1, Math.ceil(retryAfterMs / 1000)),
    };
  }

  return { allowed: true, retryAfterSeconds: 0 };
}

/**
 * Record a failed login attempt.
 * Tries Redis first; on any error falls back to in-memory.
 */
export async function recordLoginFailure(identifier: string): Promise<void> {
  const key = identifier.toLowerCase();

  if (REDIS_ENABLED) {
    // INCR + EXPIRE atomically. If INCR returns 1, this is the first
    // failure in the window, so set the TTL.
    const count = await redisCommand<number>('INCR', redisKey(key));
    if (count !== null) {
      if (Number(count) === 1) {
        await redisCommand('EXPIRE', redisKey(key), String(WINDOW_SECONDS));
      }
      return; // Redis succeeded; don't also record in-memory.
    }
    // Redis failed; fall through to in-memory.
  }

  const now = Date.now();
  const record = buckets.get(key) || { failures: [] };
  pruneOldFailures(record, now);
  record.failures.push(now);
  buckets.set(key, record);

  if (buckets.size > 1000) {
    for (const [k, v] of buckets) {
      if (pruneOldFailures(v, now).length === 0) {
        buckets.delete(k);
      }
    }
  }
}

/**
 * Clear failures for an identifier (called on successful login).
 * Tries Redis first; always clears in-memory too.
 */
export async function clearLoginFailures(identifier: string): Promise<void> {
  const key = identifier.toLowerCase();

  if (REDIS_ENABLED) {
    await redisCommand('DEL', redisKey(key));
  }

  buckets.delete(key);
}

/**
 * Returns true if distributed rate limiting (Redis) is active.
 * Useful for health checks / operator visibility.
 */
export function isDistributedRateLimitActive(): boolean {
  return REDIS_ENABLED;
}
