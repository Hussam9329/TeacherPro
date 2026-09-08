/** Identity comes only from a successful server session response, never the cache. */
let ownerUserId: string | null = null;
export function getOutboxOwner(): string | null { return ownerUserId; }
export function setOutboxOwner(value: string | null): void {
  ownerUserId = value;
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('teacherpro:outbox-owner', { detail: value }));
  }
}
export function ownerHeaders(owner = getOutboxOwner()): Record<string, string> {
  return owner ? { 'x-teacherpro-owner-id': owner } : {};
}
export async function withOutboxLock(name: string, run: () => Promise<number>): Promise<number> {
  if (typeof navigator !== 'undefined' && navigator.locks) {
    return navigator.locks.request(name, { ifAvailable: true }, lock => lock ? run() : 0);
  }
  // No automatic replay without cross-tab exclusion. Keep the saved work.
  return 0;
}
