"use client";

import React, { useEffect, useMemo, useState } from "react";
import {
  useTeacherStore,
  type Exam,
  type Grade,
  type Student,
  type StudentCall,
  type StudentNote,
} from "@/lib/teacher-store";
import {
  callCandidatesApi,
  callStatsApi,
  studentApi,
  type CallStatsResponse,
} from "@/lib/api";
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
import { useDebouncedValue } from "@/hooks/use-debounced-value";

type FollowView = "leaves" | "calls" | "pledges";
type CallCategory =
  | "absent"
  | "discounted"
  | "failed"
  | "low-pass"
  | "full"
  | "passed"
  | "cheating";
type CallStatusFilter =
  | "all"
  | "absent"
  | "discounted"
  | "failed"
  | "cheating"
  | "passed"
  | "full";
type CallGradeDisplayMode = "latest" | "latest-two" | "all";
type PledgeTypeFilter = "all" | "temporary" | "final";
type PledgeStatusFilter = "all" | "pledged" | "pending" | "reactivated";
type ContactStatus = "" | "تم الاتصال" | "لم يرد" | "الرقم خاطئ";

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
  focusItem: CallGradeItem | null;
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
  discounted: "مخصوم",
  failed: "راسب",
  "low-pass": "ناجح بدرجة منخفضة",
  full: "درجة كاملة",
  passed: "ناجح",
  cheating: "غش",
};

const callStatusFilterLabels: Record<CallStatusFilter, string> = {
  all: "كل الحالات",
  absent: "الغائبين",
  discounted: "المخصومين",
  failed: "الراسبين",
  cheating: "طلاب الغش",
  passed: "الطلاب الناجحين",
  full: "الدرجات الكاملة",
};

const callStatusFilterOptions = Object.keys(
  callStatusFilterLabels,
) as CallStatusFilter[];

const callGradeDisplayModeLabels: Record<CallGradeDisplayMode, string> = {
  latest: "آخر امتحان",
  "latest-two": "آخر امتحانين",
  all: "جميع الامتحانات",
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
const nonCallableGradeKinds = new Set([
  "grace",
  "before-registration",
  "excused",
]);

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
    value: ({ row }) => row.focusItem?.exam?.name || "",
  },
  {
    key: "gradeStatus",
    label: "حالة الدرجة",
    value: ({ row }) => row.focusItem?.label || "",
  },
  {
    key: "grade",
    label: "الدرجة",
    value: ({ row }) =>
      row.focusItem ? formatGradeScore(row.focusItem.grade, row.focusItem.exam, "—") : "",
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

function examIncludesCourse(exam: Exam, courseId: string) {
  return Boolean(courseId && Array.isArray(exam.courseIds) && exam.courseIds.includes(courseId));
}

function numericGradeScore(grade: Grade | null | undefined): number | null {
  if (!grade || grade.status !== "درجة") return null;
  const score = Number(grade.score);
  return Number.isFinite(score) ? score : null;
}

function callGradeMatchesStatusFilter(
  filter: CallStatusFilter,
  item: CallGradeItem | null,
): boolean {
  if (filter === "all") return true;
  if (!item) return false;
  const { grade, exam } = item;
  const score = numericGradeScore(grade);
  const fullMark = Number(exam.fullMark || 0);
  const passMark = Number(exam.passMark || 0);
  const discountMark = Number(exam.discountMark || 0);

  switch (filter) {
    case "absent":
      return grade.status === "غائب";
    case "cheating":
      return grade.status === "غش";
    case "full":
      return score !== null && score === fullMark;
    case "passed":
      return score !== null && score >= passMark;
    case "discounted":
      return score !== null && !exam.noDiscount && score <= discountMark;
    case "failed":
      if (score === null) return false;
      if (exam.noDiscount) return score >= 1 && score < passMark;
      return score >= 1 && score <= discountMark;
    default:
      return true;
  }
}

function visibleCallGradeItems(
  items: CallGradeItem[],
  mode: CallGradeDisplayMode,
): CallGradeItem[] {
  if (mode === "all") return items;
  if (mode === "latest-two") return items.slice(0, 2);
  return items.slice(0, 1);
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
    courses,
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
    mergeStudentsCache,
    mergeGradesCache,
  } = useTeacherStore();

  const [globalSearch, setGlobalSearch] = useState("");
  const debouncedGlobalSearch = useDebouncedValue(globalSearch, 180);

  useEffect(() => {
    if (view !== "leaves") return;
    let cancelled = false;

    studentApi
      .list({ q: debouncedGlobalSearch, pageSize: debouncedGlobalSearch.trim() ? 30 : 50 })
      .then((studentResult) => {
        if (cancelled) return;
        mergeStudentsCache((studentResult?.students || []) as unknown as Student[]);
      })
      .catch(() => {
        // الصفحة تستخدم آخر كاش متاح إذا فشل الاتصال المؤقت.
      });

    return () => {
      cancelled = true;
    };
  }, [view, debouncedGlobalSearch, mergeStudentsCache]);

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

  const [callCourseId, setCallCourseId] = useState("");
  const [callExamId, setCallExamId] = useState("");
  const [callStatusFilter, setCallStatusFilter] =
    useState<CallStatusFilter>("all");
  const [callGeneralSearch, setCallGeneralSearch] = useState("");
  const [callFilterSearch, setCallFilterSearch] = useState("");
  const [callGradePage, setCallGradePage] = useState(1);
  const [callLoading, setCallLoading] = useState(false);
  const [callPageStudentIds, setCallPageStudentIds] = useState<string[]>([]);
  const [callPageStudentCalls, setCallPageStudentCalls] = useState<StudentCall[]>([]);
  const [callServerPageInfo, setCallServerPageInfo] = useState({ totalCount: 0, totalPages: 1, hasMore: false });
  const [callDatabaseStats, setCallDatabaseStats] = useState<CallStatsResponse | null>(null);
  const [callDatabaseStatsLoading, setCallDatabaseStatsLoading] = useState(false);
  const [callGradeDisplayModes, setCallGradeDisplayModes] = useState<
    Record<string, CallGradeDisplayMode>
  >({});
  const [pledgeSearch, setPledgeSearch] = useState("");
  const [pledgeTypeFilter, setPledgeTypeFilter] =
    useState<PledgeTypeFilter>("all");
  const [pledgeStatusFilter, setPledgeStatusFilter] =
    useState<PledgeStatusFilter>("all");

  const [profileStudentId, setProfileStudentId] = useState("");
  const [profileDialogOpen, setProfileDialogOpen] = useState(false);

  useEffect(() => {
    setCallExamId("");
    setCallStatusFilter("all");
    setCallFilterSearch("");
    setCallGradePage(1);
    setCallGradeDisplayModes({});
  }, [callCourseId]);

  useEffect(() => {
    setCallStatusFilter("all");
    setCallFilterSearch("");
    setCallGradePage(1);
    setCallGradeDisplayModes({});
  }, [callExamId]);

  useEffect(() => {
    if (view !== "calls" || !callCourseId || !callExamId) {
      setCallPageStudentIds([]);
      setCallPageStudentCalls([]);
      setCallServerPageInfo({ totalCount: 0, totalPages: 1, hasMore: false });
      setCallLoading(false);
      return;
    }
    let cancelled = false;
    setCallLoading(true);

    callCandidatesApi
      .get({
        courseId: callCourseId,
        examId: callExamId,
        statusFilter: callStatusFilter,
        q: callGeneralSearch,
        filterQ: callFilterSearch,
        page: callGradePage,
        pageSize: CALL_PAGE_SIZE,
      })
      .then((result) => {
        if (cancelled || !result) return;
        const pageStudents = (result.students || []) as unknown as Student[];
        const pageGrades = (result.grades || []) as unknown as Grade[];
        mergeStudentsCache(pageStudents);
        mergeGradesCache(pageGrades);
        setCallPageStudentIds(pageStudents.map((student) => student.id));
        setCallPageStudentCalls((result.studentCalls || []) as unknown as StudentCall[]);
        setCallServerPageInfo({
          totalCount: Number(result.totalCount || 0),
          totalPages: Math.max(1, Number(result.totalPages || 1)),
          hasMore: Boolean(result.hasMore),
        });
      })
      .catch(() => {
        if (!cancelled) {
          setCallPageStudentIds([]);
          setCallPageStudentCalls([]);
          setCallServerPageInfo({ totalCount: 0, totalPages: 1, hasMore: false });
          toast.error("تعذر تحميل طلاب المكالمات من قاعدة البيانات.");
        }
      })
      .finally(() => {
        if (!cancelled) setCallLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [
    view,
    callCourseId,
    callExamId,
    callStatusFilter,
    callGeneralSearch,
    callFilterSearch,
    callGradePage,
    mergeStudentsCache,
    mergeGradesCache,
  ]);

  useEffect(() => {
    if (view !== "calls" || !callCourseId || !callExamId) {
      setCallDatabaseStats(null);
      setCallDatabaseStatsLoading(false);
      return;
    }

    let cancelled = false;
    const timer = window.setTimeout(() => {
      setCallDatabaseStatsLoading(true);
      callStatsApi
        .get({
          courseId: callCourseId,
          examId: callExamId,
          statusFilter: callStatusFilter,
          q: callGeneralSearch,
          filterQ: callFilterSearch,
        })
        .then((result) => {
          if (!cancelled) setCallDatabaseStats(result);
        })
        .catch(() => {
          if (!cancelled) setCallDatabaseStats(null);
        })
        .finally(() => {
          if (!cancelled) setCallDatabaseStatsLoading(false);
        });
    }, 180);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [view, callCourseId, callExamId, callStatusFilter, callGeneralSearch, callFilterSearch]);

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
  const selectedCallCourse = courses.find((course) => course.id === callCourseId) || null;
  const callCourseExams = useMemo(
    () =>
      callCourseId
        ? exams.filter((exam) => examIncludesCourse(exam, callCourseId))
        : [],
    [exams, callCourseId],
  );
  const selectedCallExam = callCourseExams.find((exam) => exam.id === callExamId) || null;
  const callCourseSelected = Boolean(selectedCallCourse);
  const callExamSelected = Boolean(selectedCallExam);
  const callExportDocumentTitle = selectedCallExam
    ? `${selectedCallCourse?.name || "الدورة"} - ${selectedCallExam.name}`
    : "المكالمات";
  const callExportFileName = selectedCallExam
    ? `المكالمات-${selectedCallCourse?.name || "الدورة"}-${selectedCallExam.name}`
    : "المكالمات";
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

  const effectiveStudentCalls = useMemo(
    () => [...studentCalls, ...callPageStudentCalls],
    [studentCalls, callPageStudentCalls],
  );

  const callLogLookup = useMemo(() => {
    const map = new Map<string, (typeof effectiveStudentCalls)[number]>();
    effectiveStudentCalls.forEach((call) => {
      const key = `${call.studentId}::${String(call.examId || "")}::${call.category}`;
      map.set(key, call);
    });
    return map;
  }, [effectiveStudentCalls]);

  const callLogForGrade = (student: Student, item: CallGradeItem) => {
    const exactKey = `${student.id}::${item.exam.id}::${item.callKey}`;
    const legacyKey = `${student.id}::${item.exam.id}::${item.category}`;
    return callLogLookup.get(exactKey) || callLogLookup.get(legacyKey);
  };

  const callLogForRow = (row: CallStudentRow) =>
    row.focusItem ? callLogForGrade(row.student, row.focusItem) : undefined;

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
    const map = new Map<string, (typeof effectiveStudentCalls)[number]>();
    effectiveStudentCalls.forEach((call) => {
      if (call.category === CALL_STUDENT_NOTE_CATEGORY)
        map.set(call.studentId, call);
    });
    return map;
  }, [effectiveStudentCalls]);

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
        if (!exam.noDiscount && score <= Number(exam.discountMark || 0)) {
          return {
            category: "discounted",
            label: callCategoryLabels.discounted,
            reason: `ضمن درجة الخصم: ${score}/${exam.fullMark}`,
          };
        }
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
    if (!callCourseId || !selectedCallExam) return [];
    const courseStudents = callPageStudentIds
      .map((studentId) => students.find((student) => student.id === studentId))
      .filter((student): student is Student => Boolean(student));
    const courseStudentIds = new Set(courseStudents.map((student) => student.id));
    const studentById = new Map<string, Student>(
      courseStudents.map((student) => [student.id, student] as [string, Student]),
    );
    const examById = new Map<string, Exam>([[selectedCallExam.id, selectedCallExam]]);
    const grouped = new Map<
      string,
      { student: Student; items: CallGradeItem[] }
    >();

    courseStudents.forEach((student) => {
      grouped.set(student.id, { student, items: [] });
    });

    grades.forEach((grade) => {
      if (!courseStudentIds.has(grade.studentId)) return;
      const student = studentById.get(grade.studentId);
      const exam = examById.get(grade.examId);
      if (!student || !exam) return;
      const cls = classification(grade, exam, student);
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
      const current = grouped.get(student.id) ?? { student, items: [] as CallGradeItem[] };
      current.items.push(item);
      grouped.set(student.id, current);
    });

    const rows = Array.from(grouped.values())
      .flatMap<CallStudentRow>(({ student, items }) => {
        const sortedItems = sortGradeItemsByLatest(items);
        const examItem = sortedItems.find((item) => item.exam.id === selectedCallExam.id) || null;

        // فلتر الحالة
        if (callStatusFilter && callStatusFilter !== "all") {
          if (!examItem) return [];
          if (!callGradeMatchesStatusFilter(callStatusFilter, examItem)) return [];
        }

        const searchValues = [
          student.name,
          student.code,
          student.phone,
          student.parentPhone,
          student.telegram,
          student.school,
          student.status,
          student.studyType,
          selectedCallCourse?.name || "",
          selectedCallExam?.name || "",
          examItem?.grade.status || "",
          examItem ? formatGradeScore(examItem.grade, examItem.exam, "—") : "",
          examItem?.reason || "",
          examItem?.grade.notes || "",
          ...sortedItems.flatMap((item) => [
            item.exam.name,
            item.grade.status,
            formatGradeScore(item.grade, item.exam, "—"),
            item.reason,
            item.grade.notes,
            callStatusForLog(callLogForGrade(student, item)),
          ]),
          callNoteForStudent(student.id)?.notes,
        ];

        if (callGeneralSearch && !searchAny(callGeneralSearch, searchValues)) return [];
        if (callFilterSearch && !searchAny(callFilterSearch, searchValues)) return [];

        return [
          {
            id: `student:${student.id}`,
            student,
            items: sortedItems,
            focusItem: examItem,
          },
        ];
      });

    return rows.sort((a, b) => {
      const aTime = a.focusItem?.sortTime || 0;
      const bTime = b.focusItem?.sortTime || 0;
      return (
        bTime - aTime ||
        String(a.student.name || "").localeCompare(String(b.student.name || ""), "ar")
      );
    });
  }, [
    grades,
    students,
    callPageStudentIds,
    selectedCallCourse,
    selectedCallExam,
    callStatusFilter,
    callGeneralSearch,
    callFilterSearch,
    callLogLookup,
    callStudentNoteLookup,
    classification,
  ]);

  const callTotalPages = Math.max(1, callServerPageInfo.totalPages);
  const callSafePage = Math.min(callGradePage, callTotalPages);
  const visibleCallRows = callRows;

  const callStats = useMemo(() => {
    const rowsWithCalls = callRows.map((row) => ({
      row,
      call: callLogForRow(row),
    }));
    return {
      total: callServerPageInfo.totalCount || callRows.length,
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
  }, [callRows, callLogLookup, callServerPageInfo.totalCount]);

  const displayedCallStats = callDatabaseStats ?? callStats;
  const callStatsSuffix = callDatabaseStatsLoading ? "…" : "";

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
    if (!row.focusItem) return;
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
        `${item?.reason || ""} | ${item.exam.name} | ${formatGradeScore(item.grade, item.exam, "—")}`,
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
            const relatedStudent = leave.student && typeof leave.student === "object" ? leave.student : null;
            const relatedExam = leave.exam && typeof leave.exam === "object" ? leave.exam : null;
            const student = students.find(
              (item) => item.id === leave.studentId,
            ) || relatedStudent;
            const exam = exams.find((item) => item.id === leave.examId) || relatedExam;
            const isPeriod = (leave.leaveType || "exam") === "period";
            const studentDisplayName = student?.name || "طالب غير محمل";
            const studentDisplayCode = student?.code ? ` (${student.code})` : "";
            return (
              <div
                key={leave.id}
                className="grid gap-2 rounded-2xl border bg-card/80 p-3 text-sm lg:grid-cols-[1.1fr_1fr_1.4fr_1fr_auto] lg:items-center"
              >
                <b>{studentDisplayName}{studentDisplayCode}</b>
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
    const isFocus = row.focusItem && item.id === row.focusItem.id;
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
          <b>{item?.exam?.name || "—"}</b>
          {isFocus ? <Badge>آخر/محور المتابعة</Badge> : null}
          <Badge
            variant={
              item.category === "absent" ||
              item.category === "discounted" ||
              item.category === "failed" ||
              item.category === "cheating"
                ? "destructive"
                : "secondary"
            }
          >
            {item?.label || "—"}
          </Badge>
        </div>
        <p className="mt-1 text-muted-foreground">
          {item ? formatAppDate(item.exam.date) : "—"} - الدرجة:{" "}
          <span className="font-bold text-foreground">{value}</span>
        </p>
        {item?.category !== "absent" ? (
          <p className="mt-1 text-muted-foreground">{item?.reason || ""}</p>
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
    const displayMode = callGradeDisplayModes[row.student.id] || "latest";
    const displayedGradeItems = visibleCallGradeItems(row.items, displayMode);
    const focusValue = item
      ? item.category === "absent"
        ? "غائب"
        : formatGradeScore(item.grade, item.exam, "—")
      : "—";
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
            الدرجات المعروضة: <b>{displayedGradeItems.length}</b> من <b>{row.items.length}</b>
          </p>
        </div>
        <div className="space-y-2">
          <div className="rounded-2xl border border-primary/30 bg-primary/5 p-3">
            <p className="text-xs text-muted-foreground">
              آخر امتحان / محور المتابعة الحالي
            </p>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <b>{item?.exam?.name || "—"}</b>
              <Badge
                variant={
                  item?.category === "absent" ||
                  item?.category === "discounted" ||
                  item?.category === "failed" ||
                  item?.category === "cheating"
                    ? "destructive"
                    : "secondary"
                }
              >
                {item?.label || "—"}
              </Badge>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              {item ? formatAppDate(item.exam.date) : "—"} - الدرجة:{" "}
              <span className="font-bold text-foreground">{focusValue}</span>
            </p>
            {item?.category !== "absent" ? (
              <p className="mt-1 text-xs text-muted-foreground">
                {item?.reason || ""}
              </p>
            ) : null}
          </div>
          <div className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs font-bold text-muted-foreground">
                درجات الطالب
              </p>
              <div className="flex flex-wrap gap-1">
                {(Object.keys(callGradeDisplayModeLabels) as CallGradeDisplayMode[]).map((mode) => (
                  <Button
                    key={mode}
                    type="button"
                    size="sm"
                    variant={displayMode === mode ? "default" : "outline"}
                    className="h-7 rounded-full px-2 text-[11px]"
                    onClick={() =>
                      setCallGradeDisplayModes((current) => ({
                        ...current,
                        [row.student.id]: mode,
                      }))
                    }
                  >
                    {callGradeDisplayModeLabels[mode]}
                  </Button>
                ))}
              </div>
            </div>
            {displayedGradeItems.length === 0 ? (
              <p className="rounded-2xl border border-dashed bg-muted/30 p-3 text-xs text-muted-foreground">
                لا توجد درجات محفوظة لهذا الطالب ضمن امتحانات هذه الدورة.
              </p>
            ) : (
              <div className="grid gap-2 md:grid-cols-2">
                {displayedGradeItems.map((gradeItem) =>
                  renderCallGradeChip(row, gradeItem),
                )}
              </div>
            )}
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
            disabled={!row.focusItem}
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
                اختر الدورة أولاً، بعدها تظهر امتحاناتها فقط، ثم تظهر قائمة طلاب الدورة حسب الامتحان المختار وحالة الدرجة.
              </p>
            </CardHeader>
            <CardContent className="space-y-4 p-4">
              <div className="space-y-2">
                <Label>بحث عام قبل الفرز</Label>
                <Input
                  id="follow-up-calls-general-search"
                  name="calls-general-search"
                  data-teacherpro-search="true"
                  value={callGeneralSearch}
                  onChange={(event) => {
                    setCallGeneralSearch(event.target.value);
                    setCallGradePage(1);
                  }}
                  placeholder="بحث عام: اسم / كود / هاتف / تليكرام / مدرسة / امتحان / درجة"
                />
              </div>
              <div className="grid gap-3 md:grid-cols-5">
                <div className="space-y-2">
                  <Label>الدورة</Label>
                  <Select
                    value={callCourseId || "__none__"}
                    onValueChange={(value) => {
                      setCallCourseId(value === "__none__" ? "" : value);
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="اختر الدورة أولاً" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">كل الدورات / بدون اختيار</SelectItem>
                      {courses.map((course) => (
                        <SelectItem key={course.id} value={course.id}>
                          {course.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>الامتحان</Label>
                  <Select
                    value={callExamId || "__none__"}
                    disabled={!callCourseSelected}
                    onValueChange={(value) => {
                      setCallExamId(value === "__none__" ? "" : value);
                      setCallGradePage(1);
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="اختر امتحان الدورة" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">كل الامتحانات / بدون اختيار</SelectItem>
                      {callCourseExams.map((exam) => (
                        <SelectItem key={exam.id} value={exam.id}>
                          {exam.name} - {formatAppDate(exam.date)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>حالة الطالب في الامتحان</Label>
                  <Select
                    value={callStatusFilter}
                    disabled={!callExamSelected}
                    onValueChange={(value) => {
                      setCallStatusFilter(value as CallStatusFilter);
                      setCallGradePage(1);
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {callStatusFilterOptions.map((option) => (
                        <SelectItem key={option} value={option}>
                          {callStatusFilterLabels[option]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>بحث داخل الفرز</Label>
                  <Input
                    id="follow-up-calls-filter-search"
                    name="calls-filter-search"
                    data-teacherpro-search="true"
                    disabled={!callExamSelected}
                    value={callFilterSearch}
                    onChange={(event) => {
                      setCallFilterSearch(event.target.value);
                      setCallGradePage(1);
                    }}
                    placeholder="بحث داخل نتائج الدورة والامتحان"
                  />
                </div>
                <div className="space-y-2">
                  <Label>تصدير</Label>
                  {callExamSelected ? (
                    <ExportDialog
                      title="تصدير المكالمات"
                      fileName={callExportFileName}
                      rows={callExportRows}
                      columns={callExportColumns}
                      triggerLabel="تصدير"
                      description="تقرير المكالمات حسب الدورة والامتحان والفلاتر الحالية"
                      pdfTitle={callExportDocumentTitle}
                      pdfFileName={callExportFileName}
                    />
                  ) : (
                    <Button className="w-full" variant="outline" disabled>
                      اختر الدورة والامتحان
                    </Button>
                  )}
                </div>
              </div>
              {!callCourseSelected ? (
                <p className="rounded-2xl border border-dashed bg-muted/30 p-3 text-sm text-muted-foreground">
                  اختر الدورة أولاً حتى يتم تفعيل الامتحانات وبقية الفلاتر.
                </p>
              ) : !callExamSelected ? (
                <p className="rounded-2xl border border-dashed bg-muted/30 p-3 text-sm text-muted-foreground">
                  تم اختيار الدورة. اختر امتحاناً من امتحانات هذه الدورة لعرض الطلاب.
                </p>
              ) : callLoading ? (
                <p className="rounded-2xl border bg-muted/30 p-3 text-sm text-muted-foreground">
                  جاري تحميل طلاب ودرجات هذه الدورة...
                </p>
              ) : null}
            </CardContent>
          </Card>
          <div className="grid gap-3 md:grid-cols-5">
            <Card>
              <CardContent className="p-4">
                <p className="text-xs text-muted-foreground">
                  الطلاب المطابقون من قاعدة البيانات
                </p>
                <b className="text-2xl">{displayedCallStats.total}{callStatsSuffix}</b>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <p className="text-xs text-muted-foreground">تم الاتصال</p>
                <b className="text-2xl">{displayedCallStats.contacted}{callStatsSuffix}</b>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <p className="text-xs text-muted-foreground">لم يرد</p>
                <b className="text-2xl">{displayedCallStats.unanswered}{callStatsSuffix}</b>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <p className="text-xs text-muted-foreground">الرقم خاطئ</p>
                <b className="text-2xl">{displayedCallStats.wrong}{callStatsSuffix}</b>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <p className="text-xs text-muted-foreground">بدون إجراء</p>
                <b className="text-2xl">{displayedCallStats.noAction}{callStatsSuffix}</b>
              </CardContent>
            </Card>
          </div>
          <Card>
            <CardHeader>
              <CardTitle>قائمة الطلاب ودرجاتهم</CardTitle>
              <p className="text-sm text-muted-foreground">
                لا تظهر القائمة إلا بعد اختيار دورة ثم امتحان. كل طالب يظهر مرة واحدة مع محور الامتحان المختار وإمكانية عرض آخر امتحان، آخر امتحانين، أو جميع امتحاناته.
              </p>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl bg-muted/40 px-3 py-2 text-sm">
                <span>
                  عدد الطلاب الكلي من قاعدة البيانات: <b>{displayedCallStats.total}{callStatsSuffix}</b>
                </span>
                <span>
                  الصفحة <b>{callSafePage}</b> من <b>{callTotalPages}</b>
                </span>
              </div>
              {!callExamSelected ? (
                <p className="empty-state py-8">
                  اختر الدورة ثم الامتحان لعرض الطلاب.
                </p>
              ) : visibleCallRows.length === 0 ? (
                <p className="empty-state py-8">
                  لا يوجد طلاب مطابقون للدورة والامتحان والفلاتر الحالية.
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
