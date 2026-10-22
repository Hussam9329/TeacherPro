"use client";

import { formatBaghdadDateTime } from "@/lib/baghdad-time";
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
  MessageSquareText,
  PenLine,
  PhoneCall,
  Shield,
  ShieldAlert,
  Target,
  Users,
  UsersRound,
  Zap,
} from "lucide-react";
import { useTeacherStore, type SectionId } from "@/lib/teacher-store";
import { useShallow } from "zustand/react/shallow";
import {
  useTeacherProBackgroundSyncDetector,
  useTeacherProSyncKey,
} from "@/hooks/use-teacherpro-sync";
import { useLatestRequest } from "@/hooks/use-latest-request";
import { refreshShortcutAlerts, useShortcutAlerts } from "@/hooks/use-shortcut-alerts";
import { CallNotesManagementDialog } from "./call-notes-management-dialog";
import { CallsDialog } from "./calls-dialog";
import { CodeClosuresDialog } from "./code-closures-dialog";
import { GracePeriodsDialog } from "./grace-periods-dialog";
import { LeavesDialog, LEAVES_DIALOG_OPEN_EVENT, LEAVES_DIALOG_QUERY } from "./leaves-dialog";
import { TextShortcutsDialog } from "./text-shortcuts-dialog";
import { StudentTrendChart } from "./student-trend-chart";
// One look for the management windows opened from here.
import "./tp-modal.css";

type DashboardStats = {
  activeStudents: number;
  dismissedStudents: number;
  /** Archived students; part of the total on the dashboard. */
  archivedStudents?: number;
  totalStudents: number;
  source: "database";
  generatedAt: string;
};

const dashboardShortcuts = [
  { section: "student-registry", title: "سجل الطلاب", icon: ClipboardList, tone: "info" },
  { section: "student-bulk-import", title: "إضافة الطلاب الجماعية", icon: UsersRound, tone: "success" },
  { section: "opportunities", title: "إدارة الفرص", icon: Target, tone: "warning" },
  { section: "dismissed-management", title: "إدارة المفصولين", icon: ShieldAlert, tone: "danger" },
  { section: "grade-entry", title: "تسجيل الدرجات", icon: PenLine, tone: "info" },
  { section: "grade-records", title: "سجل الدرجات", icon: ChartColumn, tone: "info" },
  { section: "exam-new", title: "إضافة امتحان", icon: FilePlus2, tone: "success" },
] as const;

type AlertTone = "danger" | "warning" | "info";

/** A notification number on a shortcut; the design of the shortcut stays. */
function ShortcutAlert({ count, tone, label }: { count: number | null | undefined; tone: AlertTone; label: string }) {
  if (!count) return null;
  return (
    <>
      <span className="tp-dashboard__alert" data-alert-tone={tone} aria-hidden="true">
        {count > 99 ? "99+" : count}
      </span>
      <span className="sr-only">، {count} {label}</span>
    </>
  );
}

function formatStatsTime(value?: string) {
  return formatBaghdadDateTime(value);
}

/** «توزيع الطلبة حسب الحالة»: a ring of the total, split by status. */
function StudentStatusDonut({ stats, loading }: { stats: DashboardStats | null; loading: boolean }) {
  const total = stats?.totalStudents ?? 0;
  const parts = stats
    ? [
        { key: "active", label: "نشطون", value: stats.activeStudents, color: "var(--chart-2)" },
        { key: "dismissed", label: "مفصولون", value: stats.dismissedStudents, color: "var(--chart-4)" },
        { key: "archived", label: "مؤرشفون", value: stats.archivedStudents ?? 0, color: "var(--chart-archived)" },
        {
          key: "other",
          label: "حالات أخرى",
          value: Math.max(0, stats.totalStudents - stats.activeStudents - stats.dismissedStudents - (stats.archivedStudents ?? 0)),
          color: "var(--tp-soft)",
        },
      ].filter((part) => part.key !== "other" || part.value > 0)
    : [];
  const [focused, setFocused] = useState<string | null>(null);
  const share = (value: number) => (total ? (value / total) * 100 : 0);
  const percent = (value: number) => `${share(value).toFixed(1)}%`;

  // Each part is a true ring sector (its real share), with a thin even gap
  // between parts; a very small part still keeps a visible sliver.
  const OUTER = 86;
  const INNER = 64;
  const shown = parts.filter((part) => part.value > 0);
  const pad = shown.length > 1 ? 1.6 : 0;
  const point = (r: number, degrees: number) => {
    const radians = (degrees * Math.PI) / 180;
    return `${(90 + r * Math.sin(radians)).toFixed(3)} ${(90 - r * Math.cos(radians)).toFixed(3)}`;
  };
  const sector = (from: number, to: number) => {
    const large = to - from > 180 ? 1 : 0;
    return `M ${point(OUTER, from)} A ${OUTER} ${OUTER} 0 ${large} 1 ${point(OUTER, to)} L ${point(INNER, to)} A ${INNER} ${INNER} 0 ${large} 0 ${point(INNER, from)} Z`;
  };
  let start = 0;
  const arcs = shown.map((part) => {
    const sweep = total ? (part.value / total) * 360 : 0;
    const from = start + pad / 2;
    const to = Math.max(from + 1.4, start + sweep - pad / 2);
    start += sweep;
    // A single part fills the ring: two halves, since one arc cannot close.
    const d = sweep >= 359.9 ? `${sector(0, 180)} ${sector(180, 359.999)}` : sector(from, to);
    return { ...part, d };
  });
  const active = parts.find((part) => part.key === focused) || null;

  return (
    <section className="tp-dashboard__panel tp-donut" aria-labelledby="tp-donut-title">
      <header className="tp-dashboard__panel-head">
        <h3 id="tp-donut-title" className="tp-dashboard__panel-title">توزيع الطلبة حسب الحالة</h3>
      </header>
      <div className="tp-donut__body">
        <div className="tp-donut__ring" data-focused={focused || undefined} onMouseLeave={() => setFocused(null)}>
          <svg viewBox="0 0 180 180" role="img" aria-label={parts.map((part) => `${part.label} ${part.value} (${percent(part.value)})`).join("، ")}>
            <circle cx="90" cy="90" r={(OUTER + INNER) / 2} className="tp-donut__track" strokeWidth={OUTER - INNER} />
            <circle cx="90" cy="90" r={INNER - 7} className="tp-donut__hub" />
            {arcs.map((arc) => (
              <path
                key={arc.key}
                d={arc.d}
                fill={arc.color}
                className="tp-donut__arc"
                data-dim={focused && focused !== arc.key ? true : undefined}
                data-on={focused === arc.key ? true : undefined}
                onMouseEnter={() => setFocused(arc.key)}
              />
            ))}
          </svg>
          <div className="tp-donut__center" aria-hidden={active ? true : undefined}>
            {active ? (
              <>
                <span className="tp-donut__total" style={{ color: active.color }}>{active.value.toLocaleString("en-US")}</span>
                <span className="tp-donut__caption">{active.label}</span>
                <span className="tp-donut__share">{percent(active.value)}</span>
              </>
            ) : (
              <>
                <span className="tp-donut__total">{loading && !stats ? "…" : total.toLocaleString("en-US")}</span>
                <span className="tp-donut__caption">إجمالي الطلبة</span>
              </>
            )}
          </div>
        </div>
        <ul className="tp-donut__legend">
          {parts.map((part) => (
            <li
              key={part.key}
              data-on={focused === part.key ? true : undefined}
              onMouseEnter={() => setFocused(part.key)}
              onMouseLeave={() => setFocused(null)}
            >
              <span className="tp-donut__dot" style={{ background: part.color }} aria-hidden="true" />
              <span className="tp-donut__label">{part.label}</span>
              <span className="tp-donut__value">{part.value.toLocaleString("en-US")}</span>
              <span className="tp-donut__percent">{percent(part.value)}</span>
              <span className="tp-donut__bar" aria-hidden="true">
                <span style={{ inlineSize: `${Math.max(share(part.value), part.value > 0 ? 1.5 : 0)}%`, background: part.color }} />
              </span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

export function DashboardView({
  onSectionLinkClick,
}: {
  onSectionLinkClick?: (event: MouseEvent<HTMLAnchorElement>, section: SectionId) => void;
} = {}) {
  const { canAccess, currentUser } = useTeacherStore(
    useShallow((state) => ({ canAccess: state.canAccess, currentUser: state.currentUser, /* re-render when these change: */ users: state.users, currentUserId: state.currentUserId, isAuthenticated: state.isAuthenticated })),
  );
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
  // «إدارة المكالمات» opens the calls work list here; the calls tab stays too.
  const [callsOpen, setCallsOpen] = useState(false);
  // Student tools need the full «عرض الطلاب»; «عرض سجل الطلاب فقط» opens the
  // registry and nothing else. dismissed-management is gated by students.view.
  const hasFullStudentsView = canAccess("dismissed-management");
  const canViewCodeClosures = hasFullStudentsView;
  // The quick contact edits on the cards are the student edit itself.
  // «إحصائيات المكالمات»: the admin («مدير عام») and the supervisors.
  const canSeeCallStats = Boolean(actor && (
    actor.username?.trim().toLowerCase() === "admin" ||
    actor.roleId === "role_admin" ||
    actor.permissions?.includes("system.oversight")
  ));
  // «اختصارات»: the ready texts of the admin and the supervisors.
  const canUseTextShortcuts = Boolean(actor && (
    actor.username?.trim().toLowerCase() === "admin" ||
    actor.roleId === "role_admin" ||
    actor.permissions?.includes("system.oversight")
  ));
  const [textShortcutsOpen, setTextShortcutsOpen] = useState(false);
  const canEditStudents = Boolean(actor && (
    actor.username?.trim().toLowerCase() === "admin" ||
    actor.roleId === "role_admin" ||
    actor.permissions?.includes("students.edit")
  ));
  // «انسحاب» archives the student: the same permission as «أرشفة».
  const canWithdrawStudents = Boolean(actor && (
    actor.username?.trim().toLowerCase() === "admin" ||
    actor.roleId === "role_admin" ||
    actor.permissions?.includes("students.delete")
  ));
  const canManageCodeClosures = Boolean(actor && (
    actor.username?.trim().toLowerCase() === "admin" ||
    actor.roleId === "role_admin" ||
    actor.permissions?.includes("students.edit") ||
    actor.permissions?.includes("students.dismiss") ||
    actor.permissions?.includes("students.reactivate")
  ));
  const [codeClosuresOpen, setCodeClosuresOpen] = useState(false);
  // «إدارة فترة السماح» is the only place that creates, edits or cancels grace.
  // «إدارة فترة السماح»: its own permissions («موظف فترات السماح»), or the
  // full students view / editing students as before.
  const canViewGracePeriods = (canAccess("student-registry") && hasFullStudentsView) ||
    Boolean(actor?.permissions?.includes("grace-periods.view"));
  const canManageGracePeriods = Boolean(actor && (
    actor.username?.trim().toLowerCase() === "admin" ||
    actor.roleId === "role_admin" ||
    actor.permissions?.includes("students.edit") ||
    actor.permissions?.includes("grace-periods.manage")
  ));
  const [gracePeriodsOpen, setGracePeriodsOpen] = useState(false);
  // «إدارة الإجازات» replaced the old leaves tab; its old links open this window.
  const canViewLeaves = canAccess("follow-up-leaves");
  const canManageLeaves = Boolean(actor && (
    actor.username?.trim().toLowerCase() === "admin" ||
    actor.roleId === "role_admin" ||
    actor.permissions?.includes("follow-up.leaves.manage") ||
    actor.permissions?.includes("follow-up.manage")
  ));
  const [leavesOpen, setLeavesOpen] = useState(false);
  useEffect(() => {
    if (!canViewLeaves) return;
    const openFromLink = () => {
      const url = new URL(window.location.href);
      if (url.searchParams.get("dialog") !== LEAVES_DIALOG_QUERY) return;
      url.searchParams.delete("dialog");
      window.history.replaceState({}, "", url.toString());
      setLeavesOpen(true);
    };
    openFromLink();
    window.addEventListener(LEAVES_DIALOG_OPEN_EVENT, openFromLink);
    return () => window.removeEventListener(LEAVES_DIALOG_OPEN_EVENT, openFromLink);
  }, [canViewLeaves]);
  const alerts = useShortcutAlerts();
  // A window that changes these numbers refreshes them when it closes.
  const closeAndRefresh = (setOpen: (open: boolean) => void) => (open: boolean) => {
    setOpen(open);
    if (!open) void refreshShortcutAlerts();
  };
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
      tone: "success",
    },
    {
      label: "طلاب مفصولون",
      value: stats?.dismissedStudents,
      icon: Shield,
      tone: "danger",
    },
    {
      label: "إجمالي الطلاب",
      value: stats?.totalStudents,
      icon: BookOpen,
      tone: "info",
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
          className="flex flex-col gap-3 rounded-2xl border border-danger-line border-s-4 border-s-danger-vivid bg-danger-soft p-4 text-sm text-danger sm:flex-row sm:items-center sm:justify-between"
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
          className="flex flex-col gap-3 rounded-2xl border border-warning-line border-s-4 border-s-warning-vivid bg-warning-soft p-4 text-sm text-warning sm:flex-row sm:items-center sm:justify-between"
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

      <div className="tp-dashboard__kpis" role="group" aria-label="إحصائيات الطلاب">
        {kpiCards.map(({ label, value, icon: Icon, tone }) => (
          <div key={label} className="tp-dashboard__stat" data-count-scope="system" data-tone={tone}>
            <span className="tp-dashboard__stat-icon" aria-hidden="true">
              <Icon />
            </span>
            <div className="tp-dashboard__stat-copy">
              <p className="tp-dashboard__stat-label text-muted-foreground">{label}</p>
              <p className="tp-dashboard__stat-value">{initialLoading ? "…" : value ?? "—"}</p>
            </div>
          </div>
        ))}
      </div>

      <div className="tp-dashboard__insights">
        <StudentTrendChart syncKey={syncKey} />
        <StudentStatusDonut stats={stats} loading={initialLoading} />
      </div>

      {(visibleShortcuts.length > 0 || canViewCallNotes || canViewCodeClosures || canViewGracePeriods || canViewLeaves || canUseTextShortcuts) && (
        <nav aria-label="اختصارات لوحة التحكم" className="tp-dashboard__navigation">
          <h3 className="tp-dashboard__heading">
            <Zap aria-hidden="true" />
            الوصول السريع
          </h3>
          <div className="tp-dashboard__shortcuts">
            {visibleShortcuts.map(({ section, title, icon: Icon, tone }) => (
              <a
                key={section}
                data-tone={tone}
                href={`/?section=${section}`}
                onClick={(event) => onSectionLinkClick?.(event, section)}
                className="tp-dashboard__shortcut text-card-foreground hover:border-primary/40 hover:bg-accent/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background motion-reduce:transition-none"
              >
                <span className="tp-dashboard__shortcut-icon" aria-hidden="true">
                  <Icon />
                </span>
                <span className="tp-dashboard__shortcut-label">
                  {title}
                </span>
              </a>
            ))}
            {canViewCallNotes && (
              <button
                type="button"
                onClick={() => setCallsOpen(true)}
                aria-haspopup="dialog"
                data-tone="success"
                className="tp-dashboard__shortcut text-card-foreground hover:border-primary/40 hover:bg-accent/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background motion-reduce:transition-none"
              >
                <span className="tp-dashboard__shortcut-icon" aria-hidden="true">
                  <PhoneCall />
                </span>
                <span className="tp-dashboard__shortcut-label">إدارة المكالمات</span>
              </button>
            )}
            {canViewCallNotes && (
              <button
                type="button"
                onClick={() => setCallNotesOpen(true)}
                aria-haspopup="dialog"
                data-tone="success"
                className="tp-dashboard__shortcut text-card-foreground hover:border-primary/40 hover:bg-accent/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background motion-reduce:transition-none"
              >
                <span className="tp-dashboard__shortcut-icon" aria-hidden="true">
                  <ListChecks />
                </span>
                <span className="tp-dashboard__shortcut-label">
                  إدارة ملاحظات المكالمات
                  <ShortcutAlert count={alerts?.callNotesPending} tone="danger" label="ملاحظة بانتظار الإنجاز" />
                </span>
              </button>
            )}
            {canViewCodeClosures && (
              <button
                type="button"
                onClick={() => setCodeClosuresOpen(true)}
                aria-haspopup="dialog"
                data-tone="danger"
                className="tp-dashboard__shortcut text-card-foreground hover:border-primary/40 hover:bg-accent/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background motion-reduce:transition-none"
              >
                <span className="tp-dashboard__shortcut-icon" aria-hidden="true">
                  <LockKeyhole />
                </span>
                <span className="tp-dashboard__shortcut-label">
                  اغلاق الكودات
                  <ShortcutAlert count={alerts?.codeClosuresPending} tone="danger" label="كود بانتظار الإغلاق" />
                </span>
              </button>
            )}
            {canViewGracePeriods && (
              <button
                type="button"
                onClick={() => setGracePeriodsOpen(true)}
                aria-haspopup="dialog"
                data-tone="warning"
                className="tp-dashboard__shortcut text-card-foreground hover:border-primary/40 hover:bg-accent/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background motion-reduce:transition-none"
              >
                <span className="tp-dashboard__shortcut-icon" aria-hidden="true">
                  <CalendarClock />
                </span>
                <span className="tp-dashboard__shortcut-label">
                  إدارة فترة السماح
                </span>
              </button>
            )}
            {canViewLeaves && (
              <button
                type="button"
                onClick={() => setLeavesOpen(true)}
                aria-haspopup="dialog"
                data-tone="warning"
                className="tp-dashboard__shortcut text-card-foreground hover:border-primary/40 hover:bg-accent/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background motion-reduce:transition-none"
              >
                <span className="tp-dashboard__shortcut-icon" aria-hidden="true">
                  <CalendarCheck />
                </span>
                <span className="tp-dashboard__shortcut-label">
                  إدارة الإجازات
                </span>
              </button>
            )}
            {canUseTextShortcuts && (
              <button
                type="button"
                onClick={() => setTextShortcutsOpen(true)}
                aria-haspopup="dialog"
                data-tone="info"
                className="tp-dashboard__shortcut text-card-foreground hover:border-primary/40 hover:bg-accent/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background motion-reduce:transition-none"
              >
                <span className="tp-dashboard__shortcut-icon" aria-hidden="true">
                  <MessageSquareText />
                </span>
                <span className="tp-dashboard__shortcut-label">
                  اختصارات
                </span>
              </button>
            )}
          </div>
        </nav>
      )}
      {canUseTextShortcuts && (
        <TextShortcutsDialog open={textShortcutsOpen} onOpenChange={setTextShortcutsOpen} />
      )}
      {canViewCallNotes && (
        <CallsDialog open={callsOpen} onOpenChange={closeAndRefresh(setCallsOpen)} canSeeStats={canSeeCallStats} />
      )}
      {canViewCallNotes && (
        <CallNotesManagementDialog
          open={callNotesOpen}
          onOpenChange={closeAndRefresh(setCallNotesOpen)}
          canManage={canManageCallNotes}
          canWithdraw={canWithdrawStudents}
        />
      )}
      {canViewGracePeriods && (
        <GracePeriodsDialog
          key={`grace-${actor?.id || ""}`}
          open={gracePeriodsOpen}
          onOpenChange={closeAndRefresh(setGracePeriodsOpen)}
          canManage={canManageGracePeriods}
        />
      )}
      {canViewLeaves && (
        <LeavesDialog
          key={`leaves-${actor?.id || ""}`}
          open={leavesOpen}
          onOpenChange={closeAndRefresh(setLeavesOpen)}
          canManage={canManageLeaves}
        />
      )}
      {canViewCodeClosures && (
        <CodeClosuresDialog
          key={actor?.id}
          open={codeClosuresOpen}
          onOpenChange={closeAndRefresh(setCodeClosuresOpen)}
          canManage={canManageCodeClosures}
          canEditContacts={canEditStudents}
          canWithdraw={canWithdrawStudents}
        />
      )}
    </div>
  );
}
