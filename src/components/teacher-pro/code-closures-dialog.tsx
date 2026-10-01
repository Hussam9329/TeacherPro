"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { AlertCircle, BookOpen, CalendarDays, CheckCheck, ChevronDown, Loader2, LockKeyhole, MessageCircle, Radiation, RefreshCw, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { codeClosuresApi, type CodeClosureStudent } from "@/lib/code-closures-client";
import {
  MZ_ACTIVE_USERS_URL,
  buildDismissalNotice,
  copyTextNow,
  mzPlatformPhone,
  telegramNoticeHref,
  type ClosureContactStep,
} from "@/lib/code-closure-contact";
import { saveDismissedCheck } from "@/lib/dismissed-check-api";
import { emitTeacherProDataChanged } from "@/lib/teacherpro-sync";
import { toast } from "@/lib/user-toast";
import { normalizeForSearch } from "@/lib/validation";
import { describeTelegramHandle } from "./student-registry-helpers";
import { baghdadDateKey } from "@/lib/baghdad-time";
import { formatAppDate } from "@/lib/format";
import { displayReasonText } from "@/lib/reason-display";
import "./tp-modal.css";
import "./code-closures-dialog.css";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  canManage: boolean;
};

type StatusFilter = "all" | "checked" | "unchecked";

export function CodeClosuresDialog({ open, onOpenChange, canManage }: Props) {
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
  const [expandedReasonIds, setExpandedReasonIds] = useState<Set<string>>(new Set());
  // Contact steps clicked here, shown at once while the shared mark is saved.
  const [clickedSteps, setClickedSteps] = useState<Record<string, number>>({});
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

  function openPlatform(student: CodeClosureStudent) {
    const phone = mzPlatformPhone(student.phone);
    // Copy first: the new tab takes the focus the clipboard needs.
    const copied = phone ? copyTextNow(phone) : false;
    window.open(MZ_ACTIVE_USERS_URL, "_blank", "noopener,noreferrer");
    markStep(student, "platform");
    if (!phone) toast.error(`لا يوجد رقم هاتف صالح للطالب ${student.name}؛ ابحث عنه في المنصة يدوياً.`);
    else if (!copied) toast.error(`تعذر النسخ تلقائياً. رقم الطالب: ${phone}`);
    else toast.success(`نُسخ رقم الطالب ${phone}`);
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
      <DialogContent className="tp-modal tp-closures" dir="rtl">
        <div className="tp-modal__hero">
          <span className="tp-modal__hero-icon" aria-hidden="true"><LockKeyhole /></span>
          <DialogHeader className="tp-modal__heading">
            <DialogTitle>اغلاق الكودات</DialogTitle>
          </DialogHeader>
        </div>

        <div className="tp-modal__body">
          <div className="tp-modal__controls">
            <div role="group" aria-label="حالة اغلاق الكود" className="tp-modal__filters">
              {([
                ["all", "All", "الكل", undefined],
                ["checked", "Checked", "مغلقة", "success"],
                ["unchecked", "unChecked", "بانتظار الإغلاق", "warning"],
              ] as const).map(([value, label, description, tone]) => (
                <Button
                  key={value}
                  type="button"
                  variant="ghost"
                  aria-label={label}
                  aria-describedby={`${filterId}-${value}-description ${filterId}-${value}-count`}
                  aria-pressed={statusFilter === value}
                  onClick={() => setStatusFilter(value)}
                  data-closure-filter={value}
                  data-tone={tone}
                  className="tp-modal__filter"
                >
                  <span className="tp-modal__filter-label">{description}</span>
                  <strong id={`${filterId}-${value}-count`} className="tp-modal__filter-count">{loaded ? counts[value] : "—"}</strong>
                  <span id={`${filterId}-${value}-description`} className="tp-modal__filter-description" dir="ltr">{label}</span>
                </Button>
              ))}
            </div>

            <div className="tp-modal__fields">
              <label className="tp-modal__field">
                <span>بحث عن طالب</span>
                <div className="tp-modal__input-wrap">
                  <Search aria-hidden="true" />
                  <Input value={search} onChange={(event) => setSearch(event.target.value)} aria-label="بحث في اغلاق الكودات" placeholder="اسم الطالب أو الكود" />
                </div>
              </label>
              <label className="tp-modal__field">
                <span>اسم الدورة</span>
                <div className="tp-modal__select-wrap">
                  <BookOpen aria-hidden="true" />
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
                  <ChevronDown className="tp-modal__chevron" aria-hidden="true" />
                </div>
              </label>
            </div>
          </div>

          <div className="tp-modal__toolbar">
            <span className="tp-modal__count" aria-live="polite">
              {loaded ? `المعروض ${visibleStudents.length} من ${scopedStudents.length} طالب مفصول` : "الطلاب المفصولون"}
            </span>
            <div className="tp-modal__tools">
              {hasFilters && <Button type="button" variant="ghost" size="sm" onClick={clearFilters}><X className="size-4" aria-hidden="true" />مسح الفلاتر</Button>}
              <Button type="button" variant="outline" size="sm" disabled={loading || pendingIds.size > 0} onClick={() => void refresh()}>
                <RefreshCw className={`size-4 ${loading ? "animate-spin motion-reduce:animate-none" : ""}`} aria-hidden="true" />تحديث
              </Button>
            </div>
          </div>

          {error && <div role="alert" className="tp-modal__error"><AlertCircle aria-hidden="true" /><p>{error}</p></div>}
          {pendingIds.size > 0 && <p role="status" className="tp-modal__status"><Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />جاري حفظ اغلاق الكود...</p>}

          <section className="tp-modal__section" aria-label="الطلاب المفصولون">
            {!loaded && loading ? (
              <div className="tp-modal__empty" role="status">
                <span className="tp-modal__empty-icon"><Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden="true" /></span>
                <p>جاري تحميل الطلاب...</p>
              </div>
            ) : loaded && visibleStudents.length === 0 ? (
              <div className="tp-modal__empty">
                <span className="tp-modal__empty-icon">{search.trim() || courseId ? <Search aria-hidden="true" /> : <CheckCheck aria-hidden="true" />}</span>
                <p>{pendingIds.size > 0 ? "جاري حفظ اغلاق الكود..." : search.trim() || courseId ? "لا يوجد طلاب يطابقون البحث والفلاتر" : statusFilter === "unchecked" ? "لا توجد كودات بانتظار الإغلاق" : statusFilter === "checked" ? "لا توجد كودات مغلقة" : "لا يوجد طلاب مفصولون"}</p>
              </div>
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
                  const reasonExpanded = expandedReasonIds.has(student.id);
                  const reasonId = `${filterId}-dismissal-reason-${student.id}`;
                  const busy = !canManage || pendingIds.has(student.id);
                  return (
                  <article key={student.id} className="tp-closure-card" data-checked={student.dismissedChecked}>
                    <header className="tp-closure-card__head">
                      <b className="tp-closure-card__name">{student.name}</b>
                      <span className="tp-closure-card__sep" aria-hidden="true" />
                      <span className="tp-closure-card__id">
                        <span className="tp-closure-card__code" dir="ltr">{student.code}</span>
                        <span className="tp-closure-card__course"><BookOpen aria-hidden="true" />{student.course?.name || "—"}</span>
                      </span>
                      <span className="tp-closure-card__sep" aria-hidden="true" />
                      <span className="tp-closure-card__pill" data-tone="danger">
                        <span className="tp-closure-card__dot" aria-hidden="true" />{student.status}
                      </span>
                      <span className="tp-closure-card__pill" data-tone={student.dismissedChecked ? "success" : "warning"}>
                        {student.dismissedChecked ? <CheckCheck aria-hidden="true" /> : <LockKeyhole aria-hidden="true" />}
                        {student.dismissedChecked ? "الكود مغلق" : "بانتظار الإغلاق"}
                      </span>
                    </header>

                    <div className="tp-closure-card__body">
                      <div className="tp-closure-card__main">
                        <section className="tp-closure-card__dismissal" aria-label="الفصل">
                          <span className="tp-closure-card__icon" aria-hidden="true"><CalendarDays /></span>
                          <span className="tp-closure-card__when">
                            <span className="tp-closure-card__eyebrow">تاريخ الفصل</span>
                            {student.lastDismissalAt ? (
                              <time className="tp-closure-card__date" dateTime={student.lastDismissalAt} dir="ltr">
                                {formatAppDate(baghdadDateKey(student.lastDismissalAt), "غير مسجل")}
                              </time>
                            ) : <span className="tp-closure-card__date" data-missing="true">غير مسجل</span>}
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

                        <div className="tp-closure-card__row">
                          <span className="tp-closure-card__row-label"><MessageCircle aria-hidden="true" />التواصل</span>
                          <span className="tp-closure-card__actions">
                          <button
                            type="button"
                            className="tp-closure-card__danger"
                            data-done={platformDone || undefined}
                            onClick={() => openPlatform(student)}
                            aria-label={`فتح المنصة ونسخ رقم هاتف ${student.name}${platformDone ? " — تم" : ""}`}
                            title={platformDone ? "تم فتح المنصة ونسخ الرقم" : "فتح المنصة ونسخ رقم هاتف الطالب"}
                          >
                            <Radiation aria-hidden="true" />
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
                              <span dir={telegram.value ? "ltr" : undefined}>{telegram.value || "لا يوجد معرّف"}</span>
                            </span>
                          )}
                          </span>
                        </div>
                      </div>

                      <label className="tp-closure-card__toggle" data-checked={student.dismissedChecked} data-disabled={busy}>
                        <span className="tp-closure-card__toggle-icon" aria-hidden="true">
                          {student.dismissedChecked ? <CheckCheck /> : <LockKeyhole />}
                        </span>
                        <span className="tp-closure-card__toggle-text">
                          {student.dismissedChecked ? "الكود مغلق" : "اغلاق الكود"}
                        </span>
                        <Checkbox
                          checked={student.dismissedChecked}
                          disabled={busy}
                          onCheckedChange={(checked) => { if (typeof checked === "boolean") void setChecked(student, checked); }}
                          aria-label={`اغلاق كود ${student.name}`}
                          className="size-6"
                        />
                        <small className="tp-closure-card__toggle-hint">
                          {pendingIds.has(student.id) ? "جاري الحفظ…" : student.dismissedChecked ? "ألغِ العلامة للتراجع" : "علّم بعد إغلاق الكود"}
                        </small>
                      </label>
                    </div>
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
