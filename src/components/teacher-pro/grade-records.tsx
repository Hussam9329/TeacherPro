"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useTeacherStore, type Grade, type Student } from "@/lib/teacher-store";
import { gradeApi, gradeCoverageStatsApi, type GradeCoverageStatsResponse } from "@/lib/api";
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
import { toast } from "sonner";
import { formatAppDate } from "@/lib/format";
import { toLatinDigits } from "@/lib/format";
import { searchAny } from "@/lib/validation";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import {
  formatGradeScore,
  isExamOnOrAfterStudentRegistration,
  isGradeEntered,
  splitSelection,
  studentMatchesExamMainSites,
} from "@/lib/exam-utils";
import { useActionLock } from "@/hooks/use-action-lock";
import { CheckCircle2, UserX } from "lucide-react";
import { StatCard } from "./ui-kit";
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

function serverStatusForGradeFilter(filter: GradeStatusFilter): GradeStatus | undefined {
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
    label: "التليكرام",
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
      grade.academicAccountingChecked ? "تمت المحاسبة" : "",
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
    updateGrade,
    deleteGrade,
    classification,
    mergeStudentsCache,
    mergeGradesCache,
  } = useTeacherStore();

  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search, 180);
  const [filterExamId, setFilterExamId] = useState("");
  const [filterStatus, setFilterStatus] = useState<GradeStatusFilter>("all");
  const [filterNameLetter, setFilterNameLetter] = useState("all");
  const [filterCourseId, setFilterCourseId] = useState("");
  const [viewMode, setViewMode] = useState<ViewMode>("cards");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [serverGrades, setServerGrades] = useState<HydratedGrade[] | null>(null);
  const [serverTotalCount, setServerTotalCount] = useState(0);
  const [serverTotalPages, setServerTotalPages] = useState(1);
  const [serverGradesLoading, setServerGradesLoading] = useState(false);
  const [serverGradesError, setServerGradesError] = useState<string | null>(null);
  const [gradeCoverageStats, setGradeCoverageStats] = useState<GradeCoverageStatsResponse | null>(null);
  const [gradeCoverageStatsLoading, setGradeCoverageStatsLoading] = useState(false);
  const [serverRefreshKey, setServerRefreshKey] = useState(0);
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
  const [reactivationEditConfirmOpen, setReactivationEditConfirmOpen] = useState(false);
  const { locked: isDeletingGrade, runLocked: runDeleteGradeLocked } =
    useActionLock();

  useEffect(() => {
    setPage(1);
  }, [debouncedSearch, filterExamId, filterStatus, filterNameLetter, filterCourseId]);

  useEffect(() => {
    let cancelled = false;
    const rawStatus = serverStatusForGradeFilter(filterStatus);

    setServerGradesLoading(true);
    setServerGradesError(null);

    gradeApi
      .list({
        examId: filterExamId || undefined,
        status: rawStatus,
        statusFilter: filterStatus,
        q: debouncedSearch || undefined,
        courseId: filterCourseId || undefined,
        nameLetter: filterNameLetter !== "all" ? filterNameLetter : undefined,
        page,
        pageSize,
      })
      .then((result) => {
        if (cancelled) return;
        if (!result) {
          setServerGrades(null);
          setServerGradesError("تعذر تحميل سجل الدرجات من الخادم. سيتم عرض آخر نسخة محفوظة مؤقتاً.");
          return;
        }

        const loadedGrades = (result.grades || []) as unknown as HydratedGrade[];
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
        if (cancelled) return;
        setServerGrades(null);
        setServerGradesError("تعذر تحميل سجل الدرجات من الخادم. سيتم عرض آخر نسخة محفوظة مؤقتاً.");
      })
      .finally(() => {
        if (!cancelled) setServerGradesLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [
    debouncedSearch,
    filterExamId,
    filterStatus,
    filterNameLetter,
    filterCourseId,
    page,
    pageSize,
    serverRefreshKey,
    mergeGradesCache,
    mergeStudentsCache,
  ]);

  useEffect(() => {
    let cancelled = false;
    setGradeCoverageStatsLoading(true);
    gradeCoverageStatsApi
      .get({
        examId: filterExamId || undefined,
        courseId: filterCourseId || undefined,
        nameLetter: filterNameLetter !== "all" ? filterNameLetter : undefined,
        q: debouncedSearch || undefined,
      })
      .then((result) => {
        if (!cancelled) setGradeCoverageStats(result);
      })
      .catch(() => {
        if (!cancelled) setGradeCoverageStats(null);
      })
      .finally(() => {
        if (!cancelled) setGradeCoverageStatsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [debouncedSearch, filterExamId, filterNameLetter, filterCourseId, serverRefreshKey]);

  const isAcademicAccountingRow = (gradeId: string) => {
    const grade = grades.find((item) => item.id === gradeId);
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
    const grade = grades.find((item) => item.id === gradeId);
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

  const toggleAcademicAccounting = (gradeId: string, checked: boolean) => {
    if (!isAcademicAccountingRow(gradeId)) {
      toast.error("التأشير متاح فقط لحالة محاسبة رسوب");
      return;
    }
    updateGrade(gradeId, { academicAccountingChecked: checked });
    setServerGrades((current) =>
      current
        ? current.map((grade) =>
            grade.id === gradeId
              ? { ...grade, academicAccountingChecked: checked }
              : grade,
          )
        : current,
    );
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
  const examById = useMemo(() => {
    const map = new Map(exams.map((exam) => [exam.id, exam]));
    serverGrades?.forEach((grade) => {
      const exam = grade.exam as (typeof exams)[number] | undefined;
      if (exam?.id) map.set(exam.id, exam);
    });
    return map;
  }, [exams, serverGrades]);
  const nameLetterOptions = useMemo(
    () => ["ا", "ب", "ت", "ث", "ج", "ح", "خ", "د", "ذ", "ر", "ز", "س", "ش", "ص", "ض", "ط", "ظ", "ع", "غ", "ف", "ق", "ك", "ل", "م", "ن", "ه", "و", "ي"],
    [],
  );

  const gradeCoverageDashboard = useMemo(() => {
    const selectedExam = filterExamId ? examById.get(filterExamId) : null;

    const studentMatchesDashboardFilters = (
      student: (typeof students)[number],
      exam?: (typeof exams)[number] | null,
    ) => {
      if (!matchesArabicLetterFilter(student.name, filterNameLetter))
        return false;
      if (filterCourseId && student.courseId !== filterCourseId) return false;
      if (
        debouncedSearch &&
        !searchAny(debouncedSearch, [
          student.name,
          student.code,
          student.telegram,
          student.phone,
          student.parentPhone,
          student.school,
          student.subSite,
          student.locationScope,
          student.mainSite,
          exam?.name,
        ])
      )
        return false;
      return true;
    };

    const enteredStudentIds = new Set<string>();
    for (const grade of grades) {
      if (selectedExam && grade.examId !== selectedExam.id) continue;
      const exam = examById.get(grade.examId);
      if (exam && isGradeEntered(grade, exam)) {
        enteredStudentIds.add(grade.studentId);
      }
    }

    const selectedMainSites = selectedExam
      ? splitSelection(selectedExam.mainSite)
      : [];

    const scopedStudents = selectedExam
      ? students.filter((student) => {
          if (!selectedExam.courseIds.includes(student.courseId)) return false;
          if (!isExamOnOrAfterStudentRegistration(student, selectedExam))
            return false;
          if (!studentMatchesExamMainSites(student, selectedMainSites))
            return false;
          return studentMatchesDashboardFilters(student, selectedExam);
        })
      : students.filter((student) => studentMatchesDashboardFilters(student));

    const withGrade = scopedStudents.filter((student) =>
      enteredStudentIds.has(student.id),
    ).length;
    const withoutGrade = Math.max(0, scopedStudents.length - withGrade);

    return {
      withGrade,
      withoutGrade,
      total: scopedStudents.length,
      scopeLabel: selectedExam ? `ضمن ${selectedExam.name}` : "ضمن كل الامتحانات",
      missingHint: selectedExam
        ? "لم تُدخل لهم درجة لهذا الامتحان"
        : "لا يملكون أي سجل درجة لحد الآن",
    };
  }, [
    grades,
    students,
    exams,
    examById,
    filterExamId,
    filterNameLetter,
    filterCourseId,
    debouncedSearch,
  ]);

  const displayedGradeCoverage = gradeCoverageStats
    ? {
        withGrade: gradeCoverageStats.withGrade,
        withoutGrade: gradeCoverageStats.withoutGrade,
        total: gradeCoverageStats.total,
        scopeLabel: filterExamId
          ? `ضمن ${examById.get(filterExamId)?.name || "الامتحان المحدد"}`
          : "ضمن كل الامتحانات",
        missingHint: filterExamId
          ? "لم تُدخل لهم درجة لهذا الامتحان"
          : "لا يملكون أي سجل درجة لحد الآن",
      }
    : gradeCoverageDashboard;

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
      if (filterCourseId && student.courseId !== filterCourseId)
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
    classification,
  ]);

  const usingServerGrades = serverGrades !== null;
  const filtered = usingServerGrades ? (serverGrades ?? []) : localFiltered;
  const filteredTotalCount = usingServerGrades ? serverTotalCount : localFiltered.length;
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
    const grade = grades.find((item) => item.id === gradeId);
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
    const grade = grades.find((item) => item.id === editDialog.id);
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
        score > exam.fullMark)
    ) {
      toast.error(`الدرجة يجب أن تكون بين 0 و ${exam.fullMark}`);
      return null;
    }
    return { grade, score };
  };

  const saveEditGradeUnchecked = () => {
    const validated = validateEditDialogScore();
    if (!validated) return;
    const { score } = validated;

    updateGrade(editDialog.id, {
      status: editDialog.status,
      score,
      notes: editDialog.notes,
      academicAccountingChecked: false,
    });
    setServerGrades((current) =>
      current
        ? current.map((grade) =>
            grade.id === editDialog.id
              ? {
                  ...grade,
                  status: editDialog.status,
                  score,
                  notes: editDialog.notes,
                  academicAccountingChecked: false,
                }
              : grade,
          )
        : current,
    );
    setEditDialog({
      open: false,
      id: "",
      status: "درجة",
      score: "",
      notes: "",
    });
    setServerRefreshKey((key) => key + 1);
    toast.success("تم تعديل الدرجة وإعادة الاحتساب");
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
    saveEditGradeUnchecked();
  };

  const openDeleteGradeDialog = (gradeId: string) => {
    const grade = grades.find((item) => item.id === gradeId);
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
    const ok = deleteGrade(deleteDialog.id);
    if (ok) {
      setServerGrades((current) =>
        current ? current.filter((grade) => grade.id !== deleteDialog.id) : current,
      );
      setServerTotalCount((count) => Math.max(0, count - 1));
      setServerRefreshKey((key) => key + 1);
      toast.success("تم حذف الدرجة");
    } else {
      toast.error("تعذر حذف الدرجة");
    }
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
    if (filterNameLetter !== "all") params.set("nameLetter", filterNameLetter);
    const res = await fetch(`/api/grades/export?${params.toString()}`, { credentials: "same-origin" });
    if (!res.ok) throw new Error("grades export failed");
    const json = (await res.json()) as { grades?: HydratedGrade[] };
    return (json.grades || []).map((grade) => {
      const student = grade.student || studentById.get(grade.studentId);
      const exam = (grade.exam as (typeof exams)[number] | undefined) || examById.get(grade.examId);
      const cls = exam ? classification(grade, exam, student) : { text: "" };
      return { grade, student, exam, classificationText: cls.text };
    });
  };


  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <StatCard
          label="طلاب لديهم درجة"
          value={gradeCoverageStatsLoading && !gradeCoverageStats ? "…" : formatEnglishNumber(displayedGradeCoverage.withGrade)}
          icon={CheckCircle2}
          tone="success"
          hint={`${displayedGradeCoverage.scopeLabel} من أصل ${formatEnglishNumber(displayedGradeCoverage.total)} طالب`}
        />
        <StatCard
          label="طلاب بلا درجة"
          value={gradeCoverageStatsLoading && !gradeCoverageStats ? "…" : formatEnglishNumber(displayedGradeCoverage.withoutGrade)}
          icon={UserX}
          tone="warning"
          hint={displayedGradeCoverage.missingHint}
        />
      </div>

      <Card>
        <CardContent className="p-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-8">
            <div className="space-y-1">
              <Label htmlFor="grade-records-search" className="text-xs">
                بحث
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
                placeholder="اسم / كود / تليكرام / امتحان"
              />
            </div>
            <div className="space-y-1">
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
                  {exams.map((exam) => (
                    <SelectItem key={exam.id} value={exam.id}>
                      {exam.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
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
            <div className="space-y-1">
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
            <div className="space-y-1">
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
            <div className="space-y-1">
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
                  <SelectItem value="cards">الكارتات</SelectItem>
                  <SelectItem value="table">الجدول</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
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

      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <span>
          عرض {paged.length} من {filteredTotalCount} سجل
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
          جاري تحميل سجل الدرجات من قاعدة البيانات...
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
                className="flex flex-col gap-3 rounded-2xl border bg-card/80 p-3 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-lg lg:flex-row lg:items-center lg:justify-between"
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
                          toggleAcademicAccounting(grade.id, checked === true)
                        }
                      />
                      <span>
                        {grade.academicAccountingChecked
                          ? "تمت المحاسبة"
                          : "تأكيد المحاسبة"}
                      </span>
                    </label>
                  )}
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => openEditGradeDialog(grade.id)}
                  >
                    تعديل
                  </Button>
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => openDeleteGradeDialog(grade.id)}
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
                <th className="p-3 text-right">تأشير المحاسبة</th>
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
                    </td>
                    <td className="p-3">
                      {cls.kind === "academic-accounting" ? (
                        <label className="inline-flex items-center gap-2 text-xs">
                          <Checkbox
                            checked={Boolean(grade.academicAccountingChecked)}
                            onCheckedChange={(checked) =>
                              toggleAcademicAccounting(
                                grade.id,
                                checked === true,
                              )
                            }
                          />
                          <span>
                            {grade.academicAccountingChecked ? "تمت" : "لم تتم"}
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
                        >
                          تعديل
                        </Button>
                        <Button
                          variant="destructive"
                          size="sm"
                          onClick={() => openDeleteGradeDialog(grade.id)}
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
            {page} / {totalPages}
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
            <Button onClick={handleSaveEditGrade}>حفظ التعديل</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={reactivationEditConfirmOpen} onOpenChange={setReactivationEditConfirmOpen}>
        <AlertDialogContent dir="rtl">
          <AlertDialogHeader>
            <AlertDialogTitle>تأكيد تعديل درجة طالب مُعاد تنشيطه</AlertDialogTitle>
            <AlertDialogDescription>
              الدرجة الجديدة قد تستهلك الفرصة الأخيرة وتعيد الطالب إلى المفصولين. هل تريد المتابعة؟
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>إلغاء</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                setReactivationEditConfirmOpen(false);
                saveEditGradeUnchecked();
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
