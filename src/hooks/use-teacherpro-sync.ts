"use client";

import { useEffect, useMemo, useState } from "react";
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

  useEffect(
    () =>
      subscribeTeacherProDataChanged((detail) => {
        if (!matchesScope(detail, normalizedScopes)) return;
        setKey((value) => value + 1);
      }),
    [normalizedScopes],
  );

  return key;
}
