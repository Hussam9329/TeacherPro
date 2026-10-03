"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  BookOpen,
  CalendarCheck,
  CalendarClock,
  CalendarPlus,
  CalendarRange,
  ChartColumn,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ClipboardList,
  GraduationCap,
  History,
  Loader2,
  Lock,
  MessageCircle,
  MoreHorizontal,
  PencilLine,
  Search,
  Send,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import type { StudentLeave } from "@/lib/teacher-store";
import { studentLeaveApi } from "@/lib/api";
import { formatAppDate } from "@/lib/format";
import { baghdadTodayKey } from "@/lib/baghdad-time";
import { formatOpportunityBalance } from "@/lib/opportunity-balance";
import { emitTeacherProDataChanged } from "@/lib/teacherpro-sync";
import { useTeacherProSyncKey } from "@/hooks/use-teacherpro-sync";
import { toast } from "@/lib/user-toast";
import { buildStudentLeavePreview, type StudentLeavePreviewExam } from "@/lib/student-leave-preview";
import {
  compareLeavesNewestFirst,
  STUDENT_LEAVE_LIST_FILTERS,
  STUDENT_LEAVE_STATE_LABELS,
  studentLeaveDays,
  studentLeaveState,
  summarizeStudentLeaves,
  type StudentLeaveDaySource,
  type StudentLeaveListFilter,
  type StudentLeaveState,
  type StudentLeaveSummary,
} from "@/lib/student-leave-status";
import { describeTelegramHandle } from "./student-registry-helpers";
import { EmptyState } from "./ui-kit";
import "./tp-modal.css";
import "./leaves-dialog.css";

/** Old «الإجازات» tab links land on the dashboard with ?dialog=leaves. */
export const LEAVES_DIALOG_QUERY = "leaves";
export const LEAVES_DIALOG_OPEN_EVENT = "teacherpro:open-leaves-dialog";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  canManage: boolean;
};

type LeaveStudentRow = {
  id: string;
  name: string;
  code: string;
  status: string;
  telegram: string;
  username: string;
  studyType: string;
  courseName: string;
  opportunities: number;
  opportunityLimit: number | null;
  leaves: StudentLeaveSummary;
};

type LeaveListResponse = {
  today: string;
  filter: StudentLeaveListFilter;
  counts: Record<StudentLeaveListFilter, number>;
  truncated: boolean;
  students: LeaveStudentRow[];
};

type LeaveContextStudent = {
  id: string;
  courseId: string;
  status: string;
  studyType?: string | null;
  mainSite?: string | null;
  subSite?: string | null;
  locationScope?: string | null;
  opportunities?: number;
};

type LeaveContext = { student: LeaveContextStudent; exams: StudentLeavePreviewExam[] };

type LeaveMode = "exam" | "period";

const leaveReasonOptions = ["حالة مرضية", "سفر", "حالة وفاة", "ظروف قاهرة", "أخرى"] as const;
type LeaveReasonOption = (typeof leaveReasonOptions)[number];

type LeaveForm = {
  /** Empty for a new leave. */
  leaveId: string;
  mode: LeaveMode;
  examId: string;
  /** Administrative day an exam leave was documented; never its scope. */
  documentDate: string;
  dateFrom: string;
  dateTo: string;
  reason: LeaveReasonOption;
  customReason: string;
  notes: string;
};

type RecordedLeave = StudentLeave & { createdAt?: string };

/** Light and chip tone of each state: running = green, upcoming = blue, ended = grey. */
const STATE_TONE: Record<StudentLeaveState, "success" | "info" | "muted"> = {
  active: "success",
  upcoming: "info",
  ended: "muted",
};

const STUDENT_STATE_TEXT: Record<StudentLeaveState, string> = {
  active: "إجازة سارية",
  upcoming: "إجازة قادمة",
  ended: "إجازات منتهية",
};

function leaveExamCountText(count: number): string {
  if (count === 1) return "امتحاناً واحداً";
  if (count === 2) return "امتحانين";
  if (count <= 10) return `${count} امتحانات`;
  return `${count} امتحاناً`;
}

function leaveCountText(count: number): string {
  if (count === 0) return "لا توجد إجازات";
  if (count === 1) return "إجازة واحدة";
  if (count === 2) return "إجازتان";
  if (count <= 10) return `${count} إجازات`;
  return `${count} إجازة`;
}

function dayKey(value: string | null | undefined): string {
  return String(value || "").slice(0, 10);
}

function daySource(leave: RecordedLeave): StudentLeaveDaySource & { createdAt?: string; id: string } {
  return {
    id: leave.id,
    leaveType: leave.leaveType,
    date: leave.date,
    dateFrom: leave.dateFrom,
    dateTo: leave.dateTo,
    examDate: (leave.exam?.date as string | undefined) || null,
    createdAt: leave.createdAt,
  };
}

function isPeriodLeave(leave: Pick<StudentLeave, "leaveType">): boolean {
  return (leave.leaveType || "exam") === "period";
}

/** «امتحان X بتاريخ Y» or «من X إلى Y». */
function leaveScopeText(leave: RecordedLeave): string {
  if (isPeriodLeave(leave)) {
    return `من ${formatAppDate(leave.dateFrom || leave.date)} إلى ${formatAppDate(leave.dateTo || leave.dateFrom || leave.date)}`;
  }
  const examDate = leave.exam?.date ? formatAppDate(leave.exam.date as string) : "تاريخ الامتحان غير متوفر";
  return `${leave.exam?.name || "امتحان محذوف"} — ${examDate}`;
}

const STATE_ICON: Record<StudentLeaveState, typeof CalendarCheck> = {
  active: CalendarCheck,
  upcoming: CalendarClock,
  ended: History,
};

function StateChip({ state }: { state: StudentLeaveState }) {
  const Icon = STATE_ICON[state];
  return (
    <span className="tp-leave-card__pill tp-leaves__state" data-tone={STATE_TONE[state]}>
      <Icon aria-hidden="true" />{STUDENT_LEAVE_STATE_LABELS[state]}
    </span>
  );
}

function StateLight({ state }: { state: StudentLeaveState | null }) {
  if (!state) return null;
  const label = STUDENT_STATE_TEXT[state];
  return (
    <span
      className="tp-modal__light"
      data-tone={STATE_TONE[state]}
      data-pulse={state === "active"}
      role="img"
      aria-label={label}
      title={label}
    />
  );
}

function StatusTag({ status }: { status: string }) {
  if (status !== "مؤرشف" && status !== "مفصول") return null;
  return (
    <span className="tp-leave-card__pill" data-tone={status === "مفصول" ? "danger" : "muted"}>
      <Lock aria-hidden="true" />{status}
    </span>
  );
}

/** The card's first line: light, name, code, then the status and leave-state pills. */
function LeaveCardHead({ student, children }: { student: LeaveStudentRow; children?: ReactNode }) {
  const state = student.leaves.state;
  const StateIcon = state ? STATE_ICON[state] : null;
  return (
    <header className="tp-leave-card__head">
      <span className="tp-leave-card__who">
        <StateLight state={state} />
        <b className="tp-leave-card__name">{student.name}</b>
      </span>
      <span className="tp-leave-card__sep" aria-hidden="true" />
      <b className="tp-leave-card__code" dir="ltr">{student.code || "—"}</b>
      <StatusTag status={student.status} />
      {state && StateIcon && (
        <span className="tp-leave-card__pill" data-tone={STATE_TONE[state]}>
          <StateIcon aria-hidden="true" />{STUDENT_STATE_TEXT[state]}
        </span>
      )}
      {children}
    </header>
  );
}

/** The Telegram button that opens the chat in the app. */
function TelegramButton({ student }: { student: LeaveStudentRow }) {
  const handle = describeTelegramHandle({ telegram: student.telegram, username: student.username });
  return handle.href ? (
    <a className="tp-leave-card__tg" href={handle.href} dir="ltr" aria-label={`فتح محادثة تيليجرام مع ${student.name}`}>
      <Send aria-hidden="true" />@{handle.value}
    </a>
  ) : (
    <span className="tp-leave-card__tg" data-plain="true" dir={handle.value ? "ltr" : undefined}>
      <Send aria-hidden="true" />{handle.value || "بدون تيليجرام"}
    </span>
  );
}

/** A student's leaves at a glance: how many, the newest, and how many of each state. */
function LeavesSummaryPanel({ summary }: { summary: StudentLeaveSummary }) {
  const tone = summary.state ? STATE_TONE[summary.state] : "muted";
  const counts = (["active", "upcoming", "ended"] as const).filter((state) => summary[state] > 0);
  return (
    <div className="tp-leave-panel" data-tone={tone}>
      <span className="tp-leave-panel__icon" aria-hidden="true"><CalendarCheck /></span>
      <div className="tp-leave-panel__main">
        <span className="tp-leave-panel__eyebrow">الإجازات</span>
        <b className="tp-leave-panel__title">{leaveCountText(summary.total)}</b>
        {summary.latestDay && <span className="tp-leave-panel__sub">أحدث إجازة تبدأ {formatAppDate(summary.latestDay)}</span>}
      </div>
      {counts.length > 0 && (
        <ul className="tp-leave-panel__counts" aria-label="عدد الإجازات حسب الحالة">
          {counts.map((state) => (
            <li key={state} data-tone={STATE_TONE[state]}>
              <span className="tp-leave-panel__dot" aria-hidden="true" />
              {STUDENT_LEAVE_STATE_LABELS[state]} <b>{summary[state]}</b>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** The open tile of a list card; the whole card is the button, this is its sign. */
function OpenTile({ canManage }: { canManage: boolean }) {
  return (
    <span className="tp-leave-card__open" aria-hidden="true">
      <span className="tp-leave-card__open-icon"><ChevronLeft /></span>
      <span className="tp-leave-card__open-text">إجازات الطالب</span>
      <span className="tp-leave-card__open-hint">{canManage ? "عرض وإضافة وتعديل" : "عرض الإجازات"}</span>
    </span>
  );
}

/** «من X ← إلى Y», each day on its own. */
function LeaveDates({ from, to }: { from: string; to: string }) {
  return (
    <span className="tp-leave-dates">
      <span className="tp-leave-dates__one"><small>من</small><b>{formatAppDate(from)}</b></span>
      <ArrowLeft className="tp-leave-dates__arrow" aria-hidden="true" />
      <span className="tp-leave-dates__one"><small>إلى</small><b>{formatAppDate(to)}</b></span>
    </span>
  );
}

/** The small menu on each leave: edit or delete. */
function LeaveActionsMenu({
  label,
  open,
  disabled,
  onToggle,
  onEdit,
  onDelete,
}: {
  label: string;
  open: boolean;
  disabled: boolean;
  onToggle: (open: boolean) => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const onToggleRef = useRef(onToggle);
  useEffect(() => {
    onToggleRef.current = onToggle;
  });
  useEffect(() => {
    if (!open) return;
    rootRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus();
    const closeOnOutside = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) onToggleRef.current(false);
    };
    document.addEventListener("pointerdown", closeOnOutside);
    return () => document.removeEventListener("pointerdown", closeOnOutside);
  }, [open]);

  return (
    <div className="tp-leaves__menu" ref={rootRef}>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="tp-leaves__menu-toggle"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`خيارات ${label}`}
        onClick={() => onToggle(!open)}
        disabled={disabled}
      >
        <MoreHorizontal aria-hidden="true" />
      </Button>
      {open && (
        <div role="menu" aria-label={`خيارات ${label}`} className="tp-leaves__menu-list">
          <button type="button" role="menuitem" className="tp-leaves__menu-item" onClick={onEdit}>
            <PencilLine aria-hidden="true" />تعديل
          </button>
          <button type="button" role="menuitem" className="tp-leaves__menu-item" data-tone="danger" onClick={onDelete}>
            <Trash2 aria-hidden="true" />حذف
          </button>
        </div>
      )}
    </div>
  );
}

function emptyForm(today: string): LeaveForm {
  return {
    leaveId: "",
    mode: "exam",
    examId: "",
    documentDate: today,
    dateFrom: today,
    dateTo: today,
    reason: "حالة مرضية",
    customReason: "",
    notes: "",
  };
}

function formFromLeave(leave: RecordedLeave, today: string): LeaveForm {
  const period = isPeriodLeave(leave);
  const knownReason = (leaveReasonOptions as readonly string[]).includes(leave.reason);
  return {
    leaveId: leave.id,
    mode: period ? "period" : "exam",
    examId: period ? "" : String(leave.examId || ""),
    documentDate: dayKey(leave.date) || today,
    dateFrom: dayKey(leave.dateFrom || leave.date) || today,
    dateTo: dayKey(leave.dateTo || leave.dateFrom || leave.date) || today,
    reason: knownReason ? (leave.reason as LeaveReasonOption) : "أخرى",
    customReason: knownReason ? "" : leave.reason || "",
    notes: String(leave.notes || ""),
  };
}

export function LeavesDialog({ open, onOpenChange, canManage }: Props) {
  const syncKey = useTeacherProSyncKey(["follow-up", "students", "grades", "exams"]);

  // Student cards
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<StudentLeaveListFilter>("all");
  const [list, setList] = useState<LeaveListResponse | null>(null);
  const [listLoading, setListLoading] = useState(false);
  const [listError, setListError] = useState("");
  const [listRefreshKey, setListRefreshKey] = useState(0);

  // The opened student
  const [student, setStudent] = useState<LeaveStudentRow | null>(null);
  const studentId = student?.id || "";
  const [leaveRows, setLeaveRows] = useState<RecordedLeave[]>([]);
  const [selectedLeavesLoading, setSelectedLeavesLoading] = useState(false);
  const [selectedLeavesError, setSelectedLeavesError] = useState("");
  const [leaveContext, setLeaveContext] = useState<LeaveContext | null>(null);
  const [leaveContextLoading, setLeaveContextLoading] = useState(false);
  const [leaveContextError, setLeaveContextError] = useState("");
  const [leaveRefreshKey, setLeaveRefreshKey] = useState(0);

  // Add / edit / delete
  const [form, setForm] = useState<LeaveForm | null>(null);
  const [leaveSaving, setLeaveSaving] = useState(false);
  const [deletingId, setDeletingId] = useState("");
  const [confirmDeleteId, setConfirmDeleteId] = useState("");
  const [menuLeaveId, setMenuLeaveId] = useState("");
  const leaveOperationRef = useRef(false);
  const leaveMutationVersionRef = useRef(0);
  const leaveListAbortRef = useRef<AbortController | null>(null);
  const leaveContextAbortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (open) return;
    setQuery("");
    setFilter("all");
    setList(null);
    setListError("");
    setStudent(null);
    setForm(null);
    setConfirmDeleteId("");
    setMenuLeaveId("");
  }, [open]);

  // Cards follow the filter and the search; they are re-read whenever the
  // operator comes back from a student, so saved changes show up at once.
  const trimmedQuery = query.trim();
  const listQuery = trimmedQuery.length >= 2 ? trimmedQuery : "";
  useEffect(() => {
    if (!open || studentId) return;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setListLoading(true);
      setListError("");
      try {
        const params = new URLSearchParams({ filter });
        if (listQuery) params.set("q", listQuery);
        const response = await fetch(`/api/student-leaves/students?${params.toString()}`, {
          credentials: "same-origin",
          cache: "no-store",
          signal: controller.signal,
        });
        const payload = await response.json().catch(() => null);
        if (!response.ok) throw new Error(payload?.error || "تعذر تحميل قائمة الإجازات.");
        if (!controller.signal.aborted) setList(payload as LeaveListResponse);
      } catch (cause) {
        if (!controller.signal.aborted) {
          setListError(cause instanceof Error && cause.message ? cause.message : "تعذر تحميل قائمة الإجازات.");
        }
      } finally {
        if (!controller.signal.aborted) setListLoading(false);
      }
    }, listQuery ? 300 : 0);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [open, studentId, filter, listQuery, listRefreshKey, syncKey]);

  // The student's complete leave history from the database: the list shows it
  // and overlap checks use it. Never check overlap against one list page.
  useEffect(() => {
    if (!open || !studentId) {
      setLeaveRows([]); setSelectedLeavesLoading(false); setSelectedLeavesError("");
      return;
    }
    if (leaveOperationRef.current) return;
    const controller = new AbortController();
    leaveListAbortRef.current = controller;
    const version = leaveMutationVersionRef.current;
    setSelectedLeavesLoading(true); setSelectedLeavesError("");
    async function loadSelectedStudentLeaves() {
      try {
        const collected: RecordedLeave[] = [];
        let page = 1;
        while (true) {
          const params = new URLSearchParams({ studentId, page: String(page), pageSize: "500" });
          const response = await fetch(`/api/student-leaves?${params.toString()}`, {
            credentials: "same-origin", signal: controller.signal,
          });
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          const payload = await response.json();
          collected.push(...(payload.studentLeaves || []));
          if (!payload.hasMore) break;
          page += 1;
        }
        if (!controller.signal.aborted && version === leaveMutationVersionRef.current) setLeaveRows(collected);
      } catch {
        if (!controller.signal.aborted && version === leaveMutationVersionRef.current)
          setSelectedLeavesError("تعذر تحميل إجازات الطالب. أعد المحاولة.");
      } finally {
        if (!controller.signal.aborted && version === leaveMutationVersionRef.current) setSelectedLeavesLoading(false);
      }
    }
    void loadSelectedStudentLeaves();
    return () => controller.abort();
  }, [open, studentId, syncKey, leaveRefreshKey]);

  // The complete current exam scope under the leaves permission, including
  // exams unavailable to the general cache. Never preview a stale student.
  useEffect(() => {
    if (!open || !studentId) {
      setLeaveContext(null); setLeaveContextLoading(false); setLeaveContextError("");
      return;
    }
    if (leaveOperationRef.current) return;
    const controller = new AbortController();
    leaveContextAbortRef.current = controller;
    const version = leaveMutationVersionRef.current;
    setLeaveContextLoading(true); setLeaveContextError("");
    void fetch(`/api/student-leaves/context?studentId=${encodeURIComponent(studentId)}`, {
      credentials: "same-origin", signal: controller.signal,
    }).then(async response => {
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = await response.json();
      if (controller.signal.aborted || version !== leaveMutationVersionRef.current) return;
      if (payload.student?.id !== studentId || !Array.isArray(payload.exams)) {
        throw new Error("Invalid leave context");
      }
      setLeaveContext(payload as LeaveContext);
    }).catch(() => {
      if (!controller.signal.aborted && version === leaveMutationVersionRef.current) {
        setLeaveContext(null);
        setLeaveContextError("تعذر تحميل امتحانات الطالب. أعد المحاولة قبل حفظ الإجازة.");
      }
    }).finally(() => {
      if (!controller.signal.aborted && version === leaveMutationVersionRef.current) setLeaveContextLoading(false);
    });
    return () => controller.abort();
  }, [open, studentId, syncKey, leaveRefreshKey]);

  const today = baghdadTodayKey();
  const sortedLeaves = useMemo(
    () => [...leaveRows].sort((a, b) => compareLeavesNewestFirst(daySource(a), daySource(b))),
    [leaveRows],
  );
  const hasEndedLeave = sortedLeaves.some((leave) => studentLeaveState(studentLeaveDays(daySource(leave)), today) === "ended");
  // The header light follows the leaves as they are added or deleted here.
  const liveSummary = useMemo(() => summarizeStudentLeaves(leaveRows.map(daySource), today), [leaveRows, today]);
  const headerStudent = student && (leaveRows.length > 0 || !selectedLeavesLoading)
    ? { ...student, leaves: liveSummary }
    : student;

  // ── Form ────────────────────────────────────────────────────────────────
  const leaveContextReady = Boolean(studentId && leaveContext?.student.id === studentId);
  const selectedLeaveStudent = leaveContextReady ? leaveContext?.student || null : null;
  const studentStatus = selectedLeaveStudent?.status || student?.status || "";
  const selectedLeaveStudentBlockedReason =
    studentStatus === "مؤرشف" ? "لا يمكن تسجيل إجازة لهذا الطالب لأنه مؤرشف." : "";
  const leaveExamOptions = useMemo(
    () =>
      selectedLeaveStudent && leaveContextReady
        ? (leaveContext?.exams || [])
            .filter((exam) => exam.courseIds.includes(selectedLeaveStudent.courseId))
            // Newest exam first, like everything else in this window.
            .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime() || a.id.localeCompare(b.id))
        : [],
    [leaveContext, leaveContextReady, selectedLeaveStudent],
  );
  const leaveMode: LeaveMode = form?.mode || "exam";
  const leaveExamId = form?.examId || "";

  useEffect(() => {
    if (!leaveExamId || !selectedLeaveStudent || !leaveContextReady || leaveContextLoading) return;
    if (!leaveExamOptions.some((exam) => exam.id === leaveExamId)) {
      setForm((current) => (current ? { ...current, examId: "" } : current));
    }
  }, [leaveExamId, leaveExamOptions, selectedLeaveStudent, leaveContextReady, leaveContextLoading]);

  const selectedStudentLeaves = leaveRows;
  const leavePreview = useMemo(() => buildStudentLeavePreview({
    mode: leaveMode,
    student: selectedLeaveStudent,
    exams: leaveExamOptions,
    leaves: selectedStudentLeaves,
    examId: leaveExamId,
    dateFrom: form?.dateFrom,
    dateTo: form?.dateTo,
    editingLeaveId: form?.leaveId,
  }), [leaveMode, selectedLeaveStudent, leaveExamOptions, selectedStudentLeaves, leaveExamId, form?.dateFrom, form?.dateTo, form?.leaveId]);
  const leavePreviewReady = leaveContextReady && !leaveContextLoading && !leaveContextError;
  const leaveBlockingConflict = leavePreview.conflicts.find(conflict => conflict.blocking);
  const leaveConflictIds = new Set(leavePreview.conflicts.map(conflict => conflict.leaveId));
  const leaveHasConflicts = leavePreviewReady && !selectedLeavesLoading && !selectedLeavesError && leaveConflictIds.size > 0;
  const conflictingLeaves = leaveHasConflicts ? sortedLeaves.filter((leave) => leaveConflictIds.has(leave.id)) : [];
  const periodPreviewExamCount = leaveMode === "period" && leavePreviewReady && leavePreview.hasPeriodDates
    ? leavePreview.periodExams.length : null;
  const leaveDateRangeText = `من ${formatAppDate(leavePreview.from)} إلى ${formatAppDate(leavePreview.to)}`;
  const leaveSummary = !leavePreviewReady
    ? leaveContextError || "جارٍ تحميل امتحانات الطالب…"
    : leaveMode === "exam"
      ? leavePreview.selectedExam
        ? `إجازة لامتحان «${leavePreview.selectedExam.name}» بتاريخ ${formatAppDate(leavePreview.selectedExam.date)} فقط.`
        : "اختر الامتحان لعرض ملخص الإجازة."
      : !leavePreview.hasPeriodDates
        ? "حدد تاريخ البداية والنهاية لعرض ملخص الإجازة."
        : periodPreviewExamCount === 0
          ? `إجازة فترة ${leaveDateRangeText} — لا توجد امتحانات مشمولة حالياً.`
          : `إجازة تشمل ${leaveExamCountText(periodPreviewExamCount || 0)} ${leaveDateRangeText}.`;
  const leaveReason = form ? (form.reason === "أخرى" ? form.customReason.trim() : form.reason) : "";
  const periodDatesReversed = leaveMode === "period" && leavePreview.hasPeriodDates && Boolean(form && form.dateFrom > form.dateTo);
  const noCourseExams = leaveMode === "exam" && leavePreviewReady && leaveExamOptions.length === 0;
  const busy = leaveSaving || Boolean(deletingId);

  function patchStudent(patch: { status?: unknown; opportunities?: unknown } | null | undefined) {
    if (!patch) return;
    setStudent((current) => current ? {
      ...current,
      ...(typeof patch.status === "string" ? { status: patch.status } : {}),
      ...(typeof patch.opportunities === "number" ? { opportunities: patch.opportunities } : {}),
    } : current);
  }

  function openStudent(row: LeaveStudentRow) {
    setStudent(row);
    setForm(null);
    setConfirmDeleteId("");
    setMenuLeaveId("");
    setLeaveRows([]);
  }

  function backToList() {
    setStudent(null);
    setForm(null);
    setConfirmDeleteId("");
    setMenuLeaveId("");
  }

  function startAdd() {
    setForm(emptyForm(today));
    setConfirmDeleteId("");
    setMenuLeaveId("");
  }

  function startEditLeave(leave: RecordedLeave) {
    if (leaveOperationRef.current) {
      toast.error("انتظر اكتمال العملية الحالية قبل التعديل.");
      return;
    }
    setForm(formFromLeave(leave, today));
    setConfirmDeleteId("");
    setMenuLeaveId("");
  }

  function updateForm(patch: Partial<LeaveForm>) {
    setForm((current) => (current ? { ...current, ...patch } : current));
  }

  const saveLeave = async () => {
    if (leaveOperationRef.current || !form || !student) return;
    if (!leavePreviewReady) {
      toast.error(leaveContextError || "انتظر تحميل امتحانات الطالب قبل الحفظ.");
      return;
    }
    if (selectedLeavesError || selectedLeavesLoading) {
      toast.error("انتظر تحميل إجازات الطالب قبل الحفظ.");
      return;
    }
    if (!leaveReason.trim()) {
      toast.error("اختر سبب الإجازة");
      return;
    }
    if (selectedLeaveStudentBlockedReason) {
      toast.error(selectedLeaveStudentBlockedReason);
      return;
    }
    if (leaveMode === "exam" && !leaveExamId) {
      toast.error("اختر الامتحان المطلوب للإجازة");
      return;
    }
    if (leaveMode === "exam" && !leaveExamOptions.some((exam) => exam.id === leaveExamId)) {
      toast.error("اختر امتحاناً تابعاً لدورة الطالب الحالية");
      return;
    }
    if (leaveMode === "period" && (!form.dateFrom || !form.dateTo)) {
      toast.error("حدد بداية ونهاية فترة الإجازة");
      return;
    }
    // Same blocking rules as the server; mixed exam/period coverage is a visible warning.
    if (leaveBlockingConflict) {
      toast.error(leaveBlockingConflict.kind === "duplicate-exam"
        ? "هذا الطالب لديه إجازة سابقة على هذا الامتحان بالفعل. عدّل الإجازة السابقة بدل تكرارها."
        : "توجد إجازة فترة سابقة لهذا الطالب تتداخل مع النطاق المحدد. عدّل الإجازة السابقة أو غيّر التواريخ.");
      return;
    }

    const from = form.dateFrom <= form.dateTo ? form.dateFrom : form.dateTo;
    const to = form.dateFrom <= form.dateTo ? form.dateTo : form.dateFrom;
    const documentDate = form.documentDate || today;
    const payload = {
      studentId: student.id,
      examId: leaveMode === "exam" ? leaveExamId : "",
      leaveType: leaveMode,
      reason: leaveReason,
      studyType: selectedLeaveStudent?.studyType || student.studyType || "",
      date: leaveMode === "exam" ? documentDate : from,
      dateFrom: leaveMode === "exam" ? documentDate : from,
      dateTo: leaveMode === "exam" ? documentDate : to,
      notes: form.notes.trim(),
    };
    const editingLeaveId = form.leaveId;
    const wasDismissed = studentStatus === "مفصول";

    leaveOperationRef.current = true;
    leaveMutationVersionRef.current += 1;
    leaveListAbortRef.current?.abort(); leaveContextAbortRef.current?.abort();
    setLeaveSaving(true);
    try {
      const result = editingLeaveId
        ? await studentLeaveApi.update(editingLeaveId, payload)
        : await studentLeaveApi.add(payload);
      if (!result.ok || result.queued) {
        toast.error(result.error || "تعذر حفظ الإجازة.");
        return;
      }

      const response = (result.data || {}) as {
        studentLeave?: RecordedLeave;
        backedUpGrades?: number;
        restoredGradeCount?: number;
        coveredExamCount?: number;
      };
      const savedStudent = response.studentLeave?.student || null;
      patchStudent(savedStudent);
      if (response.studentLeave) {
        const saved = response.studentLeave;
        setLeaveRows((current) => [saved, ...current.filter((item) => item.id !== saved.id)]);
      }
      // Back to the student's leaves.
      setForm(null);
      emitTeacherProDataChanged({
        source: "local-mutation",
        reason: editingLeaveId ? "student-leave-updated" : "student-leave-created",
        scopes: ["follow-up", "grades", "students", "opportunities", "dashboard"],
        dispatchLocal: false,
      });

      if (wasDismissed && savedStudent) {
        toast.success(savedStudent.status === "نشط"
          ? `حُفظت الإجازة وأُلغي سبب الفصل. الفرص المتبقية: ${savedStudent.opportunities}.`
          : "حُفظت الإجازة. بقي الطالب مفصولاً وفق سجله.");
        return;
      }
      if (editingLeaveId) {
        const restoredGradeCount = Number(response.restoredGradeCount || 0);
        toast.success(
          restoredGradeCount > 0
            ? `تم تحديث الإجازة واسترجاع ${restoredGradeCount} درجة/درجات أصلية ثم إعادة الاحتساب.`
            : "تم تحديث الإجازة وإعادة احتساب الطالب.",
        );
        return;
      }

      const coveredExamCount = Number(response.coveredExamCount || 0);
      if (leaveMode === "period" && coveredExamCount === 0) {
        toast.warning(
          "تم حفظ الإجازة لكنها لم تغطِّ أي امتحان تابع لدورة/موقع الطالب. راجع موقع الطالب أو تواريخ الفترة.",
        );
        return;
      }

      const backedUpGrades = Number(response.backedUpGrades || 0);
      if (backedUpGrades > 0) {
        toast.success(
          backedUpGrades === 1
            ? "تم حفظ الإجازة وتعليق درجة مرتبطة واحدة بعد أخذ نسخة احتياطية لها (تُسترجع تلقائياً عند حذف الإجازة)"
            : `تم حفظ الإجازة وتعليق ${backedUpGrades} درجات مرتبطة بعد أخذ نسخة احتياطية لها (تُسترجع تلقائياً عند حذف الإجازة)`,
        );
        return;
      }

      toast.success(
        leaveMode === "period"
          ? `تمت إضافة إجازة الفترة وهي تغطي ${coveredExamCount} امتحاناً تابعاً لدورة/موقع الطالب، مع إعادة احتساب الطالب`
          : "تمت إضافة الإجازة وإعادة احتساب الطالب بدون خصم على هذا الامتحان",
      );
    } catch {
      toast.error("تعذر حفظ الإجازة. بقيت بيانات النموذج محفوظة للمحاولة مجدداً.");
    } finally {
      leaveOperationRef.current = false;
      leaveMutationVersionRef.current += 1;
      setLeaveSaving(false); setSelectedLeavesLoading(false); setLeaveContextLoading(false);
      setLeaveRefreshKey((current) => current + 1);
    }
  };

  const deleteLeaveServerFirst = async (leave: RecordedLeave) => {
    if (leaveOperationRef.current) return;
    leaveOperationRef.current = true;
    leaveMutationVersionRef.current += 1;
    leaveListAbortRef.current?.abort(); leaveContextAbortRef.current?.abort();
    setDeletingId(leave.id);
    try {
      const result = await studentLeaveApi.remove(leave.id);
      if (!result.ok || result.queued) {
        toast.error(result.error || "تعذر حذف الإجازة.");
        return;
      }

      setConfirmDeleteId("");
      if (form?.leaveId === leave.id) setForm(null);
      setLeaveRows((current) => current.filter((item) => item.id !== leave.id));
      const academic = (result.data as { academicRecalculation?: { students?: Array<{ id?: string; status?: string; opportunities?: number }> } })?.academicRecalculation;
      patchStudent((academic?.students || []).find((patch) => patch.id === leave.studentId));
      emitTeacherProDataChanged({
        source: "local-mutation",
        reason: "student-leave-deleted",
        scopes: ["follow-up", "grades", "students", "opportunities", "dashboard"],
        dispatchLocal: false,
      });

      const response = (result.data || {}) as {
        restoredGradeCount?: number;
        skippedGradeRestores?: {
          absentBeforeRegistration?: number;
        };
      };
      const restored = Number(response.restoredGradeCount || 0);
      const skippedBeforeRegistration = Number(
        response.skippedGradeRestores?.absentBeforeRegistration || 0,
      );
      const resultDetails = [
        restored > 0
          ? `استُرجعت ${restored} درجة/درجات.`
          : "لم تكن هناك درجات صالحة للاسترجاع.",
        skippedBeforeRegistration > 0
          ? `تم تجاهل ${skippedBeforeRegistration} غياب/غيابات لأنها تقع قبل تسجيل الطالب.`
          : "",
      ]
        .filter(Boolean)
        .join(" ");
      toast.success("تم حذف الإجازة وإعادة احتساب الطالب.", {
        description: resultDetails,
      });
    } catch {
      toast.error("تعذر حذف الإجازة. حاول مجدداً.");
    } finally {
      leaveOperationRef.current = false;
      leaveMutationVersionRef.current += 1;
      setDeletingId("");
      setSelectedLeavesLoading(false); setLeaveContextLoading(false);
      setLeaveRefreshKey((current) => current + 1);
    }
  };

  const filterTone = (value: StudentLeaveListFilter) =>
    value === "current" ? "success" : value === "past" ? "muted" : undefined;

  function renderList() {
    return (
      <>
        <section className="tp-modal__section" aria-label="البحث عن طالب">
          <div className="tp-modal__input-wrap">
            <Search aria-hidden="true" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="ابحث بالاسم أو الكود أو اليوزر أو الهاتف أو سبب الإجازة"
              aria-label="البحث عن طالب"
              className="tp-modal__search-input"
              autoFocus
            />
            {listLoading && <Loader2 className="tp-modal__spinner animate-spin motion-reduce:animate-none" aria-hidden="true" />}
          </div>
        </section>

        <section className="tp-modal__section" aria-label={listQuery ? "الطلاب المطابقون للبحث" : "الطلاب المجازون"}>
          <div role="group" aria-label="تصفية الإجازات" className="tp-modal__chips">
            {STUDENT_LEAVE_LIST_FILTERS.map((option) => (
              <button
                key={option.value}
                type="button"
                className="tp-modal__filter"
                aria-pressed={filter === option.value}
                data-filter={option.value}
                data-tone={filterTone(option.value)}
                title={option.hint || undefined}
                onClick={() => setFilter(option.value)}
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
                ? `المعروض ${list.students.length} من ${list.counts.all} طالب${listQuery ? " مطابق للبحث" : ""} · من الأحدث إلى الأقدم`
                : "الطلاب المجازون"}
            </span>
          </div>
          {listError && (
            <div role="alert" className="tp-modal__error">
              <AlertCircle aria-hidden="true" />
              <p>{listError}</p>
              <Button type="button" variant="outline" size="sm" onClick={() => setListRefreshKey((current) => current + 1)}>
                إعادة المحاولة
              </Button>
            </div>
          )}
          {listLoading && !list && (
            <p role="status" className="tp-modal__status">
              <Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /> جارٍ تحميل الإجازات…
            </p>
          )}
          {list && list.students.length === 0 && !listLoading && (
            <EmptyState
              icon={listQuery ? Search : CalendarCheck}
              title={listQuery
                ? "لا يوجد طالب يطابق البحث."
                : filter === "current"
                  ? "لا توجد إجازات سارية أو قادمة."
                  : filter === "past"
                    ? "لا توجد إجازات منتهية."
                    : "لا توجد إجازات. ابحث عن الطالب لإضافة أول إجازة."}
            />
          )}
          {list && list.students.length > 0 && (
            <ul className="tp-leave-cards" aria-busy={listLoading}>
              {list.students.map((row) => (
                <li key={row.id} className="tp-leave-card tp-leaves__card" data-tone={row.leaves.state ? STATE_TONE[row.leaves.state] : undefined} data-locked={row.status === "مؤرشف" ? "archived" : row.status === "مفصول" ? "dismissed" : "none"}>
                  <button
                    type="button"
                    className="tp-modal__card-open"
                    onClick={() => openStudent(row)}
                    aria-label={`فتح إجازات الطالب ${row.name}`}
                  />
                  <LeaveCardHead student={row} />
                  <div className="tp-leave-card__body">
                    <div className="tp-leave-card__main">
                      <LeavesSummaryPanel summary={row.leaves} />
                      <div className="tp-leave-card__facts">
                        <div className="tp-leave-card__fact">
                          <span className="tp-leave-card__fact-label"><MessageCircle aria-hidden="true" />التواصل</span>
                          <TelegramButton student={row} />
                        </div>
                      </div>
                    </div>
                    <OpenTile canManage={canManage} />
                  </div>
                </li>
              ))}
            </ul>
          )}
          {list?.truncated && (
            <p className="tp-modal__muted">يُعرض أحدث {list.students.length} طالب فقط؛ استخدم البحث لتضييق القائمة.</p>
          )}
        </section>
      </>
    );
  }

  function renderLeaveRow(leave: RecordedLeave) {
    const state = studentLeaveState(studentLeaveDays(daySource(leave)), today);
    const period = isPeriodLeave(leave);
    const title = period ? "إجازة فترة" : leave.exam?.name || "امتحان محذوف";
    const deleting = deletingId === leave.id;
    const confirming = confirmDeleteId === leave.id;
    return (
      <li key={leave.id} className="tp-leave-item" data-state={state} data-tone={STATE_TONE[state]} data-confirming={confirming || undefined}>
        <span className="tp-leave-item__icon" aria-hidden="true">{period ? <CalendarRange /> : <ClipboardList />}</span>
        <div className="tp-leave-item__main">
          <span className="tp-leave-item__eyebrow">{period ? "إجازة فترة" : "إجازة امتحان"}</span>
          {period ? (
            <LeaveDates from={leave.dateFrom || leave.date} to={leave.dateTo || leave.dateFrom || leave.date} />
          ) : (
            <p className="tp-leave-item__title">
              <b>{title}</b>
              <span>بتاريخ {leave.exam?.date ? formatAppDate(leave.exam.date as string) : "غير متوفر"}</span>
            </p>
          )}
          <p className="tp-leave-item__reason"><span>السبب</span>{leave.reason || "—"}</p>
          {leave.notes ? <p className="tp-leave-item__note">ملاحظة: {leave.notes}</p> : null}
        </div>
        <div className="tp-leave-item__side">
          <StateChip state={state} />
          {canManage && (
            <LeaveActionsMenu
              label={period ? `إجازة ${leaveScopeText(leave)}` : `إجازة ${title}`}
              open={menuLeaveId === leave.id}
              disabled={busy}
              onToggle={(next) => setMenuLeaveId(next ? leave.id : "")}
              onEdit={() => startEditLeave(leave)}
              onDelete={() => { setMenuLeaveId(""); setConfirmDeleteId(leave.id); }}
            />
          )}
        </div>
        {confirming && (
          <div className="tp-leaves__confirm" role="alertdialog" aria-label="تأكيد حذف الإجازة">
            <p>
              سيتم حذف الإجازة ({period ? `فترة ${leaveScopeText(leave)}` : "امتحان واحد"}) نهائياً، واسترجاع أي درجات عُلّقت
              بسببها (يُستثنى الغياب غير الصالح قبل التسجيل)، ثم إعادة احتساب الطالب.
            </p>
            <div className="tp-modal__actions">
              <Button type="button" data-tone="danger" disabled={busy} onClick={() => void deleteLeaveServerFirst(leave)}>
                {deleting ? <Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <Trash2 className="size-4" aria-hidden="true" />}
                {deleting ? "جاري الحذف..." : "تأكيد الحذف"}
              </Button>
              <Button type="button" variant="ghost" disabled={deleting} onClick={() => setConfirmDeleteId("")}>
                تراجع
              </Button>
            </div>
          </div>
        )}
      </li>
    );
  }

  function renderLeaves() {
    return (
      <section className="tp-modal__section" aria-labelledby="tp-leaves-history">
        <div className="tp-modal__section-head">
          <h3 id="tp-leaves-history" className="tp-modal__title">إجازات الطالب</h3>
          <span className="tp-modal__muted">من الأحدث إلى الأقدم</span>
        </div>
        {selectedLeavesError && (
          <div role="alert" className="tp-modal__error">
            <AlertCircle aria-hidden="true" />
            <p>{selectedLeavesError}</p>
            <Button type="button" variant="outline" size="sm" onClick={() => setLeaveRefreshKey((current) => current + 1)}>
              إعادة المحاولة
            </Button>
          </div>
        )}
        {selectedLeavesLoading && leaveRows.length === 0 && !selectedLeavesError && (
          <p role="status" className="tp-modal__status">
            <Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /> جارٍ تحميل إجازات الطالب…
          </p>
        )}
        {!selectedLeavesLoading && !selectedLeavesError && sortedLeaves.length === 0 && (
          <EmptyState
            compact
            icon={CalendarCheck}
            title="لا توجد إجازات"
            action={canManage ? (
              <Button type="button" onClick={startAdd} disabled={busy || Boolean(selectedLeaveStudentBlockedReason)} title={selectedLeaveStudentBlockedReason || undefined}>
                <CalendarPlus className="size-4" aria-hidden="true" />إضافة إجازة
              </Button>
            ) : null}
          />
        )}
        {sortedLeaves.length > 0 && (
          <ul className="tp-leave-items" aria-busy={selectedLeavesLoading}>
            {sortedLeaves.map(renderLeaveRow)}
          </ul>
        )}
        {hasEndedLeave && (
          <p className="tp-modal__muted">الإجازة المنتهية تبقى في السجل، ويبقى إعفاؤها محفوظاً للامتحانات التي شملتها.</p>
        )}
      </section>
    );
  }

  function renderForm() {
    if (!form || !student) return null;
    const editing = Boolean(form.leaveId);
    const saveDisabled =
      leaveSaving ||
      !leavePreviewReady ||
      Boolean(leaveBlockingConflict) ||
      selectedLeavesLoading ||
      Boolean(selectedLeavesError) ||
      !selectedLeaveStudent ||
      Boolean(selectedLeaveStudentBlockedReason);
    return (
      <section className="tp-leaves__editor" aria-labelledby="tp-leaves-editor">
        <h3 id="tp-leaves-editor">{editing ? "تعديل الإجازة" : "إضافة إجازة"}</h3>
        <fieldset disabled={leaveSaving} className="tp-leaves__form">
          <div role="radiogroup" aria-label="نوع الإجازة" className="tp-leaves__modes">
            {([
              ["exam", "لامتحان"],
              ["period", "لفترة"],
            ] as const).map(([mode, label]) => (
              <button
                key={mode}
                type="button"
                role="radio"
                aria-checked={form.mode === mode}
                className="tp-leaves__mode"
                onClick={() => updateForm({ mode })}
              >
                {label}
              </button>
            ))}
          </div>

          {form.mode === "exam" ? (
            <label className="tp-modal__field">
              <span>الامتحان وتاريخه</span>
              <div className="tp-modal__select-wrap" data-plain="true">
                <select
                  value={form.examId}
                  onChange={(event) => updateForm({ examId: event.target.value })}
                  disabled={!leavePreviewReady}
                  aria-describedby="tp-leaves-exam-help"
                >
                  <option value="">اختر الامتحان</option>
                  {leaveExamOptions.map((exam) => (
                    <option key={exam.id} value={exam.id}>
                      {exam.name} — {formatAppDate(exam.date)}{exam.active === false ? " (معطّل)" : ""}
                    </option>
                  ))}
                </select>
                <ChevronDown className="tp-modal__chevron" aria-hidden="true" />
              </div>
              <small id="tp-leaves-exam-help" className="tp-modal__muted">تخص الامتحان المحدد فقط.</small>
            </label>
          ) : (
            <div className="tp-modal__fields">
              <label className="tp-modal__field">
                <span>من تاريخ</span>
                <Input type="date" value={form.dateFrom} onChange={(event) => updateForm({ dateFrom: event.target.value })} />
              </label>
              <label className="tp-modal__field">
                <span>إلى تاريخ</span>
                <Input type="date" value={form.dateTo} min={form.dateFrom || undefined} onChange={(event) => updateForm({ dateTo: event.target.value })} />
              </label>
            </div>
          )}

          <fieldset className="tp-leaves__reasons">
            <legend>السبب</legend>
            <div className="tp-leaves__reason-list">
              {leaveReasonOptions.map((reason) => (
                <label key={reason} className="tp-leaves__reason" data-checked={form.reason === reason}>
                  <input
                    type="radio"
                    name="tp-leave-reason"
                    value={reason}
                    checked={form.reason === reason}
                    onChange={() => updateForm({ reason })}
                  />
                  {reason}
                </label>
              ))}
            </div>
            {form.reason === "أخرى" && (
              <Input
                value={form.customReason}
                onChange={(event) => updateForm({ customReason: event.target.value })}
                placeholder="اكتب سبب الإجازة"
                aria-label="سبب الإجازة"
                maxLength={200}
              />
            )}
          </fieldset>

          <details className="tp-leaves__extra" open={Boolean(form.notes) || undefined}>
            <summary>تفاصيل إضافية (اختياري)</summary>
            <div className="tp-modal__fields">
              <label className="tp-modal__field">
                <span>ملاحظات</span>
                <Input value={form.notes} onChange={(event) => updateForm({ notes: event.target.value })} placeholder="اختياري" maxLength={500} />
              </label>
              {form.mode === "exam" && (
                <label className="tp-modal__field">
                  <span>تاريخ توثيق الإجازة</span>
                  <Input type="date" value={form.documentDate} onChange={(event) => updateForm({ documentDate: event.target.value })} aria-describedby="tp-leaves-document-help" />
                  <small id="tp-leaves-document-help" className="tp-modal__muted">تاريخ إداري فقط؛ لا يغيّر الامتحان المشمول.</small>
                </label>
              )}
            </div>
          </details>
        </fieldset>

        {/* Messages appear only when they apply. */}
        {leaveContextLoading && (
          <p role="status" className="tp-modal__status">
            <Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /> جارٍ تحميل امتحانات الطالب…
          </p>
        )}
        {leaveContextError && (
          <div role="alert" className="tp-modal__error">
            <AlertCircle aria-hidden="true" />
            <p>{leaveContextError}</p>
            <Button type="button" variant="outline" size="sm" onClick={() => setLeaveRefreshKey((current) => current + 1)}>إعادة المحاولة</Button>
          </div>
        )}
        {selectedLeaveStudentBlockedReason && (
          <p role="alert" className="tp-modal__error"><AlertCircle aria-hidden="true" />{selectedLeaveStudentBlockedReason}</p>
        )}
        {noCourseExams && (
          <p role="alert" className="tp-leaves__warning">لا توجد امتحانات تابعة لدورة هذا الطالب حالياً، لذلك لا يمكن تسجيل إجازة امتحان له.</p>
        )}
        {periodDatesReversed && (
          <p role="alert" className="tp-leaves__warning">تاريخ البداية بعد تاريخ النهاية. سيعتمد النظام الفترة {leaveDateRangeText}.</p>
        )}
        {periodPreviewExamCount === 0 && (
          <p role="alert" className="tp-leaves__warning">
            النطاق المحدد لا يشمل أي امتحان حالياً. راجع الفترة وموقع الطالب.
            {editing && " عند التعديل قد تُسترجع درجات الامتحانات التي خرجت من نطاق الإجازة."}
          </p>
        )}
        {leaveHasConflicts && (
          <div role="alert" className="tp-leaves__warning">
            <p>
              {leaveBlockingConflict
                ? leaveBlockingConflict.kind === "duplicate-exam"
                  ? "توجد إجازة سابقة لهذا الامتحان. عدّل الإجازة السابقة بدل تسجيلها مرة ثانية."
                  : "الفترة تتداخل مع إجازة فترة سابقة. عدّل الإجازة السابقة أو غيّر التواريخ قبل الحفظ."
                : "يوجد امتحان مشمول بإجازة سابقة ضمن الاختيار الحالي."}
            </p>
            <ul className="tp-leaves__conflicts">
              {conflictingLeaves.map((leave) => (
                <li key={leave.id}>
                  <span>{isPeriodLeave(leave) ? `فترة ${leaveScopeText(leave)}` : leaveScopeText(leave)} — {leave.reason}</span>
                  <Button type="button" variant="outline" size="sm" onClick={() => startEditLeave(leave)} disabled={leaveSaving}>
                    تعديل هذه الإجازة
                  </Button>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="tp-leaves__summary" aria-live="polite" aria-atomic="true">
          <p className="tp-modal__summary">{leaveSummary}</p>
          {periodPreviewExamCount !== null && periodPreviewExamCount > 0 && (
            <details key={`${studentId}:${form.dateFrom}:${form.dateTo}`} className="tp-leaves__covered">
              <summary>عرض الامتحانات المشمولة ({periodPreviewExamCount})</summary>
              <ul>
                {leavePreview.periodExams.map(exam => (
                  <li key={exam.id}>
                    {exam.name} — {formatAppDate(exam.date)}{exam.active === false ? " (معطّل حالياً)" : ""}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>

        <div className="tp-modal__actions">
          <Button type="button" onClick={() => void saveLeave()} disabled={saveDisabled}>
            {leaveSaving
              ? <Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
              : <CheckCircle2 className="size-4" aria-hidden="true" />}
            {leaveSaving ? "جاري الحفظ..." : editing ? "حفظ التعديل" : "حفظ"}
          </Button>
          <Button type="button" variant="ghost" onClick={() => setForm(null)} disabled={leaveSaving}>
            رجوع
          </Button>
        </div>
      </section>
    );
  }

  function renderStudent() {
    if (!student || !headerStudent) return null;
    const dismissed = student.status === "مفصول";
    return (
      <>
        <section
          className="tp-leave-card tp-leaves__student"
          data-tone={headerStudent.leaves.state ? STATE_TONE[headerStudent.leaves.state] : undefined}
          data-locked={student.status === "مؤرشف" ? "archived" : student.status === "مفصول" ? "dismissed" : "none"}
          aria-label="الطالب"
        >
          <LeaveCardHead student={headerStudent}>
            <div className="tp-leaves__student-actions">
              <Button
                type="button"
                variant="outline"
                onClick={() => (form ? setForm(null) : backToList())}
                disabled={busy}
              >
                <ArrowRight className="size-4" aria-hidden="true" />رجوع
              </Button>
              {canManage && !form && (
                <Button
                  type="button"
                  onClick={startAdd}
                  disabled={busy || Boolean(selectedLeaveStudentBlockedReason)}
                  title={selectedLeaveStudentBlockedReason || undefined}
                >
                  <CalendarPlus className="size-4" aria-hidden="true" />إضافة إجازة
                </Button>
              )}
            </div>
          </LeaveCardHead>
          <div className="tp-leave-card__facts">
            <div className="tp-leave-card__fact">
              <span className="tp-leave-card__fact-label"><MessageCircle aria-hidden="true" />التواصل</span>
              <TelegramButton student={headerStudent} />
            </div>
            {student.courseName && (
              <div className="tp-leave-card__fact">
                <span className="tp-leave-card__fact-label"><BookOpen aria-hidden="true" />الدورة</span>
                <b className="tp-leave-card__value">{student.courseName}</b>
              </div>
            )}
            {student.studyType && (
              <div className="tp-leave-card__fact">
                <span className="tp-leave-card__fact-label"><GraduationCap aria-hidden="true" />نظام الدراسة</span>
                <b className="tp-leave-card__value">{student.studyType}</b>
              </div>
            )}
            <div className="tp-leave-card__fact">
              <span className="tp-leave-card__fact-label"><ChartColumn aria-hidden="true" />الفرص</span>
              <b className="tp-leave-card__value" dir="ltr">{formatOpportunityBalance(student, { separator: " / " })}</b>
            </div>
          </div>
        </section>

        {selectedLeaveStudentBlockedReason && !form && (
          <p role="note" className="tp-modal__note">{selectedLeaveStudentBlockedReason}</p>
        )}
        {dismissed && !form && (
          <p role="note" className="tp-modal__note">
            يمكن اعتماد إجازة لامتحان سابق. يُلغى الفصل إذا زال سببه بعد احتساب الإجازة، دون منحه فرص تعهد.
          </p>
        )}

        {form ? renderForm() : renderLeaves()}
      </>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="tp-modal tp-leaves"
        dir="rtl"
        onEscapeKeyDown={(event) => {
          // Escape closes the innermost thing first: the menu, then a delete confirmation.
          if (menuLeaveId) {
            event.preventDefault();
            setMenuLeaveId("");
          } else if (confirmDeleteId && !deletingId) {
            event.preventDefault();
            setConfirmDeleteId("");
          }
        }}
      >
        <div className="tp-modal__hero">
          <span className="tp-modal__hero-icon" aria-hidden="true"><CalendarCheck /></span>
          <DialogHeader className="tp-modal__heading">
            <DialogTitle>إدارة الإجازات</DialogTitle>
          </DialogHeader>
        </div>
        <div className="tp-modal__body">
          {student ? renderStudent() : renderList()}
        </div>
      </DialogContent>
    </Dialog>
  );
}

