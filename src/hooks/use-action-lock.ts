"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { beginTeacherProInteractionBlocker } from "@/lib/teacherpro-sync";

export function useActionLock(minDelayMs = 700) {
  const lockedRef = useRef(false);
  const releaseBlockerRef = useRef<(() => void) | null>(null);
  const releaseTimerRef = useRef<ReturnType<typeof window.setTimeout> | null>(null);
  const [locked, setLocked] = useState(false);

  const release = useCallback(() => {
    if (releaseTimerRef.current) {
      window.clearTimeout(releaseTimerRef.current);
      releaseTimerRef.current = null;
    }
    releaseBlockerRef.current?.();
    releaseBlockerRef.current = null;
    lockedRef.current = false;
    setLocked(false);
  }, []);

  useEffect(() => {
    return () => {
      if (releaseTimerRef.current) window.clearTimeout(releaseTimerRef.current);
      releaseBlockerRef.current?.();
      releaseBlockerRef.current = null;
      lockedRef.current = false;
    };
  }, []);

  const runLocked = useCallback(
    <Args extends unknown[]>(
      action: (...args: Args) => void | Promise<void>,
    ) => {
      return async (...args: Args) => {
        if (lockedRef.current) return;
        lockedRef.current = true;
        releaseBlockerRef.current = beginTeacherProInteractionBlocker(
          "mutation-in-progress",
        );
        setLocked(true);
        const startedAt = Date.now();
        try {
          await action(...args);
        } finally {
          const elapsed = Date.now() - startedAt;
          const remaining = Math.max(minDelayMs - elapsed, 0);
          if (remaining === 0) {
            release();
          } else {
            releaseTimerRef.current = window.setTimeout(
              release,
              remaining,
            ) as unknown as ReturnType<typeof window.setTimeout>;
          }
        }
      };
    },
    [minDelayMs, release],
  );

  return { locked, runLocked };
}
