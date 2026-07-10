"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useTeacherStore, type OpportunityLog, type Student } from "@/lib/teacher-store";
import { useTeacherProBackgroundSyncDetector, useTeacherProSyncKey } from "@/hooks/use-teacherpro-sync";
import { studentApi } from "@/lib/api";
import { emitTeacherProDataChanged } from "@/lib/teacherpro-sync";
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
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { toast } from "@/lib/user-toast";
import { CountScopeSummary, StatCard } from "./ui-kit";
import {
  Users,
  Clock,
  Ban,
  FileText,
  HandHeart,
} from "lucide-react";
import {
  CustomFilterPresets,
  type FilterPresetValues,
} from "./custom-filter-presets";

type ViewMode = "cards" | "table";
type NotesFilter = "all" | "with-notes" | "without-notes";
type PledgeFilter = "all" | "with-pledge" | "without-pledge";

type DismissedStats = {
  total: number;
  temporary: number;
  final: number;
  withNotes: number;
  withPledge: number;
  withoutPledge: number;
};

type DismissalDetail = {
  studentId: string;
  type: string;
  reason: string;
  notes?: string;
  dismissalDate?: string;
  sourceType?: string;
  sourceId?: string;
  examName?: string;
  examType?: string;
  examDate?: string;
  lastGrade?: {
    status: string;
    score: number | null;
    fullMark: number | null;
    notes?: string;
    updatedAt?: string;
  } | null;
  hasPledge: boolean;
  pledgeText?: string;
  pledgeDate?: string;
};

const PLEDGE_NOTE_KIND = "تعهد ولي الأمر";

function dayKey(value: string | Date | null | undefined): string {
  if (!value) return "";
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.toISOString().slice(0, 10) : "";
  return String(value || "").slice(0, 10);
}

function normalizeDismissalText(value: string | null | undefined): string {
  return String(value || "")
    .replace(/\s+/g, " ")
    .replace(/[ـ]/g, "")
    .trim()
    .toLowerCase();
}

function isLikelyDismissalLog(log: OpportunityLog, dismissalReason: string): boolean {
  const rawReason = String(log.reason || "");
  const logReason = normalizeDismissalText(rawReason);
  const normalizedReason = normalizeDismissalText(dismissalReason);
  return (
    log.action === "فصل تلقائي" ||
    (log.action === "خصم" && rawReason.startsWith("فصل الطالب")) ||
    Boolean(normalizedReason && logReason.includes(normalizedReason))
  );
}

function formatDismissalGrade(detail: DismissalDetail | null): string {
  const grade = detail?.lastGrade;
  if (!grade) return "لا توجد درجة مرتبطة ظاهرة";
  if (grade.status === "درجة") {
    const fullMark = grade.fullMark ? ` / ${grade.fullMark}` : "";
    return `درجة: ${grade.score ?? "—"}${fullMark}`;
  }
  return grade.status || "درجة غير محددة";
}

function serverActionData(result: { data?: unknown }) {
  return (result.data || {}) as {
    student?: Student;
    opportunityLogs?: OpportunityLog[];
    studentNotes?: unknown[];
  };
}

export function DismissedStudentsView() {
  const syncKey = useTeacherProSyncKey(["students", "grades", "opportunities", "dismissed", "dashboard"]);
  const isBackgroundSync = useTeacherProBackgroundSyncDetector(syncKey);
  const {
    students,
    courses,
    exams,
    grades,
    opportunityLogs,
    studentNotes,
    courseName,
    mergeStudentsCache,
  } = useTeacherStore();

  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search, 180);
  const [filterCourseId, setFilterCourseId] = useState("");
  const [filterDismissalType, setFilterDismissalType] = useState("");
  const [filterNotes, setFilterNotes] = useState<NotesFilter>("all");
  const [filterPledge, setFilterPledge] = useState<PledgeFilter>("all");
  const [viewMode, setViewMode] = useState<ViewMode>("cards");
  const [noteDrafts, setNoteDrafts] = useState<Record<string, string>>({});
  const [dismissalDetails, setDismissalDetails] = useState<Record<string, DismissalDetail>>({});
  const [dismissedServerStudents, setDismissedServerStudents] = useState<Student[]>([]);
  const [dismissedStudentsSearchLoading, setDismissedStudentsSearchLoading] = useState(false);
  const [dismissalDetailsLoading, setDismissalDetailsLoading] = useState(false);
  const [listError, setListError] = useState("");
  const [detailsError, setDetailsError] = useState("");
  const [savingNoteIds, setSavingNoteIds] = useState<Record<string, boolean>>({});
  const [reactivatingIds, setReactivatingIds] = useState<Record<string, boolean>>({});
  const [dismissedStats, setDismissedStats] = useState<DismissedStats>({
    total: 0,
    temporary: 0,
    final: 0,
    withNotes: 0,
    withPledge: 0,
    withoutPledge: 0,
  });
  const [systemDismissedStats, setSystemDismissedStats] = useState<DismissedStats>({
    total: 0,
    temporary: 0,
    final: 0,
    withNotes: 0,
    withPledge: 0,
    withoutPledge: 0,
  });
  const [dismissedStatsLoading, setDismissedStatsLoading] = useState(false);
  const [dismissedStatsError, setDismissedStatsError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    const silent = isBackgroundSync();
    if (!silent) setDismissedStudentsSearchLoading(true);
    if (!silent) setListError("");
    studentApi
      .list(
        {
          status: "مفصول",
          q: debouncedSearch || undefined,
          courseId: filterCourseId || undefined,
          pageSize: 100,
          page: 1,
        },
        { signal: controller.signal, quietAbort: true },
      )
      .then((result) => {
        if (controller.signal.aborted) return;
        if (!result) {
          if (!silent) {
            setDismissedServerStudents([]);
            setListError("تعذر تحميل المفصولين من بيانات النظام. لا توجد إجراءات حساسة متاحة حتى يرجع الاتصال.");
          }
          return;
        }
        const next = (result.students || []) as unknown as Student[];
        setDismissedServerStudents(next);
        mergeStudentsCache(next);
      })
      .catch(() => {
        if (!controller.signal.aborted && !silent) {
          setDismissedServerStudents([]);
          setListError("تعذر تحميل المفصولين من بيانات النظام. لا توجد إجراءات حساسة متاحة حتى يرجع الاتصال.");
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setDismissedStudentsSearchLoading(false);
      });
    return () => controller.abort();
  }, [debouncedSearch, filterCourseId, mergeStudentsCache, syncKey, isBackgroundSync]);

  useEffect(() => {
    const ids = dismissedServerStudents.map((student) => student.id).filter(Boolean);
    if (ids.length === 0) {
      setDismissalDetails({});
      setDismissalDetailsLoading(false);
      setDetailsError("");
      return;
    }

    const controller = new AbortController();
    const params = new URLSearchParams({ ids: ids.join(",") });
    setDismissalDetailsLoading(true);
    setDetailsError("");

    fetch(`/api/dismissed-students/details?${params.toString()}`, {
      credentials: "same-origin",
      signal: controller.signal,
    })
      .then((response) => (response.ok ? response.json() : null))
      .then((payload: { details?: DismissalDetail[] } | null) => {
        if (controller.signal.aborted) return;
        if (!payload?.details) {
          setDismissalDetails({});
          setDetailsError("تعذر تحميل تفاصيل الفصل من بيانات النظام.");
          return;
        }
        setDismissalDetails(
          Object.fromEntries(payload.details.map((detail) => [detail.studentId, detail])),
        );
      })
      .catch((error) => {
        if (controller.signal.aborted) return;
        console.warn("[DismissedStudentsView] details load failed", error);
        setDismissalDetails({});
        setDetailsError("تعذر تحميل تفاصيل الفصل من بيانات النظام.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setDismissalDetailsLoading(false);
      });

    return () => controller.abort();
  }, [dismissedServerStudents]);

  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams();
    if (debouncedSearch) params.set("q", debouncedSearch);
    if (filterCourseId) params.set("courseId", filterCourseId);
    if (filterDismissalType) params.set("dismissalType", filterDismissalType);
    if (filterNotes !== "all") params.set("notesFilter", filterNotes);
    if (filterPledge !== "all") params.set("pledgeFilter", filterPledge);

    const silent = isBackgroundSync();
    if (!silent) setDismissedStatsLoading(true);
    if (!silent) setDismissedStatsError("");
    fetch(`/api/dismissed-students/stats?${params.toString()}`, {
      credentials: "same-origin",
      signal: controller.signal,
    })
      .then((response) => (response.ok ? response.json() : null))
      .then((payload: { stats?: DismissedStats; filtered?: DismissedStats; system?: DismissedStats } | null) => {
        if (controller.signal.aborted) return;
        if (!payload?.stats) {
          if (!silent) setDismissedStatsError("تعذر تحميل إحصائيات المفصولين من بيانات النظام.");
          return;
        }
        setDismissedStats(payload.filtered || payload.stats);
        if (payload.system) setSystemDismissedStats(payload.system);
      })
      .catch((error) => {
        if (controller.signal.aborted) return;
        console.warn("[DismissedStudentsView] stats load failed", error);
        if (!silent) setDismissedStatsError("تعذر تحميل إحصائيات المفصولين من بيانات النظام.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setDismissedStatsLoading(false);
      });

    return () => controller.abort();
  }, [debouncedSearch, filterCourseId, filterDismissalType, filterNotes, filterPledge, syncKey, isBackgroundSync]);

  const dismissedTypes = useMemo(
    () =>
      Array.from(
        new Set(
          dismissedServerStudents
            .filter((student) => student.status === "مفصول")
            .map((student) => dismissalDetails[student.id]?.type || student.dismissalType || "مفصول"),
        ),
      ).filter(Boolean),
    [dismissedServerStudents, dismissalDetails],
  );

  const buildLocalDismissalDetail = (student: Student): DismissalDetail => {
    const type = student.dismissalType || "مفصول";
    const reason = student.dismissalReason || "لا يوجد سبب مسجل";
    const studentLogs = opportunityLogs
      .filter((log) => log.studentId === student.id)
      .sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));
    const dismissalLog =
      studentLogs.find((log) => log.action === "فصل تلقائي") ||
      studentLogs.find((log) => isLikelyDismissalLog(log, reason));
    const studentGrades = grades
      .filter((grade) => grade.studentId === student.id)
      .sort((a, b) => String(b.updatedAt || b.createdAt || "").localeCompare(String(a.updatedAt || a.createdAt || "")));
    const linkedGrade = dismissalLog?.examId
      ? studentGrades.find((grade) => grade.examId === dismissalLog.examId)
      : undefined;
    const reasonGrade = linkedGrade || studentGrades.find((grade) => {
      const exam = exams.find((item) => item.id === grade.examId);
      const examName = normalizeDismissalText(exam?.name || "");
      return Boolean(examName && normalizeDismissalText(reason).includes(examName));
    });
    const exam = dismissalLog?.examId
      ? exams.find((item) => item.id === dismissalLog.examId)
      : reasonGrade
        ? exams.find((item) => item.id === reasonGrade.examId)
        : undefined;
    const sourceNote = studentNotes
      .filter((note) => note.studentId === student.id && note.kind === "إجراء")
      .find((note) => {
        const text = normalizeDismissalText(note.text);
        return text.includes("فصل الطالب") || text.includes(normalizeDismissalText(reason));
      });
    const sourceType = dismissalLog ? "opportunity-log" : sourceNote ? "student-note" : "student-dismissal";
    const sourceId = dismissalLog?.id || sourceNote?.id || student.id;
    const dismissalDate = dayKey(dismissalLog?.date || sourceNote?.date || student.createdAt);
    const normalizedReason = normalizeDismissalText(reason);
    const pledgeNote = studentNotes
      .filter((note) => note.studentId === student.id && note.kind === PLEDGE_NOTE_KIND)
      .find((note) => {
        if (note.sourceType && note.sourceId) return note.sourceType === sourceType && note.sourceId === sourceId;
        const noteReason = normalizeDismissalText(note.dismissalReason || note.text);
        return !noteReason || noteReason.includes(normalizedReason) || normalizedReason.includes(noteReason);
      });

    return {
      studentId: student.id,
      type,
      reason,
      notes: student.dismissalNotes || "",
      dismissalDate,
      sourceType,
      sourceId,
      examName: exam?.name || "",
      examType: exam?.type || "",
      examDate: dayKey(exam?.date),
      lastGrade: reasonGrade
        ? {
            status: reasonGrade.status,
            score: reasonGrade.score,
            fullMark: exam?.fullMark ?? null,
            notes: reasonGrade.notes || "",
            updatedAt: reasonGrade.updatedAt,
          }
        : null,
      hasPledge: Boolean(pledgeNote),
      pledgeText: pledgeNote?.text || "",
      pledgeDate: dayKey(pledgeNote?.date),
    };
  };

  const dismissalDetailForStudent = (student: Student) =>
    dismissalDetails[student.id] || buildLocalDismissalDetail(student);

  const dismissedStudents = useMemo(() => {
    return dismissedServerStudents
      .filter((student) => student.status === "مفصول")
      .filter((student) => {
        const detail = dismissalDetails[student.id];
        const hasNotes = Boolean(String(detail?.notes ?? student.dismissalNotes ?? "").trim());
        const hasPledge = Boolean(detail?.hasPledge);
        const type = detail?.type || student.dismissalType || "مفصول";

        if (filterCourseId && student.courseId !== filterCourseId) return false;
        if (filterDismissalType && type !== filterDismissalType) return false;
        if (filterNotes === "with-notes" && !hasNotes) return false;
        if (filterNotes === "without-notes" && hasNotes) return false;
        if (filterPledge === "with-pledge" && !hasPledge) return false;
        if (filterPledge === "without-pledge" && hasPledge) return false;
        return true;
      })
      .sort((a, b) => a.name.localeCompare(b.name, "ar"));
  }, [
    dismissedServerStudents,
    dismissalDetails,
    filterCourseId,
    filterDismissalType,
    filterNotes,
    filterPledge,
  ]);


  const canRunSensitiveActions = !listError && !detailsError && !dismissedStudentsSearchLoading && !dismissalDetailsLoading;

  const updateDismissedStudentLocally = (student: Student) => {
    mergeStudentsCache([student]);
    setDismissedServerStudents((current) =>
      student.status === "مفصول"
        ? current.map((item) => (item.id === student.id ? student : item))
        : current.filter((item) => item.id !== student.id),
    );
  };

  const handleReactivate = async (student: Student) => {
    if (!canRunSensitiveActions) {
      toast.error("انتظر تحميل المفصولين وتفاصيل الفصل من بيانات النظام قبل تنفيذ إعادة التفعيل.");
      return;
    }

    const serverDetail = dismissalDetails[student.id];
    if (!serverDetail) {
      toast.error("تفاصيل الفصل غير محملة من بيانات النظام لهذا الطالب. حدّث الصفحة ثم حاول مرة أخرى.");
      return;
    }

    if (!serverDetail.hasPledge) {
      const ok = window.confirm(
        `لم يتم تسجيل تعهد لهذا الفصل.\n\nالطالب: ${student.name}\nنوع الفصل: ${serverDetail.type || "مفصول"}\nالسبب: ${serverDetail.reason || "لا يوجد سبب مسجل"}\n\nهل تريد إعادة التفعيل رغم عدم وجود تعهد؟`,
      );
      if (!ok) return;
      toast.warning("سيتم تنفيذ إعادة التفعيل بدون تعهد مسجل لهذا الفصل بعد تأكيد الحفظ.");
    }

    setReactivatingIds((current) => ({ ...current, [student.id]: true }));
    const result = await studentApi.statusAction({
      action: "reactivate",
      studentId: student.id,
    });
    setReactivatingIds((current) => ({ ...current, [student.id]: false }));

    if (!result.ok || result.queued) {
      toast.error(result.error || "تعذر إعادة تفعيل الطالب من النظام.");
      return;
    }

    const payload = serverActionData(result);
    if (payload.student) updateDismissedStudentLocally(payload.student);
    else setDismissedServerStudents((current) => current.filter((item) => item.id !== student.id));

    setDismissalDetails((current) => {
      const next = { ...current };
      delete next[student.id];
      return next;
    });
    emitTeacherProDataChanged({ source: "local-mutation", reason: "dismissed-students-reactivate", scopes: ["students", "opportunities", "dismissed", "dashboard"] });
    toast.success("تمت إعادة تفعيل الطالب من بيانات النظام");
  };

  const renderDismissalContext = (student: Student) => {
    const detail = dismissalDetailForStudent(student);
    const fromDatabase = Boolean(dismissalDetails[student.id]);
    return (
      <div className="rounded-2xl border border-destructive/20 bg-destructive/5 p-3 text-sm">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <Badge variant={fromDatabase ? "secondary" : "outline"}>
            {fromDatabase ? "تفاصيل الفصل من بيانات النظام" : "تفاصيل محلية مؤقتة"}
          </Badge>
          {detail.dismissalDate ? <Badge variant="outline">تاريخ الفصل: {detail.dismissalDate}</Badge> : null}
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          <div>
            <p className="text-xs font-semibold text-muted-foreground">سبب الفصل</p>
            <p className="mt-1 break-words font-medium text-destructive">
              {detail.reason || student.dismissalReason || "لا يوجد سبب مسجل"}
            </p>
          </div>
          <div>
            <p className="text-xs font-semibold text-muted-foreground">نوع الفصل</p>
            <p className="mt-1 font-medium">{detail.type || student.dismissalType || "مفصول"}</p>
          </div>
          <div>
            <p className="text-xs font-semibold text-muted-foreground">الامتحان المرتبط</p>
            <p className="mt-1">
              {detail.examName
                ? `${detail.examName}${detail.examType ? ` - ${detail.examType}` : ""}${detail.examDate ? ` - ${detail.examDate}` : ""}`
                : "لا يوجد امتحان مرتبط ظاهر"}
            </p>
          </div>
          <div>
            <p className="text-xs font-semibold text-muted-foreground">آخر درجة سببت الفصل</p>
            <p className="mt-1">{formatDismissalGrade(detail)}</p>
            {detail.lastGrade?.notes ? (
              <p className="mt-1 text-xs text-muted-foreground">ملاحظة الدرجة: {detail.lastGrade.notes}</p>
            ) : null}
          </div>
        </div>
        <div
          className={
            detail.hasPledge
              ? "mt-3 rounded-xl border border-emerald-500/25 bg-emerald-500/10 p-2 text-xs text-emerald-700 dark:text-emerald-300"
              : "mt-3 rounded-xl border border-amber-500/30 bg-amber-500/10 p-2 text-xs text-amber-800 dark:text-amber-200"
          }
        >
          {detail.hasPledge
            ? `يوجد تعهد مسجل لهذا الفصل${detail.pledgeDate ? ` بتاريخ ${detail.pledgeDate}` : ""}.`
            : "لم يتم تسجيل تعهد لهذا الفصل. راجع التعهد قبل إعادة التفعيل."}
        </div>
      </div>
    );
  };

  const handleSaveNote = async (studentId: string) => {
    if (!canRunSensitiveActions) {
      toast.error("انتظر تحميل بيانات المفصولين من النظام قبل حفظ الملاحظة.");
      return;
    }

    const student = dismissedServerStudents.find((item) => item.id === studentId);
    if (!student) {
      toast.error("تعذر العثور على الطالب ضمن نتائج المفصولين الحالية.");
      return;
    }

    const nextNote = noteDrafts[studentId] ?? dismissalDetails[studentId]?.notes ?? student.dismissalNotes ?? "";
    setSavingNoteIds((current) => ({ ...current, [studentId]: true }));
    const result = await studentApi.update(studentId, { dismissalNotes: nextNote });
    setSavingNoteIds((current) => ({ ...current, [studentId]: false }));

    if (!result.ok || result.queued) {
      toast.error(result.error || "تعذر حفظ ملاحظات الفصل من النظام.");
      return;
    }

    const payload = (result.data || {}) as { student?: Student };
    if (payload.student) updateDismissedStudentLocally(payload.student);
    else {
      setDismissedServerStudents((current) =>
        current.map((item) => (item.id === studentId ? { ...item, dismissalNotes: nextNote } : item)),
      );
    }
    setDismissalDetails((current) => ({
      ...current,
      [studentId]: {
        ...(current[studentId] || buildLocalDismissalDetail(student)),
        notes: nextNote,
      },
    }));
    setNoteDrafts((current) => {
      const next = { ...current };
      delete next[studentId];
      return next;
    });
    emitTeacherProDataChanged({ source: "local-mutation", reason: "dismissed-students-note", scopes: ["students", "dismissed", "dashboard"] });
    toast.success("تم حفظ ملاحظات الفصل من بيانات النظام");
  };

  const applyPreset = (values: FilterPresetValues) => {
    setSearch(String(values.search || ""));
    setFilterCourseId(String(values.courseId || ""));
    setFilterDismissalType(String(values.dismissalType || ""));
    setFilterNotes((values.notesFilter as NotesFilter) || "all");
    setFilterPledge((values.pledgeFilter as PledgeFilter) || "all");
    setViewMode((values.viewMode as ViewMode) || "cards");
  };

  const clearFilters = () => {
    setSearch("");
    setFilterCourseId("");
    setFilterDismissalType("");
    setFilterNotes("all");
    setFilterPledge("all");
    setViewMode("cards");
  };

  const renderNotesEditor = (student: Student) => {
    const value = noteDrafts[student.id] ?? dismissalDetails[student.id]?.notes ?? student.dismissalNotes ?? "";
    const saving = Boolean(savingNoteIds[student.id]);
    return (
      <div className="space-y-2">
        <Label className="text-xs">ملاحظات الفصل</Label>
        <textarea
          value={value}
          onChange={(event) =>
            setNoteDrafts((prev) => ({
              ...prev,
              [student.id]: event.target.value,
            }))
          }
          placeholder="اكتب ملاحظات خاصة بهذا الطالب المفصول..."
          className="min-h-20 w-full rounded-2xl border bg-background/70 px-3 py-2 text-sm shadow-xs outline-none focus:border-primary"
          disabled={!canRunSensitiveActions || saving}
        />
        <Button
          size="sm"
          variant="outline"
          onClick={() => void handleSaveNote(student.id)}
          disabled={!canRunSensitiveActions || saving}
        >
          {saving ? "جاري الحفظ..." : "حفظ الملاحظات"}
        </Button>
      </div>
    );
  };

  const renderStatusBanner = () => {
    if (dismissedStudentsSearchLoading || dismissalDetailsLoading || dismissedStatsLoading) {
      return (
        <div className="rounded-2xl border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
          جاري تحميل المفصولين وتفاصيل الفصل من بيانات النظام...
        </div>
      );
    }
    if (listError || detailsError || dismissedStatsError) {
      return (
        <div className="rounded-2xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {listError || detailsError || dismissedStatsError}
        </div>
      );
    }
    return (
      <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-700 dark:text-emerald-300">
        بيانات المفصولين وتفاصيل الفصل محملة من بيانات النظام، والإجراءات الحساسة لا تُنفّذ إلا بعد تأكيد الحفظ.
      </div>
    );
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <StatCard
          label="إجمالي المفصولين في النظام"
          value={dismissedStatsLoading ? "..." : systemDismissedStats.total}
          icon={Users}
          tone="danger"
          hint="كل الطلاب المفصولين"
          scope="system"
        />
        <StatCard
          label="فصل مؤقت"
          value={dismissedStatsLoading ? "..." : systemDismissedStats.temporary}
          icon={Clock}
          tone="warning"
          hint="من إجمالي النظام"
          scope="system"
        />
        <StatCard
          label="فصل نهائي"
          value={dismissedStatsLoading ? "..." : systemDismissedStats.final}
          icon={Ban}
          tone="danger"
          hint="من إجمالي النظام"
          scope="system"
        />
        <StatCard
          label="بملاحظات"
          value={dismissedStatsLoading ? "..." : systemDismissedStats.withNotes}
          icon={FileText}
          tone="info"
          hint="من إجمالي النظام"
          scope="system"
        />
        <StatCard
          label="بتعهد"
          value={dismissedStatsLoading ? "..." : systemDismissedStats.withPledge}
          icon={HandHeart}
          tone="primary"
          hint="من إجمالي النظام"
          scope="system"
        />
        <StatCard
          label="بدون تعهد"
          value={dismissedStatsLoading ? "..." : systemDismissedStats.withoutPledge}
          icon={Ban}
          tone="warning"
          hint="من إجمالي النظام"
          scope="system"
        />
      </div>

      <CountScopeSummary
        systemTotal={systemDismissedStats.total}
        filteredTotal={dismissedStats.total}
        pageCount={dismissedStudents.length}
      />

      {renderStatusBanner()}

      <Card>
        <CardHeader>
          <CardTitle>الطلاب المفصولون</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-6">
            <div className="space-y-1">
              <Label htmlFor="dismissed-course" className="text-xs">
                الدورة
              </Label>
              <Select
                value={filterCourseId || "all"}
                onValueChange={(value) =>
                  setFilterCourseId(value === "all" ? "" : value)
                }
              >
                <SelectTrigger id="dismissed-course">
                  <SelectValue placeholder="الكل" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">الكل</SelectItem>
                  {courses.map((course) => (
                    <SelectItem key={course.id} value={course.id}>
                      {course.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="dismissed-type" className="text-xs">
                نوع الفصل
              </Label>
              <Select
                value={filterDismissalType || "all"}
                onValueChange={(value) =>
                  setFilterDismissalType(value === "all" ? "" : value)
                }
              >
                <SelectTrigger id="dismissed-type">
                  <SelectValue placeholder="الكل" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">الكل</SelectItem>
                  {dismissedTypes.map((type) => (
                    <SelectItem key={type} value={type}>
                      {type}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="dismissed-notes" className="text-xs">
                الملاحظات
              </Label>
              <Select
                value={filterNotes}
                onValueChange={(value) => setFilterNotes(value as NotesFilter)}
              >
                <SelectTrigger id="dismissed-notes">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">الكل</SelectItem>
                  <SelectItem value="with-notes">لديهم ملاحظات</SelectItem>
                  <SelectItem value="without-notes">بدون ملاحظات</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="dismissed-pledge" className="text-xs">
                التعهد
              </Label>
              <Select
                value={filterPledge}
                onValueChange={(value) => setFilterPledge(value as PledgeFilter)}
              >
                <SelectTrigger id="dismissed-pledge">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">كل التعهدات</SelectItem>
                  <SelectItem value="with-pledge">بتعهد مسجل</SelectItem>
                  <SelectItem value="without-pledge">بدون تعهد</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1 md:col-span-2">
              <Label htmlFor="dismissed-search" className="text-xs">
                بحث ذكي
              </Label>
              <Input
                id="dismissed-search"
                name="search"
                data-teacherpro-search="true"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="اسم / كود / سبب / ملاحظات / تيليجرام"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="dismissed-view" className="text-xs">
                طريقة العرض
              </Label>
              <Select
                value={viewMode}
                onValueChange={(value) => setViewMode(value as ViewMode)}
              >
                <SelectTrigger id="dismissed-view">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="cards">البطاقات</SelectItem>
                  <SelectItem value="table">الجدول</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <CustomFilterPresets
            storageKey="teacherpro.dismissed.customFilters"
            currentFilters={{
              search,
              courseId: filterCourseId,
              dismissalType: filterDismissalType,
              notesFilter: filterNotes,
              pledgeFilter: filterPledge,
              viewMode,
            }}
            onApply={applyPreset}
            onClear={clearFilters}
          />
        </CardContent>
      </Card>

      {viewMode === "cards" ? (
        <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
          {dismissedStudents.map((student) => {
            const reactivating = Boolean(reactivatingIds[student.id]);
            return (
              <Card key={student.id}>
                <CardContent className="space-y-3 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="font-bold">{student.name}</h3>
                        <Badge variant="destructive">
                          {dismissalDetails[student.id]?.type || student.dismissalType || "مفصول"}
                        </Badge>
                        {dismissalDetails[student.id]?.hasPledge ? (
                          <Badge variant="outline">تعهد مسجل</Badge>
                        ) : (
                          <Badge variant="secondary">بدون تعهد</Badge>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {student.code} - {courseName(student.courseId)} -{" "}
                        {student.subSite || student.locationScope || "بدون موقع"}
                      </p>
                    </div>
                    <Button
                      size="sm"
                      onClick={() => void handleReactivate(student)}
                      disabled={!canRunSensitiveActions || reactivating}
                    >
                      {reactivating ? "جاري التفعيل..." : "إعادة تفعيل"}
                    </Button>
                  </div>
                  {renderDismissalContext(student)}
                  {renderNotesEditor(student)}
                  <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                    <span>الهاتف: {student.phone || "—"}</span>
                    <span>ولي الأمر: {student.parentPhone || "—"}</span>
                    <span>التيليجرام: {student.telegram || "—"}</span>
                    <span>
                      الفرص: {student.opportunities}/{student.baseOpportunities}
                    </span>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      ) : (
        <div className="table-wrap">
          <table className="responsive-table text-sm">
            <thead>
              <tr>
                <th className="p-3 text-right">الطالب</th>
                <th className="p-3 text-right">الكود</th>
                <th className="p-3 text-right">الدورة</th>
                <th className="p-3 text-right">نوع الفصل</th>
                <th className="p-3 text-right">تفاصيل الفصل</th>
                <th className="p-3 text-right">التعهد</th>
                <th className="p-3 text-right">الملاحظات</th>
                <th className="p-3 text-right">الفرص</th>
                <th className="p-3 text-right">الإجراء</th>
              </tr>
            </thead>
            <tbody>
              {dismissedStudents.map((student) => {
                const detail = dismissalDetailForStudent(student);
                const reactivating = Boolean(reactivatingIds[student.id]);
                return (
                  <tr key={student.id} className="border-t align-top">
                    <td className="p-3 font-medium">{student.name}</td>
                    <td className="p-3">{student.code}</td>
                    <td className="p-3">{courseName(student.courseId)}</td>
                    <td className="p-3">
                      <Badge variant="destructive">
                        {detail.type || student.dismissalType || "مفصول"}
                      </Badge>
                    </td>
                    <td className="p-3 min-w-80">
                      <div className="space-y-1 text-xs">
                        <p className="font-semibold text-destructive">{detail.reason || student.dismissalReason || "لا يوجد سبب مسجل"}</p>
                        <p>الامتحان: {detail.examName || "—"}</p>
                        <p>آخر درجة: {formatDismissalGrade(detail)}</p>
                      </div>
                    </td>
                    <td className="p-3 min-w-56">
                      {detail.hasPledge ? (
                        <Badge variant="outline">تعهد مسجل{detail.pledgeDate ? ` - ${detail.pledgeDate}` : ""}</Badge>
                      ) : (
                        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-2 text-xs text-amber-800 dark:text-amber-200">
                          لم يتم تسجيل تعهد لهذا الفصل.
                        </div>
                      )}
                    </td>
                    <td className="p-3 min-w-72">{renderNotesEditor(student)}</td>
                    <td className="p-3">
                      {student.opportunities}/{student.baseOpportunities}
                    </td>
                    <td className="p-3">
                      <Button
                        size="sm"
                        onClick={() => void handleReactivate(student)}
                        disabled={!canRunSensitiveActions || reactivating}
                      >
                        {reactivating ? "جاري التفعيل..." : "إعادة تفعيل"}
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {dismissedStudents.length === 0 && !dismissedStudentsSearchLoading && (
        <p className="empty-state">لا يوجد طلاب مفصولون حسب الفلترة الحالية.</p>
      )}
    </div>
  );
}
