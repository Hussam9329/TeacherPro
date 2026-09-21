"use client";

import { useCallback, useEffect, useRef, useState, type MouseEvent } from "react";
import { Button } from "@/components/ui/button";
import {
  BookOpen,
  CalendarCheck,
  ChartColumn,
  ClipboardList,
  FilePlus2,
  ListChecks,
  PenLine,
  PhoneCall,
  Shield,
  ShieldAlert,
  Target,
  Users,
  UsersRound,
} from "lucide-react";
import { useTeacherStore, type SectionId } from "@/lib/teacher-store";
import {
  useTeacherProBackgroundSyncDetector,
  useTeacherProSyncKey,
} from "@/hooks/use-teacherpro-sync";
import { useLatestRequest } from "@/hooks/use-latest-request";
import { CallNotesManagementDialog } from "./call-notes-management-dialog";

type DashboardStats = {
  activeStudents: number;
  dismissedStudents: number;
  totalStudents: number;
  source: "database";
  generatedAt: string;
};

const dashboardShortcuts = [
  { section: "student-registry", title: "سجل الطلاب", icon: ClipboardList, color: "bg-violet-500/10 text-violet-700 dark:text-violet-300" },
  { section: "student-bulk-import", title: "إضافة الطلاب الجماعية", icon: UsersRound, color: "bg-purple-500/10 text-purple-700 dark:text-purple-300" },
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
  const { canAccess, currentUser } = useTeacherStore();
  const visibleShortcuts = dashboardShortcuts.filter((shortcut) => canAccess(shortcut.section));
  const canViewCallNotes = canAccess("follow-up-calls");
  const actor = currentUser();
  const canManageCallNotes = Boolean(actor && (
    actor.username?.trim().toLowerCase() === "admin" ||
    actor.roleId === "role_admin" ||
    actor.permissions?.includes("follow-up.calls.manage") ||
    actor.permissions?.includes("follow-up.manage")
  ));
  const [callNotesOpen, setCallNotesOpen] = useState(false);
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
          throw new Error(data?.error || "تعذر تحميل الإحصائيات.");
        }
        if (!request.isLatest()) return;
        setStats(data as DashboardStats);
        statsLoadedRef.current = true;
      } catch (error) {
        if (!request.isLatest()) return;
        setStatsError(
          error instanceof Error
            ? error.message
            : "تعذر تحميل الإحصائيات.",
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
      color: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
    },
    {
      label: "طلاب مفصولون",
      value: stats?.dismissedStudents,
      icon: Shield,
      color: "bg-amber-500/10 text-amber-700 dark:text-amber-300",
    },
    {
      label: "إجمالي الطلاب",
      value: stats?.totalStudents,
      icon: BookOpen,
      color: "bg-sky-500/10 text-sky-700 dark:text-sky-300",
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
      className="tp-dashboard"
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
        <p className="tp-dashboard__updated text-muted-foreground" aria-live="polite">
          {statsRefreshing ? "جارٍ تحديث الأرقام…" : `آخر تحديث: ${formatStatsTime(stats.generatedAt)}`}
        </p>
      )}

      <div className="tp-dashboard__kpis" role="group" aria-label="إحصائيات الطلاب">
        {kpiCards.map(({ label, value, icon: Icon, color }) => (
          <div key={label} className="tp-dashboard__stat" data-count-scope="system">
            <span className={`tp-dashboard__stat-icon ${color}`} aria-hidden="true">
              <Icon />
            </span>
            <div className="tp-dashboard__stat-copy">
              <p className="tp-dashboard__stat-label text-muted-foreground">{label}</p>
              <p className="tp-dashboard__stat-value">{initialLoading ? "…" : value ?? "—"}</p>
            </div>
          </div>
        ))}
      </div>

      {(visibleShortcuts.length > 0 || canViewCallNotes) && (
        <nav aria-label="اختصارات لوحة التحكم" className="tp-dashboard__navigation">
          <h3 className="text-sm font-bold">الوصول السريع</h3>
          <div className="tp-dashboard__shortcuts">
            {visibleShortcuts.map(({ section, title, icon: Icon, color }) => (
              <a
                key={section}
                href={`/?section=${section}`}
                onClick={(event) => onSectionLinkClick?.(event, section)}
                className="tp-dashboard__shortcut text-card-foreground hover:border-primary/40 hover:bg-accent/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background motion-reduce:transition-none"
              >
                <span className={`tp-dashboard__shortcut-icon ${color}`} aria-hidden="true">
                  <Icon />
                </span>
                <span className="tp-dashboard__shortcut-label">{title}</span>
              </a>
            ))}
            {canViewCallNotes && (
              <button
                type="button"
                onClick={() => setCallNotesOpen(true)}
                aria-haspopup="dialog"
                className="tp-dashboard__shortcut text-card-foreground hover:border-primary/40 hover:bg-accent/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background motion-reduce:transition-none"
              >
                <span className="tp-dashboard__shortcut-icon bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" aria-hidden="true">
                  <ListChecks />
                </span>
                <span className="tp-dashboard__shortcut-label">إدارة ملاحظات المكالمات</span>
              </button>
            )}
          </div>
        </nav>
      )}
      {canViewCallNotes && (
        <CallNotesManagementDialog
          open={callNotesOpen}
          onOpenChange={setCallNotesOpen}
          canManage={canManageCallNotes}
        />
      )}
    </div>
  );
}
