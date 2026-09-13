"use client";

import { useCallback, useEffect, useRef, useState, type MouseEvent } from "react";
import { Button } from "@/components/ui/button";
import {
  ArrowLeft,
  BookOpen,
  CalendarCheck,
  ChartColumn,
  ClipboardList,
  FilePlus2,
  PenLine,
  PhoneCall,
  Shield,
  ShieldAlert,
  Target,
  Users,
} from "lucide-react";
import { StatCard } from "./ui-kit";
import { useTeacherStore, type SectionId } from "@/lib/teacher-store";
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

const dashboardShortcuts = [
  { section: "student-registry", title: "سجل الطلاب", icon: ClipboardList, color: "bg-violet-500/10 text-violet-700 dark:text-violet-300" },
  { section: "opportunities", title: "إدارة الفرص", icon: Target, color: "bg-amber-500/10 text-amber-700 dark:text-amber-300" },
  { section: "dismissed-management", title: "إدارة المفصولين", icon: ShieldAlert, color: "bg-rose-500/10 text-rose-700 dark:text-rose-300" },
  { section: "grade-entry", title: "تسجيل الدرجات", icon: PenLine, color: "bg-sky-500/10 text-sky-700 dark:text-sky-300" },
  { section: "grade-records", title: "سجل الدرجات", icon: ChartColumn, color: "bg-cyan-500/10 text-cyan-700 dark:text-cyan-300" },
  { section: "exam-new", title: "إضافة امتحان", icon: FilePlus2, color: "bg-indigo-500/10 text-indigo-700 dark:text-indigo-300" },
  { section: "follow-up-calls", title: "المكالمات", icon: PhoneCall, color: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" },
  { section: "follow-up-leaves", title: "الإجازات", icon: CalendarCheck, color: "bg-teal-500/10 text-teal-700 dark:text-teal-300" },
] as const;

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

export function DashboardView({
  onSectionLinkClick,
}: {
  onSectionLinkClick?: (event: MouseEvent<HTMLAnchorElement>, section: SectionId) => void;
} = {}) {
  const { canAccess } = useTeacherStore();
  const visibleShortcuts = dashboardShortcuts.filter((shortcut) => canAccess(shortcut.section));
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

      {visibleShortcuts.length > 0 && (
        <nav aria-label="اختصارات لوحة التحكم" className="space-y-3">
          <h3 className="text-base font-bold">الوصول السريع</h3>
          <div className="tp-dashboard__shortcuts grid grid-cols-1 gap-3 min-[360px]:grid-cols-2 md:grid-cols-3 xl:grid-cols-4">
            {visibleShortcuts.map(({ section, title, icon: Icon, color }) => (
              <a
                key={section}
                href={`/?section=${section}`}
                onClick={(event) => onSectionLinkClick?.(event, section)}
                className="tp-dashboard__shortcut group flex min-h-36 min-w-0 flex-col justify-between gap-5 rounded-2xl border border-border/80 bg-card p-4 text-start text-card-foreground shadow-sm transition-[background-color,border-color,box-shadow] hover:border-primary/40 hover:bg-accent/30 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background motion-reduce:transition-none sm:p-5"
              >
                <span className={`flex size-12 items-center justify-center rounded-2xl ${color}`} aria-hidden="true">
                  <Icon className="size-6" />
                </span>
                <span className="flex min-w-0 items-center justify-between gap-2">
                  <span className="min-w-0 break-words text-sm font-bold leading-6 sm:text-base">{title}</span>
                  <ArrowLeft className="size-4 shrink-0 text-muted-foreground group-hover:text-primary" aria-hidden="true" />
                </span>
              </a>
            ))}
          </div>
        </nav>
      )}
    </div>
  );
}
