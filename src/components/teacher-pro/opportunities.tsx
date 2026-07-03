"use client";

import React, { useEffect, useState, useMemo } from "react";
import { useTeacherStore, type Grade, type Student } from "@/lib/teacher-store";
import { gradeApi, opportunityStatsApi, studentApi, type OpportunityStatsResponse } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { formatAppDate, toLatinDigits } from "@/lib/format";
import { searchAny } from "@/lib/validation";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { useActionLock } from "@/hooks/use-action-lock";
import { formatGradeScore } from "@/lib/exam-utils";
import { ExportDialog, type ExportColumn } from "./export-dialog";


const opportunityExportColumns: ExportColumn<any>[] = [
  { key: "student", label: "الطالب", value: (s) => s.name || "" },
  { key: "code", label: "الكود", value: (s) => s.code || "" },
  { key: "course", label: "الدورة", value: (s) => s.courseName || "" },
  { key: "status", label: "الحالة", value: (s) => s.status || "" },
  { key: "opportunities", label: "الفرص الحالية", value: (s) => s.opportunities ?? "" },
  { key: "baseOpportunities", label: "الفرص الأساسية", value: (s) => s.baseOpportunities ?? "" },
  { key: "phone", label: "الهاتف", value: (s) => s.phone || "" },
  { key: "telegram", label: "التليكرام", value: (s) => s.telegram || "" },
];

export function OpportunitiesView() {
  const {
    students,
    courses,
    exams,
    grades,
    opportunityLogs,
    adjustOpportunities,
    bulkAdjustOpportunities,
    resetOpportunities,
    undoOpportunityLog,
    courseName,
    activeChapterForCourse,
    mergeStudentsCache,
    mergeGradesCache,
  } = useTeacherStore();

  const [filterCourseId, setFilterCourseId] = useState("");
  const [filterStatus, setFilterStatus] = useState("");
  const [filterOpportunityCount, setFilterOpportunityCount] = useState("");
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search, 180);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(10);
  const [detailsStudentId, setDetailsStudentId] = useState("");
  const [databaseStats, setDatabaseStats] = useState<OpportunityStatsResponse | null>(null);
  const [databaseStatsLoading, setDatabaseStatsLoading] = useState(false);

  // Action dialog
  const [actionDialog, setActionDialog] = useState<{
    studentId: string;
    type: "add" | "deduct" | "reset";
    open: boolean;
  }>({ studentId: "", type: "add", open: false });
  const [amount, setAmount] = useState(1);
  const [reason, setReason] = useState("");
  const [bulkActionDialog, setBulkActionDialog] = useState<{ type: "add" | "deduct"; open: boolean }>({ type: "add", open: false });
  const [bulkAmount, setBulkAmount] = useState(1);
  const [bulkReason, setBulkReason] = useState("");
  const [bulkExcludeDismissed, setBulkExcludeDismissed] = useState(true);
  const [bulkExcludeFullOpportunities, setBulkExcludeFullOpportunities] = useState(true);
  const { locked: isApplyingAction, runLocked: runActionLocked } =
    useActionLock();

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      studentApi.listAll({ pageSize: 200 }),
      gradeApi.listAll({ pageSize: 200 }),
    ])
      .then(([studentResult, gradeResult]) => {
        if (cancelled) return;
        mergeStudentsCache((studentResult?.students || []) as unknown as Student[]);
        mergeGradesCache((gradeResult?.grades || []) as unknown as Grade[]);
      })
      .catch(() => {
        // لا نمنع الصفحة من العمل؛ تعرض آخر كاش معروف إذا تعذر الاتصال.
      });
    return () => {
      cancelled = true;
    };
  }, [mergeStudentsCache, mergeGradesCache]);

  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(() => {
      setDatabaseStatsLoading(true);
      opportunityStatsApi
        .get({
          courseId: filterCourseId,
          status: filterStatus,
          opportunityCount: filterOpportunityCount,
          q: debouncedSearch,
        })
        .then((result) => {
          if (!cancelled) setDatabaseStats(result);
        })
        .catch(() => {
          if (!cancelled) setDatabaseStats(null);
        })
        .finally(() => {
          if (!cancelled) setDatabaseStatsLoading(false);
        });
    }, 180);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [filterCourseId, filterStatus, filterOpportunityCount, debouncedSearch]);

  const filtered = useMemo(() => {
    return students.filter((s) => {
      if (filterCourseId && s.courseId !== filterCourseId) return false;
      if (filterStatus === 'active' && s.status !== 'نشط') return false;
      if (filterStatus === 'dismissed' && s.status !== 'مفصول') return false;
      if (filterStatus === 'has-opportunities' && !(s.opportunities > 0 && s.status === 'نشط')) return false;
      if (filterStatus === 'no-opportunities' && !(s.opportunities === 0 && s.status === 'نشط')) return false;
      if (filterStatus === 'temporary-dismissal' && !(s.status === 'مفصول' && s.dismissalType === 'فصل مؤقت')) return false;
      if (filterStatus === 'final-dismissal' && !(s.status === 'مفصول' && s.dismissalType === 'فصل نهائي')) return false;
      if (filterOpportunityCount && s.opportunities !== Number(filterOpportunityCount)) return false;
      if (debouncedSearch && !searchAny(debouncedSearch, [s.name, s.code, s.phone, s.parentPhone, s.telegram, s.school, s.subSite, s.status, s.dismissalType, s.dismissalReason, s.dismissalNotes])) return false;
      return true;
    });
  }, [students, filterCourseId, filterStatus, filterOpportunityCount, debouncedSearch]);

  const totalPages = Math.ceil(filtered.length / pageSize);
  const paged = filtered.slice((page - 1) * pageSize, page * pageSize);

  const opportunityCountOptions = useMemo(() => {
    return Array.from(new Set(students.map((student) => Number(student.opportunities || 0))))
      .filter((count) => Number.isFinite(count) && count >= 0)
      .sort((a, b) => a - b);
  }, [students]);

  const bulkEligibleStudents = useMemo(
    () => filtered.filter((student) => Boolean(activeChapterForCourse(student.courseId))),
    [filtered, activeChapterForCourse],
  );

  const fullOpportunityLimitFor = (student: typeof students[number]) => {
    const base = Number(student.baseOpportunities || 0);
    return base > 0 ? base : 3;
  };

  const currentBulkTargets = useMemo(() => {
    return bulkEligibleStudents.filter((student) => {
      if (bulkActionDialog.type === "add") {
        if (bulkExcludeDismissed && student.status === "مفصول") return false;
        return true;
      }
      if (bulkExcludeFullOpportunities) {
        return Number(student.opportunities || 0) < fullOpportunityLimitFor(student);
      }
      return true;
    });
  }, [bulkEligibleStudents, bulkActionDialog.type, bulkExcludeDismissed, bulkExcludeFullOpportunities]);

  const bulkSkippedNoActiveChapterCount = filtered.length - bulkEligibleStudents.length;
  const bulkExcludedDismissedCount = bulkActionDialog.type === "add" && bulkExcludeDismissed
    ? bulkEligibleStudents.filter((student) => student.status === "مفصول").length
    : 0;
  const bulkExcludedFullOpportunitiesCount = bulkActionDialog.type === "deduct" && bulkExcludeFullOpportunities
    ? bulkEligibleStudents.filter((student) => Number(student.opportunities || 0) >= fullOpportunityLimitFor(student)).length
    : 0;
  const bulkSkippedCount = filtered.length - currentBulkTargets.length;

  const activeCourseFilterName = filterCourseId ? courseName(filterCourseId) : "كل الدورات";
  const activeStatusFilterName = filterStatus
    ? ({
        active: "طلاب نشطون",
        dismissed: "طلاب مفصولون",
        "has-opportunities": "نشط ولديه فرص",
        "no-opportunities": "نشط بدون فرص",
        "temporary-dismissal": "فصل مؤقت",
        "final-dismissal": "فصل نهائي",
      } as Record<string, string>)[filterStatus] || "حالة مخصصة"
    : "كل الحالات";
  const activeOpportunityFilterName = filterOpportunityCount ? `${filterOpportunityCount} فرصة` : "كل أعداد الفرص";
  const statsTotal = databaseStats?.total ?? filtered.length;
  const statsHasOpportunities = databaseStats?.hasOpportunities ?? filtered.filter((s) => s.opportunities > 0 && s.status === "نشط").length;
  const statsNoOpportunities = databaseStats?.noOpportunities ?? filtered.filter((s) => s.opportunities === 0 && s.status === "نشط").length;
  const statsDismissed = databaseStats?.dismissed ?? filtered.filter((s) => s.status === "مفصول").length;
  const statsSuffix = databaseStatsLoading ? "…" : "";


  const clearFilters = () => {
    setSearch("");
    setFilterCourseId("");
    setFilterStatus("");
    setFilterOpportunityCount("");
    setPage(1);
  };

  const selectedDetailsStudent = useMemo(
    () => students.find((student) => student.id === detailsStudentId) || null,
    [students, detailsStudentId],
  );

  const selectedDetailsLogs = useMemo(() => {
    if (!detailsStudentId) return [];
    return opportunityLogs
      .filter((log) => log.studentId === detailsStudentId)
      .sort((a, b) => String(b.date).localeCompare(String(a.date)));
  }, [opportunityLogs, detailsStudentId]);

  const selectedDetailsStats = useMemo(() => {
    return selectedDetailsLogs.reduce(
      (acc, log) => {
        if (log.action === "خصم") acc.deducted += Number(log.amount) || 0;
        if (log.action === "إضافة" || log.action === "فرصة أخيرة بعد تعهد") acc.added += Number(log.amount) || 0;
        if (log.examId) acc.examLinked += 1;
        return acc;
      },
      { deducted: 0, added: 0, examLinked: 0 },
    );
  }, [selectedDetailsLogs]);


  const cleanOpportunityReason = (reason: string | null | undefined) => {
    const text = String(reason || "").replace(/\s*\[academic-reactivation-link:[^\]]+\]/g, "").trim();
    return text || "بدون سبب مكتوب";
  };

  const reasonLabel = (part: string) => {
    const separatorIndex = part.indexOf(":");
    if (separatorIndex < 0) return { label: "السبب", value: part.trim() };
    return {
      label: part.slice(0, separatorIndex).trim(),
      value: part.slice(separatorIndex + 1).trim() || "—",
    };
  };

  const renderOpportunityReason = (log: typeof opportunityLogs[number]) => {
    const cleaned = cleanOpportunityReason(log.reason);
    const hasHiddenLink = String(log.reason || "").includes("[academic-reactivation-link:");
    const parts = cleaned
      .split(/\s+-\s+(?=النطاق:|الحالة:|عدد الفرص:|البحث:|السبب:)/g)
      .map((part) => part.trim())
      .filter(Boolean);
    const shouldSplit = parts.length > 1 || /^النطاق:|^الحالة:|^عدد الفرص:|^البحث:|^السبب:/.test(cleaned);

    if (!shouldSplit) {
      return (
        <div className="rounded-xl bg-muted/40 p-3 text-sm leading-6">
          <span className="font-bold text-foreground">السبب: </span>
          <span className="break-words text-muted-foreground">{cleaned}</span>
          {hasHiddenLink ? <Badge variant="outline" className="ms-2 align-middle">مرتبط بإعادة التفعيل</Badge> : null}
        </div>
      );
    }

    return (
      <div className="space-y-2 rounded-xl bg-muted/40 p-3 text-sm">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-bold text-foreground">تفاصيل السبب</span>
          {hasHiddenLink ? <Badge variant="outline">مرتبط بإعادة التفعيل</Badge> : null}
        </div>
        <div className="grid gap-2 md:grid-cols-2">
          {parts.map((part, index) => {
            const item = reasonLabel(part);
            return (
              <div key={`${log.id}-reason-${index}`} className="rounded-lg border bg-card/80 px-3 py-2">
                <p className="text-[11px] font-bold text-muted-foreground">{item.label}</p>
                <p className="break-words text-xs leading-5 text-foreground">{item.value}</p>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  const renderLogExamDetails = (log: typeof opportunityLogs[number]) => {
    const exam = exams.find((item) => item.id === log.examId);
    const grade = grades.find((item) => item.studentId === log.studentId && item.examId === log.examId);
    if (!log.examId) return <div className="rounded-xl border bg-muted/40 p-3 text-xs text-muted-foreground">حركة يدوية من إدارة الفرص، وليست مرتبطة بامتحان محدد.</div>;
    if (!exam) return <div className="rounded-xl border bg-muted/40 p-3 text-xs text-muted-foreground">الامتحان المرتبط بهذه الحركة غير موجود حالياً أو تم حذفه.</div>;
    return (
      <div className="grid gap-2 rounded-xl border bg-muted/40 p-3 text-xs leading-6 md:grid-cols-2">
        <div><span className="font-bold text-foreground">الامتحان: </span><span className="text-muted-foreground">{exam.name}</span></div>
        <div><span className="font-bold text-foreground">التاريخ: </span><span className="text-muted-foreground">{formatAppDate(exam.date)}</span></div>
        <div><span className="font-bold text-foreground">النوع: </span><span className="text-muted-foreground">{exam.type}</span></div>
        <div><span className="font-bold text-foreground">درجة الطالب: </span><span className="text-muted-foreground">{grade ? formatGradeScore(grade, exam, "—") : "لا توجد درجة مسجلة"}</span></div>
        {grade?.notes ? <div className="md:col-span-2"><span className="font-bold text-foreground">ملاحظات الدرجة: </span><span className="text-muted-foreground">{grade.notes}</span></div> : null}
      </div>
    );
  };

  const handleAction = runActionLocked(async () => {
    const selectedStudent = students.find((student) => student.id === actionDialog.studentId);
    if (!selectedStudent || !activeChapterForCourse(selectedStudent.courseId)) {
      toast.error("لا يمكن تعديل فرص طالب قبل اختيار فصل نشط لدورته");
      return;
    }
    if (actionDialog.type === "reset") {
      resetOpportunities(actionDialog.studentId);
      toast.success("تم إعادة تعيين الفرص");
    } else {
      if (!reason.trim()) {
        toast.error("يرجى إدخال السبب");
        return;
      }
      const amt = actionDialog.type === "deduct" ? -amount : amount;
      adjustOpportunities(actionDialog.studentId, amt, reason.trim());
      toast.success(
        actionDialog.type === "deduct" ? "تم خصم الفرص" : "تم إضافة الفرص",
      );
    }
    setActionDialog({ studentId: "", type: "add", open: false });
    setReason("");
    setAmount(1);
  });

  const handleBulkAction = runActionLocked(async () => {
    if (!currentBulkTargets.length) {
      toast.error("لا يوجد طلاب مؤهلون بعد تطبيق الاستثناءات الحالية");
      return;
    }
    if (!bulkReason.trim()) {
      toast.error("يرجى إدخال سبب العملية الجماعية");
      return;
    }
    const normalizedAmount = Math.max(1, Math.trunc(Number(bulkAmount) || 1));
    const scopeReason = [
      `النطاق: ${activeCourseFilterName}`,
      `الحالة: ${activeStatusFilterName}`,
      `عدد الفرص: ${activeOpportunityFilterName}`,
      search.trim() ? `البحث: ${search.trim()}` : "",
      bulkActionDialog.type === "add"
        ? `عدا المفصولين: ${bulkExcludeDismissed ? "نعم" : "لا"}`
        : `عدا أصحاب الفرص الكاملة: ${bulkExcludeFullOpportunities ? "نعم" : "لا"}`,
      `السبب: ${bulkReason.trim()}`,
    ].filter(Boolean).join(" - ");
    const result = bulkAdjustOpportunities(
      currentBulkTargets.map((student) => student.id),
      bulkActionDialog.type === "deduct" ? -normalizedAmount : normalizedAmount,
      scopeReason,
      { reactivateDismissedOnAdd: bulkActionDialog.type === "add" && !bulkExcludeDismissed },
    );
    if (result.affected === 0) {
      toast.error("لم يتم تطبيق العملية على أي طالب");
      return;
    }
    toast.success(`${bulkActionDialog.type === "deduct" ? "تم خصم" : "تمت إضافة"} ${normalizedAmount} فرصة لـ ${result.affected} طالب${bulkSkippedCount ? `، وتم استثناء ${bulkSkippedCount}` : ""}`);
    setBulkActionDialog({ type: "add", open: false });
    setBulkReason("");
    setBulkAmount(1);
    setBulkExcludeDismissed(true);
    setBulkExcludeFullOpportunities(true);
  });



  const opportunityExportRows = filtered.map((student) => ({
    ...student,
    courseName: courseName(student.courseId),
  }));


  return (
    <div className="space-y-4">
      {/* Filters */}
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">فلاتر إدارة الفرص</CardTitle></CardHeader>
        <CardContent className="p-4 pt-2">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-6">
            <div className="space-y-1 xl:col-span-2">
              <Label htmlFor="opp-search" className="text-xs font-bold">بحث عن طالب</Label>
              <Input id="opp-search" name="search" data-teacherpro-search="true" autoComplete="off" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} placeholder="اسم الطالب / الكود / الهاتف / المدرسة" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="opp-course" className="text-xs font-bold">الدورة</Label>
              <Select name="courseId" value={filterCourseId || "all"} onValueChange={(v) => { setFilterCourseId(v === "all" ? "" : v); setPage(1); }}>
                <SelectTrigger id="opp-course"><SelectValue placeholder="كل الدورات" /></SelectTrigger>
                <SelectContent><SelectItem value="all">كل الدورات</SelectItem>{courses.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="opp-status" className="text-xs font-bold">حالة الطالب</Label>
              <Select name="status" value={filterStatus || "all"} onValueChange={(v) => { setFilterStatus(v === "all" ? "" : v); setPage(1); }}>
                <SelectTrigger id="opp-status"><SelectValue placeholder="كل الحالات" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">كل الحالات</SelectItem><SelectItem value="active">طلاب نشطون</SelectItem><SelectItem value="dismissed">طلاب مفصولون</SelectItem><SelectItem value="has-opportunities">نشط ولديه فرص</SelectItem><SelectItem value="no-opportunities">نشط بدون فرص</SelectItem><SelectItem value="temporary-dismissal">فصل مؤقت</SelectItem><SelectItem value="final-dismissal">فصل نهائي</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="opp-count" className="text-xs font-bold">عدد الفرص</Label>
              <Select name="opportunityCount" value={filterOpportunityCount || "all"} onValueChange={(v) => { setFilterOpportunityCount(v === "all" ? "" : v); setPage(1); }}>
                <SelectTrigger id="opp-count"><SelectValue placeholder="كل الأعداد" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">كل أعداد الفرص</SelectItem>
                  {opportunityCountOptions.map((count) => <SelectItem key={count} value={String(count)}>{count} فرصة</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-end gap-2"><Button variant="outline" className="h-10 flex-1" onClick={clearFilters} disabled={!search && !filterCourseId && !filterStatus && !filterOpportunityCount}>مسح</Button><ExportDialog
                title="تصدير إدارة الفرص"
                fileName="opportunities"
                rows={opportunityExportRows}
                columns={opportunityExportColumns}
                triggerLabel="تصدير"
                description="تقرير إدارة الفرص حسب الفلاتر الحالية"
              /></div>
          </div>
        </CardContent>
      </Card>

      <Card className="border-primary/20 bg-primary/5">
        <CardContent className="flex flex-col gap-3 p-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="space-y-1">
            <p className="text-sm font-black">عمليات جماعية حسب الفلترة الحالية</p>
            <p className="text-xs text-muted-foreground">
              سيطبق الإجراء على الطلاب المؤهلين حسب الفلاتر، وتُعرض الاستثناءات التفصيلية قبل التنفيذ داخل نافذة التأكيد. {bulkSkippedNoActiveChapterCount > 0 ? `يوجد ${bulkSkippedNoActiveChapterCount} طالب بلا فصل نشط.` : ""}
            </p>
            <p className="text-[11px] text-muted-foreground">النطاق: {activeCourseFilterName} • {activeStatusFilterName} • {activeOpportunityFilterName}{search.trim() ? ` • بحث: ${search.trim()}` : ""}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              className="bg-emerald-600 text-white hover:bg-emerald-700"
              disabled={bulkEligibleStudents.length === 0}
              onClick={() => { setBulkExcludeDismissed(true); setBulkActionDialog({ type: "add", open: true }); }}
            >
              إضافة للجميع الظاهرين
            </Button>
            <Button
              variant="destructive"
              disabled={bulkEligibleStudents.length === 0}
              onClick={() => { setBulkExcludeFullOpportunities(true); setBulkActionDialog({ type: "deduct", open: true }); }}
            >
              خصم من الجميع الظاهرين
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Opportunity Overview */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">
              {statsHasOpportunities}{statsSuffix}
            </p>
            <p className="text-xs text-muted-foreground">طلاب لديهم فرص</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold text-amber-600 dark:text-amber-400">
              {statsNoOpportunities}{statsSuffix}
            </p>
            <p className="text-xs text-muted-foreground">طلاب بدون فرص</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold text-rose-600 dark:text-rose-400">
              {statsDismissed}{statsSuffix}
            </p>
            <p className="text-xs text-muted-foreground">مفصولون</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold">{statsTotal}{statsSuffix}</p>
            <p className="text-xs text-muted-foreground">إجمالي من قاعدة البيانات</p>
          </CardContent>
        </Card>
      </div>

      {/* Student Opportunities */}
      <Card>
        <CardHeader>
          <CardTitle>فرص الطلاب</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {paged.map((student) => {
              const activeChapter = activeChapterForCourse(student.courseId);
              const hasChapter = Boolean(activeChapter);
              const oppPercent =
                hasChapter && student.baseOpportunities > 0
                  ? (student.opportunities / student.baseOpportunities) * 100
                  : 0;
              return (
                <div
                  key={student.id}
                  className="flex flex-col gap-3 rounded-2xl border bg-card/80 p-3 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-lg lg:flex-row lg:items-center"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="font-medium text-sm truncate">
                        {student.name}
                      </p>
                      <Badge variant="outline" className="text-[10px]">
                        {student.code}
                      </Badge>
                      {student.status === "مفصول" && (
                        <Badge variant="destructive" className="text-[10px]">
                          {student.dismissalType || "مفصول"}
                        </Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {courseName(student.courseId)}
                    </p>
                    {student.status === "مفصول" && student.dismissalReason && (
                      <p className="mt-1 text-xs font-semibold text-destructive">
                        {student.dismissalReason}
                      </p>
                    )}
                    {!hasChapter && (
                      <p className="mt-1 text-xs font-semibold text-destructive">
                        لم يتم اختيار الفصل لهم بعد؛ كل الإجراءات مقفلة.
                      </p>
                    )}
                  </div>

                  {/* Opportunity Progress */}
                  <div className="flex items-center gap-3">
                    <div className="w-24">
                      <div className="h-2 rounded-full bg-muted overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all ${
                            oppPercent > 50
                              ? "bg-emerald-500"
                              : oppPercent > 0
                                ? "bg-amber-500"
                                : "bg-rose-500"
                          }`}
                          style={{ width: `${oppPercent}%` }}
                        />
                      </div>
                    </div>
                    <span
                      className={`font-bold text-sm ${
                        student.opportunities === 0
                          ? "text-rose-600"
                          : student.opportunities <= 2
                            ? "text-amber-600"
                            : "text-emerald-600"
                      }`}
                    >
                      {hasChapter ? `${student.opportunities}/${student.baseOpportunities}` : "0/0"}
                    </span>
                  </div>

                  {/* Actions */}
                  <div className="flex flex-wrap gap-1 lg:justify-end">
                    <Button variant="outline" size="sm" className="text-xs" onClick={() => setDetailsStudentId(student.id)}>التفاصيل {opportunityLogs.filter((log) => log.studentId === student.id).length > 0 ? `(${opportunityLogs.filter((log) => log.studentId === student.id).length})` : ""}</Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="text-xs text-emerald-600"
                      disabled={!hasChapter}
                      onClick={() =>
                        setActionDialog({
                          studentId: student.id,
                          type: "add",
                          open: true,
                        })
                      }
                    >
                      إضافة
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="text-xs text-rose-600"
                      disabled={!hasChapter}
                      onClick={() =>
                        setActionDialog({
                          studentId: student.id,
                          type: "deduct",
                          open: true,
                        })
                      }
                    >
                      خصم
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-xs"
                      disabled={!hasChapter}
                      onClick={() =>
                        setActionDialog({
                          studentId: student.id,
                          type: "reset",
                          open: true,
                        })
                      }
                    >
                      إعادة تعيين
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={page <= 1}
            onClick={() => setPage((p) => p - 1)}
          >
            السابق
          </Button>
          <span className="text-sm text-muted-foreground">
            {page} / {totalPages}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={page >= totalPages}
            onClick={() => setPage((p) => p + 1)}
          >
            التالي
          </Button>
        </div>
      )}

      {/* Recent Opportunity Logs */}
      <Card>
        <CardHeader>
          <CardTitle>سجل حركات الفرص</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2 max-h-80 overflow-y-auto">
            {opportunityLogs.length === 0 ? (
              <p className="empty-state py-6">لا توجد حركات</p>
            ) : (
              opportunityLogs.slice(0, 20).map((log) => {
                const student = students.find((s) => s.id === log.studentId);
                const exam = exams.find((item) => item.id === log.examId);
                const canUndo = Boolean(student && activeChapterForCourse(student.courseId) && (log.action === "إضافة" || log.action === "خصم"));
                return (
                  <div
                    key={log.id}
                    className="flex items-center justify-between text-sm p-2 rounded-xl bg-muted/60"
                  >
                    <div>
                      <span className="font-medium">
                        {student?.name || "غير محدد"}
                      </span>
                      <span className="text-muted-foreground mx-2">•</span>
                      <span className="text-muted-foreground">{formatAppDate(log.date)}</span>
                      {exam ? <span className="mx-2 text-xs font-bold text-primary">{exam.name}</span> : null}
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge
                        variant={
                          log.action === "خصم"
                            ? "destructive"
                            : log.action === "إضافة"
                              ? "default"
                              : "secondary"
                        }
                      >
                        {log.action} {log.amount}
                      </Badge>
                      <span className="text-muted-foreground text-xs">
                        {log.reason}
                      </span>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 text-xs"
                        disabled={!canUndo}
                        onClick={() => {
                          const ok = undoOpportunityLog(log.id);
                          ok ? toast.success("تم التراجع عن الحركة") : toast.error("لا يمكن التراجع عن هذه الحركة");
                        }}
                      >
                        تراجع
                      </Button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </CardContent>
      </Card>

      <Dialog open={Boolean(detailsStudentId)} onOpenChange={(open) => !open && setDetailsStudentId("")}>
        <DialogContent dir="rtl" className="max-w-3xl">
          <DialogHeader><DialogTitle>تفاصيل فرص الطالب {selectedDetailsStudent ? "- " + selectedDetailsStudent.name : ""}</DialogTitle></DialogHeader>
          {selectedDetailsStudent ? (
            <div className="space-y-4">
              <div className="grid gap-3 rounded-2xl border bg-muted/40 p-4 text-sm md:grid-cols-4">
                <div><p className="text-xs text-muted-foreground">الكود</p><p className="font-bold">{selectedDetailsStudent.code}</p></div>
                <div><p className="text-xs text-muted-foreground">الدورة</p><p className="font-bold">{courseName(selectedDetailsStudent.courseId)}</p></div>
                <div><p className="text-xs text-muted-foreground">الفرص الحالية</p><p className="font-bold">{selectedDetailsStudent.opportunities}/{selectedDetailsStudent.baseOpportunities}</p></div>
                <div><p className="text-xs text-muted-foreground">الحالة</p><p className="font-bold">{selectedDetailsStudent.status}</p></div>
              </div>
              <div className="grid gap-3 md:grid-cols-3">
                <div className="rounded-2xl border bg-card p-3 text-center"><p className="text-xl font-black text-rose-600">{selectedDetailsStats.deducted}</p><p className="text-xs text-muted-foreground">إجمالي المخصوم</p></div>
                <div className="rounded-2xl border bg-card p-3 text-center"><p className="text-xl font-black text-emerald-600">{selectedDetailsStats.added}</p><p className="text-xs text-muted-foreground">إجمالي المضاف</p></div>
                <div className="rounded-2xl border bg-card p-3 text-center"><p className="text-xl font-black text-primary">{selectedDetailsStats.examLinked}</p><p className="text-xs text-muted-foreground">حركات مرتبطة بامتحان</p></div>
              </div>
              <div className="max-h-[55vh] space-y-3 overflow-y-auto pr-1">
                {selectedDetailsLogs.length === 0 ? <p className="empty-state py-8">لا توجد حركات فرص لهذا الطالب</p> : selectedDetailsLogs.map((log) => (
                  <div key={log.id} className="space-y-3 rounded-2xl border bg-card p-4">
                    <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between"><div className="flex flex-wrap items-center gap-2"><Badge variant={log.action === "خصم" ? "destructive" : log.action === "إضافة" ? "default" : "secondary"}>{log.action} {log.amount}</Badge><span className="text-sm font-bold text-foreground">{formatAppDate(log.date)}</span></div><span className="text-xs text-muted-foreground">الفصل: {log.chapterId || "غير محدد"}</span></div>
                    {renderOpportunityReason(log)}
                    {renderLogExamDetails(log)}
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>

      <Dialog
        open={bulkActionDialog.open}
        onOpenChange={(open) => setBulkActionDialog((current) => ({ ...current, open }))}
      >
        <DialogContent dir="rtl">
          <DialogHeader>
            <DialogTitle>
              {bulkActionDialog.type === "add" ? "إضافة فرص لجميع الطلاب الظاهرين" : "خصم فرص من جميع الطلاب الظاهرين"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="rounded-2xl border bg-muted/50 p-3 text-sm leading-6">
              <p className="font-bold">سيتم تطبيق العملية على {currentBulkTargets.length} طالب بعد الاستثناءات.</p>
              <p className="text-xs text-muted-foreground">الفلاتر: {activeCourseFilterName} • {activeStatusFilterName} • {activeOpportunityFilterName}{search.trim() ? ` • بحث: ${search.trim()}` : ""}</p>
              {bulkActionDialog.type === "add" ? (
                <div className="mt-3 rounded-xl border bg-background/70 p-3">
                  <p className="mb-2 text-xs font-black text-foreground">العدا / Except</p>
                  <label htmlFor="bulk-exclude-dismissed" className="flex cursor-pointer items-start gap-2 text-xs leading-5 text-muted-foreground">
                    <Checkbox
                      id="bulk-exclude-dismissed"
                      checked={bulkExcludeDismissed}
                      onCheckedChange={(checked) => setBulkExcludeDismissed(checked === true)}
                      className="mt-0.5"
                    />
                    <span>عدا المفصولين: إذا بقيت محددة لا تُضاف لهم فرصة. إذا ألغيتها تُضاف لهم فرصة ويتم إعادة تفعيلهم تلقائياً إذا صار لديهم فرص.</span>
                  </label>
                </div>
              ) : (
                <div className="mt-3 rounded-xl border bg-background/70 p-3">
                  <p className="mb-2 text-xs font-black text-foreground">العدا / Except</p>
                  <label htmlFor="bulk-exclude-full-opportunities" className="flex cursor-pointer items-start gap-2 text-xs leading-5 text-muted-foreground">
                    <Checkbox
                      id="bulk-exclude-full-opportunities"
                      checked={bulkExcludeFullOpportunities}
                      onCheckedChange={(checked) => setBulkExcludeFullOpportunities(checked === true)}
                      className="mt-0.5"
                    />
                    <span>عدا أصحاب الفرص الكاملة مثل 3/3: إذا بقيت محددة لا يتم الخصم منهم. إذا ألغيتها يدخلون ضمن الخصم الجماعي.</span>
                  </label>
                </div>
              )}
              {bulkSkippedNoActiveChapterCount > 0 ? <p className="mt-2 text-xs font-semibold text-amber-600">سيتم تجاوز {bulkSkippedNoActiveChapterCount} طالب لأنهم بلا فصل نشط مرتبط بالدورة.</p> : null}
              {bulkExcludedDismissedCount > 0 ? <p className="text-xs font-semibold text-amber-600">سيتم استثناء {bulkExcludedDismissedCount} طالب مفصول حسب خيار العدا.</p> : null}
              {bulkExcludedFullOpportunitiesCount > 0 ? <p className="text-xs font-semibold text-amber-600">سيتم استثناء {bulkExcludedFullOpportunitiesCount} طالب لديهم فرص كاملة.</p> : null}
            </div>
            <div className="space-y-2">
              <Label htmlFor="bulk-opp-amount">عدد الفرص</Label>
              <Input
                id="bulk-opp-amount"
                name="bulkAmount"
                type="number"
                min={1}
                autoComplete="off"
                value={bulkAmount}
                onChange={(e) => setBulkAmount(Math.max(1, Number(toLatinDigits(e.target.value)) || 1))}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="bulk-opp-reason">سبب الإضافة / الخصم</Label>
              <Input
                id="bulk-opp-reason"
                name="bulkReason"
                autoComplete="off"
                value={bulkReason}
                onChange={(e) => setBulkReason(e.target.value)}
                placeholder="مثلاً: سلوك ممتاز، إعفاء، مخالفة واجب، شك..."
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBulkActionDialog((current) => ({ ...current, open: false }))}>إلغاء</Button>
            <Button onClick={handleBulkAction} disabled={isApplyingAction || currentBulkTargets.length === 0} variant={bulkActionDialog.type === "deduct" ? "destructive" : "default"}>
              {bulkActionDialog.type === "add" ? "إضافة للجميع" : "خصم من الجميع"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Action Dialog */}
      <Dialog
        open={actionDialog.open}
        onOpenChange={(o) => setActionDialog({ ...actionDialog, open: o })}
      >
        <DialogContent dir="rtl">
          <DialogHeader>
            <DialogTitle>
              {actionDialog.type === "add"
                ? "إضافة فرص"
                : actionDialog.type === "deduct"
                  ? "خصم فرص"
                  : "إعادة تعيين الفرص"}
              {" - "}
              {students.find((s) => s.id === actionDialog.studentId)?.name}
            </DialogTitle>
          </DialogHeader>
          {actionDialog.type !== "reset" ? (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="opp-amount">العدد</Label>
                <Input
                  id="opp-amount"
                  name="amount"
                  type="number"
                  min={1}
                  autoComplete="off"
                  value={amount}
                  onChange={(e) =>
                    setAmount(Number(toLatinDigits(e.target.value)) || 1)
                  }
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="opp-reason">السبب</Label>
                <Input
                  id="opp-reason"
                  name="reason"
                  autoComplete="off"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="سبب الحركة"
                />
              </div>
            </div>
          ) : (
            <>
              <p className="text-sm text-muted-foreground">
                سيتم إعادة تعيين فرص الطالب إلى العدد الأساسي (
                {students.find((s) => s.id === actionDialog.studentId)
                  ?.baseOpportunities || 0}
                )
              </p>
            </>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setActionDialog({ ...actionDialog, open: false })}
            >
              إلغاء
            </Button>
            <Button onClick={handleAction} disabled={isApplyingAction}>
              {actionDialog.type === "add"
                ? "إضافة"
                : actionDialog.type === "deduct"
                  ? "خصم"
                  : "إعادة تعيين"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
