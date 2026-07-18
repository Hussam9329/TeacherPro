"use client";
import { useTeacherProBackgroundSyncDetector, useTeacherProSyncKey } from "@/hooks/use-teacherpro-sync";

import React, { useEffect, useMemo, useState } from "react";
import { useTeacherStore, type Grade, type Student } from "@/lib/teacher-store";
import {
  gradeApi,
  gradeCoverageStatsApi,
  type GradeCoverageStatsResponse,
} from "@/lib/api";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
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
import { searchAny } from "@/lib/validation";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import {
  formatGradeScore,
  getExamEntryAvailability,
  isExamOnOrAfterStudentRegistration,
  isGradeEntered,
} from "@/lib/exam-utils";
import { emitTeacherProDataChanged } from "@/lib/teacherpro-sync";
import { useActionLock } from "@/hooks/use-action-lock";
import { CheckCircle2, UserX } from "lucide-react";
import { CountScopeSummary, StatCard } from "./ui-kit";
import {
  examMatchesAcademicFilters,
  getAcademicCourseProgramFilterOptions,
  getAcademicStudyTypeFilterOptions,
} from "@/lib/filter-sequence";
import {
  STUDENT_FILTER_COURSE_TERMS,
  studentMatchesListFilters,
} from "@/lib/student-list-filters";
import {
  gradeMatchesStatusFilter,
  gradeStatusFilterLabels,
  gradeStatusFilterOptions,
  matchesArabicLetterFilter,
  type GradeStatusFilter,
} from "@/lib/grade-status-filters";

type GradeStatus = "درجة" | "غائب" | "غش";
type ViewMode = "cards" | "table";
type HydratedGrade = Grade & { student?: Student; exam?: unknown };

type GradeExportRow = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  grade: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  student: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  exam: any;
  classificationText: string;
};

const englishNumberFormatter = new Intl.NumberFormat("en-US");
const formatEnglishNumber = (value: number) =>
  englishNumberFormatter.format(value);

function serverStatusForGradeFilter(
  filter: GradeStatusFilter,
): GradeStatus | undefined {
  if (filter === "absent") return "غائب";
  if (filter === "cheating") return "غش";
  return undefined;
}

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
  { key: "exam", label: "الامتحان", value: ({ exam }) => exam?.name || "" },
  { key: "status", label: "الحالة", value: ({ grade }) => grade.status || "" },
  {
    key: "score",
    label: "الدرجة",
    value: ({ grade, exam }) => formatGradeScore(grade, exam, ""),
  },
  {
    key: "accounting",
    label: "محاسبة",
    value: ({ classificationText }) => classificationText,
  },
  {
    key: "checked",
    label: "مؤشر المحاسبة",
    value: ({ grade }) =>
      grade.academicAccountingChecked ? "تمت مراجعة السجل (لا تغيّر الخصم)" : "",
  },
  { key: "notes", label: "ملاحظات", value: ({ grade }) => grade.notes || "" },
];

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
  const [filterNameLetter, setFilterNameLetter] = useState("all");
  const [filterCourseId, setFilterCourseId] = useState("");
  const [filterCourseProgram, setFilterCourseProgram] = useState("");
  const [filterCourseTerm, setFilterCourseTerm] = useState("");
  const [filterStudyType, setFilterStudyType] = useState("");
  const [viewMode, setViewMode] = useState<ViewMode>("cards");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [serverGrades, setServerGrades] = useState<HydratedGrade[] | null>(
    null,
  );
  const [serverTotalCount, setServerTotalCount] = useState(0);
  const [serverTotalPages, setServerTotalPages] = useState(1);
  const [serverGradesLoading, setServerGradesLoading] = useState(false);
  const [serverGradesError, setServerGradesError] = useState<string | null>(
    null,
  );
  const [gradeCoverageStats, setGradeCoverageStats] =
    useState<GradeCoverageStatsResponse | null>(null);
  const [systemGradeCoverageStats, setSystemGradeCoverageStats] =
    useState<GradeCoverageStatsResponse | null>(null);
  const [gradeCoverageStatsLoading, setGradeCoverageStatsLoading] =
    useState(false);
  const [serverRefreshKey, setServerRefreshKey] = useState(0);
  const syncKey = useTeacherProSyncKey(["grades", "students", "exams", "opportunities", "dashboard"]);
  const isBackgroundSync = useTeacherProBackgroundSyncDetector(syncKey);
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
  const { locked: isDeletingGrade, runLocked: runDeleteGradeLocked } =
    useActionLock();

  useEffect(() => {
    setPage(1);
  }, [
    debouncedSearch,
    filterExamId,
    filterStatus,
    filterNameLetter,
    filterCourseId,
    filterCourseProgram,
    filterCourseTerm,
    filterStudyType,
  ]);

  useEffect(() => {
    const controller = new AbortController();
    const rawStatus = serverStatusForGradeFilter(filterStatus);

    const silent = isBackgroundSync();
    if (!silent) setServerGradesLoading(true);
    if (!silent) setServerGradesError(null);

    gradeApi
      .list(
        {
          examId: filterExamId || undefined,
          status: rawStatus,
          statusFilter: filterStatus,
          q: debouncedSearch || undefined,
          courseId: filterCourseId || undefined,
          courseProgram: filterCourseProgram || undefined,
          courseTerm:
            filterCourseProgram === "كورسات" && filterCourseTerm
              ? filterCourseTerm
              : undefined,
          studyType: filterStudyType || undefined,
          nameLetter: filterNameLetter !== "all" ? filterNameLetter : undefined,
          page,
          pageSize,
        },
        { signal: controller.signal, quietAbort: true },
      )
      .then((result) => {
        if (controller.signal.aborted) return;
        if (!result) {
          if (!silent) {
            setServerGrades(null);
            setServerGradesError(
              "تعذر تحميل سجل الدرجات من النظام. تم تعطيل التعديل والحذف حتى يرجع الاتصال.",
            );
          }
          return;
        }

        const loadedGrades = (result.grades ||
          []) as unknown as HydratedGrade[];
        const nextTotalPages = Math.max(1, Number(result.totalPages || 1));
        setServerGrades(loadedGrades);
        setServerTotalCount(Number(result.totalCount || 0));
        setServerTotalPages(nextTotalPages);
        mergeGradesCache(loadedGrades as unknown as Grade[]);

        const relatedStudents = loadedGrades
          .map((grade) => grade.student)
          .filter(Boolean) as Student[];
        if (relatedStudents.length) mergeStudentsCache(relatedStudents);

        if (page > nextTotalPages) setPage(nextTotalPages);
      })
      .catch(() => {
        if (controller.signal.aborted || silent) return;
        setServerGrades(null);
        setServerGradesError(
          "تعذر تحميل سجل الدرجات من النظام. تم تعطيل التعديل والحذف حتى يرجع الاتصال.",
        );
      })
      .finally(() => {
        if (!controller.signal.aborted) setServerGradesLoading(false);
      });

    return () => controller.abort();
  }, [
    debouncedSearch,
    filterExamId,
    filterStatus,
    filterNameLetter,
    filterCourseId,
    filterCourseProgram,
    filterCourseTerm,
    filterStudyType,
    page,
    pageSize,
    serverRefreshKey,
    syncKey,
    mergeGradesCache,
    mergeStudentsCache,
    isBackgroundSync,
  ]);

  useEffect(() => {
    const controller = new AbortController();
    const silent = isBackgroundSync();
    if (!silent) setGradeCoverageStatsLoading(true);
    gradeCoverageStatsApi
      .get(
        {
          examId: filterExamId || undefined,
          courseId: filterCourseId || undefined,
          courseProgram: filterCourseProgram || undefined,
          courseTerm:
            filterCourseProgram === "كورسات" && filterCourseTerm
              ? filterCourseTerm
              : undefined,
          studyType: filterStudyType || undefined,
          nameLetter: filterNameLetter !== "all" ? filterNameLetter : undefined,
          q: debouncedSearch || undefined,
        },
        { signal: controller.signal, quietAbort: true },
      )
      .then((result) => {
        if (!controller.signal.aborted) setGradeCoverageStats(result);
      })
      .catch(() => {
        if (!controller.signal.aborted) setGradeCoverageStats(null);
      })
      .finally(() => {
        if (!controller.signal.aborted) setGradeCoverageStatsLoading(false);
      });

    return () => controller.abort();
  }, [
    debouncedSearch,
    filterExamId,
    filterNameLetter,
    filterCourseId,
    filterCourseProgram,
    filterCourseTerm,
    filterStudyType,
    serverRefreshKey,
    syncKey,
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

  const canRunGradeRecordActions = !serverGradesError && serverGrades !== null;

  const gradeForAction = (gradeId: string) =>
    (serverGrades || []).find((item) => item.id === gradeId) ||
    grades.find((item) => item.id === gradeId);

  const updateServerGradeRow = (gradeId: string, patch: Partial<Grade>) => {
    setServerGrades((current) =>
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

  const isAcademicAccountingRow = (gradeId: string) => {
    const grade = gradeForAction(gradeId);
    const exam = grade ? exams.find((item) => item.id === grade.examId) : null;
    const student = grade
      ? students.find((item) => item.id === grade.studentId)
      : null;
    return Boolean(
      grade &&
      exam &&
      classification(grade, exam, student || undefined).kind ===
        "academic-accounting",
    );
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
    if (exam.type === "فاينل" && exam.opportunitiesPenalty === "فصل مؤقت")
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
      return (
        examPenaltyAmount(exam, remainingOpportunities) >=
        remainingOpportunities
      );
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

  const toggleAcademicAccounting = async (gradeId: string, checked: boolean) => {
    if (!canRunGradeRecordActions) {
      toast.error("تعذر تنفيذ الإجراء قبل تحميل سجل الدرجات من النظام.");
      return;
    }
    if (!isAcademicAccountingRow(gradeId)) {
      toast.error("التأشير متاح فقط لحالة محاسبة رسوب");
      return;
    }
    const result = await gradeApi.update(gradeId, { academicAccountingChecked: checked });
    if (!result.ok || result.queued) {
      toast.error(result.error || "تعذر حفظ مراجعة السجل في النظام.");
      return;
    }
    updateServerGradeRow(gradeId, { academicAccountingChecked: checked });
    mergeGradesCache([{ ...(gradeForAction(gradeId) as Grade), academicAccountingChecked: checked }]);
    refreshGradeRecordsAfterMutation("grade-records-accounting-check");
    toast.success(
      checked ? "تم تأشير محاسبة الرسوب" : "تم إلغاء تأشير محاسبة الرسوب",
    );
  };

  const studentById = useMemo(() => {
    const map = new Map(students.map((student) => [student.id, student]));
    serverGrades?.forEach((grade) => {
      if (grade.student?.id) map.set(grade.student.id, grade.student);
    });
    return map;
  }, [students, serverGrades]);

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
      exams.filter((exam) =>
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
      ),
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
    serverGrades?.forEach((grade) => {
      const exam = grade.exam as (typeof exams)[number] | undefined;
      if (exam?.id) map.set(exam.id, exam);
    });
    return map;
  }, [exams, serverGrades]);
  const selectedFilteredExam = filterExamId ? examById.get(filterExamId) : null;

  const nameLetterOptions = useMemo(
    () => [
      "ا",
      "ب",
      "ت",
      "ث",
      "ج",
      "ح",
      "خ",
      "د",
      "ذ",
      "ر",
      "ز",
      "س",
      "ش",
      "ص",
      "ض",
      "ط",
      "ظ",
      "ع",
      "غ",
      "ف",
      "ق",
      "ك",
      "ل",
      "م",
      "ن",
      "ه",
      "و",
      "ي",
    ],
    [],
  );

  const displayedGradeCoverage = {
    withGrade: systemGradeCoverageStats?.withGrade,
    withoutGrade: systemGradeCoverageStats?.withoutGrade,
    total: systemGradeCoverageStats?.total,
    scopeLabel: "إجمالي الطلاب في النظام",
    missingHint: "لا يملكون درجات مسجلة حتى الآن",
  };

  const statValue = (value: number | undefined) => {
    if (gradeCoverageStatsLoading && !gradeCoverageStats) return "…";
    return value === undefined ? "—" : formatEnglishNumber(value);
  };

  const localFiltered = useMemo(() => {
    return grades.filter((grade) => {
      const student = studentById.get(grade.studentId);
      const exam = examById.get(grade.examId);
      if (!student || !exam || !isGradeEntered(grade, exam)) return false;
      if (!matchesArabicLetterFilter(student.name, filterNameLetter))
        return false;
      if (
        debouncedSearch &&
        !searchAny(debouncedSearch, [
          student.name,
          student.code,
          student.telegram,
          student.phone,
          student.subSite,
          student.locationScope,
          exam.name,
          grade.notes,
        ])
      )
        return false;
      if (filterExamId && grade.examId !== filterExamId) return false;
      const cls = classification(grade, exam, student);
      if (!gradeMatchesStatusFilter(filterStatus, grade, exam, cls))
        return false;
      if (filterCourseId && student.courseId !== filterCourseId) return false;
      if (
        !studentMatchesListFilters(student, {
          courseProgram: filterCourseProgram,
          courseTerm: filterCourseTerm,
          studyType: filterStudyType,
        })
      )
        return false;
      return true;
    });
  }, [
    grades,
    studentById,
    examById,
    debouncedSearch,
    filterExamId,
    filterStatus,
    filterNameLetter,
    filterCourseId,
    filterCourseProgram,
    filterCourseTerm,
    filterStudyType,
    classification,
  ]);

  const usingServerGrades = serverGrades !== null;
  const filtered = usingServerGrades ? (serverGrades ?? []) : localFiltered;
  const filteredTotalCount = usingServerGrades
    ? serverTotalCount
    : localFiltered.length;
  const totalPages = usingServerGrades
    ? serverTotalPages
    : Math.max(1, Math.ceil(localFiltered.length / pageSize));
  const paged = usingServerGrades
    ? (serverGrades ?? [])
    : localFiltered.slice((page - 1) * pageSize, page * pageSize);

  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  const openEditGradeDialog = (gradeId: string) => {
    if (!canRunGradeRecordActions) {
      toast.error("تعذر تعديل الدرجة قبل تحميل سجل الدرجات من النظام.");
      return;
    }
    const grade = gradeForAction(gradeId);
    if (!grade) return;
    setEditDialog({
      open: true,
      id: grade.id,
      status:
        (grade.status as string) === "مجاز"
          ? "غائب"
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
    const exam = grade ? exams.find((item) => item.id === grade.examId) : null;
    if (!grade || !exam) return null;
    const score =
      editDialog.status === "درجة"
        ? Number(toLatinDigits(editDialog.score))
        : null;
    if (
      editDialog.status === "درجة" &&
      (!Number.isFinite(score) ||
        score === null ||
        score < 0 ||
        score > exam.fullMark ||
        !Number.isInteger(score))
    ) {
      toast.error(`الدرجة يجب أن تكون عدداً صحيحاً بين 0 و ${exam.fullMark} بدون كسور`);
      return null;
    }
    return { grade, score };
  };

  const saveEditGradeUnchecked = async () => {
    if (!canRunGradeRecordActions) {
      toast.error("تعذر تعديل الدرجة قبل تحميل سجل الدرجات من النظام.");
      return;
    }
    const validated = validateEditDialogScore();
    if (!validated) return;
    const { grade, score } = validated;

    const result = await gradeApi.update(editDialog.id, {
      status: editDialog.status,
      score,
      notes: editDialog.notes,
      academicAccountingChecked: false,
    });

    if (!result.ok || result.queued) {
      toast.error(result.error || "تعذر تعديل الدرجة من النظام.");
      return;
    }

    const updatedGrade =
      ((result.data as { grade?: Grade } | null)?.grade as Grade | undefined) ||
      ({
        ...grade,
        status: editDialog.status,
        score,
        notes: editDialog.notes,
        academicAccountingChecked: false,
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
    toast.success("تم تعديل الدرجة من بيانات النظام وإعادة الاحتساب");
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
      toast.error("تعذر حذف الدرجة قبل تحميل سجل الدرجات من النظام.");
      return;
    }
    const grade = gradeForAction(gradeId);
    const student = grade
      ? students.find((item) => item.id === grade.studentId)
      : null;
    const exam = grade ? exams.find((item) => item.id === grade.examId) : null;
    setDeleteDialog({
      open: true,
      id: gradeId,
      label: [student?.name, exam?.name].filter(Boolean).join(" - "),
    });
  };

  const handleDeleteGrade = runDeleteGradeLocked(async () => {
    if (!canRunGradeRecordActions) {
      toast.error("تعذر حذف الدرجة قبل تحميل سجل الدرجات من النظام.");
      return;
    }
    const grade = gradeForAction(deleteDialog.id);
    if (!grade) {
      toast.error("تعذر العثور على الدرجة المطلوبة.");
      return;
    }
    const result = await gradeApi.remove(deleteDialog.id, grade.studentId, grade.examId);
    if (!result.ok || result.queued) {
      toast.error(result.error || "تعذر حذف الدرجة من النظام.");
      return;
    }
    setServerGrades((current) =>
      current
        ? current.filter((item) => item.id !== deleteDialog.id)
        : current,
    );
    setServerTotalCount((count) => Math.max(0, count - 1));
    refreshGradeRecordsAfterMutation("grade-records-delete");
    toast.success("تم حذف الدرجة من بيانات النظام");
    setDeleteDialog({ open: false, id: "", label: "" });
  });

  const exportRows = filtered.map((grade) => {
    const student = studentById.get(grade.studentId);
    const exam = examById.get(grade.examId);
    const cls = exam ? classification(grade, exam, student) : { text: "" };
    return { grade, student, exam, classificationText: cls.text };
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
    if (filterNameLetter !== "all") params.set("nameLetter", filterNameLetter);
    const res = await fetch(`/api/grades/export?${params.toString()}`, {
      credentials: "same-origin",
    });
    if (!res.ok) throw new Error("grades export failed");
    const json = (await res.json()) as { grades?: HydratedGrade[] };
    return (json.grades || []).map((grade) => {
      const student = grade.student || studentById.get(grade.studentId);
      const exam =
        (grade.exam as (typeof exams)[number] | undefined) ||
        examById.get(grade.examId);
      const cls = exam ? classification(grade, exam, student) : { text: "" };
      return { grade, student, exam, classificationText: cls.text };
    });
  };

  return (
    <div className="tp-grade-records-page space-y-4">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <StatCard
          label="طلاب لديهم درجات مسجلة"
          value={statValue(displayedGradeCoverage.withGrade)}
          icon={CheckCircle2}
          tone="success"
          hint={`${displayedGradeCoverage.scopeLabel} من أصل ${statValue(displayedGradeCoverage.total)} طالب`}
        />
        <StatCard
          label="طلاب بلا درجات مسجلة"
          value={statValue(displayedGradeCoverage.withoutGrade)}
          icon={UserX}
          tone="warning"
          hint={displayedGradeCoverage.missingHint}
        />
      </div>

      <CountScopeSummary
        subject="الطلاب"
        systemTotal={statValue(systemGradeCoverageStats?.total)}
        filteredTotal={statValue(gradeCoverageStats?.total)}
        pageCount={paged.length}
      />

      <Card className="tp-filter-card">
        <CardContent className="tp-filter-content">
          <div className="tp-filter-grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-8">
            <div className="tp-filter-field tp-filter-search 2xl:col-span-2">
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
                placeholder="اسم / كود / تيليجرام / امتحان"
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
                  <SelectValue placeholder="الكل" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">الكل</SelectItem>
                  {filteredExamOptions.map((exam) => (
                    <SelectItem key={exam.id} value={exam.id}>
                      {exam.name}
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
                onValueChange={(v) => {
                  setFilterStatus(v as GradeStatusFilter);
                  setPage(1);
                }}
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
            <div className="tp-filter-field tp-filter-secondary">
              <Label htmlFor="grade-records-letter" className="text-xs">
                فلترة الاسم أبجدياً
              </Label>
              <Select
                value={filterNameLetter}
                onValueChange={(v) => {
                  setFilterNameLetter(v);
                  setPage(1);
                }}
              >
                <SelectTrigger id="grade-records-letter">
                  <SelectValue placeholder="كل الأحرف" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">كل الأحرف</SelectItem>
                  {nameLetterOptions.map((letter) => (
                    <SelectItem key={letter} value={letter}>
                      {letter}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="tp-filter-field tp-filter-meta">
              <Label htmlFor="grade-records-view" className="text-xs">
                طريقة العرض
              </Label>
              <Select
                value={viewMode}
                onValueChange={(v) => setViewMode(v as ViewMode)}
              >
                <SelectTrigger id="grade-records-view">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="cards">البطاقات</SelectItem>
                  <SelectItem value="table">الجدول</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="tp-filter-field tp-filter-actions">
              <span className="text-xs font-medium">تصدير</span>
              <ExportDialog
                title="تصدير سجل الدرجات"
                fileName="grades"
                rows={exportRows}
                fetchRows={fetchGradeExportRows}
                columns={gradeExportColumns}
                triggerLabel="تصدير"
                description="تقرير سجل الدرجات حسب الفلاتر الحالية"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="text-right">
              <h3 className="text-sm font-black">ورقة إدخال الدرجة</h3>
              <p className="mt-1 text-xs leading-6 text-muted-foreground">
                {selectedFilteredExam
                  ? `الامتحان المحدد: ${selectedFilteredExam.name}. الورقة تبقى متاحة من تسجيل الدرجات وتعرض الطلاب من بيانات النظام حسب هذا الامتحان.`
                  : "اختر امتحاناً من الفلتر حتى تعرف الورقة التي تريد إدخال درجاتها."}
              </p>
            </div>
            <Button
              type="button"
              variant="outline"
              onClick={() => setSection("grade-entry")}
            >
              فتح تسجيل الدرجات
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <span>
          المعروض في الصفحة: {paged.length} · المطابقون للفلاتر: {filteredTotalCount}
        </span>
        <div className="flex items-center gap-2">
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
            <SelectTrigger id="grade-records-pageSize" className="h-8 w-20">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="10">10</SelectItem>
              <SelectItem value="50">50</SelectItem>
              <SelectItem value="100">100</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {serverGradesLoading && (
        <div className="rounded-2xl border border-primary/20 bg-primary/5 p-3 text-sm font-medium text-primary">
          جاري تحميل سجل الدرجات من بيانات النظام...
        </div>
      )}

      {serverGradesError && (
        <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-3 text-sm font-medium text-amber-700 dark:text-amber-300">
          {serverGradesError}
        </div>
      )}

      {viewMode === "cards" ? (
        <div className="space-y-2">
          {paged.map((grade) => {
            const student = studentById.get(grade.studentId);
            const exam = examById.get(grade.examId);
            if (!student || !exam) return null;
            const cls = classification(grade, exam, student);
            return (
              <div
                key={grade.id}
                className="flex flex-col gap-3 rounded-2xl border bg-card/80 p-3 shadow-sm transition-[border-color,box-shadow,background-color] duration-200 hover:border-primary/30 hover:shadow-lg lg:flex-row lg:items-center lg:justify-between"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="truncate text-sm font-medium">
                      {student.name}
                    </p>
                    <Badge variant="outline" className="text-[10px]">
                      {student.code}
                    </Badge>
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <span>{student.telegram}</span>
                    <span>•</span>
                    <span>
                      {student.subSite || student.locationScope || "—"}
                    </span>
                    <span>•</span>
                    <span>{exam.name}</span>
                    <span>•</span>
                    <span>{formatAppDate(grade.createdAt)}</span>
                  </div>
                  {grade.notes ? (
                    <div className="mt-2 rounded-xl border border-amber-200/70 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/25 dark:text-amber-100">
                      <span className="font-bold">ملاحظة الدرجة: </span>
                      <span className="break-words">{grade.notes}</span>
                    </div>
                  ) : null}
                  {!isExamOnOrAfterStudentRegistration(student, exam) && (
                    <div className="mt-2 rounded-xl border border-sky-200 bg-sky-50 px-3 py-2 text-xs font-medium leading-5 text-sky-800 dark:border-sky-900/60 dark:bg-sky-950/30 dark:text-sky-200">
                      محفوظة للمتابعة فقط ولا تخصم؛ تاريخ الامتحان يسبق تاريخ
                      تسجيل الطالب في الدورة.
                    </div>
                  )}
                  {!getExamEntryAvailability(exam).available && (
                    <div className="mt-2 rounded-xl border border-violet-200 bg-violet-50 px-3 py-2 text-xs font-medium leading-5 text-violet-800 dark:border-violet-900/60 dark:bg-violet-950/30 dark:text-violet-200">
                      غير محتسبة حالياً: {getExamEntryAvailability(exam).reason}
                    </div>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-bold">
                    {formatGradeScore(grade, exam, "—")}
                  </span>
                  <Badge
                    variant={
                      cls.type === "ok"
                        ? "default"
                        : cls.type === "danger"
                          ? "destructive"
                          : cls.type === "warn"
                            ? "secondary"
                            : "outline"
                    }
                  >
                    {cls.text}
                  </Badge>
                  {cls.kind === "academic-accounting" && (
                    <label className="flex items-center gap-2 rounded-xl border px-2 py-1 text-xs">
                      <Checkbox
                        checked={Boolean(grade.academicAccountingChecked)}
                        onCheckedChange={(checked) =>
                          void toggleAcademicAccounting(grade.id, checked === true)
                        }
                      />
                      <span>
                        {grade.academicAccountingChecked
                          ? "تمت مراجعة السجل"
                          : "تعليم السجل كمراجع"}
                      </span>
                    </label>
                  )}
                  {cls.kind === "academic-accounting" && (
                    <span className="text-[10px] text-muted-foreground">
                      مؤشر متابعة فقط؛ لا يعتمد أو يلغي الخصم.
                    </span>
                  )}
                  <Button
                    variant="secondary"
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
              </div>
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
                <th className="p-3 text-right">الموقع</th>
                <th className="p-3 text-right">الامتحان</th>
                <th className="p-3 text-right">الحالة</th>
                <th className="p-3 text-right">الدرجة</th>
                <th className="p-3 text-right">محاسبة</th>
                <th className="p-3 text-right">مراجعة السجل (لا تؤثر على الخصم)</th>
                <th className="p-3 text-right">ملاحظات</th>
                <th className="p-3 text-right">الإجراءات</th>
              </tr>
            </thead>
            <tbody>
              {paged.map((grade) => {
                const student = studentById.get(grade.studentId);
                const exam = examById.get(grade.examId);
                if (!student || !exam) return null;
                const cls = classification(grade, exam, student);
                return (
                  <tr key={grade.id} className="border-t align-top">
                    <td className="p-3 font-medium">{student.name}</td>
                    <td className="p-3">{student.code}</td>
                    <td className="p-3">
                      {student.subSite ||
                        student.locationScope ||
                        student.mainSite ||
                        "—"}
                    </td>
                    <td className="p-3">{exam.name}</td>
                    <td className="p-3">{grade.status}</td>
                    <td className="p-3">
                      {formatGradeScore(grade, exam, "—")}
                    </td>
                    <td className="p-3">
                      <Badge
                        variant={
                          cls.type === "ok"
                            ? "default"
                            : cls.type === "danger"
                              ? "destructive"
                              : cls.type === "warn"
                                ? "secondary"
                                : "outline"
                        }
                      >
                        {cls.text}
                      </Badge>
                      {!isExamOnOrAfterStudentRegistration(student, exam) && (
                        <p className="mt-1 text-[11px] font-medium text-sky-700 dark:text-sky-300">
                          لا تخصم: الامتحان سابق للتسجيل.
                        </p>
                      )}
                      {!getExamEntryAvailability(exam).available && (
                        <p className="mt-1 text-[11px] font-medium text-violet-700 dark:text-violet-300">
                          غير محتسبة: {getExamEntryAvailability(exam).reason}
                        </p>
                      )}
                    </td>
                    <td className="p-3">
                      {cls.kind === "academic-accounting" ? (
                        <label className="inline-flex items-center gap-2 text-xs">
                          <Checkbox
                            checked={Boolean(grade.academicAccountingChecked)}
                            onCheckedChange={(checked) =>
                              void toggleAcademicAccounting(
                                grade.id,
                                checked === true,
                              )
                            }
                          />
                          <span>
                            {grade.academicAccountingChecked ? "تمت المراجعة" : "غير مراجع"}
                          </span>
                        </label>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="p-3 min-w-48">{grade.notes || "—"}</td>
                    <td className="p-3 min-w-32">
                      <div className="flex flex-wrap gap-1">
                        <Button
                          variant="secondary"
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
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={page <= 1}
            onClick={() => setPage((prev) => prev - 1)}
          >
            السابق
          </Button>
          <span className="text-sm text-muted-foreground">
            صفحة {page} من {totalPages} · المعروض في الصفحة: {paged.length}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={page >= totalPages}
            onClick={() => setPage((prev) => prev + 1)}
          >
            التالي
          </Button>
        </div>
      )}

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
              الدرجة الجديدة قد تستهلك الفرصة الأخيرة وتعيد الطالب إلى
              المفصولين. هل تريد المتابعة؟
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
