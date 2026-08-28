"use client";

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTeacherStore, type Student } from "@/lib/teacher-store";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { useTeacherProSyncKey } from "@/hooks/use-teacherpro-sync";
import { formatBaghdadDateTime } from "@/lib/baghdad-time";
import { normalizeTelegramIdentifier } from "@/lib/student-utils";
import {
  buildBoundedTelegramDraft,
  buildDismissedTelegramReport,
  canUseDirectDismissedTelegramDraft,
  canUseSingleDismissedTelegramMessage,
  escapeDismissedHistoryHtml,
  safeDismissedHistoryFileName,
} from "@/lib/dismissed-history";
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
import {
  Ban,
  BookOpen,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Clock3,
  Download,
  FileClock,
  GraduationCap,
  MessageCircle,
  Phone,
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

function toneClasses(tone: TimelineEvent["tone"]) {
  if (tone === "danger") return "border-red-500/30 bg-red-500/5";
  if (tone === "warning") return "border-amber-500/30 bg-amber-500/5";
  if (tone === "success") return "border-emerald-500/30 bg-emerald-500/5";
  if (tone === "info") return "border-blue-500/30 bg-blue-500/5";
  return "border-border bg-muted/20";
}

function fullTelegramMessage(history: StudentHistory) {
  const s = history.student;
  const dismissalDateTime = formatBaghdadDateTime(s.dismissalAt);
  return buildDismissedTelegramReport(
    {
      name: s.name,
      code: s.code,
      courseName: s.courseName,
      dismissalDate:
        dismissalDateTime === "—" ? "" : dismissalDateTime.split(" ")[0],
      dismissalReason: s.dismissalReason,
      dismissalNotes: s.dismissalNotes,
    },
    history.events,
  );
}

function telegramAttachmentMessage(history: StudentHistory) {
  const s = history.student;
  const metrics = historyMetrics(history)
    .map((metric) => `${metric.label}: ${metric.value}`)
    .join("\n");
  const header = `السلام عليكم
هذا هو سجل الطالب الكامل "${s.name}"

الكود: ${s.code}
الدورة: ${s.courseName}
سبب الفصل: ${s.dismissalReason || "غير مسجل"}

تم تنزيل السجل الزمني الكامل بصيغة HTML على جهاز الإدارة لأن حجمه يتجاوز الحد الآمن لرابط تيليجرام. يرجى إرفاق الملف بهذه المحادثة.

ملخص الملف`;
  return buildBoundedTelegramDraft({
    header,
    timeline: metrics || "لا توجد أحداث متاحة",
    footer: "إدارة حسن فلاح مدرس مادة الأحياء",
  });
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
    ["تيليجرام", s.telegram || "—"],
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
:root{font-family:Arial,Tahoma,sans-serif;color:#111827;background:#f8fafc}
*{box-sizing:border-box}
html,body{max-width:100%;overflow-x:hidden}
body{margin:0;padding:24px}
.page{max-width:1000px;margin:auto;background:#fff;border:1px solid #e5e7eb;border-radius:18px;padding:28px;overflow-wrap:anywhere;word-break:break-word}
.header{display:flex;justify-content:space-between;gap:18px;align-items:flex-start;border-bottom:3px solid #111827;padding-bottom:18px;margin-bottom:20px}
.brand h1{font-size:24px;margin:0 0 6px}.brand p{margin:0;color:#6b7280}
.status{padding:8px 12px;border-radius:999px;background:#fee2e2;color:#991b1b;font-weight:700}
.grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;margin:18px 0}
.info-box{border:1px solid #e5e7eb;border-radius:12px;padding:10px;break-inside:avoid}
.info-box b{display:block;font-size:11px;color:#6b7280;margin-bottom:4px}
.summary{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:8px;margin:18px 0}
.metric{border:1px solid #e5e7eb;border-radius:12px;padding:10px;text-align:center}
.metric strong{display:block;font-size:20px}.metric span{font-size:11px;color:#6b7280}
.section-title{font-size:18px;margin:26px 0 12px}
.event{display:flex;gap:12px;border:1px solid #e5e7eb;border-radius:12px;padding:12px;margin:0 0 10px;break-inside:avoid}
.event-index{width:28px;height:28px;border-radius:50%;background:#111827;color:#fff;display:grid;place-items:center;flex:0 0 28px;font-weight:700}
.event-body{min-width:0;flex:1;overflow-wrap:anywhere;word-break:break-word}
.event-head{display:flex;justify-content:space-between;gap:12px;margin-bottom:6px}
.event-head span{font-size:12px;color:#6b7280;white-space:nowrap}
.detail{font-size:13px;line-height:1.7}
.danger{border-color:#fecaca;background:#fff7f7}.warning{border-color:#fde68a;background:#fffdf3}
.success{border-color:#a7f3d0;background:#f4fff9}.info{border-color:#bfdbfe;background:#f7fbff}
.footer{margin-top:28px;border-top:1px solid #e5e7eb;padding-top:12px;font-size:12px;color:#6b7280;text-align:center}
@media(max-width:760px){body{padding:8px}.page{padding:14px;border-radius:10px}.header{display:block}.status{display:inline-block;margin-top:10px}.grid{grid-template-columns:1fr 1fr}.summary{grid-template-columns:repeat(2,1fr)}.event-head{display:block}.event-head span{display:block;margin-top:4px}.event{padding:10px}}
@media(max-width:430px){.grid{grid-template-columns:1fr}.summary{grid-template-columns:1fr 1fr}}
@page{size:A4;margin:12mm}
@media print{html,body{overflow:visible}body{padding:0;background:#fff;-webkit-print-color-adjust:exact;print-color-adjust:exact}.page{max-width:none;border:0;border-radius:0;padding:0}.no-print{display:none!important}.event,.info-box,.metric{page-break-inside:avoid;break-inside:avoid}.header{page-break-after:avoid}.summary{grid-template-columns:repeat(3,minmax(0,1fr))}}
</style>
</head>
<body>
<main class="page">
<div class="no-print" style="display:flex;justify-content:flex-start;margin-bottom:12px"><button onclick="window.print()" style="border:1px solid #d1d5db;background:#fff;border-radius:10px;padding:8px 14px;cursor:pointer;font-weight:700">طباعة التقرير</button></div>
<header class="header"><div class="brand"><h1>سجل الفصل للطالب</h1><p>إدارة حسن فلاح مدرس مادة الاحياء</p></div><div class="status">${escapeDismissedHistoryHtml(statusLabel)}</div></header>
<div class="grid">${info.map(([k, v]) => `<div class="info-box"><b>${escapeDismissedHistoryHtml(k)}</b><span>${escapeDismissedHistoryHtml(v)}</span></div>`).join("")}</div>
<div class="summary">${metrics.map((metric) => `<div class="metric"><strong>${metric.value}</strong><span>${escapeDismissedHistoryHtml(metric.label)}</span></div>`).join("")}</div>
<h2 class="section-title">السجل الزمني الكامل</h2>
${eventRows}
<footer class="footer">تم إنشاء هذا التقرير من السجل الفعلي المحفوظ في TeacherPro.</footer>
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

export function DismissedManagementView() {
  const { courses, courseName, mergeStudentsCache } = useTeacherStore();
  const syncKey = useTeacherProSyncKey(["students", "grades", "opportunities", "dismissed", "follow-up"]);
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search, 180);
  const [courseId, setCourseId] = useState("");
  const [historyScope, setHistoryScope] = useState<"all" | "current" | "former">("all");
  const [page, setPage] = useState(1);
  const [students, setStudents] = useState<ManagedDismissalStudent[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [histories, setHistories] = useState<Record<string, StudentHistory>>({});
  const [historyLoading, setHistoryLoading] = useState<Record<string, boolean>>({});
  const [historyErrors, setHistoryErrors] = useState<Record<string, string>>({});
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
    if (debouncedSearch.trim()) params.set("q", debouncedSearch.trim());

    setLoading(true);
    setError("");
    fetch(`/api/dismissed-students/list?${params.toString()}`, {
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
  }, [courseId, debouncedSearch, historyScope, page, mergeStudentsCache, syncKey]);

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
          `/api/dismissed-students/history?studentId=${encodeURIComponent(studentId)}`,
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
    const username = telegramUsername(student.telegram);
    if (!username) return;

    const history = await loadHistory(student.id);
    if (!history) return;
    const completeMessage = fullTelegramMessage(history);
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
          "تم نسخ التقرير الدراسي الكامل. ستفتح محادثة الطالب الآن؛ الصق الرسالة ثم أرسلها.",
        );
        window.location.assign(
          `tg://resolve?domain=${encodeURIComponent(username)}`,
        );
        return;
      } catch {
        downloadHistoryHtml(history);
        window.alert(
          "تعذر النسخ التلقائي، لذلك تم تنزيل التقرير الكامل كملف HTML. ستفتح المحادثة الآن لإرفاقه.",
        );
      }
    } else {
      downloadHistoryHtml(history);
      window.alert(
        "التقرير أطول من حد رسالة تيليجرام، لذلك تم تنزيله كاملاً كملف HTML. ستفتح المحادثة الآن لإرفاقه.",
      );
    }

    const attachmentMessage = telegramAttachmentMessage(history);
    window.location.assign(
      `tg://resolve?domain=${encodeURIComponent(username)}&text=${encodeURIComponent(attachmentMessage)}`,
    );
  };

  const exportHtml = async (student: Student) => {
    const history = await loadHistory(student.id);
    if (!history) return;
    downloadHistoryHtml(history);
  };

  const courseOptions = useMemo(
    () => [...courses].sort((a, b) => a.name.localeCompare(b.name, "ar")),
    [courses],
  );

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Card className="border-red-500/20">
          <CardContent className="flex items-center justify-between p-4">
            <div>
              <p className="text-xs text-muted-foreground">
                سجل الفصل حسب الفلترة
              </p>
              <p className="text-2xl font-black">
                {loading ? "..." : totalCount}
              </p>
            </div>
            <Users className="size-7 text-red-500" />
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center justify-between p-4">
            <div>
              <p className="text-xs text-muted-foreground">الدورة المختارة</p>
              <p className="font-bold">
                {courseId ? courseName(courseId) : "كل الدورات"}
              </p>
            </div>
            <BookOpen className="size-7 text-muted-foreground" />
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center justify-between p-4">
            <div>
              <p className="text-xs text-muted-foreground">المعروض في الصفحة</p>
              <p className="text-2xl font-black">{students.length}</p>
            </div>
            <FileClock className="size-7 text-muted-foreground" />
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShieldAlert className="size-5" />
            إدارة المفصولين
          </CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-3 md:grid-cols-3">
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
                placeholder="الاسم / الكود / تيليجرام / رقم الطالب / رقم ولي الأمر / سبب الفصل"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {error ? (
        <div className="rounded-2xl border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
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
              className="overflow-hidden border-red-500/20 shadow-sm"
            >
              <div className="h-1 bg-red-500/70" />
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
                  <div className="rounded-xl border border-red-500/20 bg-red-500/5 px-3 py-2 text-xs sm:basis-64 sm:shrink-0">
                    <b className="block text-red-700 dark:text-red-300">
                      {student.status === "مفصول" ? "سبب الفصل" : "سبب آخر فصل"}
                    </b>
                    <span>
                      {student.dismissalReason || student.lastDismissalReason || "لا يوجد سبب مسجل"}
                    </span>
                    {student.dismissalNotes ? (
                      <span className="mt-1 block border-t border-red-500/10 pt-1 text-[11px] text-muted-foreground">
                        {student.dismissalNotes}
                      </span>
                    ) : null}
                  </div>
                </div>

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

                <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                  {student.phone ? (
                    <Button asChild variant="outline">
                      <a
                        href={whatsappLink(student.phone)}
                        target="_blank"
                        rel="noreferrer"
                      >
                        <Phone className="size-4" />
                        {student.phone}
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
                        {student.parentPhone}
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
                    disabled={!telegramUsername(student.telegram) || historyLoading[student.id]}
                    onClick={() => void openTelegram(student)}
                  >
                    <Send className="size-4" />
                    {student.telegram || "تيليجرام غير متوفر"}
                  </Button>
                </div>

                {student.telegram ? (
                  <p className="text-[11px] text-muted-foreground">
                    زر تيليجرام يجهز تقريراً مرتباً لكل امتحان ونتيجته أو
                    غيابه والإجراء المرتبط به. عند تجاوز حد الرابط يُنسخ
                    التقرير، وعند تجاوز حد الرسالة أو تعذر النسخ يُنزّل ملف
                    HTML الكامل دون فقدان البيانات.
                  </p>
                ) : null}

                <div className="flex flex-wrap gap-2 border-t pt-3">
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
                  <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
                    {historyErrors[student.id]}
                  </div>
                ) : null}

                {isOpen && history ? (
                  <div className="space-y-3 rounded-2xl border bg-muted/10 p-3 sm:p-4">
                    <p className="text-[11px] text-muted-foreground">
                      يعرض السجل البيانات التي تسمح بها صلاحيات هذا الحساب.
                    </p>
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
                      {historyMetrics(history).map((metric) => (
                        <div
                          key={metric.key}
                          className={`rounded-xl border p-2 text-center ${
                            metric.danger
                              ? "border-red-500/20 bg-red-500/5"
                              : "bg-card"
                          }`}
                        >
                          <b
                            className={`block text-lg ${
                              metric.danger ? "text-red-600" : ""
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
    </div>
  );
}
