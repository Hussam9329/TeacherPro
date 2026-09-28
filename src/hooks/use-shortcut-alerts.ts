"use client";

import { useEffect, useState } from "react";
import { useTeacherProSyncKey } from "@/hooks/use-teacherpro-sync";

/** Mirrors GET /api/stats/alerts. null = this account cannot open that window. */
export type ShortcutAlerts = {
  callNotesPending: number | null;
  gradeReviewsPending: number | null;
  dismissedStudents: number | null;
  codeClosuresPending: number | null;
  currentLeaves: number | null;
  currentGracePeriods: number | null;
  generatedAt: string;
};

const REFRESH_EVERY_MS = 120_000;
const FOCUS_STALE_MS = 30_000;

// One copy for the whole page: the sidebar and the dashboard show the same numbers.
let current: ShortcutAlerts | null = null;
let inflight: Promise<void> | null = null;
let loadedAt = 0;
const listeners = new Set<(alerts: ShortcutAlerts) => void>();

/** Reload the numbers now, e.g. after a window that changes them closes. */
export function refreshShortcutAlerts(): Promise<void> {
  if (inflight) return inflight;
  inflight = fetch("/api/stats/alerts", { credentials: "same-origin", cache: "no-store" })
    .then((res) => (res.ok ? (res.json() as Promise<ShortcutAlerts>) : null))
    .then((alerts) => {
      if (!alerts) return;
      current = alerts;
      listeners.forEach((listener) => listener(alerts));
    })
    .catch(() => undefined)
    .finally(() => {
      loadedAt = Date.now();
      inflight = null;
    });
  return inflight;
}

export function useShortcutAlerts(enabled = true): ShortcutAlerts | null {
  const [alerts, setAlerts] = useState<ShortcutAlerts | null>(current);
  const syncKey = useTeacherProSyncKey(["students", "dismissed", "grades", "follow-up", "exams", "dashboard"]);

  useEffect(() => {
    listeners.add(setAlerts);
    if (current) setAlerts(current);
    return () => {
      listeners.delete(setAlerts);
    };
  }, []);

  useEffect(() => {
    if (enabled) void refreshShortcutAlerts();
  }, [enabled, syncKey]);

  useEffect(() => {
    if (!enabled) return;
    const refreshIfStale = () => {
      if (document.visibilityState === "visible" && Date.now() - loadedAt > FOCUS_STALE_MS) {
        void refreshShortcutAlerts();
      }
    };
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void refreshShortcutAlerts();
    }, REFRESH_EVERY_MS);
    window.addEventListener("focus", refreshIfStale);
    document.addEventListener("visibilitychange", refreshIfStale);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", refreshIfStale);
      document.removeEventListener("visibilitychange", refreshIfStale);
    };
  }, [enabled]);

  return enabled ? alerts : null;
}
