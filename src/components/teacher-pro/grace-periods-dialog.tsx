"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { flushSync } from "react-dom";
import {
  AlertCircle,
  ArrowLeft,
  CalendarCheck,
  CalendarClock,
  CalendarDays,
  CalendarPlus,
  CalendarX2,
  CheckCircle2,
  ChevronLeft,
  Hourglass,
  Loader2,
  Lock,
  MessageCircle,
  PencilLine,
  Search,
  Send,
  UserPlus,
  X,
  XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { DateInput } from "@/components/ui/date-input";
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
  isEndedNewStudentGrace,
  isNewStudentGracePeriod,
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
import { toLatinDigits } from "@/lib/format";
import { emitTeacherProDataChanged } from "@/lib/teacherpro-sync";
import { toast } from "@/lib/user-toast";
import { describeTelegramHandle } from "./student-registry-helpers";
import { EmptyState } from "./ui-kit";
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

/** One tap for the usual lengths. */
const QUICK_GRACE_DAYS = [1, 3, 7, 14, 30].filter((days) => days <= MAX_GRACE_PERIOD_DAYS);

/** The word under a ready length's number: 1 يوم، 3 أيام، 14 يوماً. */
function quickDaysUnit(days: number): string {
  if (days === 1) return "يوم";
  if (days === 2) return "يومان";
  return days <= 10 ? "أيام" : "يوماً";
}

/** Days typed in Arabic or English digits, kept as plain digits. */
function cleanDays(value: string): string {
  return toLatinDigits(value).replace(/\D/g, "").slice(0, 3);
}

/** The last save, shown with one tap to the next student. */
type SavedNote = { name: string; startDate: string; endDate: string; days: number };

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
  "مفصول": { kind: "dismissed", tag: "مفصول", hint: "الطالب مفصول — يحتاج إرجاع أولاً" },
};

function studentLock(status: string | null | undefined): StudentLock | null {
  return STUDENT_LOCKS[String(status || "")] || null;
}

/** Signal tone of each light: ongoing = green, ends today = amber, ended = red. */
const LIGHT_TONE: Record<GraceLight, "success" | "warning" | "danger"> = {
  green: "success",
  yellow: "warning",
  red: "danger",
};

function lightTone(light: GraceLight | null): "success" | "warning" | "danger" | "none" {
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
      data-pulse={light !== "red"}
      role="img"
      aria-label={label}
      title={label}
    />
  );
}

type CardState = { tone: "success" | "warning" | "danger" | "none"; icon: ReactNode; label: string };

/** The state pill of a period: مستمرة / تنتهي اليوم / منتهية. */
function periodState(light: GraceLight): CardState {
  if (light === "yellow") return { tone: "warning", icon: <Hourglass aria-hidden="true" />, label: "تنتهي اليوم" };
  if (light === "red") return { tone: "danger", icon: <CalendarX2 aria-hidden="true" />, label: "منتهية" };
  return { tone: "success", icon: <CalendarCheck aria-hidden="true" />, label: "مستمرة" };
}

type GraceCardHeadProps = {
  name: string;
  light: GraceLight | null;
  lock: StudentLock | null;
  state?: CardState | null;
  children?: ReactNode;
};

/** The card's first line: light, name, then the lock and state pills. */
function GraceCardHead({ name, light, lock, state = null, children }: GraceCardHeadProps) {
  return (
    <header className="tp-grace-card__head">
      <span className="tp-grace-card__who">
        <GraceLightDot light={light} />
        <b className="tp-grace-card__name">{name}</b>
      </span>
      {lock && (
        <span className="tp-grace-card__pill" data-tone={lock.kind === "dismissed" ? "danger" : "none"} title={lock.hint}>
          <Lock aria-hidden="true" />{lock.tag}
        </span>
      )}
      {state && <span className="tp-grace-card__pill" data-tone={state.tone}>{state.icon}{state.label}</span>}
      {children}
    </header>
  );
}

type StudentFactsProps = {
  name: string;
  telegram: string;
  username: string;
  createdAt: string;
};

/** The student facts shown on every card: Telegram (opens the app) and registration date. */
function StudentFacts({ name, telegram, username, createdAt }: StudentFactsProps) {
  const handle = describeTelegramHandle({ telegram, username });
  return (
    <div className="tp-grace-card__facts">
      <div className="tp-grace-card__fact">
        <span className="tp-grace-card__fact-label"><MessageCircle aria-hidden="true" />التواصل</span>
        {handle.href ? (
          <a className="tp-grace-card__tg" href={handle.href} dir="ltr" aria-label={`فتح محادثة تيليجرام مع ${name}`}>
            <Send aria-hidden="true" />@{handle.value}
          </a>
        ) : (
          <span className="tp-grace-card__tg" data-plain="true" dir={handle.value ? "ltr" : undefined}>
            <Send aria-hidden="true" />{handle.value || "بدون تيليجرام"}
          </span>
        )}
      </div>
      <div className="tp-grace-card__fact">
        <span className="tp-grace-card__fact-label"><CalendarDays aria-hidden="true" />تاريخ التسجيل</span>
        <b className="tp-grace-card__date">{registrationDateLabel(createdAt)}</b>
      </div>
    </div>
  );
}

/** «من … ← إلى …», each date on its own. */
function PeriodDates({ period }: { period: Pick<GracePeriodRecord, "startDate" | "endDate"> }) {
  return (
    <span className="tp-grace-dates">
      <span className="tp-grace-dates__one"><small>من</small><b>{formatGraceDate(period.startDate)}</b></span>
      <ArrowLeft className="tp-grace-dates__arrow" aria-hidden="true" />
      <span className="tp-grace-dates__one"><small>إلى</small><b>{formatGraceDate(period.endDate)}</b></span>
    </span>
  );
}

/** The open tile of a list card; the whole card is the button, this is its sign. */
function OpenTile({ lock, canManage }: { lock: StudentLock | null; canManage: boolean }) {
  return (
    <span className="tp-grace-card__open" aria-hidden="true">
      <span className="tp-grace-card__open-icon">{lock ? <Lock /> : <ChevronLeft />}</span>
      <span className="tp-grace-card__open-text">{lock ? "مقفل" : "فترات الطالب"}</span>
      <span className="tp-grace-card__open-hint">
        {lock ? (lock.kind === "dismissed" ? "يحتاج إرجاع أولاً" : "لا يمكن التعديل") : canManage ? "عرض وإضافة وتعديل" : "عرض الفترات"}
      </span>
    </span>
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
  const [lastSaved, setLastSaved] = useState<SavedNote | null>(null);
  const loadSequence = useRef(0);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const nextButtonRef = useRef<HTMLButtonElement>(null);

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
    setLastSaved(null);
  }, [open]);

  // The list follows the filter and the search text; it is re-read whenever
  // the operator comes back from a student, so saved changes show up at once.
  // Codes and phones may be typed in Arabic digits; the system reads them in English.
  const trimmedQuery = toLatinDigits(query).trim();
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
    const trimmed = toLatinDigits(query).trim();
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

  // After a save the note and «سجّل طالب ثاني» come into view, ready for one tap.
  useEffect(() => {
    if (!lastSaved) return;
    const button = nextButtonRef.current;
    button?.closest(".tp-grace__saved")?.scrollIntoView({ block: "nearest" });
    button?.focus({ preventScroll: true });
  }, [lastSaved]);

  const loadStudent = useCallback(async (studentId: string, options: { openEditor?: boolean } = {}) => {
    const sequence = ++loadSequence.current;
    setLoading(true);
    setLoadError("");
    try {
      const response = await gracePeriodsApi.load(studentId);
      if (sequence !== loadSequence.current) return;
      setData(response);
      setLastSaved(null);
      // A student with no grace running gets the add form straight away.
      const hasCurrent = response.periods.some((period) =>
        !period.cancelledAt && gracePeriodState(period, response.today) === "current");
      if (options.openEditor && canManage && !hasCurrent && !studentLock(response.student.status)) {
        setEditor({ action: "create", mode: "range", startDate: response.today, endDate: "", days: "", cancelReason: "" });
        setPreview(null);
        setActionError("");
      }
    } catch (cause) {
      if (sequence === loadSequence.current) {
        setLoadError(cause instanceof Error ? cause.message : "تعذر تحميل فترات السماح.");
      }
    } finally {
      if (sequence === loadSequence.current) setLoading(false);
    }
  }, [canManage]);

  /** Closes the open student; a load still on its way is dropped. */
  function closeStudent() {
    loadSequence.current += 1;
    setLoading(false);
    setLoadError("");
    setData(null);
    setEditor(null);
    setPreview(null);
    setActionError("");
    setLastSaved(null);
  }

  /** Back to the search (the «خروج» and «سجّل طالب ثاني» buttons): focused at
   * once so the phone's keyboard opens. «خروج» brings back the last search,
   * selected, so typing replaces it. */
  function leaveStudent(clearSearch: boolean) {
    flushSync(() => {
      closeStudent();
      if (clearSearch) setQuery("");
    });
    const input = searchInputRef.current;
    if (input) {
      input.focus();
      if (!clearSearch) input.select();
    }
  }

  function openStudent(studentId: string) {
    setEditor(null);
    setPreview(null);
    void loadStudent(studentId, { openEditor: true });
  }

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
  const studentLight = data
    ? studentGraceLight(activePeriods.filter((period) => !isEndedNewStudentGrace(period, today)), today)
    : null;
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

  /** «حفظ»: when the change touches no exam and no balance it is saved at
   * once; otherwise its effect is shown first for «تأكيد الحفظ». A cancel is
   * always shown first. */
  async function runPreview() {
    const input = changeInput();
    if (!input) return;
    setBusy(true);
    setActionError("");
    let next: GraceChangePreview;
    try {
      next = await gracePeriodsApi.preview(input);
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : "تعذر معاينة التعديل.");
      setBusy(false);
      return;
    }
    const unchanged = !next.projection || (
      next.projection.current.opportunities === next.projection.projected.opportunities &&
      next.projection.current.status === next.projection.projected.status
    );
    if (input.action !== "cancel" && next.affectedExams.length === 0 && unchanged) {
      await applyChange(input, next);
      return;
    }
    setPreview(next);
    setBusy(false);
  }

  async function confirmSave() {
    const input = changeInput();
    if (!input || !preview) return;
    await applyChange(input, preview);
  }

  async function applyChange(input: GraceChangeInput, approved: GraceChangePreview) {
    if (!data) return;
    setBusy(true);
    setActionError("");
    try {
      const result = await gracePeriodsApi.apply({ ...input, previewToken: approved.previewToken });
      setData({ ...data, periods: result.periods });
      setEditor(null);
      setPreview(null);
      setLastSaved(input.action === "cancel" || !input.startDate || !input.endDate ? null : {
        name: data.student.name,
        startDate: input.startDate,
        endDate: input.endDate,
        days: gracePeriodDays({ startDate: input.startDate, endDate: input.endDate }),
      });
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
        <Button type="button" size="sm" variant="ghost" data-tone="danger" onClick={() => startCancel(period)} disabled={locked}>
          <XCircle className="size-4" aria-hidden="true" />إلغاء
        </Button>
      </div>
    );
  }

  function searchResultLight(student: GraceStudentSearchResult): GraceLight | null {
    if (student.graceState === "current") return student.graceEndDate === searchToday ? "yellow" : "green";
    return student.graceState === "past" ? "red" : null;
  }

  function searchResultState(student: GraceStudentSearchResult, light: GraceLight | null): CardState {
    if (light === "yellow") return periodState("yellow");
    if (light === "green" && student.graceEndDate) {
      return { tone: "success", icon: <CalendarCheck aria-hidden="true" />, label: `ضمن فترة سماح حتى ${formatGraceDate(student.graceEndDate)}` };
    }
    if (light === "red") return { tone: "danger", icon: <CalendarX2 aria-hidden="true" />, label: "فترات سماح منتهية" };
    return { tone: "none", icon: <CalendarClock aria-hidden="true" />, label: "بدون فترة سماح" };
  }

  /** A period as a toned panel: dates, length and what is left, with its actions. */
  function renderPeriodPanel(
    period: Pick<GracePeriodRecord, "startDate" | "endDate"> & { note?: string },
    options: { eyebrow: string; tone: "success" | "warning" | "danger" | "none"; remaining?: string; actions?: ReactNode; note?: ReactNode; cancelled?: boolean },
  ) {
    return (
      <div className="tp-grace-period" data-tone={options.tone} data-cancelled={options.cancelled || undefined}>
        <span className="tp-grace-period__icon" aria-hidden="true"><CalendarClock /></span>
        <div className="tp-grace-period__when">
          <span className="tp-grace-period__eyebrow">{options.eyebrow}</span>
          <PeriodDates period={period} />
          {/* Added by the system to every new student from their registration day. */}
          {isNewStudentGracePeriod(period) && (
            <span className="tp-grace-period__auto">أُضيفت تلقائياً للطالب الجديد من تاريخ تسجيله</span>
          )}
        </div>
        <div className="tp-grace-period__length">
          <b>{formatGraceDays(gracePeriodDays(period))}</b>
          {options.remaining && <span>{options.remaining}</span>}
        </div>
        {options.actions}
        {options.note}
      </div>
    );
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
          {/* Always here, so the next student is one search away. */}
          <section className="tp-modal__section tp-grace__search" aria-label="البحث عن طالب">
            <div className="tp-modal__input-wrap">
              <Search aria-hidden="true" />
              <Input
                ref={searchInputRef}
                // Empty while a student is open: typing starts the next search.
                value={data ? "" : query}
                onChange={(event) => {
                  setQuery(event.target.value);
                  // Typing another name leaves the open student for the results.
                  if (data || loading) closeStudent();
                }}
                onKeyDown={(event) => {
                  if (event.key !== "Enter" || data) return;
                  const first = results.find((student) => !studentLock(student.status));
                  if (first && !loading) {
                    event.preventDefault();
                    openStudent(first.id);
                  }
                }}
                placeholder={data ? "ابحث عن طالب ثاني" : "ابحث بالاسم أو الكود أو اليوزر أو الهاتف"}
                aria-label="البحث عن طالب"
                className="tp-modal__search-input"
                enterKeyHint="search"
                autoComplete="off"
                disabled={busy}
                autoFocus
              />
              {(searching || loading) && <Loader2 className="tp-modal__spinner animate-spin motion-reduce:animate-none" aria-hidden="true" />}
            </div>
          </section>

          {!data && (
            <>
              <section className="tp-modal__section" aria-label="نتائج البحث">
                {searchError && <p role="alert" className="tp-modal__error"><AlertCircle aria-hidden="true" />{searchError}</p>}
                {loadError && <p role="alert" className="tp-modal__error"><AlertCircle aria-hidden="true" />{loadError}</p>}
                {trimmedQuery.length >= 2 && !searching && results.length === 0 && !searchError && (
                  <p className="tp-modal__muted">لا يوجد طالب يطابق البحث.</p>
                )}
                {results.length > 0 && (
                  <div className="tp-modal__section">
                    <h3 className="tp-modal__eyebrow">الطلاب</h3>
                    <ul className="tp-grace-cards">
                      {results.map((student) => {
                        const light = searchResultLight(student);
                        const lock = studentLock(student.status);
                        return (
                          <li key={student.id} className="tp-grace-card" data-compact="true" data-tone={lightTone(light)} data-locked={lock?.kind || "none"}>
                            <button
                              type="button"
                              className="tp-modal__card-open"
                              onClick={() => openStudent(student.id)}
                              disabled={loading || Boolean(lock)}
                              aria-disabled={Boolean(lock)}
                              aria-label={lock ? `${student.name}: ${lock.hint}` : `فتح فترات السماح للطالب ${student.name}`}
                              title={lock?.hint}
                            />
                            <GraceCardHead name={student.name} light={light} lock={lock} state={searchResultState(student, light)} />
                            <div className="tp-grace-card__body">
                              <div className="tp-grace-card__main">
                                <StudentFacts
                                  name={student.name}
                                  telegram={student.telegram}
                                  username={student.username}
                                  createdAt={student.createdAt}
                                />
                              </div>
                              <OpenTile lock={lock} canManage={canManage} />
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                )}
              </section>

              <section className="tp-modal__section" aria-label={listQuery ? "فترات السماح للطلاب المطابقين للبحث" : "فترات السماح"}>
                <div role="group" aria-label="تصفية فترات السماح" className="tp-modal__chips">
                  {GRACE_PERIOD_LIST_FILTERS.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      className="tp-modal__filter"
                      aria-pressed={listFilter === option.value}
                      data-filter={option.value}
                      data-tone={option.value === "current" ? "success" : option.value === "past" ? "danger" : undefined}
                      onClick={() => setListFilter(option.value)}
                    >
                      {option.value !== "all" && <span className="tp-modal__filter-dot" aria-hidden="true" />}
                      <span className="tp-modal__filter-label">{option.label}</span>
                      <span className="tp-modal__filter-count">{list ? list.counts[option.value] : "…"}</span>
                    </button>
                  ))}
                </div>
                <div className="tp-modal__toolbar">
                  <span className="tp-modal__count" aria-live="polite">
                    {list
                      ? `المعروض ${list.periods.length} من ${list.counts.all} فترة${listQuery ? " للطلاب المطابقين للبحث" : ""} · من الأحدث إلى الأقدم`
                      : "فترات السماح"}
                  </span>
                </div>
                {listError && <p role="alert" className="tp-modal__error"><AlertCircle aria-hidden="true" />{listError}</p>}
                {listLoading && !list && (
                  <p role="status" className="tp-modal__status">
                    <Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /> جارٍ تحميل فترات السماح…
                  </p>
                )}
                {list && list.periods.length === 0 && !listLoading && (
                  <EmptyState
                    icon={CalendarClock}
                    title={listFilter === "current"
                      ? "لا توجد فترات سماح مستمرة."
                      : listFilter === "past"
                        ? "لا توجد فترات سماح منتهية."
                        : "لا توجد فترات سماح."}
                  />
                )}
                {list && list.periods.length > 0 && (
                  <ul className="tp-grace-cards" aria-busy={listLoading}>
                    {list.periods.map((period) => {
                      const light = gracePeriodLight(period, list.today);
                      const lock = studentLock(period.studentStatus);
                      return (
                        <li key={period.id} className="tp-grace-card" data-tone={lightTone(light)} data-locked={lock?.kind || "none"}>
                          <button
                            type="button"
                            className="tp-modal__card-open"
                            onClick={() => openStudent(period.studentId)}
                            disabled={loading || Boolean(lock)}
                            aria-disabled={Boolean(lock)}
                            aria-label={lock ? `${period.studentName}: ${lock.hint}` : `فتح فترات السماح للطالب ${period.studentName}`}
                            title={lock?.hint}
                          />
                          <GraceCardHead name={period.studentName} light={light} lock={lock} state={periodState(light)} />
                          <div className="tp-grace-card__body">
                            <div className="tp-grace-card__main">
                              {renderPeriodPanel(period, {
                                eyebrow: "فترة السماح",
                                tone: LIGHT_TONE[light],
                                remaining: light === "green" ? describeGraceRemaining(period, list.today) : "",
                              })}
                              <StudentFacts
                                name={period.studentName}
                                telegram={period.studentTelegram}
                                username={period.studentUsername}
                                createdAt={period.studentCreatedAt}
                              />
                            </div>
                            <OpenTile lock={lock} canManage={canManage} />
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
              <section className="tp-grace-card tp-grace__student" data-tone={lightTone(studentLight)} data-locked={lock?.kind || "none"} aria-label="الطالب">
                <GraceCardHead name={data.student.name} light={studentLight} lock={lock}>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="tp-grace__back"
                    onClick={() => leaveStudent(false)}
                    disabled={busy}
                  >
                    <X className="size-4" aria-hidden="true" />خروج
                  </Button>
                </GraceCardHead>
                <StudentFacts
                  name={data.student.name}
                  telegram={data.student.telegram}
                  username={data.student.username}
                  createdAt={data.student.createdAt}
                />
              </section>

              {lastSaved && (
                <div className="tp-grace__saved" role="status">
                  <CheckCircle2 className="tp-grace__saved-icon" aria-hidden="true" />
                  <p>
                    انحفظت فترة السماح لـ<b>{lastSaved.name}</b>: من <b>{formatGraceDate(lastSaved.startDate)}</b> إلى{" "}
                    <b>{formatGraceDate(lastSaved.endDate)}</b> · {formatGraceDays(lastSaved.days)}
                  </p>
                  <Button ref={nextButtonRef} type="button" className="tp-grace__next" onClick={() => leaveStudent(true)}>
                    <UserPlus className="size-4" aria-hidden="true" />سجّل طالب ثاني
                  </Button>
                </div>
              )}

              {lock && <p role="note" className="tp-modal__note" data-tone={lock.kind === "dismissed" ? "danger" : undefined}>{lock.hint}.</p>}

              <section className="tp-modal__section" aria-labelledby="tp-grace-current">
                <h3 id="tp-grace-current" className="tp-modal__title">الفترة الحالية</h3>
                {currentPeriod ? (
                  renderPeriodPanel(currentPeriod, {
                    eyebrow: currentLight === "yellow" ? "تنتهي اليوم" : "فترة مستمرة",
                    tone: currentLight === "yellow" ? "warning" : "success",
                    remaining: currentLight === "yellow" ? "" : describeGraceRemaining(currentPeriod, today),
                    actions: renderPeriodActions(currentPeriod),
                  })
                ) : (
                  <EmptyState
                    compact
                    icon={CalendarClock}
                    title="لا توجد فترة سماح حالية"
                    action={canManage && !editor ? (
                      <Button type="button" onClick={startCreate} disabled={busy || Boolean(lock)} title={lock?.hint}>
                        <CalendarPlus className="size-4" aria-hidden="true" />إضافة فترة سماح
                      </Button>
                    ) : null}
                  />
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
                      <div role="group" aria-label="مدة جاهزة" className="tp-grace__quick">
                        {QUICK_GRACE_DAYS.map((days) => (
                          <button
                            key={days}
                            type="button"
                            className="tp-grace__quick-day"
                            aria-pressed={editor.mode === "days" && editor.days === String(days)}
                            aria-label={formatGraceDays(days)}
                            disabled={Boolean(preview) || busy}
                            onClick={() => setEditor({ ...editor, mode: "days", days: String(days) })}
                          >
                            <b>{days}</b>
                            <small>{quickDaysUnit(days)}</small>
                          </button>
                        ))}
                      </div>
                      <div className="tp-modal__fields">
                        <label className="tp-modal__field">
                          <span>من</span>
                          <DateInput
                            value={editor.startDate}
                            max={today || undefined}
                            onChange={(value) => setEditor({ ...editor, startDate: value })}
                            disabled={Boolean(preview) || busy}
                          />
                        </label>
                        {editor.mode === "range" ? (
                          <label className="tp-modal__field">
                            <span>إلى</span>
                            <DateInput
                              value={editor.endDate}
                              min={editor.startDate || undefined}
                              onChange={(value) => setEditor({ ...editor, endDate: value })}
                              disabled={Boolean(preview) || busy}
                            />
                          </label>
                        ) : (
                          <>
                            <label className="tp-modal__field">
                              <span>عدد الأيام</span>
                              <Input
                                type="text"
                                inputMode="numeric"
                                pattern="[0-9]*"
                                autoComplete="off"
                                placeholder={`1 – ${MAX_GRACE_PERIOD_DAYS}`}
                                value={editor.days}
                                onChange={(event) => setEditor({ ...editor, days: cleanDays(event.target.value) })}
                                disabled={Boolean(preview) || busy}
                              />
                            </label>
                            <div className="tp-modal__field">
                              <span>إلى</span>
                              <p className="tp-grace__computed">{proposed?.endDate ? formatGraceDate(proposed.endDate) : "—"}</p>
                            </div>
                          </>
                        )}
                      </div>
                      {validation && (proposed?.startDate && (editor.mode === "days" ? editor.days : editor.endDate)) ? (
                        <p role="alert" className="tp-modal__error"><AlertCircle aria-hidden="true" />{validation}</p>
                      ) : proposedDays > 0 && proposed && !preview ? (
                        <p className="tp-modal__summary">
                          الطالب سيكون ضمن فترة السماح من <span>{formatGraceDate(proposed.startDate)}</span> إلى{" "}
                          <span>{formatGraceDate(proposed.endDate)}</span> — {formatGraceDays(proposedDays)}.
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
                                <span className="tp-modal__muted">{examDateLabel(exam.examDate)}</span>
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
                        {editor.action === "cancel" ? "معاينة الأثر" : "حفظ"}
                      </Button>
                    ) : (
                      <Button type="button" onClick={() => void confirmSave()} disabled={busy} data-tone={editor.action === "cancel" ? "danger" : undefined}>
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
                  <EmptyState compact icon={CalendarClock} title="لا توجد فترات سابقة." />
                ) : (
                  <ul className="tp-grace__history">
                    {historyPeriods.map((period) => {
                      const cancelled = Boolean(period.cancelledAt);
                      const light = gracePeriodLight(period, today);
                      const tone = cancelled ? "none" : LIGHT_TONE[light];
                      return (
                        <li key={period.id} className="tp-grace__history-item">
                          {renderPeriodPanel(period, {
                            eyebrow: cancelled
                              ? "فترة ملغاة"
                              : light === "red"
                                ? period.source === "legacy" ? "منتهية (من النظام القديم)" : "منتهية"
                                : describeGraceRemaining(period, today),
                            tone,
                            cancelled,
                            actions: renderPeriodActions(period),
                            note: cancelled ? (
                              <p className="tp-grace-period__note">
                                {`ملغاة${period.cancelledByName ? ` — ${period.cancelledByName}` : ""} · ${formatBaghdadDateTime(period.cancelledAt)}${period.cancelReason ? ` · ${period.cancelReason}` : ""}`}
                              </p>
                            ) : null,
                          })}
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
