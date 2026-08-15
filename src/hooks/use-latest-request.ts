"use client";

import { useCallback, useEffect, useRef } from "react";

export type LatestRequestHandle = {
  signal: AbortSignal;
  sequence: number;
  isLatest: () => boolean;
};

/**
 * One request owner per component. Starting a newer request aborts the previous
 * one and stale completions are ignored even if an endpoint cannot be aborted.
 */
export function useLatestRequest() {
  const sequenceRef = useRef(0);
  const controllerRef = useRef<AbortController | null>(null);

  const cancel = useCallback(() => {
    controllerRef.current?.abort();
    controllerRef.current = null;
  }, []);

  useEffect(() => cancel, [cancel]);

  return useCallback((): LatestRequestHandle => {
    cancel();
    const controller = new AbortController();
    const sequence = ++sequenceRef.current;
    controllerRef.current = controller;
    return {
      signal: controller.signal,
      sequence,
      isLatest: () =>
        !controller.signal.aborted && sequence === sequenceRef.current,
    };
  }, [cancel]);
}
