"use client";

import React, { useEffect, useState } from "react";
import { useTeacherStore } from "@/lib/teacher-store";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  BookOpen,
  Clock,
  Shield,
  Users,
  UserX,
} from "lucide-react";
import { EmptyState, StatCard } from "./ui-kit";
import {
  GRADE_ENTRY_MISSING_NOTES_EVENT,
  readGradeEntryMissingNotes,
} from "@/lib/grade-entry-notes";
export function DashboardView() {
  const {
    students,
    correctionSheets,
    logs,
    setSection,
  } = useTeacherStore();

  const activeCount = students.filter((s) => s.status === "نشط").length;
  const dismissedCount = students.filter((s) => s.status === "مفصول").length;
  const totalStudents = students.length;
  const pendingSheets = correctionSheets.filter(
    (s) => s.status !== "مكتمل",
  ).length;
  const [missingNotesCount, setMissingNotesCount] = useState(0);

  useEffect(() => {
    const updateCount = () => setMissingNotesCount(readGradeEntryMissingNotes().length);
    updateCount();
    window.addEventListener(GRADE_ENTRY_MISSING_NOTES_EVENT, updateCount);
    window.addEventListener("storage", updateCount);
    return () => {
      window.removeEventListener(GRADE_ENTRY_MISSING_NOTES_EVENT, updateCount);
      window.removeEventListener("storage", updateCount);
    };
  }, []);

  const kpiCards = [
    {
      label: "طلاب نشطون",
      value: activeCount,
      icon: Users,
      tone: "success" as const,
      hint: "جاهزون للمتابعة",
    },
    {
      label: "طلاب مفصولون",
      value: dismissedCount,
      icon: Shield,
      tone: "warning" as const,
      hint: "بحاجة لمراجعة",
    },
    {
      label: "إجمالي الطلاب",
      value: totalStudents,
      icon: BookOpen,
      tone: "info" as const,
      hint: "جميع المسجلين",
    },
    {
      label: "أوراق بانتظار التصحيح",
      value: pendingSheets,
      icon: Clock,
      tone: "danger" as const,
      hint: "قيد المعالجة",
    },
  ];

  const recentLogs = logs.slice(0, 6);
  return (
    <div className="section-stack">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {kpiCards.map((card) => (
          <StatCard
            key={card.label}
            label={card.label}
            value={card.value}
            icon={card.icon}
            tone={card.tone}
            hint={card.hint}
          />
        ))}
      </div>

      <Card className="overflow-hidden border-amber-200/70 bg-gradient-to-l from-amber-50 to-background dark:border-amber-900/50 dark:from-amber-950/30 dark:to-background">
        <CardContent className="flex flex-col gap-4 p-5 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-start gap-3">
            <div className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300">
              <UserX className="size-5" />
            </div>
            <div>
              <h3 className="text-lg font-black">الطلاب الغير موجودين</h3>
              <p className="mt-1 text-sm leading-7 text-muted-foreground">
                افتح كل الملاحظات التي يكتبها مدخل الدرجات عن الطلاب غير الموجودين في قوائم الامتحانات.
              </p>
            </div>
          </div>
          <Button type="button" className="shrink-0" onClick={() => setSection("missing-students-notes")}>
            الطلاب الغير موجودين
            {missingNotesCount > 0 && <span className="mr-2 rounded-full bg-white/20 px-2 py-0.5 text-xs">{missingNotesCount}</span>}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <div>
            <CardTitle className="text-base">آخر الفعاليات</CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">
              أحدث عمليات النظام وسجل التغييرات
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
            {recentLogs.length === 0 ? (
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
                      <p className="font-bold text-sm">{log.action}</p>
                      <p className="text-xs text-muted-foreground">
                        {log.user} - {log.module} - {log.time}
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
