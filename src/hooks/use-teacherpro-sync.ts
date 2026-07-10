"use client";

import { startTransition, useEffect, useMemo, useRef, useState } from "react";
import {
  subscribeTeacherProDataChanged,
  type TeacherProDataChangedDetail,
} from "@/lib/teacherpro-sync";

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

export function useTeacherProSyncKey(scopes?: string | string[]): number {
  const normalizedScopes = useMemo(() => {
    if (!scopes) return null;
    const list = Array.isArray(scopes) ? scopes : [scopes];
    return list.map((scope) => scope.trim()).filter(Boolean);
  }, [Array.isArray(scopes) ? scopes.join("|") : scopes]);

  const [key, setKey] = useState(0);
  const timerRef = useRef<ReturnType<typeof window.setTimeout> | null>(null);

  useEffect(() => {
    const flush = () => {
      if (timerRef.current) window.clearTimeout(timerRef.current);
      timerRef.current = window.setTimeout(() => {
        timerRef.current = null;
        startTransition(() => {
          setKey((value) => value + 1);
        });
      }, 120) as unknown as ReturnType<typeof window.setTimeout>;
    };

    const unsubscribe = subscribeTeacherProDataChanged((detail) => {
      if (!matchesScope(detail, normalizedScopes)) return;
      flush();
    });

    return () => {
      unsubscribe();
      if (timerRef.current) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [normalizedScopes]);

  return key;
}
