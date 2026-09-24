"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CalendarDays, CheckCheck, ClipboardList, Clock3, Loader2, RefreshCw, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { callNotesManagementApi, type ManagedCallNote } from "@/lib/call-notes-management-client";
import { emitTeacherProDataChanged } from "@/lib/teacherpro-sync";
import { toast } from "@/lib/user-toast";
import { normalizeForSearch } from "@/lib/validation";
import { contactStatusMatchesFilter, normalizeContactStatusFilter, type ContactStatusFilter } from "@/lib/call-contact-status";
import { describeTelegramHandle } from "./student-registry-helpers";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  canManage: boolean;
};

const GENERAL_NOTES = "__general__";
const noteDateFormatter = new Intl.DateTimeFormat("ar-EG", {
  day: "numeric",
  month: "long",
  year: "numeric",
  numberingSystem: "latn",
  timeZone: "Asia/Baghdad",
});
const noteTimeFormatter = new Intl.DateTimeFormat("ar-EG", {
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
  numberingSystem: "latn",
  timeZone: "Asia/Baghdad",
});

function formatNoteDate(createdAt: string) {
  const date = new Date(createdAt);
  return Number.isFinite(date.getTime()) ? noteDateFormatter.format(date) : "—";
}

function formatNoteTime(createdAt: string) {
  const date = new Date(createdAt);
  return Number.isFinite(date.getTime()) ? noteTimeFormatter.format(date) : "—";
}

function actionColor(status: string) {
  if (status === "تم الاتصال") return "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300";
  if (status === "لم يرد") return "bg-amber-500/10 text-amber-800 dark:text-amber-200";
  if (status === "الرقم خاطئ") return "bg-red-500/10 text-red-700 dark:text-red-300";
  return "bg-muted text-muted-foreground";
}

export function CallNotesManagementDialog({ open, onOpenChange, canManage }: Props) {
  const [notes, setNotes] = useState<ManagedCallNote[]>([]);
  const [search, setSearch] = useState("");
  const [courseId, setCourseId] = useState("");
  const [examId, setExamId] = useState("");
  const [actionFilter, setActionFilter] = useState<ContactStatusFilter>("all");
  const [selectedCourseName, setSelectedCourseName] = useState("");
  const [selectedExamName, setSelectedExamName] = useState("");
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const [pendingIds, setPendingIds] = useState<Set<string>>(new Set());
  const pendingRef = useRef(new Set<string>());
  const activeRequestRef = useRef<AbortController | null>(null);
  const requestSequenceRef = useRef(0);
  const mutationVersionRef = useRef(0);
  const generationRef = useRef(0);

  const refresh = useCallback(async () => {
    if (!open || pendingRef.current.size > 0) return;
    // A slow read must be allowed to finish, rather than being aborted at every
    // polling tick on a mobile connection.
    if (activeRequestRef.current && !activeRequestRef.current.signal.aborted) return;
    const controller = new AbortController();
    activeRequestRef.current = controller;
    const sequence = ++requestSequenceRef.current;
    const mutationVersion = mutationVersionRef.current;
    setLoading(true);
    try {
      const result = await callNotesManagementApi.list(controller.signal);
      if (controller.signal.aborted || sequence !== requestSequenceRef.current ||
          mutationVersion !== mutationVersionRef.current) return;
      setNotes(result.notes);
      setLoaded(true);
      setError("");
    } catch (cause) {
      if (!controller.signal.aborted && sequence === requestSequenceRef.current) {
        setError(cause instanceof Error ? cause.message : "تعذر تحميل الملاحظات. أعد المحاولة.");
      }
    } finally {
      if (activeRequestRef.current === controller) activeRequestRef.current = null;
      if (sequence === requestSequenceRef.current) setLoading(false);
    }
  }, [open]);

  useEffect(() => {
    generationRef.current += 1;
    setNotes([]);
    setLoaded(false);
    setLoading(false);
    setError("");
    setSearch("");
    setCourseId("");
    setExamId("");
    setActionFilter("all");
    if (!open) return;
    void refresh();
    // The ordinary background sync intentionally waits while dialogs are open.
    // Poll this small, read-only list directly so other users' checks reach it.
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, 5000);
    const onVisible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      generationRef.current += 1;
      requestSequenceRef.current += 1;
      activeRequestRef.current?.abort();
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, [open, refresh]);

  async function resolveNote(note: ManagedCallNote) {
    if (!canManage || pendingRef.current.has(note.id)) return;
    const generation = generationRef.current;
    pendingRef.current.add(note.id);
    setPendingIds(new Set(pendingRef.current));
    mutationVersionRef.current += 1;
    activeRequestRef.current?.abort();
    try {
      await callNotesManagementApi.resolve(note);
      if (generation === generationRef.current) {
        setNotes((current) => current.filter((item) => item.id !== note.id));
      }
      emitTeacherProDataChanged({
        source: "local-mutation",
        reason: "إنجاز ملاحظة المكالمات",
        scopes: ["follow-up", "students", "dashboard", "logs"],
        dispatchLocal: false,
      });
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "تعذر حفظ الإنجاز. أعد المحاولة.");
    } finally {
      mutationVersionRef.current += 1;
      pendingRef.current.delete(note.id);
      setPendingIds(new Set(pendingRef.current));
      // Reconcile both failed/uncertain requests and changes by another user.
      if (generation === generationRef.current) void refresh();
    }
  }

  const courses = useMemo(() => {
    const values = new Map<string, string>();
    notes.forEach((note) => {
      if (note.student.courseId) {
        values.set(note.student.courseId, note.student.course?.name || "دورة غير مسماة");
      }
    });
    return [...values].sort((left, right) => left[1].localeCompare(right[1], "ar"));
  }, [notes]);

  const courseNotes = useMemo(
    () => notes.filter((note) => !courseId || note.student.courseId === courseId),
    [notes, courseId],
  );
  const exams = useMemo(() => {
    const values = new Map<string, string>();
    courseNotes.forEach((note) => {
      if (note.examId) values.set(note.examId, note.exam?.name || "امتحان غير مسمى");
    });
    return [...values].sort((left, right) => left[1].localeCompare(right[1], "ar"));
  }, [courseNotes]);
  const hasGeneralNotes = courseNotes.some((note) => !note.examId);
  const hasFilters = Boolean(search.trim() || courseId || examId || actionFilter !== "all");
  const totalCount = notes.filter((note) => !pendingIds.has(note.id)).length;
  const visibleNotes = useMemo(() => {
    const query = normalizeForSearch(search);
    return courseNotes.filter((note) => {
      if (pendingIds.has(note.id)) return false;
      if (examId === GENERAL_NOTES && note.examId) return false;
      if (examId && examId !== GENERAL_NOTES && note.examId !== examId) return false;
      if (!contactStatusMatchesFilter(actionFilter, note.contactStatus)) return false;
      return !query || normalizeForSearch(
        `${note.student.name} ${note.student.code} ${note.student.telegram || ""} ${note.student.username || ""} ${note.notes}`,
      ).includes(query);
    });
  }, [courseNotes, examId, actionFilter, search, pendingIds]);

  function clearFilters() {
    setSearch("");
    setCourseId("");
    setExamId("");
    setActionFilter("all");
  }

  function selectCourse(value: string) {
    setCourseId(value);
    setSelectedCourseName(courses.find(([id]) => id === value)?.[1] || "الدورة المحددة");
    // Keep a compatible exam selection when a course is changed, including
    // general notes. Polling never changes the filters the user is working in.
    if (examId && !notes.some((note) =>
      (!value || note.student.courseId === value) &&
      (examId === GENERAL_NOTES ? !note.examId : note.examId === examId),
    )) setExamId("");
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-w-5xl flex-col gap-3 overflow-hidden p-3 sm:p-5 [@media(max-height:540px)]:overflow-y-auto" dir="rtl">
        <DialogHeader className="shrink-0">
          <DialogTitle className="flex items-center gap-2">
            <ClipboardList className="size-5 shrink-0 text-primary" aria-hidden="true" />
            إدارة ملاحظات المكالمات
          </DialogTitle>
        </DialogHeader>

        <div className="grid shrink-0 grid-cols-2 gap-2 rounded-2xl border bg-muted/25 p-3 md:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1.3fr)_minmax(0,1fr)]">
          <label className="col-span-2 min-w-0 space-y-1.5 md:col-span-1">
            <span className="text-xs font-semibold">بحث</span>
            <div className="relative">
              <Search className="pointer-events-none absolute right-3 top-3.5 size-4 text-muted-foreground" aria-hidden="true" />
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                aria-label="بحث في ملاحظات المكالمات"
                placeholder="الاسم، الكود، تيليجرام أو الملاحظة"
                className="pr-9"
              />
            </div>
          </label>
          <label className="min-w-0 space-y-1.5">
            <span className="text-xs font-semibold">الدورة</span>
            <select
              aria-label="تصفية حسب الدورة"
              value={courseId}
              onChange={(event) => selectCourse(event.target.value)}
              className="h-11 w-full min-w-0 truncate rounded-xl border border-input bg-background px-2 text-base outline-none focus-visible:ring-2 focus-visible:ring-ring md:text-sm"
            >
              <option value="">كل الدورات</option>
              {courseId && !courses.some(([id]) => id === courseId) && <option value={courseId}>{selectedCourseName}</option>}
              {courses.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
            </select>
          </label>
          <label className="min-w-0 space-y-1.5">
            <span className="text-xs font-semibold">الامتحان</span>
            <select
              aria-label="تصفية حسب الامتحان"
              value={examId}
              onChange={(event) => {
                const value = event.target.value;
                setExamId(value);
                setSelectedExamName(exams.find(([id]) => id === value)?.[1] || "الامتحان المحدد");
              }}
              className="h-11 w-full min-w-0 truncate rounded-xl border border-input bg-background px-2 text-base outline-none focus-visible:ring-2 focus-visible:ring-ring md:text-sm"
            >
              <option value="">كل الامتحانات والملاحظات العامة</option>
              {(hasGeneralNotes || examId === GENERAL_NOTES) && <option value={GENERAL_NOTES}>الملاحظات العامة</option>}
              {examId && examId !== GENERAL_NOTES && !exams.some(([id]) => id === examId) && <option value={examId}>{selectedExamName}</option>}
              {exams.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
            </select>
          </label>
          <label className="col-span-2 min-w-0 space-y-1.5 md:col-span-1">
            <span className="text-xs font-semibold">الإجراء</span>
            <select
              aria-label="تصفية حسب الإجراء"
              value={actionFilter}
              onChange={(event) => setActionFilter(normalizeContactStatusFilter(event.target.value))}
              className="h-11 w-full min-w-0 truncate rounded-xl border border-input bg-background px-2 text-base outline-none focus-visible:ring-2 focus-visible:ring-ring md:text-sm"
            >
              <option value="all">كل الإجراءات</option>
              <option value="no-action">بدون إجراء</option>
              <option value="contacted">تم الاتصال</option>
              <option value="unanswered">لم يرد</option>
              <option value="wrong">الرقم خاطئ</option>
            </select>
          </label>
        </div>

        <div className="flex shrink-0 flex-wrap items-center justify-between gap-2">
          <span className="text-sm font-semibold" aria-live="polite">
            {loaded ? `المعروض ${visibleNotes.length} من ${totalCount} ملاحظة` : "الملاحظات"}
          </span>
          <div className="flex items-center gap-1.5">
            {hasFilters && (
              <Button type="button" variant="ghost" size="sm" onClick={clearFilters}>
                <X className="size-4" aria-hidden="true" />
                مسح الفلاتر
              </Button>
            )}
            <Button type="button" variant="outline" size="sm" disabled={loading || pendingIds.size > 0} onClick={() => void refresh()}>
              <RefreshCw className={`size-4 ${loading ? "animate-spin" : ""}`} aria-hidden="true" />
              تحديث
            </Button>
          </div>
        </div>

        {error && <p role="alert" className="shrink-0 rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{error}</p>}

        <div className="min-h-0 overflow-y-auto overscroll-contain [@media(max-height:540px)]:shrink-0 [@media(max-height:540px)]:overflow-visible">
        {!loaded && loading ? (
          <div className="flex min-h-40 items-center justify-center gap-2 text-sm text-muted-foreground" role="status">
            <Loader2 className="size-5 animate-spin" aria-hidden="true" />
            جاري تحميل الملاحظات...
          </div>
        ) : loaded && visibleNotes.length === 0 ? (
          <div className="flex min-h-40 flex-col items-center justify-center gap-3 rounded-2xl border border-dashed p-5 text-center">
            <CheckCheck className="size-9 text-emerald-600" aria-hidden="true" />
            <p className="text-sm font-semibold">{pendingIds.size > 0 ? "جاري حفظ الإنجاز..." : hasFilters ? "لا توجد ملاحظات تطابق البحث والفلاتر" : "لا توجد ملاحظات معلّقة"}</p>
          </div>
        ) : (
          <div className="space-y-2">
            <div aria-hidden="true" className="hidden grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)_minmax(0,2fr)_3rem] gap-3 rounded-xl bg-muted/60 px-4 py-2 text-xs font-semibold text-muted-foreground md:grid">
              <span>الطالب</span><span>الإجراء</span><span>الملاحظة</span><span className="text-center">تم</span>
            </div>
            {visibleNotes.map((note) => {
              const telegram = describeTelegramHandle(note.student);
              return (
              <article key={note.id} className="grid min-w-0 grid-cols-[minmax(0,1fr)_2.75rem] gap-x-2 gap-y-3 rounded-2xl border bg-background/80 p-3 md:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)_minmax(0,2fr)_3rem] md:items-start md:gap-3 md:p-4">
                <div className="min-w-0">
                  <p className="break-words text-sm font-bold leading-6">{note.student.name}</p>
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                    <span dir="ltr">{note.student.code}</span>
                    {note.student.course && <span>{note.student.course.name}</span>}
                  </div>
                  <div className="mt-2 min-w-0 text-xs leading-5">
                    <span className="text-muted-foreground">تيليجرام: </span>
                    {telegram.href ? (
                      <a href={telegram.href} dir="ltr" className="inline-block max-w-full break-all font-medium text-primary underline-offset-4 hover:underline" aria-label={`فتح تيليجرام ${note.student.name}`}>
                        @{telegram.value}
                      </a>
                    ) : telegram.value ? (
                      <span dir="ltr" className="inline-block max-w-full break-all font-mono">{telegram.value}</span>
                    ) : <span className="text-muted-foreground">غير متوفر</span>}
                  </div>
                </div>
                <div className="col-start-1 row-start-2 md:col-start-2 md:row-start-1">
                  <span className={`inline-flex max-w-full rounded-lg px-2 py-1 text-xs font-semibold ${actionColor(note.contactStatus)}`}>
                    {note.contactStatus || "بدون إجراء"}
                  </span>
                  {note.scope === "general" && note.contactExam && (
                    <p className="mt-1 break-words text-[11px] leading-5 text-muted-foreground">آخر إجراء: {note.contactExam.name}</p>
                  )}
                </div>
                <div className="col-span-2 min-w-0 md:col-span-1 md:col-start-3 md:row-start-1">
                  <p className="mb-1 text-[11px] font-medium text-muted-foreground">
                    {note.scope === "general" ? "ملاحظة عامة" : note.exam?.name || "امتحان غير مسمى"}
                  </p>
                  <p className="whitespace-pre-wrap break-words text-sm leading-7 [overflow-wrap:anywhere]">{note.notes}</p>
                  <div className="mt-3 flex w-fit max-w-full flex-wrap items-center gap-2 rounded-xl border border-primary/20 bg-primary/5 p-2 text-primary dark:bg-primary/10">
                    <div className="flex min-w-0 items-center gap-2 px-1">
                      <CalendarDays aria-hidden="true" className="h-4 w-4 shrink-0" />
                      <div className="min-w-0">
                        <p className="text-[10px] font-medium leading-4 text-muted-foreground">تاريخ الملاحظة</p>
                        <time dateTime={note.createdAt} className="block text-xs font-semibold leading-5">{formatNoteDate(note.createdAt)}</time>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 rounded-lg border border-primary/10 bg-background/80 px-2.5 py-1 shadow-sm">
                      <Clock3 aria-hidden="true" className="h-4 w-4 shrink-0" />
                      <div>
                        <time dateTime={note.createdAt} className="block whitespace-nowrap text-sm font-bold leading-5 tabular-nums">{formatNoteTime(note.createdAt)}</time>
                        <p className="whitespace-nowrap text-[10px] font-medium leading-4 text-muted-foreground">بتوقيت بغداد</p>
                      </div>
                    </div>
                  </div>
                </div>
                <label className="col-start-2 row-start-1 flex min-h-11 cursor-pointer flex-col items-center justify-center gap-1 rounded-lg hover:bg-primary/5 md:col-start-4">
                  <Checkbox
                    checked={false}
                    disabled={!canManage}
                    onCheckedChange={(checked) => { if (checked === true) void resolveNote(note); }}
                    aria-label={`إنجاز ملاحظة ${note.student.name}: ${note.notes}`}
                    className="size-6 border-primary/50"
                  />
                  <span className="text-[10px] text-muted-foreground md:hidden">تم</span>
                </label>
              </article>
              );
            })}
          </div>
        )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
