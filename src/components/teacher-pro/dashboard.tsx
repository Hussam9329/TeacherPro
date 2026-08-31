"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { useTeacherStore, type SectionId } from "@/lib/teacher-store";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  AlertTriangle,
  BookOpen,
  CheckCircle2,
  Clock,
  Shield,
  Users,
} from "lucide-react";
import { EmptyState, StatCard } from "./ui-kit";
import {
  useTeacherProBackgroundSyncDetector,
  useTeacherProSyncKey,
} from "@/hooks/use-teacherpro-sync";
import { useLatestRequest } from "@/hooks/use-latest-request";
import { formatAuditLogDisplay } from "@/lib/audit-log-display";
import { humanizeTeacherProText } from "@/lib/teacherpro-language";

type DashboardAlert = {
  id: string;
  title: string;
  description: string;
  count: number;
  tone: "danger" | "warning" | "info" | "success";
  actionSection: SectionId;
  actionLabel: string;
  actionQuery?: Record<string, string>;
  sample?: string[];
};

type DashboardStats = {
  activeStudents: number;
  dismissedStudents: number;
  totalStudents: number;
  pendingCorrectionSheets: number;
  alerts: DashboardAlert[];
  recentLogs: Array<{
    id: string;
    module: string;
    action: string;
    details?: string | null;
    user?: string | null;
    userName?: string | null;
    time: string;
    summary?: string | null;
    actionLabel?: string | null;
    moduleLabel?: string | null;
    display?: {
      summary?: string | null;
      actionLabel?: string | null;
      moduleLabel?: string | null;
    } | null;
    entityLabels?: {
      students?: Record<string, string>;
      exams?: Record<string, string>;
    };
  }>;
  source: "database";
  generatedAt: string;
};

const alertToneClass: Record<DashboardAlert["tone"], string> = {
  danger: "border-rose-200 bg-rose-50/80 text-rose-900 dark:border-rose-900/60 dark:bg-rose-950/25 dark:text-rose-100",
  warning: "border-amber-200 bg-amber-50/80 text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/25 dark:text-amber-100",
  info: "border-sky-200 bg-sky-50/80 text-sky-900 dark:border-sky-900/60 dark:bg-sky-950/25 dark:text-sky-100",
  success: "border-emerald-200 bg-emerald-50/80 text-emerald-900 dark:border-emerald-900/60 dark:bg-emerald-950/25 dark:text-emerald-100",
};

const alertBadgeClass: Record<DashboardAlert["tone"], string> = {
  danger: "bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300",
  warning: "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300",
  info: "bg-sky-100 text-sky-700 dark:bg-sky-950 dark:text-sky-300",
  success: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300",
};

const dashboardActionQueryKeys = [
  "dashboardAlert",
  "examId",
  "filterStatus",
  "registryIssue",
  "dashboardDate",
  "status",
  "opportunityCount",
  "statusFilter",
] as const;

const alertFallbackQuery: Record<string, Record<string, string>> = {
  "exams-missing-grades": { filterStatus: "غير مسجل" },
  "students-without-active-chapter": {
    registryIssue: "no-active-chapter",
  },
  "today-leaves": { dashboardDate: "today" },
  "active-zero-opportunities": {
    status: "no-opportunities",
    opportunityCount: "0",
  },
  "dismissed-needs-pledge": { statusFilter: "pending" },
};

function baghdadDayKey(now = Date.now()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Baghdad",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(now));
}

function millisecondsUntilNextBaghdadDay(now = Date.now()) {
  const baghdadOffset = 3 * 60 * 60 * 1000;
  const shiftedNow = new Date(now + baghdadOffset);
  const nextMidnight = Date.UTC(
    shiftedNow.getUTCFullYear(),
    shiftedNow.getUTCMonth(),
    shiftedNow.getUTCDate() + 1,
  );
  return Math.max(1_000, nextMidnight - shiftedNow.getTime() + 1_000);
}

function humanizeAuditLabel(value: string | null | undefined, fallback: string) {
  const normalized = String(value || "")
    .replace(/[_-]+/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .trim();
  return humanizeTeacherProText(normalized) || fallback;
}

function humanizeAuditSummary(value: string | null | undefined) {
  const raw = String(value || "").trim();
  if (!raw || raw.startsWith("{") || raw.startsWith("[")) {
    return "تم تنفيذ العملية بدون تفاصيل إضافية قابلة للعرض.";
  }
  return humanizeTeacherProText(raw);
}

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
  const { setSection, canAccess } = useTeacherStore();
  const syncKey = useTeacherProSyncKey(["dashboard", "students", "grades", "opportunities", "exams", "correction"]);
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

  useEffect(() => {
    let timer = 0;
    let currentDay = baghdadDayKey();

    const scheduleNextDayRefresh = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        currentDay = baghdadDayKey();
        void loadStats({ background: true });
        scheduleNextDayRefresh();
      }, millisecondsUntilNextBaghdadDay());
    };

    const refreshAfterSuspension = () => {
      if (document.visibilityState !== "visible") return;
      const nextDay = baghdadDayKey();
      if (nextDay === currentDay) return;
      currentDay = nextDay;
      void loadStats({ background: true });
      scheduleNextDayRefresh();
    };

    scheduleNextDayRefresh();
    document.addEventListener("visibilitychange", refreshAfterSuspension);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", refreshAfterSuspension);
    };
  }, [loadStats]);

  const navigateFromDashboard = useCallback(
    (
      section: SectionId,
      options: { alertId?: string; query?: Record<string, string> } = {},
    ) => {
      if (!canAccess(section)) return;
      if (typeof window !== "undefined") {
        const nextUrl = new URL(window.location.href);
        for (const key of dashboardActionQueryKeys) {
          nextUrl.searchParams.delete(key);
        }
        nextUrl.searchParams.set("section", section);
        if (options.alertId) {
          nextUrl.searchParams.set("dashboardAlert", options.alertId);
        }
        for (const [key, value] of Object.entries(options.query || {})) {
          const cleanValue = String(value || "").trim();
          if (cleanValue) nextUrl.searchParams.set(key, cleanValue);
        }
        nextUrl.hash = "";
        window.history.pushState(
          { section, source: "dashboard" },
          "",
          nextUrl.toString(),
        );
      }
      React.startTransition(() => setSection(section));
    },
    [canAccess, setSection],
  );

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
    {
      label: "أوراق بانتظار التصحيح",
      value: stats?.pendingCorrectionSheets,
      icon: Clock,
      tone: "danger" as const,
      hint: "كل الأوراق غير المكتملة في بيانات النظام",
    },
  ];

  const recentLogs = stats?.recentLogs ?? [];
  const alerts = stats?.alerts ?? [];
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

      <div className="tp-dashboard__kpis grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
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

      <Card className="tp-dashboard__alerts overflow-hidden" aria-labelledby="dashboard-alerts-title">
        <CardHeader className="pb-2">
          <div>
            <CardTitle id="dashboard-alerts-title" className="flex items-center gap-2 text-base">
              <AlertTriangle className="size-5 text-amber-500" />
              تنبيهات إدارية
            </CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">
              مشاكل محسوبة من بيانات النظام حتى لا تختفي بسبب بيانات مؤقتة أو فلتر جزئي.
            </p>
          </div>
        </CardHeader>
        <CardContent>
          {initialLoading ? (
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-3" role="status">
              <span className="sr-only">جارٍ تحميل التنبيهات الإدارية.</span>
              {Array.from({ length: 3 }).map((_, index) => (
                <div key={index} aria-hidden="true" className="h-28 animate-pulse rounded-3xl border bg-muted/40" />
              ))}
            </div>
          ) : initialError ? (
            <EmptyState
              icon={AlertTriangle}
              title="تعذر عرض التنبيهات"
              description="التنبيهات لا تُحسب من بيانات محلية ناقصة. أعد المحاولة بعد التأكد من اتصال بيانات النظام."
              action={
                <Button type="button" variant="outline" onClick={() => void loadStats()}>
                  إعادة المحاولة
                </Button>
              }
            />
          ) : alerts.length === 0 ? (
            <EmptyState
              icon={CheckCircle2}
              title="لا توجد تنبيهات حرجة حالياً"
              description="لم ترجع بيانات النظام أي امتحانات ناقصة الدرجات، طلاب بلا فصل نشط، إجازات اليوم، فرص صفر، أو تعهدات معلقة."
            />
          ) : (
            <ul className="tp-dashboard__alert-grid grid list-none grid-cols-1 gap-4 p-0 lg:grid-cols-3">
              {alerts.map((alert) => (
                <li key={alert.id} className={cn("tp-dashboard__alert-card rounded-2xl border p-4", alertToneClass[alert.tone])}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-black">{alert.title}</p>
                      <p className="mt-1 text-xs leading-6 opacity-80">{alert.description}</p>
                      {alert.sample && alert.sample.length > 0 && (
                        <p className="mt-2 break-words text-xs font-bold opacity-80">
                          أمثلة: {alert.sample.join("، ")}
                        </p>
                      )}
                    </div>
                    <span className={cn("shrink-0 rounded-full px-3 py-1 text-sm font-black", alertBadgeClass[alert.tone])}>
                      {alert.count}
                    </span>
                  </div>
                  {canAccess(alert.actionSection) && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="tp-dashboard__alert-action mt-4 bg-background/75"
                      onClick={() =>
                        navigateFromDashboard(alert.actionSection, {
                          alertId: alert.id,
                          query: {
                            ...(alertFallbackQuery[alert.id] || {}),
                            ...(alert.actionQuery || {}),
                          },
                        })
                      }
                    >
                      {alert.actionLabel}
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {canAccess("logs") && (
      <Card className="tp-dashboard__activity">
        <CardHeader className="flex flex-col items-stretch justify-between gap-3 pb-2 sm:flex-row sm:items-center">
          <div>
            <CardTitle className="text-base">آخر الفعاليات</CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">
              أحدث عمليات النظام من بيانات النظام
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="w-full sm:w-auto"
            onClick={() => navigateFromDashboard("logs")}
          >
            عرض السجلات
          </Button>
        </CardHeader>
        <CardContent>
          <div className="tp-dashboard__activity-list space-y-3 px-1 py-1 md:max-h-[28rem] md:overflow-y-auto">
            {initialLoading ? (
              <div role="status">
                <span className="sr-only">جارٍ تحميل آخر الفعاليات.</span>
                {Array.from({ length: 3 }).map((_, index) => (
                  <div key={index} aria-hidden="true" className="mb-3 h-20 animate-pulse rounded-3xl border bg-muted/40" />
                ))}
              </div>
            ) : initialError ? (
              <EmptyState
                icon={AlertTriangle}
                title="تعذر تحميل آخر الفعاليات"
                description="لم يتمكن النظام من التحقق من سجل الفعاليات. أعد تحميل لوحة النظام."
                action={
                  <Button type="button" variant="outline" onClick={() => void loadStats()}>
                    إعادة المحاولة
                  </Button>
                }
              />
            ) : recentLogs.length === 0 ? (
              <EmptyState
                title="لا توجد فعاليات بعد"
                description="سيظهر سجل العمليات هنا بمجرد إضافة أو تعديل البيانات."
              />
            ) : (
              <ol className="space-y-3" aria-label="آخر فعاليات النظام">
              {recentLogs.map((log) => {
                const fallbackDisplay = formatAuditLogDisplay(log, log.entityLabels);
                const summary = humanizeAuditSummary(
                  log.summary || log.display?.summary || fallbackDisplay.summary,
                );
                const actionLabel = humanizeAuditLabel(
                  log.actionLabel || log.display?.actionLabel || log.action,
                  "عملية في النظام",
                );
                const moduleLabel = humanizeAuditLabel(
                  log.moduleLabel || log.display?.moduleLabel || log.module,
                  "النظام",
                );
                return (
                  <li
                    key={log.id}
                    className="tp-dashboard__activity-row list-row"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="break-words text-sm font-bold">{actionLabel}</p>
                        <p className="text-xs text-muted-foreground">
                          {humanizeAuditLabel(log.userName || log.user, "النظام")} - {moduleLabel} -{" "}
                          <time dateTime={log.time}>{formatStatsTime(log.time)}</time>
                        </p>
                      </div>
                      <span className="chip">نشاط</span>
                    </div>
                    <p className="mt-2 text-xs leading-6 text-muted-foreground">
                      {summary}
                    </p>
                  </li>
                );
              })}
              </ol>
            )}
          </div>
          {recentLogs.length > 0 && (
            <div className="mt-4 flex justify-center border-t border-border/60 pt-4">
              <Button
                variant="outline"
                size="sm"
                className="w-full sm:w-auto sm:min-w-56"
                onClick={() => navigateFromDashboard("logs")}
              >
                عرض المزيد من السجلات
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
      )}
    </div>
  );
}
