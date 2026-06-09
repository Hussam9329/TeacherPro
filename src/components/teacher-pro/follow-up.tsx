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
import { searchAny } from "@/lib/validation";
import {
  hasActiveChapterLink,
  isExamOnOrAfterStudentRegistration,
  isGradeEntered,
  splitSelection,
  studentMatchesExamMainSites,
} from "@/lib/exam-utils";

type FollowTab = "leaves" | "calls" | "profile" | "grade-lists";
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
  profile: "ملف الطالب",
  "grade-lists": "قوائم الدرجات",
};

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

function formatScore(grade: Grade | undefined, exam: Exam) {
  if (!grade) return "غير مدخل";
  if (grade.status !== "درجة") return grade.status;
  return `${grade.score ?? "—"}/${exam.fullMark}`;
}

export function FollowUpView() {
  const {
    students,
    exams,
    grades,
    courses,
    courseChapters,
    studentLeaves,
    studentCalls,
    studentNotes,
    addStudentLeave,
    deleteStudentLeave,
    addStudentCall,
    updateStudentCall,
    addStudentNote,
    deleteStudentNote,
    courseName,
    classification,
  } = useTeacherStore();

  const [tab, setTab] = useState<FollowTab>("leaves");
  const [globalSearch, setGlobalSearch] = useState("");
  const [leaveStudentId, setLeaveStudentId] = useState("");
  const [leaveExamId, setLeaveExamId] = useState("");
  const [leaveReason, setLeaveReason] = useState("");
  const [leaveDate, setLeaveDate] = useState(todayISO());
  const [leaveNotes, setLeaveNotes] = useState("");

  const [callExamId, setCallExamId] = useState("");
  const [callCategory, setCallCategory] = useState<CallCategory | "all">("absent");
  const [callSearch, setCallSearch] = useState("");

  const [profileStudentId, setProfileStudentId] = useState("");
  const [profileSearch, setProfileSearch] = useState("");
  const [noteText, setNoteText] = useState("");

  const [gradeListExamId, setGradeListExamId] = useState("");
  const [gradeListCategory, setGradeListCategory] = useState<CallCategory>("absent");

  const filteredStudents = useMemo(() => {
    const query = globalSearch || profileSearch;
    return students
      .filter((student) => !query || searchAny(query, [student.name, student.code, student.phone, student.parentPhone, student.telegram, student.school, student.subSite, student.studyType]))
      .slice(0, 20);
  }, [students, globalSearch, profileSearch]);

  const selectedLeaveStudent = students.find((student) => student.id === leaveStudentId);
  const selectedProfileStudent = students.find((student) => student.id === profileStudentId);

  const leavesByKey = useMemo(() => {
    const keys = new Set<string>();
    studentLeaves.forEach((leave) => keys.add(`${leave.studentId}:${leave.examId}`));
    return keys;
  }, [studentLeaves]);

  const studentHasLeaveForExam = (studentId: string, examId: string) => leavesByKey.has(`${studentId}:${examId}`);

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
    return eligibleStudentsForExam(exam).flatMap((student) => {
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
  }, [exams, students, grades, courseChapters, callExamId, callCategory, callSearch, leavesByKey]);

  const gradeListRows = useMemo(() => {
    const exam = exams.find((item) => item.id === gradeListExamId) || exams[0];
    if (!exam) return [];
    return buildCallRowsForExam(exam).filter((row) => row.category === gradeListCategory);
  }, [exams, students, grades, courseChapters, gradeListExamId, gradeListCategory, leavesByKey]);

  const saveLeave = () => {
    if (!leaveStudentId || !leaveExamId || !leaveReason.trim()) {
      toast.error("اختر الطالب والامتحان واكتب سبب الإجازة");
      return;
    }
    const duplicate = studentLeaves.some((leave) => leave.studentId === leaveStudentId && leave.examId === leaveExamId);
    if (duplicate) {
      toast.error("هذا الطالب لديه إجازة مسجلة لهذا الامتحان");
      return;
    }
    const student = students.find((item) => item.id === leaveStudentId);
    addStudentLeave({
      studentId: leaveStudentId,
      examId: leaveExamId,
      reason: leaveReason.trim(),
      studyType: student?.studyType || "",
      date: leaveDate || todayISO(),
      notes: leaveNotes.trim(),
    });
    setLeaveReason("");
    setLeaveNotes("");
    toast.success("تمت إضافة الإجازة وإعادة احتساب الطالب بدون محاسبة هذا الامتحان");
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
    setTab("profile");
  };

  const addProfileNote = () => {
    if (!selectedProfileStudent || !noteText.trim()) return;
    addStudentNote({ studentId: selectedProfileStudent.id, kind: "ملاحظة", text: noteText.trim(), date: todayISO() });
    setNoteText("");
    toast.success("تم حفظ الملاحظة");
  };

  const profileGrades = selectedProfileStudent
    ? grades.filter((grade) => grade.studentId === selectedProfileStudent.id).map((grade) => ({ grade, exam: exams.find((exam) => exam.id === grade.examId) })).filter((row) => row.exam)
    : [];
  const profileLeaves = selectedProfileStudent ? studentLeaves.filter((leave) => leave.studentId === selectedProfileStudent.id) : [];
  const profileCalls = selectedProfileStudent ? studentCalls.filter((call) => call.studentId === selectedProfileStudent.id) : [];
  const profileNotes = selectedProfileStudent ? studentNotes.filter((note) => note.studentId === selectedProfileStudent.id) : [];

  const renderStudentPicker = (mode: "leave" | "profile") => {
    const selectedId = mode === "leave" ? leaveStudentId : profileStudentId;
    const setSelected = mode === "leave" ? setLeaveStudentId : setProfileStudentId;
    const searchValue = mode === "leave" ? globalSearch : profileSearch;
    const setSearchValue = mode === "leave" ? setGlobalSearch : setProfileSearch;
    return (
      <div className="space-y-2">
        <Label>{mode === "leave" ? "البحث العام عن الطالب" : "اختيار الطالب"}</Label>
        <Input value={searchValue} onChange={(event) => setSearchValue(event.target.value)} placeholder="اسم / كود / هاتف / مدرسة" />
        <div className="max-h-44 space-y-1 overflow-y-auto rounded-2xl border bg-muted/30 p-2">
          {filteredStudents.map((student) => (
            <button
              key={student.id}
              type="button"
              onClick={() => setSelected(student.id)}
              className={`flex w-full items-center justify-between rounded-xl px-3 py-2 text-right text-sm transition ${selectedId === student.id ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}
            >
              <span>{student.name}</span>
              <span className="text-xs opacity-80">{student.code}</span>
            </button>
          ))}
        </div>
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
          return (
            <div key={leave.id} className="grid gap-2 rounded-2xl border bg-card/80 p-3 text-sm md:grid-cols-5 md:items-center">
              <b>{student?.name || "طالب محذوف"}</b>
              <span>{leave.reason}</span>
              <span>{leave.studyType || student?.studyType || "—"}</span>
              <span>{exam?.name || "امتحان محذوف"}</span>
              <div className="flex items-center justify-between gap-2">
                <span>{leave.date}</span>
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
        <div><b>{row.exam.name}</b><p className="text-xs text-muted-foreground">{row.exam.date}</p></div>
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
          <Button variant="ghost" size="sm" onClick={() => openProfile(row.student.id)}>الملف</Button>
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
              {renderStudentPicker("leave")}
              <div className="space-y-2"><Label>الامتحان</Label><Select value={leaveExamId} onValueChange={setLeaveExamId}><SelectTrigger><SelectValue placeholder="اختر الامتحان" /></SelectTrigger><SelectContent>{exams.map((exam) => <SelectItem key={exam.id} value={exam.id}>{exam.name} - {exam.date}</SelectItem>)}</SelectContent></Select></div>
              <div className="space-y-2"><Label>سبب الإجازة</Label><Input value={leaveReason} onChange={(event) => setLeaveReason(event.target.value)} placeholder="مرض / ظرف عائلي / سفر..." /></div>
              <div className="space-y-2"><Label>تاريخ الإجازة</Label><Input type="date" value={leaveDate} onChange={(event) => setLeaveDate(event.target.value)} /></div>
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

      {tab === "profile" && (
        <div className="grid gap-4 xl:grid-cols-[360px_1fr]">
          <Card><CardHeader><CardTitle>بحث ملف الطالب</CardTitle></CardHeader><CardContent>{renderStudentPicker("profile")}</CardContent></Card>
          <Card><CardHeader><CardTitle>ملف الطالب</CardTitle></CardHeader><CardContent>{!selectedProfileStudent ? <p className="empty-state py-8">اختر طالباً لعرض ملفه</p> : <div className="space-y-4"><div className="grid gap-3 md:grid-cols-4"><div className="rounded-2xl border p-3"><p className="text-xs text-muted-foreground">الطالب</p><b>{selectedProfileStudent.name}</b></div><div className="rounded-2xl border p-3"><p className="text-xs text-muted-foreground">الدورة</p><b>{courseName(selectedProfileStudent.courseId)}</b></div><div className="rounded-2xl border p-3"><p className="text-xs text-muted-foreground">الفرص</p><b>{selectedProfileStudent.opportunities}/{selectedProfileStudent.baseOpportunities}</b></div><div className="rounded-2xl border p-3"><p className="text-xs text-muted-foreground">الحالة</p><b>{selectedProfileStudent.status}</b></div></div><div className="rounded-2xl border p-3"><h4 className="mb-2 font-bold">المعلومات العامة</h4><p className="text-sm text-muted-foreground">الهاتف: {selectedProfileStudent.phone || "—"} / ولي الأمر: {selectedProfileStudent.parentPhone || "—"} / المدرسة: {selectedProfileStudent.school || "—"} / نوع الدراسة: {selectedProfileStudent.studyType || "—"}</p></div><div className="grid gap-4 lg:grid-cols-2"><div className="rounded-2xl border p-3"><h4 className="mb-2 font-bold">سجل الامتحانات</h4><div className="space-y-2">{profileGrades.length === 0 ? <p className="text-xs text-muted-foreground">لا توجد درجات</p> : profileGrades.map(({ grade, exam }) => exam ? <div key={grade.id} className="rounded-xl bg-muted/50 p-2 text-sm"><b>{exam.name}</b><p>{formatScore(grade, exam)} - {classification(grade, exam, selectedProfileStudent).text}</p></div> : null)}</div></div><div className="rounded-2xl border p-3"><h4 className="mb-2 font-bold">الإجازات</h4>{profileLeaves.length === 0 ? <p className="text-xs text-muted-foreground">لا توجد إجازات</p> : profileLeaves.map((leave) => <p key={leave.id} className="rounded-xl bg-muted/50 p-2 text-sm">{leave.date} - {leave.reason}</p>)}</div><div className="rounded-2xl border p-3"><h4 className="mb-2 font-bold">سجل المكالمات</h4>{profileCalls.length === 0 ? <p className="text-xs text-muted-foreground">لا توجد مكالمات</p> : profileCalls.map((call) => <p key={call.id} className="rounded-xl bg-muted/50 p-2 text-sm">{call.completed ? "تمت" : "غير مكتملة"} - {call.target} - {call.notes}</p>)}</div><div className="rounded-2xl border p-3"><h4 className="mb-2 font-bold">الملاحظات والمتابعات</h4><div className="mb-2 flex gap-2"><Input value={noteText} onChange={(event) => setNoteText(event.target.value)} placeholder="اكتب ملاحظة متابعة" /><Button onClick={addProfileNote}>حفظ</Button></div>{profileNotes.length === 0 ? <p className="text-xs text-muted-foreground">لا توجد ملاحظات</p> : profileNotes.map((note) => <div key={note.id} className="mb-1 flex items-center justify-between rounded-xl bg-muted/50 p-2 text-sm"><span>{note.date} - {note.text}</span><Button variant="ghost" size="sm" onClick={() => deleteStudentNote(note.id)}>حذف</Button></div>)}</div></div></div>}</CardContent></Card>
        </div>
      )}

      {tab === "grade-lists" && (
        <div className="space-y-4"><Card><CardContent className="grid gap-3 p-4 md:grid-cols-2"><div className="space-y-2"><Label>الامتحان</Label><Select value={gradeListExamId || exams[0]?.id || ""} onValueChange={setGradeListExamId}><SelectTrigger><SelectValue placeholder="اختر الامتحان" /></SelectTrigger><SelectContent>{exams.map((exam) => <SelectItem key={exam.id} value={exam.id}>{exam.name} - {exam.date}</SelectItem>)}</SelectContent></Select></div><div className="space-y-2"><Label>القائمة</Label><Select value={gradeListCategory} onValueChange={(value) => setGradeListCategory(value as CallCategory)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{(Object.keys(callCategoryLabels) as CallCategory[]).map((key) => <SelectItem key={key} value={key}>{callCategoryLabels[key]}</SelectItem>)}</SelectContent></Select></div></CardContent></Card><div className="space-y-2">{gradeListRows.length === 0 ? <p className="empty-state py-8">لا توجد أسماء في هذه القائمة</p> : gradeListRows.map(renderCallRow)}</div></div>
      )}
    </div>
  );
}
