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
import { Checkbox } from "@/components/ui/checkbox";
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
  formatGradeScore,
  isGradeEntered,
  isExamWithinStudentGracePeriod,
  splitSelection,
  studentMatchesExamMainSites,
} from "@/lib/exam-utils";

type FollowView = "leaves" | "calls" | "pledges";
type CallCategory = "absent" | "failed" | "low-pass" | "full" | "dismissal-temporary" | "dismissal-final";
type PledgeTypeFilter = "all" | "temporary" | "final";
type PledgeStatusFilter = "all" | "pledged" | "pending";
type ContactStatus = "تم الاتصال" | "لم يرد" | "الرقم خاطئ";

type CallRow = {
  id: string;
  student: Student;
  exam?: Exam;
  grade?: Grade;
  category: CallCategory;
  label: string;
  reason: string;
};

type DismissalLinkInfo = {
  key: string;
  sourceType: string;
  sourceId: string;
  type: string;
  reason: string;
  date: string;
  examName: string;
};

const viewTitles: Record<FollowView, { title: string; description: string }> = {
  calls: { title: "المكالمات", description: "متابعة الغياب والرسوب والدرجات والفصل المؤقت والنهائي عبر الاتصال." },
  leaves: { title: "الإجازات", description: "تسجيل إجازات الطلاب حسب الامتحان أو حسب فترة زمنية." },
  pledges: { title: "تعهدات", description: "فرز طلبة الفصل المؤقت والنهائي وتثبيت تعهد ولي الأمر." },
};

const leaveReasonOptions = ["حالة مرضية", "سفر", "حالة وفاة", "ظروف قاهرة", "أخرى"] as const;
type LeaveReasonOption = typeof leaveReasonOptions[number];
type LeaveMode = "exam" | "period";

const callCategoryLabels: Record<CallCategory, string> = {
  absent: "الغائبون",
  failed: "الراسبون",
  "low-pass": "ناجح بدرجة منخفضة",
  full: "درجة كاملة",
  "dismissal-temporary": "فصل مؤقت",
  "dismissal-final": "فصل نهائي",
};

const contactStatusOptions: ContactStatus[] = ["تم الاتصال", "لم يرد", "الرقم خاطئ"];
const PLEDGE_NOTE_KIND = "تعهد ولي الأمر";

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

function whatsappAppLink(phone: string): string {
  const digits = phoneForWhatsApp(phone);
  return digits ? `whatsapp://send?phone=${digits}` : "#";
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

function normalizeDismissalText(value: string | null | undefined): string {
  return String(value || "")
    .replace(/^تلقائي:\s*/, "")
    .replace(/^فصل الطالب:\s*/, "")
    .replace(/\s+/g, " ")
    .trim();
}

function buildDismissalKey(parts: { studentId: string; sourceType: string; sourceId: string; type: string; reason: string; date: string }) {
  return [
    parts.studentId,
    parts.sourceType,
    parts.sourceId,
    normalizeDismissalText(parts.type),
    normalizeDismissalText(parts.reason),
    dayKey(parts.date),
  ].join("::");
}

function FollowUpViewBase({ view }: { view: FollowView }) {
  const {
    students,
    exams,
    grades,
    courseChapters,
    studentLeaves,
    studentCalls,
    studentNotes,
    opportunityLogs,
    logs,
    addStudentLeave,
    deleteStudentLeave,
    addStudentCall,
    updateStudentCall,
    addStudentNote,
    deleteStudentNote,
    courseName,
    activeChapterForCourse,
  } = useTeacherStore();

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
  const [callCategory, setCallCategory] = useState<CallCategory | "all">("all");
  const [callSearch, setCallSearch] = useState("");
  const [pledgeSearch, setPledgeSearch] = useState("");
  const [pledgeTypeFilter, setPledgeTypeFilter] = useState<PledgeTypeFilter>("all");
  const [pledgeStatusFilter, setPledgeStatusFilter] = useState<PledgeStatusFilter>("all");

  const [profileStudentId, setProfileStudentId] = useState("");
  const [profileDialogOpen, setProfileDialogOpen] = useState(false);


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

  const dismissalGroup = (student: Student): "temporary" | "final" | null => {
    if (student.status !== "مفصول") return null;
    const type = String(student.dismissalType || "");
    if (type.includes("نهائي") || type.includes("دائم")) return "final";
    if (type.includes("مؤقت")) return "temporary";
    return "temporary";
  };

  const dismissalCategory = (student: Student): Extract<CallCategory, "dismissal-temporary" | "dismissal-final"> => (
    dismissalGroup(student) === "final" ? "dismissal-final" : "dismissal-temporary"
  );

  const dismissalInfoForStudent = (student: Student): DismissalLinkInfo | null => {
    if (student.status !== "مفصول") return null;
    const type = student.dismissalType || "فصل مؤقت";
    const reason = student.dismissalReason || type || "طالب مفصول";
    const normalizedReason = normalizeDismissalText(reason);
    const dismissalLogs = opportunityLogs
      .filter((log) => log.studentId === student.id)
      .filter((log) => {
        const rawReason = String(log.reason || "");
        const logReason = normalizeDismissalText(rawReason);
        return log.action === "فصل تلقائي"
          || (log.action === "خصم" && rawReason.startsWith("فصل الطالب"))
          || (normalizedReason && logReason.includes(normalizedReason));
      })
      .sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));
    const sourceLog = dismissalLogs.find((log) => log.action === "فصل تلقائي") || dismissalLogs[0];
    const sourceNote = sourceLog ? undefined : studentNotes
      .filter((note) => note.studentId === student.id && note.kind === "إجراء")
      .filter((note) => {
        const noteText = normalizeDismissalText(note.text);
        return note.text.includes("فصل الطالب") || (normalizedReason && noteText.includes(normalizedReason));
      })
      .sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")))[0];
    const sourceExam = sourceLog?.examId ? exams.find((exam) => exam.id === sourceLog.examId) : undefined;
    const sourceType = sourceLog ? "opportunity-log" : sourceNote ? "student-note" : "student-dismissal";
    const sourceId = sourceLog?.id || sourceNote?.id || student.id;
    const date = dayKey(sourceLog?.date || sourceNote?.date || student.createdAt);
    const key = buildDismissalKey({
      studentId: student.id,
      sourceType,
      sourceId,
      type,
      reason,
      date,
    });
    return {
      key,
      sourceType,
      sourceId,
      type,
      reason,
      date,
      examName: sourceExam?.name || "",
    };
  };

  const pledgeNoteForDismissal = (student: Student, dismissalInfo = dismissalInfoForStudent(student)) => {
    if (!dismissalInfo) return undefined;
    return studentNotes.find((note) => {
      if (note.studentId !== student.id || note.kind !== PLEDGE_NOTE_KIND) return false;
      if (note.dismissalKey) return note.dismissalKey === dismissalInfo.key;
      if (note.sourceType && note.sourceId) return note.sourceType === dismissalInfo.sourceType && note.sourceId === dismissalInfo.sourceId;
      const noteReason = normalizeDismissalText(note.dismissalReason || note.text);
      return note.text.includes(student.dismissalType || "فصل")
        && (!noteReason || noteReason.includes(normalizeDismissalText(dismissalInfo.reason)) || normalizeDismissalText(dismissalInfo.reason).includes(noteReason));
    });
  };

  const buildCallRowsForExam = (exam: Exam): CallRow[] => {
    return eligibleStudentsForExam(exam).flatMap<CallRow>((student) => {
      if (studentHasLeaveForExam(student.id, exam.id)) return [];
      if (isExamWithinStudentGracePeriod(student, exam)) return [];
      const grade = getGrade(student.id, exam.id);
      const entered = isGradeEntered(grade, exam);
      if (!entered) return [];
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

  const dismissalCallRows = useMemo<CallRow[]>(() => students
    .filter((student) => student.status === "مفصول")
    .map((student) => {
      const category = dismissalCategory(student);
      return {
        id: `dismissal:${student.id}:${category}`,
        student,
        category,
        label: callCategoryLabels[category],
        reason: student.dismissalReason || student.dismissalType || "طالب مفصول",
      };
    }), [students]);

  const callRows = useMemo(() => {
    const sourceExams = callExamId ? exams.filter((exam) => exam.id === callExamId) : exams;
    const examRows = sourceExams.flatMap(buildCallRowsForExam);
    const sourceRows = callExamId ? examRows : [...examRows, ...dismissalCallRows];
    return sourceRows
      .filter((row) => callCategory === "all" || row.category === callCategory)
      .filter((row) => !callSearch || searchAny(callSearch, [row.student.name, row.student.code, row.student.phone, row.student.parentPhone, row.exam?.name, row.reason, row.student.dismissalType]))
      .sort((a, b) => `${b.exam?.date || "9999-12-31"}-${a.student.name}`.localeCompare(`${a.exam?.date || "9999-12-31"}-${b.student.name}`, "ar"));
  }, [exams, students, grades, courseChapters, callExamId, callCategory, callSearch, studentLeaves, dismissalCallRows]);

  const pledgeNoteForStudent = (student: Student) => pledgeNoteForDismissal(student);

  const dismissedStudentsForPledges = useMemo(() => students
    .filter((student) => student.status === "مفصول")
    .filter((student) => {
      const group = dismissalGroup(student);
      if (pledgeTypeFilter === "temporary" && group !== "temporary") return false;
      if (pledgeTypeFilter === "final" && group !== "final") return false;
      const pledged = Boolean(pledgeNoteForStudent(student));
      if (pledgeStatusFilter === "pledged" && !pledged) return false;
      if (pledgeStatusFilter === "pending" && pledged) return false;
      return !pledgeSearch || searchAny(pledgeSearch, [student.name, student.code, student.phone, student.parentPhone, student.dismissalType, student.dismissalReason]);
    })
    .sort((a, b) => `${dismissalGroup(a) === "temporary" ? 0 : 1}-${a.name}`.localeCompare(`${dismissalGroup(b) === "temporary" ? 0 : 1}-${b.name}`, "ar")),
    [students, studentNotes, opportunityLogs, exams, pledgeSearch, pledgeTypeFilter, pledgeStatusFilter],
  );

  const pledgeStats = useMemo(() => {
    const dismissed = students.filter((student) => student.status === "مفصول");
    const temporary = dismissed.filter((student) => dismissalGroup(student) === "temporary").length;
    const final = dismissed.filter((student) => dismissalGroup(student) === "final").length;
    const pledged = dismissed.filter((student) => Boolean(pledgeNoteForStudent(student))).length;
    return { dismissed: dismissed.length, temporary, final, pledged, pending: dismissed.length - pledged };
  }, [students, studentNotes, opportunityLogs, exams]);


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
    const affectedGrades = grades.filter((grade) => {
      if (grade.studentId !== leaveStudentId) return false;
      if (leaveMode === "exam") return grade.examId === leaveExamId;
      const exam = exams.find((item) => item.id === grade.examId);
      return Boolean(exam && leaveAppliesToExam({ studentId: leaveStudentId, leaveType: "period", dateFrom: from, dateTo: to }, leaveStudentId, exam));
    });
    const removedGradeMessages = affectedGrades.map((grade) => {
      const exam = exams.find((item) => item.id === grade.examId);
      return `${exam?.name || "امتحان محذوف"}: ${formatGradeScore(grade, exam, "—")}`;
    });
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
    if (removedGradeMessages.length > 0) {
      toast.success(
        removedGradeMessages.length === 1
          ? `تم حذف درجة الطالب ${removedGradeMessages[0]} لأن الطالب أصبح مجازًا`
          : `تم حذف ${removedGradeMessages.length} درجات لأن الطالب أصبح مجازًا`,
        removedGradeMessages.length > 1 ? { description: removedGradeMessages.join(" | ") } : undefined,
      );
    } else {
      toast.success(leaveMode === "period" ? "تمت إضافة الإجازة للفترة وإلغاء محاسبة امتحاناتها" : "تمت إضافة الإجازة وإعادة احتساب الطالب بدون محاسبة هذا الامتحان");
    }
  };

  const callLogForRow = (row: CallRow) => {
    const examId = row.exam?.id || "";
    return studentCalls.find((call) => call.studentId === row.student.id && String(call.examId || "") === examId && call.category === row.category);
  };

  const callStatusForLog = (call: ReturnType<typeof callLogForRow>): ContactStatus => {
    const value = String(call?.status || "");
    if ((contactStatusOptions as string[]).includes(value)) return value as ContactStatus;
    return call?.completed ? "تم الاتصال" : "لم يرد";
  };

  const saveCallStatus = (row: CallRow, status: ContactStatus) => {
    const existing = callLogForRow(row);
    const completed = status === "تم الاتصال";
    const payload = {
      studentId: row.student.id,
      examId: row.exam?.id || "",
      category: row.category,
      target: "",
      phone: [row.student.phone, row.student.parentPhone].filter(Boolean).join(" / "),
      status,
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

  const studentOpportunityText = (student: Student) => {
    if (!activeChapterForCourse(student.courseId)) return "0 / 0";
    return `${Number(student.opportunities || 0)} / ${Number(student.baseOpportunities || 0)}`;
  };

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
            <Badge variant="secondary">عدد فرص الطالب: {studentOpportunityText(selectedLeaveStudent)}</Badge>
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

  const renderPhoneLink = (label: string, phone?: string) => {
    const digits = phoneForWhatsApp(phone);
    if (!digits) {
      return <span className="rounded-xl border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">{label}: لا يوجد رقم</span>;
    }
    return (
      <a
        className="rounded-xl border bg-card px-3 py-2 text-xs font-bold text-emerald-700 underline dark:text-emerald-300"
        href={whatsappAppLink(phone || "")}
        target="_blank"
        rel="noreferrer"
      >
        {label}: {phone}
      </a>
    );
  };

  const renderCallRow = (row: CallRow) => {
    const call = callLogForRow(row);
    const contactStatus = callStatusForLog(call);
    return (
      <div key={row.id} className="grid gap-3 rounded-2xl border bg-card/80 p-3 text-sm xl:grid-cols-[1.2fr_1fr_1fr_1.3fr_170px_auto] xl:items-center">
        <div>
          <div className="flex flex-wrap items-center gap-2"><b>{row.student.name}</b><Badge variant="outline">{row.student.code}</Badge></div>
          <p className="text-xs text-muted-foreground">{courseName(row.student.courseId)} - {row.student.studyType || "—"}</p>
        </div>
        <div><b>{row.exam?.name || "ملف الفصل"}</b><p className="text-xs text-muted-foreground">{row.exam ? formatAppDate(row.exam.date) : (row.student.dismissalType || "طالب مفصول")}</p></div>
        <div>
          <Badge>{row.label}</Badge>
          <p className="mt-1 text-xs text-muted-foreground">{row.reason}</p>
          {row.grade?.notes ? <p className="mt-2 rounded-xl border border-amber-200/70 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/25 dark:text-amber-100"><span className="font-bold">ملاحظة الدرجة: </span>{row.grade.notes}</p> : null}
        </div>
        <div className="flex flex-wrap gap-2">
          {renderPhoneLink("رقم الطالب", row.student.phone)}
          {renderPhoneLink("رقم ولي الأمر", row.student.parentPhone)}
        </div>
        <Select value={contactStatus} onValueChange={(value) => saveCallStatus(row, value as ContactStatus)}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            {contactStatusOptions.map((status) => <SelectItem key={status} value={status}>{status}</SelectItem>)}
          </SelectContent>
        </Select>
        <div className="flex items-center justify-end">
          <Button variant="ghost" size="sm" onClick={() => openProfile(row.student.id)}>ملف الطالب</Button>
        </div>
      </div>
    );
  };


  const togglePledge = (student: Student, checked: boolean) => {
    const dismissalInfo = dismissalInfoForStudent(student);
    if (!dismissalInfo) {
      toast.error("لا يوجد فصل حالي يمكن ربط التعهد به");
      return;
    }
    const existing = pledgeNoteForDismissal(student, dismissalInfo);
    if (checked) {
      if (existing) return;
      addStudentNote({
        studentId: student.id,
        kind: PLEDGE_NOTE_KIND,
        text: `تم تعهد ولي الأمر على ${dismissalInfo.type}: ${dismissalInfo.reason}`,
        date: todayISO(),
        sourceType: dismissalInfo.sourceType,
        sourceId: dismissalInfo.sourceId,
        dismissalKey: dismissalInfo.key,
        dismissalType: dismissalInfo.type,
        dismissalReason: dismissalInfo.reason,
        dismissalDate: dismissalInfo.date,
      });
      toast.success("تم تثبيت التعهد وربطه بسجل الفصل");
      return;
    }
    if (existing) {
      studentNotes
        .filter((note) => note.studentId === student.id && note.kind === PLEDGE_NOTE_KIND)
        .filter((note) => {
          if (note.dismissalKey) return note.dismissalKey === dismissalInfo.key;
          if (note.sourceType && note.sourceId) return note.sourceType === dismissalInfo.sourceType && note.sourceId === dismissalInfo.sourceId;
          return note.id === existing.id;
        })
        .forEach((note) => deleteStudentNote(note.id));
      toast.success("تم إلغاء التعهد المرتبط بهذا الفصل فقط");
    }
  };

  const renderPledgeRow = (student: Student) => {
    const group = dismissalGroup(student);
    const dismissalInfo = dismissalInfoForStudent(student);
    const pledged = Boolean(pledgeNoteForDismissal(student, dismissalInfo));
    return (
      <div key={student.id} className="grid gap-3 rounded-2xl border bg-card/80 p-3 text-sm xl:grid-cols-[1.2fr_1fr_1.7fr_1.2fr_170px_auto] xl:items-center">
        <div>
          <div className="flex flex-wrap items-center gap-2"><b>{student.name}</b><Badge variant="outline">{student.code}</Badge></div>
          <p className="text-xs text-muted-foreground">{courseName(student.courseId)} - {student.studyType || "—"}</p>
        </div>
        <div className="space-y-1">
          <Badge variant={group === "final" ? "destructive" : "secondary"}>{dismissalInfo?.type || student.dismissalType || "فصل مؤقت"}</Badge>
          <p className="text-xs text-muted-foreground">الحالة: {student.status}</p>
          {dismissalInfo?.date ? <p className="text-xs text-muted-foreground">تاريخ الفصل: {formatAppDate(dismissalInfo.date)}</p> : null}
        </div>
        <div className="space-y-1">
          <p className="text-xs leading-6 text-muted-foreground">{dismissalInfo?.reason || student.dismissalReason || "لا يوجد سبب فصل مسجل"}</p>
          <p className="rounded-xl bg-muted/50 px-2 py-1 text-[11px] text-muted-foreground">
            الربط: {dismissalInfo?.sourceType === "opportunity-log" ? "سجل فرص/فصل" : dismissalInfo?.sourceType === "student-note" ? "ملاحظة إجراء الفصل" : "ملف الفصل الحالي"}
            {dismissalInfo?.examName ? ` - ${dismissalInfo.examName}` : ""}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {renderPhoneLink("رقم الطالب", student.phone)}
          {renderPhoneLink("رقم ولي الأمر", student.parentPhone)}
        </div>
        <label className="flex cursor-pointer items-center justify-between gap-3 rounded-2xl border bg-muted/30 px-3 py-2">
          <span className="text-sm font-bold">التعهد</span>
          <Checkbox checked={pledged} onCheckedChange={(value) => togglePledge(student, Boolean(value))} />
        </label>
        <div className="flex items-center justify-end">
          <Button variant="ghost" size="sm" onClick={() => openProfile(student.id)}>ملف الطالب</Button>
        </div>
      </div>
    );
  };


  if (profileDialogOpen && selectedProfileStudent) {
    return (
      <StudentProfileDialog
        student={selectedProfileStudent}
        open
        onOpenChange={(open) => {
          if (!open) setProfileDialogOpen(false);
        }}
        exams={exams}
        grades={grades}
        opportunityLogs={opportunityLogs}
        studentLeaves={studentLeaves}
        studentCalls={studentCalls}
        studentNotes={studentNotes}
        logs={logs}
        courseName={courseName}
        activeChapterForCourse={activeChapterForCourse}
        whatsappLink={whatsappLink}
        telegramLink={telegramLink}
        isStudentCurrentlyInGrace={isStudentCurrentlyInGrace}
        graceEndDate={graceEndDate}
      />
    );
  }

  return (
    <div className="space-y-5">
      <Card className="overflow-hidden">
        <div className="h-1 bg-gradient-to-l from-primary via-fuchsia-500 to-indigo-500" />
        <CardHeader>
          <CardTitle>{viewTitles[view].title}</CardTitle>
          <p className="text-sm text-muted-foreground">{viewTitles[view].description}</p>
        </CardHeader>
      </Card>

      {view === "leaves" && (
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

      {view === "calls" && (
        <div className="space-y-4">
          <Card>
            <CardContent className="grid gap-3 p-4 md:grid-cols-3">
              <div className="space-y-2"><Label>الامتحان</Label><Select value={callExamId || "all"} onValueChange={(value) => setCallExamId(value === "all" ? "" : value)}><SelectTrigger><SelectValue placeholder="كل الامتحانات" /></SelectTrigger><SelectContent><SelectItem value="all">كل الامتحانات + المفصولون</SelectItem>{exams.map((exam) => <SelectItem key={exam.id} value={exam.id}>{exam.name}</SelectItem>)}</SelectContent></Select></div>
              <div className="space-y-2"><Label>الحالة</Label><Select value={callCategory} onValueChange={(value) => setCallCategory(value as CallCategory | "all")}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">كل الحالات</SelectItem>{(Object.keys(callCategoryLabels) as CallCategory[]).map((key) => <SelectItem key={key} value={key}>{callCategoryLabels[key]}</SelectItem>)}</SelectContent></Select></div>
              <div className="space-y-2"><Label>بحث</Label><Input value={callSearch} onChange={(event) => setCallSearch(event.target.value)} placeholder="طالب / كود / امتحان / سبب الفصل" /></div>
            </CardContent>
          </Card>
          <div className="grid gap-3 md:grid-cols-4">
            <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">إجمالي النتائج</p><b className="text-2xl">{callRows.length}</b></CardContent></Card>
            <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">فصل مؤقت</p><b className="text-2xl">{dismissalCallRows.filter((row) => row.category === "dismissal-temporary").length}</b></CardContent></Card>
            <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">فصل نهائي</p><b className="text-2xl">{dismissalCallRows.filter((row) => row.category === "dismissal-final").length}</b></CardContent></Card>
            <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">حالات الاتصال</p><b className="text-sm">تم / لم يرد / خطأ</b></CardContent></Card>
          </div>
          <div className="space-y-2">{callRows.length === 0 ? <p className="empty-state py-8">لا توجد نتائج للمكالمات</p> : callRows.map(renderCallRow)}</div>
        </div>
      )}

      {view === "pledges" && (
        <div className="space-y-4">
          <div className="grid gap-3 md:grid-cols-5">
            <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">المفصولون</p><b className="text-2xl">{pledgeStats.dismissed}</b></CardContent></Card>
            <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">فصل مؤقت</p><b className="text-2xl">{pledgeStats.temporary}</b></CardContent></Card>
            <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">فصل نهائي</p><b className="text-2xl">{pledgeStats.final}</b></CardContent></Card>
            <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">تم التعهد</p><b className="text-2xl">{pledgeStats.pledged}</b></CardContent></Card>
            <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">بانتظار التعهد</p><b className="text-2xl">{pledgeStats.pending}</b></CardContent></Card>
          </div>

          <Card>
            <CardContent className="grid gap-3 p-4 md:grid-cols-3">
              <div className="space-y-2"><Label>فرز الفصل</Label><Select value={pledgeTypeFilter} onValueChange={(value) => setPledgeTypeFilter(value as PledgeTypeFilter)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">كل المفصولين</SelectItem><SelectItem value="temporary">طلبة الفصل المؤقت</SelectItem><SelectItem value="final">طلبة الفصل النهائي</SelectItem></SelectContent></Select></div>
              <div className="space-y-2"><Label>حالة التعهد</Label><Select value={pledgeStatusFilter} onValueChange={(value) => setPledgeStatusFilter(value as PledgeStatusFilter)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">كل الحالات</SelectItem><SelectItem value="pledged">تم التعهد</SelectItem><SelectItem value="pending">لم يتم التعهد</SelectItem></SelectContent></Select></div>
              <div className="space-y-2"><Label>بحث</Label><Input value={pledgeSearch} onChange={(event) => setPledgeSearch(event.target.value)} placeholder="طالب / كود / سبب الفصل" /></div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>قائمة التعهدات</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              {dismissedStudentsForPledges.length === 0 ? <p className="empty-state py-8">لا توجد نتائج للتعهدات</p> : dismissedStudentsForPledges.map(renderPledgeRow)}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}

export function FollowUpCallsView() {
  return <FollowUpViewBase view="calls" />;
}

export function FollowUpLeavesView() {
  return <FollowUpViewBase view="leaves" />;
}

export function FollowUpPledgesView() {
  return <FollowUpViewBase view="pledges" />;
}

export function FollowUpView() {
  return <FollowUpLeavesView />;
}
