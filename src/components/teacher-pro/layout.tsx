"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { useTeacherStore, type SectionId } from "@/lib/teacher-store";
import { ScheduledExamWorker } from "./scheduled-exam-worker";
import { syncVersionApi } from "@/lib/api";
import { flushGradeEntryOfflineSaves } from "@/lib/grade-entry-offline-outbox";
import { SESSION_CHECK_EVENT } from "@/lib/outbox-session";
import {
  announceTeacherProSyncPending,
  announceTeacherProSyncRefreshing,
  announceTeacherProSyncSettled,
  consumeTeacherProLocalMutationEcho,
  emitTeacherProDataChanged,
  isTeacherProInteractionBusy,
  subscribeTeacherProDataChanged,
  subscribeTeacherProLocalMutation,
  TEACHERPRO_SYNC_PENDING_EVENT,
  TEACHERPRO_SYNC_SETTLED_EVENT,
  TEACHERPRO_SYNC_STATUS_EVENT,
  type TeacherProDataChangedDetail,
  type TeacherProSyncStatusDetail,
} from "@/lib/teacherpro-sync";
import {
  LayoutDashboard,
  BookOpen,
  BookMarked,
  UserPlus,
  ClipboardList,
  
  UsersRound,
  FileText,
  PenTool,
  FileCheck,
  BarChart3,
  Target,
  PhoneCall,
  Shield,
  ShieldAlert,
  ScrollText,
  Sun,
  Moon,
  Menu,
  X,
  LogOut,
  ChevronLeft,
  Plus,
  KeyRound,
  Lock,
  Search,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { toast } from "@/lib/user-toast";
import {
  TEACHERPRO_ACTION_COPY,
  type TeacherProActionStatusDetail,
} from "@/lib/teacherpro-language";

const menuItems: {
  id: SectionId;
  title: string;
  icon: React.ElementType;
}[] = [
  {
    id: "dashboard",
    title: "لوحة النظام",
    icon: LayoutDashboard,
  },
  {
    id: "courses",
    title: "الدورات",
    icon: BookOpen,
  },
  { id: "chapters", title: "الفصول والفرص", icon: BookMarked },
  {
    id: "student-register",
    title: "تسجيل الطلاب",
    icon: UserPlus,
  },
  {
    id: "student-registry",
    title: "الطلاب",
    icon: ClipboardList,
  },
  {
    id: "student-bulk-import",
    title: "إضافة جماعية للطلاب",
    icon: UsersRound,
  },
  { id: "dismissed-management", title: "إدارة المفصولين", icon: ShieldAlert },
  { id: "exam-new", title: "إضافة امتحان", icon: FileText },
  { id: "grade-entry", title: "تسجيل الدرجات", icon: PenTool },
  { id: "exam-records", title: "الامتحانات", icon: FileCheck },
  { id: "grade-records", title: "سجل الدرجات", icon: BarChart3 },
  { id: "opportunities", title: "الفرص والمفصولين", icon: Target },
  { id: "follow-up-calls", title: "المكالمات", icon: PhoneCall },
  { id: "accounts", title: "إدارة الحسابات", icon: Shield },
  { id: "logs", title: "السجلات", icon: ScrollText },
];

// One flat sidebar. Pages that belong together show as one entry; a bar at
// the top of the page switches between them, and their old links still work.
type SectionGroupItem = { id: SectionId; label: string; kind: "tab" | "action" };
const sectionGroups: Array<{ parent: SectionId; items: SectionGroupItem[] }> = [
  {
    parent: "student-registry",
    items: [
      { id: "student-registry", label: "الطلاب", kind: "tab" },
      { id: "student-register", label: "إضافة طالب", kind: "action" },
      { id: "student-bulk-import", label: "إضافة جماعية", kind: "action" },
    ],
  },
  {
    parent: "exam-records",
    items: [
      { id: "exam-records", label: "الامتحانات", kind: "tab" },
      { id: "exam-new", label: "إضافة امتحان", kind: "action" },
    ],
  },
  {
    parent: "opportunities",
    items: [
      { id: "opportunities", label: "الفرص", kind: "tab" },
      { id: "dismissed-management", label: "المفصولين", kind: "tab" },
    ],
  },
];
const sectionParent = new Map<SectionId, SectionId>(
  sectionGroups.flatMap((group) =>
    group.items
      .filter((item) => item.id !== group.parent)
      .map((item) => [item.id, group.parent] as [SectionId, SectionId]),
  ),
);
const sidebarOrder: SectionId[] = [
  "dashboard",
  "courses",
  "chapters",
  "student-registry",
  "student-register",
  "student-bulk-import",
  "exam-records",
  "exam-new",
  "grade-entry",
  "grade-records",
  "opportunities",
  "dismissed-management",
  "follow-up-calls",
  "accounts",
  "logs",
];

const sectionsWithPageSearch = new Set<SectionId>([
  "courses",
  "chapters",
  "student-registry",
  "dismissed-management",
  "grade-entry",
  "exam-records",
  "grade-records",
  "opportunities",
  "follow-up-calls",
  "accounts",
  "logs",
]);
const sectionIds = new Set<SectionId>(menuItems.map((item) => item.id));
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

const SECTION_SYNC_SCOPES: Record<SectionId, string[]> = {
  dashboard: ["dashboard", "students", "grades", "opportunities", "exams"],
  courses: ["courses", "students", "exams", "dashboard"],
  chapters: ["chapters", "courses", "students", "opportunities", "dashboard"],
  "student-register": ["students", "courses", "opportunities", "dashboard"],
  "student-registry": ["students", "courses", "opportunities", "grades", "follow-up", "dashboard"],
  "student-bulk-import": ["students", "courses", "opportunities", "bulk-import", "dashboard"],
  "dismissed-management": ["students", "grades", "opportunities", "dismissed", "follow-up", "dashboard"],
  "exam-new": ["exams", "courses", "grades", "dashboard"],
  "grade-entry": ["grades", "students", "exams", "opportunities", "dashboard"],
  "exam-records": ["exams", "courses", "grades", "students", "dashboard"],
  "grade-records": ["grades", "students", "exams", "opportunities", "dashboard"],
  opportunities: ["opportunities", "opportunity-logs", "students", "grades", "dashboard"],
  "follow-up": ["follow-up", "students", "grades", "opportunities", "dashboard"],
  "follow-up-calls": ["follow-up", "students", "dashboard"],
  "follow-up-leaves": ["follow-up", "students", "grades", "opportunities", "dashboard"],
  accounts: ["accounts", "logs"],
  logs: ["logs", "opportunity-logs"],
  // Legacy hidden section: old persisted links are redirected to logs.
  "admin-log-reset": ["logs", "opportunity-logs"],
};

// Sections whose data is fully owned by the page itself (they call their own
// dedicated overview/context API on mount and never rely on the shared
// `courseChapters` slice from the store). For these sections the generic
// `loadSectionDataFromServer` lazy-load and smart-sync refresh would be
// redundant, so we skip them.
//
// IMPORTANT: any section that reads `courseChapters` or `activeChapterForCourse`
// from the store MUST NOT be listed here, otherwise the store stays empty and
// the UI renders every course as "بدون فصل نشط". See exam-records, grade-entry,
// opportunities, student-registry and the follow-up family.
const PAGE_OWNED_SYNC_SECTIONS = new Set<SectionId>([
  "dashboard",
  "courses",
  "chapters",
  "student-bulk-import",
  "dismissed-management",
  "exam-new",
  "grade-records",
  // The calls workspace loads its own list from the server and only reloads
  // when the user asks; refetching every call, note and leave in the system
  // on each change from another laptop froze the page for everyone.
  "follow-up-calls",
  "accounts",
  "logs",
]);

function detailMatchesSection(
  detail: Pick<TeacherProDataChangedDetail, "scopes"> | undefined,
  section: SectionId,
): boolean {
  if (!detail?.scopes || detail.scopes.length === 0) return true;
  if (detail.scopes.includes("all")) return true;
  const sectionScopes = SECTION_SYNC_SCOPES[section] || [];
  return detail.scopes.some((scope) => sectionScopes.includes(scope));
}

type SyncVersionSnapshot = {
  version: string;
  counts: Record<string, number>;
  maxDates: Record<string, string>;
};

const SYNC_VERSION_SCOPE_MAP: Record<string, string[]> = {
  courses: ["courses", "students", "exams", "dashboard"],
  chapters: ["chapters", "courses", "students", "opportunities", "dashboard"],
  courseChapters: [
    "chapters",
    "courses",
    "students",
    "opportunities",
    "dashboard",
  ],
  students: [
    "students",
    "grades",
    "opportunities",
    "dismissed",
    "follow-up",
    "dashboard",
  ],
  exams: [
    "exams",
    "grades",
    "students",
    "dashboard",
  ],
  grades: ["grades", "students", "opportunities", "dashboard"],
  opportunityLogs: ["opportunities", "opportunity-logs", "students", "dashboard"],
  studentLeaves: ["follow-up", "students", "grades", "opportunities", "dashboard"],
  studentCalls: ["follow-up", "students", "dashboard"],
  studentNotes: ["follow-up", "students", "opportunities", "dashboard"],
  users: ["accounts"],
  roles: ["accounts"],
  auditLogs: ["logs"],
};

function normalizeSyncVersionSnapshot(result: unknown): SyncVersionSnapshot | null {
  const data = result as {
    version?: unknown;
    counts?: unknown;
    maxDates?: unknown;
  } | null;
  const version = typeof data?.version === "string" ? data.version : "";
  if (!version) return null;

  const countsInput =
    data?.counts && typeof data.counts === "object"
      ? (data.counts as Record<string, unknown>)
      : {};
  const maxDatesInput =
    data?.maxDates && typeof data.maxDates === "object"
      ? (data.maxDates as Record<string, unknown>)
      : {};

  const counts: Record<string, number> = {};
  const maxDates: Record<string, string> = {};

  Object.entries(countsInput).forEach(([key, value]) => {
    const numberValue = Number(value);
    counts[key] = Number.isFinite(numberValue) ? numberValue : 0;
  });
  Object.entries(maxDatesInput).forEach(([key, value]) => {
    maxDates[key] = value ? String(value) : "";
  });

  return { version, counts, maxDates };
}

function inferChangedSyncScopes(
  previous: SyncVersionSnapshot | null,
  next: SyncVersionSnapshot,
): string[] {
  if (!previous || previous.version === next.version) return [];
  const scopes = new Set<string>();

  const addScopesForKey = (key: string) => {
    const mapped = SYNC_VERSION_SCOPE_MAP[key];
    if (!mapped) {
      scopes.add("all");
      return;
    }
    mapped.forEach((scope) => scopes.add(scope));
  };

  const countKeys = new Set([
    ...Object.keys(previous.counts),
    ...Object.keys(next.counts),
  ]);
  countKeys.forEach((key) => {
    if ((previous.counts[key] || 0) !== (next.counts[key] || 0)) {
      addScopesForKey(key);
    }
  });

  const maxDateKeys = new Set([
    ...Object.keys(previous.maxDates),
    ...Object.keys(next.maxDates),
  ]);
  maxDateKeys.forEach((key) => {
    if ((previous.maxDates[key] || "") !== (next.maxDates[key] || "")) {
      addScopesForKey(key);
    }
  });

  return scopes.size > 0 ? Array.from(scopes) : ["all"];
}

function sectionHref(section: SectionId) {
  return `/?section=${encodeURIComponent(section)}`;
}

function readSectionFromLocation(): SectionId | null {
  if (typeof window === "undefined") return null;
  const querySection = new URLSearchParams(window.location.search).get(
    "section",
  );
  const hashSection = window.location.hash.replace(/^#/, "");
  const value = querySection || hashSection;
  // Backward compatibility: redirect old section IDs
  if (value === 'whatsapp') return 'follow-up-calls' as SectionId;
  // تبويبة الإجازات صارت نافذة «إدارة الإجازات» في لوحة النظام.
  if (value === 'follow-up' || value === 'follow-up-leaves') return 'follow-up-leaves' as SectionId;
  if (value === 'follow-up-pledges') return 'dismissed-management' as SectionId;
  // التبويب القديم أزيل، لكن الروابط المحفوظة يجب أن تصل إلى بديله الرسمي.
  if (value === 'dismissed-students') return 'dismissed-management' as SectionId;
  // التبويبة أزيلت من الواجهة؛ الروابط القديمة تنتقل للسجلات بأمان.
  if (value === 'admin-log-reset') return 'logs' as SectionId;
  if (value === 'course-new' || value === 'site-management') {
    return 'courses' as SectionId;
  }
  return sectionIds.has(value as SectionId) ? (value as SectionId) : null;
}

import { useShortcutAlerts } from "@/hooks/use-shortcut-alerts";
import { DashboardView } from "./dashboard";
import { CoursesView } from "./courses";
import { ChaptersView } from "./chapters";
import { StudentRegisterView } from "./student-register";
import { StudentBulkTextImportView } from "./student-bulk-text-import";
import { StudentRegistryView } from "./student-registry";
import { DismissedManagementView } from "./dismissed-management";
import { ExamNewView } from "./exam-new";
import { GradeEntryView } from "./grade-entry";
import { ExamRecordsView } from "./exam-records";
import { GradeRecordsView } from "./grade-records";
import { OpportunitiesView } from "./opportunities";
import { FollowUpCallsView } from "./follow-up";
import { LEAVES_DIALOG_OPEN_EVENT, LEAVES_DIALOG_QUERY } from "./leaves-dialog";
import { AccountsView } from "./accounts";
import { LogsView } from "./logs";
import { EmptyState, LoadingState } from "./ui-kit";

const sectionComponents: Record<SectionId, React.ComponentType> = {
  dashboard: DashboardView,
  courses: CoursesView,
  chapters: ChaptersView,
  "student-register": StudentRegisterView,
  "student-bulk-import": StudentBulkTextImportView,
  "student-registry": StudentRegistryView,
  "dismissed-management": DismissedManagementView,
  "exam-new": ExamNewView,
  "grade-entry": GradeEntryView,
  "exam-records": ExamRecordsView,
  "grade-records": GradeRecordsView,
  opportunities: OpportunitiesView,
  // Legacy hidden sections: old links open «إدارة الإجازات» on the dashboard.
  "follow-up": DashboardView,
  "follow-up-calls": FollowUpCallsView,
  "follow-up-leaves": DashboardView,
  accounts: AccountsView,
  logs: LogsView,
  // Keep the legacy key type-safe while rendering the safe destination only.
  "admin-log-reset": LogsView,
};


type LoginScreenProps = {
  theme: string;
  toggleTheme: () => void;
  login: (username: string, password: string) => Promise<{ ok: boolean; message: string }>;
};

function LoginScreen({ theme, toggleTheme, login }: LoginScreenProps) {
  useEffect(() => {
    const warn = () => toast.warning("كلمة مرورك ضعيفة. حدّثها من إدارة الحسابات إلى 8 أحرف على الأقل مع حرف ورقم.");
    window.addEventListener("teacherpro:weak-password", warn);
    return () => window.removeEventListener("teacherpro:weak-password", warn);
  }, []);

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setLoading(true);
    const result = await login(username, password);
    setLoading(false);
    if (result.ok) toast.success(result.message);
    else toast.error(result.message);
  };

  return (
    <div className="app-bg tp-readable-ui tp-semantic-colors tp-login-screen" dir="rtl">
      <div className="tp-login-backdrop" />
      <div className="tp-login-card">
        <div className="tp-login-card__accent" />
        <div className="tp-login-card__content">
          <div className="tp-login-header">
            <div>
              <h1 className="tp-login-title text-gradient-brand">TeacherPro</h1>
              <p className="tp-login-subtitle">تسجيل دخول مدير النظام</p>
            </div>
            <Button
              variant="outline"
              size="icon"
              className="tp-login-theme"
              onClick={toggleTheme}
              type="button"
              aria-label={theme === "dark" ? "تفعيل الوضع الصباحي" : "تفعيل الوضع الليلي"}
            >
              {theme === "dark" ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </Button>
          </div>

          <form onSubmit={handleSubmit} className="tp-validation-form tp-login-form">
            <div className="tp-login-field">
              <Label htmlFor="login-username">اسم المستخدم</Label>
              <Input
                id="login-username"
                autoComplete="username"
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                placeholder="اسم المستخدم"
                className="tp-login-input"
              />
            </div>
            <div className="tp-login-field">
              <Label htmlFor="login-password">الرمز</Label>
              <Input
                id="login-password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="الرمز"
                className="tp-login-input"
              />
            </div>
            <Button type="submit" className="tp-login-submit" disabled={loading}>
              <KeyRound className="ml-2 h-4 w-4" />
              {loading ? "جاري الدخول..." : "دخول للنظام"}
            </Button>
          </form>

          <div className="tp-login-help">
            للحصول على حساب تواصل مع مدير النظام.
          </div>
        </div>
      </div>
    </div>
  );
}

/** A red count beside a page: only for things waiting for someone. */
function SidebarAlertBadge({ count, label }: { count: number; label?: string }) {
  if (!count) return null;
  return (
    <span
      className="inline-grid h-6 min-w-6 shrink-0 place-items-center rounded-full bg-danger-vivid px-1.5 text-[11px] font-black leading-none tabular-nums text-white"
      title={label}
      aria-label={label}
    >
      {count > 99 ? "99+" : count}
    </span>
  );
}

export function TeacherProLayout() {
  const {
    currentSection,
    setSection,
    sidebarOpen,
    toggleSidebar,
    setSidebarOpen,
    theme,
    toggleTheme,
    currentUser,
    canAccess,
    isAuthenticated,
    login,
    logout,
    dbConnected,
    dbLoading,
    loadFromServer,
    loadSectionDataFromServer,
    restoreSession,
  } = useTeacherStore();
  const shortcutAlerts = useShortcutAlerts(isAuthenticated);

  const lazyLoadedSectionsRef = useRef<Set<SectionId>>(new Set());
  const [syncStatus, setSyncStatus] = useState<TeacherProSyncStatusDetail>({
    status: "idle",
    at: 0,
  });
  const [actionStatus, setActionStatus] = useState<TeacherProActionStatusDetail>({
    status: "idle",
    label: "",
    at: 0,
  });
  const actionStatusTimerRef = useRef<number | null>(null);

  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<TeacherProActionStatusDetail>).detail;
      if (!detail?.status) return;
      setActionStatus(detail);
      if (actionStatusTimerRef.current) {
        window.clearTimeout(actionStatusTimerRef.current);
        actionStatusTimerRef.current = null;
      }
      if (detail.status === "saved") {
        actionStatusTimerRef.current = window.setTimeout(() => {
          setActionStatus({ status: "idle", label: "", at: Date.now() });
        }, 2600);
      } else if (detail.status === "failed") {
        actionStatusTimerRef.current = window.setTimeout(() => {
          setActionStatus({ status: "idle", label: "", at: Date.now() });
        }, 8000);
      }
    };
    window.addEventListener("teacherpro:user-action-status", handler);
    return () => {
      window.removeEventListener("teacherpro:user-action-status", handler);
      if (actionStatusTimerRef.current) window.clearTimeout(actionStatusTimerRef.current);
    };
  }, []);

  const handleSectionLinkClick = (
    event: React.MouseEvent<HTMLAnchorElement>,
    section: SectionId,
  ) => {
    if (
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    )
      return;
    event.preventDefault();
    if (!isAdmin && !canAccess(section)) return;
    if (typeof window !== "undefined") {
      const nextUrl = new URL(window.location.href);
      for (const key of dashboardActionQueryKeys) {
        nextUrl.searchParams.delete(key);
      }
      nextUrl.searchParams.set("section", section);
      nextUrl.hash = "";
      window.history.pushState({}, "", nextUrl.toString());
    }
    React.startTransition(() => setSection(section));
  };

  useEffect(() => {
    const urlSection = readSectionFromLocation();
    // إذا كان URL يحتوي على section محدد، اضبطه دائماً — هذا يضمن أن
    // فتح الرابط في تبويبة جديدة يفتح القسم الصحيح، وليس القسم الافتراضي.
    if (urlSection) return;
    if (typeof window !== "undefined" && sectionIds.has(currentSection)) {
      const nextUrl = new URL(window.location.href);
      nextUrl.searchParams.set("section", currentSection);
      nextUrl.hash = "";
      window.history.replaceState({}, "", nextUrl.toString());
    }
  }, [currentSection]);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
  }, [theme]);

  useEffect(() => {
    const searchSelectors = [
      '[data-teacherpro-search="true"]',
      'input[type="search"]',
      'input[name="search"]',
      'input[id*="search"]',
      'textarea[name="search"]',
      'textarea[id*="search"]',
    ].join(",");

    const isVisibleSearchControl = (control: HTMLInputElement | HTMLTextAreaElement) => {
      // Avoid layout reads such as offsetParent/getComputedStyle here; Ctrl+F must stay instant.
      if (control.disabled || control.readOnly) return false;
      return !(control instanceof HTMLInputElement) || control.type !== "hidden";
    };

    const findVisibleSearchInput = () => {
      const activeContent = document.querySelector<HTMLElement>('[data-teacherpro-active-content="true"]');
      const scopedControls = activeContent
        ? Array.from(activeContent.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(searchSelectors))
        : [];
      const scopedMatch = scopedControls.find(isVisibleSearchControl);
      if (scopedMatch) return scopedMatch;

      const pageControls = Array.from(
        document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(searchSelectors),
      );
      return pageControls.find(isVisibleSearchControl) || null;
    };

    const focusSearchInput = () => {
      const searchInput = findVisibleSearchInput();
      if (!searchInput) return false;
      searchInput.focus({ preventScroll: true });
      if (typeof searchInput.select === "function") {
        window.requestAnimationFrame(() => searchInput.select());
      }
      return true;
    };

    const handleGlobalSearchShortcut = (event: KeyboardEvent) => {
      if (!event.key) return;
      const key = event.key.toLowerCase();
      const isSearchShortcut =
        (event.ctrlKey || event.metaKey) &&
        !event.altKey &&
        !event.shiftKey &&
        (key === "f" || event.code === "KeyF");
      if (!isSearchShortcut) return;
      if (!focusSearchInput()) return;
      event.preventDefault();
      event.stopPropagation();
    };

    window.addEventListener("keydown", handleGlobalSearchShortcut, true);
    return () => window.removeEventListener("keydown", handleGlobalSearchShortcut, true);
  }, []);

  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ message?: string; transient?: boolean }>).detail;
      // الأخطاء العابرة المؤجلة في outbox لا تعرض كخطأ على الإطلاق في
      // صفحة تسجيل الدرجات. السبب: المستخدم يدخل عشرات الدرجات بسرعة،
      // وأي خطأ شبكي مؤقت كان يطلع إشعار خطأ يخليه يفكر الصفحة "فصلت"
      // ويفرض رفرش. الدرجات محفوظة محلياً وستُزامن تلقائياً، فلا داعي للتنبيه.
      if (detail?.transient && currentSection === "grade-entry") {
        return;
      }
      const message = detail?.message || "تعذر حفظ التغيير في النظام وتم الاحتفاظ به محلياً";
      if (currentSection === "grade-entry") {
        window.dispatchEvent(new CustomEvent("teacherpro:grade-entry-sync-error", { detail: { message } }));
        return;
      }
      // خارج صفحة تسجيل الدرجات، نخفي الأخطاء العابرة تماماً أيضاً لأنها
      // تُعاد محاولتها تلقائياً. نُظهر فقط الأخطاء غير العابرة (4xx دائمة).
      if (detail?.transient) return;
      toast.error(message);
    };
    window.addEventListener("teacherpro:server-sync-error", handler);
    return () => window.removeEventListener("teacherpro:server-sync-error", handler);
  }, [currentSection]);

  const [authChecked, setAuthChecked] = useState(false);
  useEffect(() => {
    let active = true;
    restoreSession().finally(() => {
      if (active) setAuthChecked(true);
    });
    return () => {
      active = false;
    };
  }, [restoreSession]);

  // Browser tab: «TP - <the page you are on>».
  useEffect(() => {
    const pageTitle = !authChecked
      ? ""
      : !isAuthenticated
        ? "تسجيل الدخول"
        : menuItems.find((item) => item.id === currentSection)?.title || "لوحة النظام";
    document.title = pageTitle ? `TP - ${pageTitle}` : "TP";
  }, [authChecked, isAuthenticated, currentSection]);

  // تحميل البيانات من النظام عند بدء التطبيق
  const [initDone, setInitDone] = useState(false);
  useEffect(() => {
    if (initDone || !isAuthenticated) return;
    setInitDone(true);
    loadFromServer().then((ok) => {
      if (!ok) {
        toast.warning("أنت تعمل محلياً؛ البيانات قد لا تُحفظ في النظام إلى أن يعود الاتصال بالنظام.");
      }
    });
  }, [initDone, isAuthenticated, loadFromServer]);

  useEffect(() => {
    if (!isAuthenticated && initDone) setInitDone(false);
  }, [initDone, isAuthenticated]);

  useEffect(() => {
    if (!isAuthenticated || dbLoading) return;
    if (PAGE_OWNED_SYNC_SECTIONS.has(currentSection)) return;
    if (lazyLoadedSectionsRef.current.has(currentSection)) return;
    lazyLoadedSectionsRef.current.add(currentSection);
    void loadSectionDataFromServer(currentSection);
  }, [currentSection, dbLoading, isAuthenticated, loadSectionDataFromServer]);

  // Smart Sync: one refresh owner per page, silent external refreshes, and
  // no local echo after a successful mutation.
  const syncRefreshTimerRef = useRef<ReturnType<typeof window.setTimeout> | null>(
    null,
  );
  const snapshotRebaselineTimerRef = useRef<ReturnType<typeof window.setTimeout> | null>(
    null,
  );
  const mainScrollRef = useRef<HTMLDivElement | null>(null);
  const scrollIdleTimerRef = useRef<ReturnType<typeof window.setTimeout> | null>(
    null,
  );
  const isUserScrollingRef = useRef(false);
  const lastServerSyncSnapshotRef = useRef<SyncVersionSnapshot | null>(null);
  const serverVersionCheckRef = useRef<
    ((options?: { force?: boolean; rebaselineOnly?: boolean }) => Promise<void>) | null
  >(null);

  useEffect(() => {
    if (!isAuthenticated) return;

    const scheduleSnapshotRebaseline = () => {
      if (snapshotRebaselineTimerRef.current) {
        window.clearTimeout(snapshotRebaselineTimerRef.current);
      }
      snapshotRebaselineTimerRef.current = window.setTimeout(() => {
        snapshotRebaselineTimerRef.current = null;
        void serverVersionCheckRef.current?.({ force: true, rebaselineOnly: true });
      }, 450) as unknown as ReturnType<typeof window.setTimeout>;
    };

    const refreshCurrentSection = (
      detail?: TeacherProDataChangedDetail | {
        source?: string;
        scopes?: string[];
      },
    ) => {
      if (!detailMatchesSection(detail, currentSection)) return;
      if (detail?.source === "local-mutation") return;

      // A remote mutation already triggered the page-owned query. Rebaseline
      // the lightweight version snapshot so the next poll does not replay it.
      if (detail?.source === "broadcast" || detail?.source === "storage") {
        scheduleSnapshotRebaseline();
      }

      if (PAGE_OWNED_SYNC_SECTIONS.has(currentSection)) return;

      lazyLoadedSectionsRef.current.delete(currentSection);
      if (syncRefreshTimerRef.current) {
        window.clearTimeout(syncRefreshTimerRef.current);
      }

      const scheduleRefresh = async () => {
        const busy = isUserScrollingRef.current || isTeacherProInteractionBusy();
        if (busy) {
          announceTeacherProSyncPending(detail?.scopes);
          syncRefreshTimerRef.current = window.setTimeout(
            () => void scheduleRefresh(),
            500,
          ) as unknown as ReturnType<typeof window.setTimeout>;
          return;
        }
        syncRefreshTimerRef.current = null;
        announceTeacherProSyncRefreshing(detail?.scopes);
        await loadSectionDataFromServer(currentSection);

        const touchesCore =
          !detail?.scopes ||
          detail.scopes.includes("all") ||
          detail.scopes.includes("core");
        if (touchesCore) await loadFromServer();
        announceTeacherProSyncSettled(detail?.scopes);
      };

      syncRefreshTimerRef.current = window.setTimeout(
        () => void scheduleRefresh(),
        650,
      ) as unknown as ReturnType<typeof window.setTimeout>;
    };

    const unsubscribe = subscribeTeacherProDataChanged(refreshCurrentSection);
    const handleLegacyStudentsUpdated = () =>
      refreshCurrentSection({
        source: "manual",
        scopes: ["students", "opportunities", "dashboard"],
      });
    window.addEventListener(
      "teacherpro:students-updated",
      handleLegacyStudentsUpdated,
    );
    return () => {
      unsubscribe();
      window.removeEventListener(
        "teacherpro:students-updated",
        handleLegacyStudentsUpdated,
      );
      if (syncRefreshTimerRef.current) {
        window.clearTimeout(syncRefreshTimerRef.current);
      }
      if (snapshotRebaselineTimerRef.current) {
        window.clearTimeout(snapshotRebaselineTimerRef.current);
      }
    };
  }, [isAuthenticated, currentSection, loadSectionDataFromServer, loadFromServer]);

  useEffect(() => {
    const scroller = mainScrollRef.current;
    if (!scroller) return;
    const onScroll = () => {
      isUserScrollingRef.current = true;
      if (scrollIdleTimerRef.current) {
        window.clearTimeout(scrollIdleTimerRef.current);
      }
      scrollIdleTimerRef.current = window.setTimeout(() => {
        isUserScrollingRef.current = false;
      }, 220) as unknown as ReturnType<typeof window.setTimeout>;
    };
    scroller.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      scroller.removeEventListener("scroll", onScroll);
      if (scrollIdleTimerRef.current) {
        window.clearTimeout(scrollIdleTimerRef.current);
      }
      isUserScrollingRef.current = false;
    };
  }, []);

  useEffect(() => {
    const onStatus = (event: Event) => {
      const detail = (event as CustomEvent<TeacherProSyncStatusDetail>).detail;
      if (detail?.status) setSyncStatus(detail);
    };
    window.addEventListener(TEACHERPRO_SYNC_STATUS_EVENT, onStatus);
    return () => window.removeEventListener(TEACHERPRO_SYNC_STATUS_EVENT, onStatus);
  }, []);

  // Background sync notifications are intentionally suppressed. Updates
  // are applied silently in the background — the user never sees a toast
  // or banner saying "توجد تحديثات جديدة". The sync system (smart-sync)
  // still defers updates while the user is actively editing/scrolling,
  // but it does so silently and applies them automatically when the user
  // pauses. No user interaction is required.
  //
  // The event listeners for PENDING/SETTLED are kept (so the sync system's
  // internal state machine stays consistent) but they no longer show any UI.
  useEffect(() => {
    const noop = () => {};
    window.addEventListener(TEACHERPRO_SYNC_PENDING_EVENT, noop);
    window.addEventListener(TEACHERPRO_SYNC_SETTLED_EVENT, noop);
    return () => {
      window.removeEventListener(TEACHERPRO_SYNC_PENDING_EVENT, noop);
      window.removeEventListener(TEACHERPRO_SYNC_SETTLED_EVENT, noop);
    };
  }, []);

  // Lightweight server-version polling. Local mutation echoes are consumed,
  // remote events are coalesced, and the event stays inside this tab because
  // every tab either receives the original broadcast or polls on wake.
  useEffect(() => {
    if (!isAuthenticated) return;
    let stopped = false;
    let inFlight = false;

    const checkServerVersion = async (options: {
      force?: boolean;
      rebaselineOnly?: boolean;
    } = {}) => {
      if (stopped || inFlight) return;
      if (!options.force && typeof document !== "undefined" && document.hidden) return;
      inFlight = true;
      try {
        const result = await syncVersionApi.get();
        const snapshot = normalizeSyncVersionSnapshot(result);
        if (!snapshot) return;
        const previousSnapshot = lastServerSyncSnapshotRef.current;
        if (!previousSnapshot) {
          lastServerSyncSnapshotRef.current = snapshot;
          return;
        }
        if (snapshot.version === previousSnapshot.version) return;

        const changedScopes = inferChangedSyncScopes(previousSnapshot, snapshot);
        lastServerSyncSnapshotRef.current = snapshot;

        if (options.rebaselineOnly) {
          consumeTeacherProLocalMutationEcho(changedScopes);
          return;
        }

        const { externalScopes } = consumeTeacherProLocalMutationEcho(changedScopes);
        if (externalScopes.length === 0) return;

        emitTeacherProDataChanged({
          source: "server-version",
          reason: "تغيير جديد في بيانات النظام",
          scopes: externalScopes,
          version: snapshot.version,
          broadcast: false,
        });
      } catch {
        // Sync polling is protective and must never interrupt the user.
      } finally {
        inFlight = false;
      }
    };

    serverVersionCheckRef.current = checkServerVersion;
    void checkServerVersion({ force: true });
    // Performance: 12s interval (was 10s). The sync/version endpoint now
    // uses a single SQL query instead of 19, so each poll is ~5x cheaper.
    // 12s gives a small additional reduction in DB load while keeping
    // near-real-time change detection (only 2s slower than before).
    const interval = window.setInterval(
      () => void checkServerVersion(),
      12_000,
    );
    const onWake = () => void checkServerVersion({ force: true });
    const unsubscribeLocalMutation = subscribeTeacherProLocalMutation(() => {
      // The API mutation has already completed; update only the version baseline.
      if (snapshotRebaselineTimerRef.current) {
        window.clearTimeout(snapshotRebaselineTimerRef.current);
      }
      snapshotRebaselineTimerRef.current = window.setTimeout(() => {
        snapshotRebaselineTimerRef.current = null;
        void checkServerVersion({ force: true, rebaselineOnly: true });
      }, 350) as unknown as ReturnType<typeof window.setTimeout>;
    });

    window.addEventListener("focus", onWake);
    window.addEventListener("online", onWake);
    document.addEventListener("visibilitychange", onWake);

    return () => {
      stopped = true;
      serverVersionCheckRef.current = null;
      unsubscribeLocalMutation();
      window.clearInterval(interval);
      window.removeEventListener("focus", onWake);
      window.removeEventListener("online", onWake);
      document.removeEventListener("visibilitychange", onWake);
      if (snapshotRebaselineTimerRef.current) {
        window.clearTimeout(snapshotRebaselineTimerRef.current);
      }
    };
  }, [isAuthenticated]);

  useEffect(() => {
    if (!isAuthenticated) return;
    const timer = window.setInterval(() => {
      void restoreSession();
    }, 10 * 60 * 1000);
    return () => window.clearInterval(timer);
  }, [isAuthenticated, restoreSession]);

  // A request was refused with 401: check the session right away. If it is
  // really gone the login screen shows, and the grades kept on this device
  // are sent as soon as the same account signs in again.
  useEffect(() => {
    if (!isAuthenticated) return;
    let lastCheck = 0;
    const onSessionCheck = () => {
      const now = Date.now();
      if (now - lastCheck < 3000) return;
      lastCheck = now;
      void restoreSession();
    };
    window.addEventListener(SESSION_CHECK_EVENT, onSessionCheck);
    return () => window.removeEventListener(SESSION_CHECK_EVENT, onSessionCheck);
  }, [isAuthenticated, restoreSession]);

  useEffect(() => {
    if (!isAuthenticated) return;
    const flushOfflineGrades = () => {
      if (typeof navigator !== "undefined" && !navigator.onLine) return;
      void flushGradeEntryOfflineSaves();
    };
    flushOfflineGrades();
    window.addEventListener("online", flushOfflineGrades);
    window.addEventListener("focus", flushOfflineGrades);
    return () => {
      window.removeEventListener("online", flushOfflineGrades);
      window.removeEventListener("focus", flushOfflineGrades);
    };
  }, [isAuthenticated]);

  // منع تمرير الخلفية عند فتح القائمة على الموبايل
  useEffect(() => {
    const shouldLockBody =
      sidebarOpen &&
      typeof window !== "undefined" &&
      window.matchMedia("(max-width: 1023px)").matches;
    if (!shouldLockBody) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [sidebarOpen]);

  const user = currentUser();
  const isAdmin = user?.username?.trim().toLowerCase() === "admin" || user?.roleId === "role_admin";
  const userPermsKey = user?.permissions?.join(",");
  const visibleMenuItems = useMemo(
    () => (isAdmin ? menuItems : menuItems.filter((item) => canAccess(item.id))),
    [canAccess, isAdmin, user?.id, user?.roleId, userPermsKey],
  );

  // Apply URL section after visibleMenuItems is available
  useEffect(() => {
    const applyUrlSection = () => {
      const urlSection = readSectionFromLocation();
      if (urlSection && canAccess(urlSection)) {
        const urlSectionVisible = visibleMenuItems.some((item) => item.id === urlSection);
        if (urlSectionVisible) setSection(urlSection);
      }
    };
    applyUrlSection();
    window.addEventListener("popstate", applyUrlSection);
    return () => window.removeEventListener("popstate", applyUrlSection);
  }, [canAccess, setSection, visibleMenuItems]);

  // إصلاح حرج: عند فتح الرابط في تبويبة جديدة، persist middleware يحمّل
  // currentSection القديم من localStorage قبل أي شي. هذا useEffect يشتغل
  // فوراً عند mount (قبل visibleMenuItems) ويضبط القسم من URL مباشرةً
  // متجاوزاً القيمة المخزّنة.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const urlSection = readSectionFromLocation();
    if (urlSection) {
      // تجاوز guard "نفس القسم" في setSection عن طريق استدعاء set مباشرة.
      // هذا ضروري لأن persist قد يكون حمّل نفس القسم من localStorage.
      useTeacherStore.setState({ currentSection: urlSection });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const currentSectionVisible = useMemo(
    () => visibleMenuItems.some((item) => item.id === currentSection),
    [visibleMenuItems, currentSection],
  );
  useEffect(() => {
    if (currentSection === "follow-up" || currentSection === "follow-up-leaves") {
      // An old leaves link opens the «إدارة الإجازات» window on the dashboard.
      if (readSectionFromLocation() === "follow-up-leaves") {
        const nextUrl = new URL(window.location.href);
        nextUrl.searchParams.set("section", "dashboard");
        nextUrl.searchParams.set("dialog", LEAVES_DIALOG_QUERY);
        nextUrl.hash = "";
        window.history.replaceState({}, "", nextUrl.toString());
        window.dispatchEvent(new Event(LEAVES_DIALOG_OPEN_EVENT));
      }
      setSection("dashboard");
      return;
    }
    if (currentSection === "admin-log-reset") {
      setSection("logs");
    }
  }, [currentSection, setSection]);
  const firstVisibleSectionId = visibleMenuItems[0]?.id ?? null;
  // A page whose group entry is visible lives inside it, not in the sidebar.
  const sidebarItems = useMemo(() => {
    const visibleIds = new Set(visibleMenuItems.map((item) => item.id));
    return sidebarOrder
      .map((id) => visibleMenuItems.find((item) => item.id === id))
      .filter((item): item is (typeof visibleMenuItems)[number] => Boolean(item))
      .filter((item) => {
        const parent = sectionParent.get(item.id);
        return !parent || !visibleIds.has(parent);
      });
  }, [visibleMenuItems]);

  useEffect(() => {
    if (
      (!canAccess(currentSection) || !currentSectionVisible) &&
      firstVisibleSectionId &&
      firstVisibleSectionId !== currentSection
    ) {
      setSection(firstVisibleSectionId);
    }
  }, [
    currentSection,
    currentSectionVisible,
    firstVisibleSectionId,
    canAccess,
    setSection,
  ]);

  const CurrentComponent =
    (isAdmin || canAccess(currentSection)) && currentSectionVisible
      ? sectionComponents[currentSection] || DashboardView
      : DashboardView;
  const currentMenu = menuItems.find((m) => m.id === currentSection);
  const currentParentMenu = sectionParent.has(currentSection)
    ? menuItems.find((m) => m.id === sectionParent.get(currentSection))
    : undefined;
  const currentGroupItems = (
    sectionGroups.find((group) => group.items.some((item) => item.id === currentSection))?.items || []
  ).filter((item) => isAdmin || canAccess(item.id));
  const CurrentMenuIcon = currentMenu?.icon || LayoutDashboard;
  // Numbers beside a page only when something there waits for someone.
  // Grade entry deliberately has none.
  const sectionAlerts: Partial<Record<SectionId, { count: number; label: string }>> = {
    ...(shortcutAlerts?.callNotesPending
      ? { "follow-up-calls": { count: shortcutAlerts.callNotesPending, label: `${shortcutAlerts.callNotesPending} ملاحظة مكالمة بانتظار الإنجاز` } }
      : {}),
  };
  const connectionVisualStatus = dbLoading
    ? "loading"
    : !dbConnected
      ? "offline"
      : syncStatus.status === "error"
        ? "error"
        : syncStatus.status === "pending" || syncStatus.status === "refreshing"
          ? "syncing"
          : "online";
  const connectionVisualLabel =
    connectionVisualStatus === "loading"
      ? "جاري الاتصال"
      : connectionVisualStatus === "offline"
        ? "غير متصل"
        : connectionVisualStatus === "error"
          ? "تعذر المزامنة"
          : connectionVisualStatus === "syncing"
            ? "جاري المزامنة"
            : "متصل";
  const connectionVisualDescription =
    connectionVisualStatus === "offline"
      ? "الاتصال بالنظام غير متاح؛ قد تبقى التغييرات محفوظة محليًا حتى عودة الاتصال."
      : connectionVisualStatus === "error"
        ? syncStatus.message || "تعذر إكمال مزامنة البيانات مع النظام."
        : connectionVisualStatus === "syncing"
          ? "جارٍ تحديث البيانات."
          : connectionVisualStatus === "loading"
            ? "جارٍ التحقق من الاتصال."
            : "الاتصال مستقر.";

  if (!authChecked) {
    return (
      <div className="app-bg tp-readable-ui tp-semantic-colors flex min-h-dvh items-center justify-center bg-background p-6" dir="rtl">
        <div className="w-full max-w-md">
          <LoadingState
            title="جاري التحقق من الجلسة..."
          />
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <LoginScreen theme={theme} toggleTheme={toggleTheme} login={login} />;
  }

  return (
    <div className="app-bg tp-readable-ui tp-semantic-colors tp-app-shell flex h-dvh overflow-hidden bg-background" dir="rtl">
      <ScheduledExamWorker />
      <a className="tp-skip-link" href="#teacherpro-main-content">
        تجاوز إلى المحتوى الرئيسي
      </a>
      {sidebarOpen && (
        <button
          type="button"
          aria-label="إغلاق القائمة الجانبية"
          className="tp-sidebar-overlay fixed inset-0 z-40 bg-overlay backdrop-blur-sm lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      <aside
        aria-label="التنقل الرئيسي"
        className={cn(
          "tp-app-sidebar fixed inset-y-0 right-0 z-50 flex h-dvh w-[min(11rem,calc(100dvw-0.75rem))] max-w-full flex-col overflow-hidden border-l border-sidebar-border bg-sidebar text-sidebar-foreground shadow-2xl transition-transform duration-300 lg:static lg:h-auto lg:w-[9.5rem] lg:shadow-none",
          sidebarOpen ? "translate-x-0" : "translate-x-full lg:translate-x-0",
        )}
      >
        <div className="absolute inset-0 pointer-events-none sidebar-aura" />

        <div className="relative border-b border-sidebar-border p-2.5">
          <div className="flex items-center gap-1">
            <div className="min-w-0 flex-1">
              <h1
                className="truncate text-base font-extrabold tracking-tight lg:text-lg"
                style={{
                  background:
                    "linear-gradient(135deg, #CD938F, #FBF9EB, #E6E3D9)",
                  WebkitBackgroundClip: "text",
                  backgroundClip: "text",
                  color: "transparent",
                  filter: "drop-shadow(0 1px 3px color-mix(in srgb, #CD938F 30%, transparent))",
                }}
              >
                TeacherPro
              </h1>
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="lg:hidden text-sidebar-foreground hover:bg-sidebar-accent"
              onClick={() => setSidebarOpen(false)}
              aria-label="إغلاق القائمة الجانبية"
            >
              <X className="w-5 h-5" />
            </Button>
          </div>
          <div className="mt-2 flex min-w-0 flex-wrap items-center gap-1.5 rounded-xl border border-sidebar-border bg-sidebar-foreground/[0.04] px-2 py-1.5">
            <div
              className={cn(
                "tp-connection-dot",
                `tp-connection-dot--${connectionVisualStatus}`,
              )}
              role="status"
              aria-label={connectionVisualLabel}
              title={connectionVisualDescription}
            />
            <p className="min-w-0 flex-1 truncate text-xs font-semibold text-sidebar-foreground" title={user?.role || ""}>
              {user?.name || "غير مسجل"}
            </p>
            <Button
              variant="ghost"
              size="icon"
              className="size-8 shrink-0 text-sidebar-foreground/60 hover:bg-sidebar-accent hover:text-sidebar-foreground"
              title="تسجيل الخروج"
              aria-label="تسجيل الخروج"
              onClick={() => {
                logout();
                toast.success("تم تسجيل الخروج");
              }}
            >
              <LogOut className="w-3.5 h-3.5" />
            </Button>
          </div>
          {!dbLoading && !dbConnected && (
            <div className="mt-2 rounded-xl border border-night-warning/40 bg-night-warning/10 px-2.5 py-1.5 text-[11px] leading-5 text-night-warning">
              غير متصل بالنظام؛ قد تبقى التغييرات محليًا حتى عودة الاتصال.
            </div>
          )}
        </div>

        <div
          className="app-scrollbar relative flex-1 overflow-y-auto overscroll-contain py-2.5"
          style={{ WebkitOverflowScrolling: "touch" }}
        >
          <nav className="space-y-1 px-1.5" aria-label="صفحات النظام">
            {sidebarItems.map((item) => {
              const Icon = item.icon;
              const isActive = currentSection === item.id || sectionParent.get(currentSection) === item.id;
              const alertCount = [item.id, ...Array.from(sectionParent.entries()).filter(([, parent]) => parent === item.id).map(([child]) => child)]
                .reduce((sum, id) => sum + (sectionAlerts[id]?.count || 0), 0);
              return (
                <a
                  key={item.id}
                  href={sectionHref(item.id)}
                  onClick={(event) => handleSectionLinkClick(event, item.id)}
                  aria-current={isActive ? "page" : undefined}
                  className={cn(
                    "group flex min-h-11 w-full touch-manipulation items-center gap-2 rounded-xl px-2 py-1.5 text-right text-[13px] transition-colors duration-200",
                    isActive
                      ? "bg-sidebar-primary text-sidebar-primary-foreground shadow-md shadow-primary/20"
                      : "text-sidebar-foreground/75 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                  )}
                >
                  <Icon
                    className={cn(
                      "size-4 shrink-0",
                      isActive
                        ? "text-sidebar-primary-foreground"
                        : "text-sidebar-foreground/60 group-hover:text-sidebar-accent-foreground",
                    )}
                  />
                  <span className="min-w-0 flex-1 font-semibold leading-5 [overflow-wrap:anywhere]">
                    {item.title}
                  </span>
                  <SidebarAlertBadge count={alertCount} label={sectionAlerts[item.id]?.label} />
                </a>
              );
            })}
          </nav>
        </div>

        <div className="relative shrink-0 border-t border-sidebar-border bg-sidebar-foreground/[0.03] p-1.5">
          <Button
            variant="ghost"
            size="sm"
            className="h-9 w-full justify-start rounded-xl px-2 text-xs text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
            onClick={toggleTheme}
          >
            {theme === "dark" ? (
              <Sun className="w-4 h-4 ml-1.5" />
            ) : (
              <Moon className="w-4 h-4 ml-1.5" />
            )}
            {theme === "dark" ? "صباحي" : "ليلي"}
          </Button>
        </div>
      </aside>

      <main
        className="tp-app-main flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
        aria-label="محتوى TeacherPro"
      >
        <header className="tp-app-header sticky top-0 z-30 border-b border-border/70 bg-background/90 shadow-sm backdrop-blur-xl supports-[backdrop-filter]:bg-background/78">
          <div className="tp-app-header__inner flex min-h-[4.5rem] min-w-0 items-center justify-between gap-2.5 px-3 py-2.5 md:min-h-[5.5rem] md:gap-3 md:px-6 md:py-3">
            <div className="tp-app-header__identity flex min-w-0 flex-1 items-center gap-2.5 md:gap-3.5">
              <Button
                variant="ghost"
                size="icon"
                className="tp-app-header__menu shrink-0 lg:hidden"
                onClick={toggleSidebar}
                aria-expanded={sidebarOpen}
                aria-label="فتح القائمة الجانبية"
              >
                <Menu className="h-5 w-5" />
              </Button>

              <div className="tp-app-header__page-icon hidden size-11 shrink-0 items-center justify-center rounded-2xl border border-primary/15 bg-primary/[0.08] text-primary shadow-sm sm:flex md:size-12">
                <CurrentMenuIcon className="size-5 md:size-[1.375rem]" />
              </div>

              <div className="tp-app-header__copy min-w-0 flex-1 text-right">
                <div className="mb-0.5 hidden items-center gap-1.5 text-[11px] font-semibold text-muted-foreground md:flex">
                  <span>TeacherPro</span>
                  <ChevronLeft className="size-3.5 opacity-45" />
                  {currentParentMenu ? (
                    <>
                      <span>{currentParentMenu.title}</span>
                      <ChevronLeft className="size-3.5 opacity-45" />
                    </>
                  ) : null}
                  <span className="truncate text-foreground/75">
                    {currentMenu?.title || "لوحة النظام"}
                  </span>
                </div>

                <div className="tp-app-header__title-row flex min-w-0 items-center gap-2">
                  <h2
                    className="truncate text-base font-black tracking-tight text-gradient-brand md:text-xl"
                    title={currentMenu?.title || "لوحة النظام"}
                  >
                    {currentMenu?.title || "لوحة النظام"}
                  </h2>
                </div>
              </div>
            </div>

            <div className="tp-app-header__actions flex min-w-0 shrink-0 flex-wrap items-center justify-end gap-1.5 sm:gap-2">
              {/* Connection shows only when it needs attention; the sidebar
                  dot keeps the everyday state. */}
              <div role="status" aria-live="polite" className="contents">
                {connectionVisualStatus === "offline" || connectionVisualStatus === "error" ? (
                  <div
                    className={cn(
                      "tp-connection-badge",
                      `tp-connection-badge--${connectionVisualStatus}`,
                    )}
                    title={connectionVisualDescription}
                  >
                    <span className="tp-connection-badge__dot" aria-hidden="true" />
                    <span>{connectionVisualLabel}</span>
                  </div>
                ) : null}
              </div>
              {actionStatus.status !== "idle" ? (
                <Badge
                  variant={actionStatus.status === "failed" ? "destructive" : "outline"}
                  className={cn(
                    "tp-save-indicator hidden sm:inline-flex",
                    actionStatus.status === "saving" && "tp-save-indicator--saving",
                    actionStatus.status === "saved" && "tp-save-indicator--saved",
                  )}
                  aria-live="polite"
                  title={actionStatus.description}
                >
                  <span className="hidden border-l border-current/20 pl-1.5 text-[10px] opacity-70 xl:inline">
                    حالة الحفظ
                  </span>
                  {actionStatus.status === "saving"
                    ? TEACHERPRO_ACTION_COPY.saving
                    : actionStatus.status === "saved"
                      ? TEACHERPRO_ACTION_COPY.saved
                      : `${TEACHERPRO_ACTION_COPY.failed} · ${TEACHERPRO_ACTION_COPY.retry}`}
                </Badge>
              ) : null}
              {/* Sync status badge removed — updates are now silent.
                  The sync system still works in the background; it just
                  doesn't show a visible indicator to the user. */}
              {sectionsWithPageSearch.has(currentSection) ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="tp-app-header__search min-h-10 shrink-0 gap-2 rounded-full px-3"
                  title="الانتقال إلى بحث الصفحة (Ctrl+F)"
                  aria-label="الانتقال إلى خانة البحث في الصفحة الحالية"
                  onClick={() => {
                    window.dispatchEvent(
                      new KeyboardEvent("keydown", {
                        key: "f",
                        code: "KeyF",
                        ctrlKey: true,
                        bubbles: true,
                        cancelable: true,
                      }),
                    );
                  }}
                >
                  <Search className="size-4" />
                  <span className="hidden text-xs font-bold md:inline">بحث الصفحة</span>
                  <kbd className="hidden rounded-md border border-border/70 bg-muted/60 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-muted-foreground xl:inline">
                    Ctrl F
                  </kbd>
                </Button>
              ) : null}
              <Button
                variant="outline"
                size="icon"
                onClick={toggleTheme}
                className="hidden shrink-0 rounded-full sm:inline-flex"
                aria-label={theme === "dark" ? "تفعيل الوضع الصباحي" : "تفعيل الوضع الليلي"}
              >
                {theme === "dark" ? (
                  <Sun className="h-4 w-4" />
                ) : (
                  <Moon className="h-4 w-4" />
                )}
              </Button>
            </div>
          </div>
        </header>

        {!dbLoading && !dbConnected && (
          <div className="border-b border-warning-line bg-warning-soft px-4 py-3 text-sm font-semibold text-warning md:px-6">
            تعذر إكمال تحميل البيانات.
            <Button className="ms-3" variant="outline" size="sm" onClick={() => void loadFromServer()}>
              إعادة المحاولة
            </Button>
          </div>
        )}

        <div
          id="teacherpro-main-content"
          ref={mainScrollRef}
          tabIndex={-1}
          className="tp-app-scroll app-scrollbar min-w-0 flex-1 overflow-y-auto overflow-x-visible overscroll-contain p-3 md:p-5 xl:p-7"
        >
          <div className="content-container tp-page-surface min-w-0 space-y-4 md:space-y-6" data-teacherpro-active-content="true" data-teacherpro-section={currentSection}>
            {dbLoading && <LoadingState />}
            {currentGroupItems.length > 1 ? (
              <nav className="tp-section-group" aria-label={currentParentMenu?.title || currentMenu?.title || "الصفحة"}>
                {currentGroupItems.map((item) => (
                  <a
                    key={item.id}
                    href={sectionHref(item.id)}
                    onClick={(event) => handleSectionLinkClick(event, item.id)}
                    aria-current={currentSection === item.id ? "page" : undefined}
                    data-kind={item.kind}
                    className="tp-section-group__item"
                  >
                    {item.kind === "action" ? <Plus className="size-4 shrink-0" aria-hidden="true" /> : null}
                    {item.label}
                  </a>
                ))}
              </nav>
            ) : null}
            {isAdmin || canAccess(currentSection) ? (
              CurrentComponent === DashboardView ? (
                <DashboardView onSectionLinkClick={handleSectionLinkClick} />
              ) : (
                <CurrentComponent />
              )
            ) : (
              <EmptyState icon={Lock} title="لا توجد صلاحية لفتح هذا القسم." />
            )}
          </div>
        </div>

      </main>
    </div>
  );
}
