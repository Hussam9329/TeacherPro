"use client";

import React, { useMemo, useState } from "react";
import {
  useTeacherStore,
  type Exam,
  type Grade,
  type Student,
} from "@/lib/teacher-store";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DateInput } from "@/components/ui/date-input";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { formatAppDate, sanitizePhoneInput } from "@/lib/format";
import { normalizeTelegramIdentifier } from "@/lib/student-utils";
import { searchAny } from "@/lib/validation";
import { StudentProfileDialog } from "./student-profile-dialog";
import {
  hasActiveChapterLink,
  isExamOnOrAfterStudentRegistration,
  isGradeEntered,
  splitSelection,
  studentMatchesExamMainSites,
} from "@/lib/exam-utils";

type FollowTab = "leaves" | "calls" | "grade-lists";
type CallCategory = "absent" | "failed" | "low-pass" | "full" | "not-entered";
type ContactTarget = "الطالب" | "ولي الأمر";

type CallRow = {
  id: string;
  student: Student;
  exam: Exam;
  grade?: Grade;
  category: CallCategory;
  label: string;
  reason: string;
};

const tabLabels: Record<FollowTab, string> = {
  leaves: "الإجازات",
  calls: "المكالمات",
  "grade-lists": "قوائم الدرجات",
};

const leaveReasonOptions = ["حالة مرضية", "سفر", "حالة وفاة", "ظروف قاهرة", "أخرى"] as const;
type LeaveReasonOption = typeof leaveReasonOptions[number];
type LeaveMode = "exam" | "period";

const callCategoryLabels: Record<CallCategory, string> = {
  absent: "الغائبون",
  failed: "الراسبون",
  "low-pass": "ناجح بدرجة منخفضة",
  full: "درجة كاملة",
  "not-entered": "غير ممتحنين",
};

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function phoneForWhatsApp(phone?: string) {
  const digits = String(phone || "").replace(/\D/g, "");
  if (!digits) return "";
  if (digits.startsWith("964")) return digits;
  if (digits.startsWith("0")) return `964${digits.slice(1)}`;
  return digits;
}

function whatsappLink(phone: string): string {
  const digits = phoneForWhatsApp(sanitizePhoneInput(phone));
  return digits ? `https://wa.me/${digits}` : "#";
}

function telegramLink(telegram: string): string {
  const username = normalizeTelegramIdentifier(telegram).replace(/^@+/, "");
  return username ? `https://t.me/${encodeURIComponent(username)}` : "#";
}

function graceEndDate(student: Student): string {
  const start = new Date(`${String(student.createdAt || "").slice(0, 10)}T00:00:00`);
  const days = Number(student.accountingGraceDays || 0);
  if (!Number.isFinite(start.getTime()) || days <= 0) return formatAppDate(student.createdAt, String(student.createdAt || "").slice(0, 10) || "-");
  const end = new Date(start);
  end.setDate(end.getDate() + days - 1);
  return formatAppDate(end);
}

function isStudentCurrentlyInGrace(student: Student): boolean {
  const days = Number(student.accountingGraceDays || 0);
  if (days <= 0) return false;
  const start = new Date(`${String(student.createdAt || "").slice(0, 10)}T00:00:00`);
  const today = new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00`);
  const endExclusive = new Date(start);
  endExclusive.setDate(endExclusive.getDate() + days);
  return Number.isFinite(start.getTime()) && today >= start && today < endExclusive;
}

function dayKey(value: string | null | undefined): string {
  return String(value || "").slice(0, 10);
}

export function FollowUpView() {
  const {
    students,
    exams,
    grades,
    courseChapters,
    studentLeaves,
    studentCalls,
    studentNotes,
    opportunityLogs,
    addStudentLeave,
    deleteStudentLeave,
    addStudentCall,
    updateStudentCall,
    courseName,
    activeChapterForCourse,
  } = useTeacherStore();

  const [tab, setTab] = useState<FollowTab>("leaves");
  const [globalSearch, setGlobalSearch] = useState("");
  const [leaveStudentId, setLeaveStudentId] = useState("");
  const [leaveMode, setLeaveMode] = useState<LeaveMode>("exam");
  const [leaveExamId, setLeaveExamId] = useState("");
  const [leaveReasonChoice, setLeaveReasonChoice] = useState<LeaveReasonOption>("حالة مرضية");
  const [customLeaveReason, setCustomLeaveReason] = useState("");
  const [leaveDate, setLeaveDate] = useState(todayISO());
  const [leaveDateFrom, setLeaveDateFrom] = useState(todayISO());
  const [leaveDateTo, setLeaveDateTo] = useState(todayISO());
  const [leaveNotes, setLeaveNotes] = useState("");

  const [callExamId, setCallExamId] = useState("");
  const [callCategory, setCallCategory] = useState<CallCategory | "all">("absent");
  const [callSearch, setCallSearch] = useState("");

  const [profileStudentId, setProfileStudentId] = useState("");
  const [profileDialogOpen, setProfileDialogOpen] = useState(false);

  const [gradeListExamId, setGradeListExamId] = useState("");
  const [gradeListCategory, setGradeListCategory] = useState<CallCategory>("absent");

  const filteredStudents = useMemo(() => {
    const query = globalSearch;
    return students
      .filter((student) => !query || searchAny(query, [student.name, student.code, student.phone, student.parentPhone, student.telegram, student.school, student.subSite, student.studyType]))
      .slice(0, 20);
  }, [students, globalSearch]);

  const selectedLeaveStudent = students.find((student) => student.id === leaveStudentId);
  const selectedProfileStudent = students.find((student) => student.id === profileStudentId) || null;
  const leaveReason = leaveReasonChoice === "أخرى" ? customLeaveReason.trim() : leaveReasonChoice;

  const leaveAppliesToExam = (leave: { studentId: string; examId?: string; leaveType?: string; date?: string; dateFrom?: string; dateTo?: string }, studentId: string, exam: Exam) => {
    if (leave.studentId !== studentId) return false;
    if ((leave.leaveType || "exam") === "period") {
      const examDate = dayKey(exam.date);
      const from = dayKey(leave.dateFrom || leave.date);
      const to = dayKey(leave.dateTo || leave.dateFrom || leave.date);
      return Boolean(examDate && from && to && examDate >= from && examDate <= to);
    }
    return leave.examId === exam.id;
  };

  const studentHasLeaveForExam = (studentId: string, examId: string) => {
    const exam = exams.find((item) => item.id === examId);
    return Boolean(exam && studentLeaves.some((leave) => leaveAppliesToExam(leave, studentId, exam)));
  };

  const eligibleStudentsForExam = (exam: Exam) => {
    const selectedMainSites = splitSelection(exam.mainSite);
    return students.filter((student) => {
      if (!exam.courseIds.includes(student.courseId)) return false;
      if (!isExamOnOrAfterStudentRegistration(student, exam)) return false;
      if (!hasActiveChapterLink(courseChapters, student.courseId)) return false;
      if (!studentMatchesExamMainSites(student, selectedMainSites)) return false;
      return true;
    });
  };

  const getGrade = (studentId: string, examId: string) => grades.find((grade) => grade.studentId === studentId && grade.examId === examId);

  const buildCallRowsForExam = (exam: Exam): CallRow[] => {
    return eligibleStudentsForExam(exam).flatMap<CallRow>((student) => {
      if (studentHasLeaveForExam(student.id, exam.id)) return [];
      const grade = getGrade(student.id, exam.id);
      const entered = isGradeEntered(grade, exam);
      if (!entered) {
        return [{ id: `${exam.id}:${student.id}:not-entered`, student, exam, grade, category: "not-entered", label: callCategoryLabels["not-entered"], reason: "لا توجد درجة مسجلة لهذا الطالب" }];
      }
      if (!grade) return [];
      if (grade.status === "غائب") {
        return [{ id: `${exam.id}:${student.id}:absent`, student, exam, grade, category: "absent", label: callCategoryLabels.absent, reason: "غائب عن الامتحان" }];
      }
      if (grade.status === "غش") return [];
      if (grade.status === "درجة" && grade.score !== null) {
        const score = Number(grade.score);
        if (score < exam.passMark) {
          return [{ id: `${exam.id}:${student.id}:failed`, student, exam, grade, category: "failed", label: callCategoryLabels.failed, reason: `راسب: ${score}/${exam.fullMark}` }];
        }
        if (score === exam.fullMark) {
          return [{ id: `${exam.id}:${student.id}:full`, student, exam, grade, category: "full", label: callCategoryLabels.full, reason: "حاصل على الدرجة الكاملة" }];
        }
        if (score >= exam.passMark && score <= Math.round(exam.fullMark * 0.7)) {
          return [{ id: `${exam.id}:${student.id}:low-pass`, student, exam, grade, category: "low-pass", label: callCategoryLabels["low-pass"], reason: `ناجح بدرجة منخفضة: ${score}/${exam.fullMark}` }];
        }
      }
      return [];
    });
  };

  const callRows = useMemo(() => {
    const sourceExams = callExamId ? exams.filter((exam) => exam.id === callExamId) : exams;
    return sourceExams
      .flatMap(buildCallRowsForExam)
      .filter((row) => callCategory === "all" || row.category === callCategory)
      .filter((row) => !callSearch || searchAny(callSearch, [row.student.name, row.student.code, row.student.phone, row.student.parentPhone, row.exam.name, row.reason]))
      .sort((a, b) => `${b.exam.date}-${a.student.name}`.localeCompare(`${a.exam.date}-${b.student.name}`, "ar"));
  }, [exams, students, grades, courseChapters, callExamId, callCategory, callSearch, studentLeaves]);

  const gradeListRows = useMemo(() => {
    const exam = exams.find((item) => item.id === gradeListExamId) || exams[0];
    if (!exam) return [];
    return buildCallRowsForExam(exam).filter((row) => row.category === gradeListCategory);
  }, [exams, students, grades, courseChapters, gradeListExamId, gradeListCategory, studentLeaves]);

  const saveLeave = () => {
    if (!leaveStudentId || !leaveReason.trim()) {
      toast.error("اختر الطالب وسبب الإجازة");
      return;
    }
    if (leaveMode === "exam" && !leaveExamId) {
      toast.error("اختر الامتحان المطلوب للإجازة");
      return;
    }
    if (leaveMode === "period" && (!leaveDateFrom || !leaveDateTo)) {
      toast.error("حدد بداية ونهاية فترة الإجازة");
      return;
    }
    const from = leaveDateFrom <= leaveDateTo ? leaveDateFrom : leaveDateTo;
    const to = leaveDateFrom <= leaveDateTo ? leaveDateTo : leaveDateFrom;
    const duplicate = studentLeaves.some((leave) => {
      if (leave.studentId !== leaveStudentId) return false;
      if (leaveMode === "exam") return (leave.leaveType || "exam") === "exam" && leave.examId === leaveExamId;
      return (leave.leaveType || "exam") === "period" && dayKey(leave.dateFrom || leave.date) === from && dayKey(leave.dateTo || leave.dateFrom || leave.date) === to;
    });
    if (duplicate) {
      toast.error("هذا الطالب لديه إجازة مسجلة بنفس النطاق");
      return;
    }
    const student = students.find((item) => item.id === leaveStudentId);
    addStudentLeave({
      studentId: leaveStudentId,
      examId: leaveMode === "exam" ? leaveExamId : "",
      leaveType: leaveMode,
      reason: leaveReason,
      studyType: student?.studyType || "",
      date: leaveMode === "exam" ? (leaveDate || todayISO()) : from,
      dateFrom: leaveMode === "exam" ? (leaveDate || todayISO()) : from,
      dateTo: leaveMode === "exam" ? (leaveDate || todayISO()) : to,
      notes: leaveNotes.trim(),
    });
    setCustomLeaveReason("");
    setLeaveReasonChoice("حالة مرضية");
    setLeaveNotes("");
    toast.success(leaveMode === "period" ? "تمت إضافة الإجازة للفترة وإلغاء محاسبة امتحاناتها" : "تمت إضافة الإجازة وإعادة احتساب الطالب بدون محاسبة هذا الامتحان");
  };

  const callLogForRow = (row: CallRow) => studentCalls.find((call) => call.studentId === row.student.id && call.examId === row.exam.id && call.category === row.category);

  const saveCallState = (row: CallRow, completed: boolean, target: ContactTarget) => {
    const existing = callLogForRow(row);
    const phone = target === "ولي الأمر" ? row.student.parentPhone : row.student.phone;
    const payload = {
      studentId: row.student.id,
      examId: row.exam.id,
      category: row.category,
      target,
      phone: phone || "",
      completed,
      completedAt: completed ? todayISO() : "",
      notes: row.reason,
    };
    if (existing) updateStudentCall(existing.id, payload);
    else addStudentCall(payload);
  };

  const openProfile = (studentId: string) => {
    setProfileStudentId(studentId);
    setProfileDialogOpen(true);
  };

  const studentExamCount = (student: Student) => exams.filter((exam) => {
    const selectedMainSites = splitSelection(exam.mainSite);
    return (
      exam.courseIds.includes(student.courseId) &&
      isExamOnOrAfterStudentRegistration(student, exam) &&
      hasActiveChapterLink(courseChapters, student.courseId) &&
      studentMatchesExamMainSites(student, selectedMainSites)
    );
  }).length;

  const renderStudentPicker = () => {
    return (
      <div className="space-y-2">
        <Label>البحث العام عن الطالب</Label>
        <Input value={globalSearch} onChange={(event) => setGlobalSearch(event.target.value)} placeholder="اسم / كود / هاتف / مدرسة" />
        <div className="max-h-44 space-y-1 overflow-y-auto rounded-2xl border bg-muted/30 p-2">
          {filteredStudents.map((student) => (
            <button
              key={student.id}
              type="button"
              onClick={() => setLeaveStudentId(student.id)}
              className={`flex w-full items-center justify-between rounded-xl px-3 py-2 text-right text-sm transition ${leaveStudentId === student.id ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}
            >
              <span>{student.name}</span>
              <span className="text-xs opacity-80">{student.code}</span>
            </button>
          ))}
        </div>
        {selectedLeaveStudent && (
          <div className="flex flex-wrap items-center gap-2 rounded-2xl border bg-card/80 p-2">
            <Button type="button" size="sm" variant="outline" onClick={() => openProfile(selectedLeaveStudent.id)}>ملف الطالب</Button>
            <Badge variant="secondary">عدد فروض الطالب: {studentExamCount(selectedLeaveStudent)}</Badge>
          </div>
        )}
      </div>
    );
  };

  const renderLeaveList = () => (
    <Card>
      <CardHeader><CardTitle>الإجازات السابقة</CardTitle></CardHeader>
      <CardContent className="space-y-2">
        {studentLeaves.length === 0 ? <p className="empty-state py-6">لا توجد إجازات مسجلة</p> : studentLeaves.map((leave) => {
          const student = students.find((item) => item.id === leave.studentId);
          const exam = exams.find((item) => item.id === leave.examId);
          const isPeriod = (leave.leaveType || "exam") === "period";
          return (
            <div key={leave.id} className="grid gap-2 rounded-2xl border bg-card/80 p-3 text-sm lg:grid-cols-[1.1fr_1fr_1.4fr_1fr_auto] lg:items-center">
              <b>{student?.name || "طالب محذوف"}</b>
              <span>{leave.reason}</span>
              <span>{isPeriod ? `فترة: ${formatAppDate(leave.dateFrom || leave.date)} إلى ${formatAppDate(leave.dateTo || leave.dateFrom || leave.date)}` : (exam?.name || "امتحان محذوف")}</span>
              <span>{leave.studyType || student?.studyType || "—"}</span>
              <div className="flex items-center justify-end gap-2">
                <Badge variant={isPeriod ? "secondary" : "outline"}>{isPeriod ? "فترة زمنية" : "حسب الامتحان"}</Badge>
                <Button variant="ghost" size="sm" onClick={() => deleteStudentLeave(leave.id)}>حذف</Button>
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );

  const renderCallRow = (row: CallRow) => {
    const call = callLogForRow(row);
    const target = (call?.target as ContactTarget) || "ولي الأمر";
    const phone = target === "ولي الأمر" ? row.student.parentPhone : row.student.phone;
    const whatsapp = phoneForWhatsApp(phone);
    return (
      <div key={row.id} className="grid gap-3 rounded-2xl border bg-card/80 p-3 text-sm xl:grid-cols-[1.2fr_1fr_1fr_170px_130px] xl:items-center">
        <div>
          <div className="flex flex-wrap items-center gap-2"><b>{row.student.name}</b><Badge variant="outline">{row.student.code}</Badge></div>
          <p className="text-xs text-muted-foreground">{courseName(row.student.courseId)} - {row.student.studyType || "—"}</p>
        </div>
        <div><b>{row.exam.name}</b><p className="text-xs text-muted-foreground">{formatAppDate(row.exam.date)}</p></div>
        <div><Badge>{row.label}</Badge><p className="mt-1 text-xs text-muted-foreground">{row.reason}</p></div>
        <Select value={target} onValueChange={(value) => saveCallState(row, Boolean(call?.completed), value as ContactTarget)}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="الطالب">الطالب</SelectItem><SelectItem value="ولي الأمر">ولي الأمر</SelectItem></SelectContent>
        </Select>
        <div className="flex flex-wrap items-center gap-2 justify-end">
          {whatsapp ? <a className="text-xs font-bold text-emerald-600 underline" href={`https://wa.me/${whatsapp}`} target="_blank" rel="noreferrer">واتساب</a> : <span className="text-xs text-muted-foreground">لا يوجد رقم</span>}
          <label className="flex items-center gap-1 text-xs">
            <input type="checkbox" checked={Boolean(call?.completed)} onChange={(event) => saveCallState(row, event.target.checked, target)} /> تمت
          </label>
          <Button variant="ghost" size="sm" onClick={() => openProfile(row.student.id)}>ملف الطالب</Button>
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader>
          <CardTitle>المتابعة</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2">
            {(Object.keys(tabLabels) as FollowTab[]).map((item) => (
              <Button key={item} variant={tab === item ? "default" : "outline"} onClick={() => setTab(item)}>{tabLabels[item]}</Button>
            ))}
          </div>
        </CardContent>
      </Card>

      {tab === "leaves" && (
        <div className="grid gap-4 xl:grid-cols-[420px_1fr]">
          <Card>
            <CardHeader><CardTitle>إضافة إجازة</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              {renderStudentPicker()}
              <div className="space-y-2"><Label>نوع الإجازة</Label><Select value={leaveMode} onValueChange={(value) => setLeaveMode(value as LeaveMode)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="exam">حسب الامتحان</SelectItem><SelectItem value="period">فترة زمنية</SelectItem></SelectContent></Select></div>
              {leaveMode === "exam" ? (
                <>
                  <div className="space-y-2"><Label>الامتحان</Label><Select value={leaveExamId} onValueChange={setLeaveExamId}><SelectTrigger><SelectValue placeholder="اختر الامتحان" /></SelectTrigger><SelectContent>{exams.map((exam) => <SelectItem key={exam.id} value={exam.id}>{exam.name} - {formatAppDate(exam.date)}</SelectItem>)}</SelectContent></Select></div>
                  <div className="space-y-2"><Label>تاريخ الإجازة</Label><DateInput value={leaveDate} onChange={setLeaveDate} /></div>
                </>
              ) : (
                <div className="grid gap-3 md:grid-cols-2">
                  <div className="space-y-2"><Label>من</Label><DateInput value={leaveDateFrom} onChange={setLeaveDateFrom} /></div>
                  <div className="space-y-2"><Label>إلى</Label><DateInput value={leaveDateTo} onChange={setLeaveDateTo} /></div>
                </div>
              )}
              <div className="space-y-2"><Label>سبب الإجازة</Label><Select value={leaveReasonChoice} onValueChange={(value) => setLeaveReasonChoice(value as LeaveReasonOption)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{leaveReasonOptions.map((reason) => <SelectItem key={reason} value={reason}>{reason}</SelectItem>)}</SelectContent></Select></div>
              {leaveReasonChoice === "أخرى" && <div className="space-y-2"><Label>السبب اليدوي</Label><Input value={customLeaveReason} onChange={(event) => setCustomLeaveReason(event.target.value)} placeholder="اكتب سبب الإجازة" /></div>}
              <div className="space-y-2"><Label>ملاحظات</Label><Input value={leaveNotes} onChange={(event) => setLeaveNotes(event.target.value)} placeholder="اختياري" /></div>
              {selectedLeaveStudent && <p className="rounded-xl bg-muted/50 p-2 text-xs text-muted-foreground">نوع الدراسة: <b>{selectedLeaveStudent.studyType || "—"}</b></p>}
              <Button className="w-full" onClick={saveLeave}>حفظ الإجازة</Button>
            </CardContent>
          </Card>
          {renderLeaveList()}
        </div>
      )}

      {tab === "calls" && (
        <div className="space-y-4">
          <Card><CardContent className="grid gap-3 p-4 md:grid-cols-3"><div className="space-y-2"><Label>الامتحان</Label><Select value={callExamId || "all"} onValueChange={(value) => setCallExamId(value === "all" ? "" : value)}><SelectTrigger><SelectValue placeholder="كل الامتحانات" /></SelectTrigger><SelectContent><SelectItem value="all">كل الامتحانات</SelectItem>{exams.map((exam) => <SelectItem key={exam.id} value={exam.id}>{exam.name}</SelectItem>)}</SelectContent></Select></div><div className="space-y-2"><Label>الحالة</Label><Select value={callCategory} onValueChange={(value) => setCallCategory(value as CallCategory | "all")}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">كل الحالات</SelectItem>{(Object.keys(callCategoryLabels) as CallCategory[]).map((key) => <SelectItem key={key} value={key}>{callCategoryLabels[key]}</SelectItem>)}</SelectContent></Select></div><div className="space-y-2"><Label>بحث</Label><Input value={callSearch} onChange={(event) => setCallSearch(event.target.value)} placeholder="طالب / كود / امتحان" /></div></CardContent></Card>
          <div className="space-y-2">{callRows.length === 0 ? <p className="empty-state py-8">لا توجد نتائج للمكالمات</p> : callRows.map(renderCallRow)}</div>
        </div>
      )}

      {tab === "grade-lists" && (
        <div className="space-y-4"><Card><CardContent className="grid gap-3 p-4 md:grid-cols-2"><div className="space-y-2"><Label>الامتحان</Label><Select value={gradeListExamId || exams[0]?.id || ""} onValueChange={setGradeListExamId}><SelectTrigger><SelectValue placeholder="اختر الامتحان" /></SelectTrigger><SelectContent>{exams.map((exam) => <SelectItem key={exam.id} value={exam.id}>{exam.name} - {formatAppDate(exam.date)}</SelectItem>)}</SelectContent></Select></div><div className="space-y-2"><Label>القائمة</Label><Select value={gradeListCategory} onValueChange={(value) => setGradeListCategory(value as CallCategory)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{(Object.keys(callCategoryLabels) as CallCategory[]).map((key) => <SelectItem key={key} value={key}>{callCategoryLabels[key]}</SelectItem>)}</SelectContent></Select></div></CardContent></Card><div className="space-y-2">{gradeListRows.length === 0 ? <p className="empty-state py-8">لا توجد أسماء في هذه القائمة</p> : gradeListRows.map(renderCallRow)}</div></div>
      )}

      <StudentProfileDialog
        student={selectedProfileStudent}
        open={profileDialogOpen}
        onOpenChange={setProfileDialogOpen}
        exams={exams}
        grades={grades}
        opportunityLogs={opportunityLogs}
        studentNotes={studentNotes}
        courseName={courseName}
        activeChapterForCourse={activeChapterForCourse}
        whatsappLink={whatsappLink}
        telegramLink={telegramLink}
        isStudentCurrentlyInGrace={isStudentCurrentlyInGrace}
        graceEndDate={graceEndDate}
      />
    </div>
  );
}
