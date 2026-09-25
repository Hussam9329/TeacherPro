"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  ArrowRight,
  BookOpen,
  CalendarClock,
  CalendarPlus,
  CheckCircle2,
  Loader2,
  PencilLine,
  Search,
  UserRound,
  XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  describeGraceRemaining,
  formatGraceDate,
  formatGraceDays,
  formatGracePeriod,
  GRACE_PERIOD_LIST_FILTERS,
  gracePeriodDays,
  gracePeriodEndFromDays,
  gracePeriodState,
  MAX_GRACE_PERIOD_DAYS,
  validateGracePeriodInput,
  type GracePeriodListFilter,
  type GracePeriodRecord,
} from "@/lib/grace-periods";
import {
  gracePeriodsApi,
  type GraceChangeInput,
  type GraceChangePreview,
  type GracePeriodListResponse,
  type GracePeriodsResponse,
  type GraceStudentSearchResult,
} from "@/lib/grace-periods-client";
import { formatBaghdadDateTime } from "@/lib/baghdad-time";
import { emitTeacherProDataChanged } from "@/lib/teacherpro-sync";
import { toast } from "@/lib/user-toast";
import "./grace-periods-dialog.css";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  canManage: boolean;
};

type EditorState = {
  action: "create" | "update" | "cancel";
  periodId?: string;
  mode: "range" | "days";
  startDate: string;
  endDate: string;
  days: string;
  cancelReason: string;
};

function editorPeriod(editor: EditorState): { startDate: string; endDate: string } {
  if (editor.mode === "days") {
    const days = Number(editor.days);
    return {
      startDate: editor.startDate,
      endDate: Number.isInteger(days) && days >= 1 ? gracePeriodEndFromDays(editor.startDate, days) : "",
    };
  }
  return { startDate: editor.startDate, endDate: editor.endDate };
}

function examDateLabel(value: string): string {
  return formatGraceDate(String(value || "").slice(0, 10));
}

export function GracePeriodsDialog({ open, onOpenChange, canManage }: Props) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<GraceStudentSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [data, setData] = useState<GracePeriodsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [preview, setPreview] = useState<GraceChangePreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState("");
  const [listFilter, setListFilter] = useState<GracePeriodListFilter>("all");
  const [list, setList] = useState<GracePeriodListResponse | null>(null);
  const [listLoading, setListLoading] = useState(false);
  const [listError, setListError] = useState("");
  const loadSequence = useRef(0);

  useEffect(() => {
    if (open) return;
    setQuery("");
    setResults([]);
    setData(null);
    setEditor(null);
    setPreview(null);
    setActionError("");
    setLoadError("");
    setListFilter("all");
    setList(null);
    setListError("");
  }, [open]);

  // The list follows the filter and the search text; it is re-read whenever
  // the operator comes back from a student, so saved changes show up at once.
  const trimmedQuery = query.trim();
  const listQuery = trimmedQuery.length >= 2 ? trimmedQuery : "";
  useEffect(() => {
    if (!open || data) return;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setListLoading(true);
      setListError("");
      try {
        const response = await gracePeriodsApi.list(listFilter, listQuery, controller.signal);
        if (!controller.signal.aborted) setList(response);
      } catch (cause) {
        if (!controller.signal.aborted) {
          setListError(cause instanceof Error ? cause.message : "تعذر تحميل قائمة فترات السماح.");
        }
      } finally {
        if (!controller.signal.aborted) setListLoading(false);
      }
    }, listQuery ? 300 : 0);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [open, data, listFilter, listQuery]);

  useEffect(() => {
    const trimmed = query.trim();
    if (!open || data || trimmed.length < 2) {
      setResults([]);
      setSearching(false);
      setSearchError("");
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setSearching(true);
      setSearchError("");
      try {
        const response = await gracePeriodsApi.search(trimmed, controller.signal);
        if (!controller.signal.aborted) setResults(response.students || []);
      } catch (cause) {
        if (!controller.signal.aborted) {
          setResults([]);
          setSearchError(cause instanceof Error ? cause.message : "تعذر البحث عن الطالب.");
        }
      } finally {
        if (!controller.signal.aborted) setSearching(false);
      }
    }, 300);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [query, open, data]);

  const loadStudent = useCallback(async (studentId: string) => {
    const sequence = ++loadSequence.current;
    setLoading(true);
    setLoadError("");
    try {
      const response = await gracePeriodsApi.load(studentId);
      if (sequence === loadSequence.current) setData(response);
    } catch (cause) {
      if (sequence === loadSequence.current) {
        setLoadError(cause instanceof Error ? cause.message : "تعذر تحميل فترات السماح.");
      }
    } finally {
      if (sequence === loadSequence.current) setLoading(false);
    }
  }, []);

  const today = data?.today || "";
  const activePeriods = useMemo(
    () => (data?.periods || []).filter((period) => !period.cancelledAt),
    [data],
  );
  const currentPeriod = useMemo(
    () => activePeriods.find((period) => gracePeriodState(period, today) === "current") || null,
    [activePeriods, today],
  );
  const historyPeriods = useMemo(
    () => (data?.periods || []).filter((period) => period.id !== currentPeriod?.id),
    [data, currentPeriod],
  );
  const archived = data?.student.status === "مؤرشف";
  const editable = canManage && !archived;

  const proposed = editor && editor.action !== "cancel" ? editorPeriod(editor) : null;
  const validation = editor && editor.action !== "cancel" && proposed
    ? validateGracePeriodInput({
        startDate: proposed.startDate,
        endDate: proposed.endDate,
        todayKey: today,
        existing: activePeriods,
        ignoreId: editor.periodId,
      })
    : "";
  const proposedDays = proposed && !validation ? gracePeriodDays(proposed) : 0;

  function openEditor(next: EditorState) {
    setEditor(next);
    setPreview(null);
    setActionError("");
  }

  function startCreate() {
    openEditor({ action: "create", mode: "range", startDate: today, endDate: "", days: "", cancelReason: "" });
  }

  function startUpdate(period: GracePeriodRecord) {
    openEditor({
      action: "update",
      periodId: period.id,
      mode: "range",
      startDate: period.startDate,
      endDate: period.endDate,
      days: String(gracePeriodDays(period)),
      cancelReason: "",
    });
  }

  function startCancel(period: GracePeriodRecord) {
    openEditor({
      action: "cancel",
      periodId: period.id,
      mode: "range",
      startDate: period.startDate,
      endDate: period.endDate,
      days: "",
      cancelReason: "",
    });
  }

  function changeInput(): GraceChangeInput | null {
    if (!data || !editor) return null;
    if (editor.action === "cancel") {
      return { studentId: data.student.id, action: "cancel", periodId: editor.periodId, cancelReason: editor.cancelReason };
    }
    if (!proposed || validation) return null;
    return {
      studentId: data.student.id,
      action: editor.action,
      periodId: editor.periodId,
      startDate: proposed.startDate,
      endDate: proposed.endDate,
    };
  }

  async function runPreview() {
    const input = changeInput();
    if (!input) return;
    setBusy(true);
    setActionError("");
    try {
      setPreview(await gracePeriodsApi.preview(input));
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : "تعذر معاينة التعديل.");
    } finally {
      setBusy(false);
    }
  }

  async function confirmSave() {
    const input = changeInput();
    if (!input || !preview || !data) return;
    setBusy(true);
    setActionError("");
    try {
      const result = await gracePeriodsApi.apply({ ...input, previewToken: preview.previewToken });
      setData({ ...data, periods: result.periods });
      setEditor(null);
      setPreview(null);
      toast.success(
        input.action === "cancel" ? "تم إلغاء فترة السماح." : "تم حفظ فترة السماح.",
      );
      emitTeacherProDataChanged({
        source: "local-mutation",
        reason: "تعديل فترة سماح طالب",
        scopes: ["students", "grades", "opportunities", "dashboard", "logs"],
      });
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "تعذر حفظ فترة السماح.";
      setActionError(message);
      setPreview(null);
      // The save may have committed before the connection failed; re-read.
      void loadStudent(data.student.id);
    } finally {
      setBusy(false);
    }
  }

  function renderPeriodActions(period: GracePeriodRecord) {
    if (!editable || period.cancelledAt) return null;
    return (
      <div className="tp-grace__period-actions">
        <Button type="button" size="sm" variant="outline" onClick={() => startUpdate(period)} disabled={busy}>
          <PencilLine className="size-4" aria-hidden="true" />تعديل
        </Button>
        <Button type="button" size="sm" variant="ghost" className="tp-grace__danger" onClick={() => startCancel(period)} disabled={busy}>
          <XCircle className="size-4" aria-hidden="true" />إلغاء
        </Button>
      </div>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="tp-grace" dir="rtl">
        <div className="tp-grace__hero">
          <span className="tp-grace__hero-icon" aria-hidden="true"><CalendarClock /></span>
          <DialogHeader className="tp-grace__heading">
            <DialogTitle>إدارة فترة السماح</DialogTitle>
          </DialogHeader>
        </div>

        <div className="tp-grace__body">
          <p className="tp-grace__rule">
            أي امتحان يقع تاريخه داخل فترة السماح يُعامل فيه الطالب كمجاز — فترة سماح، ولا يؤثر على فرصه أو فصله.
            اليوم الأول والأخير محسوبان ضمن الفترة.
          </p>

          {!data && (
            <section className="tp-grace__search" aria-label="البحث عن طالب">
              <label className="tp-grace__field">
                <span>البحث عن طالب</span>
                <div className="tp-grace__input-wrap">
                  <Search aria-hidden="true" />
                  <Input
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="الاسم أو الكود أو اليوزر أو الهاتف"
                    aria-label="البحث عن طالب"
                    className="tp-grace__search-input"
                    autoFocus
                  />
                  {searching && <Loader2 className="tp-grace__spinner animate-spin motion-reduce:animate-none" aria-hidden="true" />}
                </div>
              </label>
              {searchError && <p role="alert" className="tp-grace__error"><AlertCircle aria-hidden="true" />{searchError}</p>}
              {loadError && <p role="alert" className="tp-grace__error"><AlertCircle aria-hidden="true" />{loadError}</p>}
              {query.trim().length >= 2 && !searching && results.length === 0 && !searchError && (
                <p className="tp-grace__muted">لا يوجد طالب يطابق البحث.</p>
              )}
              {results.length > 0 && (
                <ul className="tp-grace__results">
                  {results.map((student) => (
                    <li key={student.id}>
                      <button type="button" className="tp-grace__result" onClick={() => void loadStudent(student.id)} disabled={loading}>
                        <span className="tp-grace__avatar" aria-hidden="true"><UserRound /></span>
                        <span className="tp-grace__result-text">
                          <strong>{student.name}</strong>
                          <span dir="ltr">{student.code}</span>
                        </span>
                        <span className="tp-grace__result-meta">
                          {student.courseName && <span><BookOpen aria-hidden="true" />{student.courseName}</span>}
                          {student.graceState === "current" && student.graceEndDate && (
                            <span className="tp-grace__chip" data-state="current">
                              ضمن فترة السماح حتى <span dir="ltr">{formatGraceDate(student.graceEndDate)}</span>
                            </span>
                          )}
                          {student.graceState === "past" && (
                            <span className="tp-grace__chip" data-state="past">فترة سماح منتهية</span>
                          )}
                          <span className="tp-grace__status" data-status={student.status}>{student.status}</span>
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}

          {!data && (
            <section className="tp-grace__section" aria-labelledby="tp-grace-list">
              <h3 id="tp-grace-list">
                {listQuery ? "فترات السماح للطلاب المطابقين للبحث" : "فترات السماح"}
              </h3>
              <div role="group" aria-label="تصفية فترات السماح" className="tp-grace__filters">
                {GRACE_PERIOD_LIST_FILTERS.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    className="tp-grace__filter"
                    aria-pressed={listFilter === option.value}
                    data-filter={option.value}
                    onClick={() => setListFilter(option.value)}
                  >
                    <span>{option.label}</span>
                    <span className="tp-grace__filter-count">{list ? list.counts[option.value] : "…"}</span>
                  </button>
                ))}
              </div>
              {listError && <p role="alert" className="tp-grace__error"><AlertCircle aria-hidden="true" />{listError}</p>}
              {listLoading && !list && (
                <p role="status" className="tp-grace__muted">
                  <Loader2 className="inline size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /> جارٍ تحميل فترات السماح…
                </p>
              )}
              {list && list.periods.length === 0 && !listLoading && (
                <p className="tp-grace__muted">
                  {listFilter === "current"
                    ? "لا توجد فترات سماح مستمرة."
                    : listFilter === "past"
                      ? "لا توجد فترات سماح منتهية."
                      : "لا توجد فترات سماح."}
                </p>
              )}
              {list && list.periods.length > 0 && (
                <ul className="tp-grace__results" aria-busy={listLoading}>
                  {list.periods.map((period) => {
                    const state = gracePeriodState(period, list.today);
                    return (
                      <li key={period.id}>
                        <button type="button" className="tp-grace__result" onClick={() => void loadStudent(period.studentId)} disabled={loading}>
                          <span className="tp-grace__avatar" aria-hidden="true"><UserRound /></span>
                          <span className="tp-grace__result-text">
                            <strong>{period.studentName}</strong>
                            <span dir="ltr">{period.studentCode}</span>
                            {period.courseName && <span>{period.courseName}</span>}
                          </span>
                          <span className="tp-grace__list-period">
                            <span dir="ltr" className="tp-grace__range-cell">{formatGracePeriod(period)}</span>
                            <span className="tp-grace__muted">{formatGraceDays(gracePeriodDays(period))}</span>
                            <span className="tp-grace__chip" data-state={state}>
                              {state === "current" ? describeGraceRemaining(period, list.today) : "منتهية"}
                            </span>
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
              {list?.truncated && (
                <p className="tp-grace__muted">تُعرض أول {list.periods.length} فترة فقط؛ استخدم البحث لتضييق القائمة.</p>
              )}
            </section>
          )}

          {data && (
            <>
              <section className="tp-grace__student" aria-label="الطالب">
                <span className="tp-grace__avatar tp-grace__avatar--large" aria-hidden="true"><UserRound /></span>
                <div className="tp-grace__student-text">
                  <strong>{data.student.name}</strong>
                  <span dir="ltr">{data.student.code}</span>
                  {data.student.courseName && <span className="tp-grace__muted">{data.student.courseName}</span>}
                </div>
                <span className="tp-grace__status" data-status={data.student.status}>{data.student.status}</span>
                <Button type="button" variant="ghost" size="sm" onClick={() => { setData(null); setEditor(null); setPreview(null); }} disabled={busy}>
                  <ArrowRight className="size-4" aria-hidden="true" />طالب آخر
                </Button>
              </section>

              {archived && <p className="tp-grace__muted">الطالب مؤرشف؛ فترات سماحه للعرض فقط.</p>}

              <section className="tp-grace__section" aria-labelledby="tp-grace-current">
                <h3 id="tp-grace-current">الفترة الحالية</h3>
                {currentPeriod ? (
                  <div className="tp-grace__current">
                    <div>
                      <span className="tp-grace__badge"><i aria-hidden="true" />فترة حالية</span>
                      <p className="tp-grace__range" dir="ltr">{formatGracePeriod(currentPeriod)}</p>
                      <p className="tp-grace__muted">{formatGraceDays(gracePeriodDays(currentPeriod))}</p>
                    </div>
                    {renderPeriodActions(currentPeriod)}
                  </div>
                ) : (
                  <div className="tp-grace__empty">
                    <p>لا توجد فترة سماح حالية</p>
                    {editable && !editor && (
                      <Button type="button" onClick={startCreate} disabled={busy}>
                        <CalendarPlus className="size-4" aria-hidden="true" />إضافة فترة سماح
                      </Button>
                    )}
                  </div>
                )}
                {currentPeriod && editable && !editor && (
                  <Button type="button" variant="outline" size="sm" className="tp-grace__add-more" onClick={startCreate} disabled={busy}>
                    <CalendarPlus className="size-4" aria-hidden="true" />إضافة فترة سماح أخرى
                  </Button>
                )}
              </section>

              {editor && (
                <section className="tp-grace__editor" aria-label="تحرير فترة السماح">
                  <h3>
                    {editor.action === "create" ? "إضافة فترة سماح" : editor.action === "update" ? "تعديل فترة السماح" : "إلغاء فترة السماح"}
                  </h3>

                  {editor.action === "cancel" ? (
                    <>
                      <p>
                        سيتم إلغاء الفترة <span dir="ltr">{formatGracePeriod(editor)}</span>. تبقى في سجل الطالب
                        كفترة ملغاة، ويُعاد حساب الامتحانات المتأثرة من بياناتها الأصلية.
                      </p>
                      <label className="tp-grace__field">
                        <span>سبب الإلغاء (اختياري)</span>
                        <Input
                          value={editor.cancelReason}
                          onChange={(event) => setEditor({ ...editor, cancelReason: event.target.value })}
                          maxLength={200}
                          disabled={Boolean(preview) || busy}
                        />
                      </label>
                    </>
                  ) : (
                    <>
                      <div role="radiogroup" aria-label="طريقة تحديد الفترة" className="tp-grace__modes">
                        {([
                          ["range", "من / إلى"],
                          ["days", "من + عدد الأيام"],
                        ] as const).map(([mode, label]) => (
                          <button
                            key={mode}
                            type="button"
                            role="radio"
                            aria-checked={editor.mode === mode}
                            className="tp-grace__mode"
                            disabled={Boolean(preview) || busy}
                            onClick={() => {
                              const current = editorPeriod(editor);
                              setEditor({
                                ...editor,
                                mode,
                                endDate: current.endDate || editor.endDate,
                                days: current.endDate ? String(gracePeriodDays(current)) : editor.days,
                              });
                            }}
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                      <div className="tp-grace__inputs">
                        <label className="tp-grace__field">
                          <span>من</span>
                          <Input
                            type="date"
                            value={editor.startDate}
                            max={today || undefined}
                            onChange={(event) => setEditor({ ...editor, startDate: event.target.value })}
                            disabled={Boolean(preview) || busy}
                          />
                        </label>
                        {editor.mode === "range" ? (
                          <label className="tp-grace__field">
                            <span>إلى</span>
                            <Input
                              type="date"
                              value={editor.endDate}
                              min={editor.startDate || undefined}
                              onChange={(event) => setEditor({ ...editor, endDate: event.target.value })}
                              disabled={Boolean(preview) || busy}
                            />
                          </label>
                        ) : (
                          <>
                            <label className="tp-grace__field">
                              <span>عدد الأيام</span>
                              <Input
                                type="number"
                                inputMode="numeric"
                                min={1}
                                max={MAX_GRACE_PERIOD_DAYS}
                                step={1}
                                value={editor.days}
                                onChange={(event) => setEditor({ ...editor, days: event.target.value })}
                                disabled={Boolean(preview) || busy}
                              />
                            </label>
                            <div className="tp-grace__field">
                              <span>إلى</span>
                              <p className="tp-grace__computed" dir="ltr">{proposed?.endDate ? formatGraceDate(proposed.endDate) : "—"}</p>
                            </div>
                          </>
                        )}
                      </div>
                      {validation && (proposed?.startDate && (editor.mode === "days" ? editor.days : editor.endDate)) ? (
                        <p role="alert" className="tp-grace__error"><AlertCircle aria-hidden="true" />{validation}</p>
                      ) : proposedDays > 0 && proposed ? (
                        <p className="tp-grace__summary">
                          الطالب سيكون ضمن فترة السماح من <span dir="ltr">{formatGraceDate(proposed.startDate)}</span> إلى{" "}
                          <span dir="ltr">{formatGraceDate(proposed.endDate)}</span> — {formatGraceDays(proposedDays)}.
                        </p>
                      ) : null}
                    </>
                  )}

                  {actionError && <p role="alert" className="tp-grace__error"><AlertCircle aria-hidden="true" />{actionError}</p>}

                  {preview && (
                    <div className="tp-grace__preview" aria-live="polite">
                      <p className="tp-grace__summary">{preview.summary}</p>
                      {preview.affectedExams.length === 0 ? (
                        <p className="tp-grace__muted">لا يؤثر هذا التعديل على أي امتحان موجود.</p>
                      ) : (
                        <>
                          <p><strong>سيؤثر هذا التعديل على {preview.affectedExams.length} امتحان:</strong></p>
                          <ul className="tp-grace__impact">
                            {preview.affectedExams.map((exam) => (
                              <li key={exam.examId} data-change={exam.change}>
                                <span className="tp-grace__impact-name">{exam.examName}</span>
                                <span className="tp-grace__muted" dir="ltr">{examDateLabel(exam.examDate)}</span>
                                <span className="tp-grace__muted">النتيجة المسجلة: {exam.result}</span>
                                <span className="tp-grace__impact-change">
                                  {exam.change === "enters" ? "سيصبح مجازاً — فترة سماح" : "سيخرج من فترة السماح ويعود للمحاسبة الطبيعية"}
                                </span>
                              </li>
                            ))}
                          </ul>
                        </>
                      )}
                      {preview.projection && (
                        preview.projection.current.opportunities !== preview.projection.projected.opportunities ||
                        preview.projection.current.status !== preview.projection.projected.status
                      ) ? (
                        <p className="tp-grace__projection">
                          الفرص: {preview.projection.current.opportunities} ← {preview.projection.projected.opportunities}
                          {" · "}الحالة: {preview.projection.current.status} ← {preview.projection.projected.status}
                          {preview.projection.current.status === "مفصول" && preview.projection.projected.status === "نشط" && " (سيعود الطالب نشطاً)"}
                        </p>
                      ) : (
                        <p className="tp-grace__muted">لا تغيير على فرص الطالب أو حالته.</p>
                      )}
                    </div>
                  )}

                  <div className="tp-grace__editor-actions">
                    {!preview ? (
                      <Button
                        type="button"
                        onClick={() => void runPreview()}
                        disabled={busy || (editor.action !== "cancel" && (Boolean(validation) || !proposed?.endDate))}
                      >
                        {busy ? <Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : null}
                        معاينة الأثر
                      </Button>
                    ) : (
                      <Button type="button" onClick={() => void confirmSave()} disabled={busy} className={editor.action === "cancel" ? "tp-grace__confirm-danger" : ""}>
                        {busy ? <Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <CheckCircle2 className="size-4" aria-hidden="true" />}
                        {editor.action === "cancel" ? "تأكيد الإلغاء" : "تأكيد الحفظ"}
                      </Button>
                    )}
                    {preview && (
                      <Button type="button" variant="outline" onClick={() => setPreview(null)} disabled={busy}>
                        تعديل المدخلات
                      </Button>
                    )}
                    <Button type="button" variant="ghost" onClick={() => { setEditor(null); setPreview(null); setActionError(""); }} disabled={busy}>
                      رجوع
                    </Button>
                  </div>
                </section>
              )}

              <section className="tp-grace__section" aria-labelledby="tp-grace-history">
                <h3 id="tp-grace-history">الفترات السابقة</h3>
                {historyPeriods.length === 0 ? (
                  <p className="tp-grace__muted">لا توجد فترات سابقة.</p>
                ) : (
                  <div className="table-wrap tp-grace__table-wrap" tabIndex={0} aria-label="جدول فترات السماح السابقة؛ يمكن تمريره أفقياً عند الحاجة">
                    <table className="tp-grace__table">
                      <thead>
                        <tr><th>الفترة</th><th>المدة</th><th>الحالة</th><th><span className="sr-only">إجراءات</span></th></tr>
                      </thead>
                      <tbody>
                        {historyPeriods.map((period) => (
                          <tr key={period.id} data-cancelled={Boolean(period.cancelledAt)}>
                            <td dir="ltr" className="tp-grace__range-cell">{formatGracePeriod(period)}</td>
                            <td>{formatGraceDays(gracePeriodDays(period))}</td>
                            <td>
                              {period.cancelledAt
                                ? `ملغاة${period.cancelledByName ? ` — ${period.cancelledByName}` : ""} · ${formatBaghdadDateTime(period.cancelledAt)}${period.cancelReason ? ` · ${period.cancelReason}` : ""}`
                                : period.source === "legacy" ? "منتهية (من النظام القديم)" : "منتهية"}
                            </td>
                            <td>{renderPeriodActions(period)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
