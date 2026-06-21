"use client";

import React, { useMemo, useState } from "react";
import { useTeacherStore } from "@/lib/teacher-store";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  BarChart3,
  BookOpen,
  CheckCircle2,
  Clock,
  Shield,
  TrendingDown,
  Users,
  XCircle,
} from "lucide-react";
import { EmptyState, StatCard } from "./ui-kit";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type GradeDashboardStatus =
  | "all"
  | "success"
  | "failed-without-discount"
  | "failed-with-discount"
  | "discount-only";

const gradeDashboardStatusLabels: Record<GradeDashboardStatus, string> = {
  all: "كل حالات الدرجات",
  success: "نجاح",
  "failed-without-discount": "رسوب عدا الخصم",
  "failed-with-discount": "رسوب مع الخصم",
  "discount-only": "خصم فقط",
};

const gradeDashboardStatuses = Object.keys(
  gradeDashboardStatusLabels,
) as GradeDashboardStatus[];

function gradeDashboardStatus(
  grade: { status: string; score: number | null },
  exam: {
    fullMark: number;
    passMark: number;
    discountMark: number;
    noDiscount?: boolean;
  },
): Exclude<GradeDashboardStatus, "all"> | "other" {
  if (grade.status === "غائب" || grade.status === "غش") return "discount-only";
  if (
    grade.status !== "درجة" ||
    grade.score === null ||
    grade.score === undefined
  )
    return "other";

  const score = Number(grade.score);
  if (!Number.isFinite(score)) return "other";
  if (score >= Number(exam.passMark || 0)) return "success";

  const discountMark = Number(exam.discountMark || 0);
  if (!exam.noDiscount && score <= discountMark) return "failed-with-discount";
  return "failed-without-discount";
}

export function DashboardView() {
  const {
    students,
    correctionSheets,
    logs,
    setSection,
    grades,
    exams,
    classification,
  } = useTeacherStore();
  const [gradeExamFilter, setGradeExamFilter] = useState("all");
  const [gradeStatusFilter, setGradeStatusFilter] =
    useState<GradeDashboardStatus>("all");

  const activeCount = students.filter((s) => s.status === "نشط").length;
  const dismissedCount = students.filter((s) => s.status === "مفصول").length;
  const totalStudents = students.length;
  const pendingSheets = correctionSheets.filter(
    (s) => s.status !== "مكتمل",
  ).length;

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

  const gradeDashboard = useMemo(() => {
    const examsById = new Map(exams.map((exam) => [exam.id, exam]));
    const studentsById = new Map(
      students.map((student) => [student.id, student]),
    );

    const rows = grades
      .map((grade) => {
        const exam = examsById.get(grade.examId);
        const student = studentsById.get(grade.studentId);
        if (!exam || !student) return null;
        if (
          grade.status === "درجة" &&
          (grade.score === null || grade.score === undefined)
        )
          return null;
        const status = gradeDashboardStatus(grade, exam);
        if (status === "other") return null;
        const cls = classification(grade, exam, student);
        return { grade, exam, student, status, classificationText: cls.text };
      })
      .filter(Boolean) as Array<{
      grade: (typeof grades)[number];
      exam: (typeof exams)[number];
      student: (typeof students)[number];
      status: Exclude<GradeDashboardStatus, "all">;
      classificationText: string;
    }>;

    const filteredRows = rows.filter((row) => {
      if (gradeExamFilter !== "all" && row.exam.id !== gradeExamFilter)
        return false;
      if (gradeStatusFilter !== "all" && row.status !== gradeStatusFilter)
        return false;
      return true;
    });

    const statusCounts = gradeDashboardStatuses.reduce(
      (acc, status) => {
        if (status !== "all") acc[status] = 0;
        return acc;
      },
      {} as Record<Exclude<GradeDashboardStatus, "all">, number>,
    );

    for (const row of filteredRows) {
      statusCounts[row.status] += 1;
    }

    const byExam = Array.from(
      filteredRows
        .reduce((map, row) => {
          const current = map.get(row.exam.id) || { exam: row.exam, total: 0 };
          current.total += 1;
          map.set(row.exam.id, current);
          return map;
        }, new Map<string, { exam: (typeof exams)[number]; total: number }>())
        .values(),
    ).sort((a, b) => b.total - a.total);

    const latestRows = [...filteredRows]
      .sort((a, b) =>
        String(b.grade.updatedAt || b.grade.createdAt || "").localeCompare(
          String(a.grade.updatedAt || a.grade.createdAt || ""),
        ),
      )
      .slice(0, 5);

    return { rows, filteredRows, statusCounts, byExam, latestRows };
  }, [
    grades,
    exams,
    students,
    classification,
    gradeExamFilter,
    gradeStatusFilter,
  ]);

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

      <Card className="overflow-hidden">
        <CardHeader className="border-b bg-muted/25 pb-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <CardTitle className="flex items-center gap-2 text-base">
                <BarChart3 className="size-5 text-primary" />
                داشبورد تنزيل الدرجات
              </CardTitle>
              <p className="mt-1 text-xs text-muted-foreground">
                عدّاد مباشر يتحدث فور تسجيل أو تعديل أي درجة، مع فرز حسب
                الامتحان وحالة الدرجة.
              </p>
            </div>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:w-[34rem]">
              <div className="space-y-1">
                <Label
                  htmlFor="dashboard-grade-exam-filter"
                  className="text-xs"
                >
                  الامتحان
                </Label>
                <Select
                  value={gradeExamFilter}
                  onValueChange={setGradeExamFilter}
                >
                  <SelectTrigger
                    id="dashboard-grade-exam-filter"
                    className="rounded-2xl bg-background"
                  >
                    <SelectValue placeholder="كل الامتحانات" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">كل الامتحانات</SelectItem>
                    {exams.map((exam) => (
                      <SelectItem key={exam.id} value={exam.id}>
                        {exam.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label
                  htmlFor="dashboard-grade-status-filter"
                  className="text-xs"
                >
                  حالة الدرجة
                </Label>
                <Select
                  value={gradeStatusFilter}
                  onValueChange={(value) =>
                    setGradeStatusFilter(value as GradeDashboardStatus)
                  }
                >
                  <SelectTrigger
                    id="dashboard-grade-status-filter"
                    className="rounded-2xl bg-background"
                  >
                    <SelectValue placeholder="كل حالات الدرجات" />
                  </SelectTrigger>
                  <SelectContent>
                    {gradeDashboardStatuses.map((status) => (
                      <SelectItem key={status} value={status}>
                        {gradeDashboardStatusLabels[status]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-5 p-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-5">
            <StatCard
              label="الدرجات المنزّلة"
              value={gradeDashboard.filteredRows.length}
              icon={BarChart3}
              tone="primary"
              hint={
                gradeExamFilter === "all"
                  ? "حسب الفلاتر الحالية"
                  : exams.find((exam) => exam.id === gradeExamFilter)?.name ||
                    "امتحان محدد"
              }
            />
            <StatCard
              label="نجاح"
              value={gradeDashboard.statusCounts.success || 0}
              icon={CheckCircle2}
              tone="success"
              hint="درجة تساوي أو تتجاوز النجاح"
            />
            <StatCard
              label="رسوب عدا الخصم"
              value={
                gradeDashboard.statusCounts["failed-without-discount"] || 0
              }
              icon={XCircle}
              tone="warning"
              hint="أقل من النجاح وفوق حد الخصم"
            />
            <StatCard
              label="رسوب مع الخصم"
              value={gradeDashboard.statusCounts["failed-with-discount"] || 0}
              icon={TrendingDown}
              tone="danger"
              hint="أقل/يساوي درجة الخصم"
            />
            <StatCard
              label="خصم فقط"
              value={gradeDashboard.statusCounts["discount-only"] || 0}
              icon={Shield}
              tone="info"
              hint="غياب أو غش أو إجراء غير رقمي"
            />
          </div>

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            <div className="rounded-3xl border bg-muted/20 p-4">
              <div className="mb-3 flex items-center justify-between gap-2">
                <p className="font-bold">أكثر الامتحانات تنزيلًا للدرجات</p>
                <Badge variant="secondary">
                  {gradeDashboard.byExam.length} امتحان
                </Badge>
              </div>
              <div className="space-y-2">
                {gradeDashboard.byExam.length === 0 ? (
                  <EmptyState
                    title="لا توجد درجات ضمن الفلتر"
                    description="ستظهر العدادات هنا فور تنزيل أول درجة مطابقة للفلاتر."
                  />
                ) : (
                  gradeDashboard.byExam.slice(0, 6).map((item) => {
                    const percent = gradeDashboard.filteredRows.length
                      ? Math.round(
                          (item.total / gradeDashboard.filteredRows.length) *
                            100,
                        )
                      : 0;
                    return (
                      <div
                        key={item.exam.id}
                        className="rounded-2xl border bg-background/70 p-3"
                      >
                        <div className="flex items-center justify-between gap-3 text-sm">
                          <span className="font-bold">{item.exam.name}</span>
                          <span className="text-xs text-muted-foreground">
                            {item.total} درجة
                          </span>
                        </div>
                        <div className="mt-2 h-2 overflow-hidden rounded-full bg-muted">
                          <div
                            className="h-full rounded-full bg-primary transition-all"
                            style={{ width: `${percent}%` }}
                          />
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>

            <div className="rounded-3xl border bg-muted/20 p-4">
              <div className="mb-3 flex items-center justify-between gap-2">
                <p className="font-bold">آخر الدرجات المنزّلة</p>
                <Badge variant="secondary">بث مباشر</Badge>
              </div>
              <div className="max-h-80 space-y-2 overflow-y-auto pr-1">
                {gradeDashboard.latestRows.length === 0 ? (
                  <EmptyState
                    title="لا توجد درجات حديثة"
                    description="أي درجة جديدة ستظهر هنا مباشرة بدون إعادة تحميل الصفحة."
                  />
                ) : (
                  gradeDashboard.latestRows.map((row) => (
                    <div
                      key={row.grade.id}
                      className="flex items-start justify-between gap-3 rounded-2xl border bg-background/70 p-3"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-bold">
                          {row.student.name}
                        </p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {row.exam.name} - {row.classificationText}
                        </p>
                      </div>
                      <Badge variant="outline" className="shrink-0">
                        {row.grade.status === "درجة"
                          ? `${row.grade.score}/${row.exam.fullMark}`
                          : row.grade.status}
                      </Badge>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
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
