"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useTeacherStore, type SectionId } from "@/lib/teacher-store";
import {
  LayoutDashboard,
  BookOpen,
  BookMarked,
  UserPlus,
  ClipboardList,
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
  { title: "الطلاب", itemIds: ["student-register", "student-registry", "dismissed-students"] },
  {
    title: "الامتحانات والدرجات",
    itemIds: ["exam-new", "grade-entry", "exam-records", "grade-records"],
  },
  { title: "المتابعة", itemIds: ["follow-up-calls", "follow-up-leaves", "follow-up-pledges"] },
  { title: "الإدارة", itemIds: ["accounts", "logs"] },
];

const familyItemIds = new Set<SectionId>(
  menuFamilies.flatMap((family) => family.itemIds),
);
const sectionIds = new Set<SectionId>(menuItems.map((item) => item.id));

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
import { StudentRegistryView } from "./student-registry";
import { DismissedStudentsView } from "./dismissed-students";
import { ExamNewView } from "./exam-new";
import { GradeEntryView } from "./grade-entry";
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
  "student-registry": StudentRegistryView,
  "dismissed-students": DismissedStudentsView,
  "exam-new": ExamNewView,
  "grade-entry": GradeEntryView,
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
};


type LoginScreenProps = {
  theme: string;
  toggleTheme: () => void;
  login: (username: string, password: string) => Promise<{ ok: boolean; message: string }>;
};

function LoginScreen({ theme, toggleTheme, login }: LoginScreenProps) {
  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("1993");
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
    <div className="app-bg min-h-screen flex items-center justify-center bg-background p-4" dir="rtl">
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
                placeholder="admin"
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
                placeholder="1993"
                className="h-12 rounded-2xl"
              />
            </div>
            <Button type="submit" className="h-12 w-full rounded-2xl text-base font-bold" disabled={loading}>
              <KeyRound className="ml-2 h-4 w-4" />
              {loading ? "جاري الدخول..." : "دخول للنظام"}
            </Button>
          </form>

          <div className="rounded-2xl border border-primary/20 bg-primary/5 p-3 text-xs leading-6 text-muted-foreground">
            الحساب الافتراضي: <b>admin</b> — الرمز: <b>1993</b>. يمكن لاحقاً إدارة الحسابات والصلاحيات من داخل النظام.
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
    restoreSession,
  } = useTeacherStore();

  const [openFamilies, setOpenFamilies] = useState<Record<string, boolean>>(() => {
    // Open all families by default
    const initial: Record<string, boolean> = {};
    menuFamilies.forEach((family) => {
      initial[family.title] = true;
    });
    return initial;
  });

  const toggleFamily = (title: string) => {
    setOpenFamilies((prev) => ({ ...prev, [title]: !prev[title] }));
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
    setSection(section);
    if (typeof window !== "undefined") {
      const nextUrl = new URL(window.location.href);
      nextUrl.searchParams.set("section", section);
      nextUrl.hash = "";
      window.history.pushState({}, "", nextUrl.toString());
      if (window.innerWidth < 1024) setSidebarOpen(false);
    }
  };

  useEffect(() => {
    const urlSection = readSectionFromLocation();
    if (urlSection && urlSection !== currentSection) return;
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
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ message?: string }>).detail;
      toast.error(detail?.message || "تعذر حفظ التغيير في الخادم وتم التراجع محلياً");
    };
    window.addEventListener("teacherpro:server-sync-error", handler);
    return () => window.removeEventListener("teacherpro:server-sync-error", handler);
  }, []);

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
      <div className="app-bg flex min-h-screen items-center justify-center bg-background p-6" dir="rtl">
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
    <div className="app-bg flex h-screen min-h-screen overflow-hidden bg-background" dir="rtl">
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      <aside
        className={cn(
          "fixed lg:static inset-y-0 right-0 z-50 w-[19rem] h-screen lg:h-auto bg-sidebar text-sidebar-foreground border-l border-sidebar-border flex flex-col transition-transform duration-300 overflow-hidden shadow-2xl lg:shadow-none",
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

      <main className="flex h-screen min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <header className="sticky top-0 z-30 border-b border-border/70 bg-background/75 backdrop-blur-xl supports-[backdrop-filter]:bg-background/65">
          <div className="flex items-center justify-between gap-3 px-4 py-3 md:px-6">
            <div className="flex items-center gap-3">
              <Button
                variant="ghost"
                size="icon"
                className="lg:hidden"
                onClick={toggleSidebar}
              >
                <Menu className="w-5 h-5" />
              </Button>
              <div>
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="hidden sm:inline-flex">
                    {currentMenu?.sub || "نظرة عامة"}
                  </Badge>
                  <h2 className="font-black text-lg md:text-xl tracking-tight text-gradient-brand">
                    {currentMenu?.title || "لوحة النظام"}
                  </h2>
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  إدارة ذكية وسريعة للطلاب والامتحانات والفرص
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <Button
                variant="outline"
                size="icon"
                onClick={toggleTheme}
                className="rounded-full"
              >
                {theme === "dark" ? (
                  <Sun className="w-4 h-4" />
                ) : (
                  <Moon className="w-4 h-4" />
                )}
              </Button>
              <Badge variant="secondary" className="hidden sm:flex">
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

        <div className="app-scrollbar page-enter flex-1 overflow-y-auto overscroll-contain p-4 md:p-6 xl:p-8">
          <div className="content-container space-y-6">
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
