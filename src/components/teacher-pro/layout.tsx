"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { useTeacherStore, type SectionId } from "@/lib/teacher-store";
import { syncVersionApi } from "@/lib/api";
import {
  announceTeacherProSyncPending,
  announceTeacherProSyncRefreshing,
  announceTeacherProSyncSettled,
  consumeTeacherProLocalMutationEcho,
  emitTeacherProDataChanged,
  isTeacherProInteractionBusy,
  requestTeacherProSyncNow,
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
  Sun,
  Moon,
  Menu,
  X,
  LogOut,
  ChevronDown,
  ChevronLeft,
  KeyRound,
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
    title: "الطلاب غير الموجودين",
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
  { title: "الإدارة", itemIds: ["accounts", "logs"] },
];

const familyItemIds = new Set<SectionId>(
  menuFamilies.flatMap((family) => family.itemIds),
);

const sectionDescriptions: Partial<Record<SectionId, string>> = {
  dashboard: "ملخص سريع لحالة الطلاب والامتحانات والتنبيهات الإدارية.",
  "missing-students-notes": "مراجعة ملاحظات الطلاب غير الموجودين أثناء إدخال الدرجات.",
  courses: "إنشاء الدورات ومراجعة إعداداتها وحالتها التشغيلية.",
  chapters: "تنظيم الفصول وربطها بالدورات ومتابعة حالة الفرص.",
  "student-register": "إضافة طالب جديد وربطه بالدورة والبرنامج والموقع المناسب.",
  "student-registry": "البحث في ملفات الطلاب ومراجعة بياناتهم وحالتهم.",
  "student-bulk-import": "إضافة مجموعة طلاب بعد لصق البيانات ومراجعتها قبل الحفظ.",
  "dismissed-students": "متابعة حالات الفصل والتعهدات وإعادة التفعيل.",
  "exam-new": "إنشاء امتحان وتحديد الدورات والمواقع وقواعد الدرجات.",
  "grade-entry": "إدخال درجات الطلاب ومتابعة حالات الحفظ والغياب.",
  "exam-records": "مراجعة الامتحانات السابقة وإعداداتها وحالتها.",
  "grade-records": "البحث في سجل الدرجات ومراجعة النتائج المسجلة.",
  opportunities: "متابعة فرص الطلاب وتنفيذ الإضافة أو الخصم بضوابط النظام.",
  "e-correction": "مراجعة أوراق التصحيح والمستلمات ونتائج التدقيق.",
  "follow-up-calls": "تنظيم اتصالات المتابعة وتسجيل نتائج المكالمات.",
  "follow-up-leaves": "إدارة إجازات الطلاب ومراجعة الفترات المسجلة.",
  "follow-up-pledges": "متابعة التعهدات المرتبطة بحالات الفصل وإعادة التفعيل.",
  accounts: "إدارة المستخدمين والأدوار والصلاحيات وإعدادات الأمان.",
  logs: "مراجعة سجل العمليات والتغييرات المنفذة داخل النظام.",
};
const sectionsWithPageSearch = new Set<SectionId>([
  "missing-students-notes",
  "student-registry",
  "dismissed-students",
  "grade-entry",
  "exam-records",
  "grade-records",
  "opportunities",
  "e-correction",
  "follow-up-calls",
  "follow-up-leaves",
  "follow-up-pledges",
  "logs",
]);
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
  // Legacy hidden section: old persisted links are redirected to logs.
  "admin-log-reset": ["logs", "opportunity-logs"],
};

// These sections own server-side page queries through useTeacherProSyncKey.
// The layout must not refetch the same section as well, otherwise one external
// event creates two overlapping requests and a visible UI refresh.
const PAGE_OWNED_SYNC_SECTIONS = new Set<SectionId>([
  "dashboard",
  "missing-students-notes",
  "courses",
  "chapters",
  "student-registry",
  "student-bulk-import",
  "dismissed-students",
  "exam-new",
  "grade-entry",
  "exam-records",
  "grade-records",
  "opportunities",
  "e-correction",
  "follow-up",
  "follow-up-calls",
  "follow-up-leaves",
  "follow-up-pledges",
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
  // التبويبة أزيلت من الواجهة؛ الروابط القديمة تنتقل للسجلات بأمان.
  if (value === 'admin-log-reset') return 'logs' as SectionId;
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
  // Keep the legacy key type-safe while rendering the safe destination only.
  "admin-log-reset": LogsView,
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
    <div className="app-bg tp-readable-ui min-h-dvh flex items-center justify-center bg-background p-4" dir="rtl">
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

          <form onSubmit={handleSubmit} className="tp-validation-form space-y-4">
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

  const [openFamilies, setOpenFamilies] = useState<Record<string, boolean>>(() => {
    const activeFamily = menuFamilies.find((family) =>
      family.itemIds.includes(currentSection),
    );
    return Object.fromEntries(
      menuFamilies.map((family) => [
        family.title,
        family.title === activeFamily?.title,
      ]),
    );
  });

  useEffect(() => {
    const activeFamily = menuFamilies.find((family) =>
      family.itemIds.includes(currentSection),
    );
    if (!activeFamily) return;
    setOpenFamilies((previous) => {
      if (previous[activeFamily.title]) return previous;
      return { ...previous, [activeFamily.title]: true };
    });
  }, [currentSection]);

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
      return;
    }
    if (currentSection === "admin-log-reset") {
      setSection("logs");
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
  const currentMenuFamily = menuFamilies.find((family) =>
    family.itemIds.includes(currentSection),
  );
  const CurrentMenuIcon = currentMenu?.icon || LayoutDashboard;
  const currentPageDescription =
    sectionDescriptions[currentSection] ||
    "إدارة ذكية وسريعة للطلاب والامتحانات والفرص.";

  if (!authChecked) {
    return (
      <div className="app-bg tp-readable-ui flex min-h-dvh items-center justify-center bg-background p-6" dir="rtl">
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
    <div className="app-bg tp-readable-ui flex h-dvh overflow-hidden bg-background" dir="rtl">
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      <aside
        className={cn(
          "fixed lg:static inset-y-0 right-0 z-50 h-dvh w-[min(19rem,calc(100vw-1rem))] lg:h-auto lg:w-[18rem] bg-sidebar text-sidebar-foreground border-l border-sidebar-border flex flex-col transition-transform duration-300 overflow-hidden shadow-2xl lg:shadow-none",
          sidebarOpen ? "translate-x-0" : "translate-x-full lg:translate-x-0",
        )}
      >
        <div className="absolute inset-0 pointer-events-none sidebar-aura" />

        <div className="relative border-b border-sidebar-border p-3.5">
          <div className="flex items-center gap-3">
            <div className="flex-1">
              <h1
                className="text-xl font-extrabold tracking-tight md:text-2xl"
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
              <p className="text-[11px] leading-5 text-sidebar-foreground/55">
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
          <div className="mt-3 flex items-center gap-2 rounded-xl border border-sidebar-border bg-white/[0.04] px-2.5 py-2">
            <div
              className={`size-2 rounded-full ${dbConnected ? "bg-green-500 shadow-[0_0_18px_rgba(34,197,94,0.5)]" : dbLoading ? "bg-yellow-500 animate-pulse" : "bg-red-500 shadow-[0_0_18px_rgba(239,68,68,0.5)]"}`}
            />
            <p className="truncate text-sm font-semibold text-sidebar-foreground">
              {user?.name || "غير مسجل"}
            </p>
            <Badge
              variant="secondary"
              className="h-5 border-white/10 bg-white/10 px-1.5 text-[10px] text-sidebar-foreground"
            >
              {user?.role || "-"}
            </Badge>
            <div className="flex-1" />
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 shrink-0 text-sidebar-foreground/60 hover:bg-sidebar-accent hover:text-sidebar-foreground"
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
            <div className="mt-2 rounded-xl border border-amber-300/30 bg-amber-500/10 px-2.5 py-1.5 text-[11px] leading-5 text-amber-100">
              أنت تعمل محلياً؛ البيانات قد لا تُحفظ في النظام.
            </div>
          )}
        </div>

        <div
          className="app-scrollbar relative flex-1 overflow-y-auto overscroll-contain py-2.5"
          style={{ WebkitOverflowScrolling: "touch" }}
        >
          <nav className="space-y-2 px-2.5">
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
                      "relative flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-right text-sm transition-all duration-200 group",
                      isActive
                        ? "bg-sidebar-primary text-sidebar-primary-foreground shadow-lg shadow-primary/20"
                        : "text-sidebar-foreground/75 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground hover:translate-x-[-2px]",
                    )}
                  >
                    <span
                      className={cn(
                        "flex size-8 shrink-0 items-center justify-center rounded-lg transition-colors",
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
                    <div className="min-w-0 flex-1 text-right">
                      <div className="truncate font-semibold leading-5">
                        {item.title}
                      </div>
                      <div
                        className={cn(
                          "truncate text-[10px] leading-4",
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
                  className="rounded-2xl border border-sidebar-border/60 bg-white/[0.02] p-1.5"
                >
                  <button
                    type="button"
                    onClick={() => toggleFamily(family.title)}
                    aria-expanded={isFamilyOpen}
                    className={cn(
                      "flex w-full items-center gap-2 rounded-xl px-2.5 py-2 text-right text-sm transition-all duration-200 group",
                      hasActiveItem
                        ? "bg-sidebar-primary/15 text-sidebar-foreground"
                        : "text-sidebar-foreground/75 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                    )}
                  >
                    <span className="flex-1 text-right font-bold">
                      {family.title}
                    </span>
                    <Badge
                      variant="secondary"
                      className="h-5 border-white/10 bg-white/10 px-1.5 text-[10px] text-sidebar-foreground"
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
                    <div className="mr-2 mt-1.5 space-y-1 border-r border-sidebar-border/50 pr-2">
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
                              "relative flex w-full items-center gap-2.5 rounded-xl border border-transparent px-2.5 py-2 text-right text-sm transition-all duration-200 group",
                              isActive
                                ? "border-sidebar-primary/30 bg-sidebar-primary text-sidebar-primary-foreground shadow-md shadow-primary/15"
                                : "text-sidebar-foreground/75 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground hover:translate-x-[-2px]",
                            )}
                          >
                            <span
                              className={cn(
                                "flex size-8 shrink-0 items-center justify-center rounded-lg transition-colors",
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
                            <div className="min-w-0 flex-1 text-right">
                              <div className="truncate font-semibold leading-5">
                                {item.title}
                              </div>
                              <div
                                className={cn(
                                  "truncate text-[10px] leading-4",
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
                    "relative flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-right text-sm transition-all duration-200 group",
                    isActive
                      ? "bg-sidebar-primary text-sidebar-primary-foreground shadow-lg shadow-primary/20"
                      : "text-sidebar-foreground/75 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground hover:translate-x-[-2px]",
                  )}
                >
                  <span
                    className={cn(
                      "flex size-8 shrink-0 items-center justify-center rounded-lg transition-colors",
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
                  <div className="min-w-0 flex-1 text-right">
                    <div className="truncate font-semibold leading-5">
                      {item.title}
                    </div>
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

        <div className="relative shrink-0 border-t border-sidebar-border bg-black/[0.08] p-2.5">
          <Button
            variant="ghost"
            size="sm"
            className="h-9 w-full justify-start rounded-xl text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
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
        <header className="sticky top-0 z-30 border-b border-border/70 bg-background/90 shadow-sm backdrop-blur-xl supports-[backdrop-filter]:bg-background/78">
          <div className="flex min-h-[4.5rem] items-center justify-between gap-3 px-3 py-2.5 md:min-h-[5.5rem] md:px-6 md:py-3">
            <div className="flex min-w-0 flex-1 items-center gap-2.5 md:gap-3.5">
              <Button
                variant="ghost"
                size="icon"
                className="shrink-0 lg:hidden"
                onClick={toggleSidebar}
              >
                <Menu className="h-5 w-5" />
              </Button>

              <div className="hidden size-11 shrink-0 items-center justify-center rounded-2xl border border-primary/15 bg-primary/[0.08] text-primary shadow-sm sm:flex md:size-12">
                <CurrentMenuIcon className="size-5 md:size-[1.375rem]" />
              </div>

              <div className="min-w-0 flex-1 text-right">
                <div className="mb-0.5 hidden items-center gap-1.5 text-[11px] font-semibold text-muted-foreground md:flex">
                  <span>TeacherPro</span>
                  <ChevronLeft className="size-3.5 opacity-45" />
                  {currentMenuFamily ? (
                    <>
                      <span>{currentMenuFamily.title}</span>
                      <ChevronLeft className="size-3.5 opacity-45" />
                    </>
                  ) : null}
                  <span className="truncate text-foreground/75">
                    {currentMenu?.title || "لوحة النظام"}
                  </span>
                </div>

                <div className="flex min-w-0 items-center gap-2">
                  <h2 className="truncate text-base font-black tracking-tight text-gradient-brand md:text-xl">
                    {currentMenu?.title || "لوحة النظام"}
                  </h2>
                  <Badge
                    variant="outline"
                    className="hidden h-6 shrink-0 border-border/80 bg-muted/35 px-2 text-[10px] font-bold text-muted-foreground sm:inline-flex"
                  >
                    {currentMenu?.sub || "نظرة عامة"}
                  </Badge>
                </div>

                <p className="mt-0.5 truncate text-[11px] leading-5 text-muted-foreground sm:text-xs">
                  {currentPageDescription}
                </p>
              </div>
            </div>

            <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
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
                  className="h-9 shrink-0 gap-2 rounded-full px-2.5 sm:px-3"
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
                className="shrink-0 rounded-full"
              >
                {theme === "dark" ? (
                  <Sun className="h-4 w-4" />
                ) : (
                  <Moon className="h-4 w-4" />
                )}
              </Button>
              <Badge
                variant="secondary"
                className="hidden max-w-44 shrink-0 truncate px-3 sm:flex"
              >
                {user?.name || "غير مسجل"}
              </Badge>
            </div>
          </div>
        </header>

        {!dbLoading && !dbConnected && (
          <div className="border-b border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-100 md:px-6">
            أنت تعمل محلياً؛ البيانات قد لا تُحفظ في النظام. تأكد من الاتصال بالنظام قبل الاعتماد على التغييرات.
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
