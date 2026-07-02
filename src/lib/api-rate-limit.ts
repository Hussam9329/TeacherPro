import { createHash } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';

type ApiRateLimitOptions = {
  key: string;
  limit: number;
  windowSeconds: number;
  message?: string;
};

type MemoryBucket = {
  count: number;
  resetAt: number;
};

const memoryBuckets = new Map<string, MemoryBucket>();
let redisWarningLogged = false;

function readEnv(name: string): string | undefined {
  return (globalThis as unknown as { process?: { env?: Record<string, string | undefined> } }).process?.env?.[name];
}

const UPSTASH_URL = readEnv('UPSTASH_REDIS_REST_URL')?.trim();
const UPSTASH_TOKEN = readEnv('UPSTASH_REDIS_REST_TOKEN')?.trim();
const REDIS_ENABLED = Boolean(UPSTASH_URL && UPSTASH_TOKEN);

function hashValue(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 24);
}

function getClientIp(req: NextRequest): string {
  const forwarded = req.headers.get('x-forwarded-for');
  return (forwarded || '').split(',')[0].trim() || req.headers.get('x-real-ip') || 'unknown';
}

function getIdentifier(req: NextRequest): string {
  const session = req.cookies.get('teacherpro_session')?.value;
  if (session) return `session:${hashValue(session)}`;
  return `ip:${hashValue(getClientIp(req))}`;
}

async function redisCommand<T = unknown>(...args: (string | number)[]): Promise<T | null> {
  if (!REDIS_ENABLED) return null;
  try {
    const response = await fetch(`${UPSTASH_URL!}/${args.map((arg) => encodeURIComponent(String(arg))).join('/')}`, {
      headers: { Authorization: `Bearer ${UPSTASH_TOKEN!}` },
      cache: 'no-store',
    });
    if (!response.ok) {
      if (!redisWarningLogged) {
        console.warn('[api-rate-limit] Upstash request failed:', response.status, await response.text().catch(() => ''));
        redisWarningLogged = true;
      }
      return null;
    }
    const data = await response.json() as { result?: T; error?: string };
    if (data.error) {
      if (!redisWarningLogged) {
        console.warn('[api-rate-limit] Upstash error:', data.error);
        redisWarningLogged = true;
      }
      return null;
    }
    return data.result ?? null;
  } catch (error) {
    if (!redisWarningLogged) {
      console.warn('[api-rate-limit] Upstash network error:', error);
      redisWarningLogged = true;
    }
    return null;
  }
}

function cleanupMemoryBuckets(now: number) {
  if (memoryBuckets.size <= 2000) return;
  for (const [key, bucket] of memoryBuckets) {
    if (bucket.resetAt <= now) memoryBuckets.delete(key);
  }
}

function rateLimitResponse(message: string, retryAfterSeconds: number) {
  return NextResponse.json(
    { error: message, retryAfterSeconds },
    { status: 429, headers: { 'Retry-After': String(retryAfterSeconds) } },
  );
}

export async function checkApiRateLimit(
  req: NextRequest,
  options: ApiRateLimitOptions,
): Promise<NextResponse | null> {
  const identifier = getIdentifier(req);
  const bucketKey = `api:rl:${options.key}:${identifier}`;
  const message = options.message || 'طلبات كثيرة خلال مدة قصيرة. انتظر قليلاً ثم حاول مرة أخرى.';

  if (REDIS_ENABLED) {
    const count = await redisCommand<number>('INCR', bucketKey);
    if (count !== null) {
      if (Number(count) === 1) {
        await redisCommand('EXPIRE', bucketKey, options.windowSeconds);
      }
      if (Number(count) > options.limit) {
        const ttl = await redisCommand<number>('TTL', bucketKey);
        return rateLimitResponse(message, ttl && ttl > 0 ? ttl : options.windowSeconds);
      }
      return null;
    }
  }

  const now = Date.now();
  const existing = memoryBuckets.get(bucketKey);
  if (!existing || existing.resetAt <= now) {
    memoryBuckets.set(bucketKey, { count: 1, resetAt: now + options.windowSeconds * 1000 });
    cleanupMemoryBuckets(now);
    return null;
  }

  existing.count += 1;
  if (existing.count > options.limit) {
    const retryAfterSeconds = Math.max(1, Math.ceil((existing.resetAt - now) / 1000));
    return rateLimitResponse(message, retryAfterSeconds);
  }

  return null;
}

export const API_RATE_LIMITS = {
  backup: { key: 'backup', limit: 6, windowSeconds: 5 * 60, message: 'طلبات النسخ الاحتياطي كثيرة خلال مدة قصيرة. انتظر قليلاً ثم حاول مرة أخرى.' },
  bulkGrades: { key: 'bulk-grades', limit: 20, windowSeconds: 5 * 60, message: 'طلبات حفظ الدرجات الجماعية كثيرة خلال مدة قصيرة. انتظر قليلاً ثم حاول مرة أخرى.' },
  bulkOpportunities: { key: 'bulk-opportunities', limit: 15, windowSeconds: 5 * 60, message: 'طلبات تعديل الفرص الجماعية كثيرة خلال مدة قصيرة. انتظر قليلاً ثم حاول مرة أخرى.' },
  bulkStudents: { key: 'bulk-students', limit: 10, windowSeconds: 10 * 60, message: 'طلبات الإضافة الجماعية للطلاب كثيرة خلال مدة قصيرة. انتظر قليلاً ثم حاول مرة أخرى.' },
  studentOpportunitySync: { key: 'student-opportunity-sync', limit: 10, windowSeconds: 10 * 60, message: 'طلبات مزامنة فرص الطلاب كثيرة خلال مدة قصيرة. انتظر قليلاً ثم حاول مرة أخرى.' },
  adminHeavy: { key: 'admin-heavy', limit: 10, windowSeconds: 10 * 60, message: 'طلبات إدارية ثقيلة كثيرة خلال مدة قصيرة. انتظر قليلاً ثم حاول مرة أخرى.' },
} as const;
