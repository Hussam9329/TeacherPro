"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { AlertCircle, BookOpen, CalendarDays, CheckCheck, ChevronDown, Loader2, LockKeyhole, LockKeyholeOpen, MessageCircle, Radiation, RefreshCw, Search, Send, SlidersHorizontal, UserMinus, UserRound, X } from "lucide-react";
import { WithdrawStudentDialog } from "./withdraw-student-dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { codeClosuresApi, type CodeClosureStudent } from "@/lib/code-closures-client";
import {
  buildDismissalNotice,
  copyText,
  mzCodeActionUrl,
  mzPlatformPhone,
  telegramNoticeHref,
  type ClosureContactStep,
  type MzCodeAction,
} from "@/lib/code-closure-contact";
import { saveDismissedCheck } from "@/lib/dismissed-check-api";
import { emitTeacherProDataChanged } from "@/lib/teacherpro-sync";
import { toast } from "@/lib/user-toast";
import { normalizeForSearch } from "@/lib/validation";
import { describeTelegramHandle } from "./student-registry-helpers";
import { StudentContactEdit } from "./student-contact-edit";
import { baghdadDateKey } from "@/lib/baghdad-time";
import { formatAppDate } from "@/lib/format";
import { DateInput } from "@/components/ui/date-input";
import { displayReasonText } from "@/lib/reason-display";
import { EmptyState, LoadingState } from "./ui-kit";
import "./tp-modal.css";
import "./code-closures-dialog.css";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  canManage: boolean;
  /** May change the student's Telegram username here (students.edit). */
  canEditContacts?: boolean;
  /** «انسحاب» on a closed code: adds «انسحاب» to the name and archives the student. */
  canWithdraw?: boolean;
};

type StatusFilter = "all" | "checked" | "unchecked";
/** Which day «من / إلى» reads: the dismissal or the code's closing. */
type DateField = "dismissal" | "closure";

const STATUS_FILTERS: Array<{ key: StatusFilter; label: string; tone?: "success" | "warning" }> = [
  { key: "all", label: "الكل" },
  { key: "unchecked", label: "بانتظار الإغلاق", tone: "warning" },
  { key: "checked", label: "مغلقة", tone: "success" },
];

export function CodeClosuresDialog({ open, onOpenChange, canManage, canEditContacts = false, canWithdraw = false }: Props) {
  const [withdrawTarget, setWithdrawTarget] = useState<{ id: string; name: string } | null>(null);
  const filterId = useId();
  const [students, setStudents] = useState<CodeClosureStudent[]>([]);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("unchecked");
  const [search, setSearch] = useState("");
  const [courseId, setCourseId] = useState("");
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const [pendingIds, setPendingIds] = useState<Set<string>>(new Set());
  const [selectedCourseName, setSelectedCourseName] = useState("");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [dateField, setDateField] = useState<DateField>("dismissal");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [expandedReasonIds, setExpandedReasonIds] = useState<Set<string>>(new Set());
  // Contact steps clicked here, shown at once while the shared mark is saved.
  const [clickedSteps, setClickedSteps] = useState<Record<string, number>>({});
  // The bot notice: the student it is being sent to now, and the ones sent from here.
  const [botSendingId, setBotSendingId] = useState("");
  const botSending = Boolean(botSendingId);
  const [botSent, setBotSent] = useState<Record<string, { epoch: number; at: string }>>({});
  const pendingRef = useRef(new Set<string>());
  const openRef = useRef(open);
  const generationRef = useRef(0);
  const activeRequestRef = useRef<AbortController | null>(null);
  const requestSequenceRef = useRef(0);
  const mutationVersionRef = useRef(0);
  // Kept current after each render (not during it) for the polling callback.
  useEffect(() => {
    openRef.current = open;
  }, [open]);

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
    setFiltersOpen(false);
    setDateField("dismissal");
    setDateFrom("");
    setDateTo("");
    setExpandedReasonIds(new Set());
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

  // «الكود مغلق» is ticked only after both steps of this dismissal: the red
  // ☢️ (closing the code on the platform) and the notice, sent by the bot or
  // through the Telegram chat link. Unticking (to undo) is always allowed.
  function readyToMarkClosed(student: CodeClosureStudent): boolean {
    return stepDone(student, "platform") && (stepDone(student, "telegram") || Boolean(botNoticeSentAt(student)));
  }

  async function setChecked(student: CodeClosureStudent, checked: boolean) {
    if (!canManage || !loaded || pendingRef.current.has(student.id) || student.dismissedChecked === checked) return;
    if (checked && !readyToMarkClosed(student)) return;
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

  function stepDone(student: CodeClosureStudent, step: ClosureContactStep): boolean {
    const saved = step === "platform" ? student.closurePlatformEpoch : student.closureTelegramEpoch;
    return saved === student.dismissedCheckEpoch || clickedSteps[`${student.id}:${step}`] === student.dismissedCheckEpoch;
  }

  // Highlights the step for everyone: it is saved for this dismissal only, so a
  // later dismissal of the same student starts unmarked again.
  function markStep(student: CodeClosureStudent, step: ClosureContactStep) {
    if (stepDone(student, step)) return;
    const key = `${student.id}:${step}`;
    const epoch = student.dismissedCheckEpoch;
    setClickedSteps((current) => ({ ...current, [key]: epoch }));
    if (!canManage) return;
    codeClosuresApi.markContact(student.id, step, epoch).then(
      () => void refresh(),
      (cause) => {
        setClickedSteps((current) => {
          const next = { ...current };
          delete next[key];
          return next;
        });
        toast.error(cause instanceof Error ? cause.message : "تعذر حفظ علامة التواصل مع الطالب.");
      },
    );
  }

  function botNoticeSentAt(student: CodeClosureStudent): string | null {
    const local = botSent[student.id];
    return student.botNoticeSentAt || (local?.epoch === student.dismissedCheckEpoch ? local.at : null);
  }

  // Sent straight from «إرسال عبر البوت» (no preview); the server refuses a second send.
  async function sendBotNotice(student: CodeClosureStudent) {
    if (botSending || !canManage) return;
    setBotSendingId(student.id);
    try {
      const { botNoticeSentAt: at } = await codeClosuresApi.sendBotNotice(student.id, student.dismissedCheckEpoch);
      setBotSent((current) => ({ ...current, [student.id]: { epoch: student.dismissedCheckEpoch, at } }));
      setClickedSteps((current) => ({ ...current, [`${student.id}:telegram`]: student.dismissedCheckEpoch }));
      toast.success(`أرسل البوت تبليغ الفصل إلى ${student.name}`);
      void refresh();
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "تعذر إرسال التبليغ عبر البوت.");
      void refresh();
    } finally {
      setBotSendingId("");
    }
  }

  // ☢️ closes the code, its green twin opens it again; only closing is a
  // contact step of the dismissal.
  function openPlatform(student: CodeClosureStudent, button: Element, action: MzCodeAction = "close") {
    const phone = mzPlatformPhone(student.phone);
    // Copy first: the new tab takes the focus the clipboard needs. The copy
    // stays for whoever has no «أداة مرماز» (Tampermonkey) to do it.
    const copying = phone ? copyText(phone, button) : Promise.resolve(false);
    window.open(mzCodeActionUrl(action, phone, student.name), "_blank", "noopener,noreferrer");
    if (action === "close") markStep(student, "platform");
    if (!phone) {
      toast.error(`ماكو رقم هاتف صالح للطالب ${student.name}؛ ابحث عنه بالاسم في المنصة.`);
      return;
    }
    void copying.then((copied) => {
      if (copied) toast.success(`نُسخ رقم الطالب ${phone}`);
      else toast.error(`تعذر النسخ تلقائياً. رقم الطالب: ${phone}`);
    });
  }

  const courses = useMemo(() => {
    const values = new Map<string, string>();
    students.forEach((student) => {
      if (student.courseId) values.set(student.courseId, student.course?.name || "دورة غير مسماة");
    });
    return [...values].sort((left, right) => left[1].localeCompare(right[1], "ar"));
  }, [students]);

  // «من / إلى» in either order; a day outside it, or no day at all, is hidden.
  const [rangeStart, rangeEnd] = dateFrom && dateTo && dateFrom > dateTo ? [dateTo, dateFrom] : [dateFrom, dateTo];
  const dateFiltered = Boolean(rangeStart || rangeEnd);
  const scopedStudents = useMemo(() => {
    const query = normalizeForSearch(search.replace(/^\s*@+/, "")); // «@ali» finds the username «ali»
    return students.filter((student) => {
      if (courseId && student.courseId !== courseId) return false;
      if (rangeStart || rangeEnd) {
        const at = dateField === "closure" ? student.codeClosedAt : student.lastDismissalAt;
        const day = at ? baghdadDateKey(at) : "";
        if (!day || (rangeStart && day < rangeStart) || (rangeEnd && day > rangeEnd)) return false;
      }
      return !query || normalizeForSearch(`${student.name} ${student.code} ${student.username || ""}`).includes(query);
    });
  }, [students, courseId, search, dateField, rangeStart, rangeEnd]);
  const checkedCount = scopedStudents.filter((student) => student.dismissedChecked).length;
  const counts = { all: scopedStudents.length, checked: checkedCount, unchecked: scopedStudents.length - checkedCount };
  const visibleStudents = useMemo(() => scopedStudents.filter((student) => {
    if (statusFilter === "checked") return student.dismissedChecked;
    if (statusFilter === "unchecked") return !student.dismissedChecked;
    return true;
  }), [scopedStudents, statusFilter]);
  const hasFilters = Boolean(search.trim() || courseId || dateFiltered || statusFilter !== "unchecked");
  const activePanelFilters = Number(Boolean(courseId)) + Number(dateFiltered);

  function clearDates() {
    setDateFrom("");
    setDateTo("");
  }

  function clearFilters() {
    setSearch("");
    setCourseId("");
    clearDates();
    setStatusFilter("unchecked");
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="tp-modal tp-closures" dir="rtl">
        <div className="tp-modal__hero">
          <span className="tp-modal__hero-icon" aria-hidden="true"><LockKeyhole /></span>
          <DialogHeader className="tp-modal__heading">
            <DialogTitle>اغلاق الكودات</DialogTitle>
          </DialogHeader>
        </div>

        <div className="tp-modal__body">
          <div className="tp-modal__searchbar">
            <div className="tp-modal__input-wrap tp-modal__search">
              <Search aria-hidden="true" />
              <Input value={search} onChange={(event) => setSearch(event.target.value)} aria-label="بحث في اغلاق الكودات" placeholder="ابحث باسم الطالب أو الكود" />
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
              {activePanelFilters > 0 && <span className="tp-modal__filter-badge">{activePanelFilters}</span>}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="icon"
              aria-label="تحديث اغلاق الكودات"
              title="تحديث"
              disabled={loading || pendingIds.size > 0}
              onClick={() => void refresh()}
            >
              <RefreshCw className={`size-4 ${loading ? "animate-spin motion-reduce:animate-none" : ""}`} aria-hidden="true" />
            </Button>
          </div>

          {filtersOpen && (
            <div className="tp-modal__fields tp-modal__panel tp-closures__filters">
              <label className="tp-modal__field">
                <span>اسم الدورة</span>
                <div className="tp-modal__select-wrap" data-plain="true">
                  <select
                    aria-label="تصفية اغلاق الكودات حسب اسم الدورة"
                    value={courseId}
                    onChange={(event) => {
                      const value = event.target.value;
                      setCourseId(value);
                      setSelectedCourseName(courses.find(([id]) => id === value)?.[1] || "الدورة المحددة");
                    }}
                  >
                    <option value="">كل الدورات</option>
                    {courseId && !courses.some(([id]) => id === courseId) && <option value={courseId}>{selectedCourseName}</option>}
                    {courses.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
                  </select>
                </div>
              </label>
              <div role="group" aria-labelledby={`${filterId}-dates`} className="tp-closures__dates">
                <div className="tp-closures__dates-head">
                  <span id={`${filterId}-dates`} className="tp-closures__dates-title">حسب التاريخ</span>
                  <div role="group" aria-label="التاريخ اللي ينطبق عليه «من / إلى»" className="tp-closures__seg">
                    {([["dismissal", "تاريخ الفصل"], ["closure", "تاريخ اغلاق الكود"]] as const).map(([key, label]) => (
                      <button
                        key={key}
                        type="button"
                        className="tp-closures__seg-btn"
                        aria-pressed={dateField === key}
                        onClick={() => setDateField(key)}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="tp-closures__range">
                  <label className="tp-modal__field">
                    <span>من</span>
                    <DateInput aria-label={`${dateField === "closure" ? "تاريخ اغلاق الكود" : "تاريخ الفصل"} من`} value={dateFrom} onChange={setDateFrom} />
                  </label>
                  <label className="tp-modal__field">
                    <span>إلى</span>
                    <DateInput aria-label={`${dateField === "closure" ? "تاريخ اغلاق الكود" : "تاريخ الفصل"} إلى`} value={dateTo} onChange={setDateTo} />
                  </label>
                </div>
                <div className="tp-closures__dates-foot">
                  <p className="tp-closures__date-hint">
                    {dateField === "closure"
                      ? "يطلع بس الكودات اللي انغلقت ضمن هالمدة."
                      : "يطلع بس الطلاب اللي انفصلوا ضمن هالمدة."}
                    {" "}خانة فارغة = مفتوحة من ذاك الطرف.
                  </p>
                  {dateFiltered && (
                    <Button type="button" variant="ghost" size="sm" className="tp-closures__date-clear" onClick={clearDates}>
                      <X className="size-4" aria-hidden="true" />مسح التاريخ
                    </Button>
                  )}
                </div>
              </div>
            </div>
          )}

          <div role="group" aria-label="حالة اغلاق الكود" className="tp-modal__chips">
            {STATUS_FILTERS.map((option) => (
              <button
                key={option.key}
                type="button"
                className="tp-modal__filter"
                data-closure-filter={option.key}
                data-tone={option.tone}
                aria-pressed={statusFilter === option.key}
                onClick={() => setStatusFilter(option.key)}
              >
                {option.tone && <span className="tp-modal__filter-dot" aria-hidden="true" />}
                <span className="tp-modal__filter-label">{option.label}</span>
                <span className="tp-modal__filter-count">{loaded ? counts[option.key] : "…"}</span>
              </button>
            ))}
          </div>

          <div className="tp-modal__toolbar">
            <span className="tp-modal__count" aria-live="polite">
              {loaded ? `المعروض ${visibleStudents.length} من ${scopedStudents.length} طالب مفصول` : "الطلاب المفصولون"}
            </span>
            {hasFilters && (
              <div className="tp-modal__tools">
                <Button type="button" variant="ghost" size="sm" onClick={clearFilters}><X className="size-4" aria-hidden="true" />مسح الفلاتر</Button>
              </div>
            )}
          </div>

          {error && <div role="alert" className="tp-modal__error"><AlertCircle aria-hidden="true" /><p>{error}</p></div>}
          {pendingIds.size > 0 && <p role="status" className="tp-modal__status"><Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />جاري حفظ اغلاق الكود...</p>}

          <section className="tp-modal__section" aria-label="الطلاب المفصولون">
            {!loaded && loading ? (
              <LoadingState title="جاري تحميل الطلاب..." />
            ) : loaded && visibleStudents.length === 0 ? (
              <EmptyState
                icon={search.trim() || courseId ? Search : CheckCheck}
                title={pendingIds.size > 0 ? "جاري حفظ اغلاق الكود..." : search.trim() || courseId ? "ماكو طلاب يطابقون البحث والفلاتر" : statusFilter === "unchecked" ? "ماكو كودات بانتظار الإغلاق" : statusFilter === "checked" ? "ماكو كودات مغلقة" : "ماكو طلاب مفصولون"}
              />
            ) : (
              <div className="tp-modal__cards" data-columns="1">
                {visibleStudents.map((student) => {
                  const telegram = describeTelegramHandle(student);
                  const telegramHref = telegramNoticeHref(
                    telegram.href,
                    buildDismissalNotice(student.dismissalExamName, student.dismissalOutcome),
                  );
                  const platformDone = stepDone(student, "platform");
                  const telegramDone = stepDone(student, "telegram");
                  const sentAt = botNoticeSentAt(student);
                  const noticeReady = Boolean(student.dismissalExamName && student.dismissalOutcome);
                  const reasonExpanded = expandedReasonIds.has(student.id);
                  const reasonId = `${filterId}-dismissal-reason-${student.id}`;
                  const busy = !canManage || pendingIds.has(student.id);
                  const waitingForSteps = !student.dismissedChecked && !readyToMarkClosed(student);
                  return (
                  <article key={student.id} className="tp-closure-card" data-checked={student.dismissedChecked}>
                    <div className="tp-closure-card__main">
                    <header className="tp-closure-card__head">
                      <span className="tp-closure-card__avatar" data-tone={student.dismissedChecked ? "success" : "warning"} aria-hidden="true">
                        <UserRound />
                      </span>
                      <span className="tp-closure-card__who">
                        <b className="tp-closure-card__name">{student.name}</b>
                        <span className="tp-closure-card__id">
                          <span className="tp-closure-card__pill" data-tone="danger">
                            <span className="tp-closure-card__dot" aria-hidden="true" />{student.status}
                          </span>
                          <span className="tp-closure-card__code" dir="ltr">{student.code}</span>
                        </span>
                        <span className="tp-closure-card__course"><BookOpen aria-hidden="true" />{student.course?.name || "—"}</span>
                      </span>
                      <span className="tp-closure-card__pill tp-closure-card__state" data-tone={student.dismissedChecked ? "success" : "warning"}>
                        {student.dismissedChecked ? <CheckCheck aria-hidden="true" /> : <LockKeyhole aria-hidden="true" />}
                        {student.dismissedChecked ? "الكود مغلق" : "بانتظار الإغلاق"}
                      </span>
                    </header>

                        <section className="tp-closure-card__dismissal" aria-label="الفصل">
                          <span className="tp-closure-card__dismissed-on">
                          <span className="tp-closure-card__icon" aria-hidden="true"><CalendarDays /></span>
                          <span className="tp-closure-card__when">
                            <span className="tp-closure-card__eyebrow">تاريخ الفصل</span>
                            {student.lastDismissalAt ? (
                              <time className="tp-closure-card__date" dateTime={student.lastDismissalAt}>
                                {formatAppDate(baghdadDateKey(student.lastDismissalAt), "غير مسجل")}
                              </time>
                            ) : <span className="tp-closure-card__date" data-missing="true">غير مسجل</span>}
                            {student.dismissedChecked && student.codeClosedAt ? (
                              <span className="tp-closure-card__closed">
                                أُغلق الكود <time dateTime={student.codeClosedAt}>{formatAppDate(baghdadDateKey(student.codeClosedAt), "")}</time>
                              </span>
                            ) : null}
                          </span>
                          </span>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="tp-closures__reason-toggle"
                            aria-expanded={reasonExpanded}
                            aria-controls={reasonId}
                            aria-label={`${reasonExpanded ? "إخفاء" : "إظهار"} سبب فصل ${student.name}`}
                            onClick={() => setExpandedReasonIds((current) => {
                              const next = new Set(current);
                              if (next.has(student.id)) next.delete(student.id);
                              else next.add(student.id);
                              return next;
                            })}
                          >
                            {reasonExpanded ? "إخفاء سبب الفصل" : "إظهار سبب الفصل"}
                            <ChevronDown aria-hidden="true" className={`size-4 ${reasonExpanded ? "rotate-180" : ""}`} />
                          </Button>
                          {reasonExpanded && (
                            <p id={reasonId} className="tp-closures__reason">{displayReasonText(student.dismissalReason) || "سبب الفصل غير مسجل"}</p>
                          )}
                        </section>
                    </div>

                        <div className="tp-closure-card__row">
                          <span className="tp-closure-card__row-label"><MessageCircle aria-hidden="true" />التواصل</span>
                          <span className="tp-closure-card__actions">
                          <button
                            type="button"
                            className="tp-closure-card__danger"
                            data-done={platformDone || undefined}
                            onClick={(event) => openPlatform(student, event.currentTarget)}
                            aria-label={`فتح المنصة لإغلاق كود ${student.name} ونسخ رقم هاتفه${platformDone ? " — تم" : ""}`}
                            title={platformDone ? "تم فتح المنصة ونسخ الرقم" : "فتح المنصة لإغلاق كود الطالب ونسخ رقم هاتفه"}
                          >
                            <Radiation aria-hidden="true" />
                          </button>
                          <button
                            type="button"
                            className="tp-closure-card__restore"
                            onClick={(event) => openPlatform(student, event.currentTarget, "open")}
                            aria-label={`فتح المنصة لإعادة فتح كود ${student.name} ونسخ رقم هاتفه`}
                            title="فتح المنصة لإعادة فتح كود الطالب ونسخ رقم هاتفه"
                          >
                            <LockKeyholeOpen aria-hidden="true" />
                          </button>
                          {telegramHref ? (
                            <a
                              href={telegramHref}
                              className="tp-closure-card__telegram"
                              data-done={telegramDone || undefined}
                              onClick={() => markStep(student, "telegram")}
                              aria-label={`فتح محادثة ${student.name} في تطبيق تليگرام مع تبليغ الفصل جاهزاً${telegramDone ? " — تم" : ""}`}
                              title={telegramDone ? "تم فتح التبليغ" : "فتح المحادثة في تطبيق تليگرام مع تبليغ الفصل جاهزاً للإرسال"}
                            >
                              <MessageCircle aria-hidden="true" />
                              <span dir="ltr">@{telegram.value}</span>
                            </a>
                          ) : (
                            <span
                              className="tp-closure-card__telegram"
                              aria-disabled="true"
                              title={telegram.value ? "معرّف رقمي — لا يوجد يوزر تليگرام لفتح المحادثة" : undefined}
                            >
                              <MessageCircle aria-hidden="true" />
                              <span dir={telegram.value ? "ltr" : undefined}>{telegram.value || "ماكو معرّف"}</span>
                            </span>
                          )}
                          {/* «انسحاب» always sits right beside «إرسال عبر البوت». */}
                          <span className="tp-closure-card__pair">
                            {canWithdraw && student.dismissedChecked && (
                              <button
                                type="button"
                                className="tp-closure-card__withdraw"
                                onClick={() => setWithdrawTarget({ id: student.id, name: student.name })}
                                aria-label={`انسحاب ${student.name}`}
                              >
                                <UserMinus aria-hidden="true" />
                                <span>انسحاب</span>
                              </button>
                            )}
                            {canManage && (
                              <button
                                type="button"
                                className="tp-closure-card__bot"
                                data-sent={sentAt ? true : undefined}
                                disabled={Boolean(sentAt) || !noticeReady || botSending}
                                onClick={() => void sendBotNotice(student)}
                                aria-busy={botSendingId === student.id || undefined}
                                aria-label={sentAt ? `أرسل البوت تبليغ الفصل إلى ${student.name}` : `إرسال تبليغ الفصل إلى ${student.name} عبر البوت`}
                                title={sentAt
                                  ? `أرسل البوت التبليغ ${formatAppDate(baghdadDateKey(sentAt), "")}`
                                  : noticeReady ? "إرسال تبليغ الفصل للطالب عبر بوت تليگرام" : "اسم الامتحان أو النتيجة غير معروفة؛ استخدم زر المحادثة وأكمل التبليغ يدوياً"}
                              >
                                {botSendingId === student.id
                                  ? <Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden="true" />
                                  : sentAt ? <CheckCheck aria-hidden="true" /> : <Send aria-hidden="true" />}
                                <span>{botSendingId === student.id ? "جاري الإرسال…" : sentAt ? "أُرسل عبر البوت" : "إرسال عبر البوت"}</span>
                              </button>
                            )}
                          </span>
                          {canEditContacts && (
                            <StudentContactEdit
                              student={student}
                              field="username"
                              onSaved={(username) => setStudents((current) => current.map((item) => item.id === student.id ? { ...item, username } : item))}
                            />
                          )}
                          </span>
                        </div>

                      <label className="tp-closure-card__toggle" data-checked={student.dismissedChecked} data-disabled={busy || waitingForSteps}>
                        <span className="tp-closure-card__toggle-icon" aria-hidden="true">
                          {student.dismissedChecked ? <CheckCheck /> : <LockKeyhole />}
                        </span>
                        <span className="tp-closure-card__toggle-text">
                          {student.dismissedChecked ? "الكود مغلق" : "اغلاق الكود"}
                        </span>
                        <Checkbox
                          checked={student.dismissedChecked}
                          disabled={busy || waitingForSteps}
                          onCheckedChange={(checked) => { if (typeof checked === "boolean") void setChecked(student, checked); }}
                          aria-label={`اغلاق كود ${student.name}`}
                          className="size-6"
                        />
                        <small className="tp-closure-card__toggle-hint">
                          {pendingIds.has(student.id)
                            ? "جاري الحفظ…"
                            : student.dismissedChecked
                              ? "ألغِ العلامة للتراجع"
                              : waitingForSteps
                                ? "يتفعّل بعد ☢️ إغلاق الكود وإرسال التبليغ (بالبوت أو التليگرام)"
                                : "علّم بعد إغلاق الكود"}
                        </small>
                      </label>
                  </article>
                  );
                })}
              </div>
            )}
          </section>
        </div>
        <WithdrawStudentDialog
          student={withdrawTarget}
          onClose={() => setWithdrawTarget(null)}
          onDone={(id) => {
            // An archived student leaves the closures list.
            setStudents((current) => current.filter((item) => item.id !== id));
            void refresh();
          }}
        />
      </DialogContent>
    </Dialog>
  );
}
