"use client";
import { useTeacherProBackgroundSyncDetector, useTeacherProSyncKey } from "@/hooks/use-teacherpro-sync";

import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  useTeacherStore,
  type Exam,
  type Grade,
  type Student,
  type StudentCall,
  type StudentLeave,
  type StudentNote,
} from "@/lib/teacher-store";
import {
  callCandidatesApi,
  callCourseExamsApi,
  callStatsApi,
  gradeApi,
  pledgeApi,
  studentApi,
  studentCallApi,
  studentLeaveApi,
  type CallStatsResponse,
  type PledgeActionResponse,
  type PledgeStatsResponse,
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
import { toast } from "@/lib/user-toast";
import { formatAppDate, sanitizePhoneInput } from "@/lib/format";
import { normalizeTelegramIdentifier } from "@/lib/student-utils";
import { searchAny } from "@/lib/validation";
import { StudentProfileDialog } from "./student-profile-dialog";
import { ExportDialog, type ExportColumn } from "./export-dialog";
import { CountScopeSummary } from "./ui-kit";
import { formatGradeScore } from "@/lib/exam-utils";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { emitTeacherProDataChanged } from "@/lib/teacherpro-sync";
import { formatOpportunityBalance, getOpportunityLimit } from "@/lib/opportunity-balance";
import {
  getStudentGraceWindow,
  isStudentCurrentlyInGrace as isStudentCurrentlyInGraceUnified,
} from "@/lib/student-grace";
import { baghdadTodayKey } from "@/lib/baghdad-time";

type FollowView = "leaves" | "calls" | "pledges";
type CallCategory =
  | "absent"
  | "discounted"
  | "failed"
  | "academic-accounting"
  | "low-pass"
  | "full"
  | "passed"
  | "cheating"
  | "protected"
  | "missing";
type CallStatusFilter =
  "all" | "absent" | "discounted" | "failed" | "cheating" | "passed" | "full";
type CallGradeDisplayMode = "latest" | "latest-two" | "all";
type CallBadgeTone = "deducted" | "warning" | "safe" | "success" | "neutral";
type CallBadgeInfo = { label: string; tone: CallBadgeTone; detail?: string };
type PledgeTypeFilter = "all" | "temporary" | "final";
type PledgeStatusFilter = "all" | "pledged" | "pending" | "reactivated";
type ContactStatus = "" | "تم الاتصال" | "لم يرد" | "الرقم خاطئ";

type CallGradeItem = {
  id: string;
  callKey: string;
  exam: Exam;
  grade: Grade;
  category: CallCategory;
  impactKind?: string;
  label: string;
  reason: string;
  badges?: CallBadgeInfo[];
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
  failed: "راسب غير مخصوم",
  "academic-accounting": "راسب غير مخصوم",
  "low-pass": "ناجح بدرجة منخفضة",
  full: "درجة كاملة",
  passed: "ناجح",
  cheating: "غش",
  protected: "محمي",
  missing: "غير مدخل",
};

const callStatusFilterLabels: Record<CallStatusFilter, string> = {
  all: "كل الحالات",
  absent: "الغائبين",
  discounted: "المخصومين",
  failed: "الراسبين غير المخصومين",
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
    key: "deductionImpact",
    label: "أثر الخصم",
    value: ({ row }) =>
      (row.focusItem?.badges || [])
        .map((badge) => badge.label)
        .filter(Boolean)
        .join("، "),
  },
  {
    key: "grade",
    label: "الدرجة",
    value: ({ row }) =>
      row.focusItem
        ? formatGradeScore(row.focusItem.grade, row.focusItem.exam, "—")
        : "",
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
    label: "معرف التيليجرام",
    value: ({ row }) => row.student.telegram || "",
  },
  { key: "note", label: "ملاحظات المكالمات", value: ({ note }) => note },
];
const PLEDGE_NOTE_KIND = "تعهد ولي الأمر";

function todayISO() {
  return baghdadTodayKey();
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

function whatsappMessageLink(phone: string, message: string): string {
  const digits = phoneForWhatsApp(sanitizePhoneInput(phone));
  return digits
    ? `https://wa.me/${digits}?text=${encodeURIComponent(message)}`
    : "#";
}

function pledgeGradeReport(grades: Array<Record<string, unknown>>): string {
  if (grades.length === 0) {
    return "لا توجد درجات مسجلة للطالب في النظام.";
  }

  return grades
    .map((rawGrade) => {
      const exam = (rawGrade.exam || {}) as Record<string, unknown>;
      const examName = String(exam.name || "امتحان غير مسمى").trim();
      const examDate = formatAppDate(String(exam.date || ""));
      const gradeText = formatGradeScore(
        {
          status: String(rawGrade.status || ""),
          score:
            typeof rawGrade.score === "number" ||
            typeof rawGrade.score === "string"
              ? rawGrade.score
              : null,
        },
        { fullMark: Number(exam.fullMark || 0) },
        String(rawGrade.status || "غير مدخلة"),
      );
      return [
        `اسم الامتحان: ${examName}`,
        `تاريخ الامتحان: ${examDate}`,
        `درجة الامتحان: ${gradeText}`,
      ].join("\n");
    })
    .join("\n\n");
}

function pledgeWhatsAppMessage(
  grades: Array<Record<string, unknown>>,
): string {
  return `إدارة الأستاذ حسن فلاح
تعهد ولي الأمر

أتعهد أنا ولي أمر الطالب/ ……………………………. بمتابعة التزامه بالدوام والأنظمة، وأقر بأنه استنفد جميع الفرص الممنوحة ٣ فرص، وقد مُنح فرصة استثنائية أخيرة من إدارة الأستاذ حسن فلاح.

وفي حال تكرار الغياب أو استنفاذ هذه الفرصة، يُفصل الطالب نهائيًا دون استثناء أو استرجاع لأي مبلغ مدفوع.

اسم ولي الأمر: ……………………….
اسم الطالب: ……………………….
التوقيع: ……………………….
التاريخ: …… / …… / …….

ملاحظة مهمة:
يرجى كتابة هذا التعهد بخط اليد في ورقة، وتوقيعه، ثم إرساله مع صورة من وجه هوية ولي الأمر إلى الإدارة.

تقرير درجات الطالب:
${pledgeGradeReport(grades)}`;
}

function telegramLink(telegram: string): string {
  const username = normalizeTelegramIdentifier(telegram).replace(/^@+/, "");
  return username ? `https://t.me/${encodeURIComponent(username)}` : "#";
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
  const graceWindow = getStudentGraceWindow(student);
  if (!graceWindow)
    return formatAppDate(
      student.createdAt,
      String(student.createdAt || "").slice(0, 10) || "-",
    );
  const end = new Date(graceWindow.endExclusive);
  end.setUTCDate(end.getUTCDate() - 1);
  return formatAppDate(end);
}

function isStudentCurrentlyInGrace(student: Student): boolean {
  return isStudentCurrentlyInGraceUnified(student);
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
  const syncKey = useTeacherProSyncKey(["follow-up", "students", "grades", "opportunities", "dashboard"]);
  const isBackgroundSync = useTeacherProBackgroundSyncDetector(syncKey);
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
    courseName,
    activeChapterForCourse,
    mergeStudentsCache,
  } = useTeacherStore();

  const [globalSearch, setGlobalSearch] = useState("");
  const debouncedGlobalSearch = useDebouncedValue(globalSearch, 180);

  // نتائج البحث من النظام للطالب المعروض في منتقي الإجازات.
  // نستخدم بحث النظام بدلاً من البيانات المؤقتة المحلية لأن البيانات المؤقتة قد لا يحوي
  // إلا أول 200 طالب، مما يخفي الطلاب القدامى أو الإضافيين عن المستخدم.
  const [leavePickerStudents, setLeavePickerStudents] = useState<Student[]>([]);
  const [leavePickerLoading, setLeavePickerLoading] = useState(false);

  useEffect(() => {
    if (view !== "leaves") return;
    let cancelled = false;
    setLeavePickerLoading(true);
    studentApi
      .list({ q: debouncedGlobalSearch, opportunityMode: true, pageSize: 30 })
      .then((result) => {
        if (cancelled) return;
        const next = (result?.students || []) as unknown as Student[];
        setLeavePickerStudents(next);
        mergeStudentsCache(next);
      })
      .catch(() => {
        if (!cancelled) {
          setLeavePickerStudents([]);
        }
      })
      .finally(() => {
        if (!cancelled) setLeavePickerLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [view, debouncedGlobalSearch, mergeStudentsCache]);

  useEffect(() => {
    if (view !== "leaves") return;
    let cancelled = false;

    // حمّل المفصولين بشكل صريح حتى تظهرهم قائمة التعهدات لاحقاً.
    // لا نعتمد على هذا المصدر لمنتقي الإجازات — استخدام البحث من النظام
    // يضمن ظهور أي طالب بغض النظر عن ترتيبه الزمني.
    studentApi
      .list({ status: "مفصول", opportunityMode: true, pageSize: 200 })
      .then((dismissedResult) => {
        if (cancelled) return;
        const all = dismissedResult?.students || [];
        mergeStudentsCache(all as unknown as Student[]);
      })
      .catch(() => {
        // الصفحة تستخدم آخر بيانات مؤقتة متاح إذا فشل الاتصال المؤقت.
      });

    return () => {
      cancelled = true;
    };
  }, [view, mergeStudentsCache]);

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
  const [leaveRowsFromDb, setLeaveRowsFromDb] = useState<StudentLeave[]>([]);
  const [leaveLoading, setLeaveLoading] = useState(false);
  const [leaveError, setLeaveError] = useState("");
  const [leaveSaving, setLeaveSaving] = useState(false);
  const [leaveDeletingIds, setLeaveDeletingIds] = useState<Record<string, boolean>>({});
  const [leaveSearch, setLeaveSearch] = useState("");
  const debouncedLeaveSearch = useDebouncedValue(leaveSearch, 180);
  const [leaveTypeFilter, setLeaveTypeFilter] = useState<"all" | LeaveMode>("all");

  useEffect(() => {
    if (view !== "leaves") return;
    const controller = new AbortController();

    async function loadLeavesFromDatabase() {
      const silent = isBackgroundSync();
      if (!silent) setLeaveLoading(true);
      if (!silent) setLeaveError("");
      try {
        const collected: StudentLeave[] = [];
        let page = 1;
        let totalPages = 1;

        while (page <= totalPages) {
          const params = new URLSearchParams({
            page: String(page),
            pageSize: "500",
          });
          const response = await fetch(`/api/student-leaves?${params.toString()}`, {
            credentials: "same-origin",
            signal: controller.signal,
          });
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          const payload = (await response.json()) as {
            studentLeaves?: StudentLeave[];
            totalPages?: number;
            hasMore?: boolean;
          };
          collected.push(...((payload.studentLeaves || []) as StudentLeave[]));
          totalPages = Math.max(1, Number(payload.totalPages || 1));
          if (!payload.hasMore || page >= totalPages) break;
          page += 1;
        }

        if (controller.signal.aborted) return;
        setLeaveRowsFromDb(collected);
        const relatedStudents = collected
          .map((leave) => leave.student)
          .filter(Boolean) as Student[];
        if (relatedStudents.length) mergeStudentsCache(relatedStudents);
      } catch (error) {
        if (controller.signal.aborted) return;
        console.warn("[FollowUp/leaves] failed to load leaves from database", error);
        if (!silent) {
          setLeaveRowsFromDb([]);
          setLeaveError("تعذر تحميل الإجازات من بيانات النظام. تم تعطيل الحفظ والحذف حتى يرجع الاتصال.");
        }
      } finally {
        if (!controller.signal.aborted) setLeaveLoading(false);
      }
    }

    void loadLeavesFromDatabase();

    return () => controller.abort();
  }, [view, mergeStudentsCache, syncKey, isBackgroundSync]);

  const [callCourseId, setCallCourseId] = useState("");
  const [callExamId, setCallExamId] = useState("");
  const [callStatusFilter, setCallStatusFilter] =
    useState<CallStatusFilter>("all");
  const [callGeneralSearch, setCallGeneralSearch] = useState("");
  const [callFilterSearch, setCallFilterSearch] = useState("");
  const [callGradePage, setCallGradePage] = useState(1);
  const [callLoading, setCallLoading] = useState(false);
  const [callCourseExamsLoading, setCallCourseExamsLoading] = useState(false);
  const [callCourseExamsFromDb, setCallCourseExamsFromDb] = useState<Exam[]>([]);
  const [callRowsFromDb, setCallRowsFromDb] = useState<CallStudentRow[]>([]);
  const [callPageStudentCalls, setCallPageStudentCalls] = useState<
    StudentCall[]
  >([]);
  const [callSavingKeys, setCallSavingKeys] = useState<Record<string, boolean>>({});
  const callMutationVersionRef = useRef(0);
  const callCandidatesRequestSequenceRef = useRef(0);
  const callRowsRef = useRef<CallStudentRow[]>([]);
  const [callNoteDrafts, setCallNoteDrafts] = useState<Record<string, string>>({});
  const [callServerPageInfo, setCallServerPageInfo] = useState({
    totalCount: 0,
    totalPages: 1,
    hasMore: false,
  });
  const [callDatabaseStats, setCallDatabaseStats] =
    useState<CallStatsResponse | null>(null);
  const [callDatabaseStatsLoading, setCallDatabaseStatsLoading] =
    useState(false);
  const [pledgeDatabaseStats, setPledgeDatabaseStats] =
    useState<PledgeStatsResponse | null>(null);
  const [pledgeDatabaseStatsLoading, setPledgeDatabaseStatsLoading] =
    useState(false);
  const [pledgeRowsFromDb, setPledgeRowsFromDb] = useState<PledgeRow[]>([]);
  const [pledgeLoading, setPledgeLoading] = useState(false);
  const [pledgeError, setPledgeError] = useState("");
  const [pledgeSavingKeys, setPledgeSavingKeys] = useState<Record<string, boolean>>({});
  const [pledgeWhatsAppLoadingKeys, setPledgeWhatsAppLoadingKeys] = useState<
    Record<string, boolean>
  >({});
  const [callGradeDisplayModes, setCallGradeDisplayModes] = useState<
    Record<string, CallGradeDisplayMode>
  >({});
  const debouncedCallGeneralSearch = useDebouncedValue(callGeneralSearch, 300);
  const debouncedCallFilterSearch = useDebouncedValue(callFilterSearch, 300);
  const [pledgeSearch, setPledgeSearch] = useState("");
  const debouncedPledgeSearch = useDebouncedValue(pledgeSearch, 250);
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
    if (view !== "calls" || !callCourseId) {
      setCallCourseExamsFromDb([]);
      setCallCourseExamsLoading(false);
      return;
    }
    let cancelled = false;
    const controller = new AbortController();
    setCallCourseExamsLoading(true);
    callCourseExamsApi
      .get(callCourseId, { signal: controller.signal, quietAbort: true })
      .then((result) => {
        if (cancelled || controller.signal.aborted) return;
        const nextExams = (result?.exams || []) as unknown as Exam[];
        setCallCourseExamsFromDb(nextExams);
        if (callExamId && !nextExams.some((exam) => exam.id === callExamId)) {
          setCallExamId("");
        }
      })
      .catch(() => {
        if (!cancelled && !controller.signal.aborted) {
          setCallCourseExamsFromDb([]);
          toast.error("تعذر تحميل امتحانات المكالمات من بيانات النظام.");
        }
      })
      .finally(() => {
        if (!cancelled && !controller.signal.aborted) setCallCourseExamsLoading(false);
      });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [view, callCourseId, callExamId]);

  useEffect(() => {
    if (view !== "calls" || !callCourseId || !callExamId) {
      callCandidatesRequestSequenceRef.current += 1;
      callRowsRef.current = [];
      setCallRowsFromDb([]);
      setCallPageStudentCalls([]);
      setCallServerPageInfo({ totalCount: 0, totalPages: 1, hasMore: false });
      setCallLoading(false);
      return;
    }
    let cancelled = false;
    const controller = new AbortController();
    const requestSequence = ++callCandidatesRequestSequenceRef.current;
    const mutationVersionAtRequestStart = callMutationVersionRef.current;
    const silent = isBackgroundSync();
    // لا نستبدل الجدول الموجود بحالة تحميل عند أي مزامنة أو إعادة جلب.
    // الـSkeleton يظهر فقط في أول تحميل عندما لا توجد صفوف معروضة أصلاً.
    const shouldBlockTable = !silent && callRowsRef.current.length === 0;
    setCallLoading(shouldBlockTable);

    callCandidatesApi
      .get(
        {
          courseId: callCourseId,
          examId: callExamId,
          statusFilter: callStatusFilter,
          q: debouncedCallGeneralSearch,
          filterQ: debouncedCallFilterSearch,
          page: callGradePage,
          pageSize: CALL_PAGE_SIZE,
        },
        { signal: controller.signal, quietAbort: true },
      )
      .then((result) => {
        if (
          cancelled ||
          controller.signal.aborted ||
          !result ||
          requestSequence !== callCandidatesRequestSequenceRef.current
        )
          return;
        const nextRows = (result.rows || []) as unknown as CallStudentRow[];
        callRowsRef.current = nextRows;
        setCallRowsFromDb(nextRows);
        // لا نسمح لطلب بدأ قبل حفظ المستخدم أن يعيد حالة اتصال قديمة فوق النتيجة المحفوظة.
        if (mutationVersionAtRequestStart === callMutationVersionRef.current) {
          setCallPageStudentCalls(
            (result.studentCalls || []) as unknown as StudentCall[],
          );
        }
        if (result.exams?.length) {
          setCallCourseExamsFromDb(result.exams as unknown as Exam[]);
        }
        setCallServerPageInfo({
          totalCount: Number(result.totalCount || 0),
          totalPages: Math.max(1, Number(result.totalPages || 1)),
          hasMore: Boolean(result.hasMore),
        });
      })
      .catch(() => {
        if (
          !cancelled &&
          !controller.signal.aborted &&
          requestSequence === callCandidatesRequestSequenceRef.current &&
          !silent
        ) {
          // نحافظ على آخر جدول ناجح بدلاً من مسحه وإرباك المستخدم.
          toast.error("تعذر تحديث طلاب المكالمات. بقيت آخر بيانات ناجحة ظاهرة.");
        }
      })
      .finally(() => {
        if (
          !cancelled &&
          !controller.signal.aborted &&
          requestSequence === callCandidatesRequestSequenceRef.current
        )
          setCallLoading(false);
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [
    view,
    callCourseId,
    callExamId,
    callStatusFilter,
    debouncedCallGeneralSearch,
    debouncedCallFilterSearch,
    callGradePage,
    syncKey,
    isBackgroundSync,
  ]);

  useEffect(() => {
    if (view !== "calls" || !callCourseId || !callExamId) {
      setCallDatabaseStats(null);
      setCallDatabaseStatsLoading(false);
      return;
    }

    let cancelled = false;
    const controller = new AbortController();
    const silent = isBackgroundSync();
    const timer = window.setTimeout(() => {
      if (!silent) setCallDatabaseStatsLoading(true);
      callStatsApi
        .get(
          {
            courseId: callCourseId,
            examId: callExamId,
            statusFilter: callStatusFilter,
            q: debouncedCallGeneralSearch,
            filterQ: debouncedCallFilterSearch,
          },
          { signal: controller.signal, quietAbort: true },
        )
        .then((result) => {
          if (!cancelled && !controller.signal.aborted) setCallDatabaseStats(result);
        })
        .catch(() => {
          if (!cancelled && !controller.signal.aborted) setCallDatabaseStats(null);
        })
        .finally(() => {
          if (!cancelled && !controller.signal.aborted) setCallDatabaseStatsLoading(false);
        });
    }, 180);

    return () => {
      cancelled = true;
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [
    view,
    callCourseId,
    callExamId,
    callStatusFilter,
    debouncedCallGeneralSearch,
    debouncedCallFilterSearch,
    syncKey,
    isBackgroundSync,
  ]);

  useEffect(() => {
    if (view !== "pledges") {
      setPledgeRowsFromDb([]);
      setPledgeDatabaseStats(null);
      setPledgeDatabaseStatsLoading(false);
      setPledgeLoading(false);
      setPledgeError("");
      return;
    }

    const controller = new AbortController();
    const silent = isBackgroundSync();
    if (!silent) setPledgeLoading(true);
    if (!silent) setPledgeDatabaseStatsLoading(true);
    if (!silent) setPledgeError("");

    pledgeApi
      .list(
        {
          q: debouncedPledgeSearch,
          typeFilter: pledgeTypeFilter,
          statusFilter: pledgeStatusFilter,
        },
        { signal: controller.signal, quietAbort: true },
      )
      .then((result) => {
        if (controller.signal.aborted) return;
        if (!result) {
          if (!silent) {
            setPledgeRowsFromDb([]);
            setPledgeDatabaseStats(null);
            setPledgeError("تعذر تحميل التعهدات من بيانات النظام. لا يمكن تنفيذ إجراء حساس حتى يرجع الاتصال.");
          }
          return;
        }
        const nextRows = (result.rows || []) as unknown as PledgeRow[];
        setPledgeRowsFromDb(nextRows);
        setPledgeDatabaseStats(result.stats || null);
        mergeStudentsCache(nextRows.map((row) => row.student).filter(Boolean) as Student[]);
      })
      .catch(() => {
        if (!controller.signal.aborted && !silent) {
          setPledgeRowsFromDb([]);
          setPledgeDatabaseStats(null);
          setPledgeError("تعذر تحميل التعهدات من بيانات النظام. لا يمكن تنفيذ إجراء حساس حتى يرجع الاتصال.");
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setPledgeLoading(false);
          setPledgeDatabaseStatsLoading(false);
        }
      });

    return () => controller.abort();
  }, [
    view,
    debouncedPledgeSearch,
    pledgeTypeFilter,
    pledgeStatusFilter,
    mergeStudentsCache,
    syncKey,
    isBackgroundSync,
  ]);

  const filteredStudents = useMemo(() => {
    // نتائج منتقي الإجازات تأتي مباشرة من النظام (leavePickerStudents).
    // هذا يضمن ظهور أي طالب بغض النظر عن ترتيبه في البيانات المؤقتة المحلية.
    // نطبّق فلترة محلية إضافية بسيطة بالاستعلام نفسه لتسريع الكتابة.
    const query = globalSearch.trim().toLowerCase();
    if (!query) return leavePickerStudents.slice(0, 30);
    return leavePickerStudents
      .filter((student) =>
        searchAny(globalSearch, [
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
      .slice(0, 30);
  }, [leavePickerStudents, globalSearch]);

  const selectedLeaveStudent =
    students.find((student) => student.id === leaveStudentId) ||
    leavePickerStudents.find((student) => student.id === leaveStudentId);
  const selectedProfileStudent =
    callRowsFromDb.find((row) => row.student.id === profileStudentId)?.student ||
    students.find((student) => student.id === profileStudentId) ||
    null;
  const selectedCallCourse =
    courses.find((course) => course.id === callCourseId) || null;
  const callCourseExams = callCourseExamsFromDb;
  const selectedCallExam =
    callCourseExams.find((exam) => exam.id === callExamId) || null;
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

  const effectiveStudentCalls = callPageStudentCalls;

  const callLogLookup = useMemo(() => {
    const map = new Map<string, (typeof effectiveStudentCalls)[number]>();
    effectiveStudentCalls.forEach((call) => {
      const key = `${call.studentId}::${String(call.examId || "")}::${call.category}`;
      if (!map.has(key)) map.set(key, call);
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
      if (call.category === CALL_STUDENT_NOTE_CATEGORY && !map.has(call.studentId))
        map.set(call.studentId, call);
    });
    return map;
  }, [effectiveStudentCalls]);

  const callNoteForStudent = (studentId: string) =>
    callStudentNoteLookup.get(studentId);

  // تبويبة المكالمات صارت Server-Driven بالكامل:
  // لا نبني الصفوف من بيانات الطلاب المؤقتة أو الدرجات المحلي حتى لا تختلف القائمة عن الإحصائيات والتصدير.
  const callRows = callRowsFromDb;

  const callTotalPages = Math.max(1, callServerPageInfo.totalPages);
  const callSafePage = Math.min(callGradePage, callTotalPages);
  const visibleCallRows = callRows;

  const callStatValue = (value: number | undefined) => {
    if (callDatabaseStatsLoading && !callDatabaseStats) return "…";
    return value ?? "—";
  };

  const pledgeStatValue = (value: number | undefined) => {
    if (pledgeDatabaseStatsLoading && !pledgeDatabaseStats) return "…";
    return value ?? "—";
  };

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

  const pledgeRows = useMemo<PledgeRow[]>(
    () => pledgeRowsFromDb,
    [pledgeRowsFromDb],
  );

  const refreshLeavesFromPayload = (leave: StudentLeave | null | undefined) => {
    if (!leave) return;
    setLeaveRowsFromDb((current) => [
      leave,
      ...current.filter((item) => item.id !== leave.id),
    ]);
  };

  const saveLeave = async () => {
    if (leaveError || leaveLoading) {
      toast.error("انتظر تحميل الإجازات من بيانات النظام قبل الحفظ.");
      return;
    }
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
    const duplicate = leaveRowsFromDb.some((leave) => {
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
      toast.error("هذا الطالب لديه إجازة مسجلة بنفس النطاق حسب بيانات النظام");
      return;
    }

    const student =
      leavePickerStudents.find((item) => item.id === leaveStudentId) ||
      students.find((item) => item.id === leaveStudentId);
    const payload = {
      studentId: leaveStudentId,
      examId: leaveMode === "exam" ? leaveExamId : "",
      leaveType: leaveMode,
      reason: leaveReason,
      studyType: student?.studyType || "",
      date: leaveMode === "exam" ? leaveDate || todayISO() : from,
      dateFrom: leaveMode === "exam" ? leaveDate || todayISO() : from,
      dateTo: leaveMode === "exam" ? leaveDate || todayISO() : to,
      notes: leaveNotes.trim(),
    };

    setLeaveSaving(true);
    const result = await studentLeaveApi.add(payload);
    setLeaveSaving(false);

    if (!result.ok || result.queued) {
      toast.error(result.error || "تعذر حفظ الإجازة من النظام.");
      return;
    }

    const response = (result.data || {}) as {
      studentLeave?: StudentLeave;
      backedUpGrades?: number;
      restoredGradeCount?: number;
    };
    refreshLeavesFromPayload(response.studentLeave);
    setCustomLeaveReason("");
    setLeaveReasonChoice("حالة مرضية");
    setLeaveNotes("");
    emitTeacherProDataChanged({
      source: "local-mutation",
      reason: "student-leave-created",
      scopes: ["follow-up", "grades", "students", "opportunities", "dashboard"],
    });

    const backedUpGrades = Number(response.backedUpGrades || 0);
    if (backedUpGrades > 0) {
      toast.success(
        backedUpGrades === 1
          ? "تم حفظ الإجازة وحذف درجة مرتبطة بعد أخذ نسخة احتياطية لها"
          : `تم حفظ الإجازة وحذف ${backedUpGrades} درجات مرتبطة بعد أخذ نسخة احتياطية لها`,
      );
      return;
    }

    toast.success(
      leaveMode === "period"
        ? "تمت إضافة الإجازة للفترة وإعادة احتساب الطالب من بيانات النظام"
        : "تمت إضافة الإجازة وإعادة احتساب الطالب بدون محاسبة هذا الامتحان",
    );
  };

  const callExportRows = callRows.map((row) => ({
    row,
    status: callStatusForLog(callLogForRow(row)),
    note: callNoteForStudent(row.student.id)?.notes || "",
    courseName,
  }));

  const fetchCallExportRows = async (): Promise<CallExportRow[]> => {
    if (!callCourseId || !callExamId || !selectedCallExam) return [];
    const result = await callCandidatesApi.listAll({
      courseId: callCourseId,
      examId: callExamId,
      statusFilter: callStatusFilter,
      q: debouncedCallGeneralSearch,
      filterQ: debouncedCallFilterSearch,
      pageSize: 200,
    });
    if (!result) throw new Error("call candidates export failed");

    const serverRows = (result.rows || []) as unknown as CallStudentRow[];
    const serverCalls = (result.studentCalls || []) as unknown as StudentCall[];
    const serverCallLookup = new Map<string, StudentCall>();
    const serverNoteLookup = new Map<string, StudentCall>();
    serverCalls.forEach((call) => {
      const key = `${call.studentId}::${String(call.examId || "")}::${call.category}`;
      if (!serverCallLookup.has(key)) serverCallLookup.set(key, call);
      if (call.category === CALL_STUDENT_NOTE_CATEGORY && !serverNoteLookup.has(call.studentId)) {
        serverNoteLookup.set(call.studentId, call);
      }
    });

    return serverRows.map((row) => {
      const item = row.focusItem;
      const exactKey = item
        ? `${row.student.id}::${item.exam.id}::${item.callKey}`
        : "";
      const legacyKey = item
        ? `${row.student.id}::${item.exam.id}::${item.category}`
        : "";
      const call = serverCallLookup.get(exactKey) || serverCallLookup.get(legacyKey);
      const note = serverNoteLookup.get(row.student.id)?.notes || "";
      return { row, status: callStatusForLog(call), note, courseName };
    });
  };

  const callIdentityMatches = (
    call: StudentCall,
    payload: { studentId: string; examId: string; category: string },
  ) =>
    call.studentId === payload.studentId &&
    String(call.examId || "") === String(payload.examId || "") &&
    call.category === payload.category;

  const mergeSavedCall = (
    payload: { studentId: string; examId: string; category: string },
    saved: StudentCall | null | undefined,
    deleted = false,
  ) => {
    setCallPageStudentCalls((current) => {
      const without = current.filter((call) => !callIdentityMatches(call, payload));
      if (deleted || !saved) return without;
      return [saved, ...without];
    });
  };

  const setCallSaving = (key: string, saving: boolean) => {
    setCallSavingKeys((current) => {
      const next = { ...current };
      if (saving) next[key] = true;
      else delete next[key];
      return next;
    });
  };

  const saveCallStatus = async (row: CallStudentRow, status: ContactStatus) => {
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
    const savingKey = `status:${payload.studentId}:${payload.examId}:${payload.category}`;
    const previousCall = existing || null;
    const optimisticCall: StudentCall = {
      id: existing?.id || `optimistic-call-${Date.now()}`,
      createdAt: existing?.createdAt || todayISO(),
      ...payload,
    };

    // يتغير الصف فوراً من دون انتظار الشبكة، ثم يُستبدل برد بيانات النظام.
    mergeSavedCall(payload, status ? optimisticCall : null, !status);
    setCallSaving(savingKey, true);
    callMutationVersionRef.current += 1;
    try {
      const result = await studentCallApi.upsert(payload);
      if (!result.ok) {
        mergeSavedCall(payload, previousCall, !previousCall);
        toast.error(result.error || "تعذر حفظ حالة التواصل.");
        return;
      }
      const data = result.data as { studentCall?: StudentCall | null; deleted?: boolean } | null;
      mergeSavedCall(payload, data?.studentCall || null, Boolean(data?.deleted));
      emitTeacherProDataChanged({
        source: "local-mutation",
        reason: "تحديث مكالمة طالب",
        scopes: ["follow-up", "students", "dashboard", "logs"],
        // الحالة أُدمجت من رد النظام بالفعل؛ ننبّه التبويبات الأخرى فقط كي لا
        // يعيد هذا التبويب تحميل نفسه ويستبدل النتيجة بطلب Sync أقدم.
        dispatchLocal: false,
      });
      toast.success("تم حفظ إجراء التواصل");
    } finally {
      setCallSaving(savingKey, false);
    }
  };

  const saveCallStudentNote = async (row: CallStudentRow, notes: string) => {
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
    if (!notes.trim() && !existing) return;
    const savingKey = `note:${row.student.id}`;
    setCallSaving(savingKey, true);
    callMutationVersionRef.current += 1;
    try {
      const result = await studentCallApi.upsert(payload);
      if (!result.ok) {
        toast.error(result.error || "تعذر حفظ ملاحظة المكالمات.");
        return;
      }
      const data = result.data as { studentCall?: StudentCall | null; deleted?: boolean } | null;
      mergeSavedCall(payload, data?.studentCall || null, Boolean(data?.deleted));
      setCallNoteDrafts((current) => {
        const next = { ...current };
        delete next[row.student.id];
        return next;
      });
      emitTeacherProDataChanged({
        source: "local-mutation",
        reason: "تحديث ملاحظات المكالمات",
        scopes: ["follow-up", "students", "dashboard", "logs"],
        dispatchLocal: false,
      });
      toast.success(notes.trim() ? "تم حفظ ملاحظة المكالمات" : "تم حذف ملاحظة المكالمات");
    } finally {
      setCallSaving(savingKey, false);
    }
  };

  const openProfile = (studentId: string) => {
    setProfileStudentId(studentId);
    setProfileDialogOpen(true);
  };

  const studentOpportunityText = (student: Student) =>
    formatOpportunityBalance(student, { separator: " / " });

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
          {leavePickerLoading && filteredStudents.length === 0 && (
            <p className="px-2 py-3 text-xs text-muted-foreground">جاري البحث…</p>
          )}
          {!leavePickerLoading && filteredStudents.length === 0 && (
            <p className="px-2 py-3 text-xs text-muted-foreground">
              لا توجد نتائج مطابقة
            </p>
          )}
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

  const leavesForDisplay = useMemo(() => {
    const normalizedSearch = debouncedLeaveSearch.trim();
    return leaveRowsFromDb
      .filter((leave) => {
        const relatedStudent =
          leave.student && typeof leave.student === "object"
            ? leave.student
            : null;
        const relatedExam =
          leave.exam && typeof leave.exam === "object" ? leave.exam : null;
        const student =
          students.find((item) => item.id === leave.studentId) ||
          relatedStudent;
        const exam =
          exams.find((item) => item.id === leave.examId) || relatedExam;
        const isPeriod = (leave.leaveType || "exam") === "period";
        if (leaveTypeFilter !== "all" && (isPeriod ? "period" : "exam") !== leaveTypeFilter)
          return false;
        if (!normalizedSearch) return true;
        return searchAny(normalizedSearch, [
          student?.name,
          student?.code,
          student?.phone,
          student?.telegram,
          exam?.name,
          leave.reason,
          leave.notes,
          leave.studyType,
          leave.date,
          leave.dateFrom,
          leave.dateTo,
        ]);
      })
      .sort((a, b) =>
        String(b.dateFrom || b.date || "").localeCompare(String(a.dateFrom || a.date || "")),
      );
  }, [
    debouncedLeaveSearch,
    leaveRowsFromDb,
    leaveTypeFilter,
    students,
    exams,
  ]);

  const leaveStats = useMemo(() => {
    const total = leaveRowsFromDb.length;
    const exam = leaveRowsFromDb.filter((leave) => (leave.leaveType || "exam") === "exam").length;
    const period = leaveRowsFromDb.filter((leave) => (leave.leaveType || "exam") === "period").length;
    const withNotes = leaveRowsFromDb.filter((leave) => Boolean(String(leave.notes || "").trim())).length;
    return { total, exam, period, withNotes };
  }, [leaveRowsFromDb]);

  const deleteLeaveServerFirst = async (leave: StudentLeave) => {
    if (leaveError || leaveLoading) {
      toast.error("انتظر تحميل الإجازات من بيانات النظام قبل الحذف.");
      return;
    }
    const ok = window.confirm(
      "سيتم حذف الإجازة من بيانات النظام واسترجاع أي درجات محفوظة احتياطياً ثم إعادة احتساب الطالب. هل تريد المتابعة؟",
    );
    if (!ok) return;

    setLeaveDeletingIds((current) => ({ ...current, [leave.id]: true }));
    const result = await studentLeaveApi.remove(leave.id);
    setLeaveDeletingIds((current) => ({ ...current, [leave.id]: false }));

    if (!result.ok || result.queued) {
      toast.error(result.error || "تعذر حذف الإجازة من النظام.");
      return;
    }

    setLeaveRowsFromDb((current) => current.filter((item) => item.id !== leave.id));
    emitTeacherProDataChanged({
      source: "local-mutation",
      reason: "student-leave-deleted",
      scopes: ["follow-up", "grades", "students", "opportunities", "dashboard"],
    });

    const response = (result.data || {}) as { restoredGradeCount?: number };
    const restored = Number(response.restoredGradeCount || 0);
    toast.success(
      restored > 0
        ? `تم حذف الإجازة واسترجاع ${restored} درجة/درجات ثم إعادة الاحتساب`
        : "تم حذف الإجازة وإعادة احتساب الطالب من بيانات النظام",
    );
  };

  const renderLeaveList = () => (
    <Card>
      <CardHeader>
        <CardTitle>الإجازات السابقة</CardTitle>
        <p className="text-sm text-muted-foreground">
          كل الإجازات هنا تأتي من بيانات النظام، وأي حذف يسترجع الدرجات المحفوظة احتياطياً قبل إعادة الاحتساب.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid gap-3 md:grid-cols-4">
          <div className="rounded-2xl border bg-muted/30 p-3">
            <p className="text-xs text-muted-foreground">إجمالي الإجازات</p>
            <b className="text-2xl">{leaveStats.total}</b>
          </div>
          <div className="rounded-2xl border bg-muted/30 p-3">
            <p className="text-xs text-muted-foreground">حسب الامتحان</p>
            <b className="text-2xl">{leaveStats.exam}</b>
          </div>
          <div className="rounded-2xl border bg-muted/30 p-3">
            <p className="text-xs text-muted-foreground">فترة زمنية</p>
            <b className="text-2xl">{leaveStats.period}</b>
          </div>
          <div className="rounded-2xl border bg-muted/30 p-3">
            <p className="text-xs text-muted-foreground">بملاحظات</p>
            <b className="text-2xl">{leaveStats.withNotes}</b>
          </div>
        </div>

        <div className="tp-filter-card tp-filter-grid grid-cols-1 p-4 md:grid-cols-[minmax(0,1fr)_220px]">
          <div className="tp-filter-field tp-filter-search">
            <Label htmlFor="leave-search" className="text-xs">
              بحث في الإجازات
            </Label>
            <Input
              id="leave-search"
              value={leaveSearch}
              onChange={(event) => setLeaveSearch(event.target.value)}
              placeholder="اسم / كود / هاتف / تيليجرام / امتحان / سبب / ملاحظة"
            />
          </div>
          <div className="tp-filter-field tp-filter-secondary">
            <Label htmlFor="leave-type-filter" className="text-xs">
              نوع الإجازة
            </Label>
            <Select
              value={leaveTypeFilter}
              onValueChange={(value) => setLeaveTypeFilter(value as "all" | LeaveMode)}
            >
              <SelectTrigger id="leave-type-filter">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">كل الإجازات</SelectItem>
                <SelectItem value="exam">حسب الامتحان</SelectItem>
                <SelectItem value="period">فترة زمنية</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {leaveLoading ? (
          <div className="space-y-2" aria-busy="true" aria-live="polite">
            {[0, 1, 2].map((index) => (
              <div key={index} className="h-20 animate-pulse rounded-2xl bg-muted" />
            ))}
          </div>
        ) : leaveError ? (
          <div className="rounded-2xl border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
            {leaveError}
          </div>
        ) : leavesForDisplay.length === 0 ? (
          <p className="empty-state py-6">لا توجد إجازات مطابقة للفلاتر الحالية</p>
        ) : (
          leavesForDisplay.map((leave) => {
            const relatedStudent =
              leave.student && typeof leave.student === "object"
                ? leave.student
                : null;
            const relatedExam =
              leave.exam && typeof leave.exam === "object" ? leave.exam : null;
            const student =
              students.find((item) => item.id === leave.studentId) ||
              relatedStudent;
            const exam =
              exams.find((item) => item.id === leave.examId) || relatedExam;
            const isPeriod = (leave.leaveType || "exam") === "period";
            const studentDisplayName = student?.name || "طالب غير محمل";
            const studentDisplayCode = student?.code
              ? ` (${student.code})`
              : "";
            const deleting = Boolean(leaveDeletingIds[leave.id]);
            return (
              <div
                key={leave.id}
                className="grid gap-2 rounded-2xl border bg-card/80 p-3 text-sm lg:grid-cols-[1.1fr_1fr_1.4fr_1fr_auto] lg:items-center"
              >
                <b>
                  {studentDisplayName}
                  {studentDisplayCode}
                </b>
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
                    disabled={deleting || leaveLoading || Boolean(leaveError)}
                    onClick={() => void deleteLeaveServerFirst(leave)}
                  >
                    {deleting ? "جاري الحذف..." : "حذف"}
                  </Button>
                </div>
                {leave.notes ? (
                  <p className="lg:col-span-5 rounded-xl bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                    ملاحظة: {leave.notes}
                  </p>
                ) : null}
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
        href={whatsappLink(phone || "")}
        target="_blank"
        rel="noreferrer"
      >
        {label}: {phone}
      </a>
    );
  };

  const callBadgeToneClass = (tone: CallBadgeTone) => {
    if (tone === "deducted")
      return "border-red-200 bg-red-50 text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-200";
    if (tone === "warning")
      return "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-100";
    if (tone === "safe")
      return "border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-900/50 dark:bg-sky-950/30 dark:text-sky-100";
    if (tone === "success")
      return "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/50 dark:bg-emerald-950/30 dark:text-emerald-100";
    return "border-border bg-muted/40 text-muted-foreground";
  };

  const renderCallImpactBadges = (item?: CallGradeItem | null) => {
    const badges = item?.badges || [];
    if (!badges.length) return null;
    return (
      <div className="mt-2 flex flex-wrap gap-1.5">
        {badges.map((badge, index) => (
          <Badge
            key={`${badge.label}-${index}`}
            variant="outline"
            title={badge.detail || badge.label}
            className={`max-w-full whitespace-normal text-start leading-5 ${callBadgeToneClass(badge.tone)}`}
          >
            {badge.label}
          </Badge>
        ))}
      </div>
    );
  };

  const renderTelegramLink = (telegram?: string) => {
    const normalizedTelegram = normalizeTelegramIdentifier(telegram || "");
    if (!normalizedTelegram) {
      return (
        <span className="rounded-xl border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
          التيليجرام: لا يوجد معرف
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
        التيليجرام: {normalizedTelegram}
      </a>
    );
  };

  const renderCallGradeChip = (row: CallStudentRow, item: CallGradeItem) => {
    const call = callLogForGrade(row.student, item);
    const value =
      item.category === "absent"
        ? "غائب"
        : formatGradeScore(item.grade, item.exam, "—");
    return (
      <div
        key={item.id}
        className="rounded-2xl border bg-muted/25 px-3 py-3 text-xs"
      >
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <b>{item?.exam?.name || "—"}</b>
              <Badge
                variant={
                  item.category === "absent" ||
                  item.category === "discounted" ||
                  item.category === "failed" ||
                  item.category === "academic-accounting" ||
                  item.category === "cheating"
                    ? "destructive"
                    : "secondary"
                }
              >
                {item?.label || "—"}
              </Badge>
            </div>
            <p className="text-[11px] text-muted-foreground">
              {item ? formatAppDate(item.exam.date) : "—"}
            </p>
          </div>
          <div className="rounded-xl bg-background px-3 py-2 text-center shadow-sm">
            <p className="text-[10px] text-muted-foreground">الدرجة</p>
            <p className="text-base font-black text-foreground">{value}</p>
          </div>
        </div>
        {renderCallImpactBadges(item)}
        {item?.category !== "absent" && item?.reason ? (
          <p className="mt-2 line-clamp-3 text-muted-foreground">{item.reason}</p>
        ) : null}
        {call ? (
          <p className="mt-2 text-[11px] text-muted-foreground">
            إجراء التواصل: {callStatusForLog(call) || "بدون إجراء"}
          </p>
        ) : null}
        {item.grade.notes ? (
          <div className="mt-2 rounded-xl border border-amber-200/70 bg-amber-50/90 px-2.5 py-2 text-[11px] text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/25 dark:text-amber-100">
            <span className="mb-1 block font-bold">ملاحظة الدرجة</span>
            <span className="line-clamp-4">{item.grade.notes}</span>
          </div>
        ) : null}
      </div>
    );
  };

  const renderCallLoadingSkeleton = () => (
    <div className="space-y-3" aria-live="polite" aria-busy="true">
      {[0, 1, 2].map((index) => (
        <div
          key={index}
          className="rounded-2xl border bg-card/80 p-4 text-sm shadow-sm"
        >
          <div className="flex flex-wrap items-center justify-between gap-3 border-b pb-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="h-5 w-36 animate-pulse rounded-full bg-muted" />
              <span className="h-6 w-20 animate-pulse rounded-full bg-muted" />
              <span className="h-6 w-24 animate-pulse rounded-full bg-muted" />
            </div>
            <span className="h-8 w-24 animate-pulse rounded-xl bg-muted" />
          </div>
          <div className="mt-3 grid gap-4 lg:grid-cols-3">
            <div className="space-y-3 rounded-xl border border-primary/10 bg-primary/5 p-3">
              <span className="block h-4 w-24 animate-pulse rounded-full bg-muted" />
              <span className="block h-5 w-44 animate-pulse rounded-full bg-muted" />
              <span className="block h-4 w-32 animate-pulse rounded-full bg-muted" />
            </div>
            <div className="space-y-2">
              <span className="block h-4 w-28 animate-pulse rounded-full bg-muted" />
              <div className="grid gap-2 sm:grid-cols-2">
                <span className="h-20 animate-pulse rounded-2xl bg-muted" />
                <span className="h-20 animate-pulse rounded-2xl bg-muted" />
              </div>
            </div>
            <div className="space-y-3">
              <span className="block h-4 w-28 animate-pulse rounded-full bg-muted" />
              <span className="block h-20 animate-pulse rounded-xl bg-muted" />
              <span className="block h-8 w-28 animate-pulse rounded-full bg-muted" />
            </div>
          </div>
        </div>
      ))}
    </div>
  );

  const renderCallRow = (row: CallStudentRow) => {
    const item = row.focusItem;
    const call = callLogForRow(row);
    const contactStatus = callStatusForLog(call);
    const callStudentNote = callNoteForStudent(row.student.id);
    const displayMode = callGradeDisplayModes[row.student.id] || "latest";
    const statusSavingKey = item
      ? `status:${row.student.id}:${item.exam.id}:${item.callKey}`
      : "";
    const noteSavingKey = `note:${row.student.id}`;
    const noteValue = Object.prototype.hasOwnProperty.call(callNoteDrafts, row.student.id)
      ? callNoteDrafts[row.student.id]
      : callStudentNote?.notes || "";
    const displayedGradeItems = visibleCallGradeItems(row.items, displayMode);
    const historyGradeItems = displayedGradeItems.filter(
      (gradeItem) => gradeItem.id !== row.focusItem?.id,
    );
    const focusValue = item
      ? item.category === "absent"
        ? "غائب"
        : formatGradeScore(item.grade, item.exam, "—")
      : "—";
    return (
      <div
        key={row.id}
        className="rounded-3xl border bg-card/90 p-4 text-sm shadow-sm transition-colors hover:border-primary/25"
      >
        <div className="flex flex-wrap items-start justify-between gap-3 border-b pb-4">
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <b className="text-lg leading-tight">{row.student.name}</b>
              <Badge variant="outline">{row.student.code}</Badge>
              <Badge
                variant={
                  row.student.status === "نشط" ? "secondary" : "destructive"
                }
              >
                {row.student.status}
              </Badge>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span
                className={`inline-flex items-center gap-1 rounded-full px-3 py-1 text-sm font-black ${
                  getOpportunityLimit(row.student) === null
                    ? "bg-muted text-muted-foreground"
                    : Number(row.student.opportunities || 0) === 0
                      ? "bg-red-500/15 text-red-600 dark:text-red-400"
                      : Number(row.student.opportunities || 0) <= 1
                        ? "bg-amber-500/15 text-amber-600 dark:text-amber-400"
                        : "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
                }`}
              >
                الفرص: {studentOpportunityText(row.student)}
              </span>
              <span className="text-xs text-muted-foreground">
                {row.items.length} امتحان/امتحانات مرتبطة بهذه الدورة
              </span>
            </div>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="rounded-full"
            onClick={() => openProfile(row.student.id)}
          >
            ملف الطالب
          </Button>
        </div>

        <div className="mt-4 grid gap-4 xl:grid-cols-[1.15fr_0.95fr]">
          <div className="space-y-4">
            <div className="rounded-2xl border border-primary/20 bg-primary/5 p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="space-y-2">
                  <p className="text-xs font-bold text-muted-foreground">
                    محور المتابعة
                  </p>
                  <div className="flex flex-wrap items-center gap-2">
                    <b className="text-base">{item?.exam?.name || "—"}</b>
                    <Badge
                      variant={
                        item?.category === "absent" ||
                        item?.category === "discounted" ||
                        item?.category === "failed" ||
                        item?.category === "academic-accounting" ||
                        item?.category === "cheating"
                          ? "destructive"
                          : "secondary"
                      }
                    >
                      {item?.label || "—"}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {item ? formatAppDate(item.exam.date) : "—"}
                  </p>
                  {item?.category !== "absent" && item?.reason ? (
                    <p className="max-w-2xl text-xs leading-6 text-muted-foreground">
                      {item.reason}
                    </p>
                  ) : null}
                </div>

                <div className="min-w-[132px] rounded-2xl border bg-background px-4 py-3 text-center shadow-sm">
                  <p className="text-[11px] font-bold text-muted-foreground">
                    الدرجة الحالية
                  </p>
                  <p
                    className={`mt-1 text-3xl font-black tracking-tight ${
                      !item
                        ? "text-muted-foreground"
                        : item.category === "absent"
                          ? "text-red-600 dark:text-red-400"
                          : item.category === "discounted" || item.category === "failed"
                            ? "text-amber-600 dark:text-amber-400"
                            : item.category === "cheating"
                              ? "text-red-600 dark:text-red-400"
                              : item.category === "passed" || item.category === "full"
                                ? "text-emerald-600 dark:text-emerald-400"
                                : "text-primary"
                    }`}
                  >
                    {focusValue}
                  </p>
                </div>
              </div>
              {renderCallImpactBadges(item)}
            </div>

            <div className="rounded-2xl border bg-muted/20 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-xs font-bold text-muted-foreground">
                    سجل الامتحانات
                  </p>
                  <p className="text-[11px] text-muted-foreground">
                    لعرض امتحانات الطالب بدون تكرار محور المتابعة أعلاه
                  </p>
                </div>
                <div className="flex flex-wrap gap-1">
                  {(
                    Object.keys(
                      callGradeDisplayModeLabels,
                    ) as CallGradeDisplayMode[]
                  ).map((mode) => (
                    <Button
                      key={mode}
                      type="button"
                      size="sm"
                      variant={displayMode === mode ? "default" : "outline"}
                      className="h-8 rounded-full px-3 text-[11px]"
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
                <p className="mt-3 rounded-xl border border-dashed bg-background/70 p-3 text-xs text-muted-foreground">
                  لا توجد درجات مسجلة لهذا الطالب ضمن امتحانات هذه الدورة.
                </p>
              ) : historyGradeItems.length === 0 ? (
                <p className="mt-3 rounded-xl border border-dashed bg-background/70 p-3 text-xs text-muted-foreground">
                  لا توجد امتحانات إضافية لعرضها غير محور المتابعة الحالي.
                </p>
              ) : (
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  {historyGradeItems.map((gradeItem) =>
                    renderCallGradeChip(row, gradeItem),
                  )}
                </div>
              )}
            </div>
          </div>

          <div className="space-y-4">
            <div className="rounded-2xl border bg-muted/15 p-4">
              <p className="mb-3 text-xs font-bold text-muted-foreground">
                التواصل والإجراء
              </p>
              <div className="space-y-3">
                <div className="flex flex-wrap gap-2">
                  {renderPhoneLink("الطالب", row.student.phone)}
                  {renderPhoneLink("ولي الأمر", row.student.parentPhone)}
                  {renderTelegramLink(row.student.telegram)}
                </div>

                <div className="space-y-2">
                  <Label className="text-xs text-muted-foreground">
                    إجراء التواصل
                  </Label>
                  <Select
                    value={contactStatusSelectValue(contactStatus)}
                    disabled={!row.focusItem || Boolean(callSavingKeys[statusSavingKey])}
                    onValueChange={(value) =>
                      void saveCallStatus(row, contactStatusFromSelectValue(value))
                    }
                  >
                    <SelectTrigger className="h-11 rounded-2xl">
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
                    className={`rounded-2xl border px-3 py-2 text-xs font-bold ${contactStatusClasses(contactStatus)}`}
                  >
                    {callSavingKeys[statusSavingKey]
                      ? "جاري حفظ إجراء التواصل..."
                      : contactStatus || "بدون إجراء"}
                  </div>
                  {call?.completedAt ? (
                    <p className="text-xs text-muted-foreground">
                      آخر تواصل: {formatAppDate(call.completedAt)}
                    </p>
                  ) : null}
                </div>
              </div>
            </div>

            <div className="rounded-2xl border bg-muted/15 p-4">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <Label className="text-xs font-bold text-muted-foreground">
                  ملاحظات المكالمات
                </Label>
                <span className="text-[11px] text-muted-foreground">
                  حفظ تلقائي عند مغادرة الحقل، أو حفظ مباشر من الزر
                </span>
              </div>
              <textarea
                className="min-h-28 w-full rounded-2xl border border-input bg-background px-3 py-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                value={noteValue}
                onChange={(event) =>
                  setCallNoteDrafts((current) => ({
                    ...current,
                    [row.student.id]: event.target.value,
                  }))
                }
                onBlur={(event) => void saveCallStudentNote(row, event.target.value)}
                placeholder="دوّن ملاحظة مختصرة وواضحة تخص تواصل هذا الطالب أو ولي أمره"
              />
              <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                <span
                  className={`tp-save-indicator ${
                    callSavingKeys[noteSavingKey]
                      ? "tp-save-indicator--saving"
                      : Object.prototype.hasOwnProperty.call(callNoteDrafts, row.student.id)
                        ? "tp-save-indicator--pending"
                        : "tp-save-indicator--saved"
                  }`}
                >
                  {callSavingKeys[noteSavingKey]
                    ? "جارٍ حفظ الملاحظة..."
                    : Object.prototype.hasOwnProperty.call(callNoteDrafts, row.student.id)
                      ? "تعديل غير محفوظ — سيُحفظ عند مغادرة الحقل"
                      : "محفوظة من بيانات النظام"}
                </span>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="tp-save-manual-button h-8 rounded-full px-3 text-[11px]"
                  title="حفظ الملاحظة مباشرة"
                  disabled={Boolean(callSavingKeys[noteSavingKey])}
                  onClick={() => void saveCallStudentNote(row, noteValue)}
                >
                  حفظ الآن
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  };

  const togglePledge = async (row: PledgeRow, checked: boolean) => {
    if (pledgeLoading || pledgeError) {
      toast.error("انتظر تحميل التعهدات من بيانات النظام قبل تنفيذ الإجراء.");
      return;
    }

    const { student, dismissalInfo } = row;
    const key = row.note?.id || row.key;
    setPledgeSavingKeys((current) => ({ ...current, [key]: true }));

    const result = await pledgeApi.action({
      action: checked ? "pledge-and-reactivate" : "remove-pledge",
      studentId: student.id,
      dismissalInfo,
      noteId: row.note?.id,
    });

    setPledgeSavingKeys((current) => ({ ...current, [key]: false }));

    if (!result.ok || result.queued) {
      toast.error(result.error || "تعذر تنفيذ إجراء التعهد من النظام.");
      return;
    }

    const payload = (result.data || {}) as PledgeActionResponse;
    if (payload.student) {
      mergeStudentsCache([payload.student as unknown as Student]);
    }

    emitTeacherProDataChanged({
      source: "local-mutation",
      reason: checked ? "pledge-and-reactivate" : "pledge-remove",
      scopes: ["follow-up", "students", "opportunities", "dismissed", "dashboard"],
    });

    const refreshed = await pledgeApi.list({
      q: debouncedPledgeSearch,
      typeFilter: pledgeTypeFilter,
      statusFilter: pledgeStatusFilter,
    });

    if (refreshed) {
      const nextRows = (refreshed.rows || []) as unknown as PledgeRow[];
      setPledgeRowsFromDb(nextRows);
      setPledgeDatabaseStats(refreshed.stats || null);
      mergeStudentsCache(nextRows.map((nextRow) => nextRow.student).filter(Boolean) as Student[]);
    }

    toast.success(
      checked
        ? "تم تثبيت التعهد وإعادة تفعيل الطالب من بيانات النظام."
        : "تم إلغاء التعهد المرتبط بهذا الفصل من بيانات النظام.",
    );
  };

  const openPledgeWhatsApp = async (row: PledgeRow) => {
    const phone = row.student.parentPhone || "";
    const digits = phoneForWhatsApp(sanitizePhoneInput(phone));
    if (!digits) {
      toast.error("رقم ولي الأمر غير متوفر أو غير صالح لهذا الطالب.");
      return;
    }

    const key = row.note?.id || row.key;
    if (pledgeWhatsAppLoadingKeys[key]) return;

    const whatsappWindow = window.open("about:blank", "_blank");
    if (whatsappWindow) {
      whatsappWindow.opener = null;
      whatsappWindow.document.title = "جاري تجهيز تقرير الدرجات";
      whatsappWindow.document.body.textContent =
        "جاري تحميل تقرير درجات الطالب من النظام…";
    }

    setPledgeWhatsAppLoadingKeys((current) => ({ ...current, [key]: true }));
    try {
      const result = await gradeApi.listAll({ studentId: row.student.id });
      if (!result) {
        whatsappWindow?.close();
        toast.error("تعذر تحميل تقرير درجات الطالب من النظام.");
        return;
      }

      const grades = [...(result.grades || [])].sort((left, right) => {
        const leftExam = (left.exam || {}) as Record<string, unknown>;
        const rightExam = (right.exam || {}) as Record<string, unknown>;
        return (
          new Date(String(rightExam.date || 0)).getTime() -
          new Date(String(leftExam.date || 0)).getTime()
        );
      });
      const url = whatsappMessageLink(phone, pledgeWhatsAppMessage(grades));
      if (whatsappWindow) whatsappWindow.location.href = url;
      else window.location.assign(url);
    } catch {
      whatsappWindow?.close();
      toast.error("تعذر تجهيز رسالة التعهد وتقرير الدرجات.");
    } finally {
      setPledgeWhatsAppLoadingKeys((current) => ({ ...current, [key]: false }));
    }
  };

  const renderPledgeRow = (row: PledgeRow) => {
    const { student, dismissalInfo, group, pledged, reactivated } = row;
    const rowKey = row.note?.id || row.key;
    const saving = Boolean(pledgeSavingKeys[rowKey]);
    const openingWhatsApp = Boolean(pledgeWhatsAppLoadingKeys[rowKey]);
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
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-auto rounded-xl border-emerald-500/40 px-3 py-2 text-xs font-bold text-emerald-700 underline hover:bg-emerald-500/10 dark:text-emerald-300"
            disabled={openingWhatsApp || !student.parentPhone}
            onClick={() => void openPledgeWhatsApp(row)}
          >
            {openingWhatsApp
              ? "جاري تجهيز التقرير…"
              : `رقم ولي الأمر: ${student.parentPhone || "غير متوفر"}`}
          </Button>
        </div>
        <label className="flex cursor-pointer items-center justify-between gap-3 rounded-2xl border bg-muted/30 px-3 py-2">
          <span className="text-sm font-bold">{saving ? "جاري الحفظ..." : "التعهد"}</span>
          <Checkbox
            checked={pledged}
            disabled={saving || pledgeLoading || Boolean(pledgeError)}
            onCheckedChange={(value) => void togglePledge(row, Boolean(value))}
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
        studentLeaves={leaveRowsFromDb.length ? leaveRowsFromDb : studentLeaves}
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
    <div className={`space-y-5 tp-follow-up-page tp-follow-up-page--${view}`}>
      <Card className="overflow-hidden tp-follow-up-page__intro">
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
                            {exam.name} - {formatAppDate(exam.date)} {exam.active ? "" : "(معطل)"}
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
                  نوع البرنامج: <b>{selectedLeaveStudent.studyType || "—"}</b>
                </p>
              )}
              <Button
                className="w-full"
                onClick={() => void saveLeave()}
                disabled={leaveSaving || leaveLoading || Boolean(leaveError)}
              >
                {leaveSaving ? "جاري الحفظ..." : "حفظ الإجازة"}
              </Button>
            </CardContent>
          </Card>
          {renderLeaveList()}
        </div>
      )}

      {view === "calls" && (
        <div className="space-y-4">
          <Card className="tp-filter-card">
            <CardHeader>
              <CardTitle>المكالمات المرتبطة بسجل الدرجات</CardTitle>
              <p className="text-sm text-muted-foreground">
                اختر الدورة أولاً، بعدها تظهر امتحاناتها فقط، ثم تظهر قائمة طلاب
                الدورة حسب الامتحان المختار وحالة الدرجة.
              </p>
            </CardHeader>
            <CardContent className="tp-filter-content space-y-4">
              <div className="tp-filter-grid grid-cols-1 md:grid-cols-6">
                <div className="tp-filter-field tp-filter-primary">
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
                      <SelectItem value="__none__">بدون اختيار دورة</SelectItem>
                      {courses.map((course) => (
                        <SelectItem key={course.id} value={course.id}>
                          {course.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="tp-filter-field tp-filter-primary">
                  <Label>الامتحان</Label>
                  <Select
                    value={callExamId || "__none__"}
                    disabled={!callCourseSelected || callCourseExamsLoading}
                    onValueChange={(value) => {
                      setCallExamId(value === "__none__" ? "" : value);
                      setCallGradePage(1);
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="اختر امتحان الدورة" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">
                        بدون اختيار امتحان
                      </SelectItem>
                      {callCourseExams.map((exam) => (
                        <SelectItem key={exam.id} value={exam.id}>
                          {exam.name} - {formatAppDate(exam.date)} {exam.active ? "" : "(معطل)"}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="tp-filter-field tp-filter-secondary">
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
                <div className="tp-filter-field tp-filter-search md:col-span-2">
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
                    placeholder="اسم / كود / هاتف / تيليجرام / مدرسة / امتحان / درجة"
                  />
                </div>
                <div className="tp-filter-field tp-filter-search md:col-span-2">
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
                <div className="tp-filter-field tp-filter-actions">
                  <Label>تصدير</Label>
                  {callExamSelected ? (
                    <ExportDialog
                      title="تصدير المكالمات"
                      fileName={callExportFileName}
                      rows={callExportRows}
                      fetchRows={fetchCallExportRows}
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
                  تم اختيار الدورة. اختر امتحاناً من امتحانات هذه الدورة لعرض
                  الطلاب. مصدر الامتحانات هنا بيانات النظام، وليس البيانات المؤقتة المحلية.
                </p>
              ) : callLoading ? (
                <div className="rounded-2xl border bg-muted/30 p-3 text-sm text-muted-foreground">
                  <div className="flex items-center gap-2">
                    <span className="h-2 w-2 animate-pulse rounded-full bg-primary" />
                    <span>جاري تحميل طلاب ودرجات هذه الدورة من بيانات النظام...</span>
                  </div>
                </div>
              ) : null}
            </CardContent>
          </Card>
          <CountScopeSummary
            subject="الطلاب"
            filteredTotal={callStatValue(callDatabaseStats?.total)}
            pageCount={visibleCallRows.length}
            className="md:grid-cols-2"
          />
          <div className="grid gap-3 md:grid-cols-4">
            <Card className="border-dashed border-sky-500/35 bg-sky-500/5" data-count-scope="filtered">
              <CardContent className="p-4">
                <p className="text-xs text-muted-foreground">تم الاتصال</p>
                <b className="text-2xl">
                  {callStatValue(callDatabaseStats?.contacted)}
                </b>
              </CardContent>
            </Card>
            <Card className="border-dashed border-sky-500/35 bg-sky-500/5" data-count-scope="filtered">
              <CardContent className="p-4">
                <p className="text-xs text-muted-foreground">لم يرد</p>
                <b className="text-2xl">
                  {callStatValue(callDatabaseStats?.unanswered)}
                </b>
              </CardContent>
            </Card>
            <Card className="border-dashed border-sky-500/35 bg-sky-500/5" data-count-scope="filtered">
              <CardContent className="p-4">
                <p className="text-xs text-muted-foreground">الرقم خاطئ</p>
                <b className="text-2xl">
                  {callStatValue(callDatabaseStats?.wrong)}
                </b>
              </CardContent>
            </Card>
            <Card className="border-dashed border-sky-500/35 bg-sky-500/5" data-count-scope="filtered">
              <CardContent className="p-4">
                <p className="text-xs text-muted-foreground">بدون إجراء</p>
                <b className="text-2xl">
                  {callStatValue(callDatabaseStats?.noAction)}
                </b>
              </CardContent>
            </Card>
          </div>
          <Card>
            <CardHeader>
              <CardTitle>قائمة الطلاب ودرجاتهم</CardTitle>
              <p className="text-sm text-muted-foreground">
                لا تظهر القائمة إلا بعد اختيار دورة ثم امتحان. كل شيء داخل هذه التبويبة
                يأتي من بيانات النظام: الطلاب، الدرجات، آخر امتحانين، المكالمات، والملاحظات.
              </p>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl bg-muted/40 px-3 py-2 text-sm">
                <span>
                  المطابقون للفلاتر:{" "}
                  <b>
                    {callStatValue(callDatabaseStats?.total)}
                  </b>
                </span>
                <span>
                  الصفحة <b>{callSafePage}</b> من <b>{callTotalPages}</b> · المعروض في الصفحة: <b>{visibleCallRows.length}</b>
                </span>
              </div>
              {!callExamSelected ? (
                <p className="empty-state py-8">
                  اختر الدورة ثم الامتحان لعرض الطلاب.
                </p>
              ) : callLoading && visibleCallRows.length === 0 ? (
                renderCallLoadingSkeleton()
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
                <b className="text-2xl">{pledgeStatValue(pledgeDatabaseStats?.dismissed)}</b>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <p className="text-xs text-muted-foreground">فصل مؤقت</p>
                <b className="text-2xl">{pledgeStatValue(pledgeDatabaseStats?.temporary)}</b>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <p className="text-xs text-muted-foreground">فصل نهائي</p>
                <b className="text-2xl">{pledgeStatValue(pledgeDatabaseStats?.final)}</b>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <p className="text-xs text-muted-foreground">تم التعهد</p>
                <b className="text-2xl">{pledgeStatValue(pledgeDatabaseStats?.pledged)}</b>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <p className="text-xs text-muted-foreground">
                  تم التعهد وإعادة التفعيل
                </p>
                <b className="text-2xl">{pledgeStatValue(pledgeDatabaseStats?.reactivated)}</b>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <p className="text-xs text-muted-foreground">بانتظار التعهد</p>
                <b className="text-2xl">{pledgeStatValue(pledgeDatabaseStats?.pending)}</b>
              </CardContent>
            </Card>
          </div>

          {pledgeLoading ? (
            <div className="rounded-2xl border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
              جاري تحميل التعهدات من بيانات النظام...
            </div>
          ) : pledgeError ? (
            <div className="rounded-2xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
              {pledgeError}
            </div>
          ) : (
            <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-700 dark:text-emerald-300">
              التعهدات محملة من بيانات النظام، وتثبيت التعهد مع إعادة التفعيل يتم كإجراء واحد آمن من النظام.
            </div>
          )}

          <Card className="tp-filter-card">
            <CardContent className="tp-filter-content tp-filter-grid grid-cols-1 md:grid-cols-3">
              <div className="tp-filter-field tp-filter-primary">
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
              <div className="tp-filter-field tp-filter-secondary">
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
              <div className="tp-filter-field tp-filter-search">
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
              {pledgeLoading ? (
                <div className="space-y-2">
                  {Array.from({ length: 4 }).map((_, index) => (
                    <div
                      key={index}
                      className="h-24 animate-pulse rounded-2xl border bg-muted/40"
                    />
                  ))}
                </div>
              ) : pledgeRows.length === 0 ? (
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
