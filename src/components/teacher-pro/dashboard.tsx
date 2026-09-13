"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { BookOpen, Shield, Users } from "lucide-react";
import { StatCard } from "./ui-kit";
import {
  useTeacherProBackgroundSyncDetector,
  useTeacherProSyncKey,
} from "@/hooks/use-teacherpro-sync";
import { useLatestRequest } from "@/hooks/use-latest-request";

type DashboardStats = {
  activeStudents: number;
  dismissedStudents: number;
  totalStudents: number;
  source: "database";
  generatedAt: string;
};

function formatStatsTime(value?: string) {
  if (!value) return "—";
  try {
    return new Intl.DateTimeFormat("ar-IQ", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: "Asia/Baghdad",
      numberingSystem: "latn",
    }).format(new Date(value));
  } catch {
    return value;
  }
}

export function DashboardView() {
  const syncKey = useTeacherProSyncKey(["dashboard", "students", "grades", "opportunities", "exams"]);
  const isBackgroundSync = useTeacherProBackgroundSyncDetector(syncKey);
  const beginStatsRequest = useLatestRequest();
  const statsLoadedRef = useRef(false);

  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [statsLoading, setStatsLoading] = useState(true);
  const [statsRefreshing, setStatsRefreshing] = useState(false);
  const [statsError, setStatsError] = useState("");

  const loadStats = useCallback(
    async (options: { background?: boolean } = {}) => {
      const request = beginStatsRequest();
      const background = Boolean(options.background || statsLoadedRef.current);
      if (background) {
        setStatsRefreshing(true);
      } else {
        setStatsLoading(true);
        setStatsRefreshing(false);
      }
      setStatsError("");
      try {
        const res = await fetch("/api/stats", {
          credentials: "same-origin",
          cache: "no-store",
          signal: request.signal,
        });
        const data = await res.json().catch(() => null);
        if (!res.ok) {
          throw new Error(data?.error || "تعذر تحميل الإحصائيات من بيانات النظام.");
        }
        if (!request.isLatest()) return;
        setStats(data as DashboardStats);
        statsLoadedRef.current = true;
      } catch (error) {
        if (!request.isLatest()) return;
        setStatsError(
          error instanceof Error
            ? error.message
            : "تعذر تحميل الإحصائيات من بيانات النظام.",
        );
        if (!background) setStats(null);
      } finally {
        if (request.isLatest()) {
          setStatsLoading(false);
          setStatsRefreshing(false);
        }
      }
    },
    [beginStatsRequest],
  );

  useEffect(() => {
    void loadStats({ background: isBackgroundSync() });
  }, [isBackgroundSync, loadStats, syncKey]);

  const kpiCards = [
    {
      label: "طلاب نشطون",
      value: stats?.activeStudents,
      icon: Users,
      tone: "success" as const,
      hint: "عدّ مباشر من بيانات النظام",
    },
    {
      label: "طلاب مفصولون",
      value: stats?.dismissedStudents,
      icon: Shield,
      tone: "warning" as const,
      hint: "عدّ مباشر من بيانات النظام",
    },
    {
      label: "إجمالي الطلاب",
      value: stats?.totalStudents,
      icon: BookOpen,
      tone: "info" as const,
      hint: "كل الطلاب المسجلين في بيانات النظام",
    },
  ];

  const initialLoading = statsLoading && !stats;
  const initialError = Boolean(statsError && !stats);
  const staleData = Boolean(statsError && stats);
  const dashboardState = initialLoading
    ? "loading"
    : initialError
      ? "error"
      : staleData
        ? "stale"
        : "ready";

  return (
    <div
      className="section-stack tp-dashboard"
      data-dashboard-state={dashboardState}
      aria-busy={initialLoading || statsRefreshing}
    >
      <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {initialLoading
          ? "جارٍ تحميل بيانات لوحة النظام."
          : statsRefreshing
            ? "جارٍ تحديث بيانات لوحة النظام."
            : statsError
              ? statsError
              : stats
                ? `اكتمل تحديث لوحة النظام في ${formatStatsTime(stats.generatedAt)}.`
                : ""}
      </div>

      {initialError && (
        <div
          role="alert"
          className="flex flex-col gap-3 rounded-2xl border border-destructive/35 bg-destructive/10 p-4 text-sm text-destructive sm:flex-row sm:items-center sm:justify-between"
        >
          <div>
            <p className="font-black">تعذر تحميل لوحة النظام</p>
            <p className="mt-1 leading-6">{statsError}</p>
          </div>
          <Button type="button" variant="outline" onClick={() => void loadStats()}>
            إعادة المحاولة
          </Button>
        </div>
      )}

      {staleData && (
        <div
          role="alert"
          className="flex flex-col gap-3 rounded-2xl border border-amber-300/70 bg-amber-50 p-4 text-sm text-amber-950 dark:border-amber-800 dark:bg-amber-950/35 dark:text-amber-100 sm:flex-row sm:items-center sm:justify-between"
        >
          <div>
            <p className="font-black">تعذر جلب التحديث الجديد</p>
            <p className="mt-1 leading-6">
              الأرقام المعروضة هي آخر نسخة ناجحة من {formatStatsTime(stats?.generatedAt)}، وليست تحديثاً حالياً.
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            onClick={() => void loadStats({ background: true })}
          >
            إعادة المحاولة
          </Button>
        </div>
      )}

      {!initialError && stats && (
        <p className="text-xs text-muted-foreground" aria-live="polite">
          {statsRefreshing ? "جارٍ تحديث الأرقام…" : `آخر تحديث: ${formatStatsTime(stats.generatedAt)}`}
        </p>
      )}

      <div className="tp-dashboard__kpis grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {kpiCards.map((card) => (
          <StatCard
            key={card.label}
            label={card.label}
            value={initialLoading ? "…" : card.value ?? "—"}
            icon={card.icon}
            tone={card.tone}
            hint={card.hint}
          />
        ))}
      </div>
    </div>
  );
}
