"use client";
import { useUrlState } from "@/hooks/use-url-state";
import { useTeacherProSyncKey } from "@/hooks/use-teacherpro-sync";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTeacherStore, type Exam } from "@/lib/teacher-store";
import { useShallow } from "zustand/react/shallow";
import { ChevronDown, Download, ClipboardList } from "lucide-react";
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
import { formatAppDate, toLatinDigits, arabicCount } from "@/lib/format";
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
import { chunkIds, ExamStatsCache } from "@/lib/exam-stats-cache";
import { emitTeacherProDataChanged } from "@/lib/teacherpro-sync";
import { LEGACY_GRACE_PLACEHOLDER_STATUS } from "@/lib/academic-types";
import { visibleGradeNote } from "@/lib/grade-note-banners";
import { ListToolbar } from "./list-toolbar";
import { EmptyState } from "./ui-kit";
import { RowActionsMenu } from "./row-actions-menu";
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
  { key: "course", label: "اسم الدورة", value: (row) => row.courseName || "" },
  // The retired grace placeholder is not a result: export it as empty.
  {
    key: "status",
    label: "الحالة",
    value: (row) => row.grade.status === LEGACY_GRACE_PLACEHOLDER_STATUS ? "" : row.grade.status || "",
  },
  {
    key: "score",
    label: "الدرجة",
    value: (row) => row.grade.status === LEGACY_GRACE_PLACEHOLDER_STATUS ? "" : formatGradeScore(row.grade, row.exam, ""),
  },
  {
    key: "classification",
    label: "التصنيف",
    value: (row) => row.cls.text || "",
  },
  { key: "phone", label: "الهاتف", value: (row) => row.student?.phone || "" },
  {
    key: "telegram",
    label: "التليگرام",
    value: (row) => row.student?.telegram || "",
  },
  {
    key: "username",
    label: "يوزر تليگرام",
    value: (row) => row.student?.username || "",
  },
  { key: "notes", label: "ملاحظات", value: (row) => visibleGradeNote(row.grade.notes) },
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
              ? "text-success"
              : "text-danger"
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
        <div className="rounded bg-success-soft p-2">
          <p className="text-lg font-bold text-success">
            {stats.pass}
          </p>
          <p className="text-[10px] text-muted-foreground">ناجح</p>
        </div>
        <div className="rounded bg-danger-soft p-2">
          <p className="text-lg font-bold text-danger">
            {stats.notPassed}
          </p>
          <p className="text-[10px] text-muted-foreground">محاسب/غائب</p>
        </div>
        <div className="rounded bg-info-soft p-2">
          <p className="text-lg font-bold text-info">
            {stats.protected}
          </p>
          <p className="text-[10px] text-muted-foreground">سماح/إجازة</p>
        </div>
        <div className="rounded bg-info-soft p-2">
          <p className="text-lg font-bold text-info">
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
  const [exportOpen, setExportOpen] = React.useState(false);
  return (
    <span className="tp-rcard__foot-end">
      <Button
        variant="outline"
        size="sm"
        onClick={() => onEdit(exam.id)}
        disabled={mutating}
      >
        تعديل
      </Button>
      {/* Export sits with the rest in «⋯»; disabling and deleting change what
          counts, so they come last and in red, each behind a confirmation. */}
      <RowActionsMenu
        label={`إجراءات ${exam.name}`}
        actions={[
          {
            key: "export",
            label: "تصدير الدرجات…",
            icon: <Download aria-hidden="true" />,
            onSelect: () => setExportOpen(true),
          },
          exam.active
            ? {
                key: "disable",
                label: mutating ? "جاري..." : "تعطيل الآن…",
                danger: true,
                disabled: mutating,
                onSelect: () => void onToggleActive(exam),
              }
            : {
                key: "enable",
                label: mutating ? "جاري..." : "تفعيل الآن",
                disabled: mutating,
                onSelect: () => void onToggleActive(exam),
              },
          {
            key: "delete",
            label: "حذف الامتحان…",
            danger: true,
            disabled: mutating,
            onSelect: () => onDelete(exam.id),
          },
        ]}
      />
      {exportOpen ? (
        <ExportDialog
          open={exportOpen}
          onOpenChange={setExportOpen}
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
      ) : null}
    </span>
  );
});

const ExamRecordCard = React.memo(function ExamRecordCard(props: ExamRecordVisualProps) {
  const {
    exam,
    courseLabel,
    status,
    entryAvailable,
    entryAnswer,
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
  const tone = status === "نشط" ? "success" : status === "تفعيل مجدول" ? "warning" : "danger";

  return (
    <article
      data-exam-id={exam.id}
      className={`tp-rcard tp-exam-card ${detailsOpen ? "" : "tp-exam-record-card-collapsed"}`}
      data-tone={tone}
      aria-label={exam.name}
    >
      <div className="tp-rcard__head">
        <span className="tp-rcard__light" aria-hidden="true"><ClipboardList /></span>
        <h3 className="tp-rcard__name">{exam.name}</h3>
        <span className="tp-rcard__sep" aria-hidden="true" />
        <span className="tp-rcard__sub">{formatAppDate(exam.date)} · {courseLabel || "—"}</span>
      </div>
      <div className="flex flex-wrap gap-1.5">
        <span className="tp-rcard__pill">{exam.type}</span>
        <span className="tp-rcard__pill" data-tone={tone}>{status}</span>
        <span className="tp-rcard__pill" data-tone={entryAvailable ? "success" : "danger"}>
          متاح للإدخال: {entryAnswer}
        </span>
        <span className="tp-rcard__pill">سجلات: {totalStat}</span>
      </div>
      <div className="tp-rcard__foot">
        <button
          type="button"
          className="tp-exam-card__more"
          aria-expanded={detailsOpen}
          onClick={() => onToggleDetails(exam.id)}
        >
          <ChevronDown aria-hidden="true" />
          {detailsOpen ? "إخفاء التفاصيل" : "إظهار التفاصيل"}
        </button>
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
      {detailsOpen && (
        <div className="tp-exam-card__details">
          {renderExamDetailsPanel(details, {
            pass: passStat,
            notPassed: notPassedStat,
            protected: protectedStat,
            total: totalStat,
          })}
        </div>
      )}
    </article>
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
      <tr className="border-t align-top" data-exam-id={exam.id}>
        <td className="p-3 font-bold">{exam.name}</td>
        <td className="p-3">{formatAppDate(exam.date)}</td>
        <td className="p-3">
          <div className="flex flex-wrap gap-1">
            <Badge>{exam.type}</Badge>
            {exam.noDiscount && <Badge variant="info">بدون خصم</Badge>}
          </div>
        </td>
        <td className="p-3">
          <Badge variant={status === "نشط" ? "success" : status === "تفعيل مجدول" ? "warning" : "danger"}>{status}</Badge>
        </td>
        <td className="p-3 min-w-48">
          <div className="space-y-1">
            <Badge variant={entryAvailable ? "success" : "destructive"}>
              {entryAnswer}
            </Badge>
            {detailsOpen && (
              <p className="text-xs text-muted-foreground">{entryReason}</p>
            )}
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

/** Exams per «سجل الامتحانات» numbers request. */
const EXAM_STATS_BATCH_SIZE = 24;
const EXAM_STATS_COALESCE_MS = 120;

/** The nearest scrolling ancestor, or null for the window. */
function scrollParentOf(element: HTMLElement | null | undefined): HTMLElement | null {
  for (let node = element?.parentElement; node; node = node.parentElement) {
    if (/(auto|scroll)/.test(getComputedStyle(node).overflowY)) return node;
  }
  return null;
}

export function ExamRecordsView() {
  const syncKey = useTeacherProSyncKey([
    "exams",
    "courses",
    "grades",
    "students",
    "dashboard",
  ]);
  const {
    exams,
    grades,
    students,
    courses,
    courseChapters,
    opportunityLogs,
    studentLeaves,
    studentCalls,
    loadFromServer,
    courseName,
    classification,
  } = useTeacherStore(
    useShallow((state) => ({ exams: state.exams, grades: state.grades, students: state.students, courses: state.courses, courseChapters: state.courseChapters, opportunityLogs: state.opportunityLogs, studentLeaves: state.studentLeaves, studentCalls: state.studentCalls, loadFromServer: state.loadFromServer, courseName: state.courseName, classification: state.classification })),
  );

  // Search and filters live in the link: a refresh or a copied link keeps them.
  const [search, setSearch] = useUrlState("q");
  const debouncedSearch = useDebouncedValue(search, 180);
  const [filterType, setFilterType] = useUrlState("type");
  const [filterCourseId, setFilterCourseId] = useUrlState("course");
  const [filterStatus, setFilterStatus] = useUrlState("status") as unknown as [ExamStatusLabel | "", React.Dispatch<React.SetStateAction<ExamStatusLabel | "">>];
  const [viewMode, setViewMode] = useState<ViewMode>("cards");
  // A new object after each change of the cache, so the views re-read it.
  const [examStatsView, setExamStatsView] = useState(() => ({
    cache: new ExamStatsCache<ExamRecordStat>(),
  }));
  const examStatsCache = examStatsView.cache;
  const [deleteDialog, setDeleteDialog] = useState<{
    open: boolean;
    id: string;
    name: string;
    dependentCount: number;
  }>({
    open: false,
    id: "",
    name: "",
    dependentCount: 0,
  });
  const [editingExamId, setEditingExamId] = useState<string | null>(null);
  const [disableExamId, setDisableExamId] = useState<string | null>(null);
  // The stored-grades warning before activation, answered in the system's own window.
  const [activationGradeCount, setActivationGradeCount] = useState<number | null>(null);
  const activationAnswerRef = useRef<((confirmed: boolean) => void) | null>(null);
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

  const statusChipCounts = useMemo(() => {
    const counts = { all: 0, active: 0, scheduled: 0, disabled: 0 };
    for (const exam of exams) {
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
        continue;
      if (filterType && exam.type !== filterType) continue;
      if (filterCourseId && !exam.courseIds.includes(filterCourseId)) continue;
      counts.all += 1;
      const status = getExamStatus(exam);
      if (status === "نشط") counts.active += 1;
      else if (status === "تفعيل مجدول") counts.scheduled += 1;
      else if (status === "معطل") counts.disabled += 1;
    }
    return counts;
    // clockTick re-evaluates scheduled activations as time passes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exams, debouncedSearch, filterType, filterCourseId, courseName, clockTick]);

  const filteredExamIdsKey = useMemo(
    () => filteredExams.map((exam) => exam.id).join(","),
    [filteredExams],
  );

  // «سجل الامتحانات» numbers: only exams on screen (or in an open dialog) are
  // requested, in batches; a search or filter reuses what is already loaded.
  const examListRef = useRef<HTMLDivElement>(null);
  const visibleExamIdsRef = useRef(new Set<string>());
  const dialogExamIdsRef = useRef<string[]>([]);
  const examStatsRequestsRef = useRef(new Set<AbortController>());
  const examStatsTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const sendExamStatsRequests = useCallback(() => {
    examStatsTimerRef.current = null;
    const { ids, generation } = examStatsCache.take([
      ...visibleExamIdsRef.current,
      ...dialogExamIdsRef.current,
    ]);
    for (const batch of chunkIds(ids, EXAM_STATS_BATCH_SIZE)) {
      const controller = new AbortController();
      examStatsRequestsRef.current.add(controller);
      examStatsApi
        .get(batch, { signal: controller.signal, quietAbort: true })
        .then((result) => result?.statsByExamId ?? null, () => null)
        .then((stats) => {
          examStatsRequestsRef.current.delete(controller);
          if (controller.signal.aborted) return;
          examStatsCache.resolve(batch, generation, stats);
          setExamStatsView((view) => ({ cache: view.cache }));
        });
    }
  }, [examStatsCache]);

  // Cards that come on screen together (a scroll, a filter) share one request.
  const requestExamStats = useCallback(() => {
    if (examStatsTimerRef.current === null) {
      examStatsTimerRef.current = setTimeout(sendExamStatsRequests, EXAM_STATS_COALESCE_MS);
    }
  }, [sendExamStatsRequests]);

  useEffect(() => {
    const requests = examStatsRequestsRef.current;
    const timer = examStatsTimerRef;
    return () => {
      if (timer.current !== null) clearTimeout(timer.current);
      timer.current = null;
      for (const controller of requests) controller.abort();
    };
  }, []);

  // Which cards or rows are on screen, or close to it.
  useEffect(() => {
    const visible = visibleExamIdsRef.current;
    visible.clear();
    const list = examListRef.current;
    const targets = list?.querySelectorAll<HTMLElement>("[data-exam-id]") ?? [];
    if (typeof IntersectionObserver === "undefined") {
      targets.forEach((target) => visible.add(target.dataset.examId || ""));
      requestExamStats();
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const examId = (entry.target as HTMLElement).dataset.examId;
          if (!examId) continue;
          if (entry.isIntersecting) visible.add(examId);
          else visible.delete(examId);
        }
        requestExamStats();
      },
      // The page scrolls inside its own panel; the margin loads the numbers
      // a little before a card scrolls into view.
      { root: scrollParentOf(list), rootMargin: "600px 0px" },
    );
    targets.forEach((target) => observer.observe(target));
    return () => observer.disconnect();
  }, [filteredExamIdsKey, viewMode, requestExamStats]);

  // A data change: the numbers on screen refresh now (the old ones stay until
  // the new ones arrive), the rest when they are scrolled to.
  const statsSyncKeyRef = useRef(syncKey);
  useEffect(() => {
    if (statsSyncKeyRef.current === syncKey) return;
    statsSyncKeyRef.current = syncKey;
    examStatsCache.invalidate();
    setExamStatsView((view) => ({ cache: view.cache }));
    requestExamStats();
  }, [syncKey, examStatsCache, requestExamStats]);

  // The delete and disable dialogs need their exam's count even off screen.
  useEffect(() => {
    dialogExamIdsRef.current = [deleteDialog.open ? deleteDialog.id : "", disableExamId || ""].filter(Boolean);
    requestExamStats();
  }, [deleteDialog.open, deleteDialog.id, disableExamId, requestExamStats]);

  const examStatValue = useCallback(
    (examId: string, key: keyof ExamRecordStat) => {
      const stat = examStatsView.cache.value(examId);
      if (stat) return stat[key];
      return examStatsView.cache.state(examId) === "missing" ? "—" : "…";
    },
    [examStatsView],
  );

  const examStatNumber = useCallback(
    (examId: string, key: keyof ExamRecordStat): number | null => {
      const value = examStatsView.cache.value(examId)?.[key];
      return typeof value === "number" && Number.isFinite(value) ? value : null;
    },
    [examStatsView],
  );

  // Deleting is decided on an up-to-date count only, never a stale one.
  const deleteGradeCount =
    deleteDialog.open && examStatsView.cache.state(deleteDialog.id) === "fresh"
      ? examStatNumber(deleteDialog.id, "total")
      : null;

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
      try {
        await loadFromServer();
      } catch {
        toast.warning("تم حفظ التعديل، لكن تعذر تحديث العرض. حدّث الصفحة لعرض النتيجة.");
      }
      // Notify all affected screens after the committed edit.
      emitTeacherProDataChanged({
        source: "local-mutation",
        reason,
        scopes: ["exams", "grades", "students", "dismissed", "opportunities", "follow-up", "dashboard"],
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

  const answerActivation = useCallback((confirmed: boolean) => {
    const answer = activationAnswerRef.current;
    activationAnswerRef.current = null;
    setActivationGradeCount(null);
    answer?.(confirmed);
  }, []);

  const askActivationConfirmation = useCallback((storedGradeCount: number) => {
    activationAnswerRef.current?.(false);
    setActivationGradeCount(storedGradeCount);
    return new Promise<boolean>((resolve) => {
      activationAnswerRef.current = resolve;
    });
  }, []);

  // Leaving the page with the question open counts as «إلغاء».
  useEffect(() => () => activationAnswerRef.current?.(false), []);

  const updateExamWithActivationConfirmation = useCallback(
    async (
      examId: string,
      patch: Record<string, unknown>,
      expectedToken?: string,
    ): Promise<ApiResult | null> => {
      const guardedPatch = {
        ...patch,
        expectedMutationToken:
          expectedToken ?? (examById.get(String(examId))?.mutationToken || ""),
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
        setEditingExamId(null);
        await loadFromServer();
      }
      return initialResult;
    }
    const storedGradeCount = Math.max(0, Number(conflict.storedGradeCount || 0));
    if (!(await askActivationConfirmation(storedGradeCount))) {
      return null;
    }
    const confirmedResult = await examApi.update(examId, {
      ...guardedPatch,
      activationPreviewToken: conflict.previewToken,
    });
      if (confirmedResult.status === 409) {
        if (Boolean((confirmedResult.data as { requiresFreshExam?: boolean } | null)?.requiresFreshExam)) {
          setEditingExamId(null);
        }
        await loadFromServer();
      }
      return confirmedResult;
    },
    [askActivationConfirmation, examById, loadFromServer],
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
    let result: ApiResult | null;
    try {
      result = await updateExamWithActivationConfirmation(editDialog.id, {
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
        telegramOpenAt: editDialog.telegramOpenAt,
        telegramCloseAt: editDialog.telegramCloseAt,
        ...statusPatch,
      }, editDialog.mutationToken);
    } catch {
      toast.error("تعذر إكمال الحفظ. حدّث البيانات وتحقق من النتيجة قبل إعادة المحاولة.");
      return;
    } finally {
      setExamMutating(editDialog.id, false);
    }

    if (!result) return;
    if (!result.ok || result.queued) {
      toast.error(result.error || "تعذر تعديل الامتحان.");
      return;
    }

    setEditingExamId(null);
    await refreshExamRecordsAfterMutation("exam-records-edit");
    toast.success("تم تعديل الامتحان وإعادة الاحتساب");
  };

  const openDeleteExamDialog = useCallback(
    (examId: string) => {
      const exam = examById.get(String(examId));
      const dependentCount =
        opportunityLogs.filter((log) => log.examId === examId).length +
        studentLeaves.filter((leave) => leave.examId === examId).length +
        studentCalls.filter((call) => call.examId === examId).length;
      setDeleteDialog({
        open: true,
        id: examId,
        name: exam?.name || "",
        dependentCount,
      });
    },
    [
      examById,
      opportunityLogs,
      studentCalls,
      studentLeaves,
    ],
  );

  const handleDeleteExam = runDeleteExamLocked(async () => {
    if (deleteGradeCount === null) {
      toast.error("انتظر اكتمال التحقق من سجلات الدرجات قبل الحذف.");
      return;
    }
    if (deleteGradeCount > 0) {
      toast.error(
        `لا يمكن حذف هذا الامتحان لأن عليه ${arabicCount(deleteGradeCount, "سجل درجات واحد", "سجلين درجات", "سجلات درجات", "سجل درجات")}. عطّل الامتحان بدلاً من حذفه.`,
      );
      return;
    }
    if (deleteDialog.dependentCount > 0) {
      toast.error(
        `لا يمكن حذف الامتحان لأنه مرتبط بـ ${arabicCount(deleteDialog.dependentCount, "سجل تابع واحد", "سجلين تابعين", "سجلات تابعة", "سجل تابع")}. عطّله بدلاً من حذفه حتى لا يضيع التاريخ.`,
      );
      return;
    }
    setExamMutating(deleteDialog.id, true);
    const result = await examApi.remove(deleteDialog.id);
    setExamMutating(deleteDialog.id, false);
    if (!result.ok || result.queued) {
      toast.error(result.error || "تعذر حذف الامتحان.");
      return;
    }
    setDeleteDialog({
      open: false,
      id: "",
      name: "",
      dependentCount: 0,
    });
    await refreshExamRecordsAfterMutation("exam-records-delete");
    toast.success("تم حذف الامتحان");
  });

  const handleToggleExamActive = useCallback(
    async (exam: Exam) => {
      const enabling = !exam.active;
      setExamMutating(exam.id, true);
      let result: ApiResult | null;
      try {
        result = await updateExamWithActivationConfirmation(exam.id, {
          active: enabling,
          scheduledActivateAt: "",
        });
      } catch {
        toast.error("تعذر إكمال تغيير حالة الامتحان. حدّث البيانات وتحقق من النتيجة.");
        return;
      } finally {
        setExamMutating(exam.id, false);
      }
      if (!result) return;
      if (!result.ok || result.queued) {
        toast.error(result.error || "تعذر تغيير حالة الامتحان.");
        return;
      }
      await refreshExamRecordsAfterMutation(
        exam.active ? "exam-records-disable" : "exam-records-enable",
      );
      toast.success(
        exam.active
          ? "تم تعطيل الامتحان"
          : "تم تفعيل الامتحان",
      );
    },
    [refreshExamRecordsAfterMutation, setExamMutating, updateExamWithActivationConfirmation],
  );

  // Enabling goes straight on (the server asks when stored grades would start
  // to count); disabling first says what stops counting.
  const requestToggleExamActive = useCallback(
    (exam: Exam) => {
      if (exam.active) {
        setDisableExamId(exam.id);
        return;
      }
      void handleToggleExamActive(exam);
    },
    [handleToggleExamActive],
  );
  const disableExam = disableExamId ? examById.get(String(disableExamId)) || null : null;

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
            onToggleActive={requestToggleExamActive}
            onEdit={openEditExamDialog}
            onDelete={openDeleteExamDialog}
            buildExamExportRows={buildExamExportRows}
          />
        );
      })}
      {filteredExams.length === 0 && (
        <EmptyState className="xl:col-span-2" title="ماكو امتحانات مطابقة للفلاتر." />
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
                onToggleActive={requestToggleExamActive}
                onEdit={openEditExamDialog}
                onDelete={openDeleteExamDialog}
                buildExamExportRows={buildExamExportRows}
              />
            );
          })}
          {filteredExams.length === 0 && (
            <tr>
              <td colSpan={9} className="p-8 text-center text-muted-foreground">
                ماكو امتحانات مطابقة للفلاتر.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );

  return (
    <div className="tp-exam-records-page tp-list">
      <ListToolbar
        label="البحث والتصفية في سجل الامتحانات"
        search={
          <Input
            id="exam-records-search"
            name="search"
            data-teacherpro-search="true"
            autoComplete="off"
            aria-label="بحث في الامتحانات"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="اسم الامتحان أو التاريخ أو الدورة"
          />
        }
        chips={[
          { key: "", label: "الكل", count: statusChipCounts.all },
          { key: "نشط", label: "نشط", tone: "success", count: statusChipCounts.active },
          ...(statusChipCounts.scheduled || filterStatus === "تفعيل مجدول"
            ? [{ key: "تفعيل مجدول", label: "تفعيل مجدول", tone: "info" as const, count: statusChipCounts.scheduled }]
            : []),
          { key: "معطل", label: "معطّل", tone: "muted", count: statusChipCounts.disabled },
        ]}
        chipsLabel="حالة الامتحان"
        activeChip={filterStatus}
        onChipChange={(value) => setFilterStatus(value as ExamStatusLabel | "")}
        activeFilterCount={Number(Boolean(filterCourseId)) + Number(Boolean(filterType))}
        activeFilters={[
          ...(filterCourseId
            ? [{ key: "course", label: `الدورة: ${courses.find((course) => course.id === filterCourseId)?.name || "—"}`, onClear: () => setFilterCourseId("") }]
            : []),
          ...(filterType
            ? [{ key: "type", label: `النوع: ${filterType}`, onClear: () => setFilterType("") }]
            : []),
        ]}
        onClearFilters={() => {
          setFilterCourseId("");
          setFilterType("");
        }}
        filters={
          <>
            <div className="space-y-1.5">
              <Label htmlFor="exam-records-course" className="text-xs font-bold">
                اسم الدورة
              </Label>
              <Select
                value={filterCourseId || "all"}
                onValueChange={(v) => setFilterCourseId(v === "all" ? "" : v)}
              >
                <SelectTrigger id="exam-records-course">
                  <SelectValue placeholder="كل الدورات" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">كل الدورات</SelectItem>
                  {courses.map((course) => (
                    <SelectItem key={course.id} value={course.id}>
                      {course.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="exam-records-type" className="text-xs font-bold">
                نوع الامتحان
              </Label>
              <Select
                value={filterType || "all"}
                onValueChange={(v) => setFilterType(v === "all" ? "" : v)}
              >
                <SelectTrigger id="exam-records-type">
                  <SelectValue placeholder="كل الأنواع" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">كل الأنواع</SelectItem>
                  <SelectItem value="يومي">يومي</SelectItem>
                  <SelectItem value="تراكمي">تراكمي</SelectItem>
                  <SelectItem value="فاينل">فاينل</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="exam-records-view" className="text-xs font-bold">
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
          </>
        }
        summary={
          <>
            المعروض <b>{filteredExams.length}</b> من <b>{exams.length}</b>
          </>
        }
      />

      <div ref={examListRef}>
        {viewMode === "cards" ? renderCards() : renderTable()}
      </div>

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
        open={Boolean(disableExam)}
        onOpenChange={(open) => {
          if (!open) setDisableExamId(null);
        }}
      >
        <AlertDialogContent dir="rtl">
          <AlertDialogHeader>
            <AlertDialogTitle>تعطيل «{disableExam?.name}»؟</AlertDialogTitle>
            <AlertDialogDescription>
              يختفي من تسجيل الدرجات، ودرجاته المحفوظة
              {disableExam ? ` (${examStatNumber(disableExam.id, "total") ?? "…"} سجل)` : ""} تبقى بس
              ما تأثر على الفرص لحد ما ترجع تفعّله.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>إلغاء</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                const exam = disableExam;
                setDisableExamId(null);
                if (exam) void handleToggleExamActive(exam);
              }}
            >
              تعطيل الامتحان
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={activationGradeCount !== null}
        onOpenChange={(open) => {
          if (!open) answerActivation(false);
        }}
      >
        <AlertDialogContent dir="rtl">
          <AlertDialogHeader>
            <AlertDialogTitle>تفعيل امتحان عليه درجات محفوظة؟</AlertDialogTitle>
            <AlertDialogDescription>
              تنبيه: الامتحان مرتبط بـ {activationGradeCount ?? 0} درجة محفوظة، وقد تصبح مؤثرة عند
              التفعيل. هل راجعت هذا الأثر وتؤكد المتابعة؟
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>إلغاء</AlertDialogCancel>
            <AlertDialogAction onClick={() => answerActivation(true)}>
              تأكيد التفعيل
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

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
                  dependentCount: 0,
                },
          )
        }
      >
        <AlertDialogContent dir="rtl">
          <AlertDialogHeader>
            <AlertDialogTitle>حذف «{deleteDialog.name}»؟</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm text-muted-foreground">
                {deleteGradeCount === null ? (
                  <p className="rounded-lg border border-warning-line border-s-4 border-s-warning-vivid bg-warning-soft p-3 font-semibold text-warning">
                    جاري التحقق من السجلات المرتبطة بالامتحان...
                  </p>
                ) : deleteGradeCount > 0 ? (
                  <p className="rounded-lg border border-danger-line border-s-4 border-s-danger-vivid bg-danger-soft p-3 font-semibold text-danger">
                    لا يمكن حذف امتحان عليه درجات. يوجد{" "}
                    {deleteGradeCount} سجل درجات مرتبط بهذا الامتحان.
                    استخدم التعطيل إذا كان الهدف إيقاف ظهوره في إدخال الدرجات.
                  </p>
                ) : deleteDialog.dependentCount > 0 ? (
                  <p className="rounded-lg border border-danger-line border-s-4 border-s-danger-vivid bg-danger-soft p-3 font-semibold text-danger">
                    لا يمكن حذف هذا الامتحان لأنه مرتبط بـ{" "}
                    {deleteDialog.dependentCount} سجل تابع مثل إجازات أو مكالمات
                    أو مكالمات أو سجلات فرص. عطّل الامتحان بدل حذفه حتى لا يضيع
                    التاريخ.
                  </p>
                ) : (
                  <p>
                    ما عليه درجات ولا سجلات تابعة، فينحذف الامتحان نهائياً.
                    هذا ما يتراجع عنه.
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
                deleteGradeCount === null ||
                Number(deleteGradeCount) > 0 ||
                deleteDialog.dependentCount > 0
              }
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isDeletingExam
                ? "جاري الحذف..."
                : deleteGradeCount === null
                  ? "جاري التحقق..."
                  : Number(deleteGradeCount) > 0 ||
                      deleteDialog.dependentCount > 0
                    ? "الحذف ممنوع"
                    : "حذف الامتحان"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
