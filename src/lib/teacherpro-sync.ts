"use client";

export const TEACHERPRO_DATA_CHANGED_EVENT = "teacherpro:data-changed";
export const TEACHERPRO_DATA_CHANGED_STORAGE_KEY = "teacherpro:data-changed:v1";

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
}

type SyncListener = (detail: TeacherProDataChangedDetail) => void;


let broadcastChannel: BroadcastChannel | null = null;
let lastSeenEventId = "";

function canUseWindow(): boolean {
  return typeof window !== "undefined";
}

function getBroadcastChannel(): BroadcastChannel | null {
  if (!canUseWindow() || typeof BroadcastChannel === "undefined") return null;
  if (!broadcastChannel) broadcastChannel = new BroadcastChannel("teacherpro-sync");
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
    };
  } catch {
    return null;
  }
}

function normalizeScopes(scopes?: string | string[]): string[] | undefined {
  if (!scopes) return undefined;
  const list = Array.isArray(scopes) ? scopes : [scopes];
  const normalized = list.map((item) => String(item).trim()).filter(Boolean);
  return normalized.length > 0 ? Array.from(new Set(normalized)) : undefined;
}

function dispatchLocal(detail: TeacherProDataChangedDetail): void {
  if (!canUseWindow()) return;
  if (detail.id === lastSeenEventId) return;
  lastSeenEventId = detail.id;
  window.dispatchEvent(new CustomEvent(TEACHERPRO_DATA_CHANGED_EVENT, { detail }));
}

export function emitTeacherProDataChanged(input: {
  source?: TeacherProSyncSource;
  reason?: string;
  scopes?: string | string[];
  version?: string;
  broadcast?: boolean;
} = {}): TeacherProDataChangedDetail | null {
  if (!canUseWindow()) return null;

  const detail: TeacherProDataChangedDetail = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    source: input.source || "local-mutation",
    reason: input.reason,
    scopes: normalizeScopes(input.scopes),
    version: input.version,
    at: Date.now(),
  };

  dispatchLocal(detail);

  if (input.broadcast !== false) {
    getBroadcastChannel()?.postMessage(detail);
    try {
      window.localStorage.setItem(TEACHERPRO_DATA_CHANGED_STORAGE_KEY, JSON.stringify(detail));
    } catch {
      // localStorage can be blocked in private mode; local event is enough.
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
    dispatchLocal({ ...detail, source: "storage" });
  };

  const channel = getBroadcastChannel();
  const onBroadcast = (event: MessageEvent<TeacherProDataChangedDetail>) => {
    const detail = event.data;
    if (!detail?.id || detail.id === lastSeenEventId) return;
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
