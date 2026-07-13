"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
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
import { formatGradeScore, isExamWithinStudentGracePeriod } from "@/lib/exam-utils";
import {
  studentProfileLogApi,
  studentProfileStatsApi,
  type StudentEnrollmentArchiveRecord,
  type StudentProfileStatsResponse,
} from "@/lib/api";
import { classifyGradeAcademicImpact, type GradeClassificationKind } from "@/lib/grade-classification";
import { ArrowRightIcon } from "lucide-react";
import { useTeacherProBackgroundSyncDetector, useTeacherProSyncKey } from "@/hooks/use-teacherpro-sync";
import { formatOpportunityBalance, getOpportunityLimit } from "@/lib/opportunity-balance";

type StudentFileTab = "details" | "grades" | "exams" | "opportunities" | "followup" | "actions" | "archives" | "timeline";

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
  return (
    <a href={href} className="break-words font-bold text-primary underline-offset-4 hover:underline">
      {children || "—"}
    </a>
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

function systemLogMatchesStudent(log: LogEntry, student: Student) {
  const haystack = `${log.details || ""} ${log.action || ""}`.toLowerCase();
  const candidates = [student.id, student.code, student.name, student.phone, student.parentPhone]
    .map((value) => String(value || "").trim().toLowerCase())
    .filter((value) => value.length >= 3);
  return candidates.some((value) => haystack.includes(value));
}

function mergeById<T extends { id: string }>(localItems: T[], databaseItems: T[]): T[] {
  const byId = new Map<string, T>();
  for (const item of localItems) byId.set(item.id, item);
  for (const item of databaseItems) byId.set(item.id, item);
  return Array.from(byId.values());
}

function examPenaltyText(exam?: Exam): string {
  if (!exam || exam.noDiscount) return "0";
  if (exam.type === "فاينل") return "فصل/تصفير الفرص حسب القاعدة";
  const penalty = Number(exam.opportunitiesPenalty || 0);
  return Number.isFinite(penalty) && penalty > 0 ? String(Math.trunc(penalty)) : "1";
}

function gradeImpactLabel(kind: GradeClassificationKind, grade: Grade, exam?: Exam): string {
  if (!exam) return "تعذر تحديد قاعدة الامتحان لأن الامتحان محذوف.";
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
  before: number;
  after: number;
  deltaText: string;
  details: string;
};

function buildOpportunityTraceRows(
  logs: OpportunityLog[],
  baseOpportunities: number,
): OpportunityTraceRow[] {
  let balance = Math.max(0, Math.trunc(Number(baseOpportunities || 0)));
  return [...logs]
    .sort((a, b) => String(a.date || "").localeCompare(String(b.date || "")) || String(a.id || "").localeCompare(String(b.id || "")))
    .map((log) => {
      const before = balance;
      const amount = Math.max(0, Math.trunc(Number(log.amount || 0)));
      const action = String(log.action || "");
      let deltaText = "بدون تغيير مباشر";

      if (action === "إضافة" || action.includes("إعادة تفعيل")) {
        balance += amount;
        deltaText = `+${amount}`;
      } else if (action === "خصم" || action === "خصم تلقائي") {
        balance = Math.max(0, balance - amount);
        deltaText = `-${amount}`;
      } else if (action === "إعادة تعيين") {
        balance = Math.max(0, Math.trunc(Number(baseOpportunities || 0)));
        deltaText = "إعادة تعيين للرصيد الأساسي";
      } else if (action.includes("فرصة أخيرة")) {
        balance = amount || 1;
        deltaText = `تثبيت فرصة أخيرة: ${balance}`;
      }

      const after = balance;
      return {
        log,
        before,
        after,
        deltaText,
        details: `${log.reason || "—"} | الرصيد قبل: ${before} | التغيير: ${deltaText} | الرصيد بعد: ${after}`,
      };
    });
}

export function StudentProfileDialog({
  student,
  open,
  onOpenChange,
  exams,
  grades,
  opportunityLogs,
  studentLeaves = [],
  studentCalls = [],
  studentNotes,
  logs = [],
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
  const [databaseStats, setDatabaseStats] = useState<StudentProfileStatsResponse | null>(null);
  const [databaseStatsLoading, setDatabaseStatsLoading] = useState(false);
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
  const contentScrollRef = useRef<HTMLDivElement | null>(null);
  const [isMounted, setIsMounted] = useState(false);

  useEffect(() => {
    setIsMounted(true);
  }, []);

  const profileExams = useMemo(
    () => mergeById(exams, databaseExams),
    [exams, databaseExams],
  );

  const localStudentGrades = useMemo(
    () => (student ? grades.filter((grade) => grade.studentId === student.id) : []),
    [grades, student],
  );

  const studentGrades = useMemo(() => {
    const byId = new Map<string, Grade>();
    for (const grade of localStudentGrades) byId.set(grade.id, grade);
    for (const grade of databaseGrades) byId.set(grade.id, grade);
    return Array.from(byId.values()).sort((a, b) =>
      String(b.updatedAt || b.createdAt || "").localeCompare(String(a.updatedAt || a.createdAt || "")),
    );
  }, [localStudentGrades, databaseGrades]);

  const studentOpportunities = useMemo(() => {
    if (!student) return [];
    return mergeById(
      opportunityLogs.filter((log) => log.studentId === student.id),
      databaseOpportunityLogs,
    ).sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));
  }, [opportunityLogs, databaseOpportunityLogs, student]);

  const studentLeavesForProfile = useMemo(() => {
    if (!student) return [];
    return mergeById(
      studentLeaves.filter((leave) => leave.studentId === student.id),
      databaseStudentLeaves,
    ).sort((a, b) => String(b.date || b.dateFrom || "").localeCompare(String(a.date || a.dateFrom || "")));
  }, [studentLeaves, databaseStudentLeaves, student]);

  const studentCallsForProfile = useMemo(() => {
    if (!student) return [];
    return mergeById(
      studentCalls.filter((call) => call.studentId === student.id),
      databaseStudentCalls,
    ).sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
  }, [studentCalls, databaseStudentCalls, student]);

  const allStudentNotes = useMemo(() => {
    if (!student) return [];
    return mergeById(
      studentNotes.filter((note) => note.studentId === student.id),
      databaseStudentNotes,
    ).sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));
  }, [studentNotes, databaseStudentNotes, student]);

  const profileSystemLogs = useMemo(() => {
    if (!student) return [];
    return mergeById(
      logs.filter((log) => systemLogMatchesStudent(log, student)),
      databaseLogs,
    ).sort((a, b) => String(b.time || "").localeCompare(String(a.time || "")));
  }, [logs, databaseLogs, student]);

  const studentActionNotes = useMemo(
    () => allStudentNotes.filter((note) => note.kind === "إجراء"),
    [allStudentNotes],
  );

  const opportunityTraceRows = useMemo(() => {
    const source = databaseStats || student;
    const base = Number(
      getOpportunityLimit(source) ??
        databaseStats?.baseOpportunities ??
        student?.baseOpportunities ??
        0,
    );
    return buildOpportunityTraceRows(studentOpportunities, base);
  }, [studentOpportunities, databaseStats, student]);

  const opportunityTraceByLogId = useMemo(() => {
    const map = new Map<string, OpportunityTraceRow>();
    opportunityTraceRows.forEach((row) => map.set(row.log.id, row));
    return map;
  }, [opportunityTraceRows]);

  const studentActions = useMemo<StudentActionRow[]>(() => {
    if (!student) return [];
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
  }, [student, studentActionNotes, studentOpportunities, opportunityTraceByLogId]);

  const fullStudentLog = useMemo<StudentLogRow[]>(() => {
    if (!student) return [];
    const examById = new Map(profileExams.map((exam) => [exam.id, exam]));
    const rows: StudentLogRow[] = [
      {
        id: `student-created-${student.id}`,
        date: student.createdAt,
        source: "الطلاب",
        title: "تسجيل الطالب",
        details: `${student.name} - ${student.code} - ${courseName(student.courseId)}`,
        tone: "info",
      },
      ...studentGrades.map((grade) => ({
        id: `grade-${grade.id}`,
        date: grade.updatedAt || grade.createdAt,
        source: "الدرجات",
        title: grade.status === "درجة" ? "درجة مسجلة" : grade.status,
        details: gradeLogDetailsWithAccounting(grade, student, examById.get(grade.examId), studentLeavesForProfile, studentOpportunities),
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
        details: leaveLogDetails(leave, examById.get(leave.examId)),
        tone: "info" as const,
      })),
      ...studentCallsForProfile.map((call) => ({
        id: `call-${call.id}`,
        date: call.completedAt || call.createdAt,
        source: "المكالمات",
        title: call.status || (call.completed ? "تم الاتصال" : "لم يرد"),
        details: callLogDetails(call, examById.get(call.examId)),
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
      ...profileSystemLogs.map((log) => ({
        id: `sys-${log.id}`,
        date: log.time,
        source: log.module || "النظام",
        title: log.action || "سجل نظام",
        details: log.details || "—",
        tone: log.action?.includes("حذف") || log.action?.includes("فصل") ? "danger" as const : "secondary" as const,
      })),
    ];

    return rows
      .filter((row) => row.date || row.details)
      .sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));
  }, [student, profileExams, studentGrades, studentOpportunities, studentLeavesForProfile, studentCallsForProfile, allStudentNotes, profileSystemLogs, courseName, opportunityTraceByLogId]);

  useEffect(() => {
    if (!open) return;
    contentScrollRef.current?.scrollTo({ top: 0, behavior: "auto" });
  }, [open, student?.id, tab]);

  useEffect(() => {
    if (!open || !student?.id) {
      setDatabaseStats(null);
      setDatabaseStatsLoading(false);
      return;
    }

    let cancelled = false;
    const silent = isBackgroundSync();
    if (!silent) setDatabaseStatsLoading(true);
    studentProfileStatsApi
      .get(student.id)
      .then((result) => {
        if (!cancelled) setDatabaseStats(result);
      })
      .catch(() => {
        if (!cancelled && !silent) setDatabaseStats(null);
      })
      .finally(() => {
        if (!cancelled) setDatabaseStatsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [open, student?.id, syncKey, isBackgroundSync]);

  useEffect(() => {
    if (!open || !student?.id) {
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
      return;
    }

    let cancelled = false;
    const silent = isBackgroundSync();
    if (!silent) setDatabaseGradesLoading(true);
    if (!silent) setDatabaseGradesError(null);

    studentProfileLogApi
      .get(student.id)
      .then((result) => {
        if (cancelled) return;
        if (!result) {
          if (!silent) {
            setDatabaseGrades([]);
            setDatabaseExams([]);
            setDatabaseOpportunityLogs([]);
            setDatabaseStudentLeaves([]);
            setDatabaseStudentCalls([]);
            setDatabaseStudentNotes([]);
            setDatabaseLogs([]);
            setDatabaseGradesError("تعذر تحميل لوغ الطالب الكامل من النظام حالياً.");
          }
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
      })
      .catch(() => {
        if (cancelled || silent) return;
        setDatabaseGrades([]);
        setDatabaseExams([]);
        setDatabaseOpportunityLogs([]);
        setDatabaseStudentLeaves([]);
        setDatabaseStudentCalls([]);
        setDatabaseStudentNotes([]);
        setDatabaseLogs([]);
        setDatabaseEnrollmentArchives([]);
        setDatabaseGradesError("تعذر تحميل لوغ الطالب الكامل من النظام حالياً.");
      })
      .finally(() => {
        if (!cancelled) setDatabaseGradesLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [open, student?.id, syncKey, isBackgroundSync]);

  if (!open || !student || !isMounted) return null;

  const activeChapter = activeChapterForCourse(student.courseId);
  const profileStatValue = (value: number | undefined) => {
    if (databaseStatsLoading && !databaseStats) return "…";
    return value ?? "—";
  };
  const opportunityText = databaseStatsLoading && !databaseStats
    ? "…"
    : databaseStats
      ? formatOpportunityBalance(databaseStats)
      : "—";
  const successCount = profileStatValue(databaseStats?.success);
  const failedCount = profileStatValue(databaseStats?.failed);
  const absentCount = profileStatValue(databaseStats?.absent);
  const graceGradeCount = profileStatValue(databaseStats?.graceGrades);
  const noDiscountGradeCount = profileStatValue(databaseStats?.noDiscountGrades);
  const examCount = profileStatValue(databaseStats?.exams);
  const deductedCount = profileStatValue(databaseStats?.deductedMovements);
  const addedCount = profileStatValue(databaseStats?.addedMovements);
  const callsCount = profileStatValue(databaseStats?.calls);
  const leavesCount = profileStatValue(databaseStats?.leaves);
  const pledgesCount = profileStatValue(databaseStats?.pledges);
  const notesCount = profileStatValue(databaseStats?.notes);
  const dismissalsCount = profileStatValue(databaseStats?.dismissals);
  const reactivationsCount = profileStatValue(databaseStats?.reactivations);
  const timelineCount = profileStatValue(databaseStats?.timeline);

  const gradesEmptyMessage = databaseGradesLoading
    ? "جاري تحميل درجات الطالب من النظام…"
    : databaseGradesError
      ? databaseGradesError
      : databaseStats && databaseStats.grades > 0 && studentGrades.length === 0
        ? "توجد درجات مسجلة في بيانات النظام لكن تعذر عرضها الآن. حدّث الصفحة أو أعد فتح الملف."
        : "لا توجد درجات لهذا الطالب";

  const cards: { id: StudentFileTab; label: string; value: string | number; hint: string }[] = [
    { id: "grades", label: "الدرجات", value: profileStatValue(databaseStats?.grades), hint: "عرض درجات الطالب" },
    { id: "details", label: "الغيابات", value: absentCount, hint: "غيابات مؤثرة أكاديمياً" },
    { id: "opportunities", label: "الخصومات/الفرص", value: opportunityText, hint: "الفرص والخصومات" },
    { id: "followup", label: "المكالمات", value: callsCount, hint: "متابعة واتصالات" },
    { id: "followup", label: "الإجازات", value: leavesCount, hint: "إجازات امتحان/فترة" },
    { id: "followup", label: "التعهدات", value: pledgesCount, hint: "تعهدات ولي الأمر" },
    { id: "actions", label: "فصل/إعادة تفعيل", value: `${dismissalsCount}/${reactivationsCount}`, hint: "مسار حالة الطالب" },
    { id: "actions", label: "الملاحظات", value: notesCount, hint: "ملاحظات وإجراءات" },
    { id: "archives", label: "الملفات السابقة", value: databaseEnrollmentArchives.length, hint: "أرشيف قراءة فقط قبل النقل أو إعادة البداية" },
    { id: "timeline", label: "السجل الزمني", value: timelineCount, hint: "كل حركة مرتبطة بالطالب" },
    { id: "exams", label: "الامتحانات", value: examCount, hint: "عدد الامتحانات" },
    { id: "grades", label: "ضمن السماح", value: graceGradeCount, hint: "درجات مسجلة بدون خصم" },
    { id: "grades", label: "بدون خصم", value: noDiscountGradeCount, hint: "درجات امتحانات لا تحاسب الطالب" },
  ];

  const profileContent = (
    <section
      dir="rtl"
      className="fixed inset-0 z-[999] flex h-[100dvh] w-screen max-w-none flex-col overflow-hidden bg-background text-foreground"
      aria-labelledby="student-profile-title"
      role="dialog"
      aria-modal="true"
    >
      <div className="flex h-full min-h-0 w-full flex-1 flex-col overflow-hidden bg-background">
        <div className="sticky top-0 z-30 shrink-0 border-b bg-background/95 p-4 text-right shadow-sm backdrop-blur supports-[backdrop-filter]:bg-background/80 sm:p-6">
          <div className="flex min-w-0 flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="min-w-0 space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant={student.status === "نشط" ? "default" : "destructive"}>{student.status}</Badge>
                <Badge variant="outline">{student.code}</Badge>
                <Badge variant="secondary" className="max-w-full truncate">{courseName(student.courseId)}</Badge>
                <Badge variant="outline" className="border-primary/30 bg-primary/10 text-primary font-bold">فرص: {opportunityText}</Badge>
                <Badge variant="outline" className="border-sky-300/60 bg-sky-500/10 font-bold text-sky-700 dark:text-sky-300">تاريخ الإضافة: {formatAppDate(student.createdAt, student.createdAt || "-")}</Badge>
              </div>
              <h2 id="student-profile-title" className="break-words text-2xl font-black sm:text-3xl">{student.name}</h2>
              <p className="break-words text-xs leading-6 text-muted-foreground sm:text-sm">
                {student.school || "بدون مدرسة"} - شاشة ملف الطالب
              </p>
            </div>
            <div className="flex shrink-0 flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => onOpenChange(false)}
                className="inline-flex min-h-10 items-center gap-2 rounded-2xl border border-primary/25 bg-primary/10 px-4 py-2 text-sm font-black text-primary shadow-sm transition hover:bg-primary/15 focus:outline-none focus:ring-2 focus:ring-primary/30"
                aria-label="الرجوع من ملف الطالب"
              >
                <ArrowRightIcon className="size-4" />
                رجوع
              </button>
              <button
                type="button"
                onClick={() => onOpenChange(false)}
                className="inline-flex min-h-10 items-center rounded-2xl border border-red-200 bg-red-50 px-4 py-2 text-sm font-black text-red-700 shadow-sm transition hover:bg-red-100 focus:outline-none focus:ring-2 focus:ring-red-300 dark:border-red-900/40 dark:bg-red-950/30 dark:text-red-300 dark:hover:bg-red-950/50"
                aria-label="إغلاق ملف الطالب"
              >
                إغلاق
              </button>
            </div>
          </div>
        </div>

        <div ref={contentScrollRef} className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4 sm:p-5 lg:p-6 [scrollbar-gutter:stable]">
          <div className="space-y-4 sm:space-y-5">
            <div className="grid grid-cols-2 gap-2 sm:gap-3 lg:grid-cols-5">
              {cards.map((item) => (
                <button
                  key={`${item.id}-${item.label}`}
                  type="button"
                  onClick={() => setTab(item.id)}
                  className={`min-w-0 rounded-2xl border p-3 text-right shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md sm:rounded-3xl sm:p-4 ${
                    tab === item.id ? "border-primary/50 bg-primary/10 text-primary" : "bg-card/80 hover:border-primary/25"
                  }`}
                >
                  <p className="truncate text-[11px] font-bold text-muted-foreground sm:text-xs">{item.label}</p>
                  <p className="mt-1 truncate text-xl font-black sm:mt-2 sm:text-2xl">{item.value}</p>
                  <p className="mt-1 line-clamp-2 text-[10px] leading-4 text-muted-foreground sm:text-[11px]">{item.hint}</p>
                </button>
              ))}
            </div>

            {tab === "details" && (
              <div className="space-y-4">
                <div className="grid gap-2 sm:grid-cols-2 sm:gap-3 xl:grid-cols-4">
                  <InfoBox label="رقم الطالب" value={<ContactLink href={whatsappLink(student.phone)}>{student.phone}</ContactLink>} />
                  <InfoBox label="رقم ولي الأمر" value={<ContactLink href={whatsappLink(student.parentPhone)}>{student.parentPhone}</ContactLink>} />
                  <InfoBox label="التيليجرام" value={student.telegram ? <ContactLink href={telegramLink(student.telegram)}>{student.telegram}</ContactLink> : "—"} />
                  <InfoBox label="نوع البرنامج" value={student.studyType || "—"} />
                </div>

                <div className="grid gap-4 xl:grid-cols-[minmax(0,1.1fr)_minmax(280px,0.9fr)]">
                  <div className="min-w-0 rounded-2xl border bg-card/80 p-4 shadow-sm sm:rounded-3xl sm:p-5">
                    <h4 className="mb-3 text-base font-black sm:mb-4 sm:text-lg">المعلومات العامة</h4>
                    <div className="grid gap-2 text-sm sm:grid-cols-2 sm:gap-3">
                      <InfoBox label="الجنس" value={student.gender} />
                      <InfoBox label="نوع الدورة" value={student.courseProgram || "—"} />
                      <InfoBox label="الكورس" value={student.courseTerm || "—"} />
                      <InfoBox label="الموقع الكامل" value={`${student.locationScope || student.mainSite || "-"} - ${student.subSite || "-"}`} />
                      <InfoBox label="الفصل النشط" value={activeChapter?.name || "لم يتم اختيار الفصل لهم بعد"} />
                      <InfoBox label="تاريخ إضافة الطالب" value={formatAppDate(student.createdAt, student.createdAt || "—")} />
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
                      {isStudentCurrentlyInGrace(student)
                        ? `الطالب ضمن فترة السماح. تنتهي في ${graceEndDate(student)}.`
                        : `المحاسبة فعالة. فترة السماح: ${student.accountingGraceDays ?? 0} يوم.`}
                    </div>
                  </div>
                </div>

                {student.status === "مفصول" && (
                  <div className="rounded-2xl border border-destructive/30 bg-destructive/5 p-4 text-sm sm:rounded-3xl">
                    <p className="font-black text-destructive">بيانات الفصل</p>
                    <p className="mt-2 break-words">{student.dismissalType || "—"} - {student.dismissalReason || "—"}</p>
                    {student.dismissalNotes && <p className="mt-1 break-words text-muted-foreground">{student.dismissalNotes}</p>}
                  </div>
                )}
              </div>
            )}

            {tab === "grades" && (
              <div className="rounded-2xl border bg-card/80 p-4 shadow-sm sm:rounded-3xl sm:p-5">
                <h4 className="mb-4 text-base font-black sm:text-lg">درجات الطالب</h4>
                <div className="space-y-2">
                  {studentGrades.length === 0 ? <p className="empty-state py-8">{gradesEmptyMessage}</p> : studentGrades.map((grade) => {
                    const exam = profileExams.find((item) => item.id === grade.examId);
                    const withinGrace = Boolean(exam && isExamWithinStudentGracePeriod(student, exam));
                    const withoutDiscount = Boolean(exam?.noDiscount);
                    return (
                      <div key={grade.id} className="grid min-w-0 gap-2 rounded-2xl bg-muted/55 p-3 text-sm md:grid-cols-[minmax(0,1fr)_auto_auto] md:items-center">
                        <div className="min-w-0">
                          <b className="break-words">{exam?.name || "امتحان محذوف"}</b>
                          <p className="text-xs text-muted-foreground">{formatAppDate(exam?.date)}</p>
                          {grade.notes ? <p className="mt-2 rounded-xl border border-amber-200/70 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/25 dark:text-amber-100"><span className="font-bold">ملاحظة الدرجة: </span>{grade.notes}</p> : null}
                        </div>
                        <div className="flex flex-wrap gap-1">
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
                  {studentGrades.length === 0 ? <p className="empty-state py-8 lg:col-span-2">{gradesEmptyMessage}</p> : studentGrades.map((grade) => {
                    const exam = profileExams.find((item) => item.id === grade.examId);
                    if (!exam) return null;
                    const withinGrace = isExamWithinStudentGracePeriod(student, exam);
                    const withoutDiscount = Boolean(exam.noDiscount);
                    return (
                      <div key={grade.id} className="min-w-0 rounded-2xl border bg-background/60 p-4">
                        <div className="flex min-w-0 items-start justify-between gap-3"><div className="min-w-0"><p className="break-words font-black">{exam.name}</p><p className="text-xs text-muted-foreground">{exam.type} - {formatAppDate(exam.date)}</p></div><div className="flex flex-wrap gap-1">{withinGrace && <Badge variant="outline">ضمن السماح</Badge>}{!withinGrace && withoutDiscount && <Badge variant="secondary">بدون خصم</Badge>}<Badge>{grade.status}</Badge></div></div>
                        <div className="mt-3 grid grid-cols-3 gap-2 text-center text-xs"><div className="rounded-xl bg-muted/60 p-2"><b>{exam.fullMark}</b><p>الكاملة</p></div><div className="rounded-xl bg-muted/60 p-2"><b>{exam.passMark}</b><p>النجاح</p></div><div className="rounded-xl bg-muted/60 p-2"><b>{formatGradeScore(grade, exam, "—")}</b><p>درجة الطالب</p></div></div>
                        {grade.notes ? <p className="mt-3 rounded-xl border border-amber-200/70 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/25 dark:text-amber-100"><span className="font-bold">ملاحظة الدرجة: </span>{grade.notes}</p> : null}
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
                  {opportunityTraceRows.length === 0 ? <p className="empty-state py-8">لا توجد حركات فرص</p> : [...opportunityTraceRows].reverse().map((row) => (
                    <div key={row.log.id} className="grid min-w-0 gap-2 rounded-2xl bg-muted/55 p-3 text-sm md:grid-cols-[auto_auto_minmax(0,1fr)] md:items-center"><span>{formatAppDate(row.log.date)}</span><Badge className="w-fit" variant={row.log.action === "خصم" || row.log.action === "خصم تلقائي" ? "destructive" : "default"}>{row.log.action} {row.log.amount}</Badge><span className="break-words text-muted-foreground">{row.details}</span></div>
                  ))}
                </div>
              </div>
            )}

            {tab === "followup" && (
              <div className="grid gap-4 xl:grid-cols-2">
                <div className="rounded-2xl border bg-card/80 p-4 shadow-sm sm:rounded-3xl sm:p-5">
                  <h4 className="mb-4 text-base font-black sm:text-lg">مكالمات الطالب</h4>
                  <div className="max-h-80 space-y-2 overflow-y-auto pr-1">
                    {studentCallsForProfile.length === 0 ? <p className="empty-state py-8">لا توجد مكالمات لهذا الطالب</p> : studentCallsForProfile.map((call) => {
                      const exam = profileExams.find((item) => item.id === call.examId);
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

                <div className="rounded-2xl border bg-card/80 p-4 shadow-sm sm:rounded-3xl sm:p-5">
                  <h4 className="mb-4 text-base font-black sm:text-lg">إجازات الطالب</h4>
                  <div className="max-h-80 space-y-2 overflow-y-auto pr-1">
                    {studentLeavesForProfile.length === 0 ? <p className="empty-state py-8">لا توجد إجازات لهذا الطالب</p> : studentLeavesForProfile.map((leave) => {
                      const exam = profileExams.find((item) => item.id === leave.examId);
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

                <div className="rounded-2xl border bg-card/80 p-4 shadow-sm sm:rounded-3xl sm:p-5">
                  <h4 className="mb-4 text-base font-black sm:text-lg">تعهدات ولي الأمر</h4>
                  <div className="max-h-80 space-y-2 overflow-y-auto pr-1">
                    {allStudentNotes.filter((note) => note.kind === "تعهد ولي الأمر").length === 0 ? <p className="empty-state py-8">لا توجد تعهدات لهذا الطالب</p> : allStudentNotes.filter((note) => note.kind === "تعهد ولي الأمر").map((note) => (
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

                <div className="rounded-2xl border bg-card/80 p-4 shadow-sm sm:rounded-3xl sm:p-5">
                  <h4 className="mb-4 text-base font-black sm:text-lg">ملاحظات الطالب</h4>
                  <div className="max-h-80 space-y-2 overflow-y-auto pr-1">
                    {allStudentNotes.length === 0 ? <p className="empty-state py-8">لا توجد ملاحظات لهذا الطالب</p> : allStudentNotes.map((note) => (
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
                  {studentActions.length === 0 ? <p className="empty-state py-8">لا توجد إجراءات مسجلة لهذا الطالب</p> : studentActions.map((row) => (
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
                  <p className="empty-state py-10">لا توجد ملفات سابقة مؤرشفة لهذا الطالب</p>
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
                                  <p className="mt-1 break-words text-muted-foreground">{log.reason || "—"} — {formatAppDate(log.date)}</p>
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
                                  <p className="font-bold">{log.module || "النظام"} — {log.action || "إجراء"}</p>
                                  <p className="mt-1 break-words text-muted-foreground">{log.details || "—"} — {formatAppDate(log.time)}</p>
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
                {fullStudentLog.length === 0 ? <p className="empty-state py-8">لا يوجد لوغ لهذا الطالب</p> : fullStudentLog.map((row) => (
                  <div key={row.id} className="grid min-w-0 gap-2 rounded-2xl bg-muted/50 p-3 text-sm lg:grid-cols-[8rem_7rem_9rem_minmax(0,1fr)] lg:items-start">
                    <span className="font-bold text-muted-foreground">{formatAppDate(compactDate(row.date) || row.date)}</span>
                    <Badge className="w-fit" variant={logToneVariant(row.tone)}>{row.source}</Badge>
                    <span className="font-black">{row.title}</span>
                    <span className="min-w-0 break-words text-muted-foreground">{row.details}</span>
                  </div>
                ))}
              </div>
            </div>

            )}
          </div>
        </div>
      </div>
    </section>
  );

  return createPortal(profileContent, document.body);
}
