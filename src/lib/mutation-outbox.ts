import {
  announceTeacherProSyncError,
  emitTeacherProDataChanged,
  inferTeacherProScopesFromEndpoint,
} from "./teacherpro-sync";
import { mutationCanBeReplayed } from "./mutation-replay-policy";

/**
 * Generic client-side outbox for any server mutation that may fail due to
 * transient network issues. Mirrors the grades-specific outbox pattern but
 * works for any endpoint.
 *
 * Usage:
 *   import { enqueueMutation, flushOutbox } from '@/lib/mutation-outbox';
 *   await enqueueMutation({
 *     endpoint: '/api/students',
 *     method: 'PUT',
 *     payload: { id: '...', name: '...' },
 *   });
 *
 * The outbox is persisted to localStorage. The store should call
 * flushOutbox() on mount and on 'online'/'visibilitychange' events
 * (the layout already does this for grade saves).
 */

export type QueuedMutation = {
  id: string;
  endpoint: string;
  method: 'POST' | 'PUT' | 'DELETE';
  payload: unknown;
  description?: string;
  queuedAt: number;
  attempts: number;
  lastAttemptAt?: number;
};

const OUTBOX_KEY = 'teacherpro-mutation-outbox-v1';
const FAILED_OUTBOX_KEY = 'teacherpro-mutation-outbox-failed-v1';
const MAX_OUTBOX = 1000;
const MAX_FAILED_OUTBOX = 100;
const MAX_ATTEMPTS = 5;

export type FailedQueuedMutation = QueuedMutation & {
  failedAt: number;
  status?: number;
  error: string;
};

function canUseStorage(): boolean {
  return typeof window !== 'undefined' && Boolean(window.localStorage);
}

function readOutbox(): QueuedMutation[] {
  if (!canUseStorage()) return [];
  try {
    const parsed = JSON.parse(window.localStorage.getItem(OUTBOX_KEY) || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeOutbox(items: QueuedMutation[]): void {
  if (!canUseStorage()) return;
  try {
    window.localStorage.setItem(OUTBOX_KEY, JSON.stringify(items.slice(-MAX_OUTBOX)));
  } catch (error) {
    console.warn('[MutationOutbox] failed to write:', error);
  }
}

function recordFailedMutation(
  item: QueuedMutation,
  error: string,
  status?: number,
): void {
  if (!canUseStorage()) return;
  try {
    const parsed = JSON.parse(
      window.localStorage.getItem(FAILED_OUTBOX_KEY) || '[]',
    );
    const failed = Array.isArray(parsed) ? parsed as FailedQueuedMutation[] : [];
    failed.push({ ...item, failedAt: Date.now(), status, error });
    window.localStorage.setItem(
      FAILED_OUTBOX_KEY,
      JSON.stringify(failed.slice(-MAX_FAILED_OUTBOX)),
    );
  } catch (storageError) {
    console.warn('[MutationOutbox] failed to preserve rejected mutation:', storageError);
  }
}

async function responseErrorMessage(res: Response): Promise<string> {
  const fallback = `رفض الخادم الطلب المؤجل (رمز ${res.status})`;
  const contentType = res.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    const body = await res.clone().json().catch(() => null) as {
      error?: unknown;
      message?: unknown;
    } | null;
    const message = String(body?.error ?? body?.message ?? '').trim();
    return message || fallback;
  }
  return (await res.clone().text().catch(() => '')).trim() || fallback;
}

function generateId(): string {
  return `mut-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function responseIsExplicitlyNonRetryable(res: Response): boolean {
  const value = String(
    res.headers.get('x-teacherpro-retryable') || '',
  ).toLowerCase();
  return value === '0' || value === 'false' || value === 'no';
}

function sameQueuedMutation(
  item: QueuedMutation,
  input: { endpoint: string; method: 'POST' | 'PUT' | 'DELETE'; payload?: unknown },
): boolean {
  if (item.endpoint !== input.endpoint || item.method !== input.method) return false;
  try {
    return JSON.stringify(item.payload) === JSON.stringify(input.payload);
  } catch {
    return false;
  }
}

function dedupeQueuedMutations(items: QueuedMutation[]): QueuedMutation[] {
  const unique: QueuedMutation[] = [];
  for (const item of items) {
    if (!unique.some((existing) => sameQueuedMutation(existing, item))) {
      unique.push(item);
    }
  }
  return unique;
}

/**
 * Enqueue a mutation to be sent to the server. If the server is reachable,
 * it will be sent immediately; on failure it stays in the outbox and is
 * retried later.
 */
export async function enqueueMutation(input: {
  endpoint: string;
  method: 'POST' | 'PUT' | 'DELETE';
  payload?: unknown;
  description?: string;
}): Promise<{ ok: boolean; outboxId?: string }> {
  const { endpoint, method, payload, description } = input;

  // Try immediate send first.
  try {
    const res = await fetch(endpoint, {
      method,
      headers: payload !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      credentials: 'same-origin',
      body: payload !== undefined ? JSON.stringify(payload) : undefined,
    });
    if (res.ok) {
      emitTeacherProDataChanged({
        source: 'local-mutation',
        reason: description || `outbox-immediate:${method} ${endpoint}`,
        scopes: inferTeacherProScopesFromEndpoint(endpoint),
      });
      return { ok: true };
    }
    // Explicit server decision or permanent 4xx → never queue.
    if (
      responseIsExplicitlyNonRetryable(res) ||
      (res.status >= 400 && res.status < 500 && res.status !== 408 && res.status !== 429)
    ) {
      return { ok: false };
    }
    // 5xx/408/429 → transient, queue.
  } catch {
    // network error → queue.
  }

  if (!mutationCanBeReplayed(endpoint, method, payload)) {
    announceTeacherProSyncError(
      'تعذر التحقق من عملية غير قابلة للتكرار بأمان. حدّث البيانات قبل إعادة تنفيذها يدوياً.',
    );
    return { ok: false };
  }

  return queueOnly(input);
}

/**
 * Queue a mutation without attempting an immediate send. Used by apiPost/
 * apiPut/apiDelete after they've already exhausted their own retries.
 */
export function queueOnly(input: {
  endpoint: string;
  method: 'POST' | 'PUT' | 'DELETE';
  payload?: unknown;
  description?: string;
}): { ok: boolean; outboxId: string } {
  const item: QueuedMutation = {
    id: generateId(),
    endpoint: input.endpoint,
    method: input.method,
    payload: input.payload,
    description: input.description,
    queuedAt: Date.now(),
    attempts: 0,
  };
  const items = readOutbox();
  const duplicate = items.find((existing) => sameQueuedMutation(existing, input));
  if (duplicate) {
    return { ok: false, outboxId: duplicate.id };
  }
  items.push(item);
  writeOutbox(items);
  return { ok: false, outboxId: item.id };
}

let flushInFlight = false;

/**
 * Attempt to flush all pending mutations in FIFO order. Skips items that
 * have exceeded MAX_ATTEMPTS. Returns the number of successfully flushed
 * mutations.
 */
export async function flushOutbox(): Promise<number> {
  if (!canUseStorage()) return 0;
  if (flushInFlight) return 0;
  const items = dedupeQueuedMutations(readOutbox());
  if (items.length === 0) return 0;

  flushInFlight = true;
  let flushed = 0;
  const touchedScopes = new Set<string>();
  try {
    const remaining: QueuedMutation[] = [];
    for (const item of items) {
      if (!mutationCanBeReplayed(item.endpoint, item.method, item.payload)) {
        const message =
          'أوقف النظام إعادة طلب قديم غير قابل للتكرار بأمان لتجنب مضاعفة البيانات.';
        recordFailedMutation(item, message);
        announceTeacherProSyncError(
          `${message} حدّث البيانات وتحقق من النتيجة قبل تكرار العملية يدوياً.`,
        );
        continue;
      }
      if (item.attempts >= MAX_ATTEMPTS) {
        const message = 'تعذر تنفيذ تعديل مؤجل بعد عدة محاولات. راجع الاتصال وأعد العملية.';
        recordFailedMutation(item, message);
        announceTeacherProSyncError(message);
        continue;
      }
      try {
        const res = await fetch(item.endpoint, {
          method: item.method,
          headers: item.payload !== undefined ? { 'Content-Type': 'application/json' } : undefined,
          credentials: 'same-origin',
          body: item.payload !== undefined ? JSON.stringify(item.payload) : undefined,
        });
        if (res.ok) {
          flushed += 1;
          inferTeacherProScopesFromEndpoint(item.endpoint).forEach((scope) => touchedScopes.add(scope));
          continue;
        }
        // Explicitly non-retryable responses (including schema mismatch)
        // and permanent 4xx are dropped immediately. This also cleans old
        // queued requests created by versions that treated every 503 as transient.
        if (
          responseIsExplicitlyNonRetryable(res) ||
          (res.status >= 400 && res.status < 500 && res.status !== 408 && res.status !== 429)
        ) {
          const message = await responseErrorMessage(res);
          recordFailedMutation(item, message, res.status);
          announceTeacherProSyncError(
            `لم يُنفذ تعديل مؤجل: ${message} حدّث البيانات وكرر العملية يدوياً عند الحاجة.`,
          );
          continue;
        }
        // Transient: keep with incremented attempts.
        remaining.push({
          ...item,
          attempts: item.attempts + 1,
          lastAttemptAt: Date.now(),
        });
      } catch {
        // Network error: keep with incremented attempts.
        remaining.push({
          ...item,
          attempts: item.attempts + 1,
          lastAttemptAt: Date.now(),
        });
      }
    }
    writeOutbox(remaining);
    if (flushed > 0) {
      emitTeacherProDataChanged({
        source: 'local-mutation',
        reason: `تمت مزامنة ${flushed} تعديل مؤجل`,
        scopes: Array.from(touchedScopes),
      });
    }
  } finally {
    flushInFlight = false;
  }
  return flushed;
}

export function getPendingMutationCount(): number {
  return readOutbox().length;
}

export function getFailedMutationCount(): number {
  if (!canUseStorage()) return 0;
  try {
    const parsed = JSON.parse(
      window.localStorage.getItem(FAILED_OUTBOX_KEY) || '[]',
    );
    return Array.isArray(parsed) ? parsed.length : 0;
  } catch {
    return 0;
  }
}

// Auto-flush on online/visibility events.
if (typeof window !== 'undefined') {
  window.addEventListener('online', () => { void flushOutbox(); });
  window.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void flushOutbox();
  });
}
