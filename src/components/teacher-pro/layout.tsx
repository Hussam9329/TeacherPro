"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { useTeacherStore, type SectionId } from "@/lib/teacher-store";
import { syncVersionApi } from "@/lib/api";
import { emitTeacherProDataChanged, subscribeTeacherProDataChanged, type TeacherProDataChangedDetail } from "@/lib/teacherpro-sync";
import {
  LayoutDashboard,
  BookOpen,
  BookMarked,
  UserPlus,
  ClipboardList,
  
  UsersRound,
  UserX,
  FileText,
  PenTool,
  FileCheck,
  BarChart3,
  Target,
  CheckSquare,
  PhoneCall,
  CalendarCheck,
  Handshake,
  Shield,
  ScrollText,
  ShieldAlert,
  Sun,
  Moon,
  Menu,
  X,
  LogOut,
  ChevronDown,
  KeyRound,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

const menuItems: {
  id: SectionId;
  title: string;
  sub: string;
  icon: React.ElementType;
}[] = [
  {
    id: "dashboard",
    title: "لوحة النظام",
    sub: "نظرة عامة",
    icon: LayoutDashboard,
  },
  {
    id: "missing-students-notes",
    title: "الطلاب الغير موجودين",
    sub: "ملاحظات الإدخال",
    icon: UserX,
  },
  {
    id: "courses",
    title: "الدورات",
    sub: "صنع وإدارة",
    icon: BookOpen,
  },
  { id: "chapters", title: "الفصول والفرص", sub: "الفصول", icon: BookMarked },
  {
    id: "student-register",
    title: "تسجيل الطلاب",
    sub: "إضافة",
    icon: UserPlus,
  },
  {
    id: "student-registry",
    title: "سجل الطلاب",
    sub: "بطاقات",
    icon: ClipboardList,
  },
  {
    id: "student-bulk-import",
    title: "إضافة جماعية للطلاب",
    sub: "لصق ومعاينة",
    icon: UsersRound,
  },
  { id: "dismissed-students", title: "المفصولون", sub: "قائمة", icon: UserX },
  { id: "exam-new", title: "إضافة الامتحان", sub: "القواعد", icon: FileText },
  { id: "grade-entry", title: "تسجيل الدرجات", sub: "إدخال", icon: PenTool },
  { id: "exam-records", title: "سجل الامتحانات", sub: "PDF", icon: FileCheck },
  { id: "grade-records", title: "سجل الدرجات", sub: "سجل", icon: BarChart3 },
  { id: "opportunities", title: "إدارة الفرص", sub: "خصم/إضافة", icon: Target },
  {
    id: "e-correction",
    title: "التصحيح الإلكتروني",
    sub: "المتصدرين",
    icon: CheckSquare,
  },
  { id: "follow-up-calls", title: "المكالمات", sub: "اتصالات المتابعة", icon: PhoneCall },
  { id: "follow-up-leaves", title: "الإجازات", sub: "إجازات الطلاب", icon: CalendarCheck },
  { id: "follow-up-pledges", title: "تعهدات", sub: "تعهدات الفصل", icon: Handshake },
  { id: "accounts", title: "إدارة الحسابات", sub: "صلاحيات", icon: Shield },
  { id: "logs", title: "السجلات", sub: "تدقيق", icon: ScrollText },
  { id: "admin-log-reset", title: "تصفير الlog", sub: "مدير النظام فقط", icon: ShieldAlert },
];

const menuFamilies: { title: string; itemIds: SectionId[] }[] = [
  { title: "الدورات", itemIds: ["courses"] },
  { title: "الفرص", itemIds: ["chapters", "opportunities"] },
  { title: "الطلاب", itemIds: ["student-register", "student-bulk-import", "student-registry", "dismissed-students"] },
  {
    title: "الامتحانات والدرجات",
    itemIds: ["exam-new", "grade-entry", "exam-records", "grade-records", "missing-students-notes"],
  },
  { title: "المتابعة", itemIds: ["follow-up-calls", "follow-up-leaves", "follow-up-pledges"] },
  { title: "الإدارة", itemIds: ["accounts", "logs", "admin-log-reset"] },
];

const familyItemIds = new Set<SectionId>(
  menuFamilies.flatMap((family) => family.itemIds),
);
const sectionIds = new Set<SectionId>(menuItems.map((item) => item.id));

const SECTION_SYNC_SCOPES: Record<SectionId, string[]> = {
  dashboard: ["dashboard", "students", "grades", "opportunities", "exams", "correction"],
  "missing-students-notes": ["grade-entry-notes", "grades", "exams"],
  courses: ["courses", "students", "exams", "dashboard"],
  chapters: ["chapters", "courses", "students", "opportunities", "dashboard"],
  "student-register": ["students", "courses", "opportunities", "dashboard"],
  "student-registry": ["students", "courses", "opportunities", "grades", "follow-up", "dashboard"],
  "student-bulk-import": ["students", "courses", "opportunities", "bulk-import", "dashboard"],
  "dismissed-students": ["students", "grades", "opportunities", "dismissed", "dashboard"],
  "exam-new": ["exams", "courses", "grades", "dashboard"],
  "grade-entry": ["grades", "students", "exams", "opportunities", "grade-entry-notes", "dashboard"],
  "exam-records": ["exams", "courses", "grades", "students", "correction", "grade-entry-notes", "dashboard"],
  "grade-records": ["grades", "students", "exams", "opportunities", "dashboard"],
  opportunities: ["opportunities", "opportunity-logs", "students", "grades", "dashboard"],
  "e-correction": ["correction", "students", "exams", "grades", "dashboard"],
  "follow-up": ["follow-up", "students", "grades", "opportunities", "dashboard"],
  "follow-up-calls": ["follow-up", "students", "dashboard"],
  "follow-up-leaves": ["follow-up", "students", "grades", "opportunities", "dashboard"],
  "follow-up-pledges": ["follow-up", "students", "opportunities", "dashboard"],
  accounts: ["accounts", "logs"],
  logs: ["logs", "opportunity-logs"],
  "admin-log-reset": ["logs", "opportunity-logs", "opportunities", "dashboard"],
};

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
    "correction",
    "grade-entry-notes",
    "dashboard",
  ],
  grades: ["grades", "students", "opportunities", "dashboard"],
  opportunityLogs: ["opportunities", "opportunity-logs", "students", "dashboard"],
  studentLeaves: ["follow-up", "students", "grades", "opportunities", "dashboard"],
  studentCalls: ["follow-up", "students", "dashboard"],
  studentNotes: ["follow-up", "students", "opportunities", "dashboard"],
  correctionSheets: ["correction", "students", "exams", "grades", "dashboard"],
  telegramSubmissions: ["correction", "students", "exams", "grades", "dashboard"],
  users: ["accounts"],
  roles: ["accounts"],
  auditLogs: ["logs"],
  missingNotes: ["grade-entry-notes", "grades", "exams"],
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
  if (value === 'follow-up') return 'follow-up-leaves' as SectionId;
  if (value === 'course-new' || value === 'site-management') {
    return 'courses' as SectionId;
  }
  return sectionIds.has(value as SectionId) ? (value as SectionId) : null;
}

import { DashboardView } from "./dashboard";
import { CoursesView } from "./courses";
import { ChaptersView } from "./chapters";
import { StudentRegisterView } from "./student-register";
import { StudentBulkTextImportView } from "./student-bulk-text-import";
import { StudentRegistryView } from "./student-registry";
import { DismissedStudentsView } from "./dismissed-students";
import { ExamNewView } from "./exam-new";
import { GradeEntryView } from "./grade-entry";
import { MissingStudentsNotesView } from "./missing-students-notes";
import { ExamRecordsView } from "./exam-records";
import { GradeRecordsView } from "./grade-records";
import { OpportunitiesView } from "./opportunities";
import { ECorrectionView } from "./e-correction";
import { FollowUpCallsView, FollowUpLeavesView, FollowUpPledgesView, FollowUpView } from "./follow-up";
import { AccountsView } from "./accounts";
import { LogsView } from "./logs";
import { AdminLogResetView } from "./admin-log-reset";
import { LoadingState } from "./ui-kit";

const sectionComponents: Record<SectionId, React.ComponentType> = {
  dashboard: DashboardView,
  courses: CoursesView,
  chapters: ChaptersView,
  "student-register": StudentRegisterView,
  "student-bulk-import": StudentBulkTextImportView,
  "student-registry": StudentRegistryView,
  "dismissed-students": DismissedStudentsView,
  "exam-new": ExamNewView,
  "grade-entry": GradeEntryView,
  "missing-students-notes": MissingStudentsNotesView,
  "exam-records": ExamRecordsView,
  "grade-records": GradeRecordsView,
  opportunities: OpportunitiesView,
  "follow-up": FollowUpView,
  "follow-up-calls": FollowUpCallsView,
  "follow-up-leaves": FollowUpLeavesView,
  "follow-up-pledges": FollowUpPledgesView,
  "e-correction": ECorrectionView,
  accounts: AccountsView,
  logs: LogsView,
  "admin-log-reset": AdminLogResetView,
};


type LoginScreenProps = {
  theme: string;
  toggleTheme: () => void;
  login: (username: string, password: string) => Promise<{ ok: boolean; message: string }>;
};

function LoginScreen({ theme, toggleTheme, login }: LoginScreenProps) {
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
    <div className="app-bg min-h-dvh flex items-center justify-center bg-background p-4" dir="rtl">
      <div className="absolute inset-0 pointer-events-none bg-[radial-gradient(circle_at_top,rgba(147,51,234,0.18),transparent_32rem)]" />
      <div className="relative w-full max-w-md overflow-hidden rounded-[2rem] border border-border/70 bg-card/95 shadow-2xl backdrop-blur-xl">
        <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-l from-primary via-fuchsia-500 to-indigo-500" />
        <div className="p-7 space-y-6">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h1 className="text-3xl font-extrabold text-gradient-brand">TeacherPro</h1>
              <p className="mt-1 text-sm text-muted-foreground">تسجيل دخول مدير النظام</p>
            </div>
            <Button variant="outline" size="icon" className="rounded-full" onClick={toggleTheme} type="button">
              {theme === "dark" ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </Button>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="login-username">اسم المستخدم</Label>
              <Input
                id="login-username"
                autoComplete="username"
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                placeholder="اسم المستخدم"
                className="h-12 rounded-2xl"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="login-password">الرمز</Label>
              <Input
                id="login-password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="الرمز"
                className="h-12 rounded-2xl"
              />
            </div>
            <Button type="submit" className="h-12 w-full rounded-2xl text-base font-bold" disabled={loading}>
              <KeyRound className="ml-2 h-4 w-4" />
              {loading ? "جاري الدخول..." : "دخول للنظام"}
            </Button>
          </form>

          <div className="rounded-2xl border border-primary/20 bg-primary/5 p-3 text-xs leading-6 text-muted-foreground">
            للحصول على حساب تواصل مع مدير النظام.
          </div>
        </div>
      </div>
    </div>
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

  const lazyLoadedSectionsRef = useRef<Set<SectionId>>(new Set());

  const [openFamilies, setOpenFamilies] = useState<Record<string, boolean>>(() => {
    // Open all families by default
    const initial: Record<string, boolean> = {};
    menuFamilies.forEach((family) => {
      initial[family.title] = true;
    });
    return initial;
  });

  const toggleFamily = (title: string) => {
    React.startTransition(() => {
      setOpenFamilies((prev) => ({ ...prev, [title]: !prev[title] }));
    });
  };

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
    React.startTransition(() => setSection(section));
    if (typeof window !== "undefined") {
      window.requestAnimationFrame(() => {
        const nextUrl = new URL(window.location.href);
        nextUrl.searchParams.set("section", section);
        nextUrl.hash = "";
        window.history.pushState({}, "", nextUrl.toString());
        if (window.innerWidth < 1024) setSidebarOpen(false);
      });
    }
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
      const message = detail?.message || "تعذر حفظ التغيير في الخادم وتم الاحتفاظ به محلياً";
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

  // تحميل البيانات من الخادم عند بدء التطبيق
  const [initDone, setInitDone] = useState(false);
  useEffect(() => {
    if (initDone || !isAuthenticated) return;
    setInitDone(true);
    loadFromServer().then((ok) => {
      if (!ok) {
        toast.warning("أنت تعمل محلياً؛ البيانات قد لا تُحفظ في السيرفر إلى أن يعود اتصال قاعدة البيانات.");
      }
    });
  }, [initDone, isAuthenticated, loadFromServer]);

  useEffect(() => {
    if (!isAuthenticated && initDone) setInitDone(false);
  }, [initDone, isAuthenticated]);

  useEffect(() => {
    if (!isAuthenticated || dbLoading) return;
    if (lazyLoadedSectionsRef.current.has(currentSection)) return;
    lazyLoadedSectionsRef.current.add(currentSection);
    void loadSectionDataFromServer(currentSection);
  }, [currentSection, dbLoading, isAuthenticated, loadSectionDataFromServer]);

  // أي تعديل ناجح في أي مكان يطلق إشارة sync عامة.
  // نعيد تحميل القسم الحالي فقط حتى تبقى الواجهة فورية بدون تحميل كل الجداول الثقيلة.
  const syncRefreshTimerRef = useRef<ReturnType<typeof window.setTimeout> | null>(
    null,
  );
  const mainScrollRef = useRef<HTMLDivElement | null>(null);
  const scrollIdleTimerRef = useRef<ReturnType<typeof window.setTimeout> | null>(
    null,
  );
  const isUserScrollingRef = useRef(false);
  const lastServerSyncSnapshotRef = useRef<SyncVersionSnapshot | null>(null);

  useEffect(() => {
    if (!isAuthenticated) return;

    const refreshCurrentSection = (
      detail?: TeacherProDataChangedDetail | {
        source?: string;
        scopes?: string[];
      },
    ) => {
      if (!detailMatchesSection(detail, currentSection)) return;

      // لا نعيد تحميل القسم العام لنفس التاب بعد كل تعديل محلي: الصفحة نفسها
      // أو الـ store يحدثان الحالة فوراً. إعادة التحميل هنا كانت تتزامن مع
      // useTeacherProSyncKey داخل الصفحة وتسبب refetch مزدوج ورجفة أثناء السكرول.
      if (detail?.source === "local-mutation") return;

      lazyLoadedSectionsRef.current.delete(currentSection);
      if (syncRefreshTimerRef.current) {
        window.clearTimeout(syncRefreshTimerRef.current);
      }
      const refreshDelay = isUserScrollingRef.current ? 420 : 160;
      syncRefreshTimerRef.current = window.setTimeout(() => {
        if (isUserScrollingRef.current) {
          refreshCurrentSection(detail);
          return;
        }
        void loadSectionDataFromServer(currentSection);
        const cameFromAnotherContext =
          detail?.source && detail.source !== "local-mutation";
        const touchesCore =
          !detail?.scopes ||
          detail.scopes.includes("all") ||
          detail.scopes.includes("core");
        if (cameFromAnotherContext && touchesCore) {
          void loadFromServer();
        }
      }, refreshDelay) as unknown as ReturnType<typeof window.setTimeout>;
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
      }, 180) as unknown as ReturnType<typeof window.setTimeout>;
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

  // كشف تغييرات التبويبات الأخرى أو مستخدم آخر بفحص خفيف جداً للإصدار.
  // لا يحمل الطلاب/الدرجات؛ فقط بصمة counts وآخر timestamps، ثم يطلق sync عند الاختلاف.
  useEffect(() => {
    if (!isAuthenticated) return;
    let stopped = false;
    let inFlight = false;

    const checkServerVersion = async (force = false) => {
      if (stopped || inFlight) return;
      if (!force && typeof document !== "undefined" && document.hidden) return;
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
        if (snapshot.version !== previousSnapshot.version) {
          const changedScopes = inferChangedSyncScopes(
            previousSnapshot,
            snapshot,
          );
          lastServerSyncSnapshotRef.current = snapshot;
          emitTeacherProDataChanged({
            source: "server-version",
            reason: "تغيير جديد في قاعدة البيانات",
            scopes: changedScopes,
            version: snapshot.version,
          });
        }
      } catch {
        // فشل فحص الإصدار لا يزعج المستخدم؛ فحص sync وقائي فقط.
      } finally {
        inFlight = false;
      }
    };

    void checkServerVersion(true);
    const interval = window.setInterval(() => void checkServerVersion(false), 5000);
    const onWake = () => void checkServerVersion(true);
    window.addEventListener("focus", onWake);
    window.addEventListener("online", onWake);
    document.addEventListener("visibilitychange", onWake);

    return () => {
      stopped = true;
      window.clearInterval(interval);
      window.removeEventListener("focus", onWake);
      window.removeEventListener("online", onWake);
      document.removeEventListener("visibilitychange", onWake);
    };
  }, [isAuthenticated]);

  useEffect(() => {
    if (!isAuthenticated) return;
    const timer = window.setInterval(() => {
      void restoreSession();
    }, 10 * 60 * 1000);
    return () => window.clearInterval(timer);
  }, [isAuthenticated, restoreSession]);

  // منع تمرير الخلفية عند فتح القائمة على الموبايل
  useEffect(() => {
    if (sidebarOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
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
    if (currentSection === "follow-up") {
      setSection("follow-up-leaves");
    }
  }, [currentSection, setSection]);
  const firstVisibleSectionId = visibleMenuItems[0]?.id ?? null;
  const dashboardMenuItem = visibleMenuItems.find(
    (item) => item.id === "dashboard",
  );
  const groupedMenuFamilies = useMemo(
    () =>
      menuFamilies
        .map((family) => ({
          ...family,
          items: family.itemIds
            .map((id) => visibleMenuItems.find((item) => item.id === id))
            .filter((item): item is (typeof visibleMenuItems)[number] =>
              Boolean(item),
            ),
        }))
        .filter((family) => family.items.length > 0),
    [visibleMenuItems],
  );
  const standaloneMenuItems = visibleMenuItems.filter(
    (item) => item.id !== "dashboard" && !familyItemIds.has(item.id),
  );

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

  if (!authChecked) {
    return (
      <div className="app-bg flex min-h-dvh items-center justify-center bg-background p-6" dir="rtl">
        <div className="w-full max-w-md">
          <LoadingState
            title="جاري التحقق من الجلسة..."
            description="نراجع تسجيل الدخول المحفوظ قبل فتح النظام."
          />
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <LoginScreen theme={theme} toggleTheme={toggleTheme} login={login} />;
  }

  return (
    <div className="app-bg flex h-dvh overflow-hidden bg-background" dir="rtl">
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      <aside
        className={cn(
          "fixed lg:static inset-y-0 right-0 z-50 w-[19rem] h-dvh lg:h-auto bg-sidebar text-sidebar-foreground border-l border-sidebar-border flex flex-col transition-transform duration-300 overflow-hidden shadow-2xl lg:shadow-none",
          sidebarOpen ? "translate-x-0" : "translate-x-full lg:translate-x-0",
        )}
      >
        <div className="absolute inset-0 pointer-events-none sidebar-aura" />

        <div className="relative p-4 border-b border-sidebar-border">
          <div className="flex items-center gap-3">
            <div className="flex-1">
              <h1
                className="text-2xl font-extrabold tracking-tight md:text-3xl"
                style={{
                  background:
                    "linear-gradient(135deg, oklch(0.75 0.18 300), oklch(0.88 0.14 288), oklch(0.80 0.12 255))",
                  WebkitBackgroundClip: "text",
                  backgroundClip: "text",
                  color: "transparent",
                  filter: "drop-shadow(0 1px 3px oklch(0.70 0.22 300 / 0.3))",
                }}
              >
                TeacherPro
              </h1>
              <p className="text-xs text-sidebar-foreground/60">
                واجهة تعليمية احترافية
              </p>
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="lg:hidden text-sidebar-foreground hover:bg-sidebar-accent"
              onClick={() => setSidebarOpen(false)}
            >
              <X className="w-5 h-5" />
            </Button>
          </div>
          <div className="mt-4 flex items-center gap-2 rounded-2xl border border-sidebar-border bg-white/[0.04] px-3 py-2">
            <div
              className={`size-2.5 rounded-full ${dbConnected ? "bg-green-500 shadow-[0_0_18px_rgba(34,197,94,0.5)]" : dbLoading ? "bg-yellow-500 animate-pulse" : "bg-red-500 shadow-[0_0_18px_rgba(239,68,68,0.5)]"}`}
            />
            <p className="text-sm font-semibold text-sidebar-foreground truncate">
              {user?.name || "غير مسجل"}
            </p>
            <Badge
              variant="secondary"
              className="text-[10px] bg-white/10 text-sidebar-foreground border-white/10"
            >
              {user?.role || "-"}
            </Badge>
            <div className="flex-1" />
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-sidebar-foreground/60 hover:text-sidebar-foreground hover:bg-sidebar-accent"
              title="تسجيل الخروج"
              onClick={() => {
                logout();
                toast.success("تم تسجيل الخروج");
              }}
            >
              <LogOut className="w-3.5 h-3.5" />
            </Button>
          </div>
          {!dbLoading && !dbConnected && (
            <div className="mt-3 rounded-2xl border border-amber-300/30 bg-amber-500/10 px-3 py-2 text-xs leading-6 text-amber-100">
              أنت تعمل محلياً؛ البيانات قد لا تُحفظ في السيرفر.
            </div>
          )}
        </div>

        <div
          className="app-scrollbar relative flex-1 overflow-y-auto overscroll-contain py-3"
          style={{ WebkitOverflowScrolling: "touch" }}
        >
          <nav className="space-y-3 px-3">
            {dashboardMenuItem &&
              (() => {
                const item = dashboardMenuItem;
                const Icon = item.icon;
                const isActive = currentSection === item.id;
                return (
                  <a
                    key={item.id}
                    href={sectionHref(item.id)}
                    onClick={(event) => handleSectionLinkClick(event, item.id)}
                    className={cn(
                      "relative w-full flex items-center gap-3 px-3 py-3 rounded-2xl text-sm transition-all duration-200 group text-right",
                      isActive
                        ? "bg-sidebar-primary text-sidebar-primary-foreground shadow-lg shadow-primary/20"
                        : "text-sidebar-foreground/75 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground hover:translate-x-[-2px]",
                    )}
                  >
                    <span
                      className={cn(
                        "flex size-9 shrink-0 items-center justify-center rounded-xl transition-colors",
                        isActive
                          ? "bg-white/16"
                          : "bg-white/[0.04] group-hover:bg-white/[0.08]",
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
                    </span>
                    <div className="flex-1 text-right">
                      <div className="font-medium">{item.title}</div>
                      <div
                        className={cn(
                          "text-[10px]",
                          isActive
                            ? "text-sidebar-primary-foreground/70"
                            : "text-sidebar-foreground/40",
                        )}
                      >
                        {item.sub}
                      </div>
                    </div>
                  </a>
                );
              })()}

            {groupedMenuFamilies.map((family) => {
              const isFamilyOpen = Boolean(openFamilies[family.title]);
              const hasActiveItem = family.items.some(
                (item) => item.id === currentSection,
              );

              return (
                <div
                  key={family.title}
                  className="rounded-3xl border border-sidebar-border/70 bg-white/[0.025] p-2 shadow-sm"
                >
                  <button
                    type="button"
                    onClick={() => toggleFamily(family.title)}
                    aria-expanded={isFamilyOpen}
                    className={cn(
                      "w-full flex items-center gap-3 px-3 py-3 rounded-2xl text-sm transition-all duration-200 text-right group",
                      hasActiveItem
                        ? "bg-sidebar-primary/15 text-sidebar-foreground"
                        : "text-sidebar-foreground/75 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                    )}
                  >
                    <span className="flex-1 text-right font-black">
                      {family.title}
                    </span>
                    <Badge
                      variant="secondary"
                      className="text-[10px] bg-white/10 text-sidebar-foreground border-white/10"
                    >
                      {family.items.length}
                    </Badge>
                    <ChevronDown
                      className={cn(
                        "size-4 shrink-0 transition-transform duration-200 text-sidebar-foreground/60",
                        isFamilyOpen && "rotate-180",
                      )}
                    />
                  </button>

                  {isFamilyOpen && (
                    <div className="mt-2 space-y-1.5">
                      {family.items.map((item) => {
                        const Icon = item.icon;
                        const isActive = currentSection === item.id;
                        return (
                          <a
                            key={item.id}
                            href={sectionHref(item.id)}
                            onClick={(event) =>
                              handleSectionLinkClick(event, item.id)
                            }
                            className={cn(
                              "relative w-full flex items-center gap-3 px-3 py-3 rounded-2xl text-sm transition-all duration-200 group text-right",
                              isActive
                                ? "bg-sidebar-primary text-sidebar-primary-foreground shadow-lg shadow-primary/20"
                                : "text-sidebar-foreground/75 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground hover:translate-x-[-2px]",
                            )}
                          >
                            <span
                              className={cn(
                                "flex size-9 shrink-0 items-center justify-center rounded-xl transition-colors",
                                isActive
                                  ? "bg-white/16"
                                  : "bg-white/[0.04] group-hover:bg-white/[0.08]",
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
                            </span>
                            <div className="flex-1 text-right">
                              <div className="font-medium">{item.title}</div>
                              <div
                                className={cn(
                                  "text-[10px]",
                                  isActive
                                    ? "text-sidebar-primary-foreground/70"
                                    : "text-sidebar-foreground/40",
                                )}
                              >
                                {item.sub}
                              </div>
                            </div>
                          </a>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}

            {standaloneMenuItems.map((item) => {
              const Icon = item.icon;
              const isActive = currentSection === item.id;
              return (
                <a
                  key={item.id}
                  href={sectionHref(item.id)}
                  onClick={(event) => handleSectionLinkClick(event, item.id)}
                  className={cn(
                    "relative w-full flex items-center gap-3 px-3 py-3 rounded-2xl text-sm transition-all duration-200 group text-right",
                    isActive
                      ? "bg-sidebar-primary text-sidebar-primary-foreground shadow-lg shadow-primary/20"
                      : "text-sidebar-foreground/75 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground hover:translate-x-[-2px]",
                  )}
                >
                  <span
                    className={cn(
                      "flex size-9 shrink-0 items-center justify-center rounded-xl transition-colors",
                      isActive
                        ? "bg-white/16"
                        : "bg-white/[0.04] group-hover:bg-white/[0.08]",
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
                  </span>
                  <div className="flex-1 text-right">
                    <div className="font-medium">{item.title}</div>
                    <div
                      className={cn(
                        "text-[10px]",
                        isActive
                          ? "text-sidebar-primary-foreground/70"
                          : "text-sidebar-foreground/40",
                      )}
                    >
                      {item.sub}
                    </div>
                  </div>
                </a>
              );
            })}
          </nav>
        </div>

        <div className="relative border-t border-sidebar-border bg-black/[0.08] p-3 shrink-0">
          <Button
            variant="ghost"
            size="sm"
            className="w-full justify-start rounded-2xl text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
            onClick={toggleTheme}
          >
            {theme === "dark" ? (
              <Sun className="w-4 h-4 ml-2" />
            ) : (
              <Moon className="w-4 h-4 ml-2" />
            )}
            {theme === "dark" ? "الوضع الصباحي" : "الوضع الليلي"}
          </Button>
        </div>
      </aside>

      <main className="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <header className="sticky top-0 z-30 border-b border-border/70 bg-background/75 backdrop-blur-xl supports-[backdrop-filter]:bg-background/65">
          <div className="flex items-center justify-between gap-2 px-3 py-2 md:px-6 md:py-3">
            <div className="flex items-center gap-2 md:gap-3">
              <Button
                variant="ghost"
                size="icon"
                className="lg:hidden shrink-0"
                onClick={toggleSidebar}
              >
                <Menu className="w-5 h-5" />
              </Button>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="hidden sm:inline-flex shrink-0">
                    {currentMenu?.sub || "نظرة عامة"}
                  </Badge>
                  <h2 className="font-black text-base md:text-xl tracking-tight text-gradient-brand truncate">
                    {currentMenu?.title || "لوحة النظام"}
                  </h2>
                </div>
                <p className="text-xs text-muted-foreground mt-0.5 hidden md:block">
                  إدارة ذكية وسريعة للطلاب والامتحانات والفرص
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <Button
                variant="outline"
                size="icon"
                onClick={toggleTheme}
                className="rounded-full shrink-0"
              >
                {theme === "dark" ? (
                  <Sun className="w-4 h-4" />
                ) : (
                  <Moon className="w-4 h-4" />
                )}
              </Button>
              <Badge variant="secondary" className="hidden sm:flex shrink-0">
                {user?.name || "غير مسجل"}
              </Badge>
            </div>
          </div>
        </header>

        {!dbLoading && !dbConnected && (
          <div className="border-b border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-100 md:px-6">
            أنت تعمل محلياً؛ البيانات قد لا تُحفظ في السيرفر. تأكد من اتصال قاعدة البيانات قبل الاعتماد على التغييرات.
          </div>
        )}

        <div
          ref={mainScrollRef}
          className="app-scrollbar flex-1 overflow-y-auto overscroll-contain p-3 md:p-6 xl:p-8"
        >
          <div className="content-container space-y-4 md:space-y-6" data-teacherpro-active-content="true" data-teacherpro-section={currentSection}>
            {dbLoading && <LoadingState />}
            {isAdmin || canAccess(currentSection) ? (
              <CurrentComponent />
            ) : (
              <div className="empty-state">لا توجد صلاحية لفتح هذا القسم.</div>
            )}
          </div>
        </div>

      </main>
    </div>
  );
}
