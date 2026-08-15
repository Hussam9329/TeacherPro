"use client";

import React, { useMemo, useState } from "react";
import {
  CalendarDays,
  CheckSquare,
  DatabaseBackup,
  Download,
  RotateCcw,
  ShieldAlert,
  Trash2,
  Upload,
} from "lucide-react";
import { toast } from "@/lib/user-toast";
import { useTeacherStore } from "@/lib/teacher-store";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

const LOG_RESET_SCOPES = [
  {
    id: "audit-all",
    title: "تصفير كل الإجراءات",
    description: "يمسح كل سجلات Audit Log ضمن الفترة المحددة.",
    danger: true,
  },
  {
    id: "audit-grades",
    title: "تصفير إجراءات الدرجات",
    description: "إدخال/تعديل/حذف الدرجات والعمليات المرتبطة بها.",
    danger: false,
  },
  {
    id: "audit-students",
    title: "تصفير إجراءات الطلاب",
    description: "تسجيل الطلاب، تعديل سجل الطلاب، الفصل وإعادة التفعيل.",
    danger: false,
  },
  {
    id: "audit-exams",
    title: "تصفير إجراءات صناعة الامتحان",
    description:
      "الدورات، الفصول، الفرص المرتبطة بالفصول، وإنشاء/تعديل الامتحانات.",
    danger: false,
  },
  {
    id: "audit-followup",
    title: "تصفير إجراءات المتابعة",
    description: "المكالمات، الإجازات، التعهدات والملاحظات التابعة للمتابعة.",
    danger: false,
  },
  {
    id: "audit-correction",
    title: "تصفير إجراءات التصحيح الإلكتروني",
    description: "إضافة وتعديل وحذف أوراق التصحيح وحالات التصحيح.",
    danger: false,
  },
  {
    id: "audit-accounts",
    title: "تصفير إجراءات الحسابات والأمان",
    description: "الحسابات، الأدوار، الصلاحيات، ومحاولات الدخول.",
    danger: true,
  },
  {
    id: "audit-permissions",
    title: "تصفير تغييرات الصلاحيات فقط",
    description: "الأدوار، صلاحيات المستخدمين، وتغييرات التفويض.",
    danger: true,
  },
  {
    id: "audit-log-reset",
    title: "تصفير سجلات تصفير الـ log",
    description: "سجلات عمليات التصفير والاستعادة نفسها. استخدمها بحذر شديد.",
    danger: true,
  },
  {
    id: "audit-exports",
    title: "تصفير إجراءات التصدير والنسخ الاحتياطي",
    description: "سجلات التصدير والاستيراد والنسخ الاحتياطي.",
    danger: false,
  },
  {
    id: "opportunity-logs",
    title: "تصفير سجل حركات الفرص",
    description: "يمسح جدول OpportunityLog فقط ضمن الفترة المحددة.",
    danger: true,
  },
] as const;

const DEFAULT_SCOPE_IDS = ["audit-grades", "audit-students", "audit-exams"];

export function AdminLogResetView() {
  const { clearLogs, restoreLastLogClear, currentUser } = useTeacherStore();
  const [password, setPassword] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [restoreConfirmOpen, setRestoreConfirmOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [restoreLoading, setRestoreLoading] = useState(false);
  const [backupLoading, setBackupLoading] = useState(false);
  const [fullRestoreLoading, setFullRestoreLoading] = useState(false);
  const [fullRestoreOpen, setFullRestoreOpen] = useState(false);
  const [backupFile, setBackupFile] = useState<File | null>(null);
  const [backupPayload, setBackupPayload] = useState<Record<
    string,
    unknown
  > | null>(null);
  const [restorePreviewCounts, setRestorePreviewCounts] = useState<
    Record<string, number>
  >({});
  const [selectedScopeIds, setSelectedScopeIds] =
    useState<string[]>(DEFAULT_SCOPE_IDS);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const user = currentUser();
  const isAdmin =
    user?.username?.trim().toLowerCase() === "admin" ||
    user?.roleId === "role_admin";

  const selectedScopes = useMemo(
    () =>
      LOG_RESET_SCOPES.filter((scope) => selectedScopeIds.includes(scope.id)),
    [selectedScopeIds],
  );

  const dateRangeLabel = useMemo(() => {
    if (!dateFrom && !dateTo) return "كل المدة";
    return `${dateFrom || "أول سجل"} إلى ${dateTo || "آخر سجل"}`;
  }, [dateFrom, dateTo]);

  const toggleScope = (id: string) => {
    setSelectedScopeIds((current) => {
      if (id === "audit-all") {
        return current.includes(id)
          ? current.filter((scopeId) => scopeId !== id)
          : [id, ...current.filter((scopeId) => !scopeId.startsWith("audit-"))];
      }
      const withoutAll = current.filter((scopeId) => scopeId !== "audit-all");
      return withoutAll.includes(id)
        ? withoutAll.filter((scopeId) => scopeId !== id)
        : [...withoutAll, id];
    });
  };

  const requestReset = () => {
    if (!password.trim()) {
      toast.error("أدخل رمز حساب الأدمن أولاً");
      return;
    }
    if (selectedScopeIds.length === 0) {
      toast.error("اختر نوع السجلات التي تريد تصفيرها");
      return;
    }
    if (dateFrom && dateTo && dateFrom > dateTo) {
      toast.error("تاريخ البداية يجب أن يكون قبل أو يساوي تاريخ النهاية");
      return;
    }
    setConfirmOpen(true);
  };

  const handleReset = async () => {
    setLoading(true);
    const includesOpportunityLogs =
      selectedScopeIds.includes("opportunity-logs");
    const result = await clearLogs(password, {
      scopeIds: selectedScopeIds,
      dateFrom,
      dateTo,
      ...(includesOpportunityLogs
        ? {
            confirmImpact: true,
            confirmText: "حذف سجل الفرص وإعادة الاحتساب",
          }
        : {}),
    });
    setLoading(false);
    if (result.ok) {
      setConfirmOpen(false);
      toast.success(result.message);
    } else {
      toast.error(result.message);
    }
  };

  const requestRestore = () => {
    if (!password.trim()) {
      toast.error("أدخل رمز حساب الأدمن أولاً");
      return;
    }
    setRestoreConfirmOpen(true);
  };

  const handleRestore = async () => {
    setRestoreLoading(true);
    const result = await restoreLastLogClear(password);
    setRestoreLoading(false);
    if (result.ok) {
      setPassword("");
      setRestoreConfirmOpen(false);
      toast.success(result.message);
    } else {
      toast.error(result.message);
    }
  };

  const exportFullBackup = async () => {
    setBackupLoading(true);
    try {
      const response = await fetch("/api/backup", {
        credentials: "same-origin",
      });
      const payload = await response.json();
      if (!response.ok)
        throw new Error(payload?.error || "تعذر إنشاء النسخة الاحتياطية");
      const blob = new Blob([JSON.stringify(payload, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `teacherpro-full-backup-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      toast.success("تم إنشاء نسخة كاملة لكل جداول النظام");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "تعذر إنشاء النسخة الاحتياطية",
      );
    } finally {
      setBackupLoading(false);
    }
  };

  const previewFullRestore = async () => {
    if (!password.trim()) {
      toast.error("أدخل كلمة مرور المدير أولاً");
      return;
    }
    if (!backupFile) {
      toast.error("اختر ملف النسخة الاحتياطية JSON");
      return;
    }
    setFullRestoreLoading(true);
    try {
      const parsed = JSON.parse(await backupFile.text()) as Record<
        string,
        unknown
      >;
      const response = await fetch("/api/backup/restore", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ password, backup: parsed, dryRun: true }),
      });
      const payload = await response.json();
      if (!response.ok)
        throw new Error(payload?.error || "تعذر معاينة الاستعادة");
      setBackupPayload(parsed);
      setRestorePreviewCounts(
        (payload?.counts || {}) as Record<string, number>,
      );
      setFullRestoreOpen(true);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "ملف النسخة غير صالح",
      );
    } finally {
      setFullRestoreLoading(false);
    }
  };

  const executeFullRestore = async () => {
    if (!backupPayload) return;
    setFullRestoreLoading(true);
    try {
      const response = await fetch("/api/backup/restore", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          password,
          backup: backupPayload,
          confirmImpact: true,
          confirmText: "استعادة النظام بالكامل",
        }),
      });
      const payload = await response.json();
      if (!response.ok)
        throw new Error(payload?.error || "تعذر استعادة النسخة");
      setFullRestoreOpen(false);
      toast.success(payload?.message || "تمت استعادة النظام بالكامل");
      window.setTimeout(() => window.location.reload(), 800);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "تعذر استعادة النسخة",
      );
    } finally {
      setFullRestoreLoading(false);
    }
  };

  if (!isAdmin) {
    return (
      <Card className="border-destructive/30 bg-destructive/5">
        <CardContent className="p-6 text-center text-sm font-semibold text-destructive">
          هذه التبويبة خاصة بمدير النظام فقط.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <Card className="border-destructive/25 bg-destructive/5">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-destructive">
            <ShieldAlert className="h-5 w-5" />
            تصفير سجلات النظام حسب النوع والفترة
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="rounded-2xl border border-destructive/20 bg-background/70 p-4 text-sm leading-7 text-muted-foreground">
            هذا الإجراء يحذف السجلات المختارة فقط ضمن الفترة الزمنية المحددة.
            إذا تركت الفترة فارغة سيتم التصفير لكل المدة. لا يتم التنفيذ إلا بعد
            إدخال رمز حساب الأدمن الحالي ثم تأكيد العملية. قبل أي تصفير يتم حفظ
            نسخة احتياطية يمكن استعادة آخر عملية تصفير منها.
          </div>

          <div className="grid gap-4 lg:grid-cols-[1.25fr_0.75fr]">
            <Card className="border-border/70 bg-background/80">
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  <CheckSquare className="h-4 w-4" />
                  اختر نوع الإجراءات المراد تصفيرها
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="grid gap-2 sm:grid-cols-2">
                  {LOG_RESET_SCOPES.map((scope) => {
                    const checked = selectedScopeIds.includes(scope.id);
                    return (
                      <label
                        key={scope.id}
                        htmlFor={`log-reset-${scope.id}`}
                        className={`flex min-h-[92px] cursor-pointer items-start gap-3 rounded-2xl border p-3 transition-colors ${
                          checked
                            ? "border-primary/60 bg-primary/5"
                            : "border-border bg-background hover:bg-muted/30"
                        }`}
                      >
                        <Checkbox
                          id={`log-reset-${scope.id}`}
                          checked={checked}
                          onCheckedChange={() => toggleScope(scope.id)}
                          className="mt-1"
                        />
                        <span className="space-y-1">
                          <span
                            className={`block text-sm font-black ${scope.danger ? "text-destructive" : "text-foreground"}`}
                          >
                            {scope.title}
                          </span>
                          <span className="block text-xs leading-5 text-muted-foreground">
                            {scope.description}
                          </span>
                        </span>
                      </label>
                    );
                  })}
                </div>
                <div className="flex flex-wrap gap-2 pt-1">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="rounded-xl"
                    onClick={() =>
                      setSelectedScopeIds(
                        LOG_RESET_SCOPES.map((scope) => scope.id),
                      )
                    }
                  >
                    تحديد الكل
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="rounded-xl"
                    onClick={() => setSelectedScopeIds(DEFAULT_SCOPE_IDS)}
                  >
                    الافتراضي
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="rounded-xl"
                    onClick={() => setSelectedScopeIds([])}
                  >
                    مسح الاختيار
                  </Button>
                </div>
              </CardContent>
            </Card>

            <Card className="border-border/70 bg-background/80">
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  <CalendarDays className="h-4 w-4" />
                  الفترة والتأكيد
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
                  <div className="space-y-2">
                    <Label htmlFor="log-reset-date-from">من تاريخ</Label>
                    <Input
                      id="log-reset-date-from"
                      type="date"
                      value={dateFrom}
                      onChange={(event) => setDateFrom(event.target.value)}
                      className="h-11 rounded-2xl"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="log-reset-date-to">إلى تاريخ</Label>
                    <Input
                      id="log-reset-date-to"
                      type="date"
                      value={dateTo}
                      onChange={(event) => setDateTo(event.target.value)}
                      className="h-11 rounded-2xl"
                    />
                  </div>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-9 rounded-xl px-3"
                  onClick={() => {
                    setDateFrom("");
                    setDateTo("");
                  }}
                >
                  كل المدة
                </Button>
                <Separator />
                <div className="space-y-2">
                  <Label htmlFor="log-reset-password">رمز حساب الأدمن</Label>
                  <Input
                    id="log-reset-password"
                    type="password"
                    autoComplete="off"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    placeholder="أدخل رمز حساب الأدمن الحالي"
                    className="h-12 rounded-2xl text-center text-lg"
                    onKeyDown={(event) => {
                      if (event.key === "Enter") requestReset();
                    }}
                  />
                </div>
                <div className="rounded-2xl border bg-muted/25 p-3 text-xs leading-6 text-muted-foreground">
                  المختار:{" "}
                  <span className="font-bold text-foreground">
                    {selectedScopes.length}
                  </span>{" "}
                  نوع/أنواع
                  <br />
                  الفترة:{" "}
                  <span className="font-bold text-foreground">
                    {dateRangeLabel}
                  </span>
                </div>
                <div className="space-y-2">
                  <Button
                    type="button"
                    variant="destructive"
                    className="h-12 w-full rounded-2xl text-base font-black"
                    onClick={requestReset}
                    disabled={loading || restoreLoading}
                  >
                    <Trash2 className="ml-2 h-4 w-4" />
                    تصفير السجلات المحددة
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    className="h-11 w-full rounded-2xl border-emerald-500/40 text-emerald-700 hover:bg-emerald-50 dark:text-emerald-300 dark:hover:bg-emerald-950/30"
                    onClick={requestRestore}
                    disabled={loading || restoreLoading}
                  >
                    <RotateCcw className="ml-2 h-4 w-4" />
                    استعادة آخر تصفير
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        </CardContent>
      </Card>

      <Card className="border-primary/25 bg-primary/5">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <DatabaseBackup className="h-5 w-5" />
            النسخة الاحتياطية الكاملة والاستعادة
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm leading-7 text-muted-foreground">
            التصدير يشمل كل جداول النظام دون حدود عددية. الاستعادة تستبدل بيانات
            النظام الحالية كاملة بعد فحص الملف ومعاينة عدد السجلات، ولا تحفظ
            نتيجة جزئية عند الفشل.
          </p>
          <div className="grid gap-3 md:grid-cols-2">
            <Button
              type="button"
              variant="outline"
              className="h-12 rounded-2xl"
              onClick={() => void exportFullBackup()}
              disabled={backupLoading || fullRestoreLoading}
            >
              <Download className="ml-2 h-4 w-4" />
              {backupLoading ? "جاري إنشاء النسخة..." : "تنزيل نسخة كاملة"}
            </Button>
            <div className="flex gap-2">
              <Input
                type="file"
                accept="application/json,.json"
                className="h-12 rounded-2xl"
                onChange={(event) =>
                  setBackupFile(event.target.files?.[0] || null)
                }
              />
              <Button
                type="button"
                className="h-12 rounded-2xl"
                onClick={() => void previewFullRestore()}
                disabled={fullRestoreLoading || !backupFile}
              >
                <Upload className="ml-2 h-4 w-4" />
                معاينة
              </Button>
            </div>
          </div>
          <p className="text-xs text-destructive">
            الاستعادة الكاملة تحتاج كلمة مرور المدير المكتوبة أعلاه، وتستبدل
            جميع البيانات الحالية.
          </p>
        </CardContent>
      </Card>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent dir="rtl">
          <AlertDialogHeader>
            <AlertDialogTitle>تأكيد تصفير السجلات المحددة</AlertDialogTitle>
            <AlertDialogDescription className="space-y-3 leading-7">
              <span className="block">
                سيتم حذف السجلات التالية نهائياً ضمن الفترة:{" "}
                <strong>{dateRangeLabel}</strong>.
              </span>
              <span className="block rounded-xl border bg-muted/30 p-3 text-xs">
                {selectedScopes.map((scope) => scope.title).join("، ")}
              </span>
              <span className="block text-destructive">
                سيتم حفظ نسخة احتياطية قبل الحذف، ويمكن استعادة آخر عملية تصفير
                من زر الاستعادة.
              </span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={loading}>إلغاء</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={(event) => {
                event.preventDefault();
                void handleReset();
              }}
              disabled={loading}
            >
              {loading ? "جاري التصفير..." : "نعم، صفّر المحدد"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={restoreConfirmOpen}
        onOpenChange={setRestoreConfirmOpen}
      >
        <AlertDialogContent dir="rtl">
          <AlertDialogHeader>
            <AlertDialogTitle>استعادة آخر عملية تصفير</AlertDialogTitle>
            <AlertDialogDescription className="space-y-3 leading-7">
              <span className="block">
                سيتم إرجاع آخر سجلات تم حذفها من صفحة تصفير الـ LOG إذا كانت لها
                نسخة احتياطية غير مستعادة.
              </span>
              <span className="block rounded-xl border bg-muted/30 p-3 text-xs">
                الاستعادة تعمل على آخر عملية تصفير فقط، ولا تستبدل السجلات
                الموجودة حالياً. السجلات المكررة يتم تجاهلها تلقائياً.
              </span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={restoreLoading}>
              إلغاء
            </AlertDialogCancel>
            <AlertDialogAction
              className="bg-emerald-600 text-white hover:bg-emerald-700"
              onClick={(event) => {
                event.preventDefault();
                void handleRestore();
              }}
              disabled={restoreLoading}
            >
              {restoreLoading ? "جاري الاستعادة..." : "نعم، استعد آخر تصفير"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={fullRestoreOpen} onOpenChange={setFullRestoreOpen}>
        <AlertDialogContent dir="rtl">
          <AlertDialogHeader>
            <AlertDialogTitle>استعادة النظام بالكامل</AlertDialogTitle>
            <AlertDialogDescription className="space-y-3 leading-7">
              <span className="block">
                نجحت معاينة الملف والتحقق من سلامته. سيجري استبدال كل بيانات
                النظام الحالية ضمن معاملة واحدة.
              </span>
              <span className="block rounded-xl border bg-muted/30 p-3 text-xs">
                إجمالي السجلات في الملف:{" "}
                <strong>
                  {Object.values(restorePreviewCounts).reduce(
                    (sum, value) => sum + Number(value || 0),
                    0,
                  )}
                </strong>{" "}
                — الجداول:{" "}
                <strong>{Object.keys(restorePreviewCounts).length}</strong>
              </span>
              <span className="block font-bold text-destructive">
                خذ نسخة حالية قبل المتابعة. لا يمكن دمج الملف مع البيانات
                الحالية.
              </span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={fullRestoreLoading}>
              إلغاء
            </AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={(event) => {
                event.preventDefault();
                void executeFullRestore();
              }}
              disabled={fullRestoreLoading}
            >
              {fullRestoreLoading
                ? "جاري الاستعادة..."
                : "استعادة النظام بالكامل"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
