"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
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
import { ArrowRightIcon } from "lucide-react";

type StudentFileTab = "details" | "grades" | "exams" | "opportunities" | "actions";

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
  const status = call.completed ? "تم الاتصال" : "لم يتم الاتصال";
  return `${exam?.name || "كل الامتحانات / امتحان محذوف"} - ${status} - الجهة: ${call.target || "—"}${call.phone ? ` - الهاتف: ${call.phone}` : ""}${call.notes ? ` - ملاحظات: ${call.notes}` : ""}`;
}

function systemLogMatchesStudent(log: LogEntry, student: Student) {
  const haystack = `${log.details || ""} ${log.action || ""}`.toLowerCase();
  const candidates = [student.id, student.code, student.name, student.phone, student.parentPhone]
    .map((value) => String(value || "").trim().toLowerCase())
    .filter((value) => value.length >= 3);
  return candidates.some((value) => haystack.includes(value));
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
  const [tab, setTab] = useState<StudentFileTab>("details");
  const contentScrollRef = useRef<HTMLDivElement | null>(null);

  const studentGrades = useMemo(
    () => (student ? grades.filter((grade) => grade.studentId === student.id) : []),
    [grades, student],
  );

  const studentOpportunities = useMemo(
    () => (student ? opportunityLogs.filter((log) => log.studentId === student.id) : []),
    [opportunityLogs, student],
  );

  const studentLeavesForProfile = useMemo(
    () => (student ? studentLeaves.filter((leave) => leave.studentId === student.id) : []),
    [studentLeaves, student],
  );

  const studentCallsForProfile = useMemo(
    () => (student ? studentCalls.filter((call) => call.studentId === student.id) : []),
    [studentCalls, student],
  );

  const allStudentNotes = useMemo(
    () => (student ? studentNotes.filter((note) => note.studentId === student.id) : []),
    [studentNotes, student],
  );

  const studentActionNotes = useMemo(
    () => allStudentNotes.filter((note) => note.kind === "إجراء"),
    [allStudentNotes],
  );

  const studentActions = useMemo<StudentActionRow[]>(() => {
    if (!student) return [];
    const noteRows = studentActionNotes.map((note) => ({
      id: `note-${note.id}`,
      date: note.date,
      title: note.kind || "إجراء",
      details: note.text,
      tone: note.text.includes("فصل") ? "danger" as const : note.text.includes("إعادة تفعيل") ? "success" as const : "secondary" as const,
    }));
    const opportunityRows = studentOpportunities.map((log) => ({
      id: `opp-${log.id}`,
      date: log.date,
      title: `${log.action}${log.amount ? ` ${log.amount}` : ""}`,
      details: log.reason || "—",
      tone: opportunityActionTone(log.action),
    }));
    return [...noteRows, ...opportunityRows].sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));
  }, [student, studentActionNotes, studentOpportunities]);

  const fullStudentLog = useMemo<StudentLogRow[]>(() => {
    if (!student) return [];
    const examById = new Map(exams.map((exam) => [exam.id, exam]));
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
        title: grade.status === "درجة" ? "درجة محفوظة" : grade.status,
        details: gradeLogDetails(grade, examById.get(grade.examId)),
        tone: grade.status === "درجة" ? "default" as const : grade.status === "غائب" ? "danger" as const : "secondary" as const,
      })),
      ...studentOpportunities.map((log) => ({
        id: `opp-${log.id}`,
        date: log.date,
        source: "الفرص",
        title: `${log.action}${log.amount ? ` ${log.amount}` : ""}`,
        details: log.reason || "—",
        tone: opportunityActionTone(log.action),
      })),
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
        title: call.completed ? "مكالمة مكتملة" : "مكالمة مسجلة",
        details: callLogDetails(call, examById.get(call.examId)),
        tone: call.completed ? "success" as const : "secondary" as const,
      })),
      ...allStudentNotes.map((note) => ({
        id: `note-${note.id}`,
        date: note.date,
        source: "الملاحظات",
        title: note.kind || "ملاحظة",
        details: note.text,
        tone: note.kind === "إجراء" ? "secondary" as const : "info" as const,
      })),
      ...logs.filter((log) => systemLogMatchesStudent(log, student)).map((log) => ({
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
  }, [student, exams, studentGrades, studentOpportunities, studentLeavesForProfile, studentCallsForProfile, allStudentNotes, logs, courseName]);

  useEffect(() => {
    if (!open) return;
    contentScrollRef.current?.scrollTo({ top: 0, behavior: "auto" });
  }, [open, student?.id, tab]);

  useEffect(() => {
    if (!open) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onOpenChange(false);
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, onOpenChange]);

  if (!open || !student) return null;

  const activeChapter = activeChapterForCourse(student.courseId);
  const examCount = new Set(studentGrades.map((grade) => grade.examId)).size;
  const absentCount = studentGrades.filter((grade) => grade.status === "غائب").length;
  const successCount = studentGrades.filter((grade) => {
    const exam = exams.find((item) => item.id === grade.examId);
    return grade.status === "درجة" && grade.score !== null && exam && Number(grade.score) >= Number(exam.passMark);
  }).length;
  const failedCount = studentGrades.filter((grade) => {
    const exam = exams.find((item) => item.id === grade.examId);
    return grade.status === "درجة" && grade.score !== null && exam && Number(grade.score) < Number(exam.passMark);
  }).length;
  const opportunityText = activeChapter ? `${student.opportunities}/${student.baseOpportunities}` : "0/0";
  const deductedCount = studentOpportunities.filter((log) => log.action === "خصم" || log.action === "خصم تلقائي").length;
  const addedCount = studentOpportunities.filter((log) => log.action !== "خصم" && log.action !== "خصم تلقائي").length;

  const cards: { id: StudentFileTab; label: string; value: string | number; hint: string }[] = [
    { id: "grades", label: "الدرجات", value: studentGrades.length, hint: "عرض درجات الطالب" },
    { id: "exams", label: "الامتحانات", value: examCount, hint: "عدد الامتحانات" },
    { id: "opportunities", label: "الفرص", value: opportunityText, hint: "المتبقي / الأساسي" },
    { id: "actions", label: "الإجراءات", value: studentActions.length, hint: "حذف/فصل/إعادة تفعيل" },
    { id: "details", label: "التفاصيل والغيابات", value: absentCount, hint: "عدد الغيابات" },
  ];

  return (
    <section
      dir="rtl"
      className="fixed inset-0 z-[80] flex h-dvh w-full flex-col overflow-hidden bg-background text-foreground"
      aria-labelledby="student-profile-title"
    >
      <div className="flex h-full min-h-0 w-full flex-1 flex-col overflow-hidden bg-background">
        <div className="sticky top-0 z-30 shrink-0 border-b bg-background/95 p-4 text-right shadow-sm backdrop-blur supports-[backdrop-filter]:bg-background/80 sm:p-6">
          <div className="flex min-w-0 flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="min-w-0 space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant={student.status === "نشط" ? "default" : "destructive"}>{student.status}</Badge>
                <Badge variant="outline">{student.code}</Badge>
                <Badge variant="secondary" className="max-w-full truncate">{courseName(student.courseId)}</Badge>
                <Badge variant="outline">فرص: {opportunityText}</Badge>
              </div>
              <h2 id="student-profile-title" className="break-words text-2xl font-black sm:text-3xl">{student.name}</h2>
              <p className="break-words text-xs leading-6 text-muted-foreground sm:text-sm">
                {student.school || "بدون مدرسة"} - شاشة ملف الطالب
              </p>
              <button
                type="button"
                onClick={() => onOpenChange(false)}
                className="inline-flex w-fit min-h-10 items-center gap-2 rounded-2xl border border-red-200 bg-red-50 px-4 py-2 text-sm font-black text-red-700 shadow-sm transition hover:bg-red-100 focus:outline-none focus:ring-2 focus:ring-red-300 dark:border-red-900/40 dark:bg-red-950/30 dark:text-red-300 dark:hover:bg-red-950/50"
                aria-label="الرجوع من ملف الطالب"
              >
                <ArrowRightIcon className="size-4" />
                رجوع
              </button>
            </div>
          </div>
        </div>

        <div ref={contentScrollRef} className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4 sm:p-5 lg:p-6 [scrollbar-gutter:stable]">
          <div className="space-y-4 sm:space-y-5">
            <div className="grid grid-cols-2 gap-2 sm:gap-3 lg:grid-cols-5">
              {cards.map((item) => (
                <button
                  key={item.id}
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
                  <InfoBox label="التليكرام" value={student.telegram ? <ContactLink href={telegramLink(student.telegram)}>{student.telegram}</ContactLink> : "—"} />
                  <InfoBox label="نوع الدراسة" value={student.studyType || "—"} />
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
                      <InfoBox label="تاريخ التسجيل" value={formatAppDate(student.createdAt)} />
                    </div>
                  </div>

                  <div className="min-w-0 rounded-2xl border bg-card/80 p-4 shadow-sm sm:rounded-3xl sm:p-5">
                    <h4 className="mb-3 text-base font-black sm:mb-4 sm:text-lg">ملخص الأداء</h4>
                    <div className="grid grid-cols-2 gap-2 text-center sm:gap-3">
                      <div className="rounded-2xl bg-emerald-500/10 p-3"><p className="text-xl font-black text-emerald-600 sm:text-2xl">{successCount}</p><p className="text-[11px] text-muted-foreground sm:text-xs">ناجح</p></div>
                      <div className="rounded-2xl bg-red-500/10 p-3"><p className="text-xl font-black text-red-600 sm:text-2xl">{failedCount}</p><p className="text-[11px] text-muted-foreground sm:text-xs">راسب</p></div>
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
                  {studentGrades.length === 0 ? <p className="empty-state py-8">لا توجد درجات لهذا الطالب</p> : studentGrades.map((grade) => {
                    const exam = exams.find((item) => item.id === grade.examId);
                    return (
                      <div key={grade.id} className="grid min-w-0 gap-2 rounded-2xl bg-muted/55 p-3 text-sm md:grid-cols-[minmax(0,1fr)_auto_auto] md:items-center">
                        <div className="min-w-0"><b className="break-words">{exam?.name || "امتحان محذوف"}</b><p className="text-xs text-muted-foreground">{formatAppDate(exam?.date)}</p></div>
                        <Badge className="w-fit" variant={grade.status === "درجة" ? "default" : grade.status === "غائب" ? "destructive" : "secondary"}>{grade.status}</Badge>
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
                  {studentGrades.length === 0 ? <p className="empty-state py-8 lg:col-span-2">لا توجد امتحانات مسجلة لهذا الطالب</p> : studentGrades.map((grade) => {
                    const exam = exams.find((item) => item.id === grade.examId);
                    if (!exam) return null;
                    return (
                      <div key={grade.id} className="min-w-0 rounded-2xl border bg-background/60 p-4">
                        <div className="flex min-w-0 items-start justify-between gap-3"><div className="min-w-0"><p className="break-words font-black">{exam.name}</p><p className="text-xs text-muted-foreground">{exam.type} - {formatAppDate(exam.date)}</p></div><Badge>{grade.status}</Badge></div>
                        <div className="mt-3 grid grid-cols-3 gap-2 text-center text-xs"><div className="rounded-xl bg-muted/60 p-2"><b>{exam.fullMark}</b><p>الكاملة</p></div><div className="rounded-xl bg-muted/60 p-2"><b>{exam.passMark}</b><p>النجاح</p></div><div className="rounded-xl bg-muted/60 p-2"><b>{formatGradeScore(grade, exam, "—")}</b><p>درجة الطالب</p></div></div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {tab === "opportunities" && (
              <div className="rounded-2xl border bg-card/80 p-4 shadow-sm sm:rounded-3xl sm:p-5">
                <h4 className="mb-4 text-base font-black sm:text-lg">سجل الفرص</h4>
                <div className="mb-4 grid gap-2 sm:grid-cols-3 sm:gap-3"><div className="rounded-2xl bg-primary/10 p-3 text-center"><p className="text-xl font-black text-primary sm:text-2xl">{opportunityText}</p><p className="text-xs text-muted-foreground">الفرص الحالية</p></div><div className="rounded-2xl bg-red-500/10 p-3 text-center"><p className="text-xl font-black text-red-600 sm:text-2xl">{deductedCount}</p><p className="text-xs text-muted-foreground">حركات خصم</p></div><div className="rounded-2xl bg-emerald-500/10 p-3 text-center"><p className="text-xl font-black text-emerald-600 sm:text-2xl">{addedCount}</p><p className="text-xs text-muted-foreground">حركات إضافة/تعديل</p></div></div>
                <div className="max-h-72 space-y-2 overflow-y-auto pr-1">
                  {studentOpportunities.length === 0 ? <p className="empty-state py-8">لا توجد حركات فرص</p> : studentOpportunities.map((row) => (
                    <div key={row.id} className="grid min-w-0 gap-2 rounded-2xl bg-muted/55 p-3 text-sm md:grid-cols-[auto_auto_minmax(0,1fr)] md:items-center"><span>{formatAppDate(row.date)}</span><Badge className="w-fit" variant={row.action === "خصم" || row.action === "خصم تلقائي" ? "destructive" : "default"}>{row.action} {row.amount}</Badge><span className="break-words text-muted-foreground">{row.reason}</span></div>
                  ))}
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
          </div>
        </div>
      </div>
    </section>
  );
}
