"use client";

import React, { useEffect, useMemo, useState } from "react";
import { type Exam, type Grade, type OpportunityLog, type Student, type StudentNote } from "@/lib/teacher-store";
import { Badge } from "@/components/ui/badge";
import { formatAppDate } from "@/lib/format";
import { formatGradeScore } from "@/lib/exam-utils";
import { XIcon } from "lucide-react";

type StudentFileTab = "details" | "grades" | "exams" | "opportunities" | "actions";

type StudentProfileDialogProps = {
  student: Student | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  exams: Exam[];
  grades: Grade[];
  opportunityLogs: OpportunityLog[];
  studentNotes: StudentNote[];
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

type StudentActionRow = {
  id: string;
  date: string;
  title: string;
  details: string;
  tone: "default" | "danger" | "success" | "secondary";
};

function opportunityActionTone(action: string): StudentActionRow["tone"] {
  if (action.includes("فصل") || action === "خصم") return "danger";
  if (action.includes("إعادة تفعيل") || action.includes("فرصة")) return "success";
  return "default";
}

export function StudentProfileDialog({
  student,
  open,
  onOpenChange,
  exams,
  grades,
  opportunityLogs,
  studentNotes,
  courseName,
  activeChapterForCourse,
  whatsappLink,
  telegramLink,
  isStudentCurrentlyInGrace,
  graceEndDate,
}: StudentProfileDialogProps) {
  const [tab, setTab] = useState<StudentFileTab>("details");

  const studentGrades = useMemo(
    () => (student ? grades.filter((grade) => grade.studentId === student.id) : []),
    [grades, student],
  );

  const studentOpportunities = useMemo(
    () => (student ? opportunityLogs.filter((log) => log.studentId === student.id) : []),
    [opportunityLogs, student],
  );

  const studentActionNotes = useMemo(
    () => (student ? studentNotes.filter((note) => note.studentId === student.id && note.kind === "إجراء") : []),
    [studentNotes, student],
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

  useEffect(() => {
    if (!open) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onOpenChange(false);
    };

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
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
  const deductedCount = studentOpportunities.filter((log) => log.action === "خصم").length;
  const addedCount = studentOpportunities.filter((log) => log.action !== "خصم").length;

  const cards: { id: StudentFileTab; label: string; value: string | number; hint: string }[] = [
    { id: "grades", label: "الدرجات", value: studentGrades.length, hint: "عرض درجات الطالب" },
    { id: "exams", label: "الامتحانات", value: examCount, hint: "عدد الامتحانات" },
    { id: "opportunities", label: "الفرص", value: opportunityText, hint: "المتبقي / الأساسي" },
    { id: "actions", label: "الإجراءات", value: studentActions.length, hint: "حذف/فصل/إعادة تفعيل" },
    { id: "details", label: "التفاصيل والغيابات", value: absentCount, hint: "عدد الغيابات" },
  ];

  return (
    <div dir="rtl" className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-2 backdrop-blur-sm sm:p-4" role="dialog" aria-modal="true" aria-labelledby="student-profile-title">
      <div className="flex max-h-[92dvh] w-[calc(100vw-1rem)] max-w-[calc(100vw-1rem)] overflow-hidden rounded-2xl border bg-popover/95 text-popover-foreground shadow-2xl backdrop-blur-xl sm:w-[calc(100vw-2rem)] sm:max-w-[1180px] sm:rounded-3xl lg:max-h-[88vh]">
        <div className="flex min-h-0 w-full min-w-0 flex-col overflow-hidden rounded-2xl sm:rounded-3xl">
          <div className="relative shrink-0 border-b bg-gradient-to-l from-primary/15 via-purple-500/10 to-background p-4 text-right sm:p-6 sm:text-right">
            <button
              type="button"
              aria-label="إغلاق ملف الطالب"
              onClick={() => onOpenChange(false)}
              className="absolute left-4 top-4 rounded-full p-1 opacity-70 transition-opacity hover:bg-accent hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring"
            >
              <XIcon className="size-4" />
            </button>
            <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1fr)_20rem] xl:items-start">
              <div className="min-w-0 space-y-2">
                <h2 id="student-profile-title" className="text-xl font-black sm:text-2xl">ملف الطالب</h2>
                <p className="max-w-3xl text-xs leading-6 text-muted-foreground sm:text-sm">
                  {student.name}
                </p>
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <Badge variant={student.status === "نشط" ? "default" : "destructive"}>{student.status}</Badge>
                  <Badge variant="outline">{student.code}</Badge>
                  <Badge variant="secondary" className="max-w-full truncate">{courseName(student.courseId)}</Badge>
                </div>
              </div>
              <div className="min-w-0 rounded-2xl border bg-card/90 p-4 shadow-sm lg:rounded-3xl">
                <p className="text-xs text-muted-foreground">اسم الطالب</p>
                <p className="break-words text-lg font-black sm:text-xl">{student.name}</p>
                <p className="mt-1 break-words text-xs text-muted-foreground">{student.school || "بدون مدرسة"}</p>
              </div>
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-5 lg:p-6">
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

                  <div className="grid gap-4 xl:grid-cols-[minmax(0,1.1fr)_minmax(320px,0.9fr)]">
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
                  <div className="max-h-72 space-y-2 overflow-y-auto">
                    {studentOpportunities.length === 0 ? <p className="empty-state py-8">لا توجد حركات فرص</p> : studentOpportunities.map((row) => (
                      <div key={row.id} className="grid min-w-0 gap-2 rounded-2xl bg-muted/55 p-3 text-sm md:grid-cols-[auto_auto_minmax(0,1fr)] md:items-center"><span>{formatAppDate(row.date)}</span><Badge className="w-fit" variant={row.action === "خصم" ? "destructive" : "default"}>{row.action} {row.amount}</Badge><span className="break-words text-muted-foreground">{row.reason}</span></div>
                    ))}
                  </div>
                </div>
              )}

              {tab === "actions" && (
                <div className="rounded-2xl border bg-card/80 p-4 shadow-sm sm:rounded-3xl sm:p-5">
                  <h4 className="mb-4 text-base font-black sm:text-lg">إجراءات ملف الطالب</h4>
                  <div className="max-h-96 space-y-2 overflow-y-auto">
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
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
