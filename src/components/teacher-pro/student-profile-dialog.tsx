"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  type Exam,
  type Grade,
  type LogEntry,
  type OpportunityLog,
  type Student,
  type StudentCall,
  type StudentLeave,
  type StudentNote,
  useTeacherStore,
} from "@/lib/teacher-store";
import { requestDismissedStudentFocus } from "@/lib/dismissed-focus";
import { baghdadDateKey, baghdadTodayKey } from "@/lib/baghdad-time";
import {
  studentProfileLogApi,
  studentProfileStatsApi,
  type StudentEnrollmentArchiveRecord,
  type StudentProfileLogResponse,
  type StudentProfileStatsResponse,
} from "@/lib/api";
import {
  AlertCircle, ArrowRightIcon, Award, ChevronDown, CircleAlert, CircleCheck, CircleMinus,
  Info, Phone, Star, XIcon,
} from "lucide-react";
import {
  buildStaffOpportunityView,
  buildStudentDetailsFromProfileLog,
  formatReportTimelineDate,
  type StaffOpportunityRow,
  type StudentDetails,
} from "./export-dialog";
import { STAFF_ROW_ICONS, staffRowNote } from "./opportunity-row-icons";
import { EmptyState, LoadingState } from "./ui-kit";

import { displayReasonText } from "@/lib/reason-display";
import { shortGradeNoteText } from "@/lib/grade-note-banners";
import { useTeacherProBackgroundSyncDetector, useTeacherProSyncKey } from "@/hooks/use-teacherpro-sync";
import { formatAuditLogDisplay } from "@/lib/audit-log-display";
import { formatOpportunityBalance, getOpportunityBalance, getOpportunityLimit } from "@/lib/opportunity-balance";
import { humanizeTeacherProText } from "@/lib/teacherpro-language";
import { LEGACY_GRACE_PLACEHOLDER_STATUS } from "@/lib/academic-types";
import { displayOpportunityAction, isRetiredFollowupNote } from "@/lib/retired-followup-compat";
import { buildStudentStory, type StoryCategory, type StoryEvent } from "@/lib/student-story";
import { storyDay, storyStamp, storyTime, type StoryPart } from "@/lib/student-story-format";

type StudentProfileDialogProps = {
  student: Student | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  exams: Exam[];
  grades: Grade[];
  opportunityLogs: OpportunityLog[];
  studentLeaves?: StudentLeave[];
  studentCalls?: StudentCall[];
  studentNotes: StudentNote[];
  logs?: LogEntry[];
  courseName: (courseId: string) => string;
  activeChapterForCourse: (courseId: string) => { name: string } | null | undefined;
  whatsappLink: (phone: string) => string;
  telegramLink: (telegram: string) => string;
};

type StoryFilter = "all" | StoryCategory;
const STORY_FILTERS: Array<[StoryFilter, string]> = [
  ["all", "كلشي"],
  ["grades", "الدرجات"],
  ["decisions", "الفرص والقرارات"],
  ["follow", "المتابعة"],
  ["data", "البيانات"],
];
/** «الخلاصة» lays the file out at a glance; the other tabs are the story, filtered. */
type ProfileView = "overview" | StoryFilter;
const PROFILE_TABS: Array<[ProfileView, string]> = [["overview", "الخلاصة"], ...STORY_FILTERS];
const MOVES_SHOWN = 5;
const STORY_PAGE = 60;


function archiveSnapshotList(
  archive: StudentEnrollmentArchiveRecord,
  key: string,
): Array<Record<string, any>> {
  const value = (archive.snapshot as Record<string, any> | undefined)?.[key];
  return Array.isArray(value) ? value : [];
}

function archiveSnapshotCounts(
  archive: StudentEnrollmentArchiveRecord,
): Record<string, number> {
  const raw = (archive.snapshot as Record<string, any> | undefined)?.counts;
  if (!raw || typeof raw !== "object") return {};
  return Object.fromEntries(
    Object.entries(raw).map(([key, value]) => [key, Number(value || 0)]),
  );
}

function archiveSnapshotObject(
  archive: StudentEnrollmentArchiveRecord,
  key: string,
): Record<string, any> {
  const value = (archive.snapshot as Record<string, any> | undefined)?.[key];
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function ContactLink({ href, children }: { href: string; children: React.ReactNode }) {
  if (!href || href === "#") {
    return <span className="text-muted-foreground">{children || "—"}</span>;
  }
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="break-words font-bold text-primary underline-offset-4 hover:underline"
    >
      {children || "—"}
    </a>
  );
}

function formatStudentLocation(student: Student): string {
  const scope = String(student.locationScope || student.mainSite || "").trim();
  const subSite = String(student.subSite || "").trim();
  const normalizedScope = scope.replace(/^عموم\s+/, "").trim();
  const normalizedSubSite = subSite.replace(/^عموم\s+/, "").trim();
  if (!scope && !subSite) return "—";
  if (!subSite || normalizedScope === normalizedSubSite) return scope || subSite;
  return [scope, subSite].filter(Boolean).join(" — ");
}

function ProfileLoadNotice({
  loading,
  error,
  onRetry,
}: {
  loading: boolean;
  error: string | null;
  onRetry: () => void;
}) {
  if (loading) {
    return (
      <div role="status" aria-live="polite" className="rounded-2xl border border-primary/20 bg-primary/5 px-4 py-3 text-sm font-bold text-primary">
        جاري تحميل ملف الطالب…
      </div>
    );
  }
  if (!error) return null;
  return (
    <div role="alert" aria-live="assertive" className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-danger-line border-s-4 border-s-danger-vivid bg-danger-soft px-4 py-3 text-sm">
      <p className="min-w-0 flex-1 break-words font-bold text-danger">{error}</p>
      <button type="button" onClick={onRetry} className="min-h-11 max-w-full touch-manipulation rounded-xl border border-destructive/30 px-3 py-2 font-black text-danger [overflow-wrap:anywhere] focus:outline-none focus:ring-2 focus:ring-destructive/30">
        إعادة المحاولة
      </button>
    </div>
  );
}

function InfoBox({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="min-w-0 rounded-2xl border bg-card/80 p-3 shadow-sm sm:rounded-3xl sm:p-4">
      <p className="text-[11px] font-bold text-muted-foreground sm:text-xs">{label}</p>
      <div className="mt-1 min-w-0 break-words text-sm font-black text-foreground">{value}</div>
    </div>
  );
}

// The retired grace placeholder is not a result: show it as nothing recorded.
function profileGradeStatus(status: string | null | undefined): string {
  return status === LEGACY_GRACE_PLACEHOLDER_STATUS ? "لا توجد نتيجة" : String(status || "");
}

function humanizeProfileText(value: unknown): string {
  return humanizeTeacherProText(String(value || ""))
    .replace(/\[academic-reactivation-link:[^\]]+\]/giu, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/** A stored timestamp as «8 أكتوبر 2026». */
function profileDay(value?: string | null): string {
  if (!value) return "—";
  return storyDay(baghdadDateKey(value)) || "—";
}

/** Story text: bold grades, exam names and dates; struck cancelled events. */
function StoryText({ parts }: { parts: StoryPart[] }) {
  return (
    <>
      {parts.map((part, index) =>
        part.b ? <b key={index}>{part.t}</b> : part.s ? <s key={index}>{part.t}</s> : <React.Fragment key={index}>{part.t}</React.Fragment>,
      )}
    </>
  );
}

function storyMeta(time: string, by: string): string {
  return [storyTime(time), by].filter(Boolean).join(" · ");
}

function StoryRow({ event }: { event: StoryEvent }) {
  const meta = storyMeta(event.time, event.by);
  const balance = event.balance;
  return (
    <li className="tp-story__event" data-tone={event.tone}>
      <span className="tp-story__dot" aria-hidden="true" />
      <div className="min-w-0">
        <p className="tp-story__text"><StoryText parts={event.parts} /></p>
        {meta ? <p className="tp-story__meta">{meta}</p> : null}
        {event.subs.length ? (
          <ul className="tp-story__subs">
            {event.subs.map((sub) => (
              <li key={sub.id}>
                <StoryText parts={sub.parts} />
                <span className="tp-story__meta"> {[storyDay(sub.dayKey), storyMeta(sub.time, sub.by)].filter(Boolean).join(" · ")}</span>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
      {balance ? (
        <span className="tp-story__balance" data-zero={balance.dismissed || balance.after === 0 ? "true" : undefined} title="الفرص بعد هالشي">
          {balance.dismissed ? "مفصول" : balance.limit !== null ? `${balance.after} من ${balance.limit}` : `باقي ${balance.after}`}
        </span>
      ) : null}
    </li>
  );
}

/** A ring that fills with the opportunities left out of the chapter's. */
function BalanceRing({
  value,
  limit,
  label,
  large = false,
  children,
}: {
  value: number | null;
  limit: number | null;
  label: string;
  large?: boolean;
  children: React.ReactNode;
}) {
  // Without a limit there is nothing to fill: the number alone.
  const ratio = value === null || !limit || limit <= 0 ? 0 : Math.max(0, Math.min(1, value / limit));
  const tone = value === null ? "none" : value <= 0 ? "empty" : limit === null ? "none" : value >= limit ? "full" : "part";
  const circumference = 2 * Math.PI * 16;
  return (
    <span className="tp-pf-ring" data-large={large || undefined} data-tone={tone} role="img" aria-label={label}>
      <svg viewBox="0 0 40 40" aria-hidden="true">
        <circle className="tp-pf-ring__track" cx="20" cy="20" r="16" />
        {ratio > 0 ? (
          <circle
            className="tp-pf-ring__value"
            cx="20"
            cy="20"
            r="16"
            strokeDasharray={`${ratio * circumference} ${circumference}`}
            transform="rotate(-90 20 20)"
          />
        ) : null}
      </svg>
      <span className="tp-pf-ring__text" aria-hidden="true">{children}</span>
    </span>
  );
}

type ExamStatusTone = "deduct" | "pass" | "fail" | "excused" | "neutral";

/** An exam row's state in the report's own words: the deduction, the pill or the effect. */
function examStatus(row: StaffOpportunityRow): { tone: ExamStatusTone; text: string } {
  const note = staffRowNote(row.note);
  if (row.category === "exam-deduct" || row.category === "exam-dismissal") return { tone: "deduct", text: note };
  if (row.exam?.pill) return { tone: row.exam.pill.tone === "passed" ? "pass" : "fail", text: row.exam.pill.text };
  // No grade yet: the grade column already says so.
  return { tone: row.exam?.result === "excused" ? "excused" : "neutral", text: note && note !== "—" ? note : "" };
}

const EXAM_STATUS_ICONS: Record<ExamStatusTone, typeof Info> = {
  deduct: CircleMinus,
  pass: CircleCheck,
  fail: CircleAlert,
  excused: Info,
  neutral: Info,
};

function DeltaChip({ row }: { row: StaffOpportunityRow }) {
  if (row.delta === null) return null;
  return (
    <span className="tp-pf-delta">
      {row.category === "bonus" ? <Star aria-hidden="true" /> : null}
      <bdi dir="ltr">{row.delta > 0 ? "+" : "−"}{Math.abs(row.delta)}</bdi>
    </span>
  );
}

function withWhatsAppText(link: string, text: string): string {
  if (!link || link === "#") return "";
  return `${link}${link.includes("?") ? "&" : "?"}text=${encodeURIComponent(text)}`;
}

export function StudentProfileDialog({
  student,
  open,
  onOpenChange,
  courseName,
  whatsappLink,
  telegramLink,
}: StudentProfileDialogProps) {
  const syncKey = useTeacherProSyncKey(["students", "grades", "opportunities", "opportunity-logs", "follow-up", "logs"]);
  const setSection = useTeacherStore((state) => state.setSection);
  const canAccessSection = useTeacherStore((state) => state.canAccess);
  const isBackgroundSync = useTeacherProBackgroundSyncDetector(syncKey);
  const [databaseStats, setDatabaseStats] = useState<StudentProfileStatsResponse | null>(null);
  const [databaseStatsLoading, setDatabaseStatsLoading] = useState(false);
  const [databaseStatsError, setDatabaseStatsError] = useState<string | null>(null);
  const [databaseStudent, setDatabaseStudent] = useState<Student | null>(null);
  const [databaseGrades, setDatabaseGrades] = useState<Grade[]>([]);
  const [databaseExams, setDatabaseExams] = useState<Exam[]>([]);
  const [databaseCourseExams, setDatabaseCourseExams] = useState<Exam[]>([]);
  const [databaseOpportunityLogs, setDatabaseOpportunityLogs] = useState<OpportunityLog[]>([]);
  const [databaseStudentLeaves, setDatabaseStudentLeaves] = useState<StudentLeave[]>([]);
  const [databaseStudentCalls, setDatabaseStudentCalls] = useState<StudentCall[]>([]);
  const [databaseStudentNotes, setDatabaseStudentNotes] = useState<StudentNote[]>([]);
  const [databaseLogs, setDatabaseLogs] = useState<LogEntry[]>([]);
  const [databaseStory, setDatabaseStory] = useState<StudentProfileLogResponse["story"] | null>(null);
  const [databaseCanReadLogs, setDatabaseCanReadLogs] = useState(false);
  const [databaseEnrollmentArchives, setDatabaseEnrollmentArchives] = useState<
    StudentEnrollmentArchiveRecord[]
  >([]);
  const [databaseGradesLoading, setDatabaseGradesLoading] = useState(false);
  const [databaseGradesError, setDatabaseGradesError] = useState<string | null>(null);
  const [databaseProfileLoaded, setDatabaseProfileLoaded] = useState(false);
  const [databaseProfileStudentId, setDatabaseProfileStudentId] = useState("");
  const [databaseStatsSnapshotVersion, setDatabaseStatsSnapshotVersion] = useState("");
  const [databaseProfileSnapshotVersion, setDatabaseProfileSnapshotVersion] = useState("");
  const [storyVisibleCount, setStoryVisibleCount] = useState(STORY_PAGE);
  const [view, setView] = useState<ProfileView>("overview");
  const storyFilter: StoryFilter = view === "overview" ? "all" : view;
  // The opportunities report of the active chapter, from the same record
  // and builder as the HTML report and «التفاصيل» in الفرص.
  const [databaseDetails, setDatabaseDetails] = useState<StudentDetails | null>(null);
  const [databaseDetailsFailed, setDatabaseDetailsFailed] = useState(false);
  // The technical system log stays out of the story: one link at the bottom,
  // for those who may read the logs.
  const [showSystemLog, setShowSystemLog] = useState(false);
  const [shareStatus, setShareStatus] = useState("");
  const [manualRefreshKey, setManualRefreshKey] = useState(0);
  const contentScrollRef = useRef<HTMLDivElement | null>(null);
  const tabsRef = useRef<HTMLDivElement | null>(null);
  const dialogRef = useRef<HTMLElement | null>(null);
  const initialFocusRef = useRef<HTMLButtonElement | null>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const onOpenChangeRef = useRef(onOpenChange);
  const [isMounted, setIsMounted] = useState(false);
  const retryProfile = useCallback(() => setManualRefreshKey((value) => value + 1), []);

  useEffect(() => {
    setIsMounted(true);
  }, []);

  useEffect(() => {
    onOpenChangeRef.current = onOpenChange;
  }, [onOpenChange]);

  const hasAuthoritativeProfile = Boolean(
    student && databaseProfileLoaded && databaseProfileStudentId === student.id,
  );

  const effectiveStudent = useMemo<Student | null>(() => {
    if (!student) return null;
    const remoteStudent = databaseStudent?.id === student.id ? databaseStudent : null;
    return { ...student, ...(remoteStudent || {}) };
  }, [student, databaseStudent]);

  const profileExams = useMemo(
    () => (hasAuthoritativeProfile ? [...databaseExams] : []),
    [hasAuthoritativeProfile, databaseExams],
  );

  const story = useMemo(() => {
    if (!hasAuthoritativeProfile || !effectiveStudent) return null;
    const remote = effectiveStudent as Student & {
      activeChapter?: { id?: string; name?: string; opportunities?: number | null } | null;
      opportunityLimit?: number | null;
    };
    const chapter = remote.activeChapter && remote.activeChapter.id
      ? { id: String(remote.activeChapter.id), name: String(remote.activeChapter.name || ""), opportunities: remote.activeChapter.opportunities ?? null }
      : null;
    return buildStudentStory({
      student: effectiveStudent as unknown as Record<string, unknown> & { id: string },
      courseName: courseName(effectiveStudent.courseId),
      activeChapter: chapter,
      opportunityLimit: typeof remote.opportunityLimit === "number" ? remote.opportunityLimit : chapter?.opportunities ?? null,
      exams: profileExams as unknown as Array<Record<string, unknown>>,
      courseExams: databaseCourseExams as unknown as Array<Record<string, unknown>>,
      grades: databaseGrades as unknown as Array<Record<string, unknown>>,
      opportunityLogs: databaseOpportunityLogs as unknown as Array<Record<string, unknown>>,
      leaves: databaseStudentLeaves as unknown as Array<Record<string, unknown>>,
      calls: databaseStudentCalls as unknown as Array<Record<string, unknown>>,
      notes: databaseStudentNotes.filter((note) => !isRetiredFollowupNote(note)) as unknown as Array<Record<string, unknown>>,
      gracePeriods: databaseStory?.gracePeriods || [],
      pendingGrades: databaseStory?.pendingGrades || [],
      audit: databaseStory?.audit || null,
      todayKey: baghdadTodayKey(),
    });
  }, [
    hasAuthoritativeProfile, effectiveStudent, courseName, profileExams, databaseCourseExams, databaseGrades,
    databaseOpportunityLogs, databaseStudentLeaves, databaseStudentCalls, databaseStudentNotes, databaseStory,
  ]);

  const storyEvents = useMemo(() => {
    if (!story) return [] as Array<{ group: string; day: string; event: StoryEvent }>;
    return story.groups.flatMap((group) =>
      group.days.flatMap((day) =>
        day.events
          .filter((event) => storyFilter === "all" || event.cats.includes(storyFilter))
          .map((event) => ({ group: group.title, day: day.title, event })),
      ),
    );
  }, [story, storyFilter]);
  const visibleStudentLog = useMemo(
    () => storyEvents.slice(0, storyVisibleCount),
    [storyEvents, storyVisibleCount],
  );

  // «الخلاصة»: the chapter's exams and the opportunities' movements, from the
  // report's rows, plus the latest follow-up from the story.
  const overview = useMemo(() => {
    // Without one active chapter the report is not scoped to a chapter.
    if (!hasAuthoritativeProfile || !databaseDetails || !databaseDetails.activeChapterName) return null;
    const { rows, summary } = buildStaffOpportunityView(databaseDetails);
    const exams = rows.filter((row) => row.exam);
    // An exam's balance after it, as its own recorded movement saved it.
    const examBalance = new Map<string, number>();
    for (const log of [...(databaseDetails.opportunityLogs || [])].sort((a, b) => (Date.parse(a.date) || 0) - (Date.parse(b.date) || 0))) {
      if (log.examId && typeof log.balanceAfter === "number") examBalance.set(`grade-${log.examId}`, log.balanceAfter);
    }
    // Where nothing was saved, the balance after a row follows from the
    // opening and the moves before it, only when the sum lands on today's.
    const runningBalance = new Map<string, number>();
    const balanceNow = databaseDetails.studentSnapshot?.opportunities;
    if (summary.opening !== null && summary.computed !== null && balanceNow !== null && balanceNow !== undefined && summary.computed === balanceNow) {
      let running: number | null = summary.inferred ? summary.opening : null;
      for (const row of rows) {
        if (row.beforeOpening) continue;
        if (row.opening) {
          running = row.balanceAfter;
          continue;
        }
        if (running === null) continue;
        if (row.delta !== null) running += row.delta;
        runningBalance.set(row.key, running);
      }
    }
    const moves = rows
      .filter((row) => !row.exam || row.delta !== null || row.category === "exam-dismissal")
      .map((row) => ({ row, after: row.balanceAfter ?? examBalance.get(row.key) ?? runningBalance.get(row.key) ?? null }))
      .reverse();
    return {
      exams,
      moves,
      summary,
      limit: databaseDetails.studentSnapshot?.opportunityLimit ?? null,
    };
  }, [hasAuthoritativeProfile, databaseDetails]);

  useEffect(() => {
    if (!open) return;
    contentScrollRef.current?.scrollTo({ top: 0, behavior: "auto" });
  }, [open, student?.id]);

  useEffect(() => {
    setShowSystemLog(false);
    setView("overview");
    setDatabaseDetails(null);
    setDatabaseDetailsFailed(false);
    setShareStatus("");
    setDatabaseStats(null);
    setDatabaseStatsLoading(false);
    setDatabaseStatsError(null);
    setDatabaseStudent(null);
    setDatabaseGrades([]);
    setDatabaseExams([]);
    setDatabaseCourseExams([]);
    setDatabaseOpportunityLogs([]);
    setDatabaseStudentLeaves([]);
    setDatabaseStudentCalls([]);
    setDatabaseStudentNotes([]);
    setDatabaseLogs([]);
    setDatabaseStory(null);
    setDatabaseCanReadLogs(false);
    setDatabaseEnrollmentArchives([]);
    setDatabaseGradesLoading(false);
    setDatabaseGradesError(null);
    setDatabaseProfileLoaded(false);
    setDatabaseProfileStudentId("");
    setDatabaseStatsSnapshotVersion("");
    setDatabaseProfileSnapshotVersion("");
    setStoryVisibleCount(STORY_PAGE);
  }, [open, student?.id]);

  useEffect(() => {
    setStoryVisibleCount(STORY_PAGE);
  }, [storyFilter]);

  useEffect(() => {
    if (!open || !student?.id) return;

    let cancelled = false;
    const silent = isBackgroundSync();
    if (!silent) {
      setDatabaseStatsLoading(true);
      setDatabaseStatsError(null);
    }
    studentProfileStatsApi
      .get(student.id)
      .then((result) => {
        if (cancelled) return;
        if (result?.studentId === student.id) {
          setDatabaseStats(result);
          setDatabaseStatsSnapshotVersion(String(result.snapshotVersion || ""));
          setDatabaseStatsError(null);
          return;
        }
        if (!silent) setDatabaseStatsError("تعذر تحميل إحصاءات الطالب حالياً.");
      })
      .catch(() => {
        if (!cancelled && !silent) setDatabaseStatsError("تعذر تحميل إحصاءات الطالب حالياً.");
      })
      .finally(() => {
        if (!cancelled) setDatabaseStatsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [open, student?.id, syncKey, manualRefreshKey, isBackgroundSync]);

  useEffect(() => {
    if (!open || !student?.id) return;

    let cancelled = false;
    const silent = isBackgroundSync();
    if (!silent) setDatabaseGradesLoading(true);
    if (!silent) setDatabaseGradesError(null);

    studentProfileLogApi
      .get(student.id)
      .then((result) => {
        if (cancelled) return;
        if (!result || result.studentId !== student.id) {
          if (!silent) setDatabaseGradesError("تعذر تحميل ملف الطالب حالياً.");
          return;
        }
        setDatabaseGrades((result.grades || []) as unknown as Grade[]);
        setDatabaseExams((result.exams || []) as unknown as Exam[]);
        setDatabaseCourseExams((result.allCourseExams || []) as unknown as Exam[]);
        setDatabaseOpportunityLogs((result.opportunityLogs || []) as unknown as OpportunityLog[]);
        setDatabaseStudentLeaves((result.studentLeaves || []) as unknown as StudentLeave[]);
        setDatabaseStudentCalls((result.studentCalls || []) as unknown as StudentCall[]);
        setDatabaseStudentNotes((result.studentNotes || []) as unknown as StudentNote[]);
        setDatabaseLogs((result.logs || []) as unknown as LogEntry[]);
        setDatabaseStory(result.story || null);
        let details: StudentDetails | null = null;
        try {
          details = buildStudentDetailsFromProfileLog(result, { staff: true });
        } catch {
          details = null;
        }
        setDatabaseDetails(details);
        setDatabaseDetailsFailed(!details);
        setDatabaseCanReadLogs(Boolean(result.sections?.logs));
        setDatabaseEnrollmentArchives(result.enrollmentArchives || []);
        const remoteStudent = (result as typeof result & { student?: Student | null }).student;
        setDatabaseStudent(remoteStudent?.id === student.id ? remoteStudent : null);
        setDatabaseProfileStudentId(student.id);
        setDatabaseProfileLoaded(true);
        setDatabaseProfileSnapshotVersion(String(result.snapshotVersion || ""));
        setDatabaseGradesError(null);
      })
      .catch(() => {
        if (cancelled || silent) return;
        setDatabaseGradesError("تعذر تحميل ملف الطالب حالياً.");
      })
      .finally(() => {
        if (!cancelled) setDatabaseGradesLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [open, student?.id, syncKey, manualRefreshKey, isBackgroundSync]);

  useEffect(() => {
    if (!open || !isMounted || !dialogRef.current) return;
    previousFocusRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    const bodyOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const dialog = dialogRef.current;
    const hiddenSiblings = Array.from(document.body.children)
      .filter((element) => element !== dialog)
      .map((element) => {
        const htmlElement = element as HTMLElement & { inert: boolean };
        const previousAriaHidden = element.getAttribute("aria-hidden");
        const previousInert = htmlElement.inert;
        element.setAttribute("aria-hidden", "true");
        htmlElement.inert = true;
        return { element, previousAriaHidden, previousInert };
      });

    const focusableSelector = [
      "button:not([disabled])",
      "a[href]:not([tabindex='-1'])",
      "input:not([disabled])",
      "select:not([disabled])",
      "textarea:not([disabled])",
      "summary",
      "[tabindex]:not([tabindex='-1'])",
    ].join(",");
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onOpenChangeRef.current(false);
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(focusableSelector));
      if (focusable.length === 0) {
        event.preventDefault();
        dialog.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    const focusFrame = window.requestAnimationFrame(() => initialFocusRef.current?.focus());

    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = bodyOverflow;
      hiddenSiblings.forEach(({ element, previousAriaHidden, previousInert }) => {
        const htmlElement = element as HTMLElement & { inert: boolean };
        if (previousAriaHidden === null) element.removeAttribute("aria-hidden");
        else element.setAttribute("aria-hidden", previousAriaHidden);
        htmlElement.inert = previousInert;
      });
      previousFocusRef.current?.focus({ preventScroll: true });
    };
  }, [open, isMounted, student?.id]);

  if (!open || !student || !isMounted) return null;

  const profileStudent = effectiveStudent || student;
  const statsForStudent = databaseStats?.studentId === profileStudent.id ? databaseStats : null;
  const statsPending = databaseStatsLoading || (!statsForStudent && !databaseStatsError);
  const profileLogPending = databaseGradesLoading || (!hasAuthoritativeProfile && !databaseGradesError);
  const snapshotConflict = Boolean(
    databaseStatsSnapshotVersion &&
      databaseProfileSnapshotVersion &&
      databaseStatsSnapshotVersion !== databaseProfileSnapshotVersion,
  );
  const profileError = [
    databaseGradesError,
    snapshotConflict
      ? "تغيّرت بيانات الطالب أثناء تحميل الملف؛ أعد المحاولة للحصول على لقطة موحّدة."
      : null,
  ].filter(Boolean).join(" ") || null;
  const isDismissedNow = hasAuthoritativeProfile && profileStudent.status === "مفصول";
  const canReturnStudent = isDismissedNow && canAccessSection("dismissed-management");
  const openReturnStudent = () => {
    requestDismissedStudentFocus(profileStudent.code || profileStudent.name);
    onOpenChange(false);
    setSection("dismissed-management");
  };

  const parentLink = withWhatsAppText(whatsappLink(profileStudent.parentPhone || ""), story?.parentMessage || "");
  const studentLink = withWhatsAppText(whatsappLink(profileStudent.phone || ""), story?.studentMessage || "");
  // Opens the chat with the message ready, and keeps a copy on the clipboard
  // in case WhatsApp drops a long prefilled text.
  const sendWhatsApp = (link: string, text: string, who: string) => {
    void navigator.clipboard?.writeText(text).catch(() => undefined);
    window.open(link, "_blank", "noopener,noreferrer");
    setShareStatus(`انفتح واتساب ${who}، والرسالة منسوخة هم.`);
  };

  const profileContacts = [
    profileStudent.phone ? { key: "phone", label: "رقم الطالب", value: profileStudent.phone, href: whatsappLink(profileStudent.phone) } : null,
    profileStudent.parentPhone ? { key: "parent", label: "ولي الأمر", value: profileStudent.parentPhone, href: whatsappLink(profileStudent.parentPhone) } : null,
    profileStudent.username ? { key: "username", label: "تيليجرام", value: profileStudent.username, href: telegramLink(profileStudent.username) } : null,
    profileStudent.telegram && profileStudent.telegram !== profileStudent.username
      ? { key: "telegram", label: "معرف تيليجرام", value: profileStudent.telegram, href: /^\d+$/.test(profileStudent.telegram) ? "" : telegramLink(profileStudent.telegram) }
      : null,
  ].filter(Boolean) as Array<{ key: string; label: string; value: string; href: string }>;
  const missingProfileFacts = [
    !profileStudent.phone ? "رقم الطالب" : "",
    !profileStudent.parentPhone ? "رقم ولي الأمر" : "",
    !profileStudent.username && !profileStudent.telegram ? "التيليجرام" : "",
    formatStudentLocation(profileStudent) === "—" ? "الموقع" : "",
  ].filter(Boolean);
  const profileFacts = [
    { label: "الدورة", value: courseName(profileStudent.courseId) },
    { label: "المدرسة", value: profileStudent.school },
    { label: "الجنس", value: profileStudent.gender },
    { label: "نظام الاشتراك", value: profileStudent.courseProgram },
    { label: "الكورس المطلوب", value: profileStudent.courseTerm },
    { label: "نظام الدراسة", value: profileStudent.studyType },
    { label: "الموقع", value: formatStudentLocation(profileStudent) === "—" ? "" : formatStudentLocation(profileStudent) },
    { label: "انسجل", value: profileDay(profileStudent.createdAt) },
  ].filter((fact) => fact.value && fact.value !== "—");

  const auditLabels = {
    students: { [profileStudent.id]: profileStudent.name },
    exams: Object.fromEntries(profileExams.map((exam) => [exam.id, exam.name])),
  };
  const systemLogRows = databaseLogs.map((log) => ({
    id: log.id,
    stamp: storyStamp(log.time),
    source: humanizeProfileText(log.module || "النظام"),
    title: humanizeProfileText(log.action || "سجل نظام"),
    details: humanizeProfileText(formatAuditLogDisplay(log, auditLabels).summary || ""),
  }));

  const renderArchive = (archive: StudentEnrollmentArchiveRecord) => {
    const counts = archiveSnapshotCounts(archive);
    const oldGrades = archiveSnapshotList(archive, "grades");
    const oldOpportunities = archiveSnapshotList(archive, "opportunityLogs");
    const oldLeaves = archiveSnapshotList(archive, "studentLeaves");
    const oldCalls = archiveSnapshotList(archive, "studentCalls");
    const oldNotes = archiveSnapshotList(archive, "studentNotes").filter(
      (note) => !isRetiredFollowupNote(note),
    );
    const oldLeaveGradeBackups = archiveSnapshotList(archive, "studentLeaveGradeBackups");
    const oldAuditLogs = archiveSnapshotList(archive, "auditLogs");
    const oldStudent = archiveSnapshotObject(archive, "student");
    const oldFollowups: Array<Record<string, any> & { _kind: string }> = [
      ...oldLeaves.map((item) => ({ ...item, _kind: "إجازة" })),
      ...oldCalls.map((item) => ({ ...item, _kind: "مكالمة" })),
    ];
    return (
      <details key={archive.id} className="tp-story__old">
        <summary>
          قبل النقل: {archive.fromCourseName || archive.fromCourseId || "دورة سابقة"}
          <span className="tp-story__meta"> · انقفل يوم {profileDay(archive.createdAt)}{archive.createdByName ? ` · ${archive.createdByName}` : ""}</span>
        </summary>
        <div className="mt-3 space-y-3">
          <div className="rounded-2xl border border-info-line border-s-4 border-s-info-vivid bg-info-soft p-3 text-sm">
            <p className="font-black text-info">الملفات السابقة — للقراءة فقط</p>
            <p className="mt-1 leading-6 text-muted-foreground">
              هذه الملفات جُمّدت قبل نقل الطالب إلى دورة جديدة أو قبل اختياره كطالب جديد. لا تدخل درجاتها أو فرصها أو إجراءاتها في ملفه الحالي.
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {archive.resetKind === "course-transfer" ? "نقل إلى دورة جديدة" : "بدء جديد داخل الدورة"}
              {archive.toCourseName ? ` ← ${archive.toCourseName}` : ""}
              {archive.reason ? ` — ${archive.reason}` : ""}
            </p>
          </div>
          <div className="grid grid-cols-[repeat(auto-fit,minmax(8rem,1fr))] gap-2">
            <InfoBox label="كود الملف السابق" value={oldStudent.code || "—"} />
            <InfoBox label="الحالة السابقة" value={oldStudent.status || "—"} />
            <InfoBox label="الفرص السابقة" value={`${Number(oldStudent.opportunities || 0)} من ${Number(oldStudent.baseOpportunities || 0)}`} />
            <InfoBox label="بداية الملف" value={profileDay(oldStudent.createdAt)} />
            <InfoBox label="الدرجات" value={counts.grades || 0} />
            <InfoBox label="حركات الفرص" value={counts.opportunityLogs || 0} />
            <InfoBox label="الإجازات" value={counts.studentLeaves || 0} />
            <InfoBox label="المكالمات" value={counts.studentCalls || 0} />
          </div>
          <div className="grid gap-3 xl:grid-cols-2">
            <details className="rounded-2xl border bg-muted/30 p-3">
              <summary className="cursor-pointer font-black">الدرجات القديمة ({oldGrades.length})</summary>
              <div className="mt-3 max-h-72 space-y-2 overflow-y-auto">
                {oldGrades.length === 0 ? <p className="text-xs text-muted-foreground">لا توجد درجات</p> : oldGrades.map((grade) => (
                  <div key={String(grade.id)} className="rounded-xl bg-background p-3 text-xs">
                    <p><b>{grade.exam?.name || "امتحان"}</b> — {profileGradeStatus(grade.status) || "—"} {grade.score !== null && grade.score !== undefined ? <b>({grade.score})</b> : null}</p>
                    <p className="mt-1 text-muted-foreground"><b>{profileDay(grade.exam?.date || grade.updatedAt || grade.createdAt)}</b></p>
                  </div>
                ))}
              </div>
            </details>
            <details className="rounded-2xl border bg-muted/30 p-3">
              <summary className="cursor-pointer font-black">الفرص والإجراءات القديمة ({oldOpportunities.length})</summary>
              <div className="mt-3 max-h-72 space-y-2 overflow-y-auto">
                {oldOpportunities.length === 0 ? <p className="text-xs text-muted-foreground">لا توجد حركات</p> : oldOpportunities.map((log) => (
                  <div key={String(log.id)} className="rounded-xl bg-background p-3 text-xs">
                    <p className="font-bold">{displayOpportunityAction(log.action) || "حركة"} {log.amount ? `— ${log.amount}` : ""}</p>
                    <p className="mt-1 break-words text-muted-foreground">{humanizeProfileText(displayReasonText(log.reason)) || "—"} — <b>{profileDay(log.date)}</b></p>
                  </div>
                ))}
              </div>
            </details>
            <details className="rounded-2xl border bg-muted/30 p-3">
              <summary className="cursor-pointer font-black">الإجازات والمكالمات ({oldLeaves.length + oldCalls.length})</summary>
              <div className="mt-3 max-h-72 space-y-2 overflow-y-auto">
                {oldFollowups.map((item) => (
                  <div key={`${item._kind}-${String(item.id)}`} className="rounded-xl bg-background p-3 text-xs">
                    <p className="font-bold">{item._kind} — {item.exam?.name || item.status || "بدون امتحان"}</p>
                    <p className="mt-1 break-words text-muted-foreground">{item.reason || item.notes || item.status || "—"}</p>
                  </div>
                ))}
              </div>
            </details>
            <details className="rounded-2xl border bg-muted/30 p-3">
              <summary className="cursor-pointer font-black">الملاحظات القديمة ({oldNotes.length})</summary>
              <div className="mt-3 max-h-72 space-y-2 overflow-y-auto">
                {oldNotes.length === 0 ? <p className="text-xs text-muted-foreground">لا توجد ملاحظات</p> : oldNotes.map((note) => (
                  <div key={String(note.id)} className="rounded-xl bg-background p-3 text-xs">
                    <p className="font-bold">{note.kind || "ملاحظة"} — <b>{profileDay(note.date)}</b></p>
                    <p className="mt-1 break-words text-muted-foreground">{note.text || "—"}</p>
                  </div>
                ))}
              </div>
            </details>
            <details className="rounded-2xl border bg-muted/30 p-3">
              <summary className="cursor-pointer font-black">نسخ درجات الإجازات القديمة ({oldLeaveGradeBackups.length})</summary>
              <div className="mt-3 max-h-72 space-y-2 overflow-y-auto">
                {oldLeaveGradeBackups.length === 0 ? <p className="text-xs text-muted-foreground">لا توجد نسخ درجات</p> : oldLeaveGradeBackups.map((backup) => (
                  <div key={String(backup.id)} className="rounded-xl bg-background p-3 text-xs">
                    <p className="font-bold">{backup.exam?.name || "امتحان"} — {backup.status || "—"} {backup.score !== null && backup.score !== undefined ? `(${backup.score})` : ""}</p>
                    <p className="mt-1 break-words text-muted-foreground">{backup.notes ? shortGradeNoteText(backup.notes) : "بدون ملاحظات"} — {profileDay(backup.gradeUpdatedAt || backup.gradeCreatedAt || backup.createdAt)}</p>
                  </div>
                ))}
              </div>
            </details>
            {oldAuditLogs.length ? (
              <details className="rounded-2xl border bg-muted/30 p-3">
                <summary className="cursor-pointer font-black">سجلات النظام القديمة ({oldAuditLogs.length})</summary>
                <div className="mt-3 max-h-72 space-y-2 overflow-y-auto">
                  {oldAuditLogs.map((log) => (
                    <div key={String(log.id)} className="rounded-xl bg-background p-3 text-xs">
                      <p className="font-bold">{humanizeProfileText(log.module || "النظام")} — {humanizeProfileText(log.action || "إجراء")}</p>
                      <p className="mt-1 break-words text-muted-foreground">{humanizeProfileText(formatAuditLogDisplay(log).summary)} — {profileDay(log.time)}</p>
                    </div>
                  ))}
                </div>
              </details>
            ) : null}
          </div>
        </div>
      </details>
    );
  };

  const chapterName = story?.stripChapterName || databaseDetails?.activeChapterName || "";
  const profileCourseName = courseName(profileStudent.courseId);
  // The balance from the stats, or from the profile's own snapshot when the
  // stats could not load.
  const snapshot = databaseDetails?.studentSnapshot;
  const balanceValue = statsForStudent ? getOpportunityBalance(statsForStudent)
    : typeof snapshot?.opportunities === "number" ? snapshot.opportunities : null;
  const balanceLimit = statsForStudent ? getOpportunityLimit(statsForStudent)
    : typeof snapshot?.opportunityLimit === "number" ? snapshot.opportunityLimit : null;
  const balanceText = statsForStudent ? formatOpportunityBalance(statsForStudent, { separator: " من " })
    : balanceValue !== null ? `${balanceValue}${balanceLimit !== null ? ` من ${balanceLimit}` : ""}` : "";
  const showLead = Boolean(story && story.lead.length && (profileStudent.status !== "نشط" || !story.stripChapterName || balanceValue === 0));
  const examRows = overview ? [...overview.exams].reverse() : [];
  const moveLimit = overview?.limit ?? balanceLimit;
  const sum = overview?.summary;
  // An inferred opening (no chapter start recorded) is shown only when it adds up.
  const showSum = Boolean(sum && sum.opening !== null && balanceValue !== null && !isDismissedNow && (!sum.inferred || sum.computed === balanceValue));
  const sumTerms = sum && showSum ? [
    { sign: "−", value: sum.examDeducted, label: "خصم الامتحانات", cat: "exam-deduct" },
    { sign: "−", value: sum.adminDeducted, label: "خصم وتراجع الإدارة", cat: "admin-deduct" },
    { sign: "+", value: sum.adminAdded, label: "إضافات الإدارة", cat: "admin-add" },
    { sign: "+", value: sum.bonus, label: "فرص مكافأة", cat: "bonus" },
  ].filter((term) => term.value > 0) : [];
  // The chapter's exams counted as the summary counts them, in its words.
  const tiles = story && story.stripChapterName ? [
    { key: "total", label: "امتحان بهالفصل", value: story.counts.total, tone: undefined },
    { key: "pass", label: "نجاح", value: story.counts.pass, tone: "pass" },
    { key: "fail", label: "راسب بدون خصم", value: story.counts.fail, tone: "fail" },
    { key: "loss", label: "درجة خصم", value: story.counts.loss, tone: "loss" },
    { key: "absent", label: "غياب", value: story.counts.absent, tone: "loss" },
    { key: "neutral", label: "ما انحسب", value: story.counts.neutral, tone: undefined },
    { key: "pending", label: "معلّقة", value: story.counts.pending, tone: "fail" },
    { key: "missing", label: "ما انكتبت", value: story.counts.missing, tone: undefined },
  ].filter((tile) => tile.key === "total" || tile.value > 0) : [];
  const notes = story ? [...story.highlights, ...(!showSum && story.deducted ? [story.deducted] : [])] : [];
  const LatestIcon = story?.latest
    ? story.latest.tone === "pass" || story.latest.tone === "good" ? Award
      : story.latest.tone === "loss" || story.latest.tone === "danger" ? CircleMinus
        : story.latest.tone === "fail" ? CircleAlert : Info
    : Info;
  const initial = Array.from(profileStudent.name.trim())[0] || "؟";
  // Opening a section from further down starts it under the tabs.
  const openView = (next: ProfileView) => {
    setView(next);
    const scroller = contentScrollRef.current;
    const tabs = tabsRef.current;
    if (!scroller || !tabs) return;
    const top = tabs.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop - 8;
    if (scroller.scrollTop > top) scroller.scrollTo({ top, behavior: "auto" });
  };
  const chapterCardsState: "ready" | "failed" | "none" = overview ? "ready" : databaseDetailsFailed ? "failed" : "none";

  const storyBody = !story ? (
    profileLogPending ? (
      <LoadingState title="جاري تحميل ملف الطالب…" />
    ) : databaseGradesError ? (
      <div role="alert"><EmptyState compact icon={AlertCircle} title="تعذر تحميل ملف الطالب." /></div>
    ) : null
  ) : view !== "overview" ? (
    <>
      {visibleStudentLog.length === 0 ? (
        <EmptyState compact title={storyFilter === "all" ? "ما صار شي لهذا الطالب بعد" : "ماكو شي بهالتصنيف"} />
      ) : (
        <div className="tp-story__list">
          {visibleStudentLog.map(({ group, day, event }, index) => {
            const previous = index > 0 ? visibleStudentLog[index - 1] : null;
            const newGroup = !previous || previous.group !== group;
            const newDay = newGroup || previous?.day !== day;
            return (
              <React.Fragment key={event.id}>
                {newGroup ? <h3 className="tp-story__chapter">{group}</h3> : null}
                {newDay ? <h4 className="tp-story__day">{day}</h4> : null}
                <ul className="tp-story__events"><StoryRow event={event} /></ul>
              </React.Fragment>
            );
          })}
        </div>
      )}
      {visibleStudentLog.length < storyEvents.length ? (
        <div className="flex justify-center">
          <button
            type="button"
            onClick={() => setStoryVisibleCount((value) => value + STORY_PAGE)}
            className="min-h-11 max-w-full touch-manipulation rounded-xl border px-4 py-2 text-sm font-black text-primary [overflow-wrap:anywhere] hover:bg-primary/5 focus:outline-none focus:ring-2 focus:ring-primary/30"
          >
            عرض الأقدم ({storyEvents.length - visibleStudentLog.length})
          </button>
        </div>
      ) : null}
    </>
  ) : (
    <>
      {tiles.length || story.latest ? (
        <section className="tp-pf-stats" aria-label="الخلاصة">
          {tiles.length ? (
            <dl className="tp-pf-tiles">
              {tiles.map((tile) => (
                <div key={tile.key} className="tp-pf-tile" data-tone={tile.tone}>
                  <dt>{tile.label}</dt>
                  <dd>{tile.value}</dd>
                </div>
              ))}
            </dl>
          ) : null}
          {story.latest ? (
            <div className="tp-pf-latest" data-tone={story.latest.tone}>
              <span className="tp-pf-latest__icon" aria-hidden="true"><LatestIcon /></span>
              <div className="min-w-0">
                <p className="tp-pf-latest__label">آخر شي صار · {storyDay(story.latest.dayKey)}</p>
                <p className="tp-pf-latest__text"><StoryText parts={story.latest.parts} /></p>
                {storyMeta(story.latest.time, story.latest.by) ? (
                  <p className="tp-story__meta">{storyMeta(story.latest.time, story.latest.by)}</p>
                ) : null}
              </div>
            </div>
          ) : null}
        </section>
      ) : null}

      {notes.length ? (
        <ul className="tp-pf-notes">
          {notes.map((parts, index) => (
            <li key={index}><Info aria-hidden="true" /><span><StoryText parts={parts} /></span></li>
          ))}
        </ul>
      ) : null}

      <div className="tp-pf-grid" data-single={chapterCardsState === "none" || undefined}>
        {chapterCardsState !== "none" ? (
          <section className="tp-pf-card" aria-labelledby="tp-pf-exams-title">
            <header className="tp-pf-card__head">
              <div className="min-w-0">
                <h3 id="tp-pf-exams-title">
                  امتحانات {chapterName}
                  {overview ? <span className="tp-pf-count">{overview.exams.length}</span> : null}
                </h3>
                {profileCourseName ? <p>{profileCourseName}</p> : null}
              </div>
              {examRows.length > 1 ? <span className="tp-pf-card__order">من الأحدث إلى الأقدم</span> : null}
            </header>
            {chapterCardsState === "failed" ? (
              <div role="alert"><EmptyState compact icon={AlertCircle} title="تعذر تحميل ملف الطالب." /></div>
            ) : examRows.length === 0 ? (
              <EmptyState compact title="لا توجد امتحانات أو حركات لعرضها" />
            ) : (
              <div className="tp-pf-exams">
                <div className="tp-pf-exams__head" aria-hidden="true">
                  <span>الامتحان</span><span>التاريخ</span><span>الدرجة</span><span>الحالة</span>
                </div>
                <ul>
                  {examRows.map((row) => {
                    const status = examStatus(row);
                    const StatusIcon = EXAM_STATUS_ICONS[status.tone];
                    return (
                      <li key={row.key} className="tp-pf-exam" data-cat={row.category} data-before={row.beforeOpening || undefined}>
                        <div className="tp-pf-exam__name">
                          <strong>{row.title}</strong>
                          {row.exam?.type ? <small>{row.exam.type}</small> : null}
                          {row.exam?.duringDismissal ? <small className="tp-pf-exam__flag">سُجّلت أثناء الفصل</small> : null}
                        </div>
                        <time className="tp-pf-exam__date" dateTime={row.date}>{formatReportTimelineDate(row.date) || "—"}</time>
                        <span className="tp-pf-exam__score">
                          {row.category === "bonus" ? <Award role="img" aria-label="فرصة مكافأة" /> : null}
                          <bdi>{row.exam?.score || "—"}</bdi>
                        </span>
                        <span className="tp-pf-exam__status" data-tone={status.tone}>
                          {status.text ? <StatusIcon aria-hidden="true" /> : null}
                          <span>{status.text}</span>
                          {row.category === "bonus" ? <DeltaChip row={row} /> : null}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
            <button type="button" className="tp-pf-more" onClick={() => openView("grades")}>
              الدرجات <ChevronDown className="tp-pf-more__icon" aria-hidden="true" />
            </button>
          </section>
        ) : null}

        <div className="tp-pf-side">
          {chapterCardsState !== "none" ? (
            <section className="tp-pf-card" aria-labelledby="tp-pf-moves-title">
              <header className="tp-pf-card__head">
                <div className="min-w-0">
                  <h3 id="tp-pf-moves-title">الفرص والقرارات</h3>
                  {chapterName ? <p>{chapterName}</p> : null}
                </div>
              </header>
              {sum && showSum ? (
                <div className="tp-oppv__sum tp-pf-sum" aria-label="من وين جات الفرص المتبقية">
                  <span className="tp-oppv__term" data-cat="chapter-start">
                    <b>{sum.opening}</b><small>{sum.openingLabel}</small>
                  </span>
                  {sumTerms.map((term) => (
                    <span key={term.cat} className="tp-oppv__term" data-cat={term.cat}>
                      <b><bdi dir="ltr">{term.sign}{term.value}</bdi></b><small>{term.label}</small>
                    </span>
                  ))}
                  <span className="tp-oppv__eq" aria-hidden="true">=</span>
                  <span className="tp-oppv__term" data-cat="result">
                    <b>{statsForStudent ? formatOpportunityBalance(statsForStudent) : balanceValue}</b><small>الفرص المتبقية</small>
                  </span>
                  {!sum.inferred && sum.computed !== null && sum.computed !== balanceValue ? (
                    <p className="tp-oppv__mismatch">مجموع السجل يطلع {sum.computed}، والفرص المتبقية {balanceValue}. راجع سجل الطالب.</p>
                  ) : null}
                </div>
              ) : null}
              {chapterCardsState === "failed" ? (
                <div role="alert"><EmptyState compact icon={AlertCircle} title="تعذر تحميل ملف الطالب." /></div>
              ) : !overview || overview.moves.length === 0 ? (
                <EmptyState compact title="لا توجد امتحانات أو حركات لعرضها" />
              ) : (
                <ol className="tp-pf-moves">
                  {overview.moves.slice(0, MOVES_SHOWN).map(({ row, after }) => {
                    const Icon = STAFF_ROW_ICONS[row.category];
                    const note = staffRowNote(row.note);
                    const sub = row.reason ? `السبب: ${row.reason}` : note && note !== "—" ? note : "";
                    return (
                      <li key={row.key} className="tp-pf-move" data-cat={row.category}>
                        <span className="tp-pf-move__mark" aria-hidden="true"><Icon /></span>
                        <div className="tp-pf-move__main">
                          <p className="tp-pf-move__title"><strong>{row.title}</strong><DeltaChip row={row} /></p>
                          {sub ? <p className="tp-pf-move__sub">{sub}</p> : null}
                          <time dateTime={row.date}>{formatReportTimelineDate(row.date, row.withTime) || "تاريخ غير مسجّل"}</time>
                        </div>
                        {after !== null ? (
                          <BalanceRing
                            value={after}
                            limit={moveLimit}
                            label={`الفرص بعد هالشي: ${after}${moveLimit !== null ? ` من ${moveLimit}` : ""}`}
                          >
                            <bdi dir="ltr">{after}{moveLimit !== null ? `/${moveLimit}` : ""}</bdi>
                          </BalanceRing>
                        ) : null}
                      </li>
                    );
                  })}
                </ol>
              )}
              <button type="button" className="tp-pf-more" onClick={() => openView("decisions")}>
                الفرص والقرارات <ChevronDown className="tp-pf-more__icon" aria-hidden="true" />
              </button>
            </section>
          ) : null}

          {story.latestFollowUp ? (
            <section className="tp-pf-card tp-pf-follow" aria-labelledby="tp-pf-follow-title">
              <span className="tp-pf-follow__icon" aria-hidden="true"><Phone /></span>
              <div className="min-w-0">
                <h3 id="tp-pf-follow-title">المتابعة</h3>
                <p className="tp-pf-follow__text"><StoryText parts={story.latestFollowUp.parts} /></p>
                <p className="tp-story__meta">{[storyDay(story.latestFollowUp.dayKey), storyMeta(story.latestFollowUp.time, story.latestFollowUp.by)].filter(Boolean).join(" · ")}</p>
              </div>
            </section>
          ) : null}
        </div>
      </div>
    </>
  );

  const profileContent = (
    <section
      ref={dialogRef}
      dir="rtl"
      className="tp-student-profile fixed inset-0 z-[999] flex h-dvh w-dvw max-w-full flex-col overflow-hidden bg-background text-foreground"
      aria-labelledby="student-profile-title"
      aria-describedby="student-profile-description"
      aria-busy={statsPending || profileLogPending}
      role="dialog"
      aria-modal="true"
      tabIndex={-1}
    >
      <div className="flex h-full min-h-0 w-full flex-1 flex-col overflow-hidden bg-background">
        <header className="tp-student-profile__header shrink-0 border-b text-right">
          <div className="tp-student-profile__heading">
            <button
              ref={initialFocusRef}
              type="button"
              onClick={() => onOpenChange(false)}
              className="tp-student-profile__control border-primary/25 bg-primary/10 font-black text-primary hover:bg-primary/15"
              aria-label="الرجوع من ملف الطالب"
            >
              <ArrowRightIcon className="size-4 shrink-0" />
              <span className="hidden sm:inline">رجوع</span>
            </button>
            <p className="tp-pf-topbar">ملف الطالب <span>{profileStudent.name}</span></p>
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              className="tp-student-profile__control border-border bg-background text-muted-foreground hover:bg-muted"
              aria-label="إغلاق ملف الطالب"
            >
              <XIcon className="size-4 shrink-0" />
            </button>
          </div>
        </header>

        <div ref={contentScrollRef} className="tp-student-profile__content min-h-0 flex-1 overflow-y-auto overscroll-contain p-4 sm:p-5 lg:p-6 [scrollbar-gutter:stable]">
          <div className="tp-student-profile__body tp-story space-y-4 sm:space-y-5">
            <ProfileLoadNotice
              loading={profileLogPending && !profileError}
              error={profileError}
              onRetry={retryProfile}
            />

            <section className="tp-pf-hero" aria-label="ملف الطالب">
              <div className="tp-pf-hero__id">
                <span className="tp-pf-hero__avatar" aria-hidden="true">{initial}</span>
                <div className="min-w-0">
                  <p className="tp-pf-hero__kicker">ملف الطالب</p>
                  <h2 id="student-profile-title">{profileStudent.name}</h2>
                  <p id="student-profile-description" className="sr-only">ملف الطالب: الخلاصة وكل شي صار وياه</p>
                  <div className="tp-pf-hero__chips">
                    <span className="tp-pf-chip"><bdi>{profileStudent.code}</bdi></span>
                    {hasAuthoritativeProfile ? (
                      <span className="tp-pf-chip" data-status={profileStudent.status === "نشط" ? "active" : profileStudent.status === "مفصول" ? "dismissed" : "other"}>
                        {profileStudent.status}
                      </span>
                    ) : null}
                    {chapterName ? <span className="tp-pf-chip">{chapterName}</span> : null}
                    {profileCourseName ? <span className="tp-pf-chip">{profileCourseName}</span> : null}
                  </div>
                  {showLead && story ? <p className="tp-pf-hero__lead"><StoryText parts={story.lead} /></p> : null}
                  {story ? (
                    <div className="tp-pf-hero__actions">
                      <button
                        type="button"
                        className="tp-student-profile__control tp-pf-hero__button"
                        data-primary="true"
                        disabled={!studentLink}
                        title={studentLink ? "يفتح واتساب الطالب والتقرير الكامل جاهز" : "رقم الطالب ما مسجّل"}
                        onClick={() => sendWhatsApp(studentLink, story.studentMessage, "الطالب")}
                      >
                        تقرير كامل للطالب
                      </button>
                      <button
                        type="button"
                        className="tp-student-profile__control tp-pf-hero__button"
                        disabled={!parentLink}
                        title={parentLink ? "يفتح واتساب ولي الأمر والخلاصة جاهزة" : "رقم ولي الأمر ما مسجّل"}
                        onClick={() => sendWhatsApp(parentLink, story.parentMessage, "ولي الأمر")}
                      >
                        رسالة لولي الأمر
                      </button>
                      {canReturnStudent ? (
                        <button type="button" className="tp-student-profile__control tp-pf-hero__button" onClick={openReturnStudent}>
                          إرجاع الطالب…
                        </button>
                      ) : null}
                    </div>
                  ) : null}
                  {shareStatus ? <p role="status" className="tp-pf-hero__status">{shareStatus}</p> : null}
                </div>
              </div>
              <div className="tp-pf-hero__balance">
                <BalanceRing
                  large
                  value={isDismissedNow ? 0 : balanceValue}
                  limit={balanceLimit}
                  label={isDismissedNow ? "مفصول" : balanceText ? `الفرص ${balanceText}` : "الفرص —"}
                >
                  {isDismissedNow ? (
                    <b className="tp-pf-ring__word">مفصول</b>
                  ) : balanceValue === null ? (
                    <b>{statsPending ? "…" : "—"}</b>
                  ) : (
                    <>
                      <b>{balanceValue}</b>
                      {balanceLimit !== null ? <small>من {balanceLimit}</small> : null}
                    </>
                  )}
                </BalanceRing>
                <p>الفرص المتبقية</p>
              </div>
            </section>

            <div ref={tabsRef} className="tp-story__filters tp-pf-tabs" role="group" aria-label="فلترة القصة">
              {PROFILE_TABS.map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  aria-pressed={view === key}
                  onClick={() => openView(key)}
                  className="tp-pf-tab"
                >
                  {label}
                </button>
              ))}
            </div>

            {story?.openItems.length ? (
              <section className="tp-story__open" aria-label="يحتاج متابعة">
                <h3 className="tp-story__label">يحتاج متابعة</h3>
                <ul>
                  {story.openItems.map((parts, index) => <li key={index}><StoryText parts={parts} /></li>)}
                </ul>
              </section>
            ) : null}

            {storyBody}

            <>
                <div className="tp-pf-folds">
                  <details className="tp-pf-fold">
                    <summary>
                      <span className="min-w-0">
                        <b>بيانات التواصل والتسجيل</b>
                        <small>{[profileCourseName, profileStudent.createdAt ? `انسجل: ${profileDay(profileStudent.createdAt)}` : ""].filter(Boolean).join(" · ")}</small>
                      </span>
                      <ChevronDown className="tp-pf-fold__icon" aria-hidden="true" />
                    </summary>
                    <div className="mt-3 space-y-3">
                      {profileContacts.length ? (
                        <div className="flex flex-wrap gap-2">
                          {profileContacts.map((contact) => (
                            <span key={contact.key} className="inline-flex min-h-10 max-w-full items-center gap-2 rounded-xl border bg-muted/40 px-3 py-1.5 text-sm">
                              <span className="text-xs font-bold text-muted-foreground">{contact.label}</span>
                              <ContactLink href={contact.href}>{contact.value}</ContactLink>
                            </span>
                          ))}
                        </div>
                      ) : null}
                      {missingProfileFacts.length ? (
                        <p className="rounded-xl border border-warning-line bg-warning-soft px-3 py-2 text-xs font-bold text-warning">
                          ناقص: {missingProfileFacts.join("، ")}
                        </p>
                      ) : null}
                      <dl className="grid gap-x-4 gap-y-2 text-sm sm:grid-cols-2">
                        {profileFacts.map((fact) => (
                          <div key={fact.label} className="flex min-w-0 flex-wrap gap-x-2">
                            <dt className="text-muted-foreground">{fact.label}:</dt>
                            <dd className="min-w-0 break-words font-bold">{fact.value}</dd>
                          </div>
                        ))}
                      </dl>
                    </div>
                  </details>

                  {databaseEnrollmentArchives.length ? (
                    <details className="tp-pf-fold">
                      <summary>
                        <span className="min-w-0">
                          <b>الملفات السابقة</b>
                          <small>{databaseEnrollmentArchives.map((archive) => archive.fromCourseName || archive.fromCourseId || "دورة سابقة").join(" · ")}</small>
                        </span>
                        <ChevronDown className="tp-pf-fold__icon" aria-hidden="true" />
                      </summary>
                      <div className="mt-3 space-y-3">{databaseEnrollmentArchives.map(renderArchive)}</div>
                    </details>
                  ) : null}
                </div>

                {databaseCanReadLogs && systemLogRows.length ? (
                  <details
                    className="tp-pf-fold"
                    open={showSystemLog}
                    onToggle={(event) => setShowSystemLog(event.currentTarget.open)}
                  >
                    <summary>
                      <span className="min-w-0"><b>سجل النظام التقني ({systemLogRows.length})</b></span>
                      <ChevronDown className="tp-pf-fold__icon" aria-hidden="true" />
                    </summary>
                    {showSystemLog ? (
                      <ul className="tp-story__events mt-3">
                        {systemLogRows.map((row) => (
                          <li key={row.id} className="tp-story__event" data-tone="admin">
                            <span className="tp-story__dot" aria-hidden="true" />
                            <div className="min-w-0">
                              <p className="tp-story__text"><span className="tp-story__source">{row.source}</span>{row.title}</p>
                              <p className="tp-story__meta">{[storyDay(row.stamp.dayKey), storyTime(row.stamp.time)].filter(Boolean).join(" · ")}{row.details ? ` — ${row.details}` : ""}</p>
                            </div>
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </details>
                ) : null}
            </>
          </div>
        </div>
      </div>
    </section>
  );

  return createPortal(profileContent, document.body);
}
