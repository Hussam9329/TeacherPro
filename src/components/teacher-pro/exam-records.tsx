"use client";
import { useTeacherProSyncKey } from "@/hooks/use-teacherpro-sync";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useTeacherStore, type Exam } from "@/lib/teacher-store";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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

import { toast } from "@/lib/user-toast";
import { formatAppDate, toLatinDigits } from "@/lib/format";
import {
  formatBaghdadDateTime,
} from "@/lib/baghdad-time";
import { useActionLock } from "@/hooks/use-action-lock";
import {
  formatGradeScore,
  getExamEntryAvailability,
  getExamStatus,
  splitSelection,
  type ExamStatusLabel,
} from "@/lib/exam-utils";
import { searchAny } from "@/lib/validation";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { examApi, examStatsApi, type ApiResult, type ExamRecordStat } from "@/lib/api";
import { emitTeacherProDataChanged } from "@/lib/teacherpro-sync";
import { ExportDialog, type ExportColumn } from "./export-dialog";
import {
  ExamEditDialog,
  validateFullExamEditState,
  type FullExamEditState,
} from "./exam-edit-dialog";

const examGradeExportColumns: ExportColumn<any>[] = [
  { key: "index", label: "#", value: (row) => Number(row.index ?? 0) + 1 },
  { key: "code", label: "الكود", value: (row) => row.student?.code || "" },
  { key: "student", label: "الطالب", value: (row) => row.student?.name || "" },
  { key: "course", label: "الدورة", value: (row) => row.courseName || "" },
  { key: "status", label: "الحالة", value: (row) => row.grade.status || "" },
  {
    key: "score",
    label: "الدرجة",
    value: (row) => formatGradeScore(row.grade, row.exam, ""),
  },
  {
    key: "classification",
    label: "التصنيف",
    value: (row) => row.cls.text || "",
  },
  { key: "phone", label: "الهاتف", value: (row) => row.student?.phone || "" },
  {
    key: "telegram",
    label: "التيليجرام",
    value: (row) => row.student?.telegram || "",
  },
  { key: "notes", label: "ملاحظات", value: (row) => row.grade.notes || "" },
];

type ViewMode = "cards" | "table";
type ExamDetailItem = {
  label: string;
  value: React.ReactNode;
};

function formatDateTime(value?: string | null) {
  return formatBaghdadDateTime(value);
}

function getEntryAvailability(exam: Exam) {
  const availability = getExamEntryAvailability(exam);
  return {
    ...availability,
    answer: availability.available ? "نعم" : "لا",
  };
}

type ExamRecordVisualProps = {
  exam: Exam;
  courseLabel: string;
  status: ExamStatusLabel;
  entryAvailable: boolean;
  entryAnswer: string;
  entryReason: string;
  totalStat: React.ReactNode;
  passStat: React.ReactNode;
  notPassedStat: React.ReactNode;
  protectedStat: React.ReactNode;
  totalRowCount: number | null;
  detailsOpen: boolean;
  mutating: boolean;
  onToggleDetails: (examId: string) => void;
  onToggleActive: (exam: Exam) => void | Promise<void>;
  onEdit: (examId: string) => void;
  onDelete: (examId: string) => void;
  buildExamExportRows: (exam: Exam) => any[];
};

function buildExamDetails({
  exam,
  courseLabel,
  status,
  entryAvailable,
  entryAnswer,
  entryReason,
  totalStat,
}: Pick<
  ExamRecordVisualProps,
  | "exam"
  | "courseLabel"
  | "status"
  | "entryAvailable"
  | "entryAnswer"
  | "entryReason"
  | "totalStat"
>): ExamDetailItem[] {
  const mainSites = splitSelection(exam.mainSite);
  return [
    { label: "اسم الامتحان", value: exam.name },
    { label: "تاريخ الامتحان", value: formatAppDate(exam.date) },
    { label: "نوع الامتحان", value: exam.type },
    { label: "حالة الامتحان", value: status },
    {
      label: "متاح للإدخال",
      value: (
        <span
          className={
            entryAvailable
              ? "text-emerald-600 dark:text-emerald-400"
              : "text-rose-600 dark:text-rose-400"
          }
        >
          {entryAnswer} - {entryReason}
        </span>
      ),
    },
    { label: "الدورات", value: courseLabel || "—" },
    { label: "الموقع", value: mainSites.join("، ") || "الكل" },
    { label: "الدرجة الكاملة", value: exam.fullMark },
    { label: "درجة النجاح", value: exam.passMark },
    { label: "بدون خصم", value: exam.noDiscount ? "نعم" : "لا" },
    {
      label: "درجة الخصم",
      value: exam.noDiscount ? "معطل" : exam.discountMark,
    },
    {
      label: "خصم الفرص",
      value: exam.noDiscount ? "معطل" : exam.opportunitiesPenalty,
    },
    {
      label: "درجة الفصل",
      value: exam.noDiscount ? "معطل" : (exam.dismissalGrade ?? "—"),
    },
    { label: "تفعيل مجدول", value: formatDateTime(exam.scheduledActivateAt) },
    { label: "عدد سجلات الدرجات", value: totalStat },
  ];
}

function renderExamDetailsPanel(
  details: ExamDetailItem[],
  stats: {
    pass: React.ReactNode;
    notPassed: React.ReactNode;
    protected: React.ReactNode;
    total: React.ReactNode;
  },
) {
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2 text-center md:grid-cols-4">
        <div className="rounded bg-emerald-50 p-2 dark:bg-emerald-950/40">
          <p className="text-lg font-bold text-emerald-600 dark:text-emerald-400">
            {stats.pass}
          </p>
          <p className="text-[10px] text-muted-foreground">ناجح</p>
        </div>
        <div className="rounded bg-rose-50 p-2 dark:bg-rose-950/40">
          <p className="text-lg font-bold text-rose-600 dark:text-rose-400">
            {stats.notPassed}
          </p>
          <p className="text-[10px] text-muted-foreground">محاسب/غائب</p>
        </div>
        <div className="rounded bg-cyan-50 p-2 dark:bg-cyan-950/40">
          <p className="text-lg font-bold text-cyan-600 dark:text-cyan-400">
            {stats.protected}
          </p>
          <p className="text-[10px] text-muted-foreground">سماح/إجازة</p>
        </div>
        <div className="rounded bg-sky-50 p-2 dark:bg-sky-950/40">
          <p className="text-lg font-bold text-sky-600 dark:text-sky-400">
            {stats.total}
          </p>
          <p className="text-[10px] text-muted-foreground">إجمالي</p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-2 text-sm md:grid-cols-2 xl:grid-cols-3">
        {details.map((item) => (
          <div key={item.label} className="rounded-xl border bg-muted/40 p-2">
            <p className="text-[10px] text-muted-foreground">{item.label}</p>
            <p className="mt-0.5 font-semibold">{item.value}</p>
          </div>
        ))}
      </div>

      <div className="rounded-xl border border-dashed bg-muted/30 p-3 text-center text-xs text-muted-foreground">
        تم إخفاء تفاصيل درجات الطلاب من سجل الامتحانات. يمكن مراجعة الدرجات من قائمة سجل الدرجات.
      </div>
    </div>
  );
}

const ExamRecordActions = React.memo(function ExamRecordActions({
  exam,
  mutating,
  totalRowCount,
  buildExamExportRows,
  onToggleActive,
  onEdit,
  onDelete,
}: Pick<
  ExamRecordVisualProps,
  | "exam"
  | "mutating"
  | "totalRowCount"
  | "buildExamExportRows"
  | "onToggleActive"
  | "onEdit"
  | "onDelete"
>) {
  return (
    <div className="flex flex-wrap gap-1">
      <div className="min-w-32">
        <ExportDialog
          title={`تصدير درجات ${exam.name}`}
          fileName={`exam-${exam.name}`}
          rows={[]}
          fetchRows={async ({ signal, onProgress }) => {
            if (signal.aborted) throw new DOMException("Aborted", "AbortError");
            await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
            if (signal.aborted) throw new DOMException("Aborted", "AbortError");
            const exportRows = buildExamExportRows(exam);
            onProgress(exportRows.length, exportRows.length);
            return exportRows;
          }}
          totalRowCount={totalRowCount}
          columns={examGradeExportColumns}
          triggerLabel="تصدير"
          description={`تقرير درجات امتحان ${exam.name}`}
        />
      </div>
      <Button
        variant="outline"
        size="sm"
        onClick={() => void onToggleActive(exam)}
        disabled={mutating}
      >
        {mutating ? "جاري..." : exam.active ? "تعطيل الآن" : "تفعيل الآن"}
      </Button>
      <Button
        variant="secondary"
        size="sm"
        onClick={() => onEdit(exam.id)}
        disabled={mutating}
      >
        تعديل
      </Button>
      <Button
        variant="destructive"
        size="sm"
        onClick={() => onDelete(exam.id)}
        disabled={mutating}
      >
        حذف
      </Button>
    </div>
  );
});

const ExamRecordCard = React.memo(function ExamRecordCard(props: ExamRecordVisualProps) {
  const {
    exam,
    courseLabel,
    status,
    entryAvailable,
    entryAnswer,
    entryReason,
    totalStat,
    passStat,
    notPassedStat,
    protectedStat,
    totalRowCount,
    detailsOpen,
    mutating,
    onToggleDetails,
    onToggleActive,
    onEdit,
    onDelete,
    buildExamExportRows,
  } = props;
  const details = detailsOpen ? buildExamDetails(props) : [];

  return (
    <Card
      className={`transition-[border-color,box-shadow] duration-200 hover:border-primary/25 hover:shadow-xl hover:shadow-primary/10 ${
        detailsOpen ? "" : "tp-exam-record-card-collapsed"
      }`}
    >
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="text-base">{exam.name}</CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">
              {formatAppDate(exam.date)} - {courseLabel}
            </p>
            <div className="mt-2 flex flex-wrap gap-1">
              <Badge>{exam.type}</Badge>
              <Badge variant="outline">{status}</Badge>
              <Badge variant={entryAvailable ? "secondary" : "destructive"}>
                متاح للإدخال: {entryAnswer}
              </Badge>
              <Badge variant="outline">سجلات: {totalStat}</Badge>
            </div>
          </div>
          <div className="flex flex-col items-end gap-2">
            <Button
              type="button"
              variant={detailsOpen ? "secondary" : "outline"}
              size="sm"
              onClick={() => onToggleDetails(exam.id)}
            >
              {detailsOpen ? "إخفاء التفاصيل" : "إظهار التفاصيل"}
            </Button>
            <ExamRecordActions
              exam={exam}
              mutating={mutating}
              totalRowCount={totalRowCount}
              buildExamExportRows={buildExamExportRows}
              onToggleActive={onToggleActive}
              onEdit={onEdit}
              onDelete={onDelete}
            />
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {detailsOpen ? (
          renderExamDetailsPanel(details, {
            pass: passStat,
            notPassed: notPassedStat,
            protected: protectedStat,
            total: totalStat,
          })
        ) : (
          <div className="rounded-2xl border border-dashed bg-muted/30 p-4 text-sm text-muted-foreground">
            تفاصيل الامتحان مخفية حتى تضغط على "إظهار التفاصيل". القائمة تعرض الامتحانات والبحث فقط حتى تبقى الصفحة خفيفة وواضحة للمستخدم.
          </div>
        )}
      </CardContent>
    </Card>
  );
});

const ExamRecordTableRow = React.memo(function ExamRecordTableRow(props: ExamRecordVisualProps) {
  const {
    exam,
    courseLabel,
    status,
    entryAvailable,
    entryAnswer,
    entryReason,
    totalStat,
    passStat,
    notPassedStat,
    protectedStat,
    totalRowCount,
    detailsOpen,
    mutating,
    onToggleDetails,
    onToggleActive,
    onEdit,
    onDelete,
    buildExamExportRows,
  } = props;
  const details = detailsOpen ? buildExamDetails(props) : [];

  return (
    <React.Fragment>
      <tr className="border-t align-top">
        <td className="p-3 font-bold">{exam.name}</td>
        <td className="p-3">{formatAppDate(exam.date)}</td>
        <td className="p-3">
          <div className="flex flex-wrap gap-1">
            <Badge>{exam.type}</Badge>
            {exam.noDiscount && <Badge variant="secondary">بدون خصم</Badge>}
          </div>
        </td>
        <td className="p-3">
          <Badge variant="outline">{status}</Badge>
        </td>
        <td className="p-3 min-w-48">
          <div className="space-y-1">
            <Badge variant={entryAvailable ? "secondary" : "destructive"}>
              {entryAnswer}
            </Badge>
            <p className="text-xs text-muted-foreground">
              {detailsOpen ? entryReason : "اضغط إظهار التفاصيل للسبب الكامل"}
            </p>
          </div>
        </td>
        <td className="p-3 min-w-44">{courseLabel || "—"}</td>
        <td className="p-3">{totalStat}</td>
        <td className="p-3">
          <Button
            type="button"
            variant={detailsOpen ? "secondary" : "outline"}
            size="sm"
            onClick={() => onToggleDetails(exam.id)}
          >
            {detailsOpen ? "إخفاء التفاصيل" : "إظهار التفاصيل"}
          </Button>
        </td>
        <td className="p-3 min-w-80">
          <ExamRecordActions
            exam={exam}
            mutating={mutating}
            totalRowCount={totalRowCount}
            buildExamExportRows={buildExamExportRows}
            onToggleActive={onToggleActive}
            onEdit={onEdit}
            onDelete={onDelete}
          />
        </td>
      </tr>
      {detailsOpen && (
        <tr className="border-t bg-muted/20">
          <td colSpan={9} className="p-4">
            {renderExamDetailsPanel(details, {
              pass: passStat,
              notPassed: notPassedStat,
              protected: protectedStat,
              total: totalStat,
            })}
          </td>
        </tr>
      )}
    </React.Fragment>
  );
});

export function ExamRecordsView() {
  const syncKey = useTeacherProSyncKey([
    "exams",
    "courses",
    "grades",
    "students",
    "correction",
    "grade-entry-notes",
    "dashboard",
  ]);
  const {
    exams,
    grades,
    students,
    courses,
    courseChapters,
    opportunityLogs,
    correctionSheets,
    studentLeaves,
    studentCalls,
    loadFromServer,
    courseName,
    classification,
  } = useTeacherStore();

  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search, 180);
  const [filterType, setFilterType] = useState("");
  const [filterCourseId, setFilterCourseId] = useState("");
  const [filterStatus, setFilterStatus] = useState<ExamStatusLabel | "">("");
  const [viewMode, setViewMode] = useState<ViewMode>("cards");
  const [databaseExamStats, setDatabaseExamStats] = useState<
    Record<string, ExamRecordStat>
  >({});
  const [databaseExamStatsLoading, setDatabaseExamStatsLoading] =
    useState(false);
  const [deleteDialog, setDeleteDialog] = useState<{
    open: boolean;
    id: string;
    name: string;
    gradeCount: number | null;
    dependentCount: number;
  }>({
    open: false,
    id: "",
    name: "",
    gradeCount: null,
    dependentCount: 0,
  });
  const [editingExamId, setEditingExamId] = useState<string | null>(null);
  const [clockTick, setClockTick] = useState(0);
  const [expandedExamIds, setExpandedExamIds] = useState<Record<string, boolean>>({});
  const [mutatingExamIds, setMutatingExamIds] = useState<Record<string, boolean>>({});
  const { locked: isDeletingExam, runLocked: runDeleteExamLocked } =
    useActionLock();

  const examById = useMemo(
    () => new Map(exams.map((exam) => [String(exam.id), exam] as const)),
    [exams],
  );
  const studentById = useMemo(
    () => new Map(students.map((student) => [String(student.id), student] as const)),
    [students],
  );
  const gradesByExamId = useMemo(() => {
    const index = new Map<string, (typeof grades)[number][]>();
    for (const grade of grades) {
      const key = String(grade.examId);
      const bucket = index.get(key);
      if (bucket) bucket.push(grade);
      else index.set(key, [grade]);
    }
    return index;
  }, [grades]);

  const editingExam = editingExamId ? examById.get(String(editingExamId)) || null : null;

  useEffect(() => {
    const timer = window.setInterval(
      () => setClockTick((tick) => tick + 1),
      30000,
    );
    return () => window.clearInterval(timer);
  }, []);

  const filteredExams = useMemo(() => {
    return exams.filter((exam) => {
      if (
        debouncedSearch &&
        !searchAny(debouncedSearch, [
          exam.name,
          exam.date,
          getExamStatus(exam),
          exam.mainSite,
          ...exam.courseIds.map(courseName),
        ])
      )
        return false;
      if (filterType && exam.type !== filterType) return false;
      if (filterCourseId && !exam.courseIds.includes(filterCourseId))
        return false;
      if (filterStatus && getExamStatus(exam) !== filterStatus) return false;
      return true;
    });
  }, [
    exams,
    debouncedSearch,
    filterType,
    filterCourseId,
    filterStatus,
    courseName,
    clockTick,
  ]);

  const filteredExamIdsKey = useMemo(
    () => filteredExams.map((exam) => exam.id).join(","),
    [filteredExams],
  );

  useEffect(() => {
    const examIds = filteredExamIdsKey.split(",").filter(Boolean);
    if (examIds.length === 0) {
      setDatabaseExamStats({});
      setDatabaseExamStatsLoading(false);
      return;
    }

    const controller = new AbortController();
    setDatabaseExamStatsLoading(true);
    examStatsApi
      .get(examIds, { signal: controller.signal, quietAbort: true })
      .then((result) => {
        if (!controller.signal.aborted) {
          setDatabaseExamStats(result?.statsByExamId || {});
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) setDatabaseExamStats({});
      })
      .finally(() => {
        if (!controller.signal.aborted) setDatabaseExamStatsLoading(false);
      });

    return () => controller.abort();
  }, [filteredExamIdsKey, syncKey]);

  const examStatValue = useCallback(
    (examId: string, key: keyof ExamRecordStat) => {
      const stat = databaseExamStats[examId];
      if (databaseExamStatsLoading && !stat) return "…";
      return stat ? stat[key] : "—";
    },
    [databaseExamStats, databaseExamStatsLoading],
  );

  const examStatNumber = useCallback(
    (examId: string, key: keyof ExamRecordStat): number | null => {
      const stat = databaseExamStats[examId];
      const value = stat?.[key];
      return typeof value === "number" && Number.isFinite(value) ? value : null;
    },
    [databaseExamStats],
  );

  const examRows = useCallback(
    (examId: string) => {
      const exam = examById.get(String(examId));
      if (!exam) return [];
      return (gradesByExamId.get(String(examId)) || [])
        .map((grade) => {
          const student = studentById.get(String(grade.studentId));
          const cls = classification(grade, exam, student);
          return { grade, student, cls };
        })
        .filter((row) => row.student)
        .sort((a, b) =>
          (a.student?.name || "").localeCompare(b.student?.name || "", "ar"),
        );
    },
    [classification, examById, gradesByExamId, studentById],
  );

  const buildExamExportRows = useCallback(
    (exam: Exam) =>
      examRows(exam.id).map((row, index) => ({
        ...row,
        index,
        exam,
        courseName: row.student ? courseName(row.student.courseId) : "",
      })),
    [courseName, examRows],
  );



  const isExamMutating = (examId: string) => Boolean(mutatingExamIds[examId]);

  const setExamMutating = useCallback((examId: string, value: boolean) => {
    setMutatingExamIds((current) => ({ ...current, [examId]: value }));
  }, []);

  const toggleExamDetails = useCallback((examId: string) => {
    setExpandedExamIds((current) => ({ ...current, [examId]: !current[examId] }));
  }, []);

  const refreshExamRecordsAfterMutation = useCallback(
    async (reason: string) => {
      await loadFromServer();
      // إصلاح: استخدام dispatchLocal لضمان تحديث الواجهة فوراً بعد التعديل
      emitTeacherProDataChanged({
        source: "local-mutation",
        reason,
        scopes: ["exams", "grades", "opportunities", "dashboard"],
        dispatchLocal: true,  // ← إضافة هذا السطر لإصلاح المشكلة
      });
    },
    [loadFromServer],
  );

  const openEditExamDialog = useCallback(
    (examId: string) => {
      if (!examById.has(String(examId))) return;
      setEditingExamId(examId);
    },
    [examById],
  );

  const updateExamWithActivationConfirmation = useCallback(
    async (
      examId: string,
      patch: Record<string, unknown>,
    ): Promise<ApiResult | null> => {
      const guardedPatch = {
        ...patch,
        expectedMutationToken:
          examById.get(String(examId))?.mutationToken || "",
      };
    const initialResult = await examApi.update(examId, guardedPatch);
    const conflict = (initialResult.data || {}) as {
      requiresActivationConfirmation?: boolean;
      previewToken?: string;
      storedGradeCount?: number;
    };
    if (
      initialResult.status !== 409 ||
      !conflict.requiresActivationConfirmation ||
      !conflict.previewToken
    ) {
      if (
        initialResult.status === 409 &&
        Boolean((initialResult.data as { requiresFreshExam?: boolean } | null)?.requiresFreshExam)
      ) {
        await loadFromServer();
      }
      return initialResult;
    }
    const storedGradeCount = Math.max(0, Number(conflict.storedGradeCount || 0));
    if (
      !window.confirm(
        `تنبيه: الامتحان مرتبط بـ ${storedGradeCount} درجة محفوظة، وقد تصبح مؤثرة عند التفعيل. هل راجعت هذا الأثر وتؤكد المتابعة؟`,
      )
    ) {
      return null;
    }
    const confirmedResult = await examApi.update(examId, {
      ...guardedPatch,
      activationPreviewToken: conflict.previewToken,
    });
      if (confirmedResult.status === 409) await loadFromServer();
      return confirmedResult;
    },
    [examById, loadFromServer],
  );

  const handleEditExam = async (editDialog: FullExamEditState) => {
    const validation = validateFullExamEditState(
      editDialog,
      courses,
      courseChapters,
    );
    if (!validation.isValid) {
      toast.error(validation.firstError || "راجع بيانات الامتحان قبل الحفظ");
      return;
    }
    const isFinalExam = editDialog.type === "فاينل";
    const noDiscount = Boolean(editDialog.noDiscount);
    const statusPatch =
      editDialog.statusMode === "نشط"
        ? { active: true, scheduledActivateAt: "" }
        : editDialog.statusMode === "معطل"
          ? {
              active: false,
              scheduledActivateAt: "",
            }
          : {
              active: false,
              scheduledActivateAt: editDialog.scheduledActivateAt,
            };

    setExamMutating(editDialog.id, true);
    const result = await updateExamWithActivationConfirmation(editDialog.id, {
      name: editDialog.name.trim(),
      type: editDialog.type,
      courseIds: editDialog.courseIds,
      mainSite: editDialog.mainSites.join(","),
      date: editDialog.date,
      fullMark: Number(toLatinDigits(editDialog.fullMark)),
      passMark: Number(toLatinDigits(editDialog.passMark)),
      discountMark:
        isFinalExam || noDiscount
          ? 0
          : Number(toLatinDigits(editDialog.discountMark)),
      opportunitiesPenalty: noDiscount
        ? 0
        : isFinalExam
          ? 0
          : Number(toLatinDigits(editDialog.opportunitiesPenaltyNum)),
      dismissalGrade:
        !noDiscount && isFinalExam && editDialog.dismissalGrade
          ? Number(toLatinDigits(editDialog.dismissalGrade))
          : null,
      noDiscount,
      ...statusPatch,
    });
    setExamMutating(editDialog.id, false);

    if (!result) return;
    if (!result.ok || result.queued) {
      toast.error(result.error || "تعذر تعديل الامتحان من النظام.");
      return;
    }

    setEditingExamId(null);
    await refreshExamRecordsAfterMutation("exam-records-edit");
    toast.success("تم تعديل الامتحان من بيانات النظام وإعادة الاحتساب");
  };

  const openDeleteExamDialog = useCallback(
    (examId: string) => {
      const exam = examById.get(String(examId));
      const dependentCount =
        opportunityLogs.filter((log) => log.examId === examId).length +
        correctionSheets.filter((sheet) => sheet.examId === examId).length +
        studentLeaves.filter((leave) => leave.examId === examId).length +
        studentCalls.filter((call) => call.examId === examId).length;
      setDeleteDialog({
        open: true,
        id: examId,
        name: exam?.name || "",
        gradeCount: examStatNumber(examId, "total"),
        dependentCount,
      });
    },
    [
      correctionSheets,
      examById,
      examStatNumber,
      opportunityLogs,
      studentCalls,
      studentLeaves,
    ],
  );

  const handleDeleteExam = runDeleteExamLocked(async () => {
    if (deleteDialog.gradeCount === null) {
      toast.error("انتظر اكتمال التحقق من سجلات الدرجات قبل الحذف.");
      return;
    }
    if (deleteDialog.gradeCount > 0) {
      toast.error(
        `لا يمكن حذف هذا الامتحان لأن عليه ${deleteDialog.gradeCount} سجل درجات. عطّل الامتحان بدلاً من حذفه.`,
      );
      return;
    }
    if (deleteDialog.dependentCount > 0) {
      toast.error(
        `لا يمكن حذف الامتحان لأنه مرتبط بـ ${deleteDialog.dependentCount} سجل تابع. عطّله بدلاً من حذفه حتى لا يضيع التاريخ.`,
      );
      return;
    }
    setExamMutating(deleteDialog.id, true);
    const result = await examApi.remove(deleteDialog.id);
    setExamMutating(deleteDialog.id, false);
    if (!result.ok || result.queued) {
      toast.error(result.error || "تعذر حذف الامتحان من النظام.");
      return;
    }
    setDeleteDialog({
      open: false,
      id: "",
      name: "",
      gradeCount: null,
      dependentCount: 0,
    });
    await refreshExamRecordsAfterMutation("exam-records-delete");
    toast.success("تم حذف الامتحان من بيانات النظام");
  });

  const handleToggleExamActive = useCallback(
    async (exam: Exam) => {
      const enabling = !exam.active;
      setExamMutating(exam.id, true);
      const result = await updateExamWithActivationConfirmation(exam.id, {
        active: enabling,
        scheduledActivateAt: "",
      });
      setExamMutating(exam.id, false);
      if (!result) return;
      if (!result.ok || result.queued) {
        toast.error(result.error || "تعذر تغيير حالة الامتحان من النظام.");
        return;
      }
      await refreshExamRecordsAfterMutation(
        exam.active ? "exam-records-disable" : "exam-records-enable",
      );
      toast.success(
        exam.active
          ? "تم تعطيل الامتحان من بيانات النظام"
          : "تم تفعيل الامتحان من بيانات النظام",
      );
    },
    [refreshExamRecordsAfterMutation, setExamMutating, updateExamWithActivationConfirmation],
  );

  const renderCards = () => (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
      {filteredExams.map((exam) => {
        const entryAvailability = getEntryAvailability(exam);
        return (
          <ExamRecordCard
            key={exam.id}
            exam={exam}
            courseLabel={exam.courseIds.map(courseName).join("، ")}
            status={getExamStatus(exam)}
            entryAvailable={entryAvailability.available}
            entryAnswer={entryAvailability.answer}
            entryReason={entryAvailability.reason}
            totalStat={examStatValue(exam.id, "total")}
            passStat={examStatValue(exam.id, "passCount")}
            notPassedStat={examStatValue(exam.id, "notPassedCount")}
            protectedStat={examStatValue(exam.id, "protectedCount")}
            totalRowCount={examStatNumber(exam.id, "total")}
            detailsOpen={Boolean(expandedExamIds[exam.id])}
            mutating={isExamMutating(exam.id)}
            onToggleDetails={toggleExamDetails}
            onToggleActive={handleToggleExamActive}
            onEdit={openEditExamDialog}
            onDelete={openDeleteExamDialog}
            buildExamExportRows={buildExamExportRows}
          />
        );
      })}
      {filteredExams.length === 0 && (
        <div className="empty-state xl:col-span-2">
          لا توجد امتحانات مطابقة للفلاتر.
        </div>
      )}
    </div>
  );

  const renderTable = () => (
    <div className="table-wrap" tabIndex={0} aria-label="جدول سجلات الامتحانات؛ يمكن تمريره أفقياً عند الحاجة">
      <table className="responsive-table text-sm">
        <thead>
          <tr>
            <th className="p-3 text-right">اسم الامتحان</th>
            <th className="p-3 text-right">التاريخ</th>
            <th className="p-3 text-right">النوع</th>
            <th className="p-3 text-right">الحالة</th>
            <th className="p-3 text-right">متاح للإدخال</th>
            <th className="p-3 text-right">الدورات</th>
            <th className="p-3 text-right">السجلات</th>
            <th className="p-3 text-right">التفاصيل</th>
            <th className="p-3 text-right">الإجراءات</th>
          </tr>
        </thead>
        <tbody>
          {filteredExams.map((exam) => {
            const entryAvailability = getEntryAvailability(exam);
            return (
              <ExamRecordTableRow
                key={exam.id}
                exam={exam}
                courseLabel={exam.courseIds.map(courseName).join("، ")}
                status={getExamStatus(exam)}
                entryAvailable={entryAvailability.available}
                entryAnswer={entryAvailability.answer}
                entryReason={entryAvailability.reason}
                totalStat={examStatValue(exam.id, "total")}
                passStat={examStatValue(exam.id, "passCount")}
                notPassedStat={examStatValue(exam.id, "notPassedCount")}
                protectedStat={examStatValue(exam.id, "protectedCount")}
                totalRowCount={examStatNumber(exam.id, "total")}
                detailsOpen={Boolean(expandedExamIds[exam.id])}
                mutating={isExamMutating(exam.id)}
                onToggleDetails={toggleExamDetails}
                onToggleActive={handleToggleExamActive}
                onEdit={openEditExamDialog}
                onDelete={openDeleteExamDialog}
                buildExamExportRows={buildExamExportRows}
              />
            );
          })}
          {filteredExams.length === 0 && (
            <tr>
              <td colSpan={9} className="p-8 text-center text-muted-foreground">
                لا توجد امتحانات مطابقة للفلاتر.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );

  return (
    <div className="tp-exam-records-page space-y-4">
      <Card className="tp-filter-card">
        <CardContent className="tp-filter-content">
          <div className="tp-filter-grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6">
            <div className="tp-filter-field tp-filter-primary">
              <Label htmlFor="exam-records-course" className="text-xs">
                الدورة
              </Label>
              <Select
                value={filterCourseId || "all"}
                onValueChange={(v) => setFilterCourseId(v === "all" ? "" : v)}
              >
                <SelectTrigger id="exam-records-course">
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
            <div className="tp-filter-field tp-filter-secondary">
              <Label htmlFor="exam-records-type" className="text-xs">
                نوع الامتحان
              </Label>
              <Select
                value={filterType || "all"}
                onValueChange={(v) => setFilterType(v === "all" ? "" : v)}
              >
                <SelectTrigger id="exam-records-type">
                  <SelectValue placeholder="الكل" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">الكل</SelectItem>
                  <SelectItem value="يومي">يومي</SelectItem>
                  <SelectItem value="تراكمي">تراكمي</SelectItem>
                  <SelectItem value="فاينل">فاينل</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="tp-filter-field tp-filter-secondary">
              <Label htmlFor="exam-records-status" className="text-xs">
                حالة الامتحان
              </Label>
              <Select
                value={filterStatus || "all"}
                onValueChange={(v) =>
                  setFilterStatus(v === "all" ? "" : (v as ExamStatusLabel))
                }
              >
                <SelectTrigger id="exam-records-status">
                  <SelectValue placeholder="كل الحالات" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">كل الحالات</SelectItem>
                  <SelectItem value="نشط">نشط</SelectItem>
                  <SelectItem value="تفعيل مجدول">تفعيل مجدول</SelectItem>
                  <SelectItem value="معطل">معطل</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="tp-filter-field tp-filter-search lg:col-span-2">
              <Label htmlFor="exam-records-search" className="text-xs">
                بحث
              </Label>
              <Input
                id="exam-records-search"
                name="search"
                data-teacherpro-search="true"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="اسم الامتحان / التاريخ / الدورة / الحالة"
              />
            </div>
            <div className="tp-filter-field tp-filter-meta">
              <Label htmlFor="exam-records-view" className="text-xs">
                طريقة العرض
              </Label>
              <Select
                value={viewMode}
                onValueChange={(v) => setViewMode(v as ViewMode)}
              >
                <SelectTrigger id="exam-records-view">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="cards">البطاقات</SelectItem>
                  <SelectItem value="table">الجدول</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {viewMode === "cards" ? renderCards() : renderTable()}

      {editingExam ? (
        <ExamEditDialog
          key={editingExam.id}
          exam={editingExam}
          courses={courses}
          courseChapters={courseChapters}
          isMutating={isExamMutating(editingExam.id)}
          onClose={() => setEditingExamId(null)}
          onSave={handleEditExam}
        />
      ) : null}

      <AlertDialog
        open={deleteDialog.open}
        onOpenChange={(open) =>
          setDeleteDialog((prev) =>
            open
              ? { ...prev, open }
              : {
                  open: false,
                  id: "",
                  name: "",
                  gradeCount: null,
                  dependentCount: 0,
                },
          )
        }
      >
        <AlertDialogContent dir="rtl">
          <AlertDialogHeader>
            <AlertDialogTitle>تأكيد الحذف</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm text-muted-foreground">
                <p>الامتحان: &quot;{deleteDialog.name}&quot;</p>
                {deleteDialog.gradeCount === null ? (
                  <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 font-semibold text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-100">
                    جاري التحقق من بيانات النظام لمعرفة هل توجد درجات مرتبطة
                    بهذا الامتحان.
                  </p>
                ) : deleteDialog.gradeCount > 0 ? (
                  <p className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 font-semibold text-destructive">
                    لا يمكن حذف امتحان عليه درجات. يوجد{" "}
                    {deleteDialog.gradeCount} سجل درجات مرتبط بهذا الامتحان.
                    استخدم التعطيل إذا كان الهدف إيقاف ظهوره في إدخال الدرجات.
                  </p>
                ) : deleteDialog.dependentCount > 0 ? (
                  <p className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 font-semibold text-destructive">
                    لا يمكن حذف هذا الامتحان لأنه مرتبط بـ{" "}
                    {deleteDialog.dependentCount} سجل تابع مثل تصحيح أو إجازات
                    أو مكالمات أو سجلات فرص. عطّل الامتحان بدل حذفه حتى لا يضيع
                    التاريخ.
                  </p>
                ) : (
                  <p>
                    لا توجد درجات أو سجلات تابعة ظاهرة لهذا الامتحان، ويمكن
                    حذفه.
                  </p>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>إلغاء</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteExam}
              disabled={
                isDeletingExam ||
                deleteDialog.gradeCount === null ||
                Number(deleteDialog.gradeCount) > 0 ||
                deleteDialog.dependentCount > 0
              }
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isDeletingExam
                ? "جاري الحذف..."
                : deleteDialog.gradeCount === null
                  ? "جاري التحقق..."
                  : Number(deleteDialog.gradeCount) > 0 ||
                      deleteDialog.dependentCount > 0
                    ? "الحذف ممنوع"
                    : "حذف"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
