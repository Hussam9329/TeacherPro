"use client";

import { useCallback, useEffect, useRef, useState, type MouseEvent } from "react";
import { Button } from "@/components/ui/button";
import {
  BookOpen,
  CalendarCheck,
  CalendarClock,
  ChartColumn,
  ClipboardList,
  FilePlus2,
  ListChecks,
  LockKeyhole,
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
import { CodeClosuresDialog } from "./code-closures-dialog";
import { GracePeriodsDialog } from "./grace-periods-dialog";
// One look for the three management windows opened from here.
import "./tp-modal.css";

type DashboardStats = {
  activeStudents: number;
  dismissedStudents: number;
  totalStudents: number;
  source: "database";
  generatedAt: string;
};

const dashboardShortcuts = [
  { section: "student-registry", title: "سجل الطلاب", icon: ClipboardList, color: "bg-primary/10 text-primary" },
  { section: "student-bulk-import", title: "إضافة الطلاب الجماعية", icon: UsersRound, color: "bg-primary/10 text-primary" },
  { section: "opportunities", title: "إدارة الفرص", icon: Target, color: "bg-warning-soft text-warning" },
  { section: "dismissed-management", title: "إدارة المفصولين", icon: ShieldAlert, color: "bg-danger-soft text-danger" },
  { section: "grade-entry", title: "تسجيل الدرجات", icon: PenLine, color: "bg-info-soft text-info" },
  { section: "grade-records", title: "سجل الدرجات", icon: ChartColumn, color: "bg-info-soft text-info" },
  { section: "exam-new", title: "إضافة امتحان", icon: FilePlus2, color: "bg-info-soft text-info" },
  { section: "follow-up-calls", title: "المكالمات", icon: PhoneCall, color: "bg-success-soft text-success" },
  { section: "follow-up-leaves", title: "الإجازات", icon: CalendarCheck, color: "bg-success-soft text-success" },
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
  const canViewCodeClosures = canAccess("student-registry") || canAccess("dismissed-management");
  const canManageCodeClosures = Boolean(actor && (
    actor.username?.trim().toLowerCase() === "admin" ||
    actor.roleId === "role_admin" ||
    actor.permissions?.includes("students.edit") ||
    actor.permissions?.includes("students.dismiss") ||
    actor.permissions?.includes("students.reactivate")
  ));
  const [codeClosuresOpen, setCodeClosuresOpen] = useState(false);
  // «إدارة فترة السماح» is the only place that creates, edits or cancels grace.
  const canViewGracePeriods = canAccess("student-registry");
  const canManageGracePeriods = Boolean(actor && (
    actor.username?.trim().toLowerCase() === "admin" ||
    actor.roleId === "role_admin" ||
    actor.permissions?.includes("students.edit")
  ));
  const [gracePeriodsOpen, setGracePeriodsOpen] = useState(false);
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
      color: "bg-success-soft text-success",
    },
    {
      label: "طلاب مفصولون",
      value: stats?.dismissedStudents,
      icon: Shield,
      color: "bg-danger-soft text-danger",
    },
    {
      label: "إجمالي الطلاب",
      value: stats?.totalStudents,
      icon: BookOpen,
      color: "bg-info-soft text-info",
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
          className="flex flex-col gap-3 rounded-2xl border border-warning-line bg-warning-soft p-4 text-sm text-warning sm:flex-row sm:items-center sm:justify-between"
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

      {(visibleShortcuts.length > 0 || canViewCallNotes || canViewCodeClosures || canViewGracePeriods) && (
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
                <span className="tp-dashboard__shortcut-icon bg-success-soft text-success" aria-hidden="true">
                  <ListChecks />
                </span>
                <span className="tp-dashboard__shortcut-label">إدارة ملاحظات المكالمات</span>
              </button>
            )}
            {canViewCodeClosures && (
              <button
                type="button"
                onClick={() => setCodeClosuresOpen(true)}
                aria-haspopup="dialog"
                className="tp-dashboard__shortcut text-card-foreground hover:border-primary/40 hover:bg-accent/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background motion-reduce:transition-none"
              >
                <span className="tp-dashboard__shortcut-icon bg-danger-soft text-danger" aria-hidden="true">
                  <LockKeyhole />
                </span>
                <span className="tp-dashboard__shortcut-label">اغلاق الكودات</span>
              </button>
            )}
            {canViewGracePeriods && (
              <button
                type="button"
                onClick={() => setGracePeriodsOpen(true)}
                aria-haspopup="dialog"
                className="tp-dashboard__shortcut text-card-foreground hover:border-primary/40 hover:bg-accent/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background motion-reduce:transition-none"
              >
                <span className="tp-dashboard__shortcut-icon bg-success-soft text-success" aria-hidden="true">
                  <CalendarClock />
                </span>
                <span className="tp-dashboard__shortcut-label">إدارة فترة السماح</span>
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
      {canViewGracePeriods && (
        <GracePeriodsDialog
          key={`grace-${actor?.id || ""}`}
          open={gracePeriodsOpen}
          onOpenChange={setGracePeriodsOpen}
          canManage={canManageGracePeriods}
        />
      )}
      {canViewCodeClosures && (
        <CodeClosuresDialog
          key={actor?.id}
          open={codeClosuresOpen}
          onOpenChange={setCodeClosuresOpen}
          canManage={canManageCodeClosures}
        />
      )}
    </div>
  );
}
