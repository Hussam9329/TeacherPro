import { emitTeacherProDataChanged, inferTeacherProScopesFromEndpoint } from "./teacherpro-sync";

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
const MAX_OUTBOX = 1000;
const MAX_ATTEMPTS = 5;

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

function generateId(): string {
  return `mut-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
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
    // 4xx (except 408/429) → permanent failure, don't queue.
    if (res.status >= 400 && res.status < 500 && res.status !== 408 && res.status !== 429) {
      return { ok: false };
    }
    // 5xx/408/429 → transient, queue.
  } catch {
    // network error → queue.
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
  const items = readOutbox();
  if (items.length === 0) return 0;

  flushInFlight = true;
  let flushed = 0;
  const touchedScopes = new Set<string>();
  try {
    const remaining: QueuedMutation[] = [];
    for (const item of items) {
      if (item.attempts >= MAX_ATTEMPTS) {
        // Drop exhausted items to avoid unbounded growth.
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
        // 4xx (except 408/429) → permanent failure, drop.
        if (res.status >= 400 && res.status < 500 && res.status !== 408 && res.status !== 429) {
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

// Auto-flush on online/visibility events.
if (typeof window !== 'undefined') {
  window.addEventListener('online', () => { void flushOutbox(); });
  window.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void flushOutbox();
  });
}
