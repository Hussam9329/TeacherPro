"use client";

import { formatBaghdadDateTime } from "@/lib/baghdad-time";
import { useCallback, useEffect, useRef, useState, type MouseEvent } from "react";
import { Button } from "@/components/ui/button";
import {
  Archive,
  CalendarCheck,
  CalendarClock,
  ChartColumn,
  ClipboardCheck,
  ClipboardList,
  FilePlus2,
  Handshake,
  ListChecks,
  LockKeyhole,
  MessageSquareText,
  PenLine,
  PhoneCall,
  ShieldAlert,
  Target,
  Trophy,
  UserCheck,
  UserX,
  Users,
  UsersRound,
  Zap,
  type LucideIcon,
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
import { MirmazProDialog } from "./mirmaz-pro-dialog";
import { GracePeriodsDialog } from "./grace-periods-dialog";
import { LeavesDialog, LEAVES_DIALOG_OPEN_EVENT, LEAVES_DIALOG_QUERY } from "./leaves-dialog";
import { PledgeListDialog } from "./pledge-list-dialog";
import { TextShortcutsDialog } from "./text-shortcuts-dialog";
import { TopStudentsDialog } from "./top-students-dialog";
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

/** «الوصول السريع» in four groups, by the kind of work. */
type ShortcutGroup = "students" | "exams" | "follow-up" | "admin";

const dashboardShortcuts = [
  { section: "student-registry", title: "سجل الطلاب", icon: ClipboardList, group: "students" },
  { section: "student-bulk-import", title: "إضافة الطلاب الجماعية", icon: UsersRound, group: "students" },
  { section: "dismissed-management", title: "إدارة المفصولين", icon: ShieldAlert, group: "students" },
  { section: "exam-new", title: "إضافة امتحان", icon: FilePlus2, group: "exams" },
  { section: "grade-entry", title: "تسجيل الدرجات", icon: PenLine, group: "exams" },
  { section: "grade-records", title: "سجل الدرجات", icon: ChartColumn, group: "exams" },
  { section: "opportunities", title: "إدارة الفرص", icon: Target, group: "follow-up" },
] as const;

/** Each group has one colour, for its title and its icons. */
const GROUP_TONE: Record<ShortcutGroup, "success" | "warning" | "info" | "danger"> = {
  students: "success",
  exams: "warning",
  "follow-up": "info",
  admin: "danger",
};

const SHORTCUT_CLASS =
  "tp-dashboard__shortcut text-card-foreground hover:border-primary/40 hover:bg-accent/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background motion-reduce:transition-none";

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

/**
 * The student numbers: the total with its split by status, then each status
 * with its share of the total.
 */
function StudentKpis({ stats, loading }: { stats: DashboardStats | null; loading: boolean }) {
  const total = stats?.totalStudents ?? 0;
  const archived = stats?.archivedStudents;
  const show = (value: number | undefined) => (loading ? "…" : value === undefined ? "—" : value.toLocaleString("en-US"));
  const share = (value: number | undefined) => (total && value !== undefined ? `${((value / total) * 100).toFixed(1)}%` : "");
  const statuses = [
    { key: "active", label: "طلاب نشطون", value: stats?.activeStudents, icon: UserCheck, tone: "success" },
    { key: "dismissed", label: "طلاب مفصولون", value: stats?.dismissedStudents, icon: UserX, tone: "danger" },
    { key: "archived", label: "طلاب مؤرشفون", value: archived, icon: Archive, tone: "archived" },
  ] as const;
  const other = stats ? Math.max(0, total - stats.activeStudents - stats.dismissedStudents - (archived ?? 0)) : 0;
  const split = [
    ...statuses.map((status) => ({ key: status.key, value: status.value ?? 0 })),
    { key: "other", value: other },
  ].filter((part) => part.value > 0);

  return (
    <div className="tp-dashboard__kpis" role="group" aria-label="إحصائيات الطلاب">
      <div className="tp-dashboard__stat tp-dashboard__stat--total" data-count-scope="system">
        <span className="tp-dashboard__stat-icon" aria-hidden="true">
          <Users />
        </span>
        <div className="tp-dashboard__stat-copy">
          <p className="tp-dashboard__stat-label">إجمالي الطلاب</p>
          <p className="tp-dashboard__stat-value">{show(stats?.totalStudents)}</p>
        </div>
        {!loading && total > 0 && (
          <span className="tp-dashboard__split" aria-hidden="true">
            {split.map((part) => (
              <span key={part.key} data-part={part.key} style={{ flexGrow: part.value }} />
            ))}
          </span>
        )}
      </div>
      {statuses.map(({ key, label, value, icon: Icon, tone }) => (
        <div key={key} className="tp-dashboard__stat" data-count-scope="system" data-tone={tone}>
          <span className="tp-dashboard__stat-icon" aria-hidden="true">
            <Icon />
          </span>
          <div className="tp-dashboard__stat-copy">
            <p className="tp-dashboard__stat-label text-muted-foreground">{label}</p>
            <p className="tp-dashboard__stat-value">
              {show(value)}
              {!loading && share(value) && <span className="tp-dashboard__stat-share">{share(value)}</span>}
            </p>
          </div>
        </div>
      ))}
    </div>
  );
}

type AttentionItem = {
  key: string;
  label: string;
  hint: string;
  count: number;
  icon: LucideIcon;
  onOpen: () => void;
};

/**
 * «يحتاج انتباهك»: the waiting numbers of the shortcuts below, in one place,
 * the biggest first. Each opens its window; with nothing waiting it is gone.
 */
function AttentionPanel({ items }: { items: AttentionItem[] }) {
  const waiting = items.filter((item) => item.count > 0).sort((a, b) => b.count - a.count);
  if (!waiting.length) return null;
  return (
    <section className="tp-dashboard__panel tp-attention" aria-labelledby="tp-attention-title">
      <header className="tp-dashboard__panel-head">
        <h3 id="tp-attention-title" className="tp-dashboard__panel-title">يحتاج انتباهك</h3>
      </header>
      <ul className="tp-attention__list">
        {waiting.map(({ key, label, hint, count, icon: Icon, onOpen }, index) => (
          <li key={key}>
            <button
              type="button"
              className="tp-attention__item"
              data-lead={index === 0 ? true : undefined}
              onClick={onOpen}
              aria-haspopup="dialog"
            >
              <span className="tp-attention__icon" aria-hidden="true">
                <Icon />
              </span>
              <span className="tp-attention__copy">
                <span className="tp-attention__label">{label}</span>
                <span className="tp-attention__hint">{hint}</span>
              </span>
              <span className="tp-attention__count">{count > 999 ? "999+" : count.toLocaleString("en-US")}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function DashboardView({
  onSectionLinkClick,
}: {
  onSectionLinkClick?: (event: MouseEvent<HTMLAnchorElement>, section: SectionId) => void;
} = {}) {
  const { canAccess, currentUser, courseName } = useTeacherStore(
    useShallow((state) => ({ canAccess: state.canAccess, currentUser: state.currentUser, courseName: state.courseName, /* re-render when these change: */ users: state.users, currentUserId: state.currentUserId, isAuthenticated: state.isAuthenticated })),
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
  // «مرماز برو»: grades from Mirmaz Pro waiting to be placed; placing one is a grade entry.
  const canUseMirmazPro = Boolean(actor && (
    actor.username?.trim().toLowerCase() === "admin" ||
    actor.roleId === "role_admin" ||
    actor.permissions?.includes("grades.add")
  ));
  const [mirmazProOpen, setMirmazProOpen] = useState(false);
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
  // «الطلبة المتميزين»: the same permissions as its route (students.view or grades.view).
  const canViewTopStudents = hasFullStudentsView || Boolean(actor && (
    actor.username?.trim().toLowerCase() === "admin" ||
    actor.roleId === "role_admin" ||
    actor.permissions?.includes("grades.view")
  ));
  const [topStudentsOpen, setTopStudentsOpen] = useState(false);
  // «تعهدات»: the same permissions as its route (opportunities.view or students.view).
  const canViewPledges = canAccess("opportunities") || hasFullStudentsView;
  const [pledgesOpen, setPledgesOpen] = useState(false);
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

  const attentionItems: AttentionItem[] = [
    ...(canViewCodeClosures
      ? [{ key: "codes", label: "اغلاق الكودات", hint: "كودات بانتظار الإغلاق", count: alerts?.codeClosuresPending ?? 0, icon: LockKeyhole, onOpen: () => setCodeClosuresOpen(true) }]
      : []),
    ...(canViewCallNotes
      ? [{ key: "call-notes", label: "ملاحظات المكالمات", hint: "ملاحظات بانتظار الإنجاز", count: alerts?.callNotesPending ?? 0, icon: ListChecks, onOpen: () => setCallNotesOpen(true) }]
      : []),
    ...(canUseMirmazPro
      ? [{ key: "mirmaz", label: "مرماز برو", hint: "درجات بانتظار المعالجة", count: alerts?.mirmazHoldsPending ?? 0, icon: ClipboardCheck, onOpen: () => setMirmazProOpen(true) }]
      : []),
  ];

  const groupLinks = (group: ShortcutGroup) =>
    visibleShortcuts
      .filter((shortcut) => shortcut.group === group)
      .map(({ section, title, icon: Icon }) => (
        <a
          key={section}
          data-tone={GROUP_TONE[group]}
          href={`/?section=${section}`}
          onClick={(event) => onSectionLinkClick?.(event, section)}
          className={SHORTCUT_CLASS}
        >
          <span className="tp-dashboard__shortcut-icon" aria-hidden="true">
            <Icon />
          </span>
          <span className="tp-dashboard__shortcut-label">
            {title}
          </span>
        </a>
      ));
  const hasLinks = (group: ShortcutGroup) => visibleShortcuts.some((shortcut) => shortcut.group === group);
  const showStudentsGroup = hasLinks("students") || canViewTopStudents;
  const showExamsGroup = hasLinks("exams") || canUseMirmazPro;
  const showFollowUpGroup = canViewCallNotes || hasLinks("follow-up") || canViewPledges;
  const showAdminGroup = canViewCodeClosures || canViewGracePeriods || canViewLeaves || canUseTextShortcuts;

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

      <StudentKpis stats={stats} loading={initialLoading} />

      <div className="tp-dashboard__insights">
        <StudentTrendChart syncKey={syncKey} />
        <AttentionPanel items={attentionItems} />
      </div>

      {(showStudentsGroup || showExamsGroup || showFollowUpGroup || showAdminGroup) && (
        <nav aria-label="اختصارات لوحة التحكم" className="tp-dashboard__navigation">
          <h3 className="tp-dashboard__heading">
            <Zap aria-hidden="true" />
            الوصول السريع
          </h3>
          <div className="tp-dashboard__groups">
            {showStudentsGroup && (
              <div className="tp-dashboard__group" data-tone={GROUP_TONE.students} role="group" aria-labelledby="tp-group-students">
                <h4 id="tp-group-students" className="tp-dashboard__group-title">الطلاب</h4>
                <div className="tp-dashboard__shortcuts">
                  {groupLinks("students")}
                  {canViewTopStudents && (
                    <button type="button" onClick={() => setTopStudentsOpen(true)} aria-haspopup="dialog" data-tone={GROUP_TONE.students} className={SHORTCUT_CLASS}>
                      <span className="tp-dashboard__shortcut-icon" aria-hidden="true">
                        <Trophy />
                      </span>
                      <span className="tp-dashboard__shortcut-label">
                        الطلبة المتميزين
                      </span>
                    </button>
                  )}
                </div>
              </div>
            )}
            {showExamsGroup && (
              <div className="tp-dashboard__group" data-tone={GROUP_TONE.exams} role="group" aria-labelledby="tp-group-exams">
                <h4 id="tp-group-exams" className="tp-dashboard__group-title">الامتحانات والدرجات</h4>
                <div className="tp-dashboard__shortcuts">
                  {groupLinks("exams")}
                  {canUseMirmazPro && (
                    <button type="button" onClick={() => setMirmazProOpen(true)} aria-haspopup="dialog" data-tone={GROUP_TONE.exams} className={SHORTCUT_CLASS}>
                      <span className="tp-dashboard__shortcut-icon" aria-hidden="true">
                        <ClipboardCheck />
                      </span>
                      <span className="tp-dashboard__shortcut-label">
                        مرماز برو
                        <ShortcutAlert count={alerts?.mirmazHoldsPending ?? null} tone="danger" label="درجة بانتظار المعالجة" />
                      </span>
                    </button>
                  )}
                </div>
              </div>
            )}
            {showFollowUpGroup && (
              <div className="tp-dashboard__group" data-tone={GROUP_TONE["follow-up"]} role="group" aria-labelledby="tp-group-follow-up">
                <h4 id="tp-group-follow-up" className="tp-dashboard__group-title">المتابعة</h4>
                <div className="tp-dashboard__shortcuts">
                  {canViewCallNotes && (
                    <button type="button" onClick={() => setCallsOpen(true)} aria-haspopup="dialog" data-tone={GROUP_TONE["follow-up"]} className={SHORTCUT_CLASS}>
                      <span className="tp-dashboard__shortcut-icon" aria-hidden="true">
                        <PhoneCall />
                      </span>
                      <span className="tp-dashboard__shortcut-label">إدارة المكالمات</span>
                    </button>
                  )}
                  {canViewCallNotes && (
                    <button type="button" onClick={() => setCallNotesOpen(true)} aria-haspopup="dialog" data-tone={GROUP_TONE["follow-up"]} className={SHORTCUT_CLASS}>
                      <span className="tp-dashboard__shortcut-icon" aria-hidden="true">
                        <ListChecks />
                      </span>
                      <span className="tp-dashboard__shortcut-label">
                        إدارة ملاحظات المكالمات
                        <ShortcutAlert count={alerts?.callNotesPending} tone="danger" label="ملاحظة بانتظار الإنجاز" />
                      </span>
                    </button>
                  )}
                  {groupLinks("follow-up")}
                  {canViewPledges && (
                    <button type="button" onClick={() => setPledgesOpen(true)} aria-haspopup="dialog" data-tone={GROUP_TONE["follow-up"]} className={SHORTCUT_CLASS}>
                      <span className="tp-dashboard__shortcut-icon" aria-hidden="true">
                        <Handshake />
                      </span>
                      <span className="tp-dashboard__shortcut-label">
                        تعهدات
                      </span>
                    </button>
                  )}
                </div>
              </div>
            )}
            {showAdminGroup && (
              <div className="tp-dashboard__group" data-tone={GROUP_TONE.admin} role="group" aria-labelledby="tp-group-admin">
                <h4 id="tp-group-admin" className="tp-dashboard__group-title">الإدارة</h4>
                <div className="tp-dashboard__shortcuts">
                  {canViewCodeClosures && (
                    <button type="button" onClick={() => setCodeClosuresOpen(true)} aria-haspopup="dialog" data-tone={GROUP_TONE.admin} className={SHORTCUT_CLASS}>
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
                    <button type="button" onClick={() => setGracePeriodsOpen(true)} aria-haspopup="dialog" data-tone={GROUP_TONE.admin} className={SHORTCUT_CLASS}>
                      <span className="tp-dashboard__shortcut-icon" aria-hidden="true">
                        <CalendarClock />
                      </span>
                      <span className="tp-dashboard__shortcut-label">
                        إدارة فترة السماح
                      </span>
                    </button>
                  )}
                  {canViewLeaves && (
                    <button type="button" onClick={() => setLeavesOpen(true)} aria-haspopup="dialog" data-tone={GROUP_TONE.admin} className={SHORTCUT_CLASS}>
                      <span className="tp-dashboard__shortcut-icon" aria-hidden="true">
                        <CalendarCheck />
                      </span>
                      <span className="tp-dashboard__shortcut-label">
                        إدارة الإجازات
                      </span>
                    </button>
                  )}
                  {canUseTextShortcuts && (
                    <button type="button" onClick={() => setTextShortcutsOpen(true)} aria-haspopup="dialog" data-tone={GROUP_TONE.admin} className={SHORTCUT_CLASS}>
                      <span className="tp-dashboard__shortcut-icon" aria-hidden="true">
                        <MessageSquareText />
                      </span>
                      <span className="tp-dashboard__shortcut-label">
                        اختصارات
                      </span>
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        </nav>
      )}
      {canViewPledges && (
        <PledgeListDialog key={`pledges-${actor?.id || ""}`} courseName={courseName} open={pledgesOpen} onOpenChange={setPledgesOpen} />
      )}
      {canViewTopStudents && (
        <TopStudentsDialog key={`top-${actor?.id || ""}`} open={topStudentsOpen} onOpenChange={setTopStudentsOpen} />
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
      {canUseMirmazPro && (
        <MirmazProDialog key={`mirmaz-${actor?.id || ""}`} open={mirmazProOpen} onOpenChange={closeAndRefresh(setMirmazProOpen)} />
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
