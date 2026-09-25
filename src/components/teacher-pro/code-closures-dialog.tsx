"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { AlertCircle, BookOpen, CheckCheck, ChevronDown, Loader2, LockKeyhole, RefreshCw, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { codeClosuresApi, type CodeClosureStudent } from "@/lib/code-closures-client";
import { saveDismissedCheck } from "@/lib/dismissed-check-api";
import { emitTeacherProDataChanged } from "@/lib/teacherpro-sync";
import { toast } from "@/lib/user-toast";
import { normalizeForSearch } from "@/lib/validation";
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
                <span>الدورة</span>
                <div className="tp-modal__select-wrap">
                  <BookOpen aria-hidden="true" />
                  <select
                    aria-label="تصفية اغلاق الكودات حسب الدورة"
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
                {visibleStudents.length > 0 && <div aria-hidden="true" className="tp-closures__headings"><span>الطالب والكود</span><span>الدورة</span><span>سبب الفصل</span><span>اغلاق كود</span></div>}
                {visibleStudents.map((student) => (
                  <article key={student.id} className="tp-closures__row" data-checked={student.dismissedChecked}>
                    <div className="tp-modal__identity tp-closures__identity">
                      <p className="tp-modal__name">
                        <span className="tp-modal__light" data-tone={student.dismissedChecked ? "success" : "warning"} aria-hidden="true" />
                        <span className="tp-modal__name-text">{student.name}</span>
                      </p>
                      <div className="tp-modal__meta">
                        <span className="tp-modal__chip" data-tone="outline"><span dir="ltr" className="tp-modal__code">{student.code}</span></span>
                      </div>
                    </div>
                    <p className="tp-modal__meta-item tp-closures__course"><BookOpen aria-hidden="true" /><span>{student.course?.name || "—"}</span></p>
                    <div className="tp-closures__reason"><span>سبب الفصل</span><p>{student.dismissalReason || "—"}</p></div>
                    <label className="tp-closures__action" data-disabled={!canManage || pendingIds.has(student.id)}>
                      <Checkbox
                        checked={student.dismissedChecked}
                        disabled={!canManage || pendingIds.has(student.id)}
                        onCheckedChange={(checked) => { if (typeof checked === "boolean") void setChecked(student, checked); }}
                        aria-label={`اغلاق كود ${student.name}`}
                        className="size-6"
                      />
                      <span>{student.dismissedChecked ? "الكود مغلق" : "اغلاق كود"}</span>
                    </label>
                  </article>
                ))}
              </div>
            )}
          </section>
        </div>
      </DialogContent>
    </Dialog>
  );
}
