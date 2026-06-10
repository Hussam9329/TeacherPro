"use client";

import React, { useMemo, useState } from "react";
import { type Exam, type Grade, type OpportunityLog, type Student } from "@/lib/teacher-store";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

type StudentFileTab = "details" | "grades" | "exams" | "opportunities";

type StudentProfileDialogProps = {
  student: Student | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  exams: Exam[];
  grades: Grade[];
  opportunityLogs: OpportunityLog[];
  courseName: (courseId: string) => string;
  activeChapterForCourse: (courseId: string) => { name: string } | undefined;
  whatsappLink: (phone: string) => string;
  telegramLink: (telegram: string) => string;
  isStudentCurrentlyInGrace: (student: Student) => boolean;
  graceEndDate: (student: Student) => string;
};

function ContactLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a href={href} className="font-bold text-primary underline-offset-4 hover:underline">
      {children}
    </a>
  );
}

function InfoBox({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-3xl border bg-card/80 p-4 shadow-sm">
      <p className="text-xs font-bold text-muted-foreground">{label}</p>
      <div className="mt-1 text-sm font-black text-foreground">{value}</div>
    </div>
  );
}

function formatScore(grade: Grade, exam?: Exam) {
  if (grade.status !== "درجة") return grade.status;
  return grade.score !== null ? `${grade.score}/${exam?.fullMark || 100}` : "—";
}

export function StudentProfileDialog({
  student,
  open,
  onOpenChange,
  exams,
  grades,
  opportunityLogs,
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

  if (!student) return null;

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
    { id: "details", label: "التفاصيل والغيابات", value: absentCount, hint: "عدد الغيابات" },
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent dir="rtl" className="max-w-5xl max-h-[88vh] overflow-y-auto p-0">
        <div className="overflow-hidden">
          <DialogHeader className="border-b bg-gradient-to-l from-primary/15 via-purple-500/10 to-background p-6">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div className="space-y-2">
                <DialogTitle className="text-2xl font-black">ملف الطالب</DialogTitle>
                <DialogDescription className="text-sm leading-6">
                  ملف احترافي يجمع بيانات الطالب، الدرجات، الامتحانات، الفرص، والغيابات.
                </DialogDescription>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant={student.status === "نشط" ? "default" : "destructive"}>{student.status}</Badge>
                  <Badge variant="outline">{student.code}</Badge>
                  <Badge variant="secondary">{courseName(student.courseId)}</Badge>
                </div>
              </div>
              <div className="rounded-3xl border bg-card/90 p-4 shadow-sm lg:min-w-72">
                <p className="text-xs text-muted-foreground">اسم الطالب</p>
                <p className="text-xl font-black">{student.name}</p>
                <p className="mt-1 text-xs text-muted-foreground">{student.school || "بدون مدرسة"}</p>
              </div>
            </div>
          </DialogHeader>

          <div className="space-y-5 p-6">
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              {cards.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setTab(item.id)}
                  className={`rounded-3xl border p-4 text-right shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md ${
                    tab === item.id ? "border-primary/50 bg-primary/10 text-primary" : "bg-card/80 hover:border-primary/25"
                  }`}
                >
                  <p className="text-xs font-bold text-muted-foreground">{item.label}</p>
                  <p className="mt-2 text-2xl font-black">{item.value}</p>
                  <p className="mt-1 text-[11px] text-muted-foreground">{item.hint}</p>
                </button>
              ))}
            </div>

            {tab === "details" && (
              <div className="space-y-4">
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                  <InfoBox label="رقم الطالب" value={<ContactLink href={whatsappLink(student.phone)}>{student.phone}</ContactLink>} />
                  <InfoBox label="رقم ولي الأمر" value={<ContactLink href={whatsappLink(student.parentPhone)}>{student.parentPhone}</ContactLink>} />
                  <InfoBox label="التليكرام" value={student.telegram ? <ContactLink href={telegramLink(student.telegram)}>{student.telegram}</ContactLink> : "—"} />
                  <InfoBox label="نوع الدراسة" value={student.studyType || "—"} />
                </div>

                <div className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
                  <div className="rounded-3xl border bg-card/80 p-5 shadow-sm">
                    <h4 className="mb-4 text-lg font-black">المعلومات العامة</h4>
                    <div className="grid gap-3 text-sm md:grid-cols-2">
                      <InfoBox label="الجنس" value={student.gender} />
                      <InfoBox label="نوع الدورة" value={student.courseProgram || "—"} />
                      <InfoBox label="الكورس" value={student.courseTerm || "—"} />
                      <InfoBox label="الموقع الكامل" value={`${student.locationScope || student.mainSite || "-"} - ${student.subSite || "-"}`} />
                      <InfoBox label="الفصل النشط" value={activeChapter?.name || "لم يتم اختيار الفصل لهم بعد"} />
                      <InfoBox label="تاريخ التسجيل" value={student.createdAt} />
                    </div>
                  </div>

                  <div className="rounded-3xl border bg-card/80 p-5 shadow-sm">
                    <h4 className="mb-4 text-lg font-black">ملخص الأداء</h4>
                    <div className="grid grid-cols-2 gap-3 text-center">
                      <div className="rounded-2xl bg-emerald-500/10 p-3"><p className="text-2xl font-black text-emerald-600">{successCount}</p><p className="text-xs text-muted-foreground">ناجح</p></div>
                      <div className="rounded-2xl bg-red-500/10 p-3"><p className="text-2xl font-black text-red-600">{failedCount}</p><p className="text-xs text-muted-foreground">راسب</p></div>
                      <div className="rounded-2xl bg-amber-500/10 p-3"><p className="text-2xl font-black text-amber-600">{absentCount}</p><p className="text-xs text-muted-foreground">غياب</p></div>
                      <div className="rounded-2xl bg-primary/10 p-3"><p className="text-2xl font-black text-primary">{opportunityText}</p><p className="text-xs text-muted-foreground">فرص</p></div>
                    </div>
                    <div className="mt-4 rounded-2xl border p-3 text-xs leading-6 text-muted-foreground">
                      {isStudentCurrentlyInGrace(student)
                        ? `الطالب ضمن فترة السماح. تنتهي في ${graceEndDate(student)}.`
                        : `المحاسبة فعالة. فترة السماح: ${student.accountingGraceDays ?? 0} يوم.`}
                    </div>
                  </div>
                </div>

                {student.status === "مفصول" && (
                  <div className="rounded-3xl border border-destructive/30 bg-destructive/5 p-4 text-sm">
                    <p className="font-black text-destructive">بيانات الفصل</p>
                    <p className="mt-2">{student.dismissalType || "—"} - {student.dismissalReason || "—"}</p>
                    {student.dismissalNotes && <p className="mt-1 text-muted-foreground">{student.dismissalNotes}</p>}
                  </div>
                )}
              </div>
            )}

            {tab === "grades" && (
              <div className="rounded-3xl border bg-card/80 p-5 shadow-sm">
                <h4 className="mb-4 text-lg font-black">درجات الطالب</h4>
                <div className="space-y-2">
                  {studentGrades.length === 0 ? <p className="empty-state py-8">لا توجد درجات لهذا الطالب</p> : studentGrades.map((grade) => {
                    const exam = exams.find((item) => item.id === grade.examId);
                    return (
                      <div key={grade.id} className="grid gap-2 rounded-2xl bg-muted/55 p-3 text-sm md:grid-cols-[1fr_auto_auto] md:items-center">
                        <div><b>{exam?.name || "امتحان محذوف"}</b><p className="text-xs text-muted-foreground">{exam?.date || "—"}</p></div>
                        <Badge variant={grade.status === "درجة" ? "default" : grade.status === "غائب" ? "destructive" : "secondary"}>{grade.status}</Badge>
                        <span className="font-black">{formatScore(grade, exam)}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {tab === "exams" && (
              <div className="rounded-3xl border bg-card/80 p-5 shadow-sm">
                <h4 className="mb-4 text-lg font-black">امتحانات الطالب</h4>
                <div className="grid gap-3 md:grid-cols-2">
                  {studentGrades.length === 0 ? <p className="empty-state py-8 md:col-span-2">لا توجد امتحانات مسجلة لهذا الطالب</p> : studentGrades.map((grade) => {
                    const exam = exams.find((item) => item.id === grade.examId);
                    if (!exam) return null;
                    return (
                      <div key={grade.id} className="rounded-2xl border bg-background/60 p-4">
                        <div className="flex items-start justify-between gap-3"><div><p className="font-black">{exam.name}</p><p className="text-xs text-muted-foreground">{exam.type} - {exam.date}</p></div><Badge>{grade.status}</Badge></div>
                        <div className="mt-3 grid grid-cols-3 gap-2 text-center text-xs"><div className="rounded-xl bg-muted/60 p-2"><b>{exam.fullMark}</b><p>الكاملة</p></div><div className="rounded-xl bg-muted/60 p-2"><b>{exam.passMark}</b><p>النجاح</p></div><div className="rounded-xl bg-muted/60 p-2"><b>{grade.score ?? "—"}</b><p>درجة الطالب</p></div></div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {tab === "opportunities" && (
              <div className="rounded-3xl border bg-card/80 p-5 shadow-sm">
                <h4 className="mb-4 text-lg font-black">سجل الفرص</h4>
                <div className="mb-4 grid gap-3 md:grid-cols-3"><div className="rounded-2xl bg-primary/10 p-3 text-center"><p className="text-2xl font-black text-primary">{opportunityText}</p><p className="text-xs text-muted-foreground">الفرص الحالية</p></div><div className="rounded-2xl bg-red-500/10 p-3 text-center"><p className="text-2xl font-black text-red-600">{deductedCount}</p><p className="text-xs text-muted-foreground">حركات خصم</p></div><div className="rounded-2xl bg-emerald-500/10 p-3 text-center"><p className="text-2xl font-black text-emerald-600">{addedCount}</p><p className="text-xs text-muted-foreground">حركات إضافة/تعديل</p></div></div>
                <div className="space-y-2 max-h-72 overflow-y-auto">
                  {studentOpportunities.length === 0 ? <p className="empty-state py-8">لا توجد حركات فرص</p> : studentOpportunities.map((row) => (
                    <div key={row.id} className="grid gap-2 rounded-2xl bg-muted/55 p-3 text-sm md:grid-cols-[auto_auto_1fr] md:items-center"><span>{row.date}</span><Badge variant={row.action === "خصم" ? "destructive" : "default"}>{row.action} {row.amount}</Badge><span className="text-muted-foreground">{row.reason}</span></div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
