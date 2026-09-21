"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CheckCheck, Loader2, LockKeyhole, RefreshCw, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { codeClosuresApi, type CodeClosureStudent } from "@/lib/code-closures-client";
import { saveDismissedCheck } from "@/lib/dismissed-check-api";
import { emitTeacherProDataChanged } from "@/lib/teacherpro-sync";
import { toast } from "@/lib/user-toast";
import { normalizeForSearch } from "@/lib/validation";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  canManage: boolean;
};

type StatusFilter = "all" | "checked" | "unchecked";

export function CodeClosuresDialog({ open, onOpenChange, canManage }: Props) {
  const [students, setStudents] = useState<CodeClosureStudent[]>([]);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("unchecked");
  const [search, setSearch] = useState("");
  const [courseId, setCourseId] = useState("");
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const [pendingIds, setPendingIds] = useState<Set<string>>(new Set());
  const selectedCourseNameRef = useRef("");
  const pendingRef = useRef(new Set<string>());
  const openRef = useRef(open);
  const generationRef = useRef(0);
  const activeRequestRef = useRef<AbortController | null>(null);
  const requestSequenceRef = useRef(0);
  const mutationVersionRef = useRef(0);
  openRef.current = open;

  const refresh = useCallback(async () => {
    if (!openRef.current || pendingRef.current.size > 0) return;
    // Keep slow mobile reads alive; a polling tick must not restart them.
    if (activeRequestRef.current && !activeRequestRef.current.signal.aborted) return;
    const controller = new AbortController();
    activeRequestRef.current = controller;
    const sequence = ++requestSequenceRef.current;
    const mutationVersion = mutationVersionRef.current;
    setLoading(true);
    try {
      const result = await codeClosuresApi.list(controller.signal);
      if (controller.signal.aborted || sequence !== requestSequenceRef.current ||
          mutationVersion !== mutationVersionRef.current || !openRef.current) return;
      setStudents(result.students.filter((student) => student.status === "مفصول"));
      setLoaded(true);
      setError("");
    } catch (cause) {
      if (!controller.signal.aborted && sequence === requestSequenceRef.current && openRef.current) {
        // An old list must not be presented as the current dismissed population.
        setStudents([]);
        setLoaded(false);
        setError(cause instanceof Error ? cause.message : "تعذر تحميل اغلاق الكودات. أعد المحاولة.");
      }
    } finally {
      if (activeRequestRef.current === controller) activeRequestRef.current = null;
      if (sequence === requestSequenceRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    openRef.current = open;
    generationRef.current += 1;
    setStudents([]);
    setLoaded(false);
    setLoading(false);
    setError("");
    setSearch("");
    setCourseId("");
    setStatusFilter("unchecked");
    if (!open) return;
    void refresh();
    // Global background refresh pauses while dialogs are open, so this small
    // complete list reads directly while the operator is working in it.
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, 5000);
    const onVisible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      openRef.current = false;
      generationRef.current += 1;
      requestSequenceRef.current += 1;
      activeRequestRef.current?.abort();
      activeRequestRef.current = null;
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, [open, refresh]);

  async function setChecked(student: CodeClosureStudent, checked: boolean) {
    if (!canManage || !loaded || pendingRef.current.has(student.id) || student.dismissedChecked === checked) return;
    const generation = generationRef.current;
    pendingRef.current.add(student.id);
    setPendingIds(new Set(pendingRef.current));
    mutationVersionRef.current += 1;
    requestSequenceRef.current += 1;
    activeRequestRef.current?.abort();
    activeRequestRef.current = null;
    setLoading(false);
    setStudents((current) => current.map((item) => item.id === student.id ? { ...item, dismissedChecked: checked } : item));
    try {
      const saved = await saveDismissedCheck(student.id, checked, student.dismissedChecked, student.dismissedCheckEpoch);
      if (generation === generationRef.current && openRef.current) {
        setStudents((current) => saved.status !== "مفصول"
          ? current.filter((item) => item.id !== student.id)
          : current.map((item) => item.id === student.id ? { ...item, ...saved } : item));
      }
      emitTeacherProDataChanged({
        source: "local-mutation",
        reason: "تحديث اغلاق كود الطالب",
        scopes: ["students", "dashboard", "logs"],
        dispatchLocal: false,
      });
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "تعذر حفظ اغلاق كود الطالب. أعد المحاولة.";
      toast.error(message);
      if (generation === generationRef.current && openRef.current) {
        // The write may have committed before a connection failed. Do not
        // restore a guessed value or replay it: reconcile from the database.
        setStudents([]);
        setLoaded(false);
        setError(message);
      }
    } finally {
      mutationVersionRef.current += 1;
      pendingRef.current.delete(student.id);
      setPendingIds(new Set(pendingRef.current));
      // Also refresh a newly reopened dialog after an older write finishes.
      // In-flight writes deliberately survive closing/reopening the dialog.
      void refresh();
    }
  }

  const courses = useMemo(() => {
    const values = new Map<string, string>();
    students.forEach((student) => {
      if (student.courseId) values.set(student.courseId, student.course?.name || "دورة غير مسماة");
    });
    return [...values].sort((left, right) => left[1].localeCompare(right[1], "ar"));
  }, [students]);

  const scopedStudents = useMemo(() => {
    const query = normalizeForSearch(search);
    return students.filter((student) => {
      if (courseId && student.courseId !== courseId) return false;
      return !query || normalizeForSearch(`${student.name} ${student.code}`).includes(query);
    });
  }, [students, courseId, search]);
  const checkedCount = scopedStudents.filter((student) => student.dismissedChecked).length;
  const counts = { all: scopedStudents.length, checked: checkedCount, unchecked: scopedStudents.length - checkedCount };
  const visibleStudents = useMemo(() => scopedStudents.filter((student) => {
    if (statusFilter === "checked") return student.dismissedChecked;
    if (statusFilter === "unchecked") return !student.dismissedChecked;
    return true;
  }), [scopedStudents, statusFilter]);
  const hasFilters = Boolean(search.trim() || courseId || statusFilter !== "unchecked");

  function clearFilters() {
    setSearch("");
    setCourseId("");
    setStatusFilter("unchecked");
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-w-5xl flex-col gap-3 overflow-hidden p-3 sm:p-5 [@media(max-height:540px)]:overflow-y-auto" dir="rtl">
        <DialogHeader className="shrink-0">
          <DialogTitle className="flex items-center gap-2">
            <LockKeyhole className="size-5 shrink-0 text-primary" aria-hidden="true" />
            اغلاق الكودات
          </DialogTitle>
        </DialogHeader>

        <div className="shrink-0 space-y-3 rounded-2xl border bg-muted/25 p-3">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
            <label className="min-w-0 space-y-1.5">
              <span className="text-xs font-semibold">بحث</span>
              <div className="relative">
                <Search className="pointer-events-none absolute right-3 top-3.5 size-4 text-muted-foreground" aria-hidden="true" />
                <Input value={search} onChange={(event) => setSearch(event.target.value)} aria-label="بحث في اغلاق الكودات" placeholder="اسم الطالب أو الكود" className="pr-9" />
              </div>
            </label>
            <label className="min-w-0 space-y-1.5">
              <span className="text-xs font-semibold">الدورة</span>
              <select
                aria-label="تصفية اغلاق الكودات حسب الدورة"
                value={courseId}
                onChange={(event) => {
                  const value = event.target.value;
                  setCourseId(value);
                  selectedCourseNameRef.current = courses.find(([id]) => id === value)?.[1] || "الدورة المحددة";
                }}
                className="h-11 w-full min-w-0 truncate rounded-xl border border-input bg-background px-2 text-base outline-none focus-visible:ring-2 focus-visible:ring-ring md:text-sm"
              >
                <option value="">كل الدورات</option>
                {courseId && !courses.some(([id]) => id === courseId) && <option value={courseId}>{selectedCourseNameRef.current}</option>}
                {courses.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
              </select>
            </label>
          </div>
          <div role="group" aria-label="حالة اغلاق الكود" className="grid grid-cols-3 gap-1.5" dir="ltr">
            {([
              ["all", "All"],
              ["checked", "Checked"],
              ["unchecked", "unChecked"],
            ] as const).map(([value, label]) => (
              <Button key={value} type="button" variant={statusFilter === value ? "default" : "outline"} size="sm" aria-pressed={statusFilter === value} onClick={() => setStatusFilter(value)} className="h-auto min-h-11 min-w-0 flex-col gap-1 px-1 py-2 text-xs sm:flex-row sm:gap-2 sm:text-sm">
                {label}
                <span className="rounded-md bg-background/15 px-1.5 tabular-nums">{loaded ? counts[value] : "—"}</span>
              </Button>
            ))}
          </div>
        </div>

        <div className="flex shrink-0 flex-wrap items-center justify-between gap-2">
          <span className="text-sm font-semibold" aria-live="polite">
            {loaded ? `المعروض ${visibleStudents.length} من ${scopedStudents.length} طالب مفصول` : "الطلاب المفصولون"}
          </span>
          <div className="flex items-center gap-1.5">
            {hasFilters && <Button type="button" variant="ghost" size="sm" onClick={clearFilters}><X className="size-4" aria-hidden="true" />مسح الفلاتر</Button>}
            <Button type="button" variant="outline" size="sm" disabled={loading || pendingIds.size > 0} onClick={() => void refresh()}>
              <RefreshCw className={`size-4 ${loading ? "animate-spin" : ""}`} aria-hidden="true" />تحديث
            </Button>
          </div>
        </div>

        {error && <p role="alert" className="shrink-0 rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{error}</p>}
        {pendingIds.size > 0 && <p role="status" className="shrink-0 text-xs text-muted-foreground">جاري حفظ اغلاق الكود...</p>}

        <div className="min-h-0 overflow-y-auto overscroll-contain [@media(max-height:540px)]:shrink-0 [@media(max-height:540px)]:overflow-visible">
          {!loaded && loading ? (
            <div className="flex min-h-40 items-center justify-center gap-2 text-sm text-muted-foreground" role="status"><Loader2 className="size-5 animate-spin" aria-hidden="true" />جاري تحميل الطلاب...</div>
          ) : loaded && visibleStudents.length === 0 ? (
            <div className="flex min-h-40 flex-col items-center justify-center gap-3 rounded-2xl border border-dashed p-5 text-center">
              <CheckCheck className="size-9 text-emerald-600" aria-hidden="true" />
              <p className="text-sm font-semibold">{pendingIds.size > 0 ? "جاري حفظ اغلاق الكود..." : search.trim() || courseId ? "لا يوجد طلاب يطابقون البحث والفلاتر" : statusFilter === "unchecked" ? "لا توجد كودات بانتظار الإغلاق" : statusFilter === "checked" ? "لا توجد كودات مغلقة" : "لا يوجد طلاب مفصولون"}</p>
            </div>
          ) : (
            <div className="space-y-2">
              {visibleStudents.length > 0 && <div aria-hidden="true" className="hidden grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1.7fr)_6rem] gap-3 rounded-xl bg-muted/60 px-4 py-2 text-xs font-semibold text-muted-foreground md:grid"><span>الطالب</span><span>الدورة</span><span>سبب الفصل</span><span className="text-center">اغلاق كود</span></div>}
              {visibleStudents.map((student) => (
                <article key={student.id} className="grid min-w-0 grid-cols-[minmax(0,1fr)_5rem] gap-x-2 gap-y-2 rounded-2xl border bg-background/80 p-3 md:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1.7fr)_6rem] md:items-start md:gap-3 md:p-4">
                  <div className="min-w-0"><p className="break-words text-sm font-bold leading-6 [overflow-wrap:anywhere]">{student.name}</p><span dir="ltr" className="select-all text-xs text-muted-foreground">{student.code}</span></div>
                  <p className="col-start-1 row-start-2 min-w-0 break-words text-xs leading-6 text-muted-foreground md:col-start-2 md:row-start-1">{student.course?.name || "—"}</p>
                  <p className="col-span-2 min-w-0 whitespace-pre-wrap break-words text-xs leading-6 text-muted-foreground [overflow-wrap:anywhere] md:col-span-1 md:col-start-3 md:row-start-1">{student.dismissalReason || "—"}</p>
                  <label className={`col-start-2 row-start-1 flex min-h-14 cursor-pointer flex-col items-center justify-center gap-1.5 rounded-xl p-1.5 md:col-start-4 ${student.dismissedChecked ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" : "bg-red-500/5 text-red-700 dark:text-red-300"}`}>
                    <Checkbox
                      checked={student.dismissedChecked}
                      disabled={!canManage || pendingIds.has(student.id)}
                      onCheckedChange={(checked) => { if (typeof checked === "boolean") void setChecked(student, checked); }}
                      aria-label={`اغلاق كود ${student.name}`}
                      className="size-6 border-red-500 data-[state=checked]:border-emerald-600 data-[state=checked]:bg-emerald-600 data-[state=checked]:text-white"
                    />
                    <span className="text-[10px] font-semibold">{student.dismissedChecked ? "الكود مغلق" : "اغلاق كود"}</span>
                  </label>
                </article>
              ))}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
