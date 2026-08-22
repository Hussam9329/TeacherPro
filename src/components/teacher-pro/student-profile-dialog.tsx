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
} from "@/lib/teacher-store";
import { Badge } from "@/components/ui/badge";
import { formatAppDate } from "@/lib/format";
import { formatGradeScore } from "@/lib/exam-utils";
import {
  studentProfileLogApi,
  studentProfileStatsApi,
  type StudentEnrollmentArchiveRecord,
  type StudentProfileStatsResponse,
} from "@/lib/api";
import { classifyGradeAcademicImpact, type GradeClassificationKind } from "@/lib/grade-classification";
import { ArrowRightIcon } from "lucide-react";
import { useTeacherProBackgroundSyncDetector, useTeacherProSyncKey } from "@/hooks/use-teacherpro-sync";
import { formatOpportunityBalance } from "@/lib/opportunity-balance";
import { formatAuditLogDisplay } from "@/lib/audit-log-display";
import { humanizeTeacherProText } from "@/lib/teacherpro-language";
import { getStudentGraceDaysRemaining } from "@/lib/student-grace";
import {
  filterStudentProfileGrades,
  getStudentProfileCardTarget,
  resolveStudentProfileActiveChapter,
  type StudentProfileCardKey,
  type StudentProfileGradeFilter,
} from "@/lib/student-profile-state";

type StudentFileTab = "details" | "grades" | "exams" | "opportunities" | "followup" | "actions" | "archives" | "timeline";
type StudentProfileAnchor = "calls" | "leaves" | "pledges" | "notes" | null;

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
  isStudentCurrentlyInGrace: (student: Student) => boolean;
  graceEndDate: (student: Student) => string;
};


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
  hasFallback,
  onRetry,
}: {
  loading: boolean;
  error: string | null;
  hasFallback: boolean;
  onRetry: () => void;
}) {
  if (loading) {
    return (
      <div role="status" aria-live="polite" className="rounded-2xl border border-primary/20 bg-primary/5 px-4 py-3 text-sm font-bold text-primary">
        جاري تحميل ملف الطالب الكامل من بيانات النظام…
      </div>
    );
  }
  if (!error) return null;
  return (
    <div role="alert" aria-live="assertive" className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm">
      <p className="min-w-0 flex-1 break-words font-bold text-destructive">
        {error}{hasFallback ? " المعروض أدناه نسخة محلية احتياطية وقد تكون غير مكتملة." : ""}
      </p>
      <button type="button" onClick={onRetry} className="min-h-11 max-w-full touch-manipulation rounded-xl border border-destructive/30 px-3 py-2 font-black text-destructive [overflow-wrap:anywhere] focus:outline-none focus:ring-2 focus:ring-destructive/30">
        إعادة المحاولة
      </button>
    </div>
  );
}

function ProfileCollectionEmpty({
  loading,
  error,
  emptyText,
}: {
  loading: boolean;
  error: string | null;
  emptyText: string;
}) {
  if (loading) return <p role="status" aria-live="polite" className="empty-state py-8">جاري تحميل البيانات من النظام…</p>;
  if (error) return <p role="alert" className="empty-state py-8 text-destructive">تعذر التحقق من هذه البيانات من النظام.</p>;
  return <p className="empty-state py-8">{emptyText}</p>;
}

function InfoBox({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="min-w-0 rounded-2xl border bg-card/80 p-3 shadow-sm sm:rounded-3xl sm:p-4">
      <p className="text-[11px] font-bold text-muted-foreground sm:text-xs">{label}</p>
      <div className="mt-1 min-w-0 break-words text-sm font-black text-foreground">{value}</div>
    </div>
  );
}

function formatScore(grade: Grade, exam?: Exam) {
  return formatGradeScore(grade, exam, "—");
}

function compactDate(value: string | undefined | null) {
  return String(value || "").slice(0, 10);
}

type StudentActionRow = {
  id: string;
  date: string;
  title: string;
  details: string;
  tone: "default" | "danger" | "success" | "secondary";
};

type StudentLogRow = {
  id: string;
  date: string;
  source: string;
  title: string;
  details: string;
  tone: "default" | "danger" | "success" | "secondary" | "info";
};

function opportunityActionTone(action: string): StudentActionRow["tone"] {
  if (action.includes("فصل") || action === "خصم" || action === "خصم تلقائي") return "danger";
  if (action.includes("إعادة تفعيل") || action.includes("فرصة") || action === "إضافة") return "success";
  return "default";
}

function logToneVariant(tone: StudentLogRow["tone"]): "default" | "destructive" | "secondary" | "outline" {
  if (tone === "danger") return "destructive";
  if (tone === "success") return "default";
  if (tone === "info") return "outline";
  return "secondary";
}

function gradeLogDetails(grade: Grade, exam?: Exam) {
  const examName = exam?.name || "امتحان محذوف";
  const examDate = exam?.date ? ` - ${formatAppDate(exam.date)}` : "";
  return `${examName}${examDate} - النتيجة: ${formatScore(grade, exam)} - الحالة: ${grade.status}${grade.notes ? ` - ملاحظة: ${grade.notes}` : ""}`;
}

function leaveLogDetails(leave: StudentLeave, exam?: Exam) {
  const isPeriod = (leave.leaveType || "exam") === "period";
  const scope = isPeriod
    ? `فترة من ${formatAppDate(leave.dateFrom || leave.date)} إلى ${formatAppDate(leave.dateTo || leave.dateFrom || leave.date)}`
    : `امتحان: ${exam?.name || "امتحان محذوف"}`;
  return `${scope} - السبب: ${leave.reason || "—"}${leave.notes ? ` - ملاحظات: ${leave.notes}` : ""}`;
}

function callLogDetails(call: StudentCall, exam?: Exam) {
  const status = call.status || (call.completed ? "تم الاتصال" : "لم يرد");
  const target = call.target ? ` - الجهة: ${call.target}` : "";
  return `${exam?.name || "كل الامتحانات / امتحان محذوف"} - ${status}${target}${call.phone ? ` - الهاتف: ${call.phone}` : ""}${call.notes ? ` - ملاحظات: ${call.notes}` : ""}`;
}

function humanizeProfileText(value: unknown): string {
  return humanizeTeacherProText(String(value || ""))
    .replace(/\[academic-reactivation-link:[^\]]+\]/giu, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function examPenaltyText(exam?: Exam): string {
  if (!exam || exam.noDiscount) return "0";
  if (exam.type === "فاينل") return "فصل/تصفير الفرص حسب القاعدة";
  const penalty = Number(exam.opportunitiesPenalty || 0);
  return Number.isFinite(penalty) && penalty > 0 ? String(Math.trunc(penalty)) : "1";
}

function gradeImpactLabel(kind: GradeClassificationKind, grade: Grade, exam?: Exam): string {
  if (!exam) return "تعذر تحديد قاعدة الامتحان لأن الامتحان محذوف.";
  if (kind === "academic-effect-excluded")
    return grade.academicEffectExclusionReason
      ? `محفوظة للتوثيق فقط بلا أي خصم أو فصل: ${grade.academicEffectExclusionReason}`
      : "محفوظة للتوثيق فقط بلا أي خصم أو فصل.";
  if (kind === "excused") return "لم يتم الخصم: الطالب لديه إجازة تغطي هذا الامتحان.";
  if (kind === "before-registration") return "لم يتم الخصم: الامتحان قبل تاريخ تسجيل الطالب.";
  if (kind === "unavailable-exam") return "لم يتم الاحتساب: الامتحان غير متاح حالياً بحسب التفعيل أو الموعد.";
  if (kind === "grace-period") return "لم يتم الخصم: الامتحان ضمن فترة السماح المحاسبية للطالب.";
  if (kind === "no-discount-protected") return "لم يتم الخصم: هذا الامتحان مضبوط كـ بدون خصم.";
  if (kind === "missing") return "لا توجد محاسبة لأن الدرجة غير مكتملة.";
  if (kind === "cheating") return "غش: أول حالة تفصل مؤقتاً وتصفّر الفرص، والتكرار يفصل نهائياً.";
  if (kind === "absent-dismissal") return "غائب: يعامل كفصل مؤقت لأنه غياب في امتحان فاينل.";
  if (kind === "absent-deducted") return `غائب: تم احتسابه كغياب مخصوم، مقدار الخصم ${examPenaltyText(exam)} فرصة.`;
  if (kind === "discounted") return `درجة ضمن الخصم: تم خصم ${examPenaltyText(exam)} فرصة.`;
  if (kind === "dismissal") return "درجة فصل/صفر: يعامل كفصل مؤقت ويستهلك الفرص المتبقية.";
  if (kind === "academic-accounting") return "راسب غير مخصوم: محسوب أكاديمياً بدون خصم فرص مباشر.";
  if (kind === "failed") return "راسب بدون خصم فرص مباشر.";
  if (kind === "passed" || kind === "full-mark") return "ناجح: لا يوجد خصم.";
  return grade.status === "غائب" ? "غائب: راجع سجل الفرص لمعرفة هل تم الخصم." : "لا يوجد أثر فرص مباشر.";
}

function relatedOpportunityLogsForGrade(
  grade: Grade,
  exam: Exam | undefined,
  opportunityLogs: OpportunityLog[],
): OpportunityLog[] {
  return opportunityLogs.filter((log) => {
    if (log.examId !== grade.examId) return false;
    const reason = String(log.reason || "");
    if (log.id.includes(grade.id)) return true;
    if (exam?.name && reason.includes(exam.name)) return true;
    if (grade.status === "غائب" && reason.includes("غياب")) return true;
    if (grade.status === "غش" && reason.includes("غش")) return true;
    if (grade.status === "درجة" && (reason.includes("درجة") || reason.includes("انتهاء الفرص"))) return true;
    return false;
  });
}

function gradeLogDetailsWithAccounting(
  grade: Grade,
  student: Student,
  exam: Exam | undefined,
  leaves: StudentLeave[],
  opportunityLogs: OpportunityLog[],
) {
  const base = gradeLogDetails(grade, exam);
  if (!exam) return base;
  const kind = classifyGradeAcademicImpact(grade, exam, { student, leaves });
  const relatedLogs = relatedOpportunityLogsForGrade(grade, exam, opportunityLogs);
  const logSummary = relatedLogs.length
    ? ` | سجل الفرص المرتبط: ${relatedLogs
        .map((log) => `${log.action}${log.amount ? ` ${log.amount}` : ""}`)
        .join("، ")}`
    : " | لا يوجد سجل خصم مرتبط بهذا الامتحان";
  return `${base} | الأثر الأكاديمي: ${gradeImpactLabel(kind, grade, exam)}${logSummary}`;
}

type OpportunityTraceRow = {
  log: OpportunityLog;
  deltaText: string;
  details: string;
};

function buildOpportunityTraceRows(logs: OpportunityLog[]): OpportunityTraceRow[] {
  return [...logs]
    .sort((a, b) => String(a.date || "").localeCompare(String(b.date || "")) || String(a.id || "").localeCompare(String(b.id || "")))
    .map((log) => {
      const amount = Math.max(0, Math.trunc(Number(log.amount || 0)));
      const action = String(log.action || "");
      let deltaText = "بدون تغيير مباشر";

      if (action === "إضافة" || action.includes("إعادة تفعيل")) {
        deltaText = `+${amount}`;
      } else if (action === "خصم" || action === "خصم تلقائي") {
        deltaText = `-${amount}`;
      } else if (action === "إعادة تعيين") {
        deltaText = "إعادة تعيين وفق إعداد الفصل وقت الإجراء";
      } else if (action.includes("فرصة أخيرة")) {
        deltaText = `تثبيت فرصة أخيرة: ${amount || 1}`;
      }

      return {
        log,
        deltaText,
        details: `${humanizeProfileText(log.reason) || "—"} | أثر الحركة المسجل: ${deltaText}`,
      };
    });
}

export function StudentProfileDialog({
  student,
  open,
  onOpenChange,
  courseName,
  activeChapterForCourse,
  whatsappLink,
  telegramLink,
  isStudentCurrentlyInGrace,
  graceEndDate,
}: StudentProfileDialogProps) {
  const syncKey = useTeacherProSyncKey(["students", "grades", "opportunities", "opportunity-logs", "follow-up", "correction", "logs", "grade-entry-notes"]);
  const isBackgroundSync = useTeacherProBackgroundSyncDetector(syncKey);
  const [tab, setTab] = useState<StudentFileTab>("details");
  const [gradeViewFilter, setGradeViewFilter] = useState<StudentProfileGradeFilter>("all");
  const [profileAnchor, setProfileAnchor] = useState<StudentProfileAnchor>(null);
  const [databaseStats, setDatabaseStats] = useState<StudentProfileStatsResponse | null>(null);
  const [databaseStatsLoading, setDatabaseStatsLoading] = useState(false);
  const [databaseStatsError, setDatabaseStatsError] = useState<string | null>(null);
  const [databaseStudent, setDatabaseStudent] = useState<Student | null>(null);
  const [databaseGrades, setDatabaseGrades] = useState<Grade[]>([]);
  const [databaseExams, setDatabaseExams] = useState<Exam[]>([]);
  const [databaseOpportunityLogs, setDatabaseOpportunityLogs] = useState<OpportunityLog[]>([]);
  const [databaseStudentLeaves, setDatabaseStudentLeaves] = useState<StudentLeave[]>([]);
  const [databaseStudentCalls, setDatabaseStudentCalls] = useState<StudentCall[]>([]);
  const [databaseStudentNotes, setDatabaseStudentNotes] = useState<StudentNote[]>([]);
  const [databaseLogs, setDatabaseLogs] = useState<LogEntry[]>([]);
  const [databaseEnrollmentArchives, setDatabaseEnrollmentArchives] = useState<
    StudentEnrollmentArchiveRecord[]
  >([]);
  const [databaseGradesLoading, setDatabaseGradesLoading] = useState(false);
  const [databaseGradesError, setDatabaseGradesError] = useState<string | null>(null);
  const [databaseProfileLoaded, setDatabaseProfileLoaded] = useState(false);
  const [databaseProfileStudentId, setDatabaseProfileStudentId] = useState("");
  const [databaseStatsSnapshotVersion, setDatabaseStatsSnapshotVersion] = useState("");
  const [databaseProfileSnapshotVersion, setDatabaseProfileSnapshotVersion] = useState("");
  const [timelineVisibleCount, setTimelineVisibleCount] = useState(100);
  const [manualRefreshKey, setManualRefreshKey] = useState(0);
  const contentScrollRef = useRef<HTMLDivElement | null>(null);
  const dialogRef = useRef<HTMLElement | null>(null);
  const initialFocusRef = useRef<HTMLButtonElement | null>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const onOpenChangeRef = useRef(onOpenChange);
  const sectionRefs = useRef<Partial<Record<Exclude<StudentProfileAnchor, null>, HTMLDivElement | null>>>({});
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
    const statsStudent = databaseStats?.studentId === student.id && databaseStats.student
      ? databaseStats.student as unknown as Student
      : null;
    return {
      ...student,
      ...(statsStudent || {}),
      ...(remoteStudent || {}),
      ...(databaseStats?.studentId === student.id
        ? {
            opportunities: databaseStats.opportunities,
            baseOpportunities: databaseStats.baseOpportunities,
            opportunityLimit: databaseStats.opportunityLimit,
            opportunitySource: databaseStats.opportunitySource,
            opportunityLimitSource: databaseStats.opportunityLimitSource,
            opportunityHealth: databaseStats.opportunityHealth,
            hasActiveChapter: databaseStats.hasActiveChapter,
            activeChapterConflictCount: databaseStats.activeChapterConflictCount,
            activeChapter: databaseStats.activeChapter,
            isOpportunityFull: databaseStats.isOpportunityFull,
            isOpportunityOverLimit: databaseStats.isOpportunityOverLimit,
          }
        : {}),
    };
  }, [student, databaseStudent, databaseStats]);

  const profileExams = useMemo(
    () => (hasAuthoritativeProfile ? [...databaseExams] : []),
    [hasAuthoritativeProfile, databaseExams],
  );
  const profileExamById = useMemo(
    () => new Map(profileExams.map((exam) => [exam.id, exam])),
    [profileExams],
  );

  const studentGrades = useMemo(() => {
    const source = hasAuthoritativeProfile ? databaseGrades : [];
    return [...source].sort((a, b) =>
      String(b.updatedAt || b.createdAt || "").localeCompare(String(a.updatedAt || a.createdAt || "")),
    );
  }, [hasAuthoritativeProfile, databaseGrades]);

  const studentOpportunities = useMemo(() => {
    if (!student) return [];
    const source = hasAuthoritativeProfile ? databaseOpportunityLogs : [];
    return [...source].sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));
  }, [hasAuthoritativeProfile, databaseOpportunityLogs, student]);

  const studentLeavesForProfile = useMemo(() => {
    if (!student) return [];
    const source = hasAuthoritativeProfile ? databaseStudentLeaves : [];
    return [...source].sort((a, b) => String(b.date || b.dateFrom || "").localeCompare(String(a.date || a.dateFrom || "")));
  }, [hasAuthoritativeProfile, databaseStudentLeaves, student]);

  const studentCallsForProfile = useMemo(() => {
    if (!student) return [];
    const source = hasAuthoritativeProfile ? databaseStudentCalls : [];
    return [...source].sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
  }, [hasAuthoritativeProfile, databaseStudentCalls, student]);

  const allStudentNotes = useMemo(() => {
    if (!student) return [];
    const source = hasAuthoritativeProfile ? databaseStudentNotes : [];
    return [...source].sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));
  }, [hasAuthoritativeProfile, databaseStudentNotes, student]);

  const profileSystemLogs = useMemo(() => {
    if (!student) return [];
    const source = hasAuthoritativeProfile ? databaseLogs : [];
    return [...source].sort((a, b) => String(b.time || "").localeCompare(String(a.time || "")));
  }, [hasAuthoritativeProfile, databaseLogs, student]);

  const studentActionNotes = useMemo(
    () => allStudentNotes.filter((note) => note.kind === "إجراء"),
    [allStudentNotes],
  );
  const studentPledges = useMemo(
    () => allStudentNotes.filter((note) => note.kind === "تعهد ولي الأمر"),
    [allStudentNotes],
  );
  const studentGeneralNotes = useMemo(
    () => allStudentNotes.filter((note) => note.kind !== "تعهد ولي الأمر" && note.kind !== "إجراء"),
    [allStudentNotes],
  );

  const opportunityTraceRows = useMemo(() => {
    return buildOpportunityTraceRows(studentOpportunities);
  }, [studentOpportunities]);

  const opportunityTraceByLogId = useMemo(() => {
    const map = new Map<string, OpportunityTraceRow>();
    opportunityTraceRows.forEach((row) => map.set(row.log.id, row));
    return map;
  }, [opportunityTraceRows]);

  const studentActions = useMemo<StudentActionRow[]>(() => {
    if (!effectiveStudent) return [];
    const noteRows = studentActionNotes.map((note) => ({
      id: `note-${note.id}`,
      date: note.date,
      title: note.kind || "إجراء",
      details: note.text,
      tone: note.text.includes("فصل") ? "danger" as const : note.text.includes("إعادة تفعيل") ? "success" as const : "secondary" as const,
    }));
    const opportunityRows = studentOpportunities.map((log) => {
      const trace = opportunityTraceByLogId.get(log.id);
      return {
        id: `opp-${log.id}`,
        date: log.date,
        title: `${log.action}${log.amount ? ` ${log.amount}` : ""}`,
        details: trace?.details || log.reason || "—",
        tone: opportunityActionTone(log.action),
      };
    });
    return [...noteRows, ...opportunityRows].sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));
  }, [effectiveStudent, studentActionNotes, studentOpportunities, opportunityTraceByLogId]);

  const fullStudentLog = useMemo<StudentLogRow[]>(() => {
    if (!effectiveStudent) return [];
    const auditLabels = {
      students: { [effectiveStudent.id]: effectiveStudent.name },
      exams: Object.fromEntries(profileExams.map((exam) => [exam.id, exam.name])),
    };
    const rows: StudentLogRow[] = [
      {
        id: `student-created-${effectiveStudent.id}`,
        date: effectiveStudent.createdAt,
        source: "الطلاب",
        title: "تسجيل الطالب",
        details: `${effectiveStudent.name} - ${effectiveStudent.code} - ${courseName(effectiveStudent.courseId)}`,
        tone: "info",
      },
      ...studentGrades.map((grade) => ({
        id: `grade-${grade.id}`,
        date: grade.updatedAt || grade.createdAt,
        source: "الدرجات",
        title: grade.status === "درجة" ? "درجة مسجلة" : grade.status,
        details: gradeLogDetailsWithAccounting(grade, effectiveStudent, profileExamById.get(grade.examId), studentLeavesForProfile, studentOpportunities),
        tone: grade.status === "درجة" ? "default" as const : grade.status === "غائب" ? "danger" as const : "secondary" as const,
      })),
      ...studentOpportunities.map((log) => {
        const trace = opportunityTraceByLogId.get(log.id);
        return {
          id: `opp-${log.id}`,
          date: log.date,
          source: "الفرص",
          title: `${log.action}${log.amount ? ` ${log.amount}` : ""}`,
          details: trace?.details || log.reason || "—",
          tone: opportunityActionTone(log.action),
        };
      }),
      ...studentLeavesForProfile.map((leave) => ({
        id: `leave-${leave.id}`,
        date: leave.date || leave.dateFrom,
        source: "الإجازات",
        title: (leave.leaveType || "exam") === "period" ? "إجازة فترة" : "إجازة امتحان",
        details: leaveLogDetails(leave, profileExamById.get(leave.examId)),
        tone: "info" as const,
      })),
      ...studentCallsForProfile.map((call) => ({
        id: `call-${call.id}`,
        date: call.completedAt || call.createdAt,
        source: "المكالمات",
        title: call.status || (call.completed ? "تم الاتصال" : "لم يرد"),
        details: callLogDetails(call, profileExamById.get(call.examId)),
        tone: call.completed ? "success" as const : "secondary" as const,
      })),
      ...allStudentNotes.map((note) => {
        const linkedDismissal = note.kind === "تعهد ولي الأمر" && (note.dismissalKey || note.sourceId);
        return {
          id: `note-${note.id}`,
          date: note.date,
          source: "الملاحظات",
          title: note.kind || "ملاحظة",
          details: linkedDismissal
            ? `${note.text} | مرتبط بالفصل: ${note.dismissalType || "فصل"} - ${note.dismissalReason || "بدون سبب"}${note.dismissalDate ? ` - ${note.dismissalDate}` : ""}`
            : note.text,
          tone: note.kind === "تعهد ولي الأمر" ? "success" as const : note.kind === "إجراء" ? "secondary" as const : "info" as const,
        };
      }),
      ...profileSystemLogs.map((log) => {
        const display = formatAuditLogDisplay(log, auditLabels);
        return {
          id: `sys-${log.id}`,
          date: log.time,
          source: humanizeProfileText(log.module || "النظام"),
          title: humanizeProfileText(log.action || "سجل نظام"),
          details: humanizeProfileText(display.summary || "تم تنفيذ إجراء في النظام."),
          tone: log.action?.includes("حذف") || log.action?.includes("فصل") ? "danger" as const : "secondary" as const,
        };
      }),
    ];

    return rows
      .filter((row) => row.date || row.details)
      .sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));
  }, [effectiveStudent, profileExams, profileExamById, studentGrades, studentOpportunities, studentLeavesForProfile, studentCallsForProfile, allStudentNotes, profileSystemLogs, courseName, opportunityTraceByLogId]);

  const visibleStudentLog = useMemo(
    () => fullStudentLog.slice(0, timelineVisibleCount),
    [fullStudentLog, timelineVisibleCount],
  );

  useEffect(() => {
    if (!open) return;
    contentScrollRef.current?.scrollTo({ top: 0, behavior: "auto" });
  }, [open, student?.id, tab]);

  useEffect(() => {
    setTab("details");
    setGradeViewFilter("all");
    setProfileAnchor(null);
    setDatabaseStats(null);
    setDatabaseStatsLoading(false);
    setDatabaseStatsError(null);
    setDatabaseStudent(null);
    setDatabaseGrades([]);
    setDatabaseExams([]);
    setDatabaseOpportunityLogs([]);
    setDatabaseStudentLeaves([]);
    setDatabaseStudentCalls([]);
    setDatabaseStudentNotes([]);
    setDatabaseLogs([]);
    setDatabaseEnrollmentArchives([]);
    setDatabaseGradesLoading(false);
    setDatabaseGradesError(null);
    setDatabaseProfileLoaded(false);
    setDatabaseProfileStudentId("");
    setDatabaseStatsSnapshotVersion("");
    setDatabaseProfileSnapshotVersion("");
    setTimelineVisibleCount(100);
  }, [open, student?.id]);

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
        if (!silent) setDatabaseStatsError("تعذر تحميل إحصاءات ملف الطالب من النظام حالياً.");
      })
      .catch(() => {
        if (!cancelled && !silent) setDatabaseStatsError("تعذر تحميل إحصاءات ملف الطالب من النظام حالياً.");
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
          if (!silent) setDatabaseGradesError("تعذر تحميل ملف الطالب الكامل من النظام حالياً.");
          return;
        }
        setDatabaseGrades((result.grades || []) as unknown as Grade[]);
        setDatabaseExams((result.exams || []) as unknown as Exam[]);
        setDatabaseOpportunityLogs((result.opportunityLogs || []) as unknown as OpportunityLog[]);
        setDatabaseStudentLeaves((result.studentLeaves || []) as unknown as StudentLeave[]);
        setDatabaseStudentCalls((result.studentCalls || []) as unknown as StudentCall[]);
        setDatabaseStudentNotes((result.studentNotes || []) as unknown as StudentNote[]);
        setDatabaseLogs((result.logs || []) as unknown as LogEntry[]);
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
        setDatabaseGradesError("تعذر تحميل ملف الطالب الكامل من النظام حالياً.");
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

  useEffect(() => {
    if (!open || tab !== "followup" || !profileAnchor) return;
    const frame = window.requestAnimationFrame(() => {
      sectionRefs.current[profileAnchor]?.scrollIntoView({ block: "start", behavior: "smooth" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [open, tab, profileAnchor]);

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
    databaseStatsError,
    databaseGradesError,
    snapshotConflict
      ? "تغيّرت بيانات الطالب أثناء تحميل الملف؛ أعد المحاولة للحصول على لقطة موحّدة."
      : null,
  ].filter(Boolean).join(" ") || null;
  const activeChapter = resolveStudentProfileActiveChapter(
    statsForStudent,
    profileStudent.activeChapter,
    activeChapterForCourse(profileStudent.courseId),
  );
  const activeChapterText = statsPending
    ? "جاري التحقق…"
    : statsForStudent?.opportunityHealth === "active-chapter-conflict"
      ? `تعارض: ${statsForStudent.activeChapterConflictCount} فصول نشطة`
      : statsForStudent?.opportunityHealth === "missing-active-chapter"
        ? "لا يوجد فصل نشط"
        : statsForStudent?.opportunityHealth === "zero-limit"
          ? `${activeChapter?.name || "الفصل النشط"} — سقف الفرص 0`
          : activeChapter?.name || (databaseStatsError ? "تعذر التحقق من الفصل النشط" : "لا يوجد فصل نشط");
  const profileStatValue = (value: number | undefined) => {
    if (statsPending) return "…";
    return value ?? "—";
  };
  const opportunityText = statsPending
    ? "…"
    : formatOpportunityBalance(statsForStudent || profileStudent);
  const successCount = profileStatValue(statsForStudent?.success);
  const failedCount = profileStatValue(statsForStudent?.failed);
  const absentCount = profileStatValue(statsForStudent?.absent);
  const graceGradeCount = profileStatValue(statsForStudent?.graceGrades);
  const noDiscountGradeCount = profileStatValue(statsForStudent?.noDiscountGrades);
  const examCount = profileStatValue(statsForStudent?.exams);
  const deductedCount = profileStatValue(statsForStudent?.deductedMovements);
  const addedCount = profileStatValue(statsForStudent?.addedMovements);
  const callsCount = profileStatValue(statsForStudent?.calls);
  const leavesCount = profileStatValue(statsForStudent?.leaves);
  const pledgesCount = profileStatValue(statsForStudent?.pledges);
  const notesCount = profileStatValue(statsForStudent?.notes);
  const dismissalsCount = profileStatValue(statsForStudent?.dismissals);
  const reactivationsCount = profileStatValue(statsForStudent?.reactivations);
  const timelineCount = profileStatValue(statsForStudent?.timeline);

  const gradesEmptyMessage = databaseGradesLoading
    ? "جاري تحميل درجات الطالب من النظام…"
    : databaseGradesError
      ? databaseGradesError
      : databaseStats && databaseStats.grades > 0 && studentGrades.length === 0
        ? "توجد درجات مسجلة في بيانات النظام لكن تعذر عرضها الآن. حدّث الصفحة أو أعد فتح الملف."
        : "لا توجد درجات لهذا الطالب";
  const filteredGradeRows = filterStudentProfileGrades(
    studentGrades.map((grade) => {
      const exam = profileExamById.get(grade.examId);
      const impactKind = exam
        ? classifyGradeAcademicImpact(grade, exam, {
            student: profileStudent,
            leaves: studentLeavesForProfile,
          })
        : "missing";
      const withinGrace = impactKind === "grace-period";
      return {
        grade,
        status: grade.status,
        withinGrace,
        withoutDiscount: Boolean(
          exam?.noDiscount &&
            ["no-discount-protected", "passed", "full-mark"].includes(impactKind),
        ),
        impactKind,
      };
    }),
    gradeViewFilter,
  );

  const allCards: { key: StudentProfileCardKey; label: string; value: string | number; hint: string }[] = [
    { key: "grades", label: "الدرجات", value: profileStatValue(statsForStudent?.grades), hint: "عرض درجات الطالب" },
    { key: "absences", label: "الغيابات", value: absentCount, hint: "عرض الغيابات المؤثرة" },
    { key: "opportunities", label: "الخصومات/الفرص", value: opportunityText, hint: "الفرص والخصومات" },
    { key: "calls", label: "المكالمات", value: callsCount, hint: "متابعة واتصالات" },
    { key: "leaves", label: "الإجازات", value: leavesCount, hint: "إجازات امتحان/فترة" },
    { key: "pledges", label: "التعهدات", value: pledgesCount, hint: "تعهدات ولي الأمر" },
    { key: "status-actions", label: "فصل/إعادة تفعيل", value: `${dismissalsCount}/${reactivationsCount}`, hint: "مسار حالة الطالب" },
    { key: "notes", label: "الملاحظات", value: notesCount, hint: "عرض ملاحظات الطالب" },
    { key: "archives", label: "الملفات السابقة", value: profileLogPending ? "…" : databaseEnrollmentArchives.length, hint: "أرشيف قراءة فقط قبل النقل أو إعادة البداية" },
    { key: "timeline", label: "السجل الزمني", value: timelineCount, hint: "كل حركة مرتبطة بالطالب" },
    { key: "exams", label: "الامتحانات", value: examCount, hint: "عدد الامتحانات" },
    { key: "grace-grades", label: "ضمن السماح", value: graceGradeCount, hint: "درجات مسجلة بدون خصم" },
    { key: "no-discount-grades", label: "بدون خصم", value: noDiscountGradeCount, hint: "درجات امتحانات لا تحاسب الطالب" },
  ];
  const sectionAccess = statsForStudent?.sections;
  const gradeCardKeys = new Set<StudentProfileCardKey>([
    "grades", "absences", "exams", "grace-grades", "no-discount-grades",
  ]);
  const followUpCardKeys = new Set<StudentProfileCardKey>([
    "calls", "leaves", "pledges", "notes",
  ]);
  const cards = !sectionAccess
    ? allCards
    : allCards.filter(({ key }) => {
        if (gradeCardKeys.has(key)) return sectionAccess.grades;
        if (key === "opportunities") return sectionAccess.opportunities;
        if (followUpCardKeys.has(key)) return sectionAccess.followUp;
        if (key === "status-actions") return sectionAccess.opportunities || sectionAccess.followUp;
        if (key === "archives") return sectionAccess.archives;
        if (key === "timeline") {
          return sectionAccess.grades || sectionAccess.opportunities || sectionAccess.followUp || sectionAccess.logs;
        }
        return true;
      });

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
        <div className="tp-student-profile__header sticky top-0 z-30 shrink-0 border-b bg-background/95 px-4 pb-4 pt-[max(1rem,env(safe-area-inset-top))] text-right shadow-sm backdrop-blur supports-[backdrop-filter]:bg-background/80 sm:px-6 sm:pb-6 sm:pt-[max(1.5rem,env(safe-area-inset-top))]">
          <div className="flex min-w-0 flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="min-w-0 space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant={profileStudent.status === "نشط" ? "default" : "destructive"}>{profileStudent.status}</Badge>
                <Badge variant="outline">{profileStudent.code}</Badge>
                <Badge variant="secondary" className="max-w-full whitespace-normal break-words [overflow-wrap:anywhere]">{courseName(profileStudent.courseId)}</Badge>
                <Badge variant="outline" className="border-primary/30 bg-primary/10 text-primary font-bold">فرص: {opportunityText}</Badge>
                <Badge variant="outline" className="border-sky-300/60 bg-sky-500/10 font-bold text-sky-700 dark:text-sky-300">تاريخ الإضافة: {formatAppDate(profileStudent.createdAt, profileStudent.createdAt || "-")}</Badge>
              </div>
              <h2 id="student-profile-title" className="break-words text-2xl font-black sm:text-3xl">{profileStudent.name}</h2>
              <p id="student-profile-description" className="break-words text-xs leading-6 text-muted-foreground sm:text-sm">
                {profileStudent.school || "بدون مدرسة"} - شاشة ملف الطالب
              </p>
            </div>
            <div className="flex shrink-0 flex-wrap items-center gap-2">
              <button
                ref={initialFocusRef}
                type="button"
                onClick={() => onOpenChange(false)}
                className="inline-flex min-h-11 items-center gap-2 rounded-2xl border border-primary/25 bg-primary/10 px-4 py-2 text-sm font-black text-primary shadow-sm transition hover:bg-primary/15 focus:outline-none focus:ring-2 focus:ring-primary/30"
                aria-label="الرجوع من ملف الطالب"
              >
                <ArrowRightIcon className="size-4" />
                رجوع
              </button>
              <button
                type="button"
                onClick={() => onOpenChange(false)}
                className="inline-flex min-h-11 items-center rounded-2xl border border-red-200 bg-red-50 px-4 py-2 text-sm font-black text-red-700 shadow-sm transition hover:bg-red-100 focus:outline-none focus:ring-2 focus:ring-red-300 dark:border-red-900/40 dark:bg-red-950/30 dark:text-red-300 dark:hover:bg-red-950/50"
                aria-label="إغلاق ملف الطالب"
              >
                إغلاق
              </button>
            </div>
          </div>
        </div>

        <div ref={contentScrollRef} className="tp-student-profile__content min-h-0 flex-1 overflow-y-auto overscroll-contain p-4 sm:p-5 lg:p-6 [scrollbar-gutter:stable]">
          <div className="space-y-4 sm:space-y-5">
            <div className="tp-student-profile__nav grid grid-cols-2 gap-2 sm:gap-3 lg:grid-cols-5" aria-label="أقسام ملف الطالب">
              {cards.map((item) => {
                const target = getStudentProfileCardTarget(item.key);
                const targetAnchor = target.followupFilter === "all" ? null : target.followupFilter;
                const isActive = tab === target.tab &&
                  (target.tab !== "grades" || gradeViewFilter === target.gradeFilter) &&
                  (target.tab !== "followup" || profileAnchor === targetAnchor);
                return (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => {
                    setTab(target.tab);
                    setGradeViewFilter(target.gradeFilter);
                    setProfileAnchor(targetAnchor);
                  }}
                  aria-pressed={isActive}
                  aria-controls="student-profile-panel"
                  className={`min-h-11 min-w-0 touch-manipulation rounded-2xl border p-3 text-right shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md sm:rounded-3xl sm:p-4 ${
                    isActive ? "border-primary/50 bg-primary/10 text-primary" : "bg-card/80 hover:border-primary/25"
                  }`}
                >
                  <p className="truncate text-[11px] font-bold text-muted-foreground sm:text-xs">{item.label}</p>
                  <p className="mt-1 truncate text-xl font-black sm:mt-2 sm:text-2xl">{item.value}</p>
                  <p className="mt-1 line-clamp-2 text-[10px] leading-4 text-muted-foreground sm:text-[11px]">{item.hint}</p>
                </button>
              );})}
            </div>

            <ProfileLoadNotice
              loading={(statsPending || profileLogPending) && !profileError}
              error={profileError}
              hasFallback={!hasAuthoritativeProfile || Boolean(statsForStudent)}
              onRetry={retryProfile}
            />

            <div id="student-profile-panel" role="region" aria-live="polite">
            {tab === "details" && (
              <div className="space-y-4">
                <div className="grid gap-2 sm:grid-cols-2 sm:gap-3 xl:grid-cols-4">
                  <InfoBox label="رقم الطالب" value={<ContactLink href={whatsappLink(profileStudent.phone)}>{profileStudent.phone}</ContactLink>} />
                  <InfoBox label="رقم ولي الأمر" value={<ContactLink href={whatsappLink(profileStudent.parentPhone)}>{profileStudent.parentPhone}</ContactLink>} />
                  <InfoBox label="التيليجرام" value={profileStudent.telegram ? <ContactLink href={telegramLink(profileStudent.telegram)}>{profileStudent.telegram}</ContactLink> : "—"} />
                  <InfoBox label="أسلوب الدراسة" value={profileStudent.studyType || "—"} />
                </div>

                <div className="grid gap-4 xl:grid-cols-[minmax(0,1.1fr)_minmax(280px,0.9fr)]">
                  <div className="min-w-0 rounded-2xl border bg-card/80 p-4 shadow-sm sm:rounded-3xl sm:p-5">
                    <h4 className="mb-3 text-base font-black sm:mb-4 sm:text-lg">المعلومات العامة</h4>
                    <div className="grid gap-2 text-sm sm:grid-cols-2 sm:gap-3">
                      <InfoBox label="الجنس" value={profileStudent.gender} />
                      <InfoBox label="نوع الدورة" value={profileStudent.courseProgram || "—"} />
                      <InfoBox label="الكورس" value={profileStudent.courseTerm || "—"} />
                      <InfoBox label="الموقع الكامل" value={formatStudentLocation(profileStudent)} />
                      <InfoBox label="الفصل النشط" value={activeChapterText} />
                      <InfoBox label="تاريخ إضافة الطالب" value={formatAppDate(profileStudent.createdAt, profileStudent.createdAt || "—")} />
                    </div>
                  </div>

                  <div className="min-w-0 rounded-2xl border bg-card/80 p-4 shadow-sm sm:rounded-3xl sm:p-5">
                    <h4 className="mb-3 text-base font-black sm:mb-4 sm:text-lg">ملخص الأداء</h4>
                    <div className="grid grid-cols-2 gap-2 text-center sm:gap-3">
                      <div className="rounded-2xl bg-emerald-500/10 p-3"><p className="text-xl font-black text-emerald-600 sm:text-2xl">{successCount}</p><p className="text-[11px] text-muted-foreground sm:text-xs">ناجح</p></div>
                      <div className="rounded-2xl bg-red-500/10 p-3"><p className="text-xl font-black text-red-600 sm:text-2xl">{failedCount}</p><p className="text-[11px] text-muted-foreground sm:text-xs">راسب غير مخصوم</p></div>
                      <div className="rounded-2xl bg-amber-500/10 p-3"><p className="text-xl font-black text-amber-600 sm:text-2xl">{absentCount}</p><p className="text-[11px] text-muted-foreground sm:text-xs">غياب</p></div>
                      <div className="rounded-2xl bg-primary/10 p-3"><p className="text-xl font-black text-primary sm:text-2xl">{opportunityText}</p><p className="text-[11px] text-muted-foreground sm:text-xs">فرص</p></div>
                    </div>
                    <div className="mt-4 rounded-2xl border p-3 text-xs leading-6 text-muted-foreground">
                      {isStudentCurrentlyInGrace(profileStudent)
                        ? `الطالب ضمن فترة السماح. المتبقي ${getStudentGraceDaysRemaining(profileStudent)} يوم، وتنتهي في ${graceEndDate(profileStudent)}.`
                        : "المحاسبة فعالة. السماح المتبقي: 0 يوم."}
                    </div>
                  </div>
                </div>

                {profileStudent.status === "مفصول" && (
                  <div className="rounded-2xl border border-destructive/30 bg-destructive/5 p-4 text-sm sm:rounded-3xl">
                    <p className="font-black text-destructive">بيانات الفصل</p>
                    <p className="mt-2 break-words">{profileStudent.dismissalType || "—"} - {profileStudent.dismissalReason || "—"}</p>
                    {profileStudent.dismissalNotes && <p className="mt-1 break-words text-muted-foreground">{profileStudent.dismissalNotes}</p>}
                  </div>
                )}
              </div>
            )}

            {tab === "grades" && (
              <div className="rounded-2xl border bg-card/80 p-4 shadow-sm sm:rounded-3xl sm:p-5">
                <h4 className="mb-4 text-base font-black sm:text-lg">{gradeViewFilter === "absent" ? "غيابات الطالب المؤثرة" : gradeViewFilter === "grace" ? "درجات ضمن السماح" : gradeViewFilter === "no-discount" ? "درجات بدون خصم" : "درجات الطالب"}</h4>
                <div className="space-y-2">
                  {filteredGradeRows.length === 0 ? <ProfileCollectionEmpty loading={profileLogPending} error={databaseGradesError} emptyText={gradeViewFilter === "all" ? gradesEmptyMessage : "لا توجد درجات مطابقة لهذا التصنيف"} /> : filteredGradeRows.map(({ grade, withinGrace, withoutDiscount }) => {
                    const exam = profileExamById.get(grade.examId);
                    return (
                      <div key={grade.id} className="grid min-w-0 gap-2 rounded-2xl bg-muted/55 p-3 text-sm md:grid-cols-[minmax(0,1fr)_auto_auto] md:items-center">
                        <div className="min-w-0">
                          <b className="break-words">{exam?.name || "امتحان محذوف"}</b>
                          <p className="text-xs text-muted-foreground">{formatAppDate(exam?.date)}</p>
                          {grade.notes ? <p className="mt-2 rounded-xl border border-amber-200/70 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/25 dark:text-amber-100"><span className="font-bold">ملاحظة الدرجة: </span>{grade.notes}</p> : null}
                        </div>
                        <div className="flex flex-wrap gap-1">
                          {grade.academicEffectExcluded && <Badge className="w-fit" variant="outline">توثيق فقط - بلا أثر أكاديمي</Badge>}
                          {withinGrace && <Badge className="w-fit" variant="outline">ضمن السماح</Badge>}
                          {!withinGrace && withoutDiscount && <Badge className="w-fit" variant="secondary">بدون خصم</Badge>}
                          <Badge className="w-fit" variant={withinGrace || withoutDiscount ? "outline" : grade.status === "درجة" ? "default" : grade.status === "غائب" ? "destructive" : "secondary"}>{grade.status}</Badge>
                          {opportunityText !== "0/0" && <Badge variant="outline" className="text-[10px]">فرص: {opportunityText}</Badge>}
                        </div>
                        <span className="font-black">{formatScore(grade, exam)}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {tab === "exams" && (
              <div className="rounded-2xl border bg-card/80 p-4 shadow-sm sm:rounded-3xl sm:p-5">
                <h4 className="mb-4 text-base font-black sm:text-lg">امتحانات الطالب</h4>
                <div className="grid gap-3 lg:grid-cols-2">
                  {studentGrades.length === 0 ? <ProfileCollectionEmpty loading={profileLogPending} error={databaseGradesError} emptyText={gradesEmptyMessage} /> : studentGrades.map((grade) => {
                    const exam = profileExamById.get(grade.examId);
                    if (!exam) return null;
                    const impactKind = classifyGradeAcademicImpact(grade, exam, {
                      student: profileStudent,
                      leaves: studentLeavesForProfile,
                    });
                    const withinGrace = impactKind === "grace-period";
                    const withoutDiscount = Boolean(
                      exam.noDiscount &&
                        ["no-discount-protected", "passed", "full-mark"].includes(impactKind),
                    );
                    return (
                      <div key={grade.id} className="min-w-0 rounded-2xl border bg-background/60 p-4">
                        <div className="flex min-w-0 items-start justify-between gap-3"><div className="min-w-0"><p className="break-words font-black">{exam.name}</p><p className="text-xs text-muted-foreground">{exam.type} - {formatAppDate(exam.date)}</p></div><div className="flex flex-wrap gap-1">{grade.academicEffectExcluded && <Badge variant="outline">توثيق فقط - بلا أثر أكاديمي</Badge>}{withinGrace && <Badge variant="outline">ضمن السماح</Badge>}{!withinGrace && withoutDiscount && <Badge variant="secondary">بدون خصم</Badge>}<Badge>{grade.status}</Badge></div></div>
                        <div className="mt-3 grid grid-cols-3 gap-2 text-center text-xs"><div className="rounded-xl bg-muted/60 p-2"><b>{exam.fullMark}</b><p>الكاملة</p></div><div className="rounded-xl bg-muted/60 p-2"><b>{exam.passMark}</b><p>النجاح</p></div><div className="rounded-xl bg-muted/60 p-2"><b>{formatGradeScore(grade, exam, "—")}</b><p>درجة الطالب</p></div></div>
                        {grade.notes ? <p className="mt-3 rounded-xl border border-amber-200/70 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/25 dark:text-amber-100"><span className="font-bold">ملاحظة الدرجة: </span>{grade.notes}</p> : null}
                        {grade.academicEffectExcluded && grade.academicEffectExclusionReason ? <p className="mt-2 text-xs font-medium text-sky-700 dark:text-sky-300">سبب عدم الاحتساب: {grade.academicEffectExclusionReason}</p> : null}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {tab === "opportunities" && (
              <div className="rounded-2xl border bg-card/80 p-4 shadow-sm sm:rounded-3xl sm:p-5">
                <h4 className="mb-4 text-base font-black sm:text-lg">سجل الفرص</h4>
                <div className="mb-4 grid gap-2 sm:grid-cols-3 sm:gap-3"><div className="rounded-2xl bg-primary/10 p-3 text-center"><p className="text-xl font-black text-primary sm:text-2xl">{opportunityText}</p><p className="text-xs text-muted-foreground">فرص محفوظة</p></div><div className="rounded-2xl bg-red-500/10 p-3 text-center"><p className="text-xl font-black text-red-600 sm:text-2xl">{deductedCount}</p><p className="text-xs text-muted-foreground">حركات خصم</p></div><div className="rounded-2xl bg-emerald-500/10 p-3 text-center"><p className="text-xl font-black text-emerald-600 sm:text-2xl">{addedCount}</p><p className="text-xs text-muted-foreground">حركات إضافة/تعديل</p></div></div>
                <div className="max-h-72 space-y-2 overflow-y-auto pr-1">
                  {opportunityTraceRows.length === 0 ? <ProfileCollectionEmpty loading={profileLogPending} error={databaseGradesError} emptyText="لا توجد حركات فرص" /> : [...opportunityTraceRows].reverse().map((row) => (
                    <div key={row.log.id} className="grid min-w-0 gap-2 rounded-2xl bg-muted/55 p-3 text-sm md:grid-cols-[auto_auto_minmax(0,1fr)] md:items-center"><span>{formatAppDate(row.log.date)}</span><Badge className="w-fit" variant={row.log.action === "خصم" || row.log.action === "خصم تلقائي" ? "destructive" : "default"}>{row.log.action} {row.log.amount}</Badge><span className="break-words text-muted-foreground">{row.details}</span></div>
                  ))}
                </div>
              </div>
            )}

            {tab === "followup" && (
              <div className="grid gap-4 xl:grid-cols-2">
                <div ref={(node) => { sectionRefs.current.calls = node; }} className="scroll-mt-4 rounded-2xl border bg-card/80 p-4 shadow-sm sm:rounded-3xl sm:p-5">
                  <h4 className="mb-4 text-base font-black sm:text-lg">مكالمات الطالب</h4>
                  <div className="max-h-80 space-y-2 overflow-y-auto pr-1">
                    {studentCallsForProfile.length === 0 ? <ProfileCollectionEmpty loading={profileLogPending} error={databaseGradesError} emptyText="لا توجد مكالمات لهذا الطالب" /> : studentCallsForProfile.map((call) => {
                      const exam = profileExamById.get(call.examId);
                      return (
                        <div key={call.id} className="rounded-2xl bg-muted/55 p-3 text-sm">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <Badge variant={call.completed ? "default" : "secondary"}>{call.status || (call.completed ? "تم الاتصال" : "لم يرد")}</Badge>
                            <span className="text-xs text-muted-foreground">{formatAppDate(call.completedAt || call.createdAt)}</span>
                          </div>
                          <p className="mt-2 break-words font-bold">{exam?.name || "بدون امتحان مرتبط"}</p>
                          <p className="mt-1 break-words text-xs text-muted-foreground">{callLogDetails(call, exam)}</p>
                        </div>
                      );
                    })}
                  </div>
                </div>

                <div ref={(node) => { sectionRefs.current.leaves = node; }} className="scroll-mt-4 rounded-2xl border bg-card/80 p-4 shadow-sm sm:rounded-3xl sm:p-5">
                  <h4 className="mb-4 text-base font-black sm:text-lg">إجازات الطالب</h4>
                  <div className="max-h-80 space-y-2 overflow-y-auto pr-1">
                    {studentLeavesForProfile.length === 0 ? <ProfileCollectionEmpty loading={profileLogPending} error={databaseGradesError} emptyText="لا توجد إجازات لهذا الطالب" /> : studentLeavesForProfile.map((leave) => {
                      const exam = profileExamById.get(leave.examId);
                      return (
                        <div key={leave.id} className="rounded-2xl bg-muted/55 p-3 text-sm">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <Badge variant="outline">{(leave.leaveType || "exam") === "period" ? "إجازة فترة" : "إجازة امتحان"}</Badge>
                            <span className="text-xs text-muted-foreground">{formatAppDate(leave.date || leave.dateFrom)}</span>
                          </div>
                          <p className="mt-2 break-words font-bold">{exam?.name || "بدون امتحان مرتبط"}</p>
                          <p className="mt-1 break-words text-xs text-muted-foreground">{leaveLogDetails(leave, exam)}</p>
                        </div>
                      );
                    })}
                  </div>
                </div>

                <div ref={(node) => { sectionRefs.current.pledges = node; }} className="scroll-mt-4 rounded-2xl border bg-card/80 p-4 shadow-sm sm:rounded-3xl sm:p-5">
                  <h4 className="mb-4 text-base font-black sm:text-lg">تعهدات ولي الأمر</h4>
                  <div className="max-h-80 space-y-2 overflow-y-auto pr-1">
                    {studentPledges.length === 0 ? <ProfileCollectionEmpty loading={profileLogPending} error={databaseGradesError} emptyText="لا توجد تعهدات لهذا الطالب" /> : studentPledges.map((note) => (
                      <div key={note.id} className="rounded-2xl border border-emerald-500/20 bg-emerald-500/10 p-3 text-sm">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <Badge variant="outline">تعهد</Badge>
                          <span className="text-xs text-muted-foreground">{formatAppDate(note.date)}</span>
                        </div>
                        <p className="mt-2 break-words">{note.text}</p>
                        {(note.dismissalType || note.dismissalReason) && (
                          <p className="mt-2 break-words text-xs text-muted-foreground">مرتبط بالفصل: {note.dismissalType || "فصل"} - {note.dismissalReason || "بدون سبب"}</p>
                        )}
                      </div>
                    ))}
                  </div>
                </div>

                <div ref={(node) => { sectionRefs.current.notes = node; }} className="scroll-mt-4 rounded-2xl border bg-card/80 p-4 shadow-sm sm:rounded-3xl sm:p-5">
                  <h4 className="mb-4 text-base font-black sm:text-lg">ملاحظات الطالب</h4>
                  <div className="max-h-80 space-y-2 overflow-y-auto pr-1">
                    {studentGeneralNotes.length === 0 ? <ProfileCollectionEmpty loading={profileLogPending} error={databaseGradesError} emptyText="لا توجد ملاحظات عامة لهذا الطالب" /> : studentGeneralNotes.map((note) => (
                      <div key={note.id} className="rounded-2xl bg-muted/55 p-3 text-sm">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <Badge variant={note.kind === "إجراء" ? "secondary" : "outline"}>{note.kind || "ملاحظة"}</Badge>
                          <span className="text-xs text-muted-foreground">{formatAppDate(note.date)}</span>
                        </div>
                        <p className="mt-2 break-words">{note.text}</p>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {tab === "actions" && (
              <div className="rounded-2xl border bg-card/80 p-4 shadow-sm sm:rounded-3xl sm:p-5">
                <h4 className="mb-4 text-base font-black sm:text-lg">إجراءات ملف الطالب</h4>
                <div className="max-h-96 space-y-2 overflow-y-auto pr-1">
                  {studentActions.length === 0 ? <ProfileCollectionEmpty loading={profileLogPending} error={databaseGradesError} emptyText="لا توجد إجراءات مسجلة لهذا الطالب" /> : studentActions.map((row) => (
                    <div key={row.id} className="grid min-w-0 gap-2 rounded-2xl bg-muted/55 p-3 text-sm md:grid-cols-[auto_auto_minmax(0,1fr)] md:items-center">
                      <span className="font-bold text-muted-foreground">{formatAppDate(row.date)}</span>
                      <Badge className="w-fit" variant={row.tone === "danger" ? "destructive" : row.tone === "secondary" ? "secondary" : "default"}>{row.title}</Badge>
                      <span className="break-words text-muted-foreground">{row.details}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {tab === "archives" && (
              <div className="space-y-4">
                <div className="rounded-2xl border border-sky-300/60 bg-sky-500/10 p-4 text-sm shadow-sm sm:rounded-3xl sm:p-5">
                  <h4 className="font-black text-sky-800 dark:text-sky-200">الملفات السابقة — للقراءة فقط</h4>
                  <p className="mt-1 leading-6 text-muted-foreground">
                    هذه الملفات جُمّدت قبل نقل الطالب إلى دورة جديدة أو قبل اختياره كطالب جديد. لا تدخل درجاتها أو فرصها أو إجراءاتها في ملفه الحالي.
                  </p>
                </div>
                {databaseEnrollmentArchives.length === 0 ? (
                  <ProfileCollectionEmpty loading={profileLogPending} error={databaseGradesError} emptyText="لا توجد ملفات سابقة مؤرشفة لهذا الطالب" />
                ) : (
                  databaseEnrollmentArchives.map((archive) => {
                    const counts = archiveSnapshotCounts(archive);
                    const oldGrades = archiveSnapshotList(archive, "grades");
                    const oldOpportunities = archiveSnapshotList(archive, "opportunityLogs");
                    const oldLeaves = archiveSnapshotList(archive, "studentLeaves");
                    const oldCalls = archiveSnapshotList(archive, "studentCalls");
                    const oldNotes = archiveSnapshotList(archive, "studentNotes");
                    const oldCorrectionSheets = archiveSnapshotList(archive, "correctionSheets");
                    const oldTelegramSubmissions = archiveSnapshotList(archive, "telegramExamSubmissions");
                    const oldLeaveGradeBackups = archiveSnapshotList(archive, "studentLeaveGradeBackups");
                    const oldAuditLogs = archiveSnapshotList(archive, "auditLogs");
                    const oldStudent = archiveSnapshotObject(archive, "student");
                    const oldFollowups: Array<Record<string, any> & { _kind: string }> = [
                      ...oldLeaves.map((item) => ({ ...item, _kind: "إجازة" })),
                      ...oldCalls.map((item) => ({ ...item, _kind: "مكالمة" })),
                    ];
                    return (
                      <article key={archive.id} className="rounded-2xl border bg-card/90 p-4 shadow-sm sm:rounded-3xl sm:p-5">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div>
                            <div className="flex flex-wrap items-center gap-2">
                              <Badge variant="outline">قراءة فقط</Badge>
                              <Badge variant="secondary">
                                {archive.resetKind === "course-transfer" ? "نقل إلى دورة جديدة" : "بدء جديد داخل الدورة"}
                              </Badge>
                            </div>
                            <h5 className="mt-3 text-base font-black sm:text-lg">
                              {archive.fromCourseName || archive.fromCourseId || "دورة سابقة"}
                              {archive.toCourseName ? ` ← ${archive.toCourseName}` : ""}
                            </h5>
                            <p className="mt-1 text-xs leading-6 text-muted-foreground">{archive.reason || "أرشفة ملف الطالب السابق"}</p>
                          </div>
                          <div className="text-left text-xs text-muted-foreground">
                            <p>{formatAppDate(archive.createdAt)}</p>
                            {archive.createdByName && <p className="mt-1">بواسطة: {archive.createdByName}</p>}
                          </div>
                        </div>

                        <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
                          <InfoBox label="كود الملف السابق" value={oldStudent.code || "—"} />
                          <InfoBox label="الحالة السابقة" value={oldStudent.status || "—"} />
                          <InfoBox label="البرنامج/الدورة" value={[oldStudent.courseProgram, oldStudent.courseTerm].filter(Boolean).join(" — ") || "—"} />
                          <InfoBox label="أسلوب الدراسة" value={oldStudent.studyType || "—"} />
                          <InfoBox label="الموقع السابق" value={[oldStudent.locationScope || oldStudent.mainSite, oldStudent.subSite].filter(Boolean).join(" — ") || "—"} />
                          <InfoBox label="الرصيد السابق" value={`${Number(oldStudent.opportunities || 0)}/${Number(oldStudent.baseOpportunities || 0)}`} />
                          <InfoBox label="تاريخ بداية الملف" value={formatAppDate(oldStudent.createdAt)} />
                          <InfoBox label="السماح السابق" value={`${Number(oldStudent.accountingGraceDays || 0)} يوم`} />
                          <InfoBox label="هاتف الطالب" value={oldStudent.phone || "—"} />
                          <InfoBox label="هاتف ولي الأمر" value={oldStudent.parentPhone || "—"} />
                          <InfoBox label="معرف تيليجرام" value={oldStudent.telegram || "—"} />
                          <InfoBox label="المدرسة" value={oldStudent.school || "—"} />
                        </div>

                        <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-8">
                          <InfoBox label="الدرجات" value={counts.grades || 0} />
                          <InfoBox label="حركات الفرص" value={counts.opportunityLogs || 0} />
                          <InfoBox label="الإجازات" value={counts.studentLeaves || 0} />
                          <InfoBox label="المكالمات" value={counts.studentCalls || 0} />
                          <InfoBox label="الملاحظات" value={counts.studentNotes || 0} />
                          <InfoBox label="أوراق التصحيح" value={counts.correctionSheets || 0} />
                          <InfoBox label="مستلمات تيليجرام" value={counts.telegramExamSubmissions || 0} />
                          <InfoBox label="نسخ درجات الإجازات" value={counts.studentLeaveGradeBackups || 0} />
                          <InfoBox label="سجلات النظام" value={counts.auditLogs || 0} />
                        </div>

                        <div className="mt-4 grid gap-3 xl:grid-cols-2">
                          <details className="rounded-2xl border bg-muted/30 p-3">
                            <summary className="cursor-pointer font-black">الدرجات القديمة ({oldGrades.length})</summary>
                            <div className="mt-3 max-h-72 space-y-2 overflow-y-auto">
                              {oldGrades.length === 0 ? <p className="text-xs text-muted-foreground">لا توجد درجات</p> : oldGrades.map((grade) => (
                                <div key={String(grade.id)} className="rounded-xl bg-background p-3 text-xs">
                                  <p className="font-bold">{grade.exam?.name || "امتحان"} — {grade.status || "—"} {grade.score !== null && grade.score !== undefined ? `(${grade.score})` : ""}</p>
                                  <p className="mt-1 text-muted-foreground">{formatAppDate(grade.exam?.date || grade.updatedAt || grade.createdAt)}</p>
                                </div>
                              ))}
                            </div>
                          </details>
                          <details className="rounded-2xl border bg-muted/30 p-3">
                            <summary className="cursor-pointer font-black">الفرص والإجراءات القديمة ({oldOpportunities.length})</summary>
                            <div className="mt-3 max-h-72 space-y-2 overflow-y-auto">
                              {oldOpportunities.length === 0 ? <p className="text-xs text-muted-foreground">لا توجد حركات</p> : oldOpportunities.map((log) => (
                                <div key={String(log.id)} className="rounded-xl bg-background p-3 text-xs">
                                  <p className="font-bold">{log.action || "حركة"} {log.amount ? `— ${log.amount}` : ""}</p>
                                  <p className="mt-1 break-words text-muted-foreground">{humanizeProfileText(log.reason) || "—"} — {formatAppDate(log.date)}</p>
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
                                  <p className="font-bold">{note.kind || "ملاحظة"} — {formatAppDate(note.date)}</p>
                                  <p className="mt-1 break-words text-muted-foreground">{note.text || "—"}</p>
                                </div>
                              ))}
                            </div>
                          </details>
                          <details className="rounded-2xl border bg-muted/30 p-3">
                            <summary className="cursor-pointer font-black">أوراق التصحيح القديمة ({oldCorrectionSheets.length})</summary>
                            <div className="mt-3 max-h-72 space-y-2 overflow-y-auto">
                              {oldCorrectionSheets.length === 0 ? <p className="text-xs text-muted-foreground">لا توجد أوراق تصحيح</p> : oldCorrectionSheets.map((sheet) => (
                                <div key={String(sheet.id)} className="rounded-xl bg-background p-3 text-xs">
                                  <p className="font-bold">{sheet.exam?.name || "امتحان"} — {sheet.status || "—"}</p>
                                  <p className="mt-1 break-words text-muted-foreground">
                                    المصحح: {sheet.corrector?.name || sheet.corrector?.username || "—"} — أخطاء التصحيح: {Number(sheet.correctionErrors || 0)} — أخطاء الجمع: {Number(sheet.sumErrors || 0)}
                                  </p>
                                </div>
                              ))}
                            </div>
                          </details>
                          <details className="rounded-2xl border bg-muted/30 p-3">
                            <summary className="cursor-pointer font-black">مستلمات تيليجرام القديمة ({oldTelegramSubmissions.length})</summary>
                            <div className="mt-3 max-h-72 space-y-2 overflow-y-auto">
                              {oldTelegramSubmissions.length === 0 ? <p className="text-xs text-muted-foreground">لا توجد مستلمات تيليجرام</p> : oldTelegramSubmissions.map((submission) => (
                                <div key={String(submission.id)} className="rounded-xl bg-background p-3 text-xs">
                                  <p className="font-bold">{submission.exam?.name || "امتحان"} — {submission.status || "—"}</p>
                                  <p className="mt-1 break-words text-muted-foreground">
                                    الصفحات: {Number(submission.pageCount || 0)} — المطابقة: {submission.matchType || "—"} — الاستلام: {formatAppDate(submission.receivedAt || submission.submittedAt)}
                                  </p>
                                  {submission.notes ? <p className="mt-1 break-words text-muted-foreground">{submission.notes}</p> : null}
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
                                  <p className="mt-1 break-words text-muted-foreground">{backup.notes || "بدون ملاحظات"} — {formatAppDate(backup.gradeUpdatedAt || backup.gradeCreatedAt || backup.createdAt)}</p>
                                </div>
                              ))}
                            </div>
                          </details>
                          <details className="rounded-2xl border bg-muted/30 p-3">
                            <summary className="cursor-pointer font-black">سجلات النظام القديمة ({oldAuditLogs.length})</summary>
                            <div className="mt-3 max-h-72 space-y-2 overflow-y-auto">
                              {oldAuditLogs.length === 0 ? <p className="text-xs text-muted-foreground">لا توجد سجلات نظام</p> : oldAuditLogs.map((log) => (
                                <div key={String(log.id)} className="rounded-xl bg-background p-3 text-xs">
                                  <p className="font-bold">{humanizeProfileText(log.module || "النظام")} — {humanizeProfileText(log.action || "إجراء")}</p>
                                  <p className="mt-1 break-words text-muted-foreground">{humanizeProfileText(formatAuditLogDisplay(log).summary)} — {formatAppDate(log.time)}</p>
                                </div>
                              ))}
                            </div>
                          </details>
                        </div>
                      </article>
                    );
                  })
                )}
              </div>
            )}

            {tab === "timeline" && (
            <div className="rounded-2xl border bg-card/90 p-4 shadow-sm sm:rounded-3xl sm:p-5">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h4 className="text-base font-black sm:text-lg">اللوغ الكامل للطالب</h4>
                  <p className="text-xs text-muted-foreground">يعرض الدرجات، الإجازات، المكالمات، الملاحظات، حركات الفرص، وسجلات النظام المرتبطة بالطالب.</p>
                </div>
                <Badge variant="outline">{fullStudentLog.length} سجل</Badge>
              </div>
              <div className="max-h-[32rem] space-y-2 overflow-y-auto pr-1">
                {fullStudentLog.length === 0 ? <ProfileCollectionEmpty loading={profileLogPending} error={databaseGradesError} emptyText="لا يوجد لوغ لهذا الطالب" /> : visibleStudentLog.map((row) => (
                  <div key={row.id} className="grid min-w-0 gap-2 rounded-2xl bg-muted/50 p-3 text-sm lg:grid-cols-[8rem_7rem_9rem_minmax(0,1fr)] lg:items-start">
                    <span className="font-bold text-muted-foreground">{formatAppDate(compactDate(row.date) || row.date)}</span>
                    <Badge className="w-fit" variant={logToneVariant(row.tone)}>{row.source}</Badge>
                    <span className="font-black">{row.title}</span>
                    <span className="min-w-0 break-words text-muted-foreground">{row.details}</span>
                  </div>
                ))}
              </div>
              {visibleStudentLog.length < fullStudentLog.length && (
                <button
                  type="button"
                  onClick={() => setTimelineVisibleCount((value) => value + 100)}
                  className="mx-auto mt-4 block min-h-11 max-w-full touch-manipulation rounded-xl border px-4 py-2 text-sm font-black text-primary [overflow-wrap:anywhere] hover:bg-primary/5 focus:outline-none focus:ring-2 focus:ring-primary/30"
                >
                  عرض المزيد ({fullStudentLog.length - visibleStudentLog.length} متبقٍ)
                </button>
              )}
            </div>

            )}
            </div>
          </div>
        </div>
      </div>
    </section>
  );

  return createPortal(profileContent, document.body);
}
