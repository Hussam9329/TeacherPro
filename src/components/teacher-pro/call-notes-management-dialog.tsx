"use client";

import { toBaghdadDateTimeLocal } from "@/lib/baghdad-time";
import { formatAppDate, formatAppTime } from "@/lib/format";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Archive, Check, CheckCheck, ClipboardList, RefreshCw, RotateCcw, Search, Send, SlidersHorizontal, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { callNotesManagementApi, type CallNotesView, type ManagedCallNote } from "@/lib/call-notes-management-client";
import { emitTeacherProDataChanged } from "@/lib/teacherpro-sync";
import { toast } from "@/lib/user-toast";
import { normalizeForSearch } from "@/lib/validation";
import { contactStatusMatchesFilter, normalizeContactStatusFilter, type ContactStatusFilter } from "@/lib/call-contact-status";
import { GUARDIAN_NUMBER_NOT_WORKING_MESSAGE, telegramChatWithMessage } from "@/lib/call-note-telegram";
import { copyText } from "@/lib/code-closure-contact";
import { describeTelegramHandle } from "./student-registry-helpers";
import { EmptyState, LoadingState } from "./ui-kit";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  canManage: boolean;
};

const GENERAL_NOTES = "__general__";
function formatNoteDate(createdAt: string) {
  const local = toBaghdadDateTimeLocal(createdAt);
  return local ? formatAppDate(local.slice(0, 10)) : "—";
}

function formatNoteTime(createdAt: string) {
  const local = toBaghdadDateTimeLocal(createdAt);
  return local ? formatAppTime(local.slice(11, 16)) : "—";
}

/** Signal tone of a contact status: reached = green, no answer = amber, wrong number = red. */
function actionTone(status: string): "success" | "warning" | "danger" | "muted" {
  if (status === "تم الاتصال") return "success";
  if (status === "لم يرد") return "warning";
  if (status === "الرقم خاطئ") return "danger";
  return "muted";
}

const ACTION_FILTERS: Array<{ key: ContactStatusFilter; label: string; tone?: "success" | "warning" | "danger" | "muted" }> = [
  { key: "all", label: "الكل" },
  { key: "no-action", label: "بدون إجراء", tone: "muted" },
  { key: "unanswered", label: "لم يرد", tone: "warning" },
  { key: "contacted", label: "تم الاتصال", tone: "success" },
  { key: "wrong", label: "الرقم خاطئ", tone: "danger" },
];

function noteTime(createdAt: string) {
  const time = Date.parse(createdAt);
  return Number.isFinite(time) ? time : 0;
}

/** «الأرشيف» lists the latest completed first; «المعلّقة» the newest note. */
function sortTime(note: ManagedCallNote, view: CallNotesView) {
  return noteTime(view === "archive" ? note.resolvedAt || note.createdAt : note.createdAt);
}

const VIEWS: Array<{ key: CallNotesView; label: string }> = [
  { key: "pending", label: "المعلّقة" },
  { key: "archive", label: "الأرشيف (المنجزة)" },
];

export function CallNotesManagementDialog({ open, onOpenChange, canManage }: Props) {
  const [notes, setNotes] = useState<ManagedCallNote[]>([]);
  // Completed notes never disappear: they move to «الأرشيف».
  const [view, setView] = useState<CallNotesView>("pending");
  const viewRef = useRef<CallNotesView>("pending");
  const [search, setSearch] = useState("");
  const [courseId, setCourseId] = useState("");
  const [examId, setExamId] = useState("");
  const [actionFilter, setActionFilter] = useState<ContactStatusFilter>("all");
  const [selectedCourseName, setSelectedCourseName] = useState("");
  const [selectedExamName, setSelectedExamName] = useState("");
  const [filtersOpen, setFiltersOpen] = useState(false);
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
    const requestView = viewRef.current;
    setLoading(true);
    try {
      const result = await callNotesManagementApi.list(controller.signal, requestView);
      if (controller.signal.aborted || sequence !== requestSequenceRef.current ||
          mutationVersion !== mutationVersionRef.current || requestView !== viewRef.current) return;
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
    setFiltersOpen(false);
    viewRef.current = "pending";
    setView("pending");
    if (!open) return;
    void refresh();
    // The ordinary background sync intentionally waits while dialogs are open.
    // Poll this small, read-only list directly so other users' checks reach it;
    // the archive reloads when it is opened, on focus and with «تحديث».
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible" && viewRef.current === "pending") void refresh();
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
      toast.success(`أُنجزت ملاحظة «${note.student.name}» وانتقلت إلى الأرشيف`, {
        action: { label: "تراجع", onClick: () => void reopenNote(note) },
      });
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

  // «إرجاع» in the archive: the note goes back to «المعلّقة».
  async function returnNote(note: ManagedCallNote) {
    if (!canManage || pendingRef.current.has(note.id)) return;
    const generation = generationRef.current;
    pendingRef.current.add(note.id);
    setPendingIds(new Set(pendingRef.current));
    mutationVersionRef.current += 1;
    activeRequestRef.current?.abort();
    try {
      await callNotesManagementApi.reopen(note);
      if (generation === generationRef.current) {
        setNotes((current) => current.filter((item) => item.id !== note.id));
      }
      toast.success(`رجعت ملاحظة «${note.student.name}» إلى المعلّقة`);
      emitTeacherProDataChanged({
        source: "local-mutation",
        reason: "إعادة فتح ملاحظة المكالمات",
        scopes: ["follow-up", "students", "dashboard", "logs"],
        dispatchLocal: false,
      });
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "تعذر إرجاع الملاحظة. أعد المحاولة.");
    } finally {
      mutationVersionRef.current += 1;
      pendingRef.current.delete(note.id);
      setPendingIds(new Set(pendingRef.current));
      if (generation === generationRef.current) void refresh();
    }
  }

  function switchView(next: CallNotesView) {
    if (next === viewRef.current || pendingRef.current.size > 0) return;
    viewRef.current = next;
    setView(next);
    requestSequenceRef.current += 1;
    activeRequestRef.current?.abort();
    activeRequestRef.current = null;
    setNotes([]);
    setLoaded(false);
    setError("");
    setActionFilter("all");
    void refresh();
  }

  async function reopenNote(note: ManagedCallNote) {
    if (!canManage) return;
    const generation = generationRef.current;
    mutationVersionRef.current += 1;
    activeRequestRef.current?.abort();
    try {
      await callNotesManagementApi.reopen(note);
      emitTeacherProDataChanged({
        source: "local-mutation",
        reason: "إعادة فتح ملاحظة المكالمات",
        scopes: ["follow-up", "students", "dashboard", "logs"],
        dispatchLocal: false,
      });
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "تعذر التراجع. أعد المحاولة.");
    } finally {
      mutationVersionRef.current += 1;
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
  const panelFilterCount = Number(Boolean(courseId)) + Number(Boolean(examId));
  const totalCount = notes.filter((note) => !pendingIds.has(note.id)).length;
  // Everything but the action: the action buttons count inside this set.
  const actionBase = useMemo(() => {
    const query = normalizeForSearch(search.replace(/^\s*@+/, "")); // «@ali» finds the username «ali»
    return courseNotes.filter((note) => {
      if (pendingIds.has(note.id)) return false;
      if (examId === GENERAL_NOTES && note.examId) return false;
      if (examId && examId !== GENERAL_NOTES && note.examId !== examId) return false;
      return !query || normalizeForSearch(
        `${note.student.name} ${note.student.code} ${note.student.username || ""} ${note.notes}`,
      ).includes(query);
    });
  }, [courseNotes, examId, search, pendingIds]);
  const visibleNotes = useMemo(
    () => actionBase.filter((note) => contactStatusMatchesFilter(actionFilter, note.contactStatus)),
    [actionBase, actionFilter],
  );
  // One card per student, newest note first; students with the newest notes first.
  const studentGroups = useMemo(() => {
    const byStudent = new Map<string, ManagedCallNote[]>();
    for (const note of visibleNotes) {
      const group = byStudent.get(note.studentId) || [];
      group.push(note);
      byStudent.set(note.studentId, group);
    }
    return [...byStudent.values()]
      .map((group) => group.slice().sort((left, right) => sortTime(right, view) - sortTime(left, view)))
      .sort((left, right) => sortTime(right[0], view) - sortTime(left[0], view));
  }, [visibleNotes, view]);

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

  // The link opens the chat with the message already typed in; it is also
  // copied in the click itself (before the Telegram app takes the focus the
  // clipboard needs) in case an old Telegram app leaves the box empty.
  function copyGuardianMessage(name: string, link: Element) {
    void copyText(GUARDIAN_NUMBER_NOT_WORKING_MESSAGE, link).then((copied) => {
      if (copied) toast.success(`انفتحت محادثة ${name} والرسالة مكتوبة بيها — اضغط إرسال. إذا ما طلعت، هي منسوخة: الصقها.`);
      else toast.success(`انفتحت محادثة ${name} والرسالة مكتوبة بيها — اضغط إرسال.`);
    });
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
          <div role="group" aria-label="المعلّقة أو الأرشيف" className="tp-modal__chips tp-notes__views">
            {VIEWS.map((option) => (
              <button
                key={option.key}
                type="button"
                className="tp-modal__filter"
                data-notes-view={option.key}
                aria-pressed={view === option.key}
                disabled={pendingIds.size > 0}
                onClick={() => switchView(option.key)}
              >
                {option.key === "archive" ? <Archive className="size-4" aria-hidden="true" /> : <ClipboardList className="size-4" aria-hidden="true" />}
                <span className="tp-modal__filter-label">{option.label}</span>
              </button>
            ))}
          </div>

          <div className="tp-modal__searchbar">
            <div className="tp-modal__input-wrap tp-modal__search">
              <Search aria-hidden="true" />
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                aria-label="بحث في ملاحظات المكالمات"
                placeholder="ابحث بالاسم أو الكود أو التيليجرام أو نص الملاحظة"
              />
            </div>
            <Button
              type="button"
              variant="outline"
              className="tp-modal__filter-toggle"
              aria-expanded={filtersOpen}
              onClick={() => setFiltersOpen((value) => !value)}
            >
              <SlidersHorizontal className="size-4" aria-hidden="true" />
              تصفية
              {panelFilterCount > 0 && <span className="tp-modal__filter-badge">{panelFilterCount}</span>}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="icon"
              aria-label="تحديث الملاحظات"
              title="تحديث"
              disabled={loading || pendingIds.size > 0}
              onClick={() => void refresh()}
            >
              <RefreshCw className={`size-4 ${loading ? "animate-spin motion-reduce:animate-none" : ""}`} aria-hidden="true" />
            </Button>
          </div>

          {filtersOpen && (
            <div className="tp-modal__fields tp-modal__panel">
              <label className="tp-modal__field">
                <span>اسم الدورة</span>
                <div className="tp-modal__select-wrap" data-plain="true">
                  <select
                    aria-label="تصفية حسب اسم الدورة"
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
            </div>
          )}

          <div role="group" aria-label="تصفية حسب الإجراء" className="tp-modal__chips">
            {ACTION_FILTERS.map((option) => (
              <button
                key={option.key}
                type="button"
                className="tp-modal__filter"
                data-action-filter={option.key}
                data-tone={option.tone}
                aria-pressed={actionFilter === option.key}
                onClick={() => setActionFilter(normalizeContactStatusFilter(option.key))}
              >
                {option.tone && <span className="tp-modal__filter-dot" aria-hidden="true" />}
                <span className="tp-modal__filter-label">{option.label}</span>
                <span className="tp-modal__filter-count">
                  {loaded ? actionBase.filter((note) => contactStatusMatchesFilter(option.key, note.contactStatus)).length : "…"}
                </span>
              </button>
            ))}
          </div>

          <div className="tp-modal__toolbar">
            <span className="tp-modal__count" aria-live="polite">
              {loaded ? `المعروض ${visibleNotes.length} من ${totalCount} ${view === "archive" ? "ملاحظة منجزة" : "ملاحظة"}` : "الملاحظات"}
              {loaded && (view === "archive" ? " · آخر المنجزة أولاً · الأوقات بتوقيت بغداد" : " · الأحدث أولاً · الأوقات بتوقيت بغداد")}
            </span>
            {hasFilters && (
              <div className="tp-modal__tools">
                <Button type="button" variant="ghost" size="sm" onClick={clearFilters}>
                  <X className="size-4" aria-hidden="true" />
                  مسح الفلاتر
                </Button>
              </div>
            )}
          </div>

          {error && <p role="alert" className="tp-modal__error">{error}</p>}

          <section className="tp-modal__section" aria-label="الملاحظات">
            {!loaded && loading ? (
              <LoadingState title="جاري تحميل الملاحظات..." />
            ) : loaded && visibleNotes.length === 0 ? (
              <EmptyState
                icon={CheckCheck}
                title={pendingIds.size > 0
                  ? "جاري الحفظ..."
                  : hasFilters
                    ? "لا توجد ملاحظات تطابق البحث والفلاتر"
                    : view === "archive" ? "الأرشيف فارغ: ما أكو ملاحظات منجزة" : "لا توجد ملاحظات معلّقة"}
              />
            ) : (
              <ul className="tp-notes__cards">
                {studentGroups.map((group) => {
                  const student = group[0].student;
                  const telegram = describeTelegramHandle(student);
                  const tone = actionTone(group[0].contactStatus);
                  return (
                    <li key={student.id} className="tp-notes__card" data-tone={tone}>
                      <div className="tp-notes__head">
                        <span className="tp-modal__light" data-tone={tone} aria-hidden="true" />
                        <span className="tp-notes__name">{student.name}</span>
                        <span className="tp-notes__sep" aria-hidden="true" />
                        <span dir="ltr" className="tp-modal__code">{student.code}</span>
                        {student.course && <span className="tp-modal__chip">{student.course.name}</span>}
                        {group.length > 1 && (
                          <span className="tp-modal__chip" data-tone="outline">
                            {group.length === 2 ? "ملاحظتان" : `${group.length} ملاحظات`}
                          </span>
                        )}
                        {telegram.href ? (
                          <a
                            href={telegramChatWithMessage(telegram.href)}
                            dir="ltr"
                            className="tp-modal__tg tp-notes__tg"
                            onClick={(event) => copyGuardianMessage(student.name, event.currentTarget)}
                            aria-label={`فتح محادثة ${student.name} في تيليجرام ورسالة رقم ولي الأمر مكتوبة بيها`}
                            title="يفتح المحادثة ورسالة «رقم ولي الأمر ما يشتغل» مكتوبة بيها — اضغط إرسال"
                          >
                            <Send className="size-3.5" aria-hidden="true" />
                            @{telegram.value}
                          </a>
                        ) : telegram.value ? (
                          <span dir="ltr" className="tp-modal__tg tp-notes__tg" data-plain="true">{telegram.value}</span>
                        ) : null}
                      </div>
                      <ol className="tp-notes__items">
                        {group.map((note) => {
                          const noteTone = actionTone(note.contactStatus);
                          return (
                            <li key={note.id} className="tp-notes__item" data-tone={noteTone}>
                              <div className="tp-notes__item-top">
                                <span className="tp-modal__chip" data-tone={noteTone}>{note.contactStatus || "بدون إجراء"}</span>
                                <span className="tp-notes__scope">
                                  {note.scope === "general" ? "ملاحظة عامة" : note.exam?.name || "امتحان غير مسمى"}
                                </span>
                                <span className="tp-notes__when">
                                  <time dateTime={note.createdAt}>{formatNoteDate(note.createdAt)}</time>
                                  {" · "}
                                  <time dateTime={note.createdAt}>{formatNoteTime(note.createdAt)}</time>
                                </span>
                                {canManage && view === "pending" && (
                                  <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    className="tp-notes__done"
                                    data-note-done="true"
                                    disabled={pendingIds.has(note.id)}
                                    onClick={() => void resolveNote(note)}
                                    aria-label={`إنجاز ملاحظة ${student.name}: ${note.notes}`}
                                  >
                                    <Check className="size-4" aria-hidden="true" />
                                    إنجاز
                                  </Button>
                                )}
                                {canManage && view === "archive" && (
                                  <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    className="tp-notes__done"
                                    data-note-return="true"
                                    disabled={pendingIds.has(note.id)}
                                    onClick={() => void returnNote(note)}
                                    aria-label={`إرجاع ملاحظة ${student.name} إلى المعلّقة: ${note.notes}`}
                                  >
                                    <RotateCcw className="size-4" aria-hidden="true" />
                                    إرجاع
                                  </Button>
                                )}
                              </div>
                              <p className="tp-notes__text">{note.notes}</p>
                              {view === "archive" && (
                                <p className="tp-notes__resolved">
                                  <CheckCheck className="size-3.5" aria-hidden="true" />
                                  {note.resolvedAt
                                    ? `أُنجزت ${formatNoteDate(note.resolvedAt)} · ${formatNoteTime(note.resolvedAt)}${note.resolvedBy ? ` · بواسطة ${note.resolvedBy}` : ""}`
                                    : "منجزة"}
                                </p>
                              )}
                              {note.scope === "general" && note.contactExam && (
                                <p className="tp-notes__last">آخر إجراء: {note.contactExam.name}</p>
                              )}
                            </li>
                          );
                        })}
                      </ol>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </div>
      </DialogContent>
    </Dialog>
  );
}
