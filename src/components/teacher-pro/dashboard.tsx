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
  Database,
  RefreshCw,
  Shield,
  Users,
  UserX,
} from "lucide-react";
import { EmptyState, StatCard } from "./ui-kit";
import {
  useTeacherProBackgroundSyncDetector,
  useTeacherProSyncKey,
} from "@/hooks/use-teacherpro-sync";
import { useLatestRequest } from "@/hooks/use-latest-request";

type DashboardAlert = {
  id: string;
  title: string;
  description: string;
  count: number;
  tone: "danger" | "warning" | "info" | "success";
  actionSection: SectionId;
  actionLabel: string;
  sample?: string[];
};

type DashboardStats = {
  activeStudents: number;
  dismissedStudents: number;
  totalStudents: number;
  pendingCorrectionSheets: number;
  missingStudentsNotes: number;
  alerts: DashboardAlert[];
  recentLogs: Array<{
    id: string;
    module: string;
    action: string;
    details?: string | null;
    user?: string | null;
    userName?: string | null;
    time: string;
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

function formatStatsTime(value?: string) {
  if (!value) return "—";
  try {
    return new Intl.DateTimeFormat("ar-IQ", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: "Asia/Baghdad",
    }).format(new Date(value));
  } catch {
    return value;
  }
}

export function DashboardView() {
  const { setSection } = useTeacherStore();
  const syncKey = useTeacherProSyncKey(["dashboard", "students", "grades", "opportunities", "exams", "correction"]);
  const isBackgroundSync = useTeacherProBackgroundSyncDetector(syncKey);
  const beginStatsRequest = useLatestRequest();
  const statsLoadedRef = useRef(false);

  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [statsLoading, setStatsLoading] = useState(true);
  const [statsError, setStatsError] = useState("");

  const loadStats = useCallback(
    async (options: { background?: boolean } = {}) => {
      const request = beginStatsRequest();
      const background = Boolean(options.background || statsLoadedRef.current);
      if (!background) setStatsLoading(true);
      setStatsError("");
      try {
        const res = await fetch("/api/stats", {
          credentials: "same-origin",
          cache: "no-store",
          signal: request.signal,
        });
        const data = await res.json().catch(() => null);
        if (!res.ok) {
          throw new Error(data?.error || "تعذر تحميل الإحصائيات من قاعدة البيانات.");
        }
        if (!request.isLatest()) return;
        setStats(data as DashboardStats);
        statsLoadedRef.current = true;
      } catch (error) {
        if (!request.isLatest()) return;
        setStatsError(
          error instanceof Error
            ? error.message
            : "تعذر تحميل الإحصائيات من قاعدة البيانات.",
        );
        if (!background) setStats(null);
      } finally {
        if (request.isLatest()) setStatsLoading(false);
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
      hint: "عدّ مباشر من قاعدة البيانات",
    },
    {
      label: "طلاب مفصولون",
      value: stats?.dismissedStudents,
      icon: Shield,
      tone: "warning" as const,
      hint: "عدّ مباشر من قاعدة البيانات",
    },
    {
      label: "إجمالي الطلاب",
      value: stats?.totalStudents,
      icon: BookOpen,
      tone: "info" as const,
      hint: "كل الطلاب المسجلين في قاعدة البيانات",
    },
    {
      label: "أوراق بانتظار التصحيح",
      value: stats?.pendingCorrectionSheets,
      icon: Clock,
      tone: "danger" as const,
      hint: "كل الأوراق غير المكتملة في قاعدة البيانات",
    },
  ];

  const recentLogs = stats?.recentLogs ?? [];
  const alerts = stats?.alerts ?? [];

  return (
    <div className="section-stack">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {kpiCards.map((card) => (
          <StatCard
            key={card.label}
            label={card.label}
            value={statsLoading ? "…" : card.value ?? "—"}
            icon={card.icon}
            tone={card.tone}
            hint={card.hint}
          />
        ))}
      </div>

      <Card className="border-primary/20 bg-primary/5">
        <CardContent className="flex flex-col gap-3 p-4 md:flex-row md:items-center md:justify-between">
          <div className="flex items-start gap-3">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-2xl border border-primary/20 bg-background text-primary">
              <Database className="size-5" />
            </div>
            <div>
              <p className="font-black">مصدر أرقام اللوحة: قاعدة البيانات مباشرة</p>
              <p className="mt-1 text-xs leading-6 text-muted-foreground">
                لا يتم حساب كروت الرئيسية من كاش الطلاب أو الصفحات المحملة جزئياً. آخر تحديث: {statsLoading ? "جاري التحميل" : formatStatsTime(stats?.generatedAt)}
              </p>
              {statsError && <p className="mt-1 text-xs font-bold text-destructive">{statsError}</p>}
            </div>
          </div>
          <Button type="button" variant="outline" size="sm" onClick={() => void loadStats({ background: true })} disabled={statsLoading}>
            <RefreshCw className={cn("ml-2 size-4", statsLoading && "animate-spin")} />
            تحديث من قاعدة البيانات
          </Button>
        </CardContent>
      </Card>

      <Card className="overflow-hidden">
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <AlertTriangle className="size-5 text-amber-500" />
              تنبيهات إدارية
            </CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">
              مشاكل محسوبة من قاعدة البيانات مباشرة حتى لا تختفي بسبب كاش أو فلتر جزئي.
            </p>
          </div>
          <span className="rounded-full bg-muted px-3 py-1 text-xs font-bold text-muted-foreground">
            {statsLoading ? "…" : alerts.length}
          </span>
        </CardHeader>
        <CardContent>
          {statsLoading ? (
            <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
              {Array.from({ length: 4 }).map((_, index) => (
                <div key={index} className="h-28 animate-pulse rounded-3xl border bg-muted/40" />
              ))}
            </div>
          ) : statsError ? (
            <EmptyState
              icon={AlertTriangle}
              title="تعذر عرض التنبيهات"
              description="التنبيهات لا تُحسب من بيانات محلية ناقصة. أعد المحاولة بعد التأكد من اتصال قاعدة البيانات."
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
              description="لم ترجع قاعدة البيانات أي امتحانات ناقصة الدرجات، طلاب بلا فصل نشط، إجازات اليوم، فرص صفر، أو تعهدات معلقة."
            />
          ) : (
            <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
              {alerts.map((alert) => (
                <div key={alert.id} className={cn("rounded-3xl border p-4", alertToneClass[alert.tone])}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-black">{alert.title}</p>
                      <p className="mt-1 text-xs leading-6 opacity-80">{alert.description}</p>
                      {alert.sample && alert.sample.length > 0 && (
                        <p className="mt-2 text-xs font-bold opacity-80">
                          أمثلة: {alert.sample.join("، ")}
                        </p>
                      )}
                    </div>
                    <span className={cn("shrink-0 rounded-full px-3 py-1 text-sm font-black", alertBadgeClass[alert.tone])}>
                      {alert.count}
                    </span>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="mt-3 bg-background/70"
                    onClick={() => setSection(alert.actionSection)}
                  >
                    {alert.actionLabel}
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="overflow-hidden border-amber-200/70 bg-gradient-to-l from-amber-50 to-background dark:border-amber-900/50 dark:from-amber-950/30 dark:to-background">
        <CardContent className="flex flex-col gap-4 p-5 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-start gap-3">
            <div className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300">
              <UserX className="size-5" />
            </div>
            <div>
              <h3 className="text-lg font-black">الطلاب الغير موجودين</h3>
              <p className="mt-1 text-sm leading-7 text-muted-foreground">
                افتح كل الملاحظات التي يكتبها مدخل الدرجات عن الطلاب غير الموجودين في قوائم الامتحانات. العدد هنا من قاعدة البيانات مباشرة.
              </p>
            </div>
          </div>
          <Button type="button" className="shrink-0" onClick={() => setSection("missing-students-notes")}>
            الطلاب الغير موجودين
            {(stats?.missingStudentsNotes ?? 0) > 0 && (
              <span className="mr-2 rounded-full bg-white/20 px-2 py-0.5 text-xs">
                {stats?.missingStudentsNotes}
              </span>
            )}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <div>
            <CardTitle className="text-base">آخر الفعاليات</CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">
              أحدث عمليات النظام من قاعدة البيانات مباشرة
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setSection("logs")}
          >
            عرض السجلات
          </Button>
        </CardHeader>
        <CardContent>
          <div className="max-h-80 space-y-3 overflow-y-auto pr-1">
            {statsLoading ? (
              Array.from({ length: 3 }).map((_, index) => (
                <div key={index} className="h-20 animate-pulse rounded-3xl border bg-muted/40" />
              ))
            ) : recentLogs.length === 0 ? (
              <EmptyState
                title="لا توجد فعاليات بعد"
                description="سيظهر سجل العمليات هنا بمجرد إضافة أو تعديل البيانات."
              />
            ) : (
              recentLogs.map((log) => (
                <div
                  key={log.id}
                  className="list-row border-r-4 border-r-primary/40"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-bold">{log.action}</p>
                      <p className="text-xs text-muted-foreground">
                        {log.userName || log.user || "—"} - {log.module} - {formatStatsTime(log.time)}
                      </p>
                    </div>
                    <span className="chip">نشاط</span>
                  </div>
                  {log.details && (
                    <p className="mt-2 text-xs leading-6 text-muted-foreground">
                      {log.details}
                    </p>
                  )}
                </div>
              ))
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
