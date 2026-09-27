"use client";
import { useTeacherProBackgroundSyncDetector, useTeacherProSyncKey } from "@/hooks/use-teacherpro-sync";

import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  useTeacherStore,
  type Exam,
  type Grade,
  type Student,
  type StudentCall,
} from "@/lib/teacher-store";
import {
  callCandidatesApi,
  callCourseExamsApi,
  callStatsApi,
  studentCallApi,
  type CallStatsResponse,
} from "@/lib/api";
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
import { toast } from "@/lib/user-toast";
import { formatAppDate, sanitizePhoneInput } from "@/lib/format";
import { normalizeTelegramIdentifier } from "@/lib/student-utils";
import { StudentProfileDialog } from "./student-profile-dialog";
import { CallPhoneQr } from "./call-phone-qr";
import { ExportDialog, type ExportColumn } from "./export-dialog";
import { CountScopeSummary } from "./ui-kit";
import { formatGradeScore } from "@/lib/exam-utils";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { emitTeacherProDataChanged } from "@/lib/teacherpro-sync";
import { formatOpportunityBalance, getOpportunityLimit } from "@/lib/opportunity-balance";
import { baghdadTodayKey } from "@/lib/baghdad-time";
import { CALL_STUDENT_NOTE_CATEGORY } from "@/lib/call-notes-filter";
import {
  isStudentExamCall,
  studentExamCallIdentityKey,
  studentExamCallIdentityMatches,
} from "@/lib/call-identity";

// «الإجازات» moved to the «إدارة الإجازات» window on the dashboard.
type FollowView = "calls";
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
  | "all"
  | "absent"
  | "discounted"
  | "failed"
  | "cheating"
  | "passed"
  | "full"
  | "protected"
  | "dismissed";
type CallGradeDisplayMode = "latest" | "latest-two" | "all";
type CallContactStatusFilter =
  | "all"
  | "no-action"
  | "contacted"
  | "unanswered"
  | "wrong";
type CallNotesFilter = "all" | "with-notes";
type CallBadgeTone = "deducted" | "warning" | "safe" | "success" | "neutral";
type CallBadgeInfo = { label: string; tone: CallBadgeTone; detail?: string };
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

const viewTitles: Record<FollowView, string> = {
  calls: "المكالمات",
};

const callStatusFilterLabels: Record<CallStatusFilter, string> = {
  all: "كل الحالات",
  absent: "الغائبين",
  discounted: "المخصومين",
  failed: "الراسبين غير المخصومين",
  cheating: "طلاب الغش",
  passed: "الطلاب الناجحين",
  full: "الدرجات الكاملة",
  protected: "المحميون (مجاز/سماح/قبل التسجيل)",
  dismissed: "المفصولين",
};

const callStatusFilterOptions = Object.keys(
  callStatusFilterLabels,
) as CallStatusFilter[];

const callContactStatusFilterLabels: Record<CallContactStatusFilter, string> = {
  all: "كل حالات التواصل",
  "no-action": "بدون إجراء",
  contacted: "تم الاتصال",
  unanswered: "لم يرد",
  wrong: "الرقم خاطئ",
};

const callContactStatusFilterOptions = Object.keys(
  callContactStatusFilterLabels,
) as CallContactStatusFilter[];

const callNotesFilterLabels: Record<CallNotesFilter, string> = {
  all: "كل الطلاب",
  "with-notes": "لديهم ملاحظات",
};

const callNotesFilterOptions = Object.keys(
  callNotesFilterLabels,
) as CallNotesFilter[];

function callStatusSupportsGradeRange(status: CallStatusFilter): boolean {
  // "absent" و "cheating" ليس لديهما درجة رقمية. "protected" قد يحمل
  // درجة فعلية (مثل درجات ما قبل التسجيل) لذا ندعم نطاق الدرجة لها.
  return status !== "absent" && status !== "cheating";
}

const callGradeDisplayModeLabels: Record<CallGradeDisplayMode, string> = {
  latest: "آخر امتحان",
  "latest-two": "آخر امتحانين",
  all: "جميع الامتحانات",
};

const CONTACT_STATUS_EMPTY_VALUE = "__empty__";
const contactStatusOptions: Array<{
  value: typeof CONTACT_STATUS_EMPTY_VALUE | Exclude<ContactStatus, "">;
  label: string;
}> = [
  { value: CONTACT_STATUS_EMPTY_VALUE, label: "بدون إجراء" },
  { value: "تم الاتصال", label: "تم الاتصال" },
  { value: "لم يرد", label: "لم يرد" },
  { value: "الرقم خاطئ", label: "الرقم خاطئ" },
];
// Each call row is a full interaction card (history, contact status, notes and
// actions). Rendering 120 cards at once creates thousands of DOM nodes and can
// hold React's scheduler for hundreds of milliseconds. Counts and exports are
// server-driven, so a smaller UI page keeps the complete result set intact.
const CALL_PAGE_SIZE = 30;

const callExportColumns: ExportColumn<CallExportRow>[] = [
  {
    key: "student",
    label: "الطالب",
    value: ({ row }) => row.student.name || "",
  },
  { key: "code", label: "الكود", value: ({ row }) => row.student.code || "" },
  {
    key: "username",
    label: "يوزر تيليجرام",
    value: ({ row }) => row.student.username || "",
  },
  {
    key: "course",
    label: "اسم الدورة",
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

function telegramLink(telegram: string): string {
  const username = normalizeTelegramIdentifier(telegram).replace(/^@+/, "");
  // المعرفات الرقمية لا تصلح لروابط تيليجرام.
  if (!username || /^\d+$/.test(username)) return "#";
  // فتح المحادثة داخل تطبيق تيليجرام مباشرة بدل نسخة الويب.
  return `tg://resolve?domain=${encodeURIComponent(username)}`;
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
    return "border-success-line bg-success-soft text-success";
  if (status === "لم يرد")
    return "border-danger-line bg-danger-soft text-danger";
  if (status === "الرقم خاطئ")
    return "border-info-line bg-info-soft text-info";
  return "border-muted bg-muted/40 text-muted-foreground";
}

function FollowUpViewBase({ view }: { view: FollowView }) {
  const syncKey = useTeacherProSyncKey(["follow-up", "students", "grades", "exams", "opportunities", "dashboard"]);
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
    currentUser,
  } = useTeacherStore();

  const callActor = currentUser();
  const canManageCalls = Boolean(callActor && (
    callActor.username?.trim().toLowerCase() === "admin" ||
    callActor.roleId === "role_admin" ||
    callActor.permissions?.includes("follow-up.calls.manage") ||
    callActor.permissions?.includes("follow-up.manage")
  ));

  const [callCourseId, setCallCourseId] = useState("");
  const [callExamId, setCallExamId] = useState("");
  const [callStatusFilter, setCallStatusFilter] =
    useState<CallStatusFilter>("all");
  const [callContactStatusFilter, setCallContactStatusFilter] =
    useState<CallContactStatusFilter>("all");
  const [callNotesFilter, setCallNotesFilter] =
    useState<CallNotesFilter>("all");
  const [callGradeFrom, setCallGradeFrom] = useState("");
  const [callGradeTo, setCallGradeTo] = useState("");
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
  const [callFilterRefreshKey, setCallFilterRefreshKey] = useState(0);
  const [callNoteDrafts, setCallNoteDrafts] = useState<Record<string, string>>({});
  const callNoteDraftRevisionsRef = useRef<Record<string, number>>({});
  const callNoteDraftIdsRef = useRef<Record<string, string | null>>({});
  const [callNoteConflicts, setCallNoteConflicts] = useState<Record<string, StudentCall | null>>({});
  const callNoteSavingRef = useRef(new Set<string>());
  const [callServerPageInfo, setCallServerPageInfo] = useState({
    totalCount: 0,
    totalPages: 1,
    hasMore: false,
  });
  const [callDatabaseStats, setCallDatabaseStats] =
    useState<CallStatsResponse | null>(null);
  const [callDatabaseStatsLoading, setCallDatabaseStatsLoading] =
    useState(false);
  const [callGradeDisplayModes, setCallGradeDisplayModes] = useState<
    Record<string, CallGradeDisplayMode>
  >({});
  const debouncedCallGeneralSearch = useDebouncedValue(callGeneralSearch, 300);
  const debouncedCallFilterSearch = useDebouncedValue(callFilterSearch, 300);
  const debouncedCallGradeFrom = useDebouncedValue(callGradeFrom, 300);
  const debouncedCallGradeTo = useDebouncedValue(callGradeTo, 300);
  const callGradeRangeEnabled = callStatusSupportsGradeRange(callStatusFilter);
  const effectiveCallGradeFrom = callGradeRangeEnabled
    ? debouncedCallGradeFrom
    : "";
  const effectiveCallGradeTo = callGradeRangeEnabled
    ? debouncedCallGradeTo
    : "";

  const [profileStudentId, setProfileStudentId] = useState("");
  const [profileDialogOpen, setProfileDialogOpen] = useState(false);

  useEffect(() => {
    setCallExamId("");
    setCallStatusFilter("all");
    setCallContactStatusFilter("all");
    setCallNotesFilter("all");
    setCallGradeFrom("");
    setCallGradeTo("");
    setCallFilterSearch("");
    setCallGradePage(1);
    setCallGradeDisplayModes({});
  }, [callCourseId]);

  useEffect(() => {
    setCallStatusFilter("all");
    setCallContactStatusFilter("all");
    setCallNotesFilter("all");
    setCallGradeFrom("");
    setCallGradeTo("");
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
          toast.error("تعذر تحميل امتحانات المكالمات.");
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
    let responseApplied = false;
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
          contactStatusFilter: callContactStatusFilter,
          notesFilter: callNotesFilter,
          gradeFrom: effectiveCallGradeFrom,
          gradeTo: effectiveCallGradeTo,
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
        responseApplied = true;
        // تحديث صفحة كاملة من بطاقات المكالمات عمل واجهة غير عاجل. الانتقال
        // يسمح لـ React بتقسيم الرسم بدل حبس الـmain thread في message task واحدة.
        React.startTransition(() => {
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
          setCallLoading(false);
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
          if (!responseApplied) setCallLoading(false);
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
    callContactStatusFilter,
    callNotesFilter,
    effectiveCallGradeFrom,
    effectiveCallGradeTo,
    debouncedCallGeneralSearch,
    debouncedCallFilterSearch,
    callGradePage,
    callFilterRefreshKey,
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
            contactStatusFilter: callContactStatusFilter,
            notesFilter: callNotesFilter,
            gradeFrom: effectiveCallGradeFrom,
            gradeTo: effectiveCallGradeTo,
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
    callContactStatusFilter,
    callNotesFilter,
    effectiveCallGradeFrom,
    effectiveCallGradeTo,
    debouncedCallGeneralSearch,
    debouncedCallFilterSearch,
    callFilterRefreshKey,
    syncKey,
    isBackgroundSync,
  ]);

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
  const callGradeFromNumber = callGradeFrom.trim() ? Number(callGradeFrom) : null;
  const callGradeToNumber = callGradeTo.trim() ? Number(callGradeTo) : null;
  const callGradeRangeInvalid =
    callGradeFromNumber !== null &&
    Number.isFinite(callGradeFromNumber) &&
    callGradeToNumber !== null &&
    Number.isFinite(callGradeToNumber) &&
    callGradeFromNumber > callGradeToNumber;
  const callExportDocumentTitle = selectedCallExam
    ? `${selectedCallCourse?.name || "الدورة"} - ${selectedCallExam.name}`
    : "المكالمات";
  const callExportFileName = selectedCallExam
    ? `المكالمات-${selectedCallCourse?.name || "الدورة"}-${selectedCallExam.name}`
    : "المكالمات";
  const effectiveStudentCalls = callPageStudentCalls;

  const callLogLookup = useMemo(() => {
    const map = new Map<string, (typeof effectiveStudentCalls)[number]>();
    effectiveStudentCalls.forEach((call) => {
      if (!isStudentExamCall(call)) return;
      const key = studentExamCallIdentityKey(call.studentId, call.examId);
      // API results are newest-first, so the first row wins if historical
      // category-based duplicates still exist before opportunistic cleanup.
      if (!map.has(key)) map.set(key, call);
    });
    return map;
  }, [effectiveStudentCalls]);

  const callLogForGrade = (student: Student, item: CallGradeItem) =>
    callLogLookup.get(studentExamCallIdentityKey(student.id, item.exam.id));

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
      const key = studentExamCallIdentityKey(call.studentId, call.examId);
      if (call.category === CALL_STUDENT_NOTE_CATEGORY && !map.has(key))
        map.set(key, call);
    });
    return map;
  }, [effectiveStudentCalls]);

  const callNoteForStudent = (studentId: string, examId = callExamId) =>
    callStudentNoteLookup.get(studentExamCallIdentityKey(studentId, examId));

  const callNoteExportText = (lookup: Map<string, StudentCall>, studentId: string, examId: string) => {
    const examNote = lookup.get(studentExamCallIdentityKey(studentId, examId))?.notes || "";
    const generalNote = lookup.get(studentExamCallIdentityKey(studentId, ""))?.notes || "";
    return [examNote, generalNote ? `ملاحظة عامة سابقة: ${generalNote}` : ""].filter(Boolean).join("\n");
  };

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

  const callExportRows = callRows.map((row) => ({
    row,
    status: callStatusForLog(callLogForRow(row)),
    note: callNoteExportText(callStudentNoteLookup, row.student.id, callExamId),
    courseName,
  }));

  const fetchCallExportRows = async (): Promise<CallExportRow[]> => {
    if (!callCourseId || !callExamId || !selectedCallExam) return [];
    const result = await callCandidatesApi.listAll({
      courseId: callCourseId,
      examId: callExamId,
      statusFilter: callStatusFilter,
      contactStatusFilter: callContactStatusFilter,
      notesFilter: callNotesFilter,
      gradeFrom: effectiveCallGradeFrom,
      gradeTo: effectiveCallGradeTo,
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
      if (isStudentExamCall(call)) {
        const key = studentExamCallIdentityKey(call.studentId, call.examId);
        if (!serverCallLookup.has(key)) serverCallLookup.set(key, call);
      }
      const noteKey = studentExamCallIdentityKey(call.studentId, call.examId);
      if (call.category === CALL_STUDENT_NOTE_CATEGORY && !serverNoteLookup.has(noteKey)) {
        serverNoteLookup.set(noteKey, call);
      }
    });

    return serverRows.map((row) => {
      const item = row.focusItem;
      const call = item
        ? serverCallLookup.get(studentExamCallIdentityKey(row.student.id, item.exam.id))
        : undefined;
      const note = callNoteExportText(serverNoteLookup, row.student.id, callExamId);
      return { row, status: callStatusForLog(call), note, courseName };
    });
  };

  const callIdentityMatches = (
    call: StudentCall,
    payload: { studentId: string; examId: string; category: string },
  ) =>
    payload.category === CALL_STUDENT_NOTE_CATEGORY
      ? call.studentId === payload.studentId &&
        String(call.examId || "") === String(payload.examId || "") &&
        call.category === CALL_STUDENT_NOTE_CATEGORY
      : studentExamCallIdentityMatches(call, payload.studentId, payload.examId);

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
    const savingKey = `status:${studentExamCallIdentityKey(payload.studentId, payload.examId)}`;
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
      if (!result.ok && !result.queued) {
        mergeSavedCall(payload, previousCall, !previousCall);
        toast.error(result.error || "تعذر حفظ حالة التواصل.");
        return;
      }
      if (result.queued) {
        toast.info(
          "انقطع الاتصال؛ حُفظ إجراء التواصل مؤقتاً وسيُرسل تلقائياً عند رجوعه.",
        );
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
      setCallFilterRefreshKey((current) => current + 1);
      if (callContactStatusFilter !== "all") setCallGradePage(1);
      toast.success("تم حفظ إجراء التواصل");
    } finally {
      setCallSaving(savingKey, false);
    }
  };

  const saveCallStudentNote = async (row: CallStudentRow, notes: string, replaceConflict = false) => {
    if (!canManageCalls) return;
    const examId = row.focusItem?.exam.id;
    if (!examId) return;
    const draftKey = studentExamCallIdentityKey(row.student.id, examId);
    if (callNoteSavingRef.current.has(draftKey)) return;
    const hasConflict = Object.prototype.hasOwnProperty.call(callNoteConflicts, draftKey);
    if (hasConflict && !replaceConflict) return;
    const existing = replaceConflict ? callNoteConflicts[draftKey] : callNoteForStudent(row.student.id, examId);
    const clearSavedDraft = () => {
      setCallNoteDrafts((current) => {
        if (current[draftKey] !== notes) return current;
        const next = { ...current };
        delete next[draftKey];
        return next;
      });
      delete callNoteDraftRevisionsRef.current[draftKey];
      delete callNoteDraftIdsRef.current[draftKey];
      setCallNoteConflicts((current) => {
        const next = { ...current };
        delete next[draftKey];
        return next;
      });
    };
    if (notes.trim() === String(existing?.notes || "").trim()) {
      clearSavedDraft();
      return;
    }
    const payload = {
      studentId: row.student.id,
      examId,
      category: CALL_STUDENT_NOTE_CATEGORY,
      expectedRevision: replaceConflict ? existing?.noteRevision ?? 0 : callNoteDraftRevisionsRef.current[draftKey] ?? existing?.noteRevision ?? 0,
      expectedNoteId: replaceConflict
        ? existing?.id ?? null
        : Object.prototype.hasOwnProperty.call(callNoteDraftIdsRef.current, draftKey)
          ? callNoteDraftIdsRef.current[draftKey]
          : existing?.id ?? null,
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
    const savingKey = `note:${draftKey}`;
    callNoteSavingRef.current.add(draftKey);
    setCallSaving(savingKey, true);
    callMutationVersionRef.current += 1;
    try {
      const result = await studentCallApi.upsert(payload);
      if (!result.ok) {
        if (result.status === 409 && result.data && typeof result.data === "object" && "studentCall" in result.data) {
          const currentNote = (result.data as { studentCall: StudentCall | null }).studentCall;
          setCallNoteConflicts((current) => ({ ...current, [draftKey]: currentNote }));
          mergeSavedCall(payload, currentNote, !currentNote);
        }
        toast.error(result.queued
          ? "لم تُحفظ الملاحظة في النظام بعد. بقي نصّك هنا حتى يتم تأكيد الحفظ."
          : result.error || "تعذر حفظ ملاحظة المكالمات.");
        return;
      }
      const data = result.data as { studentCall?: StudentCall | null; deleted?: boolean } | null;
      mergeSavedCall(payload, data?.studentCall || null, Boolean(data?.deleted));
      if (data?.deleted && callNotesFilter === "with-notes") {
        setCallGradePage(1);
        setCallFilterRefreshKey((current) => current + 1);
      }
      clearSavedDraft();
      // An edit typed while the previous version was being saved remains a
      // draft against the newly acknowledged revision, not an older one.
      callNoteDraftRevisionsRef.current[draftKey] = data?.studentCall?.noteRevision ?? 0;
      callNoteDraftIdsRef.current[draftKey] = data?.studentCall?.id ?? null;
      emitTeacherProDataChanged({
        source: "local-mutation",
        reason: "تحديث ملاحظات المكالمات",
        scopes: ["follow-up", "students", "dashboard", "logs"],
        dispatchLocal: false,
      });
      toast.success(notes.trim() ? "تم حفظ ملاحظة المكالمات" : "تم حذف ملاحظة المكالمات");
    } finally {
      callNoteSavingRef.current.delete(draftKey);
      setCallSaving(savingKey, false);
    }
  };

  const openProfile = (studentId: string) => {
    setProfileStudentId(studentId);
    setProfileDialogOpen(true);
  };

  const studentOpportunityText = (student: Student) =>
    formatOpportunityBalance(student, { separator: " / " });

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
        className="rounded-xl border bg-card px-3 py-2 text-xs font-bold text-success underline"
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
      return "border-danger-line bg-danger-soft text-danger";
    if (tone === "warning")
      return "border-warning-line bg-warning-soft text-warning";
    if (tone === "safe")
      return "border-info-line bg-info-soft text-info";
    if (tone === "success")
      return "border-success-line bg-success-soft text-success";
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

  const renderTelegramLink = (telegram?: string, username?: string | null) => {
    // يوزر تيليجرام المستعاد أولاً — يفتح المحادثة داخل التطبيق.
    const preferred = String(username || "").trim().replace(/^@+/, "");
    if (preferred) {
      return (
        <a
          className="rounded-xl border bg-card px-3 py-2 text-xs font-bold text-info underline"
          href={telegramLink(preferred)}
          target="_blank"
          rel="noreferrer"
        >
          يوزر تيليجرام: {preferred}
        </a>
      );
    }
    const normalizedTelegram = normalizeTelegramIdentifier(telegram || "");
    if (!normalizedTelegram) {
      return (
        <span className="rounded-xl border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
          التيليجرام: لا يوجد معرف
        </span>
      );
    }
    // المعرف الرقمي يُعرض نصاً — لا يصلح لفتح محادثة تيليجرام.
    if (/^\d+$/.test(normalizedTelegram)) {
      return (
        <span className="rounded-xl border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
          المعرف: <span dir="ltr">{normalizedTelegram}</span> (لا يوجد يوزر)
        </span>
      );
    }
    return (
      <a
        className="rounded-xl border bg-card px-3 py-2 text-xs font-bold text-info underline"
        href={telegramLink(normalizedTelegram)}
        target="_blank"
        rel="noreferrer"
      >
        يوزر تيليجرام: {normalizedTelegram}
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
          <div className="mt-2 rounded-xl border border-warning-line border-s-4 border-s-warning-vivid bg-warning-soft px-2.5 py-2 text-[11px] text-warning">
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
    const noteDraftKey = studentExamCallIdentityKey(row.student.id, item?.exam.id || callExamId);
    const callStudentNote = callNoteForStudent(row.student.id, item?.exam.id || callExamId);
    const generalCallNote = callNoteForStudent(row.student.id, "");
    const displayMode = callGradeDisplayModes[row.student.id] || "latest";
    const statusSavingKey = item
      ? `status:${studentExamCallIdentityKey(row.student.id, item.exam.id)}`
      : "";
    const noteSavingKey = `note:${noteDraftKey}`;
    const noteValue = Object.prototype.hasOwnProperty.call(callNoteDrafts, noteDraftKey)
      ? callNoteDrafts[noteDraftKey]
      : callStudentNote?.notes || "";
    const noteHasConflict = Object.prototype.hasOwnProperty.call(callNoteConflicts, noteDraftKey);
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
        className="teacherpro-heavy-row rounded-3xl border bg-card/90 p-4 text-sm shadow-sm transition-colors hover:border-primary/25"
      >
        <div className="flex flex-wrap items-start justify-between gap-3 border-b pb-4">
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <b className="text-lg leading-tight">{row.student.name}</b>
              <Badge variant="outline">{row.student.code}</Badge>
              <Badge
                variant={
                  row.student.status === "نشط" ? "success" : "destructive"
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
                      ? "bg-danger-soft text-danger"
                      : Number(row.student.opportunities || 0) <= 1
                        ? "bg-warning-soft text-warning"
                        : "bg-success-soft text-success"
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

                <div className="w-full min-w-0 rounded-2xl border bg-background px-4 py-3 text-center shadow-sm sm:w-auto sm:min-w-32">
                  <p className="text-[11px] font-bold text-muted-foreground">
                    الدرجة الحالية
                  </p>
                  <p
                    className={`mt-1 text-3xl font-black tracking-tight ${
                      !item
                        ? "text-muted-foreground"
                        : item.category === "absent"
                          ? "text-danger"
                          : item.category === "discounted" || item.category === "failed"
                            ? "text-warning"
                            : item.category === "cheating"
                              ? "text-danger"
                              : item.category === "passed" || item.category === "full"
                                ? "text-success"
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
                  {renderTelegramLink(row.student.telegram, row.student.username)}
                </div>
                {(row.student.phone || row.student.parentPhone) && (
                  <div className="rounded-2xl border border-dashed bg-background/70 p-3">
                    <p className="mb-2 text-[11px] font-bold text-muted-foreground">
                      نقل الرقم إلى هاتف آخر عبر QR
                    </p>
                    <div className="grid grid-cols-2 gap-2">
                      <CallPhoneQr
                        studentName={row.student.name}
                        phoneLabel="الطالب"
                        phone={row.student.phone}
                      />
                      <CallPhoneQr
                        studentName={row.student.name}
                        phoneLabel="ولي الأمر"
                        phone={row.student.parentPhone}
                      />
                    </div>
                  </div>
                )}

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
                  ملاحظات المكالمات لهذا الامتحان
                </Label>
              </div>
              {generalCallNote?.notes && (
                <div className="mb-3 rounded-xl border bg-background/60 p-3">
                  <p className="mb-1 text-xs font-semibold text-muted-foreground">ملاحظة عامة سابقة</p>
                  <p className="whitespace-pre-wrap break-words text-sm leading-6 [overflow-wrap:anywhere]">{generalCallNote.notes}</p>
                </div>
              )}
              <textarea
                className="min-h-28 w-full rounded-2xl border border-input bg-background px-3 py-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                readOnly={!canManageCalls}
                value={noteValue}
                onChange={(event) => {
                  if (!Object.prototype.hasOwnProperty.call(callNoteDrafts, noteDraftKey)) {
                    callNoteDraftRevisionsRef.current[noteDraftKey] = callStudentNote?.noteRevision ?? 0;
                    callNoteDraftIdsRef.current[noteDraftKey] = callStudentNote?.id ?? null;
                  }
                  setCallNoteDrafts((current) => ({
                    ...current,
                    [noteDraftKey]: event.target.value,
                  }));
                }}
                onBlur={(event) => void saveCallStudentNote(row, event.target.value)}
                placeholder="دوّن ملاحظة مختصرة وواضحة تخص تواصل هذا الطالب أو ولي أمره"
              />
              {noteHasConflict && (
                <div role="alert" className="mt-2 space-y-2 rounded-xl border border-warning-line border-s-4 border-s-warning-vivid bg-warning-soft p-3">
                  <p className="text-xs font-semibold">عدّل مستخدم آخر الملاحظة. تعديلك باقٍ في الحقل أعلاه.</p>
                  <p className="whitespace-pre-wrap break-words text-sm leading-6 [overflow-wrap:anywhere]">
                    المحفوظة الآن: {callNoteConflicts[noteDraftKey]?.notes || "لا توجد ملاحظة"}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <Button type="button" variant="outline" size="sm" disabled={Boolean(callSavingKeys[noteSavingKey])}
                      onClick={() => {
                        delete callNoteDraftRevisionsRef.current[noteDraftKey];
                        delete callNoteDraftIdsRef.current[noteDraftKey];
                        setCallNoteDrafts((current) => { const next = { ...current }; delete next[noteDraftKey]; return next; });
                        setCallNoteConflicts((current) => { const next = { ...current }; delete next[noteDraftKey]; return next; });
                      }}>
                      اعتماد الملاحظة المحفوظة
                    </Button>
                    <Button type="button" size="sm" disabled={!canManageCalls || Boolean(callSavingKeys[noteSavingKey])}
                      onClick={() => void saveCallStudentNote(row, noteValue, true)}>
                      حفظ تعديلي
                    </Button>
                  </div>
                </div>
              )}
              <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                <span
                  className={`tp-save-indicator ${
                    callSavingKeys[noteSavingKey]
                      ? "tp-save-indicator--saving"
                      : Object.prototype.hasOwnProperty.call(callNoteDrafts, noteDraftKey)
                        ? "tp-save-indicator--pending"
                        : "tp-save-indicator--saved"
                  }`}
                >
                  {callSavingKeys[noteSavingKey]
                    ? "جارٍ حفظ الملاحظة..."
                    : noteHasConflict
                      ? "اختر الملاحظة التي تريد اعتمادها"
                    : Object.prototype.hasOwnProperty.call(callNoteDrafts, noteDraftKey)
                      ? "تعديل غير محفوظ — سيُحفظ عند مغادرة الحقل"
                      : "محفوظة"}
                </span>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="tp-save-manual-button h-8 rounded-full px-3 text-[11px]"
                  title="حفظ الملاحظة مباشرة"
                  disabled={!canManageCalls || noteHasConflict || Boolean(callSavingKeys[noteSavingKey])}
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
      />
    );
  }

  return (
    <div className={`space-y-5 tp-follow-up-page tp-follow-up-page--${view}`}>
      <Card className="overflow-hidden tp-follow-up-page__intro">
        <div className="h-1.5 bg-gradient-to-l from-info-vivid via-success-vivid to-warning-vivid" />
        <CardHeader>
          <CardTitle>{viewTitles[view]}</CardTitle>
        </CardHeader>
      </Card>

      {view === "calls" && (
        <div className="space-y-4">
          <Card className="tp-filter-card">
            <CardHeader>
              <CardTitle>المكالمات المرتبطة بسجل الدرجات</CardTitle>
            </CardHeader>
            <CardContent className="tp-filter-content space-y-4">
              <div className="tp-filter-grid grid-cols-1 md:grid-cols-6">
                <div className="tp-filter-field tp-filter-primary">
                  <Label>اسم الدورة</Label>
                  <Select
                    value={callCourseId || "__none__"}
                    onValueChange={(value) => {
                      setCallCourseId(value === "__none__" ? "" : value);
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="اختر اسم الدورة أولاً" />
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
                      const nextStatus = value as CallStatusFilter;
                      setCallStatusFilter(nextStatus);
                      if (!callStatusSupportsGradeRange(nextStatus)) {
                        setCallGradeFrom("");
                        setCallGradeTo("");
                      }
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
                <div className="tp-filter-field tp-filter-secondary">
                  <Label>حالة التواصل</Label>
                  <Select
                    value={callContactStatusFilter}
                    disabled={!callExamSelected}
                    onValueChange={(value) => {
                      setCallContactStatusFilter(value as CallContactStatusFilter);
                      setCallGradePage(1);
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {callContactStatusFilterOptions.map((option) => (
                        <SelectItem key={option} value={option}>
                          {callContactStatusFilterLabels[option]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="tp-filter-field tp-filter-secondary">
                  <Label>الملاحظات</Label>
                  <Select
                    value={callNotesFilter}
                    disabled={!callExamSelected}
                    onValueChange={(value) => {
                      setCallNotesFilter(value as CallNotesFilter);
                      setCallGradePage(1);
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {callNotesFilterOptions.map((option) => (
                        <SelectItem key={option} value={option}>
                          {callNotesFilterLabels[option]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="tp-filter-field tp-filter-secondary">
                  <Label htmlFor="follow-up-calls-grade-from">الدرجة من</Label>
                  <Input
                    id="follow-up-calls-grade-from"
                    name="calls-grade-from"
                    type="number"
                    inputMode="decimal"
                    min={0}
                    max={selectedCallExam?.fullMark}
                    step="any"
                    disabled={!callExamSelected || !callGradeRangeEnabled}
                    value={callGradeFrom}
                    onChange={(event) => {
                      setCallGradeFrom(event.target.value);
                      setCallGradePage(1);
                    }}
                    placeholder="مثال: 20"
                  />
                </div>
                <div className="tp-filter-field tp-filter-secondary">
                  <Label htmlFor="follow-up-calls-grade-to">الدرجة إلى</Label>
                  <Input
                    id="follow-up-calls-grade-to"
                    name="calls-grade-to"
                    type="number"
                    inputMode="decimal"
                    min={0}
                    max={selectedCallExam?.fullMark}
                    step="any"
                    disabled={!callExamSelected || !callGradeRangeEnabled}
                    value={callGradeTo}
                    onChange={(event) => {
                      setCallGradeTo(event.target.value);
                      setCallGradePage(1);
                    }}
                    placeholder={`حتى ${selectedCallExam?.fullMark ?? "الدرجة الكاملة"}`}
                  />
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
                      اختر اسم الدورة والامتحان
                    </Button>
                  )}
                </div>
              </div>
              {callStatusFilter === "absent" ? (
                <p className="rounded-2xl border border-warning-line border-s-4 border-s-warning-vivid bg-warning-soft p-3 text-xs font-bold text-warning">
                  الغائبون يشملون المسجلين بحالة «غائب» والطلاب الذين لم تُدخل
                  درجاتهم بعد انتهاء الامتحان. نطاق الدرجة معطّل لهذا الفلتر.
                </p>
              ) : callStatusFilter === "cheating" ? (
                <p className="rounded-2xl border border-dashed bg-muted/30 p-3 text-xs text-muted-foreground">
                  حالة الغش غير رقمية، لذلك نطاق الدرجة معطّل لهذا الفلتر.
                </p>
              ) : callGradeRangeInvalid ? (
                <p className="rounded-2xl border border-danger-line border-s-4 border-s-danger-vivid bg-danger-soft p-3 text-sm font-bold text-danger">
                  درجة «من» يجب ألا تكون أكبر من درجة «إلى».
                </p>
              ) : callStatusFilter === "dismissed" && !callGradeFrom && !callGradeTo ? (
                <p className="rounded-2xl border border-danger-line bg-danger-soft p-3 text-xs font-bold text-danger">
                  يعرض هذا الفلتر الطلاب الذين حالتهم الحالية «مفصول» ضمن
                  الدورة والامتحان المحددين.
                </p>
              ) : callGradeFrom || callGradeTo ? (
                <p className="rounded-2xl border border-dashed bg-muted/30 p-3 text-xs text-muted-foreground">
                  نطاق الدرجة شامل للحدّين، وعند استخدامه تظهر الدرجات الرقمية فقط.
                </p>
              ) : null}
              {!callCourseSelected ? (
                <p className="rounded-2xl border border-dashed bg-muted/30 p-3 text-sm text-muted-foreground">
                  اختر اسم الدورة أولاً حتى يتم تفعيل الامتحانات وبقية الفلاتر.
                </p>
              ) : !callExamSelected ? (
                <p className="rounded-2xl border border-dashed bg-muted/30 p-3 text-sm text-muted-foreground">
                  اختر امتحاناً لعرض الطلاب.
                </p>
              ) : callLoading ? (
                <div className="rounded-2xl border bg-muted/30 p-3 text-sm text-muted-foreground">
                  <div className="flex items-center gap-2">
                    <span className="h-2 w-2 animate-pulse rounded-full bg-primary" />
                    <span>جاري تحميل الطلاب والدرجات...</span>
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
            <Card className="border-dashed border-info-line bg-info-soft" data-count-scope="filtered">
              <CardContent className="p-4">
                <p className="text-xs text-muted-foreground">تم الاتصال</p>
                <b className="text-2xl">
                  {callStatValue(callDatabaseStats?.contacted)}
                </b>
              </CardContent>
            </Card>
            <Card className="border-dashed border-info-line bg-info-soft" data-count-scope="filtered">
              <CardContent className="p-4">
                <p className="text-xs text-muted-foreground">لم يرد</p>
                <b className="text-2xl">
                  {callStatValue(callDatabaseStats?.unanswered)}
                </b>
              </CardContent>
            </Card>
            <Card className="border-dashed border-info-line bg-info-soft" data-count-scope="filtered">
              <CardContent className="p-4">
                <p className="text-xs text-muted-foreground">الرقم خاطئ</p>
                <b className="text-2xl">
                  {callStatValue(callDatabaseStats?.wrong)}
                </b>
              </CardContent>
            </Card>
            <Card className="border-dashed border-info-line bg-info-soft" data-count-scope="filtered">
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
                  اختر اسم الدورة ثم الامتحان لعرض الطلاب.
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

    </div>
  );
}

export function FollowUpCallsView() {
  return <FollowUpViewBase view="calls" />;
}
