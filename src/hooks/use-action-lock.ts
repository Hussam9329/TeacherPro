"use client";

import { useCallback, useRef, useState } from "react";

export function useActionLock(minDelayMs = 700) {
  const lockedRef = useRef(false);
  const [locked, setLocked] = useState(false);

  const runLocked = useCallback(
    <Args extends unknown[]>(
      action: (...args: Args) => void | Promise<void>,
    ) => {
      return async (...args: Args) => {
        if (lockedRef.current) return;
        lockedRef.current = true;
        setLocked(true);
        const startedAt = Date.now();
        try {
          await action(...args);
        } finally {
          const elapsed = Date.now() - startedAt;
          const remaining = Math.max(minDelayMs - elapsed, 0);
          window.setTimeout(() => {
            lockedRef.current = false;
            setLocked(false);
          }, remaining);
        }
      };
    },
    [minDelayMs],
  );

  return { locked, runLocked };
}
