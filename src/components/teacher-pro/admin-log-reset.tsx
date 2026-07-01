"use client";

import React, { useMemo, useState } from "react";
import { CalendarDays, CheckSquare, ShieldAlert, Trash2 } from "lucide-react";
import { toast } from "sonner";
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
    description: "الدورات، الفصول، الفرص المرتبطة بالفصول، وإنشاء/تعديل الامتحانات.",
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
  const { clearLogs, currentUser } = useTeacherStore();
  const [password, setPassword] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [selectedScopeIds, setSelectedScopeIds] = useState<string[]>(DEFAULT_SCOPE_IDS);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const user = currentUser();
  const isAdmin = user?.username?.trim().toLowerCase() === "admin" || user?.roleId === "role_admin";

  const selectedScopes = useMemo(
    () => LOG_RESET_SCOPES.filter((scope) => selectedScopeIds.includes(scope.id)),
    [selectedScopeIds],
  );

  const dateRangeLabel = useMemo(() => {
    if (!dateFrom && !dateTo) return "كل المدة";
    return `${dateFrom || "أول سجل"} إلى ${dateTo || "آخر سجل"}`;
  }, [dateFrom, dateTo]);

  const toggleScope = (id: string) => {
    setSelectedScopeIds((current) => {
      if (id === "audit-all") {
        return current.includes(id) ? current.filter((scopeId) => scopeId !== id) : [id, ...current.filter((scopeId) => !scopeId.startsWith("audit-"))];
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
    const result = await clearLogs(password, {
      scopeIds: selectedScopeIds,
      dateFrom,
      dateTo,
    });
    setLoading(false);
    if (result.ok) {
      setPassword("");
      setConfirmOpen(false);
      toast.success(result.message);
    } else {
      toast.error(result.message);
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
            هذا الإجراء يحذف السجلات المختارة فقط ضمن الفترة الزمنية المحددة. إذا تركت الفترة فارغة سيتم التصفير لكل المدة.
            لا يتم التنفيذ إلا بعد إدخال رمز حساب الأدمن الحالي ثم تأكيد العملية.
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
                          <span className={`block text-sm font-black ${scope.danger ? "text-destructive" : "text-foreground"}`}>
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
                    onClick={() => setSelectedScopeIds(LOG_RESET_SCOPES.map((scope) => scope.id))}
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
                    inputMode="numeric"
                    autoComplete="off"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    placeholder="أدخل رمز حساب الأدمن الحالي"
                    className="h-12 rounded-2xl text-center text-lg tracking-[0.35em]"
                    onKeyDown={(event) => {
                      if (event.key === "Enter") requestReset();
                    }}
                  />
                </div>
                <div className="rounded-2xl border bg-muted/25 p-3 text-xs leading-6 text-muted-foreground">
                  المختار: <span className="font-bold text-foreground">{selectedScopes.length}</span> نوع/أنواع<br />
                  الفترة: <span className="font-bold text-foreground">{dateRangeLabel}</span>
                </div>
                <Button
                  type="button"
                  variant="destructive"
                  className="h-12 w-full rounded-2xl text-base font-black"
                  onClick={requestReset}
                  disabled={loading}
                >
                  <Trash2 className="ml-2 h-4 w-4" />
                  تصفير السجلات المحددة
                </Button>
              </CardContent>
            </Card>
          </div>
        </CardContent>
      </Card>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent dir="rtl">
          <AlertDialogHeader>
            <AlertDialogTitle>تأكيد تصفير السجلات المحددة</AlertDialogTitle>
            <AlertDialogDescription className="space-y-3 leading-7">
              <span className="block">
                سيتم حذف السجلات التالية نهائياً ضمن الفترة: <strong>{dateRangeLabel}</strong>.
              </span>
              <span className="block rounded-xl border bg-muted/30 p-3 text-xs">
                {selectedScopes.map((scope) => scope.title).join("، ")}
              </span>
              <span className="block text-destructive">
                لا يمكن التراجع عن هذه العملية بعد التنفيذ.
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
    </div>
  );
}
