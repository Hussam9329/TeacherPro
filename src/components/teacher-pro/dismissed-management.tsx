"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTeacherStore, type Student } from "@/lib/teacher-store";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { useActionLock } from "@/hooks/use-action-lock";
import { useTeacherProSyncKey } from "@/hooks/use-teacherpro-sync";
import { formatBaghdadDateTime } from "@/lib/baghdad-time";
import { studentApi, studentProfileLogApi } from "@/lib/api";
import { toast } from "@/lib/user-toast";
import { emitTeacherProDataChanged } from "@/lib/teacherpro-sync";
import { normalizeTelegramIdentifier } from "@/lib/student-utils";
import {
  buildOpportunityTelegramAttachment,
  buildOpportunityTelegramHtml,
  buildOpportunityTelegramReport,
  canUseDirectDismissedTelegramDraft,
  canUseSingleDismissedTelegramMessage,
  escapeDismissedHistoryHtml,
  safeDismissedHistoryFileName,
  type OpportunityTelegramDetails,
  type OpportunityTelegramStudent,
} from "@/lib/dismissed-history";
import {
  buildStudentDetailsFromProfileLog,
  sanitizeStudentDetailsForHtml,
} from "./export-dialog";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Label } from "@/components/ui/label";
import { toLatinDigits } from "@/lib/format";
import { getOpportunityLimit } from "@/lib/opportunity-balance";
import { DEFAULT_MANUAL_RESTORATION_REASON, manualRestorationAmount } from "@/lib/manual-restoration";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Ban,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Clock3,
  Download,
  FileClock,
  GraduationCap,
  Handshake,
  MessageCircle,
  Phone,
  RotateCcw,
  Search,
  Send,
  ShieldAlert,
  UserRound,
  Users,
} from "lucide-react";

const PAGE_SIZE = 24;

type TimelineEvent = {
  id: string;
  date: string;
  kind: string;
  title: string;
  details: string[];
  tone: "neutral" | "info" | "warning" | "danger" | "success";
};

type StudentHistory = {
  source: "database";
  student: {
    id: string;
    name: string;
    code: string;
    school: string;
    gender: string;
    phone: string;
    parentPhone: string;
    telegram: string;
    username?: string;
    courseId: string;
    courseName: string;
    courseProgram: string;
    courseTerm: string;
    studyType: string;
    locationScope: string;
    mainSite: string;
    subSite: string;
    status: string;
    dismissalReason: string;
    dismissalNotes: string;
    opportunities: number;
    baseOpportunities: number;
    createdAt: string;
    dismissalAt: string;
  };
  summary: {
    opportunityEvents: number;
    gradeEvents: number;
    pendingAfterDismissal: number;
    notes: number;
    calls: number;
    leaves: number;
  };
  events: TimelineEvent[];
  sections: {
    opportunities: boolean;
    grades: boolean;
    followUp: boolean;
    calls: boolean;
    leaves: boolean;
    notes: boolean;
    correction: boolean;
    archives: boolean;
  };
  generatedAt: string;
};

type ManagedDismissalStudent = Student & {
  wasDismissed?: boolean;
  lastDismissalReason?: string;
  lastDismissalAt?: string;
};

type ListResponse = {
  students: ManagedDismissalStudent[];
  totalCount: number;
  page: number;
  pageSize: number;
  totalPages: number;
  hasMore: boolean;
};

type NotesFilter = "all" | "with-notes" | "without-notes";

type DismissedStats = {
  total: number;
  current: number;
  former: number;
  withNotes: number;
};

const EMPTY_DISMISSED_STATS: DismissedStats = {
  total: 0,
  current: 0,
  former: 0,
  withNotes: 0,
};

function phoneForWhatsApp(phone?: string) {
  const digits = String(phone || "").replace(/\D/g, "");
  if (!digits) return "";
  if (digits.startsWith("964")) return digits;
  if (digits.startsWith("0")) return `964${digits.slice(1)}`;
  return digits;
}

function whatsappLink(phone?: string) {
  const digits = phoneForWhatsApp(phone);
  return digits ? `https://wa.me/${digits}` : "#";
}

function telegramUsername(value?: string) {
  return normalizeTelegramIdentifier(value)
    .replace(/^https?:\/\/t\.me\//, "")
    .replace(/^t\.me\//, "")
    .split(/[/?#]/)[0]
    .replace(/^@+/, "")
    .trim();
}

/**
 * يوزر التليجرام الصالح للمراسلة: يفضّل اليوزر المستعاد (username)
 * ويرفض المعرف الرقمي لأنه لا يفتح محادثة تيليجرام.
 */
function studentTelegramHandle(student: {
  telegram?: string | null;
  username?: string | null;
}): string {
  const preferred = telegramUsername(student.username || "");
  if (preferred && !/^\d+$/.test(preferred)) return preferred;
  const fallback = telegramUsername(student.telegram || "");
  return fallback && !/^\d+$/.test(fallback) ? fallback : "";
}

function toneClasses(tone: TimelineEvent["tone"]) {
  if (tone === "danger") return "border-danger-line bg-danger-soft";
  if (tone === "warning") return "border-warning-line bg-warning-soft";
  if (tone === "success") return "border-success-line bg-success-soft";
  if (tone === "info") return "border-info-line bg-info-soft";
  return "border-border bg-muted/20";
}

function historyMetrics(history: StudentHistory) {
  return [
    history.sections.opportunities
      ? {
          key: "opportunities",
          value: history.summary.opportunityEvents,
          label: "حركات الفرص",
          danger: false,
        }
      : null,
    history.sections.grades
      ? {
          key: "grades",
          value: history.summary.gradeEvents,
          label: "الدرجات",
          danger: false,
        }
      : null,
    history.sections.grades
      ? {
          key: "pending-grades",
          value: history.summary.pendingAfterDismissal,
          label: "معلّقة بعد الفصل",
          danger: true,
        }
      : null,
    history.sections.notes
      ? {
          key: "notes",
          value: history.summary.notes,
          label: "ملاحظات",
          danger: false,
        }
      : null,
    history.sections.calls
      ? {
          key: "calls",
          value: history.summary.calls,
          label: "اتصالات",
          danger: false,
        }
      : null,
    history.sections.leaves
      ? {
          key: "leaves",
          value: history.summary.leaves,
          label: "إجازات",
          danger: false,
        }
      : null,
  ].filter((metric): metric is NonNullable<typeof metric> => Boolean(metric));
}

function buildHtmlReport(history: StudentHistory) {
  const s = history.student;
  const metrics = historyMetrics(history);
  const statusLabel = s.status === "مفصول" ? "مفصول" : "مفصول سابقاً";
  const eventRows = history.events
    .map(
      (event, index) => `
      <section class="event ${escapeDismissedHistoryHtml(event.tone)}">
        <div class="event-index">${index + 1}</div>
        <div class="event-body">
          <div class="event-head"><strong>${escapeDismissedHistoryHtml(event.title)}</strong><span>${escapeDismissedHistoryHtml(formatBaghdadDateTime(event.date))}</span></div>
          ${event.details.map((detail) => `<div class="detail">${escapeDismissedHistoryHtml(detail)}</div>`).join("")}
        </div>
      </section>`,
    )
    .join("");

  const info = [
    ["الاسم الرباعي", s.name],
    ["الكود", s.code],
    ["الدورة", s.courseName],
    ["المدرسة", s.school || "—"],
    ["رقم الطالب", s.phone || "—"],
    ["رقم ولي الأمر", s.parentPhone || "—"],
    ["يوزر تيليجرام", s.username || "—"],
    ["معرف تيليجرام", s.telegram || "—"],
    ["نوع الاشتراك", s.courseProgram || "—"],
    ["الكورس", s.courseTerm || "—"],
    ["نوع البرنامج", s.studyType || "—"],
    ["الموقع", [s.locationScope, s.mainSite, s.subSite].filter(Boolean).join(" / ") || "—"],
    ["سبب الفصل", s.dismissalReason || "غير مسجل"],
    ["ملاحظات الفصل", s.dismissalNotes || "—"],
    ["تاريخ التسجيل", formatBaghdadDateTime(s.createdAt)],
    ["تاريخ الفصل", formatBaghdadDateTime(s.dismissalAt)],
  ];

  return `<!doctype html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>سجل الطالب - ${escapeDismissedHistoryHtml(s.name)}</title>
<style>
:root{font-family:Arial,Tahoma,sans-serif;color:#19293A;background:#F3F0E4}
*{box-sizing:border-box}
html,body{max-width:100%;overflow-x:hidden}
body{margin:0;padding:24px}
.page{max-width:1000px;margin:auto;background:#FBF9EB;border:1px solid #E6E3D9;border-radius:18px;padding:28px;overflow-wrap:anywhere;word-break:break-word}
.header{display:flex;justify-content:space-between;gap:18px;align-items:flex-start;border-bottom:3px solid #19293A;padding-bottom:18px;margin-bottom:20px}
.brand h1{font-size:24px;margin:0 0 6px}.brand p{margin:0;color:#5B6674}
.status{padding:8px 12px;border-radius:999px;background:#F7E8DB;color:#A34645;font-weight:700}
.grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;margin:18px 0}
.info-box{border:1px solid #E6E3D9;border-radius:12px;padding:10px;break-inside:avoid}
.info-box b{display:block;font-size:11px;color:#5B6674;margin-bottom:4px}
.summary{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:8px;margin:18px 0}
.metric{border:1px solid #E6E3D9;border-radius:12px;padding:10px;text-align:center}
.metric strong{display:block;font-size:20px}.metric span{font-size:11px;color:#5B6674}
.section-title{font-size:18px;margin:26px 0 12px}
.event{display:flex;gap:12px;border:1px solid #E6E3D9;border-radius:12px;padding:12px;margin:0 0 10px;break-inside:avoid}
.event-index{width:28px;height:28px;border-radius:50%;background:#19293A;color:#FBF9EB;display:grid;place-items:center;flex:0 0 28px;font-weight:700}
.event-body{min-width:0;flex:1;overflow-wrap:anywhere;word-break:break-word}
.event-head{display:flex;justify-content:space-between;gap:12px;margin-bottom:6px}
.event-head span{font-size:12px;color:#5B6674;white-space:nowrap}
.detail{font-size:13px;line-height:1.7}
.danger{border-color:#DDA198;background:#F9F1E3}.warning{border-color:#D4ABA5;background:#F7F1E4}
.success{border-color:#A8ABA9;background:#F0EFE2}.info{border-color:#B5B7B6;background:#F3F2E5}
@media(max-width:760px){body{padding:8px}.page{padding:14px;border-radius:10px}.header{display:block}.status{display:inline-block;margin-top:10px}.grid{grid-template-columns:1fr 1fr}.summary{grid-template-columns:repeat(2,1fr)}.event-head{display:block}.event-head span{display:block;margin-top:4px}.event{padding:10px}}
@media(max-width:430px){.grid{grid-template-columns:1fr}.summary{grid-template-columns:1fr 1fr}}
@page{size:A4;margin:12mm}
@media print{html,body{overflow:visible}body{padding:0;background:#FBF9EB;-webkit-print-color-adjust:exact;print-color-adjust:exact}.page{max-width:none;border:0;border-radius:0;padding:0}.no-print{display:none!important}.event,.info-box,.metric{page-break-inside:avoid;break-inside:avoid}.header{page-break-after:avoid}.summary{grid-template-columns:repeat(3,minmax(0,1fr))}}
</style>
</head>
<body>
<main class="page">
<div class="no-print" style="display:flex;justify-content:flex-start;margin-bottom:12px"><button onclick="window.print()" style="border:1px solid #D1D0CA;background:#FBF9EB;border-radius:10px;padding:8px 14px;cursor:pointer;font-weight:700">طباعة التقرير</button></div>
<header class="header"><div class="brand"><h1>سجل الفصل للطالب</h1><p>إدارة حسن فلاح مدرس مادة الاحياء</p></div><div class="status">${escapeDismissedHistoryHtml(statusLabel)}</div></header>
<div class="grid">${info.map(([k, v]) => `<div class="info-box"><b>${escapeDismissedHistoryHtml(k)}</b><span>${escapeDismissedHistoryHtml(v)}</span></div>`).join("")}</div>
<div class="summary">${metrics.map((metric) => `<div class="metric"><strong>${metric.value}</strong><span>${escapeDismissedHistoryHtml(metric.label)}</span></div>`).join("")}</div>
<h2 class="section-title">السجل الزمني الكامل</h2>
${eventRows}
</main>
</body>
</html>`;
}

function downloadHistoryHtml(history: StudentHistory) {
  const blob = new Blob([buildHtmlReport(history)], {
    type: "text/html;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${safeDismissedHistoryFileName(`سجل-${history.student.name}-${history.student.code}`)}.html`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function downloadOpportunityHtml(
  student: OpportunityTelegramStudent,
  details: OpportunityTelegramDetails,
) {
  const blob = new Blob([buildOpportunityTelegramHtml(student, details)], {
    type: "text/html;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${safeDismissedHistoryFileName(`سجل-${student.name}-${student.code}`)}.html`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function DismissedManagementView() {
  const { courses, courseName, mergeStudentsCache, currentUser } = useTeacherStore();
  const syncKey = useTeacherProSyncKey(["students", "grades", "opportunities", "dismissed", "follow-up"]);
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search, 180);
  const [courseId, setCourseId] = useState("");
  const [historyScope, setHistoryScope] = useState<"all" | "current" | "former">("all");
  const [notesFilter, setNotesFilter] = useState<NotesFilter>("all");
  const [page, setPage] = useState(1);
  const [students, setStudents] = useState<ManagedDismissalStudent[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [stats, setStats] = useState<DismissedStats>(EMPTY_DISMISSED_STATS);
  const [statsLoading, setStatsLoading] = useState(false);
  const [statsError, setStatsError] = useState("");
  const [noteDrafts, setNoteDrafts] = useState<Record<string, string>>({});
  const [savingNoteIds, setSavingNoteIds] = useState<Record<string, boolean>>({});
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [histories, setHistories] = useState<Record<string, StudentHistory>>({});
  const [historyLoading, setHistoryLoading] = useState<Record<string, boolean>>({});
  const [telegramLoading, setTelegramLoading] = useState<Record<string, boolean>>({});
  const [historyErrors, setHistoryErrors] = useState<Record<string, string>>({});
  const [reactivateDialog, setReactivateDialog] = useState<{
    student: ManagedDismissalStudent | null;
    open: boolean;
  }>({ student: null, open: false });
  const [restorationMode, setRestorationMode] = useState<"pledge" | "manual">("pledge");
  const [restorationAmount, setRestorationAmount] = useState("1");
  const [restorationReason, setRestorationReason] = useState(DEFAULT_MANUAL_RESTORATION_REASON);
  const { locked: isReactivating, runLocked: runReactivateLocked } = useActionLock();
  const actor = currentUser();
  const canReactivate = Boolean(
    actor &&
      (actor.username?.trim().toLowerCase() === "admin" ||
        actor.roleId === "role_admin" ||
        actor.permissions?.includes("students.edit")),
  );
  const canEditDismissalNotes = canReactivate;
  const historyControllersRef = useRef<Map<string, AbortController>>(
    new Map(),
  );

  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({
      page: String(page),
      pageSize: String(PAGE_SIZE),
    });
    if (courseId) params.set("courseId", courseId);
    params.set("historyScope", historyScope);
    if (notesFilter !== "all") params.set("notesFilter", notesFilter);
    if (debouncedSearch.trim()) params.set("q", debouncedSearch.trim());

    setLoading(true);
    setError("");
    fetch(`/api/dismissed-management/list?${params.toString()}`, {
      credentials: "same-origin",
      signal: controller.signal,
    })
      .then(async (res) => {
        const payload = (await res.json().catch(() => null)) as
          | ListResponse
          | { error?: string }
          | null;
        if (!res.ok) {
          throw new Error(
            (payload as { error?: string } | null)?.error ||
              "تعذر تحميل المفصولين.",
          );
        }
        return payload as ListResponse;
      })
      .then((payload) => {
        if (controller.signal.aborted) return;
        const nextTotalPages = Math.max(
          1,
          Number(payload.totalPages || 1),
        );
        if (page > nextTotalPages) {
          setPage(nextTotalPages);
          return;
        }
        const rows = payload.students || [];
        setStudents(rows);
        setTotalCount(Number(payload.totalCount || 0));
        setTotalPages(nextTotalPages);
        mergeStudentsCache(rows);
      })
      .catch((err) => {
        if (!controller.signal.aborted) {
          setStudents([]);
          setTotalCount(0);
          setTotalPages(1);
          setError(
            err instanceof Error ? err.message : "تعذر تحميل المفصولين.",
          );
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, [courseId, debouncedSearch, historyScope, notesFilter, page, mergeStudentsCache, syncKey]);

  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({ historyScope });
    if (courseId) params.set("courseId", courseId);
    if (notesFilter !== "all") params.set("notesFilter", notesFilter);
    if (debouncedSearch.trim()) params.set("q", debouncedSearch.trim());

    setStatsLoading(true);
    setStatsError("");
    fetch(`/api/dismissed-management/stats?${params.toString()}`, {
      credentials: "same-origin",
      signal: controller.signal,
    })
      .then(async (res) => {
        const payload = (await res.json().catch(() => null)) as
          | { filtered?: DismissedStats; stats?: DismissedStats; error?: string }
          | null;
        if (!res.ok) {
          throw new Error(payload?.error || "تعذر تحميل إحصائيات المفصولين.");
        }
        return payload;
      })
      .then((payload) => {
        if (controller.signal.aborted) return;
        setStats(payload?.filtered || payload?.stats || EMPTY_DISMISSED_STATS);
      })
      .catch((err) => {
        if (controller.signal.aborted) return;
        setStats(EMPTY_DISMISSED_STATS);
        setStatsError(
          err instanceof Error ? err.message : "تعذر تحميل إحصائيات المفصولين.",
        );
      })
      .finally(() => {
        if (!controller.signal.aborted) setStatsLoading(false);
      });

    return () => controller.abort();
  }, [courseId, debouncedSearch, historyScope, notesFilter, syncKey]);

  useEffect(() => {
    const controllers = historyControllersRef.current;
    setHistories({});
    setExpanded({});
    setHistoryErrors({});
    return () => {
      controllers.forEach((controller) => controller.abort());
      controllers.clear();
    };
  }, [courseId, debouncedSearch, historyScope, page, syncKey]);

  const loadHistory = useCallback(
    async (studentId: string) => {
      if (histories[studentId]) return histories[studentId];

      historyControllersRef.current.get(studentId)?.abort();
      const controller = new AbortController();
      historyControllersRef.current.set(studentId, controller);
      setHistoryLoading((current) => ({ ...current, [studentId]: true }));
      setHistoryErrors((current) => ({ ...current, [studentId]: "" }));
      try {
        const res = await fetch(
          `/api/dismissed-management/history?studentId=${encodeURIComponent(studentId)}`,
          { credentials: "same-origin", signal: controller.signal },
        );
        const payload = (await res.json().catch(() => null)) as
          | StudentHistory
          | { error?: string }
          | null;
        if (!res.ok) {
          throw new Error(
            (payload as { error?: string } | null)?.error ||
              "تعذر تحميل السجل الكامل.",
          );
        }
        const history = payload as StudentHistory;
        if (historyControllersRef.current.get(studentId) !== controller) {
          return null;
        }
        setHistories((current) => ({ ...current, [studentId]: history }));
        return history;
      } catch (err) {
        if (controller.signal.aborted) return null;
        const message =
          err instanceof Error ? err.message : "تعذر تحميل السجل الكامل.";
        setHistoryErrors((current) => ({
          ...current,
          [studentId]: message,
        }));
        return null;
      } finally {
        if (historyControllersRef.current.get(studentId) === controller) {
          historyControllersRef.current.delete(studentId);
          setHistoryLoading((current) => ({
            ...current,
            [studentId]: false,
          }));
        }
      }
    },
    [histories],
  );

  const toggleHistory = async (studentId: string) => {
    const next = !expanded[studentId];
    setExpanded(next ? { [studentId]: true } : {});
    if (next && !histories[studentId]) await loadHistory(studentId);
  };

  const openTelegram = async (student: Student) => {
    const username = studentTelegramHandle(student);
    if (!username) return;

    setTelegramLoading((current) => ({ ...current, [student.id]: true }));
    try {
      // نفس مصدر تصدير HTML: لوغ ملف الطالب (profile-log) من قاعدة
      // البيانات داخل transaction واحد، وليس أي مصدر واجهة آخر.
      const profile = await studentProfileLogApi.get(student.id);
      if (!profile) {
        toast.error(
          "تعذر تجهيز تقرير الطالب؛ لم تُرسل أي رسالة.",
        );
        return;
      }
      const sections = profile.sections;
      if (sections && !sections.grades && !sections.opportunities) {
        toast.error(
          "حسابك لا يملك صلاحية عرض درجات أو فرص هذا الطالب؛ لم تُرسل أي رسالة.",
        );
        return;
      }

      const rawDetails = buildStudentDetailsFromProfileLog(profile);
      // نفس تنظيف تقرير HTML: إخفاء سجلات التسوية التاريخية وصياغة
      // الأسباب نفسها حتى تتطابق الرسالة مع الملف المنشور حرفياً.
      const details = sanitizeStudentDetailsForHtml({
        [student.id]: rawDetails,
      })[student.id];
      if (!details) return;

      const managed = student as ManagedDismissalStudent;
      const profileStudent = (profile.student || {}) as Record<string, unknown>;
      const dismissalDateTime = managed.lastDismissalAt
        ? formatBaghdadDateTime(managed.lastDismissalAt)
        : "—";
      const opportunitiesRaw =
        profileStudent.opportunities ?? student.opportunities ?? null;
      const telegramStudent: OpportunityTelegramStudent = {
        name: String(profileStudent.name ?? student.name ?? ""),
        code: String(profileStudent.code ?? student.code ?? ""),
        courseName: courseName(student.courseId),
        opportunities:
          opportunitiesRaw === null ? null : Number(opportunitiesRaw),
        status: String(profileStudent.status ?? student.status ?? ""),
        dismissalDate:
          dismissalDateTime === "—" ? "" : dismissalDateTime.split(" ")[0],
        dismissalReason: String(
          profileStudent.dismissalReason ??
            managed.lastDismissalReason ??
            student.dismissalReason ??
            "",
        ),
        dismissalNotes: String(profileStudent.dismissalNotes ?? ""),
      };

      const completeMessage = buildOpportunityTelegramReport(
        telegramStudent,
        details,
      );
      if (canUseDirectDismissedTelegramDraft(completeMessage)) {
        window.location.assign(
          `tg://resolve?domain=${encodeURIComponent(username)}&text=${encodeURIComponent(completeMessage)}`,
        );
        return;
      }

      if (canUseSingleDismissedTelegramMessage(completeMessage)) {
        try {
          await navigator.clipboard.writeText(completeMessage);
          window.alert(
            "تم نسخ التقرير. ستفتح محادثة الطالب الآن؛ الصق الرسالة ثم أرسلها.",
          );
          window.location.assign(
            `tg://resolve?domain=${encodeURIComponent(username)}`,
          );
          return;
        } catch {
          downloadOpportunityHtml(telegramStudent, details);
          window.alert(
            "تعذر نسخ التقرير، فتم تنزيله كملف HTML. ستفتح المحادثة الآن لإرفاقه.",
          );
        }
      } else {
        downloadOpportunityHtml(telegramStudent, details);
        window.alert(
          "التقرير أطول من حد رسالة تيليجرام، فتم تنزيله كملف HTML. ستفتح المحادثة الآن لإرفاقه.",
        );
      }

      const attachmentMessage = buildOpportunityTelegramAttachment(
        telegramStudent,
        details,
      );
      window.location.assign(
        `tg://resolve?domain=${encodeURIComponent(username)}&text=${encodeURIComponent(attachmentMessage)}`,
      );
    } finally {
      setTelegramLoading((current) => ({ ...current, [student.id]: false }));
    }
  };

  const exportHtml = async (student: Student) => {
    const history = await loadHistory(student.id);
    if (!history) return;
    downloadHistoryHtml(history);
  };

  const handleSaveDismissalNote = async (student: ManagedDismissalStudent) => {
    if (!canEditDismissalNotes) {
      toast.error("لا تملك صلاحية تعديل ملاحظات الفصل.");
      return;
    }
    if (student.status !== "مفصول") {
      toast.warning("ملاحظات الفصل الحالية تُعدّل للطالب المفصول حالياً فقط.");
      return;
    }

    const nextNote = String(
      noteDrafts[student.id] ?? student.dismissalNotes ?? "",
    ).trim();
    setSavingNoteIds((current) => ({ ...current, [student.id]: true }));
    try {
      const result = await studentApi.update(student.id, {
        dismissalNotes: nextNote,
        expectedMutationToken: student.mutationToken || "",
      });
      if (!result.ok || result.queued) {
        toast.error(result.error || "تعذر حفظ ملاحظات الفصل.");
        return;
      }

      const updatedStudent = (result.data as { student?: ManagedDismissalStudent } | null)
        ?.student;
      if (!updatedStudent) {
        toast.error("تم تنفيذ الطلب لكن تعذر قراءة سجل الطالب المحدث. حدّث الصفحة.");
        return;
      }

      setStudents((current) =>
        current.map((item) =>
          item.id === updatedStudent.id
            ? { ...item, ...updatedStudent }
            : item,
        ),
      );
      mergeStudentsCache([updatedStudent]);
      setNoteDrafts((current) => {
        const next = { ...current };
        delete next[student.id];
        return next;
      });
      setHistories((current) => {
        const next = { ...current };
        delete next[student.id];
        return next;
      });
      setExpanded((current) => ({ ...current, [student.id]: false }));
      emitTeacherProDataChanged({
        source: "local-mutation",
        reason: "dismissed-management-note",
        scopes: ["students", "dismissed", "dashboard", "follow-up"],
        dispatchLocal: true,
      });
      toast.success("تم حفظ ملاحظات الفصل.");
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "تعذر حفظ ملاحظات الفصل.",
      );
    } finally {
      setSavingNoteIds((current) => ({ ...current, [student.id]: false }));
    }
  };

  const handleReactivate = runReactivateLocked(async (student: ManagedDismissalStudent) => {
    const isManual = restorationMode === "manual";
    if (!canReactivate) {
      toast.error("لا تملك صلاحية استعادة الطلاب المفصولين.");
      return;
    }
    if (student.status !== "مفصول") {
      setReactivateDialog({ student: null, open: false });
      toast.warning("الطالب ليس مفصولاً حالياً؛ لم يتم تنفيذ أي تغيير.");
      return;
    }
    const requestedAmount = manualRestorationAmount(restorationAmount);
    if (isManual && (requestedAmount === null || !restorationReason.trim())) {
      toast.error("أدخل عدد فرص صحيحاً، فرصة واحدة على الأقل، مع سبب الاستعادة.");
      return;
    }
    const limit = getOpportunityLimit(student);
    if (isManual && limit !== null && requestedAmount! > limit) {
      toast.error(`عدد الفرص يجب ألا يتجاوز سقف الفصل (${limit}).`);
      return;
    }

    const result = await studentApi.statusAction({
      action: "reactivate",
      reactivationMode: restorationMode,
      ...(isManual ? { amount: requestedAmount, reason: restorationReason.trim() } : {}),
      studentId: student.id,
      expectedStatus: student.status,
      expectedMutationToken: student.mutationToken || "",
    });
    if (!result.ok || result.queued) {
      toast.error(result.error || "تعذر استعادة الطالب.");
      return;
    }

    const updatedStudent = (result.data as { student?: Student } | null)?.student;
    if (!updatedStudent) {
      toast.error("تم تنفيذ العملية لكن تعذر قراءة حالة الطالب المحدثة. حدّث الصفحة.");
      return;
    }

    mergeStudentsCache([updatedStudent]);
    setStudents((current) => {
      if (historyScope === "current") {
        return current.filter((item) => item.id !== student.id);
      }
      return current.map((item) =>
        item.id === student.id
          ? {
              ...item,
              ...updatedStudent,
              wasDismissed: true,
              lastDismissalReason:
                item.lastDismissalReason || student.dismissalReason || "",
              lastDismissalAt: item.lastDismissalAt || student.lastDismissalAt || "",
            }
          : item,
      );
    });
    if (historyScope === "current") {
      setTotalCount((count) => Math.max(0, count - 1));
    }
    setReactivateDialog({ student: null, open: false });
    emitTeacherProDataChanged({
      source: "local-mutation",
      reason: "dismissed-management-reactivate",
      scopes: ["students", "grades", "opportunities", "dismissed", "dashboard", "follow-up"],
      dispatchLocal: true,
    });
    toast.success(isManual ? "تمت استعادة الطالب المفصول" : "تم تعهد الطالب", {
      description: isManual
        ? `أصبح الطالب نشطاً برصيد ${updatedStudent.opportunities} من الفرص، وحُفظ سبب الاستعادة وسجل الفصل السابق.`
        : "أصبح الطالب نشطاً برصيد فرصتين بسبب تعهده. بقي سجل الفصل محفوظاً كـ«مفصول سابقاً».",
    });
  });

  const courseOptions = useMemo(
    () => [...courses].sort((a, b) => a.name.localeCompare(b.name, "ar")),
    [courses],
  );

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Card className="tp-tone-card" data-tone="info">
          <CardContent className="flex items-center justify-between gap-3 p-4">
            <div>
              <p className="text-xs text-muted-foreground">حسب الفلترة</p>
              <p className="tp-tone-card__value text-2xl font-black">
                {statsLoading ? "..." : stats.total}
              </p>
            </div>
            <span className="tp-tone-card__icon" aria-hidden="true">
              <Users />
            </span>
          </CardContent>
        </Card>
        <Card className="tp-tone-card" data-tone="danger">
          <CardContent className="flex items-center justify-between gap-3 p-4">
            <div>
              <p className="text-xs text-muted-foreground">مفصول حالياً</p>
              <p className="tp-tone-card__value text-2xl font-black">
                {statsLoading ? "..." : stats.current}
              </p>
            </div>
            <span className="tp-tone-card__icon" aria-hidden="true">
              <ShieldAlert />
            </span>
          </CardContent>
        </Card>
        <Card className="tp-tone-card" data-tone="warning">
          <CardContent className="flex items-center justify-between gap-3 p-4">
            <div>
              <p className="text-xs text-muted-foreground">مفصول سابقاً</p>
              <p className="tp-tone-card__value text-2xl font-black">
                {statsLoading ? "..." : stats.former}
              </p>
            </div>
            <span className="tp-tone-card__icon" aria-hidden="true">
              <RotateCcw />
            </span>
          </CardContent>
        </Card>
        <Card className="tp-tone-card" data-tone="info">
          <CardContent className="flex items-center justify-between gap-3 p-4">
            <div>
              <p className="text-xs text-muted-foreground">مع ملاحظات</p>
              <p className="tp-tone-card__value text-2xl font-black">
                {statsLoading ? "..." : stats.withNotes}
              </p>
            </div>
            <span className="tp-tone-card__icon" aria-hidden="true">
              <FileClock />
            </span>
          </CardContent>
        </Card>
      </div>

      {statsError ? (
        <div className="rounded-2xl border border-warning-line border-s-4 border-s-warning-vivid bg-warning-soft p-3 text-sm text-warning">
          {statsError}
        </div>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShieldAlert className="size-5" />
            إدارة المفصولين
          </CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
          <div className="space-y-1.5">
            <Label>الدورة</Label>
            <Select
              value={courseId || "all"}
              onValueChange={(value) => {
                setCourseId(value === "all" ? "" : value);
                setPage(1);
              }}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">كل الدورات</SelectItem>
                {courseOptions.map((course) => (
                  <SelectItem key={course.id} value={course.id}>
                    {course.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>الحالة</Label>
            <Select
              value={historyScope}
              onValueChange={(value) => {
                setHistoryScope(value as "all" | "current" | "former");
                setPage(1);
              }}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">الكل</SelectItem>
                <SelectItem value="current">مفصول حالياً</SelectItem>
                <SelectItem value="former">مفصول سابقاً</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>ملاحظات الفصل</Label>
            <Select
              value={notesFilter}
              onValueChange={(value) => {
                setNotesFilter(value as NotesFilter);
                setPage(1);
              }}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">الكل</SelectItem>
                <SelectItem value="with-notes">مع ملاحظات</SelectItem>
                <SelectItem value="without-notes">بدون ملاحظات</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="dismissed-management-search">البحث</Label>
            <div className="relative">
              <Search className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                id="dismissed-management-search"
                data-teacherpro-search="true"
                className="pr-9"
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPage(1);
                }}
                placeholder="الاسم / الكود / تيليجرام / يوزر تيليجرام / رقم الطالب / رقم ولي الأمر / سبب الفصل"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {error ? (
        <div className="rounded-2xl border border-danger-line border-s-4 border-s-danger-vivid bg-danger-soft p-4 text-sm text-danger">
          {error}
        </div>
      ) : null}

      {loading ? (
        <div className="rounded-2xl border bg-muted/20 p-6 text-center text-sm text-muted-foreground">
          جاري تحميل الطلاب المفصولين...
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        {students.map((student) => {
          const history = histories[student.id];
          const isOpen = Boolean(expanded[student.id]);
          const siteText =
            [
              student.locationScope,
              student.mainSite,
              student.subSite,
            ]
              .filter(Boolean)
              .join(" / ") || "—";

          return (
            <Card
              key={student.id}
              className="overflow-hidden border-danger-line shadow-sm"
              data-dismissed={student.status === "مفصول" || undefined}
            >
              <div className={`h-1.5 ${student.status === "مفصول" ? "bg-gradient-to-l from-danger-vivid to-warning-vivid" : "bg-warning-vivid"}`} />
              <CardContent className="space-y-4 p-4 sm:p-5">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-lg font-black leading-tight">
                        {student.name}
                      </h3>
                      <Badge variant={student.status === "مفصول" ? "destructive" : "secondary"}>
                        {student.status === "مفصول" ? "مفصول" : "مفصول سابقاً"}
                      </Badge>
                    </div>
                    <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                      <span>الكود: {student.code}</span>
                      <span>الدورة: {courseName(student.courseId)}</span>
                      <span>المدرسة: {student.school || "—"}</span>
                      <span>الجنس: {student.gender || "—"}</span>
                      <span>تاريخ التسجيل: {formatBaghdadDateTime(student.createdAt)}</span>
                      {student.status !== "مفصول" && student.lastDismissalAt ? (
                        <span>آخر فصل: {formatBaghdadDateTime(student.lastDismissalAt)}</span>
                      ) : null}
                    </div>
                  </div>
                  <div className="rounded-xl border border-danger-line bg-danger-soft px-3 py-2 text-xs sm:basis-64 sm:shrink-0">
                    <b className="block text-danger">
                      {student.status === "مفصول" ? "سبب الفصل" : "سبب آخر فصل"}
                    </b>
                    <span>
                      {student.dismissalReason || student.lastDismissalReason || "لا يوجد سبب مسجل"}
                    </span>
                    {student.dismissalNotes ? (
                      <span className="mt-1 block border-t border-danger-line/50 pt-1 text-[11px] text-muted-foreground">
                        {student.dismissalNotes}
                      </span>
                    ) : null}
                  </div>
                </div>

                {student.status === "مفصول" && canEditDismissalNotes ? (
                  <div className="space-y-2 rounded-2xl border bg-muted/10 p-3">
                    <Label htmlFor={`dismissal-note-${student.id}`}>
                      ملاحظات الفصل
                    </Label>
                    <textarea
                      id={`dismissal-note-${student.id}`}
                      value={
                        noteDrafts[student.id] ?? student.dismissalNotes ?? ""
                      }
                      onChange={(event) =>
                        setNoteDrafts((current) => ({
                          ...current,
                          [student.id]: event.target.value,
                        }))
                      }
                      className="min-h-24 w-full resize-y rounded-2xl border bg-background px-3 py-2 text-sm outline-none transition-colors focus:border-primary"
                      placeholder="اكتب ملاحظات الفصل الخاصة بهذا الطالب..."
                      disabled={Boolean(savingNoteIds[student.id])}
                    />
                    <div className="flex justify-end">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={Boolean(savingNoteIds[student.id])}
                        onClick={() => void handleSaveDismissalNote(student)}
                      >
                        {savingNoteIds[student.id]
                          ? "جاري حفظ الملاحظات..."
                          : "حفظ الملاحظات"}
                      </Button>
                    </div>
                  </div>
                ) : null}

                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  <div className="rounded-xl border p-3">
                    <div className="mb-1 flex items-center gap-2 text-xs text-muted-foreground">
                      <GraduationCap className="size-4" />
                      الدراسة
                    </div>
                    <p className="text-sm font-medium">
                      {[student.courseProgram, student.courseTerm, student.studyType]
                        .filter(Boolean)
                        .join(" · ") || "—"}
                    </p>
                  </div>
                  <div className="rounded-xl border p-3">
                    <div className="mb-1 flex items-center gap-2 text-xs text-muted-foreground">
                      <UserRound className="size-4" />
                      الموقع
                    </div>
                    <p className="text-sm font-medium">{siteText}</p>
                  </div>
                  <div className="rounded-xl border p-3">
                    <div className="mb-1 flex items-center gap-2 text-xs text-muted-foreground">
                      <Clock3 className="size-4" />
                      رصيد الفرص
                    </div>
                    <p className="text-sm font-medium">
                      {student.opportunities ?? 0} / الأساس{" "}
                      {student.baseOpportunities ?? 0}
                    </p>
                  </div>
                </div>

                <div className="flex flex-wrap gap-2 [&>[data-slot=button]]:flex-1">
                  {student.phone ? (
                    <Button asChild variant="outline">
                      <a
                        href={whatsappLink(student.phone)}
                        target="_blank"
                        rel="noreferrer"
                      >
                        <Phone className="size-4" />
                        <span dir="ltr" className="tabular-nums">{student.phone}</span>
                      </a>
                    </Button>
                  ) : (
                    <Button type="button" variant="outline" disabled>
                      <Phone className="size-4" />
                      رقم الطالب غير متوفر
                    </Button>
                  )}
                  {student.parentPhone ? (
                    <Button asChild variant="outline">
                      <a
                        href={whatsappLink(student.parentPhone)}
                        target="_blank"
                        rel="noreferrer"
                      >
                        <MessageCircle className="size-4" />
                        <span dir="ltr" className="tabular-nums">{student.parentPhone}</span>
                      </a>
                    </Button>
                  ) : (
                    <Button type="button" variant="outline" disabled>
                      <MessageCircle className="size-4" />
                      رقم ولي الأمر غير متوفر
                    </Button>
                  )}
                  <Button
                    type="button"
                    variant="outline"
                    disabled={
                      !studentTelegramHandle(student) ||
                      historyLoading[student.id] ||
                      telegramLoading[student.id]
                    }
                    onClick={() => void openTelegram(student)}
                  >
                    <Send className="size-4" />
                    <span className="min-w-0 [overflow-wrap:anywhere]">
                      {telegramLoading[student.id]
                        ? "جاري تجهيز التقرير..."
                        : student.username || student.telegram || "تيليجرام غير متوفر"}
                    </span>
                  </Button>
                </div>

                <div className="flex flex-wrap gap-2 border-t pt-3">
                  {student.status === "مفصول" && canReactivate ? (
                    <>
                    <Button
                      type="button"
                      variant="secondary"
                      disabled={isReactivating}
                      onClick={() => {
                        setRestorationMode("pledge");
                        setReactivateDialog({ student, open: true });
                      }}
                    >
                      <Handshake className="size-4" />
                      تم تعهد الطالب
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      disabled={isReactivating}
                      onClick={() => {
                        setRestorationMode("manual");
                        setRestorationAmount("1");
                        setRestorationReason(DEFAULT_MANUAL_RESTORATION_REASON);
                        setReactivateDialog({ student, open: true });
                      }}
                    >
                      <RotateCcw className="size-4" />
                      استعادة الطالب المفصول
                    </Button>
                    </>
                  ) : null}
                  <Button
                    type="button"
                    className="flex-1"
                    variant={isOpen ? "secondary" : "default"}
                    onClick={() => void toggleHistory(student.id)}
                    disabled={historyLoading[student.id]}
                  >
                    {historyLoading[student.id] ? (
                      "جاري تحميل السجل..."
                    ) : isOpen ? (
                      <>
                        <ChevronUp className="size-4" />
                        إخفاء السجل الكامل
                      </>
                    ) : (
                      <>
                        <ChevronDown className="size-4" />
                        إظهار السجل الكامل
                      </>
                    )}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => void exportHtml(student)}
                    disabled={historyLoading[student.id]}
                  >
                    <Download className="size-4" />
                    تصدير HTML
                  </Button>
                </div>

                {historyErrors[student.id] ? (
                  <div className="rounded-xl border border-danger-line border-s-4 border-s-danger-vivid bg-danger-soft p-3 text-sm text-danger">
                    {historyErrors[student.id]}
                  </div>
                ) : null}

                {isOpen && history ? (
                  <div className="space-y-3 rounded-2xl border bg-muted/10 p-3 sm:p-4">
                    <div className="grid grid-cols-[repeat(auto-fit,minmax(6.5rem,1fr))] gap-2">
                      {historyMetrics(history).map((metric) => (
                        <div
                          key={metric.key}
                          className={`rounded-xl border p-2 text-center ${
                            metric.danger
                              ? "border-danger-line bg-danger-soft"
                              : "bg-card"
                          }`}
                        >
                          <b
                            className={`block text-lg ${
                              metric.danger ? "text-danger" : ""
                            }`}
                          >
                            {metric.value}
                          </b>
                          <span className="text-[11px] text-muted-foreground">
                            {metric.label}
                          </span>
                        </div>
                      ))}
                    </div>

                    <div className="space-y-2">
                      {history.events.map((event, index) => (
                        <div
                          key={event.id}
                          className={`flex gap-3 rounded-xl border p-3 ${toneClasses(event.tone)}`}
                        >
                          <div className="grid size-7 shrink-0 place-items-center rounded-full bg-foreground text-xs font-bold text-background">
                            {index + 1}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                              <b className="text-sm">{event.title}</b>
                              <span className="text-[11px] text-muted-foreground">
                                {formatBaghdadDateTime(event.date)}
                              </span>
                            </div>
                            <div className="mt-1 space-y-0.5">
                              {event.details.map((detail, detailIndex) => (
                                <p
                                  key={`${event.id}:${detailIndex}`}
                                  className="break-words text-xs leading-5 text-muted-foreground"
                                >
                                  {detail}
                                </p>
                              ))}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}
              </CardContent>
            </Card>
          );
        })}
      </div>

      {!loading && students.length === 0 && !error ? (
        <div className="rounded-2xl border border-dashed p-10 text-center text-sm text-muted-foreground">
          <Ban className="mx-auto mb-2 size-7" />
          لا يوجد طلاب ضمن سجل الفصل حسب البحث والفلترة الحالية.
        </div>
      ) : null}

      {totalPages > 1 ? (
        <div className="flex flex-wrap items-center justify-center gap-2 rounded-2xl border bg-card p-3">
          <Button
            variant="outline"
            size="sm"
            disabled={page <= 1 || loading}
            onClick={() => setPage((v) => Math.max(1, v - 1))}
          >
            <ChevronRight className="size-4" />
            السابق
          </Button>
          <span className="text-sm text-muted-foreground">
            صفحة {page} من {totalPages} · {students.length} من {totalCount}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={page >= totalPages || loading}
            onClick={() => setPage((v) => Math.min(totalPages, v + 1))}
          >
            التالي
            <ChevronLeft className="size-4" />
          </Button>
        </div>
      ) : null}

      <AlertDialog
        open={reactivateDialog.open}
        onOpenChange={(open) => {
          if (!open && !isReactivating) {
            setReactivateDialog({ student: null, open: false });
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{restorationMode === "manual" ? "استعادة الطالب المفصول" : "تم تعهد الطالب المفصول"}</AlertDialogTitle>
            <AlertDialogDescription>
              {restorationMode === "manual"
                ? `تريد إرجاع «${reactivateDialog.student?.name || "الطالب المحدد"}» بكم فرصة؟ حدّد العدد وسبب الاستعادة؛ يبقى سجل الفصل السابق محفوظاً.`
                : `هل تم تعهد «${reactivateDialog.student?.name || "الطالب المحدد"}»؟ سيزول الفصل الحالي ويصبح الطالب نشطاً برصيد فرصتين بسبب تعهده، مع بقاء سجل الفصل محفوظاً في إدارة المفصولين.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {restorationMode === "manual" && (
            <div className="min-w-0 space-y-4">
              <div className="space-y-2">
                <Label htmlFor="restore-opportunity-count">عدد الفرص عند العودة</Label>
                <Input
                  id="restore-opportunity-count" type="text" inputMode="numeric" autoComplete="off"
                  value={restorationAmount} disabled={isReactivating}
                  onChange={event => setRestorationAmount(toLatinDigits(event.target.value))}
                  aria-describedby="restore-opportunity-limit"
                />
                <p id="restore-opportunity-limit" className="text-xs text-muted-foreground">
                  سقف فرص الفصل الحالي: {getOpportunityLimit(reactivateDialog.student) ?? "غير متاح"}
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="restore-student-reason">سبب الاستعادة</Label>
                <textarea
                  id="restore-student-reason" value={restorationReason} rows={3} maxLength={2000}
                  className="w-full min-w-0 resize-y rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  disabled={isReactivating} onChange={event => setRestorationReason(event.target.value)}
                />
              </div>
            </div>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isReactivating}>إلغاء</AlertDialogCancel>
            <AlertDialogAction
              disabled={!reactivateDialog.student || isReactivating || (restorationMode === "manual" && (manualRestorationAmount(restorationAmount) === null || !restorationReason.trim()))}
              onClick={(event) => {
                event.preventDefault();
                if (reactivateDialog.student) {
                  void handleReactivate(reactivateDialog.student);
                }
              }}
            >
              {restorationMode === "manual"
                ? isReactivating ? "جاري الاستعادة..." : "تأكيد استعادة الطالب"
                : isReactivating ? "جاري تثبيت التعهد..." : "تأكيد التعهد بفرصتين"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
