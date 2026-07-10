"use client";

import { startTransition, useEffect, useMemo, useRef, useState } from "react";
import {
  announceTeacherProSyncPending,
  announceTeacherProSyncSettled,
  isTeacherProInteractionBusy,
  subscribeTeacherProDataChanged,
  TEACHERPRO_SYNC_APPLY_NOW_EVENT,
  type TeacherProDataChangedDetail,
} from "@/lib/teacherpro-sync";

const EXTERNAL_SYNC_DEBOUNCE_MS = 650;
const BUSY_RETRY_MS = 550;
const MAX_INTERACTION_DEFERRAL_MS = 30_000;

function matchesScope(
  detail: TeacherProDataChangedDetail,
  scopes: string[] | null,
): boolean {
  if (!scopes || scopes.length === 0) return true;
  if (!detail.scopes || detail.scopes.length === 0) return true;
  const listenerScopes = new Set(scopes);
  if (listenerScopes.has("all")) return true;
  return detail.scopes.some((scope) => scope === "all" || listenerScopes.has(scope));
}

/**
 * A coalesced external-sync key. Local successful mutations are deliberately
 * ignored because the caller/store already owns that update. External events
 * are delayed while the user is typing, scrolling, or the tab is hidden.
 */
export function useTeacherProSyncKey(scopes?: string | string[]): number {
  const scopeKey = Array.isArray(scopes) ? scopes.join("|") : scopes || "";
  const normalizedScopes = useMemo(() => {
    if (!scopeKey) return null;
    return scopeKey.split("|").map((scope) => scope.trim()).filter(Boolean);
  }, [scopeKey]);

  const [key, setKey] = useState(0);
  const timerRef = useRef<ReturnType<typeof window.setTimeout> | null>(null);
  const pendingRef = useRef<TeacherProDataChangedDetail | null>(null);
  const pendingSinceRef = useRef(0);
  const announcedRef = useRef(false);

  useEffect(() => {
    const clearTimer = () => {
      if (!timerRef.current) return;
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    };

    const flush = (force = false) => {
      if (!pendingRef.current) return;
      const hidden = typeof document !== "undefined" && document.hidden;
      const pendingFor = Date.now() - pendingSinceRef.current;
      const shouldDefer =
        !force &&
        (hidden ||
          (isTeacherProInteractionBusy() &&
            pendingFor < MAX_INTERACTION_DEFERRAL_MS));

      if (shouldDefer) {
        if (!announcedRef.current && pendingFor >= 1200) {
          announcedRef.current = true;
          announceTeacherProSyncPending(pendingRef.current.scopes);
        }
        clearTimer();
        timerRef.current = window.setTimeout(
          () => flush(false),
          BUSY_RETRY_MS,
        ) as unknown as ReturnType<typeof window.setTimeout>;
        return;
      }

      clearTimer();
      pendingRef.current = null;
      pendingSinceRef.current = 0;
      announcedRef.current = false;
      announceTeacherProSyncSettled();
      startTransition(() => setKey((value) => value + 1));
    };

    const queue = (detail: TeacherProDataChangedDetail) => {
      // The mutation owner already has the final/optimistic data. Listening to
      // the same local event was the main cause of duplicate refetches.
      if (detail.source === "local-mutation") return;
      if (!matchesScope(detail, normalizedScopes)) return;
      pendingRef.current = detail;
      if (!pendingSinceRef.current) pendingSinceRef.current = Date.now();
      clearTimer();
      const delay = detail.source === "manual" ? 0 : EXTERNAL_SYNC_DEBOUNCE_MS;
      timerRef.current = window.setTimeout(
        () => flush(detail.source === "manual"),
        delay,
      ) as unknown as ReturnType<typeof window.setTimeout>;
    };

    const unsubscribe = subscribeTeacherProDataChanged(queue);
    const applyNow = () => flush(true);
    const wake = () => {
      if (!pendingRef.current || document.hidden) return;
      clearTimer();
      timerRef.current = window.setTimeout(
        () => flush(false),
        80,
      ) as unknown as ReturnType<typeof window.setTimeout>;
    };

    window.addEventListener(TEACHERPRO_SYNC_APPLY_NOW_EVENT, applyNow);
    window.addEventListener("focus", wake);
    document.addEventListener("visibilitychange", wake);

    return () => {
      unsubscribe();
      clearTimer();
      window.removeEventListener(TEACHERPRO_SYNC_APPLY_NOW_EVENT, applyNow);
      window.removeEventListener("focus", wake);
      document.removeEventListener("visibilitychange", wake);
    };
  }, [normalizedScopes]);

  return key;
}

/**
 * Returns a detector that may be called inside effects. It reports whether the
 * current effect run was caused by an external sync-key change. The previous
 * key is committed in a microtask so all effects from the same render observe
 * the same answer.
 */
export function useTeacherProBackgroundSyncDetector(syncKey: number) {
  const previousKeyRef = useRef(syncKey);
  return useMemo(
    () => () => {
      const changedBySync = previousKeyRef.current !== syncKey;
      if (changedBySync) {
        queueMicrotask(() => {
          previousKeyRef.current = syncKey;
        });
      }
      return changedBySync;
    },
    [syncKey],
  );
}
