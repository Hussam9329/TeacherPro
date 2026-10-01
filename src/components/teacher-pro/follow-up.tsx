"use client";
import { useTeacherProSyncKey } from "@/hooks/use-teacherpro-sync";

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
import {
  AlertCircle,
  AlertTriangle,
  Ban,
  CheckCircle2,
  ChartColumn,
  ChevronLeft,
  FileText,
  HelpCircle,
  Info,
  PencilLine,
  Phone,
  PhoneCall,
  RotateCcw,
  Search,
  Send,
  ShieldAlert,
  ShieldCheck,
  SlidersHorizontal,
  Star,
  StickyNote,
  User,
  Users,
  XCircle,
  type LucideIcon,
} from "lucide-react";
import { callPhoneQrValue } from "@/lib/call-phone-qr";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
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
import { formatGradeScore } from "@/lib/exam-utils";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { emitTeacherProDataChanged } from "@/lib/teacherpro-sync";
import { formatOpportunityBalance, getOpportunityLimit } from "@/lib/opportunity-balance";
import { baghdadTodayKey } from "@/lib/baghdad-time";
import { CALL_STUDENT_NOTE_CATEGORY } from "@/lib/call-notes-filter";
import { contactStatusMatchesFilter } from "@/lib/call-contact-status";
import { callWorkShareOptions, parseCallWorkShare } from "@/lib/call-work-share";
import {
  isStudentExamCall,
  studentExamCallIdentityKey,
  studentExamCallIdentityMatches,
} from "@/lib/call-identity";
import { shortGradeNoteText } from "@/lib/grade-note-banners";
import { refreshShortcutAlerts } from "@/hooks/use-shortcut-alerts";
import "./tp-modal.css";
import "./calls.css";

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
type CallStatusFilter = "all" | "discounted" | "full";
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

const callStatusFilterLabels: Record<CallStatusFilter, string> = {
  all: "كل الحالات",
  discounted: "المخصومين",
  full: "الدرجات الكاملة",
};

/** Each laptop remembers its own «تقسيم العمل» slice. */
const CALL_WORK_SHARE_STORAGE_KEY = "teacherpro-calls-work-share";
const callWorkShareChoices = callWorkShareOptions();
function callWorkShareLabel(value: string): string {
  const share = parseCallWorkShare(value);
  return share ? `القسم ${share.part} من ${share.parts}` : "كل الطلاب";
}

const callStatusFilterOptions = Object.keys(
  callStatusFilterLabels,
) as CallStatusFilter[];

/** The contact filter buttons, with the stats key that counts each one. */
const callContactFilterChips: Array<{
  value: CallContactStatusFilter;
  label: string;
  tone?: CallContactTone;
  countKey: keyof NonNullable<CallStatsResponse["contactCounts"]>;
}> = [
  { value: "all", label: "الكل", countKey: "all" },
  { value: "no-action", label: "بدون إجراء", tone: "muted", countKey: "noAction" },
  { value: "contacted", label: "تم الاتصال", tone: "success", countKey: "contacted" },
  { value: "unanswered", label: "لم يرد", tone: "warning", countKey: "unanswered" },
  { value: "wrong", label: "الرقم خاطئ", tone: "danger", countKey: "wrong" },
];

type CallContactTone = "success" | "warning" | "danger" | "muted";

/** The three contact actions; pressing the active one clears it back to «بدون إجراء». */
const callContactActions: Array<{ value: Exclude<ContactStatus, "">; tone: CallContactTone }> = [
  { value: "تم الاتصال", tone: "success" },
  { value: "لم يرد", tone: "warning" },
  { value: "الرقم خاطئ", tone: "danger" },
];

/** WhatsApp's glyph (the icon set has none). */
function WhatsAppIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" fill="currentColor">
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413z" />
    </svg>
  );
}

const callContactActionIcons: Record<Exclude<ContactStatus, "">, LucideIcon> = {
  "تم الاتصال": CheckCircle2,
  "لم يرد": AlertCircle,
  "الرقم خاطئ": XCircle,
};

/** The result badge's icon: star for a full mark, a tick for a pass, and so on. */
function callResultIcon(category?: CallCategory): LucideIcon {
  if (category === "full") return Star;
  if (category === "passed") return CheckCircle2;
  if (category === "absent") return XCircle;
  if (category === "cheating") return ShieldAlert;
  if (category === "discounted" || category === "failed" || category === "academic-accounting") return AlertTriangle;
  if (category === "protected") return ShieldCheck;
  return HelpCircle;
}

/** Colour of an impact badge on the card. */
function callBadgeTone(tone: CallBadgeTone): "danger" | "warning" | "info" | "success" | "muted" {
  if (tone === "deducted") return "danger";
  if (tone === "warning") return "warning";
  if (tone === "safe") return "info";
  if (tone === "success") return "success";
  return "muted";
}

function contactTone(status: ContactStatus): CallContactTone {
  return callContactActions.find((action) => action.value === status)?.tone || "muted";
}

/** Colour of an exam result: absent/cheating red, deducted/failed amber, passed green. */
function callResultTone(category?: CallCategory): "danger" | "warning" | "success" | "info" {
  if (category === "absent" || category === "cheating") return "danger";
  if (category === "discounted" || category === "failed" || category === "academic-accounting") return "warning";
  if (category === "passed" || category === "full") return "success";
  return "info";
}

const callGradeDisplayModeLabels: Record<CallGradeDisplayMode, string> = {
  latest: "آخر امتحان",
  "latest-two": "آخر امتحانين",
  all: "جميع الامتحانات",
};

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

export function CallsWorkspace({ variant = "page" }: { variant?: "page" | "window" }) {
  // Changes made elsewhere (another user, tab or page) never reload this work
  // list on their own: names would move and numbers change under the
  // teacher's hand. They only light the «تحديث» button; the list and the
  // counts reload when it is pressed or when a filter or the page changes.
  const syncKey = useTeacherProSyncKey(["follow-up", "students", "grades", "exams", "opportunities", "dashboard"]);
  const latestSyncKeyRef = useRef(syncKey);
  const [callLoadedSyncKey, setCallLoadedSyncKey] = useState(syncKey);
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
  // «تقسيم العمل»: "" for the whole list, or "k/n" for this laptop's fixed slice.
  const [callWorkShare, setCallWorkShare] = useState("");
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
  // Refreshes the counts only: a contact action must not reload the cards.
  const [callStatsRefreshKey, setCallStatsRefreshKey] = useState(0);
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
  const debouncedCallGradeFrom = useDebouncedValue(callGradeFrom, 300);
  const debouncedCallGradeTo = useDebouncedValue(callGradeTo, 300);

  const [profileStudentId, setProfileStudentId] = useState("");
  const [profileDialogOpen, setProfileDialogOpen] = useState(false);
  // The student whose details window is open, and the cards whose note is being written.
  const [detailsRow, setDetailsRow] = useState<CallStudentRow | null>(null);
  const [openNoteEditors, setOpenNoteEditors] = useState<Record<string, boolean>>({});

  useEffect(() => {
    setCallExamId("");
    setCallStatusFilter("all");
    setCallContactStatusFilter("all");
    setCallNotesFilter("all");
    setCallGradeFrom("");
    setCallGradeTo("");
    setCallGradePage(1);
    setCallGradeDisplayModes({});
    setDetailsRow(null);
  }, [callCourseId]);

  useEffect(() => {
    setCallStatusFilter("all");
    setCallContactStatusFilter("all");
    setCallNotesFilter("all");
    setCallGradeFrom("");
    setCallGradeTo("");
    setCallGradePage(1);
    setCallGradeDisplayModes({});
    setDetailsRow(null);
  }, [callExamId]);

  useEffect(() => {
    if (!callCourseId) {
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
  }, [callCourseId, callExamId]);

  useEffect(() => {
    if (!callCourseId || !callExamId) {
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
    setCallLoadedSyncKey(latestSyncKeyRef.current);
    // لا نستبدل الجدول الموجود بحالة تحميل عند أي إعادة جلب.
    // الـSkeleton يظهر فقط في أول تحميل عندما لا توجد صفوف معروضة أصلاً.
    const shouldBlockTable = callRowsRef.current.length === 0;
    setCallLoading(shouldBlockTable);

    callCandidatesApi
      .get(
        {
          courseId: callCourseId,
          examId: callExamId,
          statusFilter: callStatusFilter,
          contactStatusFilter: callContactStatusFilter,
          notesFilter: callNotesFilter,
          gradeFrom: debouncedCallGradeFrom,
          gradeTo: debouncedCallGradeTo,
          q: debouncedCallGeneralSearch,
          share: callWorkShare || undefined,
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
          requestSequence === callCandidatesRequestSequenceRef.current
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
    callCourseId,
    callExamId,
    callStatusFilter,
    callContactStatusFilter,
    callNotesFilter,
    debouncedCallGradeFrom,
    debouncedCallGradeTo,
    debouncedCallGeneralSearch,
    callWorkShare,
    callGradePage,
    callFilterRefreshKey,
  ]);

  useEffect(() => {
    if (!callCourseId || !callExamId) {
      setCallDatabaseStats(null);
      setCallDatabaseStatsLoading(false);
      return;
    }

    let cancelled = false;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setCallDatabaseStatsLoading(true);
      callStatsApi
        .get(
          {
            courseId: callCourseId,
            examId: callExamId,
            statusFilter: callStatusFilter,
            contactStatusFilter: callContactStatusFilter,
            notesFilter: callNotesFilter,
            gradeFrom: debouncedCallGradeFrom,
            gradeTo: debouncedCallGradeTo,
            q: debouncedCallGeneralSearch,
            share: callWorkShare || undefined,
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
    callCourseId,
    callExamId,
    callStatusFilter,
    callContactStatusFilter,
    callNotesFilter,
    debouncedCallGradeFrom,
    debouncedCallGradeTo,
    debouncedCallGeneralSearch,
    callWorkShare,
    callFilterRefreshKey,
    callStatsRefreshKey,
  ]);

  useEffect(() => {
    latestSyncKeyRef.current = syncKey;
  }, [syncKey]);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(CALL_WORK_SHARE_STORAGE_KEY) || "";
      if (parseCallWorkShare(stored)) setCallWorkShare(stored);
    } catch {
      // Private windows may refuse storage; the whole list is then shown.
    }
  }, []);

  const chooseCallWorkShare = (value: string) => {
    const next = parseCallWorkShare(value) ? value : "";
    setCallWorkShare(next);
    setCallGradePage(1);
    try {
      if (next) window.localStorage.setItem(CALL_WORK_SHARE_STORAGE_KEY, next);
      else window.localStorage.removeItem(CALL_WORK_SHARE_STORAGE_KEY);
    } catch {
      // The choice still applies for this visit.
    }
  };
  const callUpdatesPending = syncKey !== callLoadedSyncKey;

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
  // Students on this page whose new action took them out of the contact
  // filter. They stay visible until the page is reloaded.
  const callDepartedCount =
    callContactStatusFilter === "all"
      ? 0
      : visibleCallRows.filter(
          (row) => !contactStatusMatchesFilter(callContactStatusFilter, callStatusForLog(callLogForRow(row))),
        ).length;

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
      gradeFrom: debouncedCallGradeFrom,
      gradeTo: debouncedCallGradeTo,
      q: debouncedCallGeneralSearch,
      share: callWorkShare || undefined,
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
      // A contact-status row carries no automatic note; the teacher's notes
      // live in their own «call-student-note» rows.
      notes: existing?.notes || "",
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
      // The cards stay where they are (the action is already on the card), so
      // the list never jumps or goes back to page one; only the counts reload.
      setCallStatsRefreshKey((current) => current + 1);
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
      // A changed note goes back to «إدارة ملاحظات المكالمات» even if it was
      // marked done; its count beside the shortcut updates now, not minutes later.
      void refreshShortcutAlerts();
      const reopened = Boolean(existing?.noteResolved && data?.studentCall && !data.studentCall.noteResolved);
      toast.success(
        !notes.trim()
          ? "تم حذف ملاحظة المكالمات"
          : reopened
            ? "تم حفظ الملاحظة وأُعيدت إلى إدارة ملاحظات المكالمات"
            : "تم حفظ ملاحظة المكالمات",
      );
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

  const opportunityTone = (student: Student) =>
    getOpportunityLimit(student) === null
      ? "muted"
      : Number(student.opportunities || 0) === 0
        ? "danger"
        : Number(student.opportunities || 0) <= 1
          ? "warning"
          : "success";

  const callFiltersActive =
    callStatusFilter !== "all" ||
    callContactStatusFilter !== "all" ||
    callNotesFilter !== "all" ||
    Boolean(callGradeFrom || callGradeTo || callGeneralSearch.trim());

  const resetCallFilters = () => {
    setCallStatusFilter("all");
    setCallContactStatusFilter("all");
    setCallNotesFilter("all");
    setCallGradeFrom("");
    setCallGradeTo("");
    setCallGeneralSearch("");
    setCallGradePage(1);
  };

  // The details window follows the fresh row when the list reloads, and keeps
  // the last one if a filter just moved the student out of the page.
  const detailsLiveRow = detailsRow
    ? callRowsFromDb.find((row) => row.id === detailsRow.id) || detailsRow
    : null;

  // ── Contact ─────────────────────────────────────────────────────────────
  // Window: the numbers themselves, WhatsApp links and Telegram.
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

  // Card: three direct buttons. A missing number is a faded button, never text.
  const renderContactButtons = (student: Student) => {
    const telegramHandle = String(student.username || "").trim().replace(/^@+/, "") ||
      normalizeTelegramIdentifier(student.telegram || "");
    const telegramOpens = Boolean(telegramHandle) && !/^\d+$/.test(telegramHandle);
    const phoneButton = (label: string, phone?: string) =>
      phoneForWhatsApp(phone) ? (
        <a
          className="tp-call-card__contact-btn"
          data-kind="whatsapp"
          href={whatsappLink(phone || "")}
          target="_blank"
          rel="noreferrer"
          title={`${label}: ${phone}`}
        >
          <WhatsAppIcon />{label}
        </a>
      ) : (
        <span className="tp-call-card__contact-btn" data-kind="whatsapp" aria-disabled="true" title={`${label}: لا يوجد رقم`}>
          <WhatsAppIcon />{label}
        </span>
      );
    return (
      <div className="tp-call-card__contact">
        {phoneButton("واتساب الطالب", student.phone)}
        {phoneButton("واتساب ولي الأمر", student.parentPhone)}
        {telegramOpens ? (
          <a
            className="tp-call-card__contact-btn"
            data-kind="telegram"
            href={telegramLink(telegramHandle)}
            target="_blank"
            rel="noreferrer"
            title={`تيليجرام: @${telegramHandle}`}
          >
            <Send aria-hidden="true" fill="currentColor" />تيليجرام
          </a>
        ) : (
          <span
            className="tp-call-card__contact-btn"
            data-kind="telegram"
            aria-disabled="true"
            title={telegramHandle ? `المعرف ${telegramHandle} (لا يوجد يوزر)` : "لا يوجد معرف تيليجرام"}
          >
            <Send aria-hidden="true" fill="currentColor" />تيليجرام
          </span>
        )}
      </div>
    );
  };

  // ── Grades ──────────────────────────────────────────────────────────────
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

  /** Impact badges; the card shows the first one and a «+N» for the rest. */
  const renderCallImpactBadges = (item?: CallGradeItem | null, limit?: number) => {
    const badges = item?.badges || [];
    if (!badges.length) return null;
    const shown = limit ? badges.slice(0, limit) : badges;
    const hidden = badges.length - shown.length;
    return (
      <div className="tp-call-badges">
        {shown.map((badge, index) => (
          <Badge
            key={`${badge.label}-${index}`}
            variant="outline"
            title={badge.detail || badge.label}
            className={`max-w-full whitespace-normal text-start leading-5 ${callBadgeToneClass(badge.tone)}`}
          >
            {badge.label}
          </Badge>
        ))}
        {hidden > 0 && <span className="tp-call-badges__more">+{hidden}</span>}
      </div>
    );
  };

  const callValueText = (item: CallGradeItem) =>
    item.category === "absent" ? "غائب" : formatGradeScore(item.grade, item.exam, "—");

  const renderCallGradeChip = (row: CallStudentRow, item: CallGradeItem) => {
    const call = callLogForGrade(row.student, item);
    return (
      <li key={item.id} className="tp-call-exam" data-tone={callResultTone(item.category)}>
        <div className="tp-call-exam__head">
          <div className="tp-call-exam__title">
            <b>{item?.exam?.name || "—"}</b>
            <span className="tp-call-exam__label">{item?.label || "—"}</span>
            <span className="tp-call-exam__date">{formatAppDate(item.exam.date)}</span>
          </div>
          <span className="tp-call-exam__grade">{callValueText(item)}</span>
        </div>
        {renderCallImpactBadges(item)}
        {item?.category !== "absent" && item?.reason ? (
          <p className="tp-call-exam__reason">{item.reason}</p>
        ) : null}
        {call ? (
          <p className="tp-call-exam__meta">إجراء التواصل: {callStatusForLog(call) || "بدون إجراء"}</p>
        ) : null}
        {shortGradeNoteText(item.grade.notes) ? (
          <div className="tp-call-exam__grade-note">
            <span>ملاحظة الدرجة</span>
            <p>{shortGradeNoteText(item.grade.notes)}</p>
          </div>
        ) : null}
      </li>
    );
  };

  // ── Call note: a line on the card, the full editor on demand ─────────────
  const renderNoteArea = (row: CallStudentRow, place: "card" | "window") => {
    const examId = row.focusItem?.exam.id || callExamId;
    const noteDraftKey = studentExamCallIdentityKey(row.student.id, examId);
    const callStudentNote = callNoteForStudent(row.student.id, examId);
    const generalCallNote = callNoteForStudent(row.student.id, "");
    const noteSavingKey = `note:${noteDraftKey}`;
    const hasDraft = Object.prototype.hasOwnProperty.call(callNoteDrafts, noteDraftKey);
    const noteValue = hasDraft ? callNoteDrafts[noteDraftKey] : callStudentNote?.notes || "";
    const noteHasConflict = Object.prototype.hasOwnProperty.call(callNoteConflicts, noteDraftKey);
    const noteSaving = Boolean(callSavingKeys[noteSavingKey]);
    const editing =
      place === "window" || Boolean(openNoteEditors[noteDraftKey]) || hasDraft || noteHasConflict || noteSaving;
    const openEditor = () => setOpenNoteEditors((current) => ({ ...current, [noteDraftKey]: true }));
    const closeEditor = () =>
      setOpenNoteEditors((current) => {
        if (!current[noteDraftKey]) return current;
        const next = { ...current };
        delete next[noteDraftKey];
        return next;
      });

    if (!editing) {
      return (
        <div className="tp-call-card__note">
          {callStudentNote?.notes ? (
            canManageCalls ? (
              <button type="button" className="tp-call-card__note-line" onClick={openEditor} title="تعديل الملاحظة">
                <PencilLine aria-hidden="true" />
                <span>{callStudentNote.notes}</span>
              </button>
            ) : (
              <p className="tp-call-card__note-line" data-readonly="true">
                <span>{callStudentNote.notes}</span>
              </p>
            )
          ) : canManageCalls ? (
            <button type="button" className="tp-call-card__note-add" onClick={openEditor}>
              <PencilLine aria-hidden="true" />ملاحظة
            </button>
          ) : null}
          {generalCallNote?.notes && (
            <span className="tp-call-card__general" title={generalCallNote.notes}>+ ملاحظة عامة سابقة</span>
          )}
        </div>
      );
    }

    return (
      <div className="tp-call-note" data-place={place}>
        <Label className={place === "card" ? "sr-only" : "tp-call-note__label"} htmlFor={`call-note-${place}-${noteDraftKey}`}>
          ملاحظات المكالمات لهذا الامتحان
        </Label>
        {generalCallNote?.notes && (
          <div className="tp-call-note__general">
            <p>ملاحظة عامة سابقة</p>
            <p>{generalCallNote.notes}</p>
          </div>
        )}
        <textarea
          id={`call-note-${place}-${noteDraftKey}`}
          className="tp-call-note__input"
          readOnly={!canManageCalls}
          autoFocus={place === "card" && Boolean(openNoteEditors[noteDraftKey]) && !hasDraft}
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
          onBlur={(event) => {
            void saveCallStudentNote(row, event.target.value);
            // The card folds back to one line once the note is saved.
            if (place === "card") closeEditor();
          }}
          placeholder="دوّن ملاحظة مختصرة وواضحة تخص تواصل هذا الطالب أو ولي أمره"
        />
        {noteHasConflict && (
          <div role="alert" className="tp-call-note__conflict">
            <p className="font-semibold">عدّل مستخدم آخر الملاحظة. تعديلك باقٍ في الحقل أعلاه.</p>
            <p>المحفوظة الآن: {callNoteConflicts[noteDraftKey]?.notes || "لا توجد ملاحظة"}</p>
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" size="sm" disabled={noteSaving}
                onClick={() => {
                  delete callNoteDraftRevisionsRef.current[noteDraftKey];
                  delete callNoteDraftIdsRef.current[noteDraftKey];
                  setCallNoteDrafts((current) => { const next = { ...current }; delete next[noteDraftKey]; return next; });
                  setCallNoteConflicts((current) => { const next = { ...current }; delete next[noteDraftKey]; return next; });
                }}>
                اعتماد الملاحظة المحفوظة
              </Button>
              <Button type="button" size="sm" disabled={!canManageCalls || noteSaving}
                onClick={() => void saveCallStudentNote(row, noteValue, true)}>
                حفظ تعديلي
              </Button>
            </div>
          </div>
        )}
        <div className="tp-call-note__foot">
          <span
            className={`tp-save-indicator ${
              noteSaving
                ? "tp-save-indicator--saving"
                : hasDraft
                  ? "tp-save-indicator--pending"
                  : "tp-save-indicator--saved"
            }`}
          >
            {noteSaving
              ? "جارٍ حفظ الملاحظة..."
              : noteHasConflict
                ? "اختر الملاحظة التي تريد اعتمادها"
                : hasDraft
                  ? "تعديل غير محفوظ — سيُحفظ عند مغادرة الحقل"
                  : "محفوظة"}
          </span>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="tp-save-manual-button"
            title="حفظ الملاحظة مباشرة"
            disabled={!canManageCalls || noteHasConflict || noteSaving}
            onClick={() => void saveCallStudentNote(row, noteValue)}
          >
            حفظ الآن
          </Button>
        </div>
      </div>
    );
  };

  const renderCallLoadingSkeleton = () => (
    <div className="tp-calls__skeleton" aria-live="polite" aria-busy="true">
      {[0, 1, 2].map((index) => (
        <div key={index} className="tp-call-card">
          <span className="block h-5 w-44 animate-pulse rounded-full bg-muted" />
          <span className="block h-7 w-56 animate-pulse rounded-full bg-muted" />
          <div className="flex gap-2">
            <span className="h-9 w-28 animate-pulse rounded-xl bg-muted" />
            <span className="h-9 w-28 animate-pulse rounded-xl bg-muted" />
            <span className="h-9 w-24 animate-pulse rounded-xl bg-muted" />
          </div>
          <span className="block h-10 w-full animate-pulse rounded-xl bg-muted" />
        </div>
      ))}
    </div>
  );

  // ── The short student card ──────────────────────────────────────────────
  const renderQrTile = (row: CallStudentRow, label: string, phone: string | null | undefined, icon: React.ReactNode) =>
    callPhoneQrValue(phone) ? (
      <CallPhoneQr
        studentName={row.student.name}
        phoneLabel={label}
        phone={phone}
        icon={icon}
        className="tp-qr-tile"
      />
    ) : (
      <div className="tp-qr-tile" data-empty="true">
        <span data-part="label">{icon}{label}</span>
        <span className="tp-qr-tile__placeholder" aria-hidden="true" />
        <span data-part="phone">لا يوجد رقم</span>
      </div>
    );

  const renderCallRow = (row: CallStudentRow) => {
    const item = row.focusItem;
    const call = callLogForRow(row);
    const contactStatus = callStatusForLog(call);
    const statusSavingKey = item
      ? `status:${studentExamCallIdentityKey(row.student.id, item.exam.id)}`
      : "";
    const statusSaving = Boolean(callSavingKeys[statusSavingKey]);
    const focusValue = item ? callValueText(item) : "—";
    const resultTone = callResultTone(item?.category);
    const ResultIcon = callResultIcon(item?.category);
    const studentTone = row.student.status === "نشط" ? "success" : row.student.status === "مفصول" ? "danger" : "muted";
    const course = courseName(row.student.courseId);
    return (
      <article
        key={row.id}
        className="teacherpro-heavy-row tp-call-card"
        data-contact={contactTone(contactStatus)}
        aria-label={row.student.name}
      >
        <header className="tp-call-card__head">
          <div className="tp-call-card__who">
            <b className="tp-call-card__name">{row.student.name}</b>
            <span className="tp-call-card__sep" aria-hidden="true" />
            <span className="tp-call-card__id">
              <span className="tp-call-card__code" dir="ltr">{row.student.code}</span>
              {course && <span className="tp-call-card__course">{course}</span>}
            </span>
            <span className="tp-call-card__sep" aria-hidden="true" />
            <span className="tp-call-card__pill" data-tone={studentTone}>
              <span className="tp-call-card__dot" aria-hidden="true" />{row.student.status}
            </span>
            <span className="tp-call-card__pill" data-tone={opportunityTone(row.student)}>
              <ChartColumn aria-hidden="true" />الفرص: {studentOpportunityText(row.student)}
            </span>
          </div>
          <Button type="button" variant="outline" className="tp-call-card__details" onClick={() => setDetailsRow(row)}>
            <FileText aria-hidden="true" />التفاصيل
          </Button>
        </header>

        <div className="tp-call-card__body">
          <div className="tp-call-card__main">
            <section className="tp-call-hero" data-tone={resultTone} aria-label="الامتحان">
              <div className="tp-call-hero__exam">
                <span className="tp-call-hero__icon" aria-hidden="true"><FileText /></span>
                <span className="tp-call-hero__text">
                  <span className="tp-call-hero__eyebrow">الامتحان</span>
                  <b className="tp-call-hero__name">{item?.exam.name || "—"}</b>
                  {item && <span className="tp-call-hero__date">{formatAppDate(item.exam.date)}</span>}
                </span>
              </div>
              <div className="tp-call-hero__score">
                <b className="tp-call-hero__value" dir="auto">{focusValue}</b>
                <div className="tp-call-hero__badges">
                  {item?.label && item.label !== focusValue && (
                    <span className="tp-call-hero__label" data-tone={resultTone}>
                      <ResultIcon aria-hidden="true" />{item.label}
                    </span>
                  )}
                  {(item?.badges || []).slice(0, 1).map((badge) => (
                    <span
                      key={badge.label}
                      className="tp-call-hero__impact"
                      data-tone={callBadgeTone(badge.tone)}
                      title={badge.detail || badge.label}
                    >
                      <Info aria-hidden="true" />{badge.label}
                    </span>
                  ))}
                  {(item?.badges?.length || 0) > 1 && (
                    <span className="tp-call-badges__more">+{(item?.badges?.length || 0) - 1}</span>
                  )}
                </div>
              </div>
            </section>

            <div className="tp-call-card__row">
              <span className="tp-call-card__row-label"><Phone aria-hidden="true" />التواصل</span>
              <div className="tp-call-card__row-content">{renderContactButtons(row.student)}</div>
            </div>

            <div className="tp-call-card__row">
              <span className="tp-call-card__row-label">
                <SlidersHorizontal aria-hidden="true" />الإجراء
                {(statusSaving || call?.completedAt) && (
                  <small className="tp-call-card__last">
                    {statusSaving ? "جاري الحفظ…" : `آخر تواصل: ${formatAppDate(call?.completedAt)}`}
                  </small>
                )}
              </span>
              <div className="tp-call-card__actions" role="group" aria-label={`إجراء التواصل مع ${row.student.name}`}>
                {callContactActions.map((action) => {
                  const ActionIcon = callContactActionIcons[action.value];
                  return (
                    <button
                      key={action.value}
                      type="button"
                      className="tp-call-card__action"
                      data-tone={action.tone}
                      aria-pressed={contactStatus === action.value}
                      disabled={!row.focusItem || statusSaving}
                      onClick={() => void saveCallStatus(row, contactStatus === action.value ? "" : action.value)}
                    >
                      <ActionIcon aria-hidden="true" />{action.value}
                    </button>
                  );
                })}
                <button
                  type="button"
                  className="tp-call-card__action"
                  data-tone="muted"
                  aria-pressed={!contactStatus}
                  disabled={!row.focusItem || statusSaving}
                  onClick={() => void saveCallStatus(row, "")}
                >
                  <Ban aria-hidden="true" />بدون إجراء
                </button>
              </div>
            </div>

            <div className="tp-call-card__note-row">{renderNoteArea(row, "card")}</div>
          </div>

          {/* Scan a code with another phone to dial the number directly. */}
          <aside className="tp-call-card__qr" aria-label="نقل الرقم إلى هاتف آخر عبر QR">
            {renderQrTile(row, "الطالب", row.student.phone, <User aria-hidden="true" />)}
            {renderQrTile(row, "ولي الأمر", row.student.parentPhone, <Users aria-hidden="true" />)}
          </aside>
        </div>
      </article>
    );
  };

  // ── The details window ──────────────────────────────────────────────────
  const renderDetailsWindow = () => {
    const row = detailsLiveRow;
    const item = row?.focusItem || null;
    const displayMode = row ? callGradeDisplayModes[row.student.id] || "latest" : "latest";
    const displayedGradeItems = row ? visibleCallGradeItems(row.items, displayMode) : [];
    const historyGradeItems = displayedGradeItems.filter((gradeItem) => gradeItem.id !== item?.id);
    const focusCall = row ? callLogForRow(row) : undefined;
    return (
      <Dialog open={Boolean(row)} onOpenChange={(open) => { if (!open) setDetailsRow(null); }}>
        {row && (
          <DialogContent className="tp-modal tp-call-details" dir="rtl">
            <div className="tp-modal__hero">
              <span className="tp-modal__hero-icon" aria-hidden="true"><PhoneCall /></span>
              <DialogHeader className="tp-modal__heading">
                <DialogTitle>{row.student.name}</DialogTitle>
                <p className="tp-modal__subtitle">
                  <span dir="ltr">{row.student.code}</span> · {row.student.status} · الفرص: {studentOpportunityText(row.student)}
                </p>
              </DialogHeader>
            </div>
            <div className="tp-modal__body">
              <section className="tp-modal__section" aria-labelledby="tp-call-focus">
                <h3 id="tp-call-focus" className="tp-modal__title">الامتحان المختار</h3>
                {item ? (
                  <ul className="tp-call-exams">
                    {renderCallGradeChip(row, item)}
                  </ul>
                ) : (
                  <p className="tp-modal__muted">لا يوجد امتحان محدد.</p>
                )}
                {/* The exam card already names a recorded action; add what it lacks. */}
                {!focusCall ? (
                  <p className="tp-modal__muted">إجراء التواصل: بدون إجراء</p>
                ) : focusCall.completedAt ? (
                  <p className="tp-modal__muted">آخر تواصل: {formatAppDate(focusCall.completedAt)}</p>
                ) : null}
              </section>

              <section className="tp-modal__section" aria-labelledby="tp-call-history">
                <div className="tp-modal__section-head">
                  <h3 id="tp-call-history" className="tp-modal__title">سجل الامتحانات</h3>
                  <span className="tp-modal__muted">{row.items.length} امتحان/امتحانات مرتبطة بهذه الدورة</span>
                </div>
                <div role="group" aria-label="عرض سجل الامتحانات" className="tp-call-modes">
                  {(Object.keys(callGradeDisplayModeLabels) as CallGradeDisplayMode[]).map((mode) => (
                    <button
                      key={mode}
                      type="button"
                      className="tp-call-modes__btn"
                      aria-pressed={displayMode === mode}
                      onClick={() =>
                        setCallGradeDisplayModes((current) => ({
                          ...current,
                          [row.student.id]: mode,
                        }))
                      }
                    >
                      {callGradeDisplayModeLabels[mode]}
                    </button>
                  ))}
                </div>
                {displayedGradeItems.length === 0 ? (
                  <p className="tp-modal__empty-note">لا توجد درجات مسجلة لهذا الطالب ضمن امتحانات هذه الدورة.</p>
                ) : historyGradeItems.length === 0 ? (
                  <p className="tp-modal__empty-note">لا توجد امتحانات إضافية لعرضها غير الامتحان المختار.</p>
                ) : (
                  <ul className="tp-call-exams">
                    {historyGradeItems.map((gradeItem) => renderCallGradeChip(row, gradeItem))}
                  </ul>
                )}
              </section>

              <section className="tp-modal__section" aria-labelledby="tp-call-contact">
                <h3 id="tp-call-contact" className="tp-modal__title">التواصل</h3>
                <div className="flex flex-wrap gap-2">
                  {renderPhoneLink("الطالب", row.student.phone)}
                  {renderPhoneLink("ولي الأمر", row.student.parentPhone)}
                  {renderTelegramLink(row.student.telegram, row.student.username)}
                </div>
              </section>

              <section className="tp-modal__section" aria-label="ملاحظات المكالمات">
                {renderNoteArea(row, "window")}
              </section>

              <div className="tp-modal__actions">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setDetailsRow(null);
                    openProfile(row.student.id);
                  }}
                >
                  ملف الطالب
                </Button>
              </div>
            </div>
          </DialogContent>
        )}
      </Dialog>
    );
  };

  const contactCounts = callDatabaseStats?.contactCounts;

  return (
    <div className="tp-calls" data-variant={variant}>
      <section className="tp-calls__setup" aria-label="اختيار الدورة والامتحان">
        <div className="tp-calls__picker">
          <div className="tp-calls__field">
            <Label htmlFor={`calls-course-${variant}`}>الدورة</Label>
            <Select
              value={callCourseId || "__none__"}
              onValueChange={(value) => {
                setCallCourseId(value === "__none__" ? "" : value);
              }}
            >
              <SelectTrigger id={`calls-course-${variant}`}>
                <SelectValue placeholder="اختر الدورة" />
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
          <ChevronLeft className="tp-calls__arrow" aria-hidden="true" />
          <div className="tp-calls__field">
            <Label htmlFor={`calls-exam-${variant}`}>الامتحان</Label>
            <Select
              value={callExamId || "__none__"}
              disabled={!callCourseSelected || callCourseExamsLoading}
              onValueChange={(value) => {
                setCallExamId(value === "__none__" ? "" : value);
                setCallGradePage(1);
              }}
            >
              <SelectTrigger id={`calls-exam-${variant}`}>
                <SelectValue placeholder="اختر الامتحان" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">بدون اختيار امتحان</SelectItem>
                {callCourseExams.map((exam) => (
                  <SelectItem key={exam.id} value={exam.id}>
                    {exam.name} — {formatAppDate(exam.date)}{exam.active ? "" : " (معطل)"}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="tp-calls__export">
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
            <Button variant="outline" disabled>
              تصدير
            </Button>
          )}
        </div>
      </section>

      {!callCourseSelected ? (
        <p className="tp-calls__empty">اختر الدورة ثم الامتحان لعرض الطلاب.</p>
      ) : !callExamSelected ? (
        <p className="tp-calls__empty">اختر الامتحان لعرض الطلاب.</p>
      ) : (
        <>
          <section className="tp-calls__filters" aria-label="فلاتر المكالمات">
            <div className="tp-calls__filter-row">
              <div className="tp-calls__search">
                <Search aria-hidden="true" />
                <Input
                  id={`follow-up-calls-search-${variant}`}
                  name="calls-search"
                  data-teacherpro-search={variant === "page" ? "true" : undefined}
                  value={callGeneralSearch}
                  onChange={(event) => {
                    setCallGeneralSearch(event.target.value);
                    setCallGradePage(1);
                  }}
                  aria-label="بحث في الطلاب"
                  placeholder="بحث: اسم، كود، هاتف، تيليجرام، مدرسة أو درجة"
                  title="كل الكلمات المكتوبة لازم تنطبق"
                />
              </div>
              <div className="tp-calls__field tp-calls__status">
                <Label htmlFor={`calls-status-${variant}`}>حالة الطالب في الامتحان</Label>
                <Select
                  value={callStatusFilter}
                  onValueChange={(value) => {
                    setCallStatusFilter(value as CallStatusFilter);
                    setCallGradePage(1);
                  }}
                >
                  <SelectTrigger id={`calls-status-${variant}`}>
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
              <div className="tp-calls__field tp-calls__status">
                <Label htmlFor={`calls-share-${variant}`}>تقسيم العمل</Label>
                <Select value={callWorkShare || "all"} onValueChange={chooseCallWorkShare}>
                  <SelectTrigger
                    id={`calls-share-${variant}`}
                    title="لكل جهاز قسم ثابت من الطلاب لا يتداخل مع الأجهزة الأخرى"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">كل الطلاب</SelectItem>
                    {callWorkShareChoices.map((option) => (
                      <SelectItem key={option} value={option}>
                        {callWorkShareLabel(option)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <button
                type="button"
                className="tp-calls__toggle"
                aria-pressed={callNotesFilter === "with-notes"}
                aria-label="إظهار أصحاب الملاحظات فقط"
                onClick={() => {
                  setCallNotesFilter((current) => (current === "with-notes" ? "all" : "with-notes"));
                  setCallGradePage(1);
                }}
              >
                <StickyNote aria-hidden="true" />لديهم ملاحظات
              </button>
              {callFiltersActive && (
                <Button type="button" variant="ghost" size="sm" className="tp-calls__reset" onClick={resetCallFilters}>
                  <RotateCcw className="size-4" aria-hidden="true" />تصفير الفلاتر
                </Button>
              )}
            </div>

            <div role="group" aria-label="حالة التواصل" className="tp-calls__contact-filters">
              {callContactFilterChips.map((chip) => (
                <button
                  key={chip.value}
                  type="button"
                  className="tp-calls__chip"
                  data-tone={chip.tone}
                  aria-pressed={callContactStatusFilter === chip.value}
                  onClick={() => {
                    setCallContactStatusFilter(chip.value);
                    setCallGradePage(1);
                  }}
                >
                  {chip.tone && <span className="tp-calls__chip-dot" aria-hidden="true" />}
                  <span>{chip.label}</span>
                  <b>{callStatValue(contactCounts?.[chip.countKey])}</b>
                </button>
              ))}
            </div>

            <details className="tp-calls__more" open={Boolean(callGradeFrom || callGradeTo) || undefined}>
              <summary>فلاتر إضافية</summary>
              <div className="tp-calls__range">
                <div className="tp-calls__field">
                  <Label htmlFor={`follow-up-calls-grade-from-${variant}`}>الدرجة من</Label>
                  <Input
                    id={`follow-up-calls-grade-from-${variant}`}
                    name="calls-grade-from"
                    type="number"
                    inputMode="decimal"
                    min={0}
                    max={selectedCallExam?.fullMark}
                    step="any"
                    value={callGradeFrom}
                    onChange={(event) => {
                      setCallGradeFrom(event.target.value);
                      setCallGradePage(1);
                    }}
                    placeholder="مثال: 20"
                  />
                </div>
                <div className="tp-calls__field">
                  <Label htmlFor={`follow-up-calls-grade-to-${variant}`}>الدرجة إلى</Label>
                  <Input
                    id={`follow-up-calls-grade-to-${variant}`}
                    name="calls-grade-to"
                    type="number"
                    inputMode="decimal"
                    min={0}
                    max={selectedCallExam?.fullMark}
                    step="any"
                    value={callGradeTo}
                    onChange={(event) => {
                      setCallGradeTo(event.target.value);
                      setCallGradePage(1);
                    }}
                    placeholder={`حتى ${selectedCallExam?.fullMark ?? "الدرجة الكاملة"}`}
                  />
                </div>
              </div>
            </details>

            {callGradeRangeInvalid ? (
              <p className="tp-calls__hint" data-tone="danger" role="alert">
                درجة «من» يجب ألا تكون أكبر من درجة «إلى».
              </p>
            ) : callGradeFrom || callGradeTo ? (
              <p className="tp-calls__hint">نطاق الدرجة شامل للحدّين، وعند استخدامه تظهر الدرجات الرقمية فقط.</p>
            ) : null}
          </section>

          <p className="tp-calls__count" data-count-scope="filtered" aria-live="polite">
            المطابقون للفلاتر: <b>{callStatValue(callDatabaseStats?.total)}</b>
            {callLoading && visibleCallRows.length > 0 ? " · جاري التحديث…" : ""}
            {callUpdatesPending && (
              <>
                {" · "}
                <button
                  type="button"
                  className="tp-calls__refresh"
                  title="توجد تغييرات جديدة من مستخدم أو صفحة أخرى"
                  onClick={() => setCallFilterRefreshKey((current) => current + 1)}
                >
                  تغييرات جديدة — تحديث
                </button>
              </>
            )}
            {callDepartedCount > 0 && (
              <span className="tp-calls__departed">
                {" "}· {callDepartedCount} تم إجراؤهم في هذه الصفحة ويبقون ظاهرين حتى «التالي»
              </span>
            )}
          </p>

          <div className="tp-calls__list">
            {callLoading && visibleCallRows.length === 0 ? (
              renderCallLoadingSkeleton()
            ) : visibleCallRows.length === 0 ? (
              <p className="tp-calls__empty">لا يوجد طلاب مطابقون للدورة والامتحان والفلاتر الحالية.</p>
            ) : (
              visibleCallRows.map(renderCallRow)
            )}
          </div>

          {visibleCallRows.length > 0 && (
            <nav className="tp-calls__pager" aria-label="صفحات الطلاب">
              <Button
                variant="outline"
                size="sm"
                disabled={callSafePage <= 1}
                onClick={() => setCallGradePage((page) => Math.max(1, page - 1))}
              >
                السابق
              </Button>
              <span>
                صفحة <b>{callSafePage}</b> من <b>{callTotalPages}</b> · المعروض في الصفحة: <b>{visibleCallRows.length}</b>
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={callSafePage >= callTotalPages}
                onClick={() => {
                  // Students who left the contact filter shrank the list, so the
                  // same page number now holds the next students: reload it
                  // instead of skipping them.
                  if (callDepartedCount > 0) setCallFilterRefreshKey((current) => current + 1);
                  else setCallGradePage((page) => Math.min(callTotalPages, page + 1));
                }}
              >
                التالي
              </Button>
            </nav>
          )}
        </>
      )}

      {renderDetailsWindow()}

      {profileDialogOpen && selectedProfileStudent && (
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
      )}
    </div>
  );
}

export function FollowUpCallsView() {
  return <CallsWorkspace variant="page" />;
}
