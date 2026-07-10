"use client";

export const TEACHERPRO_DATA_CHANGED_EVENT = "teacherpro:data-changed";
export const TEACHERPRO_DATA_CHANGED_STORAGE_KEY = "teacherpro:data-changed:v2";
export const TEACHERPRO_LOCAL_MUTATION_EVENT = "teacherpro:local-mutation-recorded";
export const TEACHERPRO_SYNC_PENDING_EVENT = "teacherpro:sync-pending";
export const TEACHERPRO_SYNC_APPLY_NOW_EVENT = "teacherpro:sync-apply-now";
export const TEACHERPRO_SYNC_SETTLED_EVENT = "teacherpro:sync-settled";

export type TeacherProSyncSource =
  | "local-mutation"
  | "broadcast"
  | "storage"
  | "server-version"
  | "manual";

export interface TeacherProDataChangedDetail {
  id: string;
  source: TeacherProSyncSource;
  reason?: string;
  scopes?: string[];
  version?: string;
  at: number;
  originContextId?: string;
}

type SyncListener = (detail: TeacherProDataChangedDetail) => void;

export type TeacherProSyncScope =
  | "all"
  | "core"
  | "dashboard"
  | "courses"
  | "chapters"
  | "students"
  | "dismissed"
  | "exams"
  | "grades"
  | "opportunities"
  | "opportunity-logs"
  | "follow-up"
  | "correction"
  | "accounts"
  | "logs"
  | "grade-entry-notes"
  | "bulk-import";

const LOG_SYNC_DEBOUNCE_MS = 1200;
const LOCAL_MUTATION_ACK_WINDOW_MS = 20_000;
const INTERACTION_IDLE_MS = 700;
const CONTEXT_STORAGE_KEY = "teacherpro:sync-context-id:v1";

let logsSyncDebounceTimer: ReturnType<typeof setTimeout> | null = null;
let broadcastChannel: BroadcastChannel | null = null;
let lastSeenEventId = "";
let contextId = "";
let interactionTrackingInstalled = false;
let lastInteractionAt = 0;

type PendingLocalMutation = {
  id: string;
  at: number;
  scopes: Set<string>;
};

let pendingLocalMutations: PendingLocalMutation[] = [];

function canUseWindow(): boolean {
  return typeof window !== "undefined";
}

function normalizeScopes(scopes?: string | string[]): string[] | undefined {
  if (!scopes) return undefined;
  const list = Array.isArray(scopes) ? scopes : [scopes];
  const normalized = list.map((item) => String(item).trim()).filter(Boolean);
  return normalized.length > 0 ? Array.from(new Set(normalized)) : undefined;
}

export function getTeacherProSyncContextId(): string {
  if (!canUseWindow()) return "server";
  if (contextId) return contextId;
  try {
    const existing = window.sessionStorage.getItem(CONTEXT_STORAGE_KEY);
    if (existing) {
      contextId = existing;
      return contextId;
    }
  } catch {
    // sessionStorage may be blocked; an in-memory ID still separates this tab.
  }
  contextId = `ctx-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  try {
    window.sessionStorage.setItem(CONTEXT_STORAGE_KEY, contextId);
  } catch {
    // Ignore storage restrictions.
  }
  return contextId;
}

function getBroadcastChannel(): BroadcastChannel | null {
  if (!canUseWindow() || typeof BroadcastChannel === "undefined") return null;
  if (!broadcastChannel) broadcastChannel = new BroadcastChannel("teacherpro-sync-v2");
  return broadcastChannel;
}

function safeParseDetail(value: string | null): TeacherProDataChangedDetail | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as Partial<TeacherProDataChangedDetail>;
    if (!parsed.id || !parsed.at) return null;
    return {
      id: String(parsed.id),
      source: (parsed.source || "storage") as TeacherProSyncSource,
      reason: parsed.reason ? String(parsed.reason) : undefined,
      scopes: Array.isArray(parsed.scopes) ? parsed.scopes.map(String) : undefined,
      version: parsed.version ? String(parsed.version) : undefined,
      at: Number(parsed.at) || Date.now(),
      originContextId: parsed.originContextId
        ? String(parsed.originContextId)
        : undefined,
    };
  } catch {
    return null;
  }
}

function dispatchLocal(detail: TeacherProDataChangedDetail): void {
  if (!canUseWindow()) return;
  if (detail.id === lastSeenEventId) return;
  lastSeenEventId = detail.id;
  window.dispatchEvent(new CustomEvent(TEACHERPRO_DATA_CHANGED_EVENT, { detail }));
}

function prunePendingLocalMutations(now = Date.now()): void {
  pendingLocalMutations = pendingLocalMutations.filter(
    (entry) => now - entry.at <= LOCAL_MUTATION_ACK_WINDOW_MS && entry.scopes.size > 0,
  );
}

function rememberLocalMutation(detail: TeacherProDataChangedDetail): void {
  const scopes = new Set(detail.scopes?.length ? detail.scopes : ["all"]);
  pendingLocalMutations.push({ id: detail.id, at: detail.at, scopes });
  prunePendingLocalMutations(detail.at);
  if (canUseWindow()) {
    window.dispatchEvent(
      new CustomEvent<TeacherProDataChangedDetail>(TEACHERPRO_LOCAL_MUTATION_EVENT, {
        detail,
      }),
    );
  }
}

/**
 * Removes the part of a server-version change that is merely the echo of a
 * mutation already completed in this tab. Unmatched scopes are preserved, so
 * a simultaneous change made by another user is still delivered.
 */
export function consumeTeacherProLocalMutationEcho(
  changedScopes: string[],
): { externalScopes: string[]; acknowledgedScopes: string[] } {
  const normalized = normalizeScopes(changedScopes) || ["all"];
  prunePendingLocalMutations();

  const acknowledged = new Set<string>();
  const external = new Set<string>();

  for (const scope of normalized) {
    const matchingEntries = pendingLocalMutations.filter(
      (entry) => entry.scopes.has("all") || entry.scopes.has(scope),
    );
    if (matchingEntries.length === 0) {
      external.add(scope);
      continue;
    }
    acknowledged.add(scope);
    for (const entry of matchingEntries) {
      if (entry.scopes.has("all")) {
        entry.scopes.clear();
      } else {
        entry.scopes.delete(scope);
      }
    }
  }

  prunePendingLocalMutations();
  return {
    externalScopes: Array.from(external),
    acknowledgedScopes: Array.from(acknowledged),
  };
}

export function subscribeTeacherProLocalMutation(listener: SyncListener): () => void {
  if (!canUseWindow()) return () => {};
  const handler = (event: Event) => {
    const detail = (event as CustomEvent<TeacherProDataChangedDetail>).detail;
    if (detail?.id) listener(detail);
  };
  window.addEventListener(TEACHERPRO_LOCAL_MUTATION_EVENT, handler);
  return () => window.removeEventListener(TEACHERPRO_LOCAL_MUTATION_EVENT, handler);
}

function installInteractionTracking(): void {
  if (!canUseWindow() || interactionTrackingInstalled) return;
  interactionTrackingInstalled = true;
  const mark = () => {
    lastInteractionAt = Date.now();
  };
  window.addEventListener("pointerdown", mark, { capture: true, passive: true });
  window.addEventListener("keydown", mark, { capture: true });
  window.addEventListener("input", mark, { capture: true });
  window.addEventListener("wheel", mark, { capture: true, passive: true });
  window.addEventListener("touchmove", mark, { capture: true, passive: true });
  window.addEventListener("scroll", mark, { capture: true, passive: true });
}

function isEditableElement(element: Element | null): boolean {
  if (!(element instanceof HTMLElement)) return false;
  if (element.isContentEditable) return true;
  if (element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement) {
    return !element.disabled;
  }
  if (element instanceof HTMLInputElement) {
    const nonEditingTypes = new Set([
      "button",
      "submit",
      "reset",
      "checkbox",
      "radio",
      "file",
      "color",
      "range",
    ]);
    return !element.disabled && !element.readOnly && !nonEditingTypes.has(element.type);
  }
  return element.getAttribute("role") === "textbox";
}

export function isTeacherProInteractionBusy(): boolean {
  if (!canUseWindow()) return false;
  installInteractionTracking();
  if (document.hidden) return true;
  if (isEditableElement(document.activeElement)) return true;
  return Date.now() - lastInteractionAt < INTERACTION_IDLE_MS;
}

export function announceTeacherProSyncPending(scopes?: string[]): void {
  if (!canUseWindow()) return;
  window.dispatchEvent(
    new CustomEvent(TEACHERPRO_SYNC_PENDING_EVENT, {
      detail: { scopes: normalizeScopes(scopes) || ["all"] },
    }),
  );
}

export function announceTeacherProSyncSettled(): void {
  if (!canUseWindow()) return;
  window.dispatchEvent(new Event(TEACHERPRO_SYNC_SETTLED_EVENT));
}

export function requestTeacherProSyncNow(): void {
  if (!canUseWindow()) return;
  window.dispatchEvent(new Event(TEACHERPRO_SYNC_APPLY_NOW_EVENT));
}

export function inferTeacherProScopesFromEndpoint(endpoint: string): TeacherProSyncScope[] {
  const path = String(endpoint || "").toLowerCase();
  const scopes = new Set<TeacherProSyncScope>();
  const add = (items: TeacherProSyncScope[]) => items.forEach((item) => scopes.add(item));

  if (path.includes("grade-entry-missing-notes")) add(["grade-entry-notes", "grades", "exams"]);
  else if (path.includes("grades")) add(["grades", "students", "opportunities", "dashboard"]);
  else if (path.includes("students")) add(["students", "grades", "opportunities", "dismissed", "dashboard"]);
  else if (path.includes("opportunity-logs")) add(["opportunities", "opportunity-logs", "students", "dashboard"]);
  else if (path.includes("exams")) add(["exams", "grades", "students", "dashboard", "grade-entry-notes"]);
  else if (path.includes("courses")) add(["courses", "students", "exams", "dashboard"]);
  else if (path.includes("chapters")) add(["chapters", "courses", "students", "opportunities", "dashboard"]);
  else if (path.includes("student-leaves") || path.includes("student-calls") || path.includes("student-notes")) add(["follow-up", "students", "grades", "opportunities", "dashboard"]);
  else if (path.includes("correction-sheets") || path.includes("telegram-exam-submissions")) add(["correction", "students", "exams", "grades", "dashboard"]);
  else if (path.includes("users") || path.includes("roles")) add(["accounts", "logs"]);
  else if (path.includes("logs")) add(["logs"]);

  if (scopes.size === 0) add(["all"]);
  if (!path.includes("sync/version") && !scopes.has("all")) scopes.add("logs");
  return Array.from(scopes);
}

export function emitTeacherProLogsChangedDebounced(reason = "تحديث السجلات"): void {
  if (!canUseWindow()) return;
  if (logsSyncDebounceTimer) clearTimeout(logsSyncDebounceTimer);
  logsSyncDebounceTimer = setTimeout(() => {
    logsSyncDebounceTimer = null;
    emitTeacherProDataChanged({
      source: "local-mutation",
      reason,
      scopes: "logs",
    });
  }, LOG_SYNC_DEBOUNCE_MS);
}

export function emitTeacherProDataChanged(input: {
  source?: TeacherProSyncSource;
  reason?: string;
  scopes?: string | string[];
  version?: string;
  broadcast?: boolean;
  /** Keep the current tab untouched while still notifying other tabs/windows. */
  dispatchLocal?: boolean;
} = {}): TeacherProDataChangedDetail | null {
  if (!canUseWindow()) return null;

  const source = input.source || "local-mutation";
  const detail: TeacherProDataChangedDetail = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    source,
    reason: input.reason,
    scopes: normalizeScopes(input.scopes),
    version: input.version,
    at: Date.now(),
    originContextId: getTeacherProSyncContextId(),
  };

  if (source === "local-mutation") rememberLocalMutation(detail);

  // A successful mutation already updated the current UI from its API result or
  // optimistic store state. Re-dispatching it locally caused the visible refresh
  // loop. Other tabs still receive the broadcast below.
  const shouldDispatchLocally =
    input.dispatchLocal !== undefined
      ? input.dispatchLocal
      : source !== "local-mutation";
  if (shouldDispatchLocally) dispatchLocal(detail);

  if (input.broadcast !== false) {
    getBroadcastChannel()?.postMessage(detail);
    try {
      window.localStorage.setItem(TEACHERPRO_DATA_CHANGED_STORAGE_KEY, JSON.stringify(detail));
    } catch {
      // localStorage can be blocked in private mode; BroadcastChannel is enough.
    }
  }

  return detail;
}

export function subscribeTeacherProDataChanged(listener: SyncListener): () => void {
  if (!canUseWindow()) return () => {};

  const onLocal = (event: Event) => {
    const detail = (event as CustomEvent<TeacherProDataChangedDetail>).detail;
    if (detail?.id) listener(detail);
  };

  const onStorage = (event: StorageEvent) => {
    if (event.key !== TEACHERPRO_DATA_CHANGED_STORAGE_KEY) return;
    const detail = safeParseDetail(event.newValue);
    if (!detail || detail.id === lastSeenEventId) return;
    if (detail.originContextId === getTeacherProSyncContextId()) return;
    dispatchLocal({ ...detail, source: "storage" });
  };

  const channel = getBroadcastChannel();
  const onBroadcast = (event: MessageEvent<TeacherProDataChangedDetail>) => {
    const detail = event.data;
    if (!detail?.id || detail.id === lastSeenEventId) return;
    if (detail.originContextId === getTeacherProSyncContextId()) return;
    dispatchLocal({ ...detail, source: "broadcast" });
  };

  window.addEventListener(TEACHERPRO_DATA_CHANGED_EVENT, onLocal);
  window.addEventListener("storage", onStorage);
  channel?.addEventListener("message", onBroadcast);

  return () => {
    window.removeEventListener(TEACHERPRO_DATA_CHANGED_EVENT, onLocal);
    window.removeEventListener("storage", onStorage);
    channel?.removeEventListener("message", onBroadcast);
  };
}
