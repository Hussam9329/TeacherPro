"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  ArrowRight,
  CalendarClock,
  CalendarDays,
  CalendarPlus,
  CheckCircle2,
  Loader2,
  PencilLine,
  Search,
  Send,
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
  GRACE_LIGHT_LABELS,
  GRACE_PERIOD_LIST_FILTERS,
  gracePeriodDays,
  gracePeriodEndFromDays,
  gracePeriodLight,
  gracePeriodState,
  studentGraceLight,
  type GraceLight,
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
import { baghdadDateKey, formatBaghdadDateTime } from "@/lib/baghdad-time";
import { emitTeacherProDataChanged } from "@/lib/teacherpro-sync";
import { toast } from "@/lib/user-toast";
import { describeTelegramHandle } from "./student-registry-helpers";
import "./tp-modal.css";
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

function registrationDateLabel(createdAt: string): string {
  const key = baghdadDateKey(createdAt);
  return key ? formatGraceDate(key) : "—";
}

type StudentLock = { kind: "archived" | "dismissed"; tag: string; hint: string };

/** Students whose grace can never be changed from this screen, and why. */
const STUDENT_LOCKS: Record<string, StudentLock> = {
  "مؤرشف": { kind: "archived", tag: "مؤرشف", hint: "الطالب مؤرشف — لا يمكن إضافة فترة سماح أو تعديلها" },
  "مفصول": { kind: "dismissed", tag: "مفصول", hint: "الطالب مفصول — يجب أن يوقع تعهداً" },
};

function studentLock(status: string | null | undefined): StudentLock | null {
  return STUDENT_LOCKS[String(status || "")] || null;
}

function LockTag({ lock }: { lock: StudentLock }) {
  return <span className="tp-modal__lock" data-lock={lock.kind} title={lock.hint}>{lock.tag}</span>;
}

/** Palette tone of each light: ongoing = primary, ends today = soft, ended = accent. */
const LIGHT_TONE: Record<GraceLight, "primary" | "soft" | "accent"> = {
  green: "primary",
  yellow: "soft",
  red: "accent",
};

function lightTone(light: GraceLight | null): "primary" | "soft" | "accent" | "none" {
  return light ? LIGHT_TONE[light] : "none";
}

/** The status light in front of a student. */
function GraceLightDot({ light }: { light: GraceLight | null }) {
  if (!light) return null;
  const label = GRACE_LIGHT_LABELS[light];
  return (
    <span
      className="tp-modal__light"
      data-tone={LIGHT_TONE[light]}
      data-pulse={light === "yellow"}
      role="img"
      aria-label={label}
      title={label}
    />
  );
}

type StudentIdentityProps = {
  name: string;
  telegram: string;
  username: string;
  createdAt: string;
  light: GraceLight | null;
  lock?: StudentLock | null;
};

/** The student card shows only: name, Telegram (opens the app) and registration date. */
function StudentIdentity({ name, telegram, username, createdAt, light, lock = null }: StudentIdentityProps) {
  const handle = describeTelegramHandle({ telegram, username });
  return (
    <div className="tp-modal__identity">
      <strong className="tp-modal__name">
        <GraceLightDot light={light} />
        <span className="tp-modal__name-text">{name}</span>
        {lock && <LockTag lock={lock} />}
      </strong>
      <div className="tp-modal__meta">
        {handle.href ? (
          <a className="tp-modal__tg" href={handle.href} dir="ltr" aria-label={`فتح محادثة تيليجرام مع ${name}`}>
            <Send aria-hidden="true" />@{handle.value}
          </a>
        ) : (
          <span className="tp-modal__tg" data-plain="true" dir={handle.value ? "ltr" : undefined}>
            <Send aria-hidden="true" />{handle.value || "بدون تيليجرام"}
          </span>
        )}
        <span className="tp-modal__meta-item">
          <CalendarDays aria-hidden="true" />تاريخ التسجيل <b dir="ltr">{registrationDateLabel(createdAt)}</b>
        </span>
      </div>
    </div>
  );
}

export function GracePeriodsDialog({ open, onOpenChange, canManage }: Props) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<GraceStudentSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [searchToday, setSearchToday] = useState("");
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
        if (!controller.signal.aborted) {
          setResults(response.students || []);
          setSearchToday(response.today || "");
        }
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
  const studentLight = data ? studentGraceLight(activePeriods, today) : null;
  const currentLight = currentPeriod ? gracePeriodLight(currentPeriod, today) : null;
  const lock = studentLock(data?.student.status);

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
    if (!canManage || period.cancelledAt) return null;
    const locked = Boolean(lock) || busy;
    return (
      <div className="tp-grace__period-actions" title={lock?.hint}>
        <Button type="button" size="sm" variant="outline" onClick={() => startUpdate(period)} disabled={locked}>
          <PencilLine className="size-4" aria-hidden="true" />تعديل
        </Button>
        <Button type="button" size="sm" variant="ghost" data-tone="accent" onClick={() => startCancel(period)} disabled={locked}>
          <XCircle className="size-4" aria-hidden="true" />إلغاء
        </Button>
      </div>
    );
  }

  function searchResultLight(student: GraceStudentSearchResult): GraceLight | null {
    if (student.graceState === "current") return student.graceEndDate === searchToday ? "yellow" : "green";
    return student.graceState === "past" ? "red" : null;
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="tp-modal tp-grace" dir="rtl">
        <div className="tp-modal__hero">
          <span className="tp-modal__hero-icon" aria-hidden="true"><CalendarClock /></span>
          <DialogHeader className="tp-modal__heading">
            <DialogTitle>إدارة فترة السماح</DialogTitle>
          </DialogHeader>
        </div>

        <div className="tp-modal__body">
          {!data && (
            <>
              <section className="tp-modal__section" aria-label="البحث عن طالب">
                <div className="tp-modal__input-wrap">
                  <Search aria-hidden="true" />
                  <Input
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="ابحث بالاسم أو الكود أو اليوزر أو الهاتف"
                    aria-label="البحث عن طالب"
                    className="tp-modal__search-input"
                    autoFocus
                  />
                  {searching && <Loader2 className="tp-modal__spinner animate-spin motion-reduce:animate-none" aria-hidden="true" />}
                </div>
                {searchError && <p role="alert" className="tp-modal__error"><AlertCircle aria-hidden="true" />{searchError}</p>}
                {loadError && <p role="alert" className="tp-modal__error"><AlertCircle aria-hidden="true" />{loadError}</p>}
                {query.trim().length >= 2 && !searching && results.length === 0 && !searchError && (
                  <p className="tp-modal__muted">لا يوجد طالب يطابق البحث.</p>
                )}
                {results.length > 0 && (
                  <div className="tp-modal__section">
                    <h3 className="tp-modal__eyebrow">الطلاب</h3>
                    <ul className="tp-modal__cards">
                      {results.map((student) => {
                        const light = searchResultLight(student);
                        const lock = studentLock(student.status);
                        return (
                          <li key={student.id} className="tp-modal__card" data-tone={lightTone(light)} data-locked={lock?.kind || "none"}>
                            <button
                              type="button"
                              className="tp-modal__card-open"
                              onClick={() => void loadStudent(student.id)}
                              disabled={loading || Boolean(lock)}
                              aria-disabled={Boolean(lock)}
                              aria-label={lock ? `${student.name}: ${lock.hint}` : `فتح فترات السماح للطالب ${student.name}`}
                              title={lock?.hint}
                            />
                            <StudentIdentity
                              name={student.name}
                              telegram={student.telegram}
                              username={student.username}
                              createdAt={student.createdAt}
                              light={light}
                              lock={lock}
                            />
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                )}
              </section>

              <section className="tp-modal__section" aria-labelledby="tp-grace-list">
                <div className="tp-modal__section-head">
                  <h3 id="tp-grace-list" className="tp-modal__title">
                    {listQuery ? "فترات السماح للطلاب المطابقين للبحث" : "فترات السماح"}
                  </h3>
                  <span className="tp-modal__muted">من الأحدث إلى الأقدم</span>
                </div>
                <div role="group" aria-label="تصفية فترات السماح" className="tp-modal__filters">
                  {GRACE_PERIOD_LIST_FILTERS.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      className="tp-modal__filter"
                      aria-pressed={listFilter === option.value}
                      data-filter={option.value}
                      data-tone={option.value === "current" ? "primary" : option.value === "past" ? "accent" : undefined}
                      onClick={() => setListFilter(option.value)}
                    >
                      {option.value !== "all" && <span className="tp-modal__filter-dot" aria-hidden="true" />}
                      <span className="tp-modal__filter-label">{option.label}</span>
                      <span className="tp-modal__filter-count">{list ? list.counts[option.value] : "…"}</span>
                    </button>
                  ))}
                </div>
                {listError && <p role="alert" className="tp-modal__error"><AlertCircle aria-hidden="true" />{listError}</p>}
                {listLoading && !list && (
                  <p role="status" className="tp-modal__status">
                    <Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /> جارٍ تحميل فترات السماح…
                  </p>
                )}
                {list && list.periods.length === 0 && !listLoading && (
                  <p className="tp-modal__empty-note">
                    {listFilter === "current"
                      ? "لا توجد فترات سماح مستمرة."
                      : listFilter === "past"
                        ? "لا توجد فترات سماح منتهية."
                        : "لا توجد فترات سماح."}
                  </p>
                )}
                {list && list.periods.length > 0 && (
                  <ul className="tp-modal__cards" aria-busy={listLoading}>
                    {list.periods.map((period) => {
                      const light = gracePeriodLight(period, list.today);
                      const lock = studentLock(period.studentStatus);
                      return (
                        <li key={period.id} className="tp-modal__card" data-tone={lightTone(light)} data-locked={lock?.kind || "none"}>
                          <button
                            type="button"
                            className="tp-modal__card-open"
                            onClick={() => void loadStudent(period.studentId)}
                            disabled={loading || Boolean(lock)}
                            aria-disabled={Boolean(lock)}
                            aria-label={lock ? `${period.studentName}: ${lock.hint}` : `فتح فترات السماح للطالب ${period.studentName}`}
                            title={lock?.hint}
                          />
                          <StudentIdentity
                            name={period.studentName}
                            telegram={period.studentTelegram}
                            username={period.studentUsername}
                            createdAt={period.studentCreatedAt}
                            light={light}
                            lock={lock}
                          />
                          <div className="tp-modal__card-foot">
                            <span className="tp-grace__range-cell" dir="ltr">{formatGracePeriod(period)}</span>
                            <span className="tp-modal__muted">{formatGraceDays(gracePeriodDays(period))}</span>
                            <span className="tp-modal__chip" data-tone={LIGHT_TONE[light]}>
                              {light === "red" ? "منتهية" : describeGraceRemaining(period, list.today)}
                            </span>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
                {list?.truncated && (
                  <p className="tp-modal__muted">تُعرض أحدث {list.periods.length} فترة فقط؛ استخدم البحث لتضييق القائمة.</p>
                )}
              </section>
            </>
          )}

          {data && (
            <>
              <section className="tp-grace__student" data-tone={lightTone(studentLight)} data-locked={lock?.kind || "none"} aria-label="الطالب">
                <StudentIdentity
                  name={data.student.name}
                  telegram={data.student.telegram}
                  username={data.student.username}
                  createdAt={data.student.createdAt}
                  light={studentLight}
                  lock={lock}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="tp-grace__back"
                  onClick={() => { setData(null); setEditor(null); setPreview(null); }}
                  disabled={busy}
                >
                  <ArrowRight className="size-4" aria-hidden="true" />رجوع للقائمة
                </Button>
              </section>

              {lock && <p role="note" className="tp-modal__note" data-tone={lock.kind === "dismissed" ? "accent" : undefined}>{lock.hint}.</p>}

              <section className="tp-modal__section" aria-labelledby="tp-grace-current">
                <h3 id="tp-grace-current" className="tp-modal__title">الفترة الحالية</h3>
                {currentPeriod ? (
                  <div className="tp-grace__current" data-tone={currentLight === "yellow" ? "soft" : "primary"}>
                    <div className="tp-grace__current-main">
                      <span className="tp-grace__badge">
                        <GraceLightDot light={currentLight} />
                        {currentLight === "yellow" ? "تنتهي اليوم" : "فترة مستمرة"}
                      </span>
                      <p className="tp-grace__range" dir="ltr">{formatGracePeriod(currentPeriod)}</p>
                      <p className="tp-modal__muted">
                        {formatGraceDays(gracePeriodDays(currentPeriod))} · {describeGraceRemaining(currentPeriod, today)}
                      </p>
                    </div>
                    {renderPeriodActions(currentPeriod)}
                  </div>
                ) : (
                  <div className="tp-grace__empty">
                    <p>لا توجد فترة سماح حالية</p>
                    {canManage && !editor && (
                      <Button type="button" onClick={startCreate} disabled={busy || Boolean(lock)} title={lock?.hint}>
                        <CalendarPlus className="size-4" aria-hidden="true" />إضافة فترة سماح
                      </Button>
                    )}
                  </div>
                )}
                {currentPeriod && canManage && !editor && (
                  <Button type="button" variant="outline" size="sm" className="tp-grace__add-more" onClick={startCreate} disabled={busy || Boolean(lock)} title={lock?.hint}>
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
                      <label className="tp-modal__field">
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
                      <div className="tp-modal__fields">
                        <label className="tp-modal__field">
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
                          <label className="tp-modal__field">
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
                            <label className="tp-modal__field">
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
                            <div className="tp-modal__field">
                              <span>إلى</span>
                              <p className="tp-grace__computed" dir="ltr">{proposed?.endDate ? formatGraceDate(proposed.endDate) : "—"}</p>
                            </div>
                          </>
                        )}
                      </div>
                      {validation && (proposed?.startDate && (editor.mode === "days" ? editor.days : editor.endDate)) ? (
                        <p role="alert" className="tp-modal__error"><AlertCircle aria-hidden="true" />{validation}</p>
                      ) : proposedDays > 0 && proposed && !preview ? (
                        <p className="tp-modal__summary">
                          الطالب سيكون ضمن فترة السماح من <span dir="ltr">{formatGraceDate(proposed.startDate)}</span> إلى{" "}
                          <span dir="ltr">{formatGraceDate(proposed.endDate)}</span> — {formatGraceDays(proposedDays)}.
                        </p>
                      ) : null}
                    </>
                  )}

                  {actionError && <p role="alert" className="tp-modal__error"><AlertCircle aria-hidden="true" />{actionError}</p>}

                  {preview && (
                    <div className="tp-grace__preview" aria-live="polite">
                      <p className="tp-modal__summary">{preview.summary}</p>
                      {preview.affectedExams.length === 0 ? (
                        <p className="tp-modal__muted">لا يؤثر هذا التعديل على أي امتحان موجود.</p>
                      ) : (
                        <>
                          <p><strong>سيؤثر هذا التعديل على {preview.affectedExams.length} امتحان:</strong></p>
                          <ul className="tp-grace__impact">
                            {preview.affectedExams.map((exam) => (
                              <li key={exam.examId} data-change={exam.change}>
                                <span className="tp-grace__impact-name">{exam.examName}</span>
                                <span className="tp-modal__muted" dir="ltr">{examDateLabel(exam.examDate)}</span>
                                <span className="tp-modal__muted">النتيجة المسجلة: {exam.result}</span>
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
                        <p className="tp-modal__muted">لا تغيير على فرص الطالب أو حالته.</p>
                      )}
                    </div>
                  )}

                  <div className="tp-modal__actions">
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
                      <Button type="button" onClick={() => void confirmSave()} disabled={busy} data-tone={editor.action === "cancel" ? "accent" : undefined}>
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

              <section className="tp-modal__section" aria-labelledby="tp-grace-history">
                <h3 id="tp-grace-history" className="tp-modal__title">الفترات السابقة</h3>
                {historyPeriods.length === 0 ? (
                  <p className="tp-modal__empty-note">لا توجد فترات سابقة.</p>
                ) : (
                  <ul className="tp-grace__history">
                    {historyPeriods.map((period) => {
                      const cancelled = Boolean(period.cancelledAt);
                      const light = gracePeriodLight(period, today);
                      const tone = cancelled ? "none" : LIGHT_TONE[light];
                      return (
                        <li key={period.id} className="tp-grace__history-row" data-cancelled={cancelled}>
                          <span className="tp-modal__light" data-tone={tone} aria-hidden="true" />
                          <div className="tp-grace__history-main">
                            <span dir="ltr" className="tp-grace__range-cell">{formatGracePeriod(period)}</span>
                            <span className="tp-modal__muted">{formatGraceDays(gracePeriodDays(period))}</span>
                          </div>
                          <span className="tp-grace__history-state" data-tone={tone}>
                            {cancelled
                              ? `ملغاة${period.cancelledByName ? ` — ${period.cancelledByName}` : ""} · ${formatBaghdadDateTime(period.cancelledAt)}${period.cancelReason ? ` · ${period.cancelReason}` : ""}`
                              : light === "red"
                                ? period.source === "legacy" ? "منتهية (من النظام القديم)" : "منتهية"
                                : describeGraceRemaining(period, today)}
                          </span>
                          {renderPeriodActions(period)}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </section>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
