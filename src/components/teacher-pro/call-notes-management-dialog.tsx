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

/** Signal tone of a contact status: reached = green, no answer = amber, wrong number = red. */
function actionTone(status: string): "success" | "warning" | "danger" | "muted" {
  if (status === "تم الاتصال") return "success";
  if (status === "لم يرد") return "warning";
  if (status === "الرقم خاطئ") return "danger";
  return "muted";
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
      <DialogContent className="tp-modal tp-notes" dir="rtl">
        <div className="tp-modal__hero">
          <span className="tp-modal__hero-icon" aria-hidden="true"><ClipboardList /></span>
          <DialogHeader className="tp-modal__heading">
            <DialogTitle>إدارة ملاحظات المكالمات</DialogTitle>
          </DialogHeader>
        </div>

        <div className="tp-modal__body">
          <div className="tp-modal__controls">
            <div className="tp-modal__fields">
              <label className="tp-modal__field">
                <span>بحث</span>
                <div className="tp-modal__input-wrap">
                  <Search aria-hidden="true" />
                  <Input
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    aria-label="بحث في ملاحظات المكالمات"
                    placeholder="الاسم، الكود، تيليجرام أو الملاحظة"
                  />
                </div>
              </label>
              <label className="tp-modal__field">
                <span>الدورة</span>
                <div className="tp-modal__select-wrap" data-plain="true">
                  <select
                    aria-label="تصفية حسب الدورة"
                    value={courseId}
                    onChange={(event) => selectCourse(event.target.value)}
                  >
                    <option value="">كل الدورات</option>
                    {courseId && !courses.some(([id]) => id === courseId) && <option value={courseId}>{selectedCourseName}</option>}
                    {courses.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
                  </select>
                </div>
              </label>
              <label className="tp-modal__field">
                <span>الامتحان</span>
                <div className="tp-modal__select-wrap" data-plain="true">
                  <select
                    aria-label="تصفية حسب الامتحان"
                    value={examId}
                    onChange={(event) => {
                      const value = event.target.value;
                      setExamId(value);
                      setSelectedExamName(exams.find(([id]) => id === value)?.[1] || "الامتحان المحدد");
                    }}
                  >
                    <option value="">كل الامتحانات والملاحظات العامة</option>
                    {(hasGeneralNotes || examId === GENERAL_NOTES) && <option value={GENERAL_NOTES}>الملاحظات العامة</option>}
                    {examId && examId !== GENERAL_NOTES && !exams.some(([id]) => id === examId) && <option value={examId}>{selectedExamName}</option>}
                    {exams.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
                  </select>
                </div>
              </label>
              <label className="tp-modal__field">
                <span>الإجراء</span>
                <div className="tp-modal__select-wrap" data-plain="true">
                  <select
                    aria-label="تصفية حسب الإجراء"
                    value={actionFilter}
                    onChange={(event) => setActionFilter(normalizeContactStatusFilter(event.target.value))}
                  >
                    <option value="all">كل الإجراءات</option>
                    <option value="no-action">بدون إجراء</option>
                    <option value="contacted">تم الاتصال</option>
                    <option value="unanswered">لم يرد</option>
                    <option value="wrong">الرقم خاطئ</option>
                  </select>
                </div>
              </label>
            </div>
          </div>

          <div className="tp-modal__toolbar">
            <span className="tp-modal__count" aria-live="polite">
              {loaded ? `المعروض ${visibleNotes.length} من ${totalCount} ملاحظة` : "الملاحظات"}
            </span>
            <div className="tp-modal__tools">
              {hasFilters && (
                <Button type="button" variant="ghost" size="sm" onClick={clearFilters}>
                  <X className="size-4" aria-hidden="true" />
                  مسح الفلاتر
                </Button>
              )}
              <Button type="button" variant="outline" size="sm" disabled={loading || pendingIds.size > 0} onClick={() => void refresh()}>
                <RefreshCw className={`size-4 ${loading ? "animate-spin motion-reduce:animate-none" : ""}`} aria-hidden="true" />
                تحديث
              </Button>
            </div>
          </div>

          {error && <p role="alert" className="tp-modal__error">{error}</p>}

          <section className="tp-modal__section" aria-label="الملاحظات">
            {!loaded && loading ? (
              <div className="tp-modal__empty" role="status">
                <span className="tp-modal__empty-icon"><Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden="true" /></span>
                <p>جاري تحميل الملاحظات...</p>
              </div>
            ) : loaded && visibleNotes.length === 0 ? (
              <div className="tp-modal__empty">
                <span className="tp-modal__empty-icon"><CheckCheck aria-hidden="true" /></span>
                <p>{pendingIds.size > 0 ? "جاري حفظ الإنجاز..." : hasFilters ? "لا توجد ملاحظات تطابق البحث والفلاتر" : "لا توجد ملاحظات معلّقة"}</p>
              </div>
            ) : (
              <div className="tp-modal__cards" data-columns="1">
                <div aria-hidden="true" className="tp-notes__headings">
                  <span>الطالب</span><span>الإجراء</span><span>الملاحظة</span><span>تم</span>
                </div>
                {visibleNotes.map((note) => {
                  const telegram = describeTelegramHandle(note.student);
                  const tone = actionTone(note.contactStatus);
                  return (
                    <article key={note.id} className="tp-notes__row" data-tone={tone}>
                      <div className="tp-modal__identity tp-notes__student">
                        <p className="tp-modal__name"><span className="tp-modal__name-text">{note.student.name}</span></p>
                        <div className="tp-modal__meta">
                          <span className="tp-modal__chip" data-tone="outline"><span dir="ltr" className="tp-modal__code">{note.student.code}</span></span>
                          {note.student.course && <span className="tp-modal__meta-item">{note.student.course.name}</span>}
                        </div>
                        <div className="tp-modal__meta">
                          {telegram.href ? (
                            <a href={telegram.href} dir="ltr" className="tp-modal__tg" aria-label={`فتح تيليجرام ${note.student.name}`}>
                              @{telegram.value}
                            </a>
                          ) : telegram.value ? (
                            <span dir="ltr" className="tp-modal__tg" data-plain="true">{telegram.value}</span>
                          ) : (
                            <span className="tp-modal__tg" data-plain="true">تيليجرام غير متوفر</span>
                          )}
                        </div>
                      </div>
                      <div className="tp-notes__action">
                        <span className="tp-modal__chip" data-tone={tone}>{note.contactStatus || "بدون إجراء"}</span>
                        {note.scope === "general" && note.contactExam && (
                          <p className="tp-modal__muted">آخر إجراء: {note.contactExam.name}</p>
                        )}
                      </div>
                      <div className="tp-notes__note">
                        <p className="tp-notes__note-scope">
                          {note.scope === "general" ? "ملاحظة عامة" : note.exam?.name || "امتحان غير مسمى"}
                        </p>
                        <p className="tp-notes__note-text">{note.notes}</p>
                        <div className="tp-notes__when">
                          <span>
                            <CalendarDays aria-hidden="true" />
                            تاريخ الملاحظة <time dateTime={note.createdAt}>{formatNoteDate(note.createdAt)}</time>
                          </span>
                          <span>
                            <Clock3 aria-hidden="true" />
                            <time dateTime={note.createdAt}>{formatNoteTime(note.createdAt)}</time> بتوقيت بغداد
                          </span>
                        </div>
                      </div>
                      <label className="tp-notes__done" data-disabled={!canManage}>
                        <Checkbox
                          checked={false}
                          disabled={!canManage}
                          onCheckedChange={(checked) => { if (checked === true) void resolveNote(note); }}
                          aria-label={`إنجاز ملاحظة ${note.student.name}: ${note.notes}`}
                          className="size-6"
                        />
                        <span>تم</span>
                      </label>
                    </article>
                  );
                })}
              </div>
            )}
          </section>
        </div>
      </DialogContent>
    </Dialog>
  );
}
