"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTeacherStore } from "@/lib/teacher-store";
import { chapterApi, courseChapterApi, type ChapterCourseLinkOverview, type ChapterOverviewResponse } from "@/lib/api";
import { emitTeacherProDataChanged } from "@/lib/teacherpro-sync";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
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
  DialogDescription,
} from "@/components/ui/dialog";
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
import { toast } from "@/lib/user-toast";
import { toLatinDigits } from "@/lib/format";
import { useActionLock } from "@/hooks/use-action-lock";
import { useLatestRequest } from "@/hooks/use-latest-request";
import {
  useTeacherProBackgroundSyncDetector,
  useTeacherProSyncKey,
} from "@/hooks/use-teacherpro-sync";

type CourseFilter = "all" | "has-active" | "no-active" | "multiple-active" | "needs-repair";
type ChapterFilter = "all" | "active" | "unused" | "deletable" | "protected";
type ChapterRow = ChapterOverviewResponse["chapterRows"][number];
type CourseRow = ChapterOverviewResponse["courseRows"][number];

type EditChapterDialog = {
  open: boolean;
  id: string;
  chName: string;
  opps: number;
  row: ChapterRow | null;
};

type ActionDialog = {
  open: boolean;
  link: ChapterCourseLinkOverview | null;
  course: CourseRow | null;
  action: "activate" | "deactivate";
};

const courseFilterLabels: Record<CourseFilter, string> = {
  all: "كل الدورات",
  "has-active": "لديها فصل نشط",
  "no-active": "بلا فصل نشط",
  "multiple-active": "أكثر من فصل نشط",
  "needs-repair": "تحتاج مراجعة فرص",
};

const chapterFilterLabels: Record<ChapterFilter, string> = {
  all: "كل الفصول",
  active: "مفعلة بدورات",
  unused: "غير مرتبطة",
  deletable: "قابلة للحذف",
  protected: "محمية من الحذف",
};

function normalizeSearch(value: string): string {
  return value
    .toLocaleLowerCase("ar-IQ")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ؤ/g, "و")
    .replace(/ئ/g, "ي")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .trim();
}

function statCard(label: string, value: React.ReactNode, hint?: string) {
  return (
    <div className="rounded-2xl border border-primary/20 bg-card/70 p-4 shadow-sm" data-count-scope="system">
      <p className="text-xs font-bold text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-black">{value}</p>
      {hint ? <p className="mt-1 text-[11px] text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

function renderBlockers(blockers: string[]) {
  if (!blockers.length) return null;
  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      {blockers.map((blocker) => (
        <Badge key={blocker} variant="outline" className="border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-200">
          {blocker}
        </Badge>
      ))}
    </div>
  );
}

export function ChaptersView() {
  const { loadSectionDataFromServer } = useTeacherStore();
  const syncKey = useTeacherProSyncKey([
    "chapters",
    "courses",
    "students",
    "opportunities",
    "dashboard",
  ]);
  const isBackgroundSync = useTeacherProBackgroundSyncDetector(syncKey);
  const beginOverviewRequest = useLatestRequest();
  const overviewLoadedRef = useRef(false);
  const [overview, setOverview] = useState<ChapterOverviewResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [searchText, setSearchText] = useState("");
  const [courseFilter, setCourseFilter] = useState<CourseFilter>("all");
  const [chapterFilter, setChapterFilter] = useState<ChapterFilter>("all");
  const [chapterNameInput, setChapterNameInput] = useState("");
  const [opportunities, setOpportunities] = useState(5);
  const [courseId, setCourseId] = useState("");
  const [chapterId, setChapterId] = useState("");
  const [editChapterDialog, setEditChapterDialog] = useState<EditChapterDialog>({
    open: false,
    id: "",
    chName: "",
    opps: 0,
    row: null,
  });
  const [deleteChapterDialog, setDeleteChapterDialog] = useState<{ open: boolean; row: ChapterRow | null }>({ open: false, row: null });
  const [deleteLinkDialog, setDeleteLinkDialog] = useState<{ open: boolean; link: ChapterCourseLinkOverview | null; course: CourseRow | null }>({ open: false, link: null, course: null });
  const [actionDialog, setActionDialog] = useState<ActionDialog>({ open: false, link: null, course: null, action: "activate" });
  const [repairDialog, setRepairDialog] = useState(false);

  const { locked: isAddingChapter, runLocked: runAddChapterLocked } = useActionLock();
  const { locked: isAttachingChapter, runLocked: runAttachChapterLocked } = useActionLock();
  const { locked: isSavingChapter, runLocked: runSaveChapterLocked } = useActionLock();
  const { locked: isDeletingChapter, runLocked: runDeleteChapterLocked } = useActionLock();
  const { locked: isDeletingLink, runLocked: runDeleteLinkLocked } = useActionLock();
  const { locked: isApplyingAction, runLocked: runApplyActionLocked } = useActionLock();
  const { locked: isFixingZeroOpp, runLocked: runFixZeroOppLocked } = useActionLock();

  const loadOverview = useCallback(
    async (options: { quiet?: boolean } = {}) => {
      const request = beginOverviewRequest();
      const quiet = Boolean(options.quiet || overviewLoadedRef.current);
      if (quiet) setRefreshing(true);
      else setLoading(true);
      try {
        const data = await chapterApi.overview({
          signal: request.signal,
          quietAbort: true,
        });
        if (!request.isLatest()) return;
        if (data) {
          setOverview(data);
          overviewLoadedRef.current = true;
        }
      } finally {
        if (!request.isLatest()) return;
        setLoading(false);
        setRefreshing(false);
      }
    },
    [beginOverviewRequest],
  );

  useEffect(() => {
    void loadOverview({ quiet: isBackgroundSync() });
  }, [isBackgroundSync, loadOverview, syncKey]);

  const refreshAfterMutation = async (reason: string) => {
    await Promise.all([
      loadOverview({ quiet: true }),
      loadSectionDataFromServer("chapters"),
    ]);
    emitTeacherProDataChanged({
      source: "local-mutation",
      reason,
      scopes: ["chapters", "courses", "students", "opportunities", "dashboard", "logs"],
    });
  };

  const filteredCourses = useMemo(() => {
    const query = normalizeSearch(searchText);
    return (overview?.courseRows || []).filter((row) => {
      const haystack = normalizeSearch([
        row.course.name,
        row.activeLink?.chapter.name || "",
        ...row.links.map((link) => link.chapter.name),
      ].join(" "));
      if (query && !haystack.includes(query)) return false;
      if (courseFilter === "has-active" && row.counts.activeLinks === 0) return false;
      if (courseFilter === "no-active" && row.counts.activeLinks !== 0) return false;
      if (courseFilter === "multiple-active" && row.counts.activeLinks <= 1) return false;
      if (courseFilter === "needs-repair" && !row.health.needsRepair) return false;
      return true;
    });
  }, [overview, searchText, courseFilter]);

  const filteredChapters = useMemo(() => {
    const query = normalizeSearch(searchText);
    return (overview?.chapterRows || []).filter((row) => {
      const haystack = normalizeSearch(row.chapter.name);
      if (query && !haystack.includes(query)) return false;
      if (chapterFilter === "active" && row.counts.activeLinks === 0) return false;
      if (chapterFilter === "unused" && row.counts.linkedCourses > 0) return false;
      if (chapterFilter === "deletable" && !row.deleteSafety.canDelete) return false;
      if (chapterFilter === "protected" && row.deleteSafety.canDelete) return false;
      return true;
    });
  }, [overview, searchText, chapterFilter]);

  const filteredCourseStats = useMemo(() => ({
    total: filteredCourses.length,
    withActive: filteredCourses.filter((row) => row.counts.activeLinks === 1).length,
    withoutActive: filteredCourses.filter((row) => row.counts.activeLinks === 0).length,
    needsRepair: filteredCourses.filter((row) => row.health.needsRepair).length,
  }), [filteredCourses]);

  const handleAddChapter = runAddChapterLocked(async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const name = chapterNameInput.trim();
    if (!name) {
      toast.error("يرجى إدخال اسم الفصل");
      return;
    }
    const result = await chapterApi.add({ name, opportunities: Math.max(0, Number(opportunities) || 0) });
    if (!result.ok) {
      toast.error(result.error || "تعذر إضافة الفصل");
      return;
    }
    setChapterNameInput("");
    setOpportunities(5);
    await refreshAfterMutation("إضافة فصل بعد التحقق من الحفظ");
    toast.success("تمت إضافة الفصل من بيانات النظام");
  });

  const handleAttachChapter = runAttachChapterLocked(async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!courseId || !chapterId) {
      toast.error("يرجى اختيار الدورة والفصل");
      return;
    }
    const result = await courseChapterApi.add({ courseId, chapterId });
    if (!result.ok) {
      toast.error(result.error || "تعذر ربط الفصل بالدورة");
      return;
    }
    setCourseId("");
    setChapterId("");
    await refreshAfterMutation("ربط فصل بدورة بعد التحقق من الحفظ");
    toast.success("تم ربط الفصل بالدورة بعد التحقق من الحفظ");
  });

  const openEditChapterDialog = (row: ChapterRow) => {
    setEditChapterDialog({
      open: true,
      id: row.id,
      chName: row.chapter.name,
      opps: row.chapter.opportunities,
      row,
    });
  };

  const handleEditChapterSave = runSaveChapterLocked(async () => {
    const name = editChapterDialog.chName.trim();
    if (!name) {
      toast.error("يرجى إدخال اسم الفصل");
      return;
    }
    const result = await chapterApi.update(editChapterDialog.id, {
      name,
      opportunities: Math.max(0, Number(editChapterDialog.opps) || 0),
    });
    if (!result.ok) {
      toast.error(result.error || "تعذر تعديل الفصل");
      return;
    }
    setEditChapterDialog({ open: false, id: "", chName: "", opps: 0, row: null });
    await refreshAfterMutation("تعديل فصل بعد التحقق من الحفظ");
    toast.success("تم تعديل الفصل بعد التحقق من الحفظ");
  });

  const handleDeleteChapterConfirm = runDeleteChapterLocked(async () => {
    const row = deleteChapterDialog.row;
    if (!row) return;
    if (!row.deleteSafety.canDelete) {
      toast.error("هذا الفصل محمي من الحذف بسبب روابط أو سجلات لها أثر.");
      return;
    }
    const result = await chapterApi.remove(row.id);
    if (!result.ok) {
      toast.error(result.error || "تعذر حذف الفصل");
      return;
    }
    setDeleteChapterDialog({ open: false, row: null });
    await refreshAfterMutation("حذف فصل آمن");
    toast.success("تم حذف الفصل بعد فحص الأثر");
  });

  const handleDeleteLinkConfirm = runDeleteLinkLocked(async () => {
    const link = deleteLinkDialog.link;
    if (!link) return;
    if (!link.deleteSafety.canDelete) {
      toast.error("هذا الربط محمي من الحذف لأنه مفعل أو يحمل أرشيف فرص.");
      return;
    }
    const result = await courseChapterApi.remove(link.id);
    if (!result.ok) {
      toast.error(result.error || "تعذر حذف الربط");
      return;
    }
    setDeleteLinkDialog({ open: false, link: null, course: null });
    await refreshAfterMutation("حذف ربط فصل بدورة آمن");
    toast.success("تم حذف الربط بعد التحقق من الحفظ");
  });

  const openActionDialog = (course: CourseRow, link: ChapterCourseLinkOverview) => {
    setActionDialog({
      open: true,
      course,
      link,
      action: link.active ? "deactivate" : "activate",
    });
  };

  const handleApplyChapterAction = runApplyActionLocked(async () => {
    const { link, action } = actionDialog;
    if (!link) return;
    const result = await courseChapterApi.activate(link.id, action, { confirmImpact: true });
    if (!result.ok) {
      toast.error(result.error || "تعذر تنفيذ إجراء الفصل");
      return;
    }
    setActionDialog({ open: false, link: null, course: null, action: "activate" });
    await refreshAfterMutation(action === "activate" ? "تفعيل فصل آمن" : "إلغاء تفعيل فصل آمن");
    toast.success(action === "activate" ? "تم تفعيل الفصل وتحديث الفرص بأمان" : "تم إلغاء التفعيل وأرشفة الفرص بأمان");
  });

  const handleFixZeroOpportunities = runFixZeroOppLocked(async () => {
    try {
      const response = await fetch("/api/students/fix-zero-opportunities?mode=include-dismissed", {
        method: "PATCH",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        toast.error(payload?.error || "تعذر إصلاح فرص الطلاب حالياً.");
        return;
      }
      setRepairDialog(false);
      await refreshAfterMutation("إصلاح شامل لفرص الطلاب المعطوبة");
      if (payload?.fixedTotal > 0) {
        toast.success(payload.message || `تم إصلاح ${payload.fixedTotal} طالب.`);
      } else {
        toast.info(payload?.message || "لا يوجد طلاب يحتاجون إصلاحاً.");
      }
    } catch {
      toast.error("تعذر الاتصال بالنظام لإصلاح فرص الطلاب.");
    }
  });

  const resetFilters = () => {
    setSearchText("");
    setCourseFilter("all");
    setChapterFilter("all");
  };

  const renderLoadingSkeleton = () => (
    <div className="space-y-4" aria-live="polite" aria-busy="true">
      {[0, 1, 2].map((index) => (
        <div key={index} className="rounded-3xl border bg-card/80 p-4 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span className="h-6 w-44 animate-pulse rounded-full bg-muted" />
            <span className="h-8 w-24 animate-pulse rounded-full bg-muted" />
          </div>
          <div className="mt-4 grid gap-3 md:grid-cols-4">
            {[0, 1, 2, 3].map((cell) => (
              <span key={cell} className="h-20 animate-pulse rounded-2xl bg-muted" />
            ))}
          </div>
        </div>
      ))}
    </div>
  );

  const renderCourseRow = (row: CourseRow) => (
    <Card key={row.id} className="overflow-hidden border bg-card/90 shadow-sm">
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <CardTitle className="text-lg">{row.course.name}</CardTitle>
              <Badge variant={row.course.active ? "secondary" : "outline"}>
                {row.course.active ? "نشطة للتسجيل" : "موقوفة عن التسجيل"}
              </Badge>
              {row.counts.activeLinks === 1 ? <Badge>فصل نشط واحد</Badge> : null}
              {row.counts.activeLinks === 0 ? <Badge variant="destructive">بلا فصل نشط</Badge> : null}
              {row.counts.activeLinks > 1 ? <Badge variant="destructive">تعارض: أكثر من فصل نشط</Badge> : null}
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              الفصل النشط: {row.activeLink ? `${row.activeLink.chapter.name} (${row.activeLink.chapter.opportunities} فرص)` : "لا يوجد"}
            </p>
          </div>
          {row.health.needsRepair ? <Badge variant="outline" className="border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-200">تحتاج مراجعة</Badge> : <Badge variant="outline" className="border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-200">سليمة</Badge>}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {statCard("الطلاب", row.counts.students, `نشط ${row.counts.activeStudents} / مفصول ${row.counts.dismissedStudents}`)}
          {statCard("المؤرشفون", row.counts.archivedStudents)}
          {statCard("روابط الفصول", row.counts.linkedChapters, `نشط ${row.counts.activeLinks}`)}
          {statCard("فرص 0/0", row.counts.zeroZeroWithActive)}
          {statCard("فوق السقف", row.counts.aboveCap)}
        </div>

        {row.warnings.length ? (
          <div className="rounded-2xl border border-amber-500/35 bg-amber-500/10 p-3 text-xs text-amber-900 dark:text-amber-100">
            <p className="mb-2 font-black">تنبيهات هذه الدورة</p>
            <div className="flex flex-wrap gap-1.5">
              {row.warnings.map((warning) => <Badge key={warning} variant="outline" className="border-amber-500/40 bg-background/70">{warning}</Badge>)}
            </div>
          </div>
        ) : null}

        <div className="space-y-2">
          <p className="text-xs font-bold text-muted-foreground">الفصول المرتبطة</p>
          {row.links.length === 0 ? (
            <p className="rounded-2xl border border-dashed bg-muted/25 p-4 text-xs text-muted-foreground">لا يوجد أي فصل مربوط بهذه الدورة.</p>
          ) : (
            <div className="grid gap-3 md:grid-cols-2">
              {row.links.map((link) => (
                <div key={link.id} className={`rounded-2xl border p-3 ${link.active ? "border-primary bg-primary/5" : "bg-muted/20"}`}>
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <b>{link.chapter.name}</b>
                        <Badge variant={link.active ? "default" : "outline"}>{link.active ? "مفعل" : "غير مفعل"}</Badge>
                        {link.archiveCount > 0 ? <Badge variant="outline">أرشيف {link.archiveCount}</Badge> : null}
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">فرص الفصل: {link.chapter.opportunities}</p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button size="sm" variant={link.active ? "outline" : "default"} className="rounded-full" onClick={() => openActionDialog(row, link)}>
                        {link.active ? "إلغاء التفعيل" : "تفعيل آمن"}
                      </Button>
                      <Button size="sm" variant="ghost" className="rounded-full text-destructive" onClick={() => setDeleteLinkDialog({ open: true, link, course: row })} disabled={!link.deleteSafety.canDelete}>
                        حذف الربط
                      </Button>
                    </div>
                  </div>
                  {renderBlockers(link.deleteSafety.blockers)}
                </div>
              ))}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );

  const renderChapterRow = (row: ChapterRow) => (
    <div key={row.id} className="rounded-2xl border bg-card/80 p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <b>{row.chapter.name}</b>
            <Badge variant="outline">{row.chapter.opportunities} فرص</Badge>
            {row.deleteSafety.canDelete ? <Badge variant="outline" className="border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-200">قابل للحذف</Badge> : <Badge variant="outline" className="border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-200">محمي</Badge>}
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            مرتبط بـ {row.counts.linkedCourses} دورة · مفعل بـ {row.counts.activeLinks} · سجلات فرص {row.counts.opportunityLogs}
          </p>
          {renderBlockers(row.deleteSafety.blockers)}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" className="rounded-full" onClick={() => openEditChapterDialog(row)}>تعديل</Button>
          <Button size="sm" variant="ghost" className="rounded-full text-destructive" onClick={() => setDeleteChapterDialog({ open: true, row })} disabled={!row.deleteSafety.canDelete}>حذف</Button>
        </div>
      </div>
    </div>
  );

  const actionCourse = actionDialog.course;
  const actionLink = actionDialog.link;
  // الإصلاح الشامل يغطي 0/0 + 0/X + X/0 + baseOpportunities != فرص الفصل،
  // لذا الزر يبقى متاحاً ما دامت هناك دورة فيها فصل نشط.
  const repairCount = overview?.stats.studentsZeroZeroWithActive || 0;
  const totalCourses = overview?.stats.courses ?? 0;
  const withoutActive = overview?.stats.coursesWithoutActiveChapter ?? 0;
  const hasActiveChapters = totalCourses - withoutActive > 0;

  return (
    <div className="space-y-6">
      <Card className="border-primary/20 bg-gradient-to-br from-primary/5 to-background">
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle>الفصول والفرص</CardTitle>
              <p className="mt-2 text-sm text-muted-foreground">
                إدارة الفصول أصبحت مبنية على ملخص بيانات النظام: فصل نشط واحد لكل دورة، أثر واضح قبل التفعيل، وحماية من الاعتماد على بيانات الطلاب المؤقتة.
              </p>
            </div>
            <Button variant="outline" className="rounded-full" onClick={() => void loadOverview()} disabled={loading || refreshing}>{refreshing ? "جارٍ التحديث..." : "تحديث الملخص"}</Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            {statCard("إجمالي الدورات في النظام", overview?.stats.courses ?? "—")}
            {statCard("إجمالي الفصول في النظام", overview?.stats.chapters ?? "—")}
            {statCard("بلا فصل نشط", overview?.stats.coursesWithoutActiveChapter ?? "—")}
            {statCard("تعارض نشط", overview?.stats.coursesWithMultipleActiveChapters ?? "—")}
            {statCard("طلاب 0/0", repairCount)}
          </div>

          <div className="rounded-2xl border border-dashed bg-muted/25 p-3 text-xs text-muted-foreground">
            أي تفعيل أو إلغاء تفعيل يعرض أثره قبل التنفيذ، ويتم من النظام داخل عملية واحدة حتى لا يظهر أكثر من فصل نشط لنفس الدورة.
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-6">
          <div className="grid gap-3 lg:grid-cols-[1.2fr_220px_220px_auto]">
            <Input value={searchText} onChange={(event) => setSearchText(event.target.value)} placeholder="بحث باسم الدورة أو الفصل" />
            <Select value={courseFilter} onValueChange={(value) => setCourseFilter(value as CourseFilter)}>
              <SelectTrigger><SelectValue placeholder="حالة الدورات" /></SelectTrigger>
              <SelectContent>
                {(Object.keys(courseFilterLabels) as CourseFilter[]).map((key) => <SelectItem key={key} value={key}>{courseFilterLabels[key]}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={chapterFilter} onValueChange={(value) => setChapterFilter(value as ChapterFilter)}>
              <SelectTrigger><SelectValue placeholder="حالة الفصول" /></SelectTrigger>
              <SelectContent>
                {(Object.keys(chapterFilterLabels) as ChapterFilter[]).map((key) => <SelectItem key={key} value={key}>{chapterFilterLabels[key]}</SelectItem>)}
              </SelectContent>
            </Select>
            <Button variant="outline" onClick={resetFilters} className="rounded-full">تصفير الفلاتر</Button>
          </div>
          <div className="mt-3 flex flex-wrap gap-2 text-xs text-muted-foreground">
            <Badge variant="outline" data-count-scope="filtered">المطابقون للفلاتر: {filteredCourseStats.total}</Badge>
            <Badge variant="outline">بفصل نشط: {filteredCourseStats.withActive}</Badge>
            <Badge variant="outline">بلا فصل: {filteredCourseStats.withoutActive}</Badge>
            <Badge variant="outline">تحتاج مراجعة: {filteredCourseStats.needsRepair}</Badge>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-6 xl:grid-cols-[0.95fr_1.05fr]">
        <Card>
          <CardHeader><CardTitle>إضافة وربط الفصول</CardTitle></CardHeader>
          <CardContent className="space-y-6">
            <form onSubmit={handleAddChapter} className="space-y-3 rounded-2xl border bg-muted/20 p-4">
              <p className="font-bold">إضافة فصل منهجي</p>
              <div className="space-y-2">
                <Label htmlFor="chapter-name">اسم الفصل</Label>
                <Input id="chapter-name" value={chapterNameInput} onChange={(event) => setChapterNameInput(event.target.value)} placeholder="مثلاً: الفصل الأول" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="chapter-opps">عدد الفرص</Label>
                <Input id="chapter-opps" type="number" min={0} value={opportunities} onChange={(event) => setOpportunities(Math.max(0, Number(toLatinDigits(event.target.value)) || 0))} />
              </div>
              <Button type="submit" disabled={isAddingChapter} className="w-full rounded-full">{isAddingChapter ? "جاري الإضافة..." : "إضافة فصل من النظام"}</Button>
            </form>

            <form onSubmit={handleAttachChapter} className="space-y-3 rounded-2xl border bg-muted/20 p-4">
              <p className="font-bold">ربط فصل بدورة</p>
              <div className="space-y-2">
                <Label>الدورة</Label>
                <Select value={courseId} onValueChange={setCourseId}>
                  <SelectTrigger><SelectValue placeholder="اختر الدورة" /></SelectTrigger>
                  <SelectContent>
                    {(overview?.courseRows || []).map((row) => <SelectItem key={row.course.id} value={row.course.id}>{row.course.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>الفصل</Label>
                <Select value={chapterId} onValueChange={setChapterId}>
                  <SelectTrigger><SelectValue placeholder="اختر الفصل" /></SelectTrigger>
                  <SelectContent>
                    {(overview?.chapterRows || []).map((row) => <SelectItem key={row.chapter.id} value={row.chapter.id}>{row.chapter.name} - {row.chapter.opportunities} فرص</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <Button type="submit" disabled={isAttachingChapter} className="w-full rounded-full">{isAttachingChapter ? "جاري الربط..." : "ربط الفصل بالدورة"}</Button>
            </form>

            <div className="rounded-2xl border border-amber-500/35 bg-amber-500/10 p-4 text-xs text-amber-900 dark:text-amber-100">
              <p className="font-black">إصلاح شامل لفرص الطلاب المعطوبة</p>
              <p className="mt-1 leading-6">يصلح الطلاب النشطين والمفصلين في الدورات ذات الفصل النشط: 0/0، 0/X، X/0، أو فرص لا تطابق الفصل. المؤرشفون لا يُعاد لهم فرص. يُعاد احتساب الحالة الأكاديمية بعد الإصلاح.</p>
              <Button type="button" variant="outline" size="sm" className="mt-3 rounded-full border-amber-500/50" onClick={() => setRepairDialog(true)} disabled={isFixingZeroOpp || !hasActiveChapters}>
                {hasActiveChapters
                  ? repairCount > 0
                    ? `معاينة وإصلاح ${repairCount} طالب 0/0 ( + الطلاب المعطوبين الآخرين )`
                    : "إصلاح شامل لكل الطلاب المعطوبين"
                  : "لا يوجد فصل نشط"}
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>مكتبة الفصول</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {filteredChapters.length === 0 ? <p className="rounded-2xl border border-dashed bg-muted/20 p-4 text-sm text-muted-foreground">لا توجد فصول مطابقة للفلاتر.</p> : filteredChapters.map(renderChapterRow)}
          </CardContent>
        </Card>
      </div>

      <div className="space-y-4">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-lg font-black">حالة الدورات والفصول</h3>
          <p className="text-xs text-muted-foreground">كل الأرقام من بيانات النظام.</p>
        </div>
        {loading ? renderLoadingSkeleton() : filteredCourses.length === 0 ? <p className="rounded-2xl border border-dashed bg-muted/20 p-4 text-sm text-muted-foreground">لا توجد دورات مطابقة للفلاتر.</p> : filteredCourses.map(renderCourseRow)}
      </div>

      <Dialog open={editChapterDialog.open} onOpenChange={(open) => setEditChapterDialog((prev) => ({ ...prev, open }))}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>تعديل الفصل</DialogTitle>
            <DialogDescription>إذا كان الفصل مرتبطاً بدورات، راجع الأثر الظاهر قبل تغيير عدد الفرص.</DialogDescription>
          </DialogHeader>
          {editChapterDialog.row ? (
            <div className="rounded-xl border bg-muted/25 p-3 text-xs text-muted-foreground">
              مرتبط بـ {editChapterDialog.row.counts.linkedCourses} دورة · مفعل بـ {editChapterDialog.row.counts.activeLinks} · سجلات فرص {editChapterDialog.row.counts.opportunityLogs}
            </div>
          ) : null}
          <div className="space-y-3">
            <div className="space-y-2">
              <Label>اسم الفصل</Label>
              <Input value={editChapterDialog.chName} onChange={(event) => setEditChapterDialog((prev) => ({ ...prev, chName: event.target.value }))} />
            </div>
            <div className="space-y-2">
              <Label>عدد الفرص</Label>
              <Input type="number" min={0} value={editChapterDialog.opps} onChange={(event) => setEditChapterDialog((prev) => ({ ...prev, opps: Math.max(0, Number(toLatinDigits(event.target.value)) || 0) }))} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditChapterDialog({ open: false, id: "", chName: "", opps: 0, row: null })}>إلغاء</Button>
            <Button onClick={handleEditChapterSave} disabled={isSavingChapter}>{isSavingChapter ? "جاري الحفظ..." : "حفظ بعد التحقق من الحفظ"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleteChapterDialog.open} onOpenChange={(open) => setDeleteChapterDialog((prev) => ({ ...prev, open }))}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>حذف الفصل</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteChapterDialog.row?.deleteSafety.canDelete ? "هذا الفصل لا يحمل روابط أو سجلات أثر، ويمكن حذفه بأمان." : "هذا الفصل محمي من الحذف لأن له أثراً على النظام."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {deleteChapterDialog.row ? renderBlockers(deleteChapterDialog.row.deleteSafety.blockers) : null}
          <AlertDialogFooter>
            <AlertDialogCancel>إلغاء</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteChapterConfirm} disabled={isDeletingChapter || !deleteChapterDialog.row?.deleteSafety.canDelete}>حذف</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={deleteLinkDialog.open} onOpenChange={(open) => setDeleteLinkDialog((prev) => ({ ...prev, open }))}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>حذف ربط الفصل بالدورة</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteLinkDialog.link?.deleteSafety.canDelete ? "الربط غير مفعل ولا يحمل أرشيف فرص، ويمكن حذفه بأمان." : "هذا الربط محمي من الحذف لأنه مفعل أو يحتوي أرشيف فرص."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <p className="text-sm font-bold">{deleteLinkDialog.course?.course.name} / {deleteLinkDialog.link?.chapter.name}</p>
          {deleteLinkDialog.link ? renderBlockers(deleteLinkDialog.link.deleteSafety.blockers) : null}
          <AlertDialogFooter>
            <AlertDialogCancel>إلغاء</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteLinkConfirm} disabled={isDeletingLink || !deleteLinkDialog.link?.deleteSafety.canDelete}>حذف الربط</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={actionDialog.open} onOpenChange={(open) => setActionDialog((prev) => ({ ...prev, open }))}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{actionDialog.action === "activate" ? "تفعيل فصل بأمان" : "إلغاء تفعيل الفصل"}</DialogTitle>
            <DialogDescription>
              هذا الإجراء بعد التحقق من الحفظ وسيتم داخل بيانات النظام مع أرشفة/استرجاع الفرص حسب الحالة.
            </DialogDescription>
          </DialogHeader>
          {actionCourse && actionLink ? (
            <div className="space-y-3 text-sm">
              <div className="rounded-2xl border bg-muted/25 p-3">
                <p className="font-black">{actionCourse.course.name}</p>
                <p className="text-muted-foreground">{actionLink.chapter.name} - {actionLink.chapter.opportunities} فرص</p>
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                {statCard("طلاب نشطون", actionCourse.counts.activeStudents)}
                {statCard("مفصولون", actionCourse.counts.dismissedStudents, "تحديث base فقط عند التفعيل")}
                {statCard("مؤرشفون", actionCourse.counts.archivedStudents, "لا يتأثرون")}
                {statCard("أرشيف الرابط", actionLink.archiveCount)}
              </div>
              {actionDialog.action === "activate" ? (
                <p className="rounded-xl border border-primary/20 bg-primary/5 p-3 text-xs text-muted-foreground">سيتم تعطيل أي فصل نشط آخر لنفس الدورة، ثم تفعيل هذا الفصل وتحديث فرص الطلاب النشطين من بيانات النظام.</p>
              ) : (
                <p className="rounded-xl border border-amber-500/35 bg-amber-500/10 p-3 text-xs text-amber-900 dark:text-amber-100">سيتم أرشفة فرص الطلاب غير المؤرشفين ثم تصفير فرص الدورة لأنها ستصبح بلا فصل نشط.</p>
              )}
            </div>
          ) : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setActionDialog({ open: false, link: null, course: null, action: "activate" })}>إلغاء</Button>
            <Button onClick={handleApplyChapterAction} disabled={isApplyingAction}>{isApplyingAction ? "جاري التنفيذ..." : "تنفيذ بعد معاينة الأثر"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={repairDialog} onOpenChange={setRepairDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>إصلاح شامل لفرص الطلاب المعطوبة</AlertDialogTitle>
            <AlertDialogDescription>
              سيتم إصلاح كل الطلاب النشطين والمفصولين الذين فرصهم معطوبة (0/0 أو 0/X أو X/0 أو baseOpportunities لا تساوي فرص الفصل النشط) داخل دورات لديها فصل نشط واحد. المؤرشفون لن تُعاد لهم فرص. بعد الإصلاح، يُعاد احتساب الحالة الأكاديمية لكل الطلاب.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="rounded-2xl border bg-muted/25 p-4 text-sm">
            الطلاب المرشحون للإصلاح حسب بيانات النظام: <b>{repairCount}</b>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>إلغاء</AlertDialogCancel>
            <AlertDialogAction onClick={handleFixZeroOpportunities} disabled={isFixingZeroOpp || !hasActiveChapters}>{isFixingZeroOpp ? "جاري الإصلاح..." : "إصلاح الآن"}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
