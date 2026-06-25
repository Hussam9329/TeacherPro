"use client";

import React, { useMemo, useState } from "react";
import {
  useTeacherStore,
  type Exam,
  type Grade,
  type Student,
  type StudentNote,
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
import { ExportDialog, type ExportColumn } from "./export-dialog";
import { formatGradeScore } from "@/lib/exam-utils";
import {
  buildArabicLetterOptions,
  gradeMatchesStatusFilter,
  gradeStatusFilterLabels,
  gradeStatusFilterOptions,
  matchesArabicLetterFilter,
  type GradeStatusFilter,
} from "@/lib/grade-status-filters";

type FollowView = "leaves" | "calls" | "pledges";
type CallCategory =
  | "absent"
  | "failed"
  | "low-pass"
  | "full"
  | "passed"
  | "cheating";
type PledgeTypeFilter = "all" | "temporary" | "final";
type PledgeStatusFilter = "all" | "pledged" | "pending" | "reactivated";
type ContactStatus = "" | "تم الاتصال" | "لم يرد" | "الرقم خاطئ";
type CallGradeSort = "latest" | "exam" | "score-desc" | "score-asc" | "name";

type CallGradeItem = {
  id: string;
  callKey: string;
  exam: Exam;
  grade: Grade;
  category: CallCategory;
  label: string;
  reason: string;
  sortTime: number;
};

type CallStudentRow = {
  id: string;
  student: Student;
  items: CallGradeItem[];
  focusItem: CallGradeItem;
};

type CallExportRow = {
  row: CallStudentRow;
  status: ContactStatus;
  note: string;
  courseName: (id: string) => string;
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

type PledgeRow = {
  key: string;
  student: Student;
  dismissalInfo: DismissalLinkInfo;
  group: "temporary" | "final";
  pledged: boolean;
  note?: StudentNote;
  reactivated: boolean;
};

const viewTitles: Record<FollowView, { title: string; description: string }> = {
  calls: {
    title: "المكالمات",
    description:
      "متابعة الغياب والرسوب والدرجات والفصل المؤقت والنهائي عبر الاتصال.",
  },
  leaves: {
    title: "الإجازات",
    description: "تسجيل إجازات الطلاب حسب الامتحان أو حسب فترة زمنية.",
  },
  pledges: {
    title: "تعهدات",
    description: "فرز طلبة الفصل المؤقت والنهائي وتثبيت تعهد ولي الأمر.",
  },
};

const leaveReasonOptions = [
  "حالة مرضية",
  "سفر",
  "حالة وفاة",
  "ظروف قاهرة",
  "أخرى",
] as const;
type LeaveReasonOption = (typeof leaveReasonOptions)[number];
type LeaveMode = "exam" | "period";

const callCategoryLabels: Record<CallCategory, string> = {
  absent: "غائب",
  failed: "راسب",
  "low-pass": "ناجح بدرجة منخفضة",
  full: "درجة كاملة",
  passed: "ناجح",
  cheating: "غش",
};

const CONTACT_STATUS_EMPTY_VALUE = "__empty__";
const CALL_STUDENT_NOTE_CATEGORY = "call-student-note";
const contactStatusOptions: Array<{
  value: typeof CONTACT_STATUS_EMPTY_VALUE | Exclude<ContactStatus, "">;
  label: string;
}> = [
  { value: CONTACT_STATUS_EMPTY_VALUE, label: "بدون إجراء" },
  { value: "تم الاتصال", label: "تم الاتصال" },
  { value: "لم يرد", label: "لم يرد" },
  { value: "الرقم خاطئ", label: "الرقم خاطئ" },
];
const CALL_PAGE_SIZE = 120;
const excludedCallGradeStatusFilters = new Set<GradeStatusFilter>(["grace-period"]);
const callGradeStatusFilterOptions = gradeStatusFilterOptions.filter(
  (option) => !excludedCallGradeStatusFilters.has(option),
);
const nonCallableGradeKinds = new Set([
  "grace",
  "before-registration",
  "excused",
  "missing",
]);
const callGradeSortLabels: Record<CallGradeSort, string> = {
  latest: "آخر درجة أولاً",
  exam: "حسب الامتحان",
  "score-desc": "حسب الدرجة: الأعلى أولاً",
  "score-asc": "حسب الدرجة: الأقل أولاً",
  name: "حسب الأحرف الأبجدية",
};

const callExportColumns: ExportColumn<CallExportRow>[] = [
  {
    key: "student",
    label: "الطالب",
    value: ({ row }) => row.student.name || "",
  },
  { key: "code", label: "الكود", value: ({ row }) => row.student.code || "" },
  {
    key: "course",
    label: "الدورة",
    value: ({ row, courseName }) => courseName(row.student.courseId),
  },
  {
    key: "studentStatus",
    label: "حالة الطالب",
    value: ({ row }) => row.student.status || "",
  },
  {
    key: "exam",
    label: "الامتحان المحور",
    value: ({ row }) => row.focusItem.exam.name || "",
  },
  {
    key: "gradeStatus",
    label: "حالة الدرجة",
    value: ({ row }) => row.focusItem.label || "",
  },
  {
    key: "grade",
    label: "الدرجة",
    value: ({ row }) =>
      formatGradeScore(row.focusItem.grade, row.focusItem.exam, "—"),
  },
  {
    key: "contact",
    label: "حالة الاتصال",
    value: ({ status }) => status || "بدون إجراء",
  },
  {
    key: "phone",
    label: "رقم الطالب",
    value: ({ row }) => row.student.phone || "",
  },
  {
    key: "parentPhone",
    label: "رقم ولي الأمر",
    value: ({ row }) => row.student.parentPhone || "",
  },
  {
    key: "telegram",
    label: "معرف التلكرام",
    value: ({ row }) => row.student.telegram || "",
  },
  { key: "note", label: "ملاحظات المكالمات", value: ({ note }) => note },
];
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

function gradeScoreForSort(grade: Grade, direction: "asc" | "desc") {
  if (
    grade.status === "درجة" &&
    grade.score !== null &&
    Number.isFinite(Number(grade.score))
  ) {
    return Number(grade.score);
  }
  return direction === "asc"
    ? Number.POSITIVE_INFINITY
    : Number.NEGATIVE_INFINITY;
}

function gradeTimeValue(grade: Grade, exam: Exam) {
  const value = grade.updatedAt || grade.createdAt || exam.date || "";
  const time = new Date(value).getTime();
  if (Number.isFinite(time)) return time;
  const fallback = new Date(exam.date || "").getTime();
  return Number.isFinite(fallback) ? fallback : 0;
}

function sortGradeItemsByLatest(items: CallGradeItem[]) {
  return [...items].sort(
    (a, b) =>
      b.sortTime - a.sortTime ||
      String(b.exam.date || "").localeCompare(String(a.exam.date || ""), "ar"),
  );
}

function contactStatusSelectValue(
  status: ContactStatus,
): typeof CONTACT_STATUS_EMPTY_VALUE | Exclude<ContactStatus, ""> {
  return status || CONTACT_STATUS_EMPTY_VALUE;
}

function contactStatusFromSelectValue(value: string): ContactStatus {
  return value === CONTACT_STATUS_EMPTY_VALUE ? "" : (value as ContactStatus);
}

function contactStatusClasses(status: ContactStatus): string {
  if (status === "تم الاتصال")
    return "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/50 dark:bg-emerald-950/30 dark:text-emerald-200";
  if (status === "لم يرد")
    return "border-red-200 bg-red-50 text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-200";
  if (status === "الرقم خاطئ")
    return "border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-900/50 dark:bg-blue-950/30 dark:text-blue-200";
  return "border-muted bg-muted/40 text-muted-foreground";
}

function graceEndDate(student: Student): string {
  const start = new Date(
    `${String(student.createdAt || "").slice(0, 10)}T00:00:00`,
  );
  const days = Number(student.accountingGraceDays || 0);
  if (!Number.isFinite(start.getTime()) || days <= 0)
    return formatAppDate(
      student.createdAt,
      String(student.createdAt || "").slice(0, 10) || "-",
    );
  const end = new Date(start);
  end.setDate(end.getDate() + days - 1);
  return formatAppDate(end);
}

function isStudentCurrentlyInGrace(student: Student): boolean {
  const days = Number(student.accountingGraceDays || 0);
  if (days <= 0) return false;
  const start = new Date(
    `${String(student.createdAt || "").slice(0, 10)}T00:00:00`,
  );
  const today = new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00`);
  const endExclusive = new Date(start);
  endExclusive.setDate(endExclusive.getDate() + days);
  return (
    Number.isFinite(start.getTime()) && today >= start && today < endExclusive
  );
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

function buildDismissalKey(parts: {
  studentId: string;
  sourceType: string;
  sourceId: string;
  type: string;
  reason: string;
  date: string;
}) {
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
    reactivateStudent,
    courseName,
    activeChapterForCourse,
    classification,
  } = useTeacherStore();

  const [globalSearch, setGlobalSearch] = useState("");
  const [leaveStudentId, setLeaveStudentId] = useState("");
  const [leaveMode, setLeaveMode] = useState<LeaveMode>("exam");
  const [leaveExamId, setLeaveExamId] = useState("");
  const [leaveReasonChoice, setLeaveReasonChoice] =
    useState<LeaveReasonOption>("حالة مرضية");
  const [customLeaveReason, setCustomLeaveReason] = useState("");
  const [leaveDate, setLeaveDate] = useState(todayISO());
  const [leaveDateFrom, setLeaveDateFrom] = useState(todayISO());
  const [leaveDateTo, setLeaveDateTo] = useState(todayISO());
  const [leaveNotes, setLeaveNotes] = useState("");

  const [callExamId, setCallExamId] = useState("");
  const [callGradeStatusFilter, setCallGradeStatusFilter] =
    useState<GradeStatusFilter>("all");
  const [callNameLetter, setCallNameLetter] = useState("all");
  const [callSearch, setCallSearch] = useState("");
  const [callGradeSort, setCallGradeSort] = useState<CallGradeSort>("latest");
  const [callGradePage, setCallGradePage] = useState(1);
  const [pledgeSearch, setPledgeSearch] = useState("");
  const [pledgeTypeFilter, setPledgeTypeFilter] =
    useState<PledgeTypeFilter>("all");
  const [pledgeStatusFilter, setPledgeStatusFilter] =
    useState<PledgeStatusFilter>("all");

  const [profileStudentId, setProfileStudentId] = useState("");
  const [profileDialogOpen, setProfileDialogOpen] = useState(false);

  const filteredStudents = useMemo(() => {
    const query = globalSearch;
    return students
      .filter(
        (student) =>
          !query ||
          searchAny(query, [
            student.name,
            student.code,
            student.phone,
            student.parentPhone,
            student.telegram,
            student.school,
            student.subSite,
            student.studyType,
          ]),
      )
      .slice(0, 20);
  }, [students, globalSearch]);

  const selectedLeaveStudent = students.find(
    (student) => student.id === leaveStudentId,
  );
  const selectedProfileStudent =
    students.find((student) => student.id === profileStudentId) || null;
  const selectedCallExam = exams.find((exam) => exam.id === callExamId) || null;
  const callExportDocumentTitle = selectedCallExam?.name || "كل الامتحانات";
  const callExportFileName = selectedCallExam?.name || "المكالمات-كل-الامتحانات";
  const leaveReason =
    leaveReasonChoice === "أخرى" ? customLeaveReason.trim() : leaveReasonChoice;

  const leaveAppliesToExam = (
    leave: {
      studentId: string;
      examId?: string;
      leaveType?: string;
      date?: string;
      dateFrom?: string;
      dateTo?: string;
    },
    studentId: string,
    exam: Exam,
  ) => {
    if (leave.studentId !== studentId) return false;
    if ((leave.leaveType || "exam") === "period") {
      const examDate = dayKey(exam.date);
      const from = dayKey(leave.dateFrom || leave.date);
      const to = dayKey(leave.dateTo || leave.dateFrom || leave.date);
      return Boolean(
        examDate && from && to && examDate >= from && examDate <= to,
      );
    }
    return leave.examId === exam.id;
  };

  const dismissalGroupFromType = (
    type: string | null | undefined,
  ): "temporary" | "final" => {
    const text = String(type || "");
    if (text.includes("نهائي") || text.includes("دائم")) return "final";
    return "temporary";
  };

  const dismissalGroup = (student: Student): "temporary" | "final" | null => {
    if (student.status !== "مفصول") return null;
    return dismissalGroupFromType(student.dismissalType || "فصل مؤقت");
  };

  const callLogLookup = useMemo(() => {
    const map = new Map<string, (typeof studentCalls)[number]>();
    studentCalls.forEach((call) => {
      const key = `${call.studentId}::${String(call.examId || "")}::${call.category}`;
      if (!map.has(key)) map.set(key, call);
    });
    return map;
  }, [studentCalls]);

  const callLogForGrade = (student: Student, item: CallGradeItem) => {
    const exactKey = `${student.id}::${item.exam.id}::${item.callKey}`;
    const legacyKey = `${student.id}::${item.exam.id}::${item.category}`;
    return callLogLookup.get(exactKey) || callLogLookup.get(legacyKey);
  };

  const callLogForRow = (row: CallStudentRow) =>
    callLogForGrade(row.student, row.focusItem);

  const callStatusForLog = (
    call: ReturnType<typeof callLogForRow>,
  ): ContactStatus => {
    if (!call) return "";
    const value = String(call.status || "") as ContactStatus;
    if (value === "تم الاتصال" || value === "لم يرد" || value === "الرقم خاطئ")
      return value;
    return call.completed ? "تم الاتصال" : "";
  };

  const callStudentNoteLookup = useMemo(() => {
    const map = new Map<string, (typeof studentCalls)[number]>();
    studentCalls.forEach((call) => {
      if (call.category === CALL_STUDENT_NOTE_CATEGORY)
        map.set(call.studentId, call);
    });
    return map;
  }, [studentCalls]);

  const callNoteForStudent = (studentId: string) =>
    callStudentNoteLookup.get(studentId);

  const gradeCallInfo = (
    grade: Grade,
    exam: Exam,
  ): Pick<CallGradeItem, "category" | "label" | "reason"> => {
    if (grade.status === "غائب") {
      return {
        category: "absent",
        label: callCategoryLabels.absent,
        reason: "غائب عن الامتحان",
      };
    }
    if (grade.status === "غش") {
      return {
        category: "cheating",
        label: callCategoryLabels.cheating,
        reason: "مسجل بحالة غش",
      };
    }
    if (grade.status === "درجة" && grade.score !== null) {
      const score = Number(grade.score);
      if (Number.isFinite(score)) {
        if (score < exam.passMark) {
          return {
            category: "failed",
            label: callCategoryLabels.failed,
            reason: `راسب: ${score}/${exam.fullMark}`,
          };
        }
        if (score === exam.fullMark) {
          return {
            category: "full",
            label: callCategoryLabels.full,
            reason: `درجة كاملة: ${score}/${exam.fullMark}`,
          };
        }
        if (
          score >= exam.passMark &&
          score <= Math.round(exam.fullMark * 0.7)
        ) {
          return {
            category: "low-pass",
            label: callCategoryLabels["low-pass"],
            reason: `ناجح بدرجة منخفضة: ${score}/${exam.fullMark}`,
          };
        }
        return {
          category: "passed",
          label: callCategoryLabels.passed,
          reason: `ناجح: ${score}/${exam.fullMark}`,
        };
      }
    }
    return {
      category: "passed",
      label: "درجة مسجلة",
      reason: formatGradeScore(grade, exam, "—"),
    };
  };

  const callRows = useMemo<CallStudentRow[]>(() => {
    const studentById = new Map<string, Student>(
      students.map((student) => [student.id, student] as [string, Student]),
    );
    const examById = new Map<string, Exam>(
      exams.map((exam) => [exam.id, exam] as [string, Exam]),
    );
    const grouped = new Map<
      string,
      { student: Student; items: CallGradeItem[] }
    >();

    grades.forEach((grade) => {
      const student = studentById.get(grade.studentId);
      const exam = examById.get(grade.examId);
      if (!student || !exam) return;
      const cls = classification(grade, exam, student);

      // الحالات غير المحتسبة أكاديمياً تبقى محفوظة في سجل الدرجات،
      // لكنها لا تدخل قائمة المكالمات حتى لا يتم الاتصال بطالب داخل السماح أو خارج نطاق الامتحان.
      if (nonCallableGradeKinds.has(cls.kind)) return;

      const info = gradeCallInfo(grade, exam);
      const item: CallGradeItem = {
        id: `grade:${grade.id}`,
        callKey: `grade:${grade.id}`,
        exam,
        grade,
        ...info,
        sortTime: gradeTimeValue(grade, exam),
      };
      const current = grouped.get(student.id) ?? {
        student,
        items: [] as CallGradeItem[],
      };
      current.items.push(item);
      grouped.set(student.id, current);
    });

    const rows = Array.from(grouped.values())
      .flatMap<CallStudentRow>(({ student, items }) => {
        const sortedItems = sortGradeItemsByLatest(items);
        const relevantItems = sortedItems.filter((item) => {
          if (callExamId && item.exam.id !== callExamId) return false;
          const cls = classification(item.grade, item.exam, student);
          if (nonCallableGradeKinds.has(cls.kind)) return false;
          if (
            !gradeMatchesStatusFilter(
              callGradeStatusFilter,
              item.grade,
              item.exam,
              cls,
            )
          )
            return false;
          return true;
        });
        if (relevantItems.length === 0) return [];
        if (!matchesArabicLetterFilter(student.name, callNameLetter)) return [];
        const focusItem = relevantItems[0] || sortedItems[0];
        return [
          {
            id: `student:${student.id}`,
            student,
            items: sortedItems,
            focusItem,
          },
        ];
      })
      .filter(
        (row) =>
          !callSearch ||
          searchAny(callSearch, [
            row.student.name,
            row.student.code,
            row.student.phone,
            row.student.parentPhone,
            row.student.telegram,
            row.student.school,
            row.student.status,
            row.student.studyType,
            ...row.items.flatMap((item) => [
              item.exam.name,
              item.grade.status,
              formatGradeScore(item.grade, item.exam, "—"),
              item.reason,
              item.grade.notes,
              callStatusForLog(callLogForGrade(row.student, item)),
            ]),
            callNoteForStudent(row.student.id)?.notes,
          ]),
      );

    return rows.sort((a, b) => {
      const studentA = a.student.name || "";
      const studentB = b.student.name || "";
      const examA = `${a.focusItem.exam.name || ""} ${a.focusItem.exam.date || ""}`;
      const examB = `${b.focusItem.exam.name || ""} ${b.focusItem.exam.date || ""}`;
      if (callGradeSort === "name") {
        return (
          studentA.localeCompare(studentB, "ar") ||
          examA.localeCompare(examB, "ar")
        );
      }
      if (callGradeSort === "score-desc") {
        return (
          gradeScoreForSort(b.focusItem.grade, "desc") -
            gradeScoreForSort(a.focusItem.grade, "desc") ||
          studentA.localeCompare(studentB, "ar") ||
          examA.localeCompare(examB, "ar")
        );
      }
      if (callGradeSort === "score-asc") {
        return (
          gradeScoreForSort(a.focusItem.grade, "asc") -
            gradeScoreForSort(b.focusItem.grade, "asc") ||
          studentA.localeCompare(studentB, "ar") ||
          examA.localeCompare(examB, "ar")
        );
      }
      if (callGradeSort === "exam") {
        return (
          examA.localeCompare(examB, "ar") ||
          studentA.localeCompare(studentB, "ar")
        );
      }
      return (
        b.focusItem.sortTime - a.focusItem.sortTime ||
        examA.localeCompare(examB, "ar") ||
        studentA.localeCompare(studentB, "ar")
      );
    });
  }, [
    grades,
    students,
    exams,
    callExamId,
    callGradeStatusFilter,
    callNameLetter,
    callSearch,
    callGradeSort,
    callLogLookup,
    callStudentNoteLookup,
    classification,
  ]);

  const callTotalPages = Math.max(
    1,
    Math.ceil(callRows.length / CALL_PAGE_SIZE),
  );
  const callSafePage = Math.min(callGradePage, callTotalPages);
  const visibleCallRows = callRows.slice(
    (callSafePage - 1) * CALL_PAGE_SIZE,
    callSafePage * CALL_PAGE_SIZE,
  );

  const callStats = useMemo(() => {
    const rowsWithCalls = callRows.map((row) => ({
      row,
      call: callLogForRow(row),
    }));
    return {
      total: callRows.length,
      contacted: rowsWithCalls.filter(
        ({ call }) => callStatusForLog(call) === "تم الاتصال",
      ).length,
      unanswered: rowsWithCalls.filter(
        ({ call }) => callStatusForLog(call) === "لم يرد",
      ).length,
      wrong: rowsWithCalls.filter(
        ({ call }) => callStatusForLog(call) === "الرقم خاطئ",
      ).length,
      noAction: rowsWithCalls.filter(
        ({ call }) => callStatusForLog(call) === "",
      ).length,
    };
  }, [callRows, callLogLookup]);

  const dismissalInfoForStudent = (
    student: Student,
  ): DismissalLinkInfo | null => {
    if (student.status !== "مفصول") return null;
    const type = student.dismissalType || "فصل مؤقت";
    const reason = student.dismissalReason || type || "طالب مفصول";
    const normalizedReason = normalizeDismissalText(reason);
    const dismissalLogs = opportunityLogs
      .filter((log) => log.studentId === student.id)
      .filter((log) => {
        const rawReason = String(log.reason || "");
        const logReason = normalizeDismissalText(rawReason);
        return (
          log.action === "فصل تلقائي" ||
          (log.action === "خصم" && rawReason.startsWith("فصل الطالب")) ||
          (normalizedReason && logReason.includes(normalizedReason))
        );
      })
      .sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));
    const sourceLog =
      dismissalLogs.find((log) => log.action === "فصل تلقائي") ||
      dismissalLogs[0];
    const sourceNote = sourceLog
      ? undefined
      : studentNotes
          .filter(
            (note) => note.studentId === student.id && note.kind === "إجراء",
          )
          .filter((note) => {
            const noteText = normalizeDismissalText(note.text);
            return (
              note.text.includes("فصل الطالب") ||
              (normalizedReason && noteText.includes(normalizedReason))
            );
          })
          .sort((a, b) =>
            String(b.date || "").localeCompare(String(a.date || "")),
          )[0];
    const sourceExam = sourceLog?.examId
      ? exams.find((exam) => exam.id === sourceLog.examId)
      : undefined;
    const sourceType = sourceLog
      ? "opportunity-log"
      : sourceNote
        ? "student-note"
        : "student-dismissal";
    const sourceId = sourceLog?.id || sourceNote?.id || student.id;
    const date = dayKey(
      sourceLog?.date || sourceNote?.date || student.createdAt,
    );
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

  const dismissalInfoFromPledgeNote = (
    student: Student,
    note: StudentNote,
  ): DismissalLinkInfo => {
    const sourceLog =
      note.sourceType === "opportunity-log" && note.sourceId
        ? opportunityLogs.find((log) => log.id === note.sourceId)
        : undefined;
    const sourceExam = sourceLog?.examId
      ? exams.find((exam) => exam.id === sourceLog.examId)
      : undefined;
    const type = note.dismissalType || "فصل مؤقت";
    const reason = note.dismissalReason || note.text || type;
    const sourceType = note.sourceType || "pledge-note";
    const sourceId = note.sourceId || note.id;
    const date = dayKey(note.dismissalDate || sourceLog?.date || note.date);
    const key =
      note.dismissalKey ||
      buildDismissalKey({
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

  const pledgeNotes = useMemo(
    () => studentNotes.filter((note) => note.kind === PLEDGE_NOTE_KIND),
    [studentNotes],
  );

  const pledgeNoteForDismissal = (
    student: Student,
    dismissalInfo = dismissalInfoForStudent(student),
  ) => {
    if (!dismissalInfo) return undefined;
    return pledgeNotes.find((note) => {
      if (note.studentId !== student.id) return false;
      if (note.dismissalKey) return note.dismissalKey === dismissalInfo.key;
      if (note.sourceType && note.sourceId)
        return (
          note.sourceType === dismissalInfo.sourceType &&
          note.sourceId === dismissalInfo.sourceId
        );
      const noteReason = normalizeDismissalText(
        note.dismissalReason || note.text,
      );
      return (
        note.text.includes(student.dismissalType || "فصل") &&
        (!noteReason ||
          noteReason.includes(normalizeDismissalText(dismissalInfo.reason)) ||
          normalizeDismissalText(dismissalInfo.reason).includes(noteReason))
      );
    });
  };

  const pledgeRows = useMemo<PledgeRow[]>(() => {
    const rows: PledgeRow[] = [];
    const seen = new Set<string>();

    students
      .filter((student) => student.status === "مفصول")
      .forEach((student) => {
        const dismissalInfo = dismissalInfoForStudent(student);
        if (!dismissalInfo) return;
        const note = pledgeNoteForDismissal(student, dismissalInfo);
        const key = note?.dismissalKey || dismissalInfo.key;
        seen.add(key);
        rows.push({
          key,
          student,
          dismissalInfo,
          group: dismissalGroupFromType(dismissalInfo.type),
          pledged: Boolean(note),
          note,
          reactivated: false,
        });
      });

    pledgeNotes.forEach((note) => {
      const student = students.find((item) => item.id === note.studentId);
      if (!student) return;
      const dismissalInfo = dismissalInfoFromPledgeNote(student, note);
      const key = note.dismissalKey || dismissalInfo.key || note.id;
      if (seen.has(key)) return;
      seen.add(key);
      rows.push({
        key,
        student,
        dismissalInfo,
        group: dismissalGroupFromType(note.dismissalType || dismissalInfo.type),
        pledged: true,
        note,
        reactivated: student.status !== "مفصول",
      });
    });

    return rows
      .filter((row) => {
        if (pledgeTypeFilter === "temporary" && row.group !== "temporary")
          return false;
        if (pledgeTypeFilter === "final" && row.group !== "final") return false;
        if (pledgeStatusFilter === "pledged" && !row.pledged) return false;
        if (pledgeStatusFilter === "pending" && row.pledged) return false;
        if (pledgeStatusFilter === "reactivated" && !row.reactivated)
          return false;
        return (
          !pledgeSearch ||
          searchAny(pledgeSearch, [
            row.student.name,
            row.student.code,
            row.student.phone,
            row.student.parentPhone,
            row.dismissalInfo.type,
            row.dismissalInfo.reason,
            row.note?.text,
            row.student.status,
          ])
        );
      })
      .sort((a, b) =>
        `${a.pledged ? 1 : 0}-${a.group === "temporary" ? 0 : 1}-${a.student.name}`.localeCompare(
          `${b.pledged ? 1 : 0}-${b.group === "temporary" ? 0 : 1}-${b.student.name}`,
          "ar",
        ),
      );
  }, [
    students,
    pledgeNotes,
    opportunityLogs,
    exams,
    pledgeSearch,
    pledgeTypeFilter,
    pledgeStatusFilter,
  ]);

  const pledgeStats = useMemo(() => {
    const dismissed = students.filter((student) => student.status === "مفصول");
    const temporary = dismissed.filter(
      (student) => dismissalGroup(student) === "temporary",
    ).length;
    const final = dismissed.filter(
      (student) => dismissalGroup(student) === "final",
    ).length;
    const pending = dismissed.filter(
      (student) => !pledgeNoteForDismissal(student),
    ).length;
    const pledged = pledgeNotes.filter((note) =>
      students.some((student) => student.id === note.studentId),
    ).length;
    const reactivated = pledgeNotes.filter((note) =>
      students.some(
        (student) =>
          student.id === note.studentId && student.status !== "مفصول",
      ),
    ).length;
    return {
      dismissed: dismissed.length,
      temporary,
      final,
      pledged,
      pending,
      reactivated,
    };
  }, [students, pledgeNotes, opportunityLogs, exams]);

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
      if (leaveMode === "exam")
        return (
          (leave.leaveType || "exam") === "exam" && leave.examId === leaveExamId
        );
      return (
        (leave.leaveType || "exam") === "period" &&
        dayKey(leave.dateFrom || leave.date) === from &&
        dayKey(leave.dateTo || leave.dateFrom || leave.date) === to
      );
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
      return Boolean(
        exam &&
        leaveAppliesToExam(
          {
            studentId: leaveStudentId,
            leaveType: "period",
            dateFrom: from,
            dateTo: to,
          },
          leaveStudentId,
          exam,
        ),
      );
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
      date: leaveMode === "exam" ? leaveDate || todayISO() : from,
      dateFrom: leaveMode === "exam" ? leaveDate || todayISO() : from,
      dateTo: leaveMode === "exam" ? leaveDate || todayISO() : to,
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
        removedGradeMessages.length > 1
          ? { description: removedGradeMessages.join(" | ") }
          : undefined,
      );
    } else {
      toast.success(
        leaveMode === "period"
          ? "تمت إضافة الإجازة للفترة وإلغاء محاسبة امتحاناتها"
          : "تمت إضافة الإجازة وإعادة احتساب الطالب بدون محاسبة هذا الامتحان",
      );
    }
  };

  const callExportRows = callRows.map((row) => ({
    row,
    status: callStatusForLog(callLogForRow(row)),
    note: callNoteForStudent(row.student.id)?.notes || "",
    courseName,
  }));

  const saveCallStatus = (row: CallStudentRow, status: ContactStatus) => {
    const item = row.focusItem;
    const existing = callLogForGrade(row.student, item);
    if (!status && !existing) return;
    const completed = status === "تم الاتصال";
    const payload = {
      studentId: row.student.id,
      examId: item.exam?.id || "",
      category: item.callKey,
      target: item.label,
      phone: [row.student.phone, row.student.parentPhone]
        .filter(Boolean)
        .join(" / "),
      status,
      completed,
      completedAt: completed ? todayISO() : "",
      notes:
        existing?.notes ||
        `${item.reason} | ${item.exam.name} | ${formatGradeScore(item.grade, item.exam, "—")}`,
    };
    if (existing) updateStudentCall(existing.id, payload);
    else addStudentCall(payload);
  };

  const saveCallStudentNote = (row: CallStudentRow, notes: string) => {
    const existing = callNoteForStudent(row.student.id);
    const payload = {
      studentId: row.student.id,
      examId: "",
      category: CALL_STUDENT_NOTE_CATEGORY,
      target: "ملاحظات المكالمات",
      phone: [row.student.phone, row.student.parentPhone]
        .filter(Boolean)
        .join(" / "),
      status: "" as ContactStatus,
      completed: false,
      completedAt: "",
      notes,
    };
    if (existing) updateStudentCall(existing.id, payload);
    else if (notes.trim()) addStudentCall(payload);
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
        <Input
          id="follow-up-global-search"
          name="search"
          data-teacherpro-search="true"
          value={globalSearch}
          onChange={(event) => setGlobalSearch(event.target.value)}
          placeholder="اسم / كود / هاتف / مدرسة"
        />
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
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => openProfile(selectedLeaveStudent.id)}
            >
              ملف الطالب
            </Button>
            <Badge variant="secondary">
              عدد فرص الطالب: {studentOpportunityText(selectedLeaveStudent)}
            </Badge>
          </div>
        )}
      </div>
    );
  };

  const renderLeaveList = () => (
    <Card>
      <CardHeader>
        <CardTitle>الإجازات السابقة</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {studentLeaves.length === 0 ? (
          <p className="empty-state py-6">لا توجد إجازات مسجلة</p>
        ) : (
          studentLeaves.map((leave) => {
            const student = students.find(
              (item) => item.id === leave.studentId,
            );
            const exam = exams.find((item) => item.id === leave.examId);
            const isPeriod = (leave.leaveType || "exam") === "period";
            return (
              <div
                key={leave.id}
                className="grid gap-2 rounded-2xl border bg-card/80 p-3 text-sm lg:grid-cols-[1.1fr_1fr_1.4fr_1fr_auto] lg:items-center"
              >
                <b>{student?.name || "طالب محذوف"}</b>
                <span>{leave.reason}</span>
                <span>
                  {isPeriod
                    ? `فترة: ${formatAppDate(leave.dateFrom || leave.date)} إلى ${formatAppDate(leave.dateTo || leave.dateFrom || leave.date)}`
                    : exam?.name || "امتحان محذوف"}
                </span>
                <span>{leave.studyType || student?.studyType || "—"}</span>
                <div className="flex items-center justify-end gap-2">
                  <Badge variant={isPeriod ? "secondary" : "outline"}>
                    {isPeriod ? "فترة زمنية" : "حسب الامتحان"}
                  </Badge>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => deleteStudentLeave(leave.id)}
                  >
                    حذف
                  </Button>
                </div>
              </div>
            );
          })
        )}
      </CardContent>
    </Card>
  );

  const renderPhoneLink = (label: string, phone?: string) => {
    const digits = phoneForWhatsApp(phone);
    if (!digits) {
      return (
        <span className="rounded-xl border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
          {label}: لا يوجد رقم
        </span>
      );
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

  const renderTelegramLink = (telegram?: string) => {
    const normalizedTelegram = normalizeTelegramIdentifier(telegram || "");
    if (!normalizedTelegram) {
      return (
        <span className="rounded-xl border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
          التلكرام: لا يوجد معرف
        </span>
      );
    }
    return (
      <a
        className="rounded-xl border bg-card px-3 py-2 text-xs font-bold text-sky-700 underline dark:text-sky-300"
        href={telegramLink(normalizedTelegram)}
        target="_blank"
        rel="noreferrer"
      >
        التلكرام: {normalizedTelegram}
      </a>
    );
  };

  const renderCallGradeChip = (row: CallStudentRow, item: CallGradeItem) => {
    const isFocus = item.id === row.focusItem.id;
    const call = callLogForGrade(row.student, item);
    const value =
      item.category === "absent"
        ? "غائب"
        : formatGradeScore(item.grade, item.exam, "—");
    return (
      <div
        key={item.id}
        className={`rounded-2xl border px-3 py-2 text-xs ${isFocus ? "border-primary bg-primary/10" : "bg-muted/35"}`}
      >
        <div className="flex flex-wrap items-center gap-2">
          <b>{item.exam.name}</b>
          {isFocus ? <Badge>آخر/محور المتابعة</Badge> : null}
          <Badge
            variant={
              item.category === "absent" ||
              item.category === "failed" ||
              item.category === "cheating"
                ? "destructive"
                : "secondary"
            }
          >
            {item.label}
          </Badge>
        </div>
        <p className="mt-1 text-muted-foreground">
          {formatAppDate(item.exam.date)} - الدرجة:{" "}
          <span className="font-bold text-foreground">{value}</span>
        </p>
        {item.category !== "absent" ? (
          <p className="mt-1 text-muted-foreground">{item.reason}</p>
        ) : null}
        {call ? (
          <p className="mt-1 text-muted-foreground">
            التواصل: {callStatusForLog(call) || "بدون إجراء"}
          </p>
        ) : null}
        {item.grade.notes ? (
          <p className="mt-1 rounded-xl border border-amber-200/70 bg-amber-50 px-2 py-1 text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/25 dark:text-amber-100">
            {item.grade.notes}
          </p>
        ) : null}
      </div>
    );
  };

  const renderCallRow = (row: CallStudentRow) => {
    const item = row.focusItem;
    const call = callLogForRow(row);
    const contactStatus = callStatusForLog(call);
    const callStudentNote = callNoteForStudent(row.student.id);
    const focusValue =
      item.category === "absent"
        ? "غائب"
        : formatGradeScore(item.grade, item.exam, "—");
    return (
      <div
        key={row.id}
        className="grid gap-3 rounded-2xl border bg-card/80 p-3 text-sm xl:grid-cols-[1.1fr_1.45fr_1fr_190px_auto] xl:items-start"
      >
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <b>{row.student.name}</b>
            <Badge variant="outline">{row.student.code}</Badge>
            <Badge
              variant={
                row.student.status === "نشط" ? "secondary" : "destructive"
              }
            >
              حالة الطالب: {row.student.status}
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground">
            {courseName(row.student.courseId)} - {row.student.studyType || "—"}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            عدد الدرجات المعروضة لهذا الطالب: <b>{row.items.length}</b>
          </p>
        </div>
        <div className="space-y-2">
          <div className="rounded-2xl border border-primary/30 bg-primary/5 p-3">
            <p className="text-xs text-muted-foreground">
              آخر امتحان / محور المتابعة الحالي
            </p>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <b>{item.exam.name}</b>
              <Badge
                variant={
                  item.category === "absent" ||
                  item.category === "failed" ||
                  item.category === "cheating"
                    ? "destructive"
                    : "secondary"
                }
              >
                {item.label}
              </Badge>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              {formatAppDate(item.exam.date)} - الدرجة:{" "}
              <span className="font-bold text-foreground">{focusValue}</span>
            </p>
            {item.category !== "absent" ? (
              <p className="mt-1 text-xs text-muted-foreground">
                {item.reason}
              </p>
            ) : null}
          </div>
          <div className="space-y-2">
            <p className="text-xs font-bold text-muted-foreground">
              كل درجات الطالب
            </p>
            <div className="grid gap-2 md:grid-cols-2">
              {row.items.map((gradeItem) =>
                renderCallGradeChip(row, gradeItem),
              )}
            </div>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {renderPhoneLink("رقم الطالب", row.student.phone)}
          {renderPhoneLink("رقم ولي الأمر", row.student.parentPhone)}
          {renderTelegramLink(row.student.telegram)}
        </div>
        <div className="space-y-2">
          <Label className="text-xs text-muted-foreground">
            إجراء التواصل للامتحان المحور
          </Label>
          <Select
            value={contactStatusSelectValue(contactStatus)}
            onValueChange={(value) =>
              saveCallStatus(row, contactStatusFromSelectValue(value))
            }
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {contactStatusOptions.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div
            className={`rounded-xl border px-3 py-2 text-xs font-bold ${contactStatusClasses(contactStatus)}`}
          >
            {contactStatus || "بدون إجراء"}
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">
              ملاحظات الطالب في المكالمات
            </Label>
            <textarea
              className="min-h-20 w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
              defaultValue={callStudentNote?.notes || ""}
              onBlur={(event) => saveCallStudentNote(row, event.target.value)}
              placeholder="ملاحظة ثابتة تظهر لهذا الطالب داخل المكالمات"
            />
          </div>
          {call?.completedAt ? (
            <p className="text-xs text-muted-foreground">
              آخر تواصل: {formatAppDate(call.completedAt)}
            </p>
          ) : null}
        </div>
        <div className="flex items-center justify-end">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => openProfile(row.student.id)}
          >
            ملف الطالب
          </Button>
        </div>
      </div>
    );
  };

  const togglePledge = (row: PledgeRow, checked: boolean) => {
    const { student, dismissalInfo } = row;
    const existing = row.note || pledgeNoteForDismissal(student, dismissalInfo);
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
      reactivateStudent(student.id);
      toast.success(
        "تم تثبيت التعهد وإعادة تفعيل الطالب حسب شروط إعادة التفعيل. ستجده بعد ذلك من فلتر: تم التعهد / تم التعهد وإعادة التفعيل.",
      );
      return;
    }
    if (existing) {
      studentNotes
        .filter(
          (note) =>
            note.studentId === student.id && note.kind === PLEDGE_NOTE_KIND,
        )
        .filter((note) => {
          if (existing.id && note.id === existing.id) return true;
          if (note.dismissalKey) return note.dismissalKey === dismissalInfo.key;
          if (note.sourceType && note.sourceId)
            return (
              note.sourceType === dismissalInfo.sourceType &&
              note.sourceId === dismissalInfo.sourceId
            );
          return false;
        })
        .forEach((note) => deleteStudentNote(note.id));
      toast.success("تم إلغاء التعهد المرتبط بهذا الفصل فقط");
    }
  };

  const renderPledgeRow = (row: PledgeRow) => {
    const { student, dismissalInfo, group, pledged, reactivated } = row;
    return (
      <div
        key={row.key}
        className="grid gap-3 rounded-2xl border bg-card/80 p-3 text-sm xl:grid-cols-[1.2fr_1fr_1.7fr_1.2fr_190px_auto] xl:items-center"
      >
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <b>{student.name}</b>
            <Badge variant="outline">{student.code}</Badge>
            {reactivated ? (
              <Badge variant="default">تم التعهد وإعادة التفعيل</Badge>
            ) : null}
          </div>
          <p className="text-xs text-muted-foreground">
            {courseName(student.courseId)} - {student.studyType || "—"}
          </p>
        </div>
        <div className="space-y-1">
          <Badge variant={group === "final" ? "destructive" : "secondary"}>
            {dismissalInfo.type || "فصل مؤقت"}
          </Badge>
          <p className="text-xs text-muted-foreground">
            حالة الطالب الآن: {student.status}
          </p>
          {dismissalInfo.date ? (
            <p className="text-xs text-muted-foreground">
              تاريخ الفصل: {formatAppDate(dismissalInfo.date)}
            </p>
          ) : null}
        </div>
        <div className="space-y-1">
          <p className="text-xs leading-6 text-muted-foreground">
            {dismissalInfo.reason || "لا يوجد سبب فصل مسجل"}
          </p>
          <p className="rounded-xl bg-muted/50 px-2 py-1 text-[11px] text-muted-foreground">
            الربط:{" "}
            {dismissalInfo.sourceType === "opportunity-log"
              ? "سجل فرص/فصل"
              : dismissalInfo.sourceType === "student-note"
                ? "ملاحظة إجراء الفصل"
                : dismissalInfo.sourceType === "pledge-note"
                  ? "تعهد محفوظ"
                  : "ملف الفصل الحالي"}
            {dismissalInfo.examName ? ` - ${dismissalInfo.examName}` : ""}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {renderPhoneLink("رقم الطالب", student.phone)}
          {renderPhoneLink("رقم ولي الأمر", student.parentPhone)}
        </div>
        <label className="flex cursor-pointer items-center justify-between gap-3 rounded-2xl border bg-muted/30 px-3 py-2">
          <span className="text-sm font-bold">التعهد</span>
          <Checkbox
            checked={pledged}
            onCheckedChange={(value) => togglePledge(row, Boolean(value))}
          />
        </label>
        <div className="flex items-center justify-end">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => openProfile(student.id)}
          >
            ملف الطالب
          </Button>
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
          <p className="text-sm text-muted-foreground">
            {viewTitles[view].description}
          </p>
        </CardHeader>
      </Card>

      {view === "leaves" && (
        <div className="grid gap-4 xl:grid-cols-[420px_1fr]">
          <Card>
            <CardHeader>
              <CardTitle>إضافة إجازة</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {renderStudentPicker()}
              <div className="space-y-2">
                <Label>نوع الإجازة</Label>
                <Select
                  value={leaveMode}
                  onValueChange={(value) => setLeaveMode(value as LeaveMode)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="exam">حسب الامتحان</SelectItem>
                    <SelectItem value="period">فترة زمنية</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {leaveMode === "exam" ? (
                <>
                  <div className="space-y-2">
                    <Label>الامتحان</Label>
                    <Select value={leaveExamId} onValueChange={setLeaveExamId}>
                      <SelectTrigger>
                        <SelectValue placeholder="اختر الامتحان" />
                      </SelectTrigger>
                      <SelectContent>
                        {exams.map((exam) => (
                          <SelectItem key={exam.id} value={exam.id}>
                            {exam.name} - {formatAppDate(exam.date)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>تاريخ الإجازة</Label>
                    <DateInput value={leaveDate} onChange={setLeaveDate} />
                  </div>
                </>
              ) : (
                <div className="grid gap-3 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label>من</Label>
                    <DateInput
                      value={leaveDateFrom}
                      onChange={setLeaveDateFrom}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>إلى</Label>
                    <DateInput value={leaveDateTo} onChange={setLeaveDateTo} />
                  </div>
                </div>
              )}
              <div className="space-y-2">
                <Label>سبب الإجازة</Label>
                <Select
                  value={leaveReasonChoice}
                  onValueChange={(value) =>
                    setLeaveReasonChoice(value as LeaveReasonOption)
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {leaveReasonOptions.map((reason) => (
                      <SelectItem key={reason} value={reason}>
                        {reason}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {leaveReasonChoice === "أخرى" && (
                <div className="space-y-2">
                  <Label>السبب اليدوي</Label>
                  <Input
                    value={customLeaveReason}
                    onChange={(event) =>
                      setCustomLeaveReason(event.target.value)
                    }
                    placeholder="اكتب سبب الإجازة"
                  />
                </div>
              )}
              <div className="space-y-2">
                <Label>ملاحظات</Label>
                <Input
                  value={leaveNotes}
                  onChange={(event) => setLeaveNotes(event.target.value)}
                  placeholder="اختياري"
                />
              </div>
              {selectedLeaveStudent && (
                <p className="rounded-xl bg-muted/50 p-2 text-xs text-muted-foreground">
                  نوع الدراسة: <b>{selectedLeaveStudent.studyType || "—"}</b>
                </p>
              )}
              <Button className="w-full" onClick={saveLeave}>
                حفظ الإجازة
              </Button>
            </CardContent>
          </Card>
          {renderLeaveList()}
        </div>
      )}

      {view === "calls" && (
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>المكالمات المرتبطة بسجل الدرجات</CardTitle>
              <p className="text-sm text-muted-foreground">
                كل صف هنا طالب واحد فقط، وداخله كل درجاته، مع إبراز آخر امتحان
                نزلت له درجة أو الامتحان المختار من الفلتر.
              </p>
            </CardHeader>
            <CardContent className="grid gap-3 p-4 md:grid-cols-5">
              <div className="space-y-2">
                <Label>الامتحان</Label>
                <Select
                  value={callExamId || "all"}
                  onValueChange={(value) => {
                    setCallExamId(value === "all" ? "" : value);
                    setCallGradePage(1);
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="كل الامتحانات" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">كل الامتحانات</SelectItem>
                    {exams.map((exam) => (
                      <SelectItem key={exam.id} value={exam.id}>
                        {exam.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>حالة الدرجة</Label>
                <Select
                  value={callGradeStatusFilter}
                  onValueChange={(value) => {
                    setCallGradeStatusFilter(value as GradeStatusFilter);
                    setCallGradePage(1);
                  }}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {callGradeStatusFilterOptions.map((option) => (
                      <SelectItem key={option} value={option}>
                        {gradeStatusFilterLabels[option]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>فلترة الاسم أبجدياً</Label>
                <Select
                  value={callNameLetter}
                  onValueChange={(value) => {
                    setCallNameLetter(value);
                    setCallGradePage(1);
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="كل الأحرف" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">كل الأحرف</SelectItem>
                    {buildArabicLetterOptions(
                      students.map((student) => student.name),
                    ).map((letter) => (
                      <SelectItem key={letter} value={letter}>
                        {letter}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>الفرز</Label>
                <Select
                  value={callGradeSort}
                  onValueChange={(value) => {
                    setCallGradeSort(value as CallGradeSort);
                    setCallGradePage(1);
                  }}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(Object.keys(callGradeSortLabels) as CallGradeSort[]).map(
                      (key) => (
                        <SelectItem key={key} value={key}>
                          {callGradeSortLabels[key]}
                        </SelectItem>
                      ),
                    )}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>بحث</Label>
                <Input
                  id="follow-up-calls-search"
                  name="search"
                  data-teacherpro-search="true"
                  value={callSearch}
                  onChange={(event) => {
                    setCallSearch(event.target.value);
                    setCallGradePage(1);
                  }}
                  placeholder="طالب / كود / امتحان / درجة / حالة طالب / إجراء تواصل"
                />
              </div>
              <div className="space-y-2">
                <Label>تصدير</Label>
                <ExportDialog
                  title="تصدير المكالمات"
                  fileName={callExportFileName}
                  rows={callExportRows}
                  columns={callExportColumns}
                  triggerLabel="تصدير"
                  description="تقرير المكالمات حسب الفلاتر الحالية"
                  pdfTitle={callExportDocumentTitle}
                  pdfFileName={callExportFileName}
                />
              </div>
            </CardContent>
          </Card>
          <div className="grid gap-3 md:grid-cols-5">
            <Card>
              <CardContent className="p-4">
                <p className="text-xs text-muted-foreground">
                  الطلاب المعروضون
                </p>
                <b className="text-2xl">{callStats.total}</b>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <p className="text-xs text-muted-foreground">تم الاتصال</p>
                <b className="text-2xl">{callStats.contacted}</b>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <p className="text-xs text-muted-foreground">لم يرد</p>
                <b className="text-2xl">{callStats.unanswered}</b>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <p className="text-xs text-muted-foreground">الرقم خاطئ</p>
                <b className="text-2xl">{callStats.wrong}</b>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <p className="text-xs text-muted-foreground">بدون إجراء</p>
                <b className="text-2xl">{callStats.noAction}</b>
              </CardContent>
            </Card>
          </div>
          <Card>
            <CardHeader>
              <CardTitle>قائمة الطلاب ودرجاتهم</CardTitle>
              <p className="text-sm text-muted-foreground">
                كل طالب يظهر مرة واحدة فقط؛ تعرض كل درجاته مع تركيز واضح على آخر
                امتحان نزلت له درجة أو الامتحان المختار.
              </p>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl bg-muted/40 px-3 py-2 text-sm">
                <span>
                  عدد الطلاب: <b>{callRows.length}</b>
                </span>
                <span>
                  الصفحة <b>{callSafePage}</b> من <b>{callTotalPages}</b>
                </span>
              </div>
              {visibleCallRows.length === 0 ? (
                <p className="empty-state py-8">
                  لا يوجد طلاب مطابقون للمكالمات والدرجات
                </p>
              ) : (
                visibleCallRows.map(renderCallRow)
              )}
              {callTotalPages > 1 && (
                <div className="flex items-center justify-center gap-2 pt-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={callSafePage <= 1}
                    onClick={() =>
                      setCallGradePage((page) => Math.max(1, page - 1))
                    }
                  >
                    السابق
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={callSafePage >= callTotalPages}
                    onClick={() =>
                      setCallGradePage((page) =>
                        Math.min(callTotalPages, page + 1),
                      )
                    }
                  >
                    التالي
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {view === "pledges" && (
        <div className="space-y-4">
          <div className="grid gap-3 md:grid-cols-6">
            <Card>
              <CardContent className="p-4">
                <p className="text-xs text-muted-foreground">المفصولون الآن</p>
                <b className="text-2xl">{pledgeStats.dismissed}</b>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <p className="text-xs text-muted-foreground">فصل مؤقت</p>
                <b className="text-2xl">{pledgeStats.temporary}</b>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <p className="text-xs text-muted-foreground">فصل نهائي</p>
                <b className="text-2xl">{pledgeStats.final}</b>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <p className="text-xs text-muted-foreground">تم التعهد</p>
                <b className="text-2xl">{pledgeStats.pledged}</b>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <p className="text-xs text-muted-foreground">
                  تم التعهد وإعادة التفعيل
                </p>
                <b className="text-2xl">{pledgeStats.reactivated}</b>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <p className="text-xs text-muted-foreground">بانتظار التعهد</p>
                <b className="text-2xl">{pledgeStats.pending}</b>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardContent className="grid gap-3 p-4 md:grid-cols-3">
              <div className="space-y-2">
                <Label>فرز الفصل</Label>
                <Select
                  value={pledgeTypeFilter}
                  onValueChange={(value) =>
                    setPledgeTypeFilter(value as PledgeTypeFilter)
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">كل ملفات الفصل</SelectItem>
                    <SelectItem value="temporary">طلبة الفصل المؤقت</SelectItem>
                    <SelectItem value="final">طلبة الفصل النهائي</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>حالة التعهد</Label>
                <Select
                  value={pledgeStatusFilter}
                  onValueChange={(value) =>
                    setPledgeStatusFilter(value as PledgeStatusFilter)
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">كل الحالات</SelectItem>
                    <SelectItem value="pledged">تم التعهد</SelectItem>
                    <SelectItem value="reactivated">
                      تم التعهد وإعادة التفعيل
                    </SelectItem>
                    <SelectItem value="pending">لم يتم التعهد</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>بحث</Label>
                <Input
                  id="follow-up-pledges-search"
                  name="search"
                  data-teacherpro-search="true"
                  value={pledgeSearch}
                  onChange={(event) => setPledgeSearch(event.target.value)}
                  placeholder="طالب / كود / سبب الفصل"
                />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>قائمة التعهدات</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {pledgeRows.length === 0 ? (
                <p className="empty-state py-8">لا توجد نتائج للتعهدات</p>
              ) : (
                pledgeRows.map(renderPledgeRow)
              )}
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
