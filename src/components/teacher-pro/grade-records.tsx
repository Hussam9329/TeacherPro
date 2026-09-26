"use client";
import { useTeacherProBackgroundSyncDetector, useTeacherProSyncKey } from "@/hooks/use-teacherpro-sync";

import { useEffect, useMemo, useState } from "react";
import { useTeacherStore, type Grade, type Student } from "@/lib/teacher-store";
import {
  gradeApi,
  gradeCoverageStatsApi,
  type GradeCoverageStatsResponse,
  type GradeStudentListResponse,
  type GradeStudentSummary,
} from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";

import { ExportDialog, type ExportColumn } from "./export-dialog";
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
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "@/lib/user-toast";
import { formatAppDate } from "@/lib/format";
import { toLatinDigits } from "@/lib/format";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import {
  formatGradeScore,
  getExamEntryAvailability,
  normalizeScore,
} from "@/lib/exam-utils";
import { emitTeacherProDataChanged } from "@/lib/teacherpro-sync";
import { LEGACY_GRACE_PLACEHOLDER_STATUS } from "@/lib/academic-types";
import { useActionLock } from "@/hooks/use-action-lock";
import { applyOpportunityPenalty } from "@/lib/opportunity-balance";
import {
  AlertCircle,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Loader2,
  PenLine,
  RotateCcw,
  UserX,
} from "lucide-react";

import { GradeNoteBanner } from "@/components/teacher-pro/grade-note-banner";
import { resolveGradeNoteBanner } from "@/lib/grade-note-banners";
import { CountScopeSummary } from "./ui-kit";
import {
  examMatchesAcademicFilters,
  getAcademicCourseProgramFilterOptions,
  getAcademicStudyTypeFilterOptions,
} from "@/lib/filter-sequence";
import { STUDENT_FILTER_COURSE_TERMS } from "@/lib/student-list-filters";
import {
  gradeStatusFilterLabels,
  gradeStatusFilterOptions,
  type GradeStatusFilter,
} from "@/lib/grade-status-filters";
import {
  LEAVE_END_CONFIRMATION_MESSAGE,
  LEAVE_END_CONFIRMATION_REQUIRED_CODE,
} from "@/lib/grade-leave-safety";
import "./tp-modal.css";
import "./grade-records.css";

type GradeStatus = "درجة" | "غائب" | "غش" | "مجاز";
type HydratedGrade = Grade & { student?: Student; exam?: unknown };
type StudentGradesTab = "all" | "numeric" | "absent";

type GradeExportRow = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  grade: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  student: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  exam: any;
  classificationText: string;
  statusText?: string;
};

const englishNumberFormatter = new Intl.NumberFormat("en-US");
const formatEnglishNumber = (value: number) =>
  englishNumberFormatter.format(value);

// The retired grace placeholder is not a result: show it as nothing recorded.
function gradeRecordStatusText(status: string | null | undefined): string {
  return status === LEGACY_GRACE_PLACEHOLDER_STATUS ? "" : String(status || "");
}

function gradeRecordScoreText(grade: Grade, exam: Parameters<typeof formatGradeScore>[1]): string {
  return grade.status === LEGACY_GRACE_PLACEHOLDER_STATUS ? "—" : formatGradeScore(grade, exam, "—");
}

function serverStatusForGradeFilter(
  filter: GradeStatusFilter,
): GradeStatus | undefined {
  if (filter === "absent") return "غائب";
  if (filter === "cheating") return "غش";
  return undefined;
}

/** Badge variant for a classification result. */
function classificationVariant(type: string | undefined) {
  if (type === "ok") return "success" as const;
  if (type === "danger") return "destructive" as const;
  if (type === "warn") return "warning" as const;
  return "outline" as const;
}

function examDateKey(exam: unknown): number {
  const date = new Date(String((exam as { date?: string } | undefined)?.date || ""));
  return Number.isFinite(date.getTime()) ? date.getTime() : 0;
}

/** ملاحظات التسوية التاريخية («بلا أثر») لا تُعرض في بطاقة الدرجات — إزالة بطلب صاحب النظام. */
const SETTLEMENT_NOTES_PREFIX = "تسوية تاريخية بلا أثر:";

/**
 * بانرات لا تُعرض في البطاقة: مكررة مع لون حبة النتيجة أو أزيلت بطلب صاحب النظام
 * (الإجازة · قبل التسجيل · فترة السماح — والغياب الجماعي أزيل من القاموس نفسه).
 */
const HIDDEN_BANNER_KEYS = new Set([
  "excused",
  "before-registration",
  "grace",
]);

function bannerVisibleInCard(notes: string | null | undefined): boolean {
  const raw = (notes ?? "").trim();
  if (!raw || raw.startsWith(SETTLEMENT_NOTES_PREFIX)) return false;
  const banner = resolveGradeNoteBanner(raw);
  if (banner && HIDDEN_BANNER_KEYS.has(banner.key)) return false;
  return true;
}

/**
 * الشارات النتيجية أُزيلت — لون حبة النتيجة يلخّص الحالة.
 * تبقى فقط الشارات التي تضيف معلومة غير ظاهرة من اللون.
 */
const VISIBLE_RESULT_BADGES = new Set(["فصل", "غير مسجل", "غير محتسب", "بدون خصم"]);

type ScorePillTone =
  | "pass"
  | "fail-light"
  | "fail-dark"
  | "excused"
  | "sky"
  | "grace"
  | "neutral";

/**
 * حبة النتيجة: نص ولون واحد لكل حالة — بدون تكرار (طلب صاحب النظام):
 * ناجح أخضر · راسب/بدون خصم أحمر فاتح · مخصوم/فصل أحمر طوخ ·
 * مجاز أصفر · قبل التسجيل سمائي · فترة السماح بنفسجي.
 *
 * إصلاح: أي صف حالته «مجاز» يبقى أصفر حتى لو سقط تصنيفه بفرع التسوية
 * التاريخية («بلا أثر» لامتحانات الفصول السابقة) — كان يعرض أبيض.
 */
function scorePillPresentation(
  grade: Grade,
  exam: Parameters<typeof gradeRecordScoreText>[1],
  cls: { text: string; kind: string },
): { text: string; tone: ScorePillTone } {
  const status = String(grade.status || "");
  if (cls.text === "مجاز" || status === "مجاز")
    return { text: "مجاز", tone: "excused" };
  if (cls.kind === "grace") {
    return status === "درجة"
      ? { text: gradeRecordScoreText(grade, exam), tone: "grace" }
      : { text: "فترة سماح", tone: "grace" };
  }
  if (status === "قبل تسجيل الطالب" || cls.kind === "before-registration")
    return { text: "قبل التسجيل", tone: "sky" };
  if (status === "درجة") {
    const text = gradeRecordScoreText(grade, exam);
    if (cls.text === "مخصوم" || cls.text === "فصل") return { text, tone: "fail-dark" };
    if (cls.text === "راسب" || cls.text === "بدون خصم") return { text, tone: "fail-light" };
    if (cls.text === "ناجح") return { text, tone: "pass" };
    return { text, tone: "neutral" };
  }
  if (status === "غائب") return { text: "غائب", tone: "neutral" };
  if (status === "غش") return { text: "غش", tone: "neutral" };
  return { text: gradeRecordStatusText(status) || "—", tone: "neutral" };
}

const STUDENT_GRADES_TABS: Array<{ value: StudentGradesTab; label: string; tone?: "success" | "danger" }> = [
  { value: "all", label: "كل الدرجات" },
  { value: "numeric", label: "الدرجة الرقمية", tone: "success" },
  { value: "absent", label: "الغياب", tone: "danger" },
];

const gradeExportColumns: ExportColumn<GradeExportRow>[] = [
  {
    key: "student",
    label: "الطالب",
    value: ({ student }) => student?.name || "",
  },
  { key: "code", label: "الكود", value: ({ student }) => student?.code || "" },
  {
    key: "telegram",
    label: "التيليجرام",
    value: ({ student }) => student?.telegram || "",
  },
  {
    key: "username",
    label: "يوزر تيليجرام",
    value: ({ student }) => student?.username || "",
  },
  { key: "exam", label: "الامتحان", value: ({ exam }) => exam?.name || "" },
  {
    key: "status",
    label: "الحالة",
    value: ({ grade, statusText }) => gradeRecordStatusText(statusText || grade?.status),
  },
  {
    key: "score",
    label: "درجة الطالب",
    value: ({ grade }) =>
      grade?.status === "درجة" ? (normalizeScore(grade.score) ?? "") : "",
  },
  {
    key: "fullMark",
    label: "الدرجة الكاملة",
    value: ({ exam }) => {
      const fullMark = Number(exam?.fullMark);
      return Number.isFinite(fullMark) ? fullMark : "";
    },
  },
  {
    key: "accounting",
    label: "الإجراء الحالي / المتوقع",
    value: ({ classificationText }) => classificationText,
  },
  { key: "notes", label: "ملاحظات", value: ({ grade }) => grade?.notes || "" },
];

/** One student in the grade records: counts over the whole record. */
function GradeStudentCard({
  summary,
  courseName,
  onOpen,
}: {
  summary: GradeStudentSummary;
  courseName: string;
  onOpen: () => void;
}) {
  const student = summary.student as unknown as Student;
  const dismissed = student.status === "مفصول";
  const latest = summary.latestGrade;
  const latestResult = latest
    ? latest.status === "درجة"
      ? `${latest.score ?? "—"} / ${latest.exam?.fullMark ?? "—"}`
      : gradeRecordStatusText(latest.status) || "—"
    : "";
  return (
    <li className="tp-grade-student" data-dismissed={dismissed || undefined}>
      <div className="tp-grade-student__head">
        <div className="tp-grade-student__identity">
          <h3 id={`grade-student-${student.id}`}>{student.name}</h3>
          <p className="text-xs text-muted-foreground">
            <bdi>{student.code}</bdi>
            {courseName ? ` · ${courseName}` : ""}
          </p>
        </div>
        <Badge
          variant={dismissed ? "destructive" : student.status === "نشط" ? "success" : "secondary"}
          className="shrink-0"
        >
          {dismissed && <UserX aria-hidden="true" />}
          {student.status}
        </Badge>
      </div>

      <dl className="tp-grade-student__counts" aria-label={`ملخص درجات ${student.name}`}>
        <div data-tone="info">
          <dt>الامتحانات</dt>
          <dd>{formatEnglishNumber(summary.totalExams)}</dd>
        </div>
        <div data-tone="success">
          <dt>بدرجة</dt>
          <dd>{formatEnglishNumber(summary.numericCount)}</dd>
        </div>
        <div data-tone="danger">
          <dt>غياب</dt>
          <dd>{formatEnglishNumber(summary.absentCount)}</dd>
        </div>
        {summary.cheatingCount > 0 && (
          <div data-tone="warning">
            <dt>غش</dt>
            <dd>{formatEnglishNumber(summary.cheatingCount)}</dd>
          </div>
        )}
      </dl>

      {latest?.exam && (
        <p className="tp-grade-student__latest">
          <span className="text-muted-foreground">آخر امتحان:</span>{" "}
          <b>{latest.exam.name}</b>
          <span className="text-muted-foreground"> · {formatAppDate(latest.exam.date)} · </span>
          <b dir={latest.status === "درجة" ? "ltr" : undefined} className="tabular-nums">{latestResult}</b>
        </p>
      )}

      <Button
        type="button"
        className="tp-grade-student__open"
        onClick={onOpen}
        aria-describedby={`grade-student-${student.id}`}
      >
        <ClipboardList className="size-4" aria-hidden="true" />
        عرض درجات الطالب
      </Button>
    </li>
  );
}

export function GradeRecordsView() {
  const {
    grades,
    exams,
    students,
    courses,
    opportunityLogs,
    classification,
    mergeStudentsCache,
    mergeGradesCache,
    setSection,
  } = useTeacherStore();

  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search, 180);
  const [filterExamId, setFilterExamId] = useState("");
  const [filterStatus, setFilterStatus] = useState<GradeStatusFilter>("all");
  const [filterCourseId, setFilterCourseId] = useState("");
  const [filterCourseProgram, setFilterCourseProgram] = useState("");
  const [filterCourseTerm, setFilterCourseTerm] = useState("");
  const [filterStudyType, setFilterStudyType] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [studentList, setStudentList] = useState<GradeStudentListResponse | null>(null);
  const [studentListLoading, setStudentListLoading] = useState(false);
  const [studentListError, setStudentListError] = useState<string | null>(null);
  const [systemGradeCoverageStats, setSystemGradeCoverageStats] =
    useState<GradeCoverageStatsResponse | null>(null);
  const [serverRefreshKey, setServerRefreshKey] = useState(0);
  const syncKey = useTeacherProSyncKey(["grades", "students", "exams", "opportunities", "dashboard"]);
  const isBackgroundSync = useTeacherProBackgroundSyncDetector(syncKey);

  // «عرض درجات الطالب»: every grade of one student, newest exam first.
  const [openSummary, setOpenSummary] = useState<GradeStudentSummary | null>(null);
  const [studentGrades, setStudentGrades] = useState<HydratedGrade[] | null>(null);
  const [studentGradesLoading, setStudentGradesLoading] = useState(false);
  const [studentGradesError, setStudentGradesError] = useState<string | null>(null);
  const [studentGradesTab, setStudentGradesTab] = useState<StudentGradesTab>("all");

  const [deleteDialog, setDeleteDialog] = useState({
    open: false,
    id: "",
    label: "",
  });
  const [editDialog, setEditDialog] = useState({
    open: false,
    id: "",
    status: "درجة" as GradeStatus,
    score: "",
    notes: "",
  });
  const [reactivationEditConfirmOpen, setReactivationEditConfirmOpen] =
    useState(false);
  const [leaveEndEditConfirmOpen, setLeaveEndEditConfirmOpen] = useState(false);
  const { locked: isDeletingGrade, runLocked: runDeleteGradeLocked } =
    useActionLock();

  const hasActiveFilters = Boolean(
    search ||
      filterExamId ||
      filterStatus !== "all" ||
      filterCourseId ||
      filterCourseProgram ||
      filterCourseTerm ||
      filterStudyType,
  );

  const resetFilters = () => {
    setSearch("");
    setFilterExamId("");
    setFilterStatus("all");
    setFilterCourseId("");
    setFilterCourseProgram("");
    setFilterCourseTerm("");
    setFilterStudyType("");
    setPage(1);
  };

  useEffect(() => {
    setPage(1);
  }, [
    debouncedSearch,
    filterExamId,
    filterStatus,
    filterCourseId,
    filterCourseProgram,
    filterCourseTerm,
    filterStudyType,
  ]);

  // Students with grades, one card each, newest activity first.
  useEffect(() => {
    const controller = new AbortController();
    const silent = isBackgroundSync();
    if (!silent) setStudentListLoading(true);
    if (!silent) setStudentListError(null);

    gradeApi
      .listByStudent(
        {
          examId: filterExamId || undefined,
          statusFilter: filterStatus,
          q: debouncedSearch || undefined,
          courseId: filterCourseId || undefined,
          courseProgram: filterCourseProgram || undefined,
          courseTerm:
            filterCourseProgram === "كورسات" && filterCourseTerm
              ? filterCourseTerm
              : undefined,
          studyType: filterStudyType || undefined,
          page,
          pageSize,
        },
        { signal: controller.signal, quietAbort: true },
      )
      .then((result) => {
        if (controller.signal.aborted) return;
        if (!result) {
          if (!silent) {
            setStudentList(null);
            setStudentListError("تعذر تحميل سجل الدرجات. تحقق من الاتصال ثم أعد المحاولة.");
          }
          return;
        }
        setStudentList(result);
        const related = result.students.map((entry) => entry.student) as unknown as Student[];
        if (related.length) mergeStudentsCache(related);
        const nextTotalPages = Math.max(1, Number(result.totalPages || 1));
        if (page > nextTotalPages) setPage(nextTotalPages);
      })
      .catch(() => {
        if (controller.signal.aborted || silent) return;
        setStudentList(null);
        setStudentListError("تعذر تحميل سجل الدرجات. تحقق من الاتصال ثم أعد المحاولة.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setStudentListLoading(false);
      });

    return () => controller.abort();
  }, [
    debouncedSearch,
    filterExamId,
    filterStatus,
    filterCourseId,
    filterCourseProgram,
    filterCourseTerm,
    filterStudyType,
    page,
    pageSize,
    serverRefreshKey,
    syncKey,
    mergeStudentsCache,
    isBackgroundSync,
  ]);

  useEffect(() => {
    const controller = new AbortController();
    gradeCoverageStatsApi
      .get({}, { signal: controller.signal, quietAbort: true })
      .then((result) => {
        if (!controller.signal.aborted) setSystemGradeCoverageStats(result);
      })
      .catch(() => {
        if (!controller.signal.aborted) setSystemGradeCoverageStats(null);
      });
    return () => controller.abort();
  }, [serverRefreshKey, syncKey]);

  // Every grade of the open student (all exams), newest exam first.
  const openStudentId = openSummary ? String(openSummary.student.id || "") : "";
  useEffect(() => {
    if (!openStudentId) return;
    const controller = new AbortController();
    const silent = isBackgroundSync();
    if (!silent) setStudentGradesLoading(true);
    if (!silent) setStudentGradesError(null);
    gradeApi
      .list(
        { studentId: openStudentId, page: 1, pageSize: 500 },
        { signal: controller.signal, quietAbort: true },
      )
      .then((result) => {
        if (controller.signal.aborted) return;
        if (!result) {
          if (!silent) {
            setStudentGrades(null);
            setStudentGradesError(
              "تعذر تحميل درجات الطالب. التعديل والحذف غير متاحين حتى عودة الاتصال.",
            );
          }
          return;
        }
        const loaded = ((result.grades || []) as unknown as HydratedGrade[])
          .filter((grade) => grade.status !== LEGACY_GRACE_PLACEHOLDER_STATUS)
          .sort((a, b) => {
            const diff = examDateKey(b.exam) - examDateKey(a.exam);
            return diff !== 0 ? diff : String(b.updatedAt || "").localeCompare(String(a.updatedAt || ""));
          });
        setStudentGrades(loaded);
        mergeGradesCache(loaded as unknown as Grade[]);
      })
      .catch(() => {
        if (controller.signal.aborted || silent) return;
        setStudentGrades(null);
        setStudentGradesError(
          "تعذر تحميل درجات الطالب. التعديل والحذف غير متاحين حتى عودة الاتصال.",
        );
      })
      .finally(() => {
        if (!controller.signal.aborted) setStudentGradesLoading(false);
      });
    return () => controller.abort();
  }, [openStudentId, serverRefreshKey, syncKey, mergeGradesCache, isBackgroundSync]);

  const openStudentGrades = (summary: GradeStudentSummary) => {
    setStudentGrades(null);
    setStudentGradesError(null);
    setStudentGradesTab("all");
    setOpenSummary(summary);
  };

  const canRunGradeRecordActions = !studentGradesError && studentGrades !== null;

  const gradeForAction = (gradeId: string) =>
    (studentGrades || []).find((item) => item.id === gradeId) ||
    grades.find((item) => item.id === gradeId);

  const updateServerGradeRow = (gradeId: string, patch: Partial<Grade>) => {
    setStudentGrades((current) =>
      current
        ? current.map((grade) =>
            grade.id === gradeId ? { ...grade, ...patch } : grade,
          )
        : current,
    );
  };

  const refreshGradeRecordsAfterMutation = (reason: string) => {
    setServerRefreshKey((key) => key + 1);
    emitTeacherProDataChanged({
      source: "local-mutation",
      reason,
      scopes: ["grades", "students", "opportunities", "dashboard"],
    });
  };

  const studentHasManualReactivation = (studentId: string) =>
    opportunityLogs.some(
      (log) => log.studentId === studentId && log.action === "إعادة تفعيل",
    );

  const examPenaltyAmount = (
    exam: NonNullable<(typeof exams)[number]>,
    studentOpportunities: number,
  ) => {
    if (exam.noDiscount) return 0;
    if (exam.type === "فاينل")
      return Math.max(1, studentOpportunities);
    return Math.max(0, Number(exam.opportunitiesPenalty || 0));
  };

  const editMayReturnReactivatedStudentToDismissal = (
    studentId: string,
    gradeId: string,
    status: GradeStatus,
    score: number | null,
    notes: string,
  ) => {
    const grade = gradeForAction(gradeId);
    const exam = grade ? exams.find((item) => item.id === grade.examId) : null;
    const student = students.find((item) => item.id === studentId);
    if (!grade || !exam || !student || !studentHasManualReactivation(studentId))
      return false;

    const nextGrade = {
      ...grade,
      status,
      score,
      notes,
      updatedAt: new Date().toISOString(),
    };
    const result = classification(nextGrade, exam, student);

    if (result.kind === "dismissal" || result.kind === "cheat") return true;
    if (result.kind === "deducted") {
      const remainingOpportunities = Math.max(
        0,
        Number(student.opportunities || 0),
      );
      return applyOpportunityPenalty(
        remainingOpportunities,
        examPenaltyAmount(exam, remainingOpportunities),
      ).dismissalTrigger;
    }
    return false;
  };

  const editNeedsReactivationWarning = (
    studentId: string,
    gradeId: string,
    status: GradeStatus,
    score: number | null,
    notes: string,
  ) =>
    editMayReturnReactivatedStudentToDismissal(
      studentId,
      gradeId,
      status,
      score,
      notes,
    );

  const courseNameById = useMemo(
    () => new Map(courses.map((course) => [course.id, course.name])),
    [courses],
  );

  const studentById = useMemo(() => {
    const map = new Map(students.map((student) => [student.id, student]));
    studentList?.students.forEach((entry) => {
      const student = entry.student as unknown as Student;
      if (student?.id) map.set(student.id, student);
    });
    return map;
  }, [students, studentList]);

  const availableProgramsForFilter = useMemo(
    () =>
      getAcademicCourseProgramFilterOptions(
        courses,
        { courseId: filterCourseId },
        students,
      ),
    [courses, students, filterCourseId],
  );

  const availableStudyTypesForFilter = useMemo(
    () =>
      getAcademicStudyTypeFilterOptions(
        courses,
        { courseId: filterCourseId, courseProgram: filterCourseProgram },
        students,
      ),
    [courses, students, filterCourseId, filterCourseProgram],
  );

  useEffect(() => {
    if (
      filterCourseProgram &&
      !availableProgramsForFilter.includes(filterCourseProgram as any)
    ) {
      setFilterCourseProgram("");
      return;
    }
    if (filterCourseProgram !== "كورسات" && filterCourseTerm) {
      setFilterCourseTerm("");
    }
    if (
      filterStudyType &&
      !availableStudyTypesForFilter.includes(filterStudyType as any)
    ) {
      setFilterStudyType("");
    }
  }, [
    filterCourseProgram,
    filterCourseTerm,
    filterStudyType,
    availableProgramsForFilter,
    availableStudyTypesForFilter,
  ]);

  const filteredExamOptions = useMemo(
    () =>
      exams
        .filter((exam) =>
          examMatchesAcademicFilters(
            exam,
            {
              courseId: filterCourseId,
              courseProgram: filterCourseProgram,
              courseTerm: filterCourseTerm,
              studyType: filterStudyType,
            },
            { courses, students },
          ),
        )
        .sort((a, b) => examDateKey(b) - examDateKey(a)),
    [
      exams,
      courses,
      students,
      filterCourseId,
      filterCourseProgram,
      filterCourseTerm,
      filterStudyType,
    ],
  );

  useEffect(() => {
    if (
      filterExamId &&
      !filteredExamOptions.some((exam) => exam.id === filterExamId)
    ) {
      setFilterExamId("");
    }
  }, [filterExamId, filteredExamOptions]);

  const examById = useMemo(() => {
    const map = new Map(exams.map((exam) => [exam.id, exam]));
    studentGrades?.forEach((grade) => {
      const exam = grade.exam as (typeof exams)[number] | undefined;
      if (exam?.id) map.set(exam.id, exam);
    });
    return map;
  }, [exams, studentGrades]);

  const statValue = (value: number | undefined) =>
    value === undefined ? "…" : formatEnglishNumber(value);
  const listTotals = studentList?.totals;
  const summaries = studentList?.students ?? [];
  const filteredTotalCount = studentList?.totalCount ?? 0;
  const totalPages = Math.max(1, studentList?.totalPages ?? 1);

  const openStudent = openSummary ? (openSummary.student as unknown as Student) : null;
  const tabCounts = useMemo(() => {
    const rows = studentGrades || [];
    return {
      all: rows.length,
      numeric: rows.filter((grade) => grade.status === "درجة").length,
      absent: rows.filter((grade) => grade.status === "غائب").length,
    };
  }, [studentGrades]);
  const visibleStudentGrades = (studentGrades || []).filter((grade) =>
    studentGradesTab === "numeric"
      ? grade.status === "درجة"
      : studentGradesTab === "absent"
        ? grade.status === "غائب"
        : true,
  );

  const openEditGradeDialog = (gradeId: string) => {
    if (!canRunGradeRecordActions) {
      toast.error("انتظر تحميل سجل الدرجات قبل تعديل الدرجة.");
      return;
    }
    const grade = gradeForAction(gradeId);
    if (!grade) return;
    if (grade.status === "قبل تسجيل الطالب") {
      toast.info("هذا الامتحان يسبق تسجيل الطالب ولا يقبل درجة أو غياباً.");
      return;
    }
    setEditDialog({
      open: true,
      id: grade.id,
      status:
        (grade.status as string) === "مجاز"
          ? "غائب"
          : (grade.status as string) === LEGACY_GRACE_PLACEHOLDER_STATUS
            ? "درجة"
          : (grade.status as string) === "قبل تسجيل الطالب"
            ? "درجة"
          : (grade.status as GradeStatus),
      score:
        grade.score !== null && grade.score !== undefined
          ? String(grade.score)
          : "",
      notes: grade.notes || "",
    });
  };

  const validateEditDialogScore = () => {
    const grade = gradeForAction(editDialog.id);
    const exam = grade ? examById.get(grade.examId) : null;
    if (!grade || !exam) return null;

    // A non-«درجة» status never carries a score: a typed number is dropped
    // here, and the user is told why the saved row has no score.
    const rawScore =
      editDialog.status === "درجة"
        ? Number(toLatinDigits(editDialog.score))
        : null;

    if (
      editDialog.status === "درجة" &&
      (!Number.isFinite(rawScore) ||
        rawScore === null ||
        rawScore < 0 ||
        rawScore > exam.fullMark ||
        !Number.isInteger(rawScore))
    ) {
      toast.error(`الدرجة يجب أن تكون عدداً صحيحاً بين 0 و ${exam.fullMark} بدون كسور`);
      return null;
    }

    if (
      editDialog.status !== "درجة" &&
      grade.score !== null &&
      grade.score !== undefined &&
      toLatinDigits(editDialog.score).trim() !== ""
    ) {
      toast.info(
        `سيتم مسح الدرجة المحفوظة (${grade.score}) لأن الحالة الجديدة «${editDialog.status}» لا تقبل رقماً.`,
      );
    }

    return { grade, score: rawScore };
  };

  const saveEditGradeUnchecked = async (
    options: { confirmLeaveEnd?: boolean } = {},
  ) => {
    if (!canRunGradeRecordActions) {
      toast.error("انتظر تحميل سجل الدرجات قبل تعديل الدرجة.");
      return;
    }
    const validated = validateEditDialogScore();
    if (!validated) return;
    const { grade, score } = validated;

    const result = await gradeApi.update(editDialog.id, {
      status: editDialog.status,
      score,
      notes: editDialog.notes,
      expectedUpdatedAt: grade.updatedAt || "",
      confirmEndLeave: options.confirmLeaveEnd === true,
    });

    if (!result.ok || result.queued) {
      const errorPayload = (result.data || {}) as { code?: string };
      if (
        !result.queued &&
        errorPayload.code === LEAVE_END_CONFIRMATION_REQUIRED_CODE &&
        !options.confirmLeaveEnd
      ) {
        setLeaveEndEditConfirmOpen(true);
        return;
      }
      if (result.status === 409) setServerRefreshKey((key) => key + 1);
      toast.error(result.error || "تعذر تعديل الدرجة.");
      return;
    }

    const updatedGrade =
      ((result.data as { grade?: Grade } | null)?.grade as Grade | undefined) ||
      ({
        ...grade,
        status: editDialog.status,
        score,
        notes: editDialog.notes,
      } as Grade);

    updateServerGradeRow(editDialog.id, updatedGrade);
    mergeGradesCache([updatedGrade]);

    setEditDialog({
      open: false,
      id: "",
      status: "درجة",
      score: "",
      notes: "",
    });
    refreshGradeRecordsAfterMutation("grade-records-edit");
    const payload = (result.data || {}) as { leaveEndedByGrade?: boolean };
    toast.success(
      payload.leaveEndedByGrade
        ? "تم اعتماد الدرجة وإنهاء الإجازة وإعادة احتساب الطالب."
        : "تم تعديل الدرجة وإعادة الاحتساب",
    );
  };

  const handleSaveEditGrade = () => {
    const validated = validateEditDialogScore();
    if (!validated) return;
    const { grade, score } = validated;
    if (
      editNeedsReactivationWarning(
        grade.studentId,
        grade.id,
        editDialog.status,
        score,
        editDialog.notes,
      )
    ) {
      setReactivationEditConfirmOpen(true);
      return;
    }
    void saveEditGradeUnchecked();
  };

  const openDeleteGradeDialog = (gradeId: string) => {
    if (!canRunGradeRecordActions) {
      toast.error("انتظر تحميل سجل الدرجات قبل حذف الدرجة.");
      return;
    }
    const grade = gradeForAction(gradeId);
    const student = grade ? studentById.get(grade.studentId) : null;
    const exam = grade ? examById.get(grade.examId) : null;
    setDeleteDialog({
      open: true,
      id: gradeId,
      label: [student?.name, exam?.name].filter(Boolean).join(" - "),
    });
  };

  const handleDeleteGrade = runDeleteGradeLocked(async () => {
    if (!canRunGradeRecordActions) {
      toast.error("انتظر تحميل سجل الدرجات قبل حذف الدرجة.");
      return;
    }
    const grade = gradeForAction(deleteDialog.id);
    if (!grade) {
      toast.error("تعذر العثور على الدرجة المطلوبة.");
      return;
    }
    const result = await gradeApi.remove(
      deleteDialog.id,
      grade.studentId,
      grade.examId,
      grade.updatedAt,
    );
    if (!result.ok || result.queued) {
      toast.error(result.error || "تعذر حذف الدرجة.");
      return;
    }
    setStudentGrades((current) =>
      current
        ? current.filter((item) => item.id !== deleteDialog.id)
        : current,
    );
    refreshGradeRecordsAfterMutation("grade-records-delete");
    toast.success("تم حذف الدرجة");
    setDeleteDialog({ open: false, id: "", label: "" });
  });

  const fetchGradeExportRows = async (): Promise<GradeExportRow[]> => {
    const params = new URLSearchParams();
    const rawStatus = serverStatusForGradeFilter(filterStatus);
    if (filterExamId) params.set("examId", filterExamId);
    if (rawStatus) params.set("status", rawStatus);
    params.set("statusFilter", filterStatus);
    if (debouncedSearch) params.set("q", debouncedSearch);
    if (filterCourseId) params.set("courseId", filterCourseId);
    if (filterCourseProgram) params.set("courseProgram", filterCourseProgram);
    if (filterCourseProgram === "كورسات" && filterCourseTerm)
      params.set("courseTerm", filterCourseTerm);
    if (filterStudyType) params.set("studyType", filterStudyType);
    params.set("includeAllStudents", "1");
    const res = await fetch(`/api/grades/export?${params.toString()}`, {
      credentials: "same-origin",
    });
    if (!res.ok) throw new Error("grades export failed");
    const json = (await res.json()) as {
      grades?: HydratedGrade[];
      rows?: Array<{
        grade: HydratedGrade | null;
        student: Student;
        exam: (typeof exams)[number];
        statusText: string;
        predictedActionText?: string;
      }>;
    };
    const rows = json.rows || (json.grades || []).map((grade) => ({
      grade,
      student: grade.student || studentById.get(grade.studentId),
      exam:
        (grade.exam as (typeof exams)[number] | undefined) ||
        examById.get(grade.examId),
      statusText: grade.status || "",
      predictedActionText: "",
    }));
    return rows.map((row) => {
      const grade = row.grade;
      const student = row.student || (grade ? studentById.get(grade.studentId) : null);
      const exam =
        row.exam ||
        (grade?.exam as (typeof exams)[number] | undefined) ||
        (grade ? examById.get(grade.examId) : null);
      const cls = grade && exam
        ? classification(grade, exam, student || undefined)
        : { text: "" };
      return {
        grade,
        student,
        exam,
        classificationText: row.predictedActionText || cls.text,
        statusText: row.statusText || grade?.status || "لم يمتحن",
      };
    });
  };

  const applyStatusFilter = (value: GradeStatusFilter) => {
    setFilterStatus(value);
    setPage(1);
  };

  return (
    <div className="tp-management-page tp-grade-records-page space-y-4">
      <Card className="tp-filter-card tp-management-filters">
        <CardHeader>
          <div className="tp-grade-records__heading">
            <CardTitle className="text-base">فلاتر سجل الدرجات</CardTitle>
            <div className="tp-grade-records__actions">
              <Button type="button" onClick={() => setSection("grade-entry")}>
                <PenLine className="size-4" aria-hidden="true" />
                فتح تسجيل الدرجات
              </Button>
              <ExportDialog
                title="تصدير سجل الدرجات"
                fileName="grades"
                rows={[] as GradeExportRow[]}
                fetchRows={fetchGradeExportRows}
                columns={gradeExportColumns}
                triggerLabel="تصدير"
                description="تقرير كامل حسب الفلاتر الحالية، ويشمل طلاب الدورة الذين لم يمتحنوا والإجراء المتوقع بحقهم"
              />
              <Button
                type="button"
                variant="outline"
                onClick={resetFilters}
                disabled={!hasActiveFilters}
              >
                <RotateCcw className="size-4" aria-hidden="true" />
                تصفير الفلاتر
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="tp-filter-content">
          <div className="tp-filter-grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            <div className="tp-filter-field tp-filter-search xl:col-span-2">
              <Label htmlFor="grade-records-search" className="text-xs">
                بحث الطالب
              </Label>
              <Input
                id="grade-records-search"
                name="search"
                data-teacherpro-search="true"
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPage(1);
                }}
                placeholder="اسم / كود / تيليجرام / يوزر / امتحان"
              />
            </div>
            <div className="tp-filter-field tp-filter-primary">
              <Label htmlFor="grade-records-course" className="text-xs">
                الدورة
              </Label>
              <Select
                value={filterCourseId || "all"}
                onValueChange={(v) => {
                  setFilterCourseId(v === "all" ? "" : v);
                  setPage(1);
                }}
              >
                <SelectTrigger id="grade-records-course">
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
            <div className="tp-filter-field tp-filter-primary">
              <Label htmlFor="grade-records-exam" className="text-xs">
                الامتحان
              </Label>
              <Select
                value={filterExamId || "all"}
                onValueChange={(v) => {
                  setFilterExamId(v === "all" ? "" : v);
                  setPage(1);
                }}
              >
                <SelectTrigger id="grade-records-exam">
                  <SelectValue placeholder="كل الامتحانات" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">كل الامتحانات</SelectItem>
                  {filteredExamOptions.map((exam) => (
                    <SelectItem key={exam.id} value={exam.id}>
                      {exam.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="tp-filter-field tp-filter-primary">
              <Label htmlFor="grade-records-program" className="text-xs">
                نوع الدورة
              </Label>
              <Select
                value={filterCourseProgram || "all"}
                onValueChange={(v) => {
                  setFilterCourseProgram(v === "all" ? "" : v);
                  setPage(1);
                }}
              >
                <SelectTrigger id="grade-records-program">
                  <SelectValue placeholder="الكل" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">الكل</SelectItem>
                  {availableProgramsForFilter.map((program) => (
                    <SelectItem key={program} value={program}>
                      {program}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {filterCourseProgram === "كورسات" && (
              <div className="tp-filter-field tp-filter-primary">
                <Label htmlFor="grade-records-term" className="text-xs">
                  الكورس
                </Label>
                <Select
                  value={filterCourseTerm || "all"}
                  onValueChange={(v) => {
                    setFilterCourseTerm(v === "all" ? "" : v);
                    setPage(1);
                  }}
                >
                  <SelectTrigger id="grade-records-term">
                    <SelectValue placeholder="الكل" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">الكل</SelectItem>
                    {STUDENT_FILTER_COURSE_TERMS.map((term) => (
                      <SelectItem key={term} value={term}>
                        {term}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="tp-filter-field tp-filter-primary">
              <Label htmlFor="grade-records-study-type" className="text-xs">
                نوع البرنامج
              </Label>
              <Select
                value={filterStudyType || "all"}
                onValueChange={(v) => {
                  setFilterStudyType(v === "all" ? "" : v);
                  setPage(1);
                }}
              >
                <SelectTrigger id="grade-records-study-type">
                  <SelectValue placeholder="الكل" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">الكل</SelectItem>
                  {availableStudyTypesForFilter.map((studyType) => (
                    <SelectItem key={studyType} value={studyType}>
                      {studyType}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="tp-filter-field tp-filter-secondary">
              <Label htmlFor="grade-records-status" className="text-xs">
                حالة الدرجة
              </Label>
              <Select
                value={filterStatus}
                onValueChange={(v) => applyStatusFilter(v as GradeStatusFilter)}
              >
                <SelectTrigger id="grade-records-status">
                  <SelectValue placeholder="كل حالات الدرجة" />
                </SelectTrigger>
                <SelectContent>
                  {gradeStatusFilterOptions.map((option) => (
                    <SelectItem key={option} value={option}>
                      {gradeStatusFilterLabels[option]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="tp-management-workspace">
        <section className="tp-management-main-flow" aria-label="نتائج سجل الدرجات">
          {studentListError && (
            <div
              role="alert"
              className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-danger-line border-s-4 border-s-danger-vivid bg-danger-soft p-3 text-sm font-medium text-danger"
            >
              <span>{studentListError}</span>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setServerRefreshKey((key) => key + 1)}
              >
                <RotateCcw className="size-4" aria-hidden="true" />
                إعادة المحاولة
              </Button>
            </div>
          )}

          <Card className="tp-management-results-card">
            <CardHeader>
              <div className="tp-grade-records__heading">
                <div>
                  <CardTitle className="text-base">سجل الدرجات</CardTitle>
                  <p className="mt-1 text-xs text-muted-foreground">
                    كل طالب يظهر مرة واحدة · الأحدث أولاً
                  </p>
                </div>
              </div>
              <CountScopeSummary
                className="mb-2"
                subject="الطلاب"
                systemTotal={statValue(systemGradeCoverageStats?.total)}
                filteredTotal={studentList ? formatEnglishNumber(filteredTotalCount) : "…"}
                pageCount={summaries.length}
              />
              <div className="tp-grade-records__toolbar" aria-live="polite" aria-busy={studentListLoading}>
                <p className="tp-management-count-summary text-xs text-muted-foreground" data-count-scope="filtered">
                  {studentList
                    ? `${formatEnglishNumber(filteredTotalCount)} طالب · المعروض ${summaries.length}`
                    : "…"}
                </p>
                <div className="tp-grade-records__page-size">
                  <Label htmlFor="grade-records-pageSize" className="text-xs">
                    حجم الصفحة:
                  </Label>
                  <Select
                    value={String(pageSize)}
                    onValueChange={(v) => {
                      setPageSize(Number(v));
                      setPage(1);
                    }}
                  >
                    <SelectTrigger id="grade-records-pageSize" className="h-10 w-auto min-w-24 rounded-xl tabular-nums">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="10">10</SelectItem>
                      <SelectItem value="25">25</SelectItem>
                      <SelectItem value="50">50</SelectItem>
                      <SelectItem value="100">100</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              {studentListLoading && !studentList && (
                <p role="status" className="tp-grade-records__status">
                  <Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
                  جاري تحميل سجل الدرجات...
                </p>
              )}
              {studentList && summaries.length === 0 && !studentListLoading && (
                <p className="tp-grade-records__empty">
                  {hasActiveFilters
                    ? "لا يوجد طلاب بدرجات تطابق الفلاتر الحالية."
                    : "لا توجد درجات مسجلة بعد."}
                </p>
              )}
              {summaries.length > 0 && (
                <ul className="tp-grade-students" aria-busy={studentListLoading}>
                  {summaries.map((summary) => (
                    <GradeStudentCard
                      key={String(summary.student.id)}
                      summary={summary}
                      courseName={courseNameById.get(String(summary.student.courseId || "")) || ""}
                      onOpen={() => openStudentGrades(summary)}
                    />
                  ))}
                </ul>
              )}

              {totalPages > 1 && (
                <nav className="tp-grade-records__pagination" aria-label="صفحات سجل الدرجات">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={page <= 1}
                    onClick={() => setPage((prev) => prev - 1)}
                  >
                    <ChevronRight className="size-4" aria-hidden="true" />
                    السابق
                  </Button>
                  <span className="text-sm text-muted-foreground tabular-nums">
                    صفحة {page} من {totalPages}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={page >= totalPages}
                    onClick={() => setPage((prev) => prev + 1)}
                  >
                    التالي
                    <ChevronLeft className="size-4" aria-hidden="true" />
                  </Button>
                </nav>
              )}
            </CardContent>
          </Card>
        </section>

        <aside className="tp-management-stats-rail" aria-label="إحصائيات سجل الدرجات">
          <div className="space-y-2">
            <h3 className="text-sm font-black">الإحصائيات</h3>
            <div className="grid" role="group" aria-label="أعداد سجل الدرجات" tabIndex={0}>
              <Card data-count-scope="system">
                <CardContent className="p-4 text-center">
                  <div className="tp-grade-records__stat">
                    <span className="text-2xl font-bold text-primary">{statValue(systemGradeCoverageStats?.total)}</span>
                    <span className="text-xs text-muted-foreground">الطلاب</span>
                  </div>
                </CardContent>
              </Card>
              <Card data-count-scope="system">
                <CardContent className="p-4 text-center">
                  <div className="tp-grade-records__stat">
                    <span className="text-2xl font-bold text-success">{statValue(systemGradeCoverageStats?.withGrade)}</span>
                    <span className="text-xs text-muted-foreground">لديهم درجات</span>
                  </div>
                </CardContent>
              </Card>
              <Card data-count-scope="system">
                <CardContent className="p-4 text-center">
                  <div className="tp-grade-records__stat">
                    <span className="text-2xl font-bold text-warning">{statValue(systemGradeCoverageStats?.withoutGrade)}</span>
                    <span className="text-xs text-muted-foreground">بلا درجات</span>
                  </div>
                </CardContent>
              </Card>
              <Card data-count-scope="filtered">
                <CardContent className="p-4 text-center">
                  <Button
                    type="button"
                    variant="ghost"
                    className="tp-grade-records__stat"
                    aria-label="عرض الطلاب الذين لديهم درجة"
                    aria-pressed={filterStatus === "has-grade"}
                    onClick={() => applyStatusFilter(filterStatus === "has-grade" ? "all" : "has-grade")}
                  >
                    <span className="text-2xl font-bold text-success">{statValue(listTotals?.numeric)}</span>
                    <span className="text-xs text-muted-foreground">درجات رقمية · ضمن النتائج</span>
                  </Button>
                </CardContent>
              </Card>
              <Card data-count-scope="filtered">
                <CardContent className="p-4 text-center">
                  <Button
                    type="button"
                    variant="ghost"
                    className="tp-grade-records__stat"
                    aria-label="عرض الطلاب الغائبين"
                    aria-pressed={filterStatus === "absent"}
                    onClick={() => applyStatusFilter(filterStatus === "absent" ? "all" : "absent")}
                  >
                    <span className="text-2xl font-bold text-danger">{statValue(listTotals?.absent)}</span>
                    <span className="text-xs text-muted-foreground">غيابات · ضمن النتائج</span>
                  </Button>
                </CardContent>
              </Card>
              <Card data-count-scope="filtered">
                <CardContent className="p-4 text-center">
                  <Button
                    type="button"
                    variant="ghost"
                    className="tp-grade-records__stat"
                    aria-label="عرض طلاب الغش"
                    aria-pressed={filterStatus === "cheating"}
                    onClick={() => applyStatusFilter(filterStatus === "cheating" ? "all" : "cheating")}
                  >
                    <span className="text-2xl font-bold text-warning">{statValue(listTotals?.cheating)}</span>
                    <span className="text-xs text-muted-foreground">حالات غش · ضمن النتائج</span>
                  </Button>
                </CardContent>
              </Card>
            </div>
          </div>
        </aside>
      </div>

      <Dialog
        open={Boolean(openSummary)}
        onOpenChange={(open) => {
          if (!open) setOpenSummary(null);
        }}
      >
        <DialogContent className="tp-modal tp-grade-dialog" dir="rtl">
          <div className="tp-modal__hero">
            <span className="tp-modal__hero-icon" aria-hidden="true"><ClipboardList /></span>
            <DialogHeader className="tp-modal__heading">
              <DialogTitle>درجات الطالب</DialogTitle>
              {openStudent && (
                <p className="tp-modal__subtitle">
                  {openStudent.name} · <bdi>{openStudent.code}</bdi>
                </p>
              )}
            </DialogHeader>
          </div>
          <div className="tp-modal__body">
            <section className="tp-modal__section" aria-labelledby="tp-grade-dialog-list">
              <div className="tp-modal__section-head">
                <h3 id="tp-grade-dialog-list" className="tp-modal__title">
                  {STUDENT_GRADES_TABS.find((tab) => tab.value === studentGradesTab)?.label}
                </h3>
                <span className="tp-modal__muted">من الأحدث إلى الأقدم</span>
              </div>
              <div role="group" aria-label="تصفية درجات الطالب" className="tp-modal__filters tp-grade-dialog__tabs">
                {STUDENT_GRADES_TABS.map((tab) => (
                  <button
                    key={tab.value}
                    type="button"
                    className="tp-modal__filter"
                    aria-pressed={studentGradesTab === tab.value}
                    data-tone={tab.tone}
                    onClick={() => setStudentGradesTab(tab.value)}
                  >
                    {tab.tone && <span className="tp-modal__filter-dot" aria-hidden="true" />}
                    <span className="tp-modal__filter-label">{tab.label}</span>
                    <span className="tp-modal__filter-count">{studentGrades ? tabCounts[tab.value] : "…"}</span>
                  </button>
                ))}
              </div>

              {studentGradesError && (
                <p role="alert" className="tp-modal__error"><AlertCircle aria-hidden="true" />{studentGradesError}</p>
              )}
              {studentGradesLoading && !studentGrades && (
                <p role="status" className="tp-modal__status">
                  <Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /> جارٍ تحميل درجات الطالب…
                </p>
              )}
              {studentGrades && visibleStudentGrades.length === 0 && (
                <p className="tp-modal__empty-note">
                  {studentGradesTab === "numeric"
                    ? "لا توجد درجات رقمية لهذا الطالب."
                    : studentGradesTab === "absent"
                      ? "لا يوجد غياب لهذا الطالب."
                      : "لا توجد درجات لهذا الطالب."}
                </p>
              )}
              {visibleStudentGrades.length > 0 && openStudent && (
                <ul className="tp-grade-dialog__list" aria-busy={studentGradesLoading}>
                  {visibleStudentGrades.map((grade) => {
                    const exam = examById.get(grade.examId);
                    if (!exam) return null;
                    const student = studentById.get(grade.studentId) || openStudent;
                    const cls = classification(grade, exam, student);
                    const pill = scorePillPresentation(grade, exam, cls);
                    const availability = getExamEntryAvailability(exam);
                    const kind =
                      grade.status === "درجة"
                        ? "numeric"
                        : grade.status === "غائب"
                          ? "absent"
                          : grade.status === "غش"
                            ? "cheating"
                            : "other";
                    return (
                      <li key={grade.id} className="tp-grade-dialog__row" data-kind={kind}>
                        <div className="tp-grade-dialog__main">
                          <p className="tp-grade-dialog__exam">{exam.name}</p>
                          <p className="tp-modal__muted">
                            {exam.type ? `${exam.type} · ` : ""}{formatAppDate(exam.date)}
                          </p>
                        </div>
                        <div className="tp-grade-dialog__result">
                          <span
                            className="tp-grade-dialog__score"
                            data-kind={kind}
                            data-tone={pill.tone}
                            dir={kind === "numeric" ? "ltr" : undefined}
                          >
                            {pill.text}
                          </span>
                          {cls.text && VISIBLE_RESULT_BADGES.has(cls.text) && (
                            <Badge variant={classificationVariant(cls.type)}>{cls.text}</Badge>
                          )}
                        </div>
                        {(bannerVisibleInCard(grade.notes) || !availability.available) && (
                          <div className="tp-grade-dialog__notes">
                            {bannerVisibleInCard(grade.notes) ? <GradeNoteBanner notes={grade.notes} /> : null}
                            {!availability.available && (
                              <p className="rounded-xl border border-warning-line border-s-4 border-s-warning-vivid bg-warning-soft px-3 py-2 text-xs font-medium leading-5 text-warning">
                                غير محتسبة حالياً: {availability.reason}
                              </p>
                            )}
                          </div>
                        )}
                        <div className="tp-grade-dialog__actions">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => openEditGradeDialog(grade.id)}
                            disabled={!canRunGradeRecordActions}
                          >
                            تعديل
                          </Button>
                          <Button
                            variant="destructive"
                            size="sm"
                            onClick={() => openDeleteGradeDialog(grade.id)}
                            disabled={!canRunGradeRecordActions}
                          >
                            حذف
                          </Button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={editDialog.open}
        onOpenChange={(open) => setEditDialog((prev) => ({ ...prev, open }))}
      >
        <DialogContent dir="rtl">
          <DialogHeader>
            <DialogTitle>تعديل درجة الطالب</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label>الحالة</Label>
              <Select
                value={editDialog.status}
                onValueChange={(value) => {
                  const nextStatus = value as GradeStatus;
                  setEditDialog((prev) => ({
                    ...prev,
                    status: nextStatus,
                    score: nextStatus === "درجة" ? prev.score : "",
                  }));
                }}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="درجة">درجة</SelectItem>
                  <SelectItem value="غائب">غائب</SelectItem>
                  <SelectItem value="غش">غش</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>الدرجة</Label>
              <Input
                type={editDialog.status === "درجة" ? "number" : "text"}
                step={1}
                disabled={editDialog.status !== "درجة"}
                value={
                  editDialog.status === "درجة"
                    ? editDialog.score
                    : editDialog.status
                }
                onChange={(e) =>
                  setEditDialog((prev) => ({
                    ...prev,
                    score: toLatinDigits(e.target.value),
                  }))
                }
              />
            </div>
            <div className="space-y-1 sm:col-span-2">
              <Label>الملاحظات</Label>
              <Input
                value={editDialog.notes}
                onChange={(e) =>
                  setEditDialog((prev) => ({ ...prev, notes: e.target.value }))
                }
                placeholder="سبب الإجازة أو ملاحظة التصحيح"
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() =>
                setEditDialog({
                  open: false,
                  id: "",
                  status: "درجة",
                  score: "",
                  notes: "",
                })
              }
            >
              إلغاء
            </Button>
            <Button onClick={handleSaveEditGrade} disabled={!canRunGradeRecordActions}>حفظ التعديل</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={reactivationEditConfirmOpen}
        onOpenChange={setReactivationEditConfirmOpen}
      >
        <AlertDialogContent dir="rtl">
          <AlertDialogHeader>
            <AlertDialogTitle>
              تأكيد تعديل درجة طالب مُعاد تنشيطه
            </AlertDialogTitle>
            <AlertDialogDescription>
              الطالب بدون فرص حالياً، وهذه الدرجة تستوجب خصم فرصة جديدة
              ولذلك ستعيده إلى المفصولين. هل تريد المتابعة؟
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>إلغاء</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                setReactivationEditConfirmOpen(false);
                void saveEditGradeUnchecked();
              }}
            >
              متابعة
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={leaveEndEditConfirmOpen}
        onOpenChange={setLeaveEndEditConfirmOpen}
      >
        <AlertDialogContent dir="rtl">
          <AlertDialogHeader>
            <AlertDialogTitle>تأكيد إنهاء إجازة الطالب</AlertDialogTitle>
            <AlertDialogDescription>
              {LEAVE_END_CONFIRMATION_MESSAGE} هل تريد المتابعة؟
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>إلغاء</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                setLeaveEndEditConfirmOpen(false);
                void saveEditGradeUnchecked({ confirmLeaveEnd: true });
              }}
            >
              اعتماد الدرجة وإنهاء الإجازة
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={deleteDialog.open}
        onOpenChange={(open) => setDeleteDialog((prev) => ({ ...prev, open }))}
      >
        <AlertDialogContent dir="rtl">
          <AlertDialogHeader>
            <AlertDialogTitle>تأكيد الحذف</AlertDialogTitle>
            <AlertDialogDescription>
              هل أنت متأكد من حذف سجل الدرجة
              {deleteDialog.label ? ` (${deleteDialog.label})` : ""}؟ لا يمكن
              التراجع عن هذه العملية.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>إلغاء</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteGrade}
              disabled={isDeletingGrade}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isDeletingGrade ? "جاري الحذف..." : "حذف"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
