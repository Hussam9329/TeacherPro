"use client";
import { useTeacherProSyncKey } from "@/hooks/use-teacherpro-sync";

import React, { useEffect, useMemo, useState } from "react";
import { useTeacherStore, type Exam } from "@/lib/teacher-store";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { DateInput } from "@/components/ui/date-input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
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
import { formatAppDate, toLatinDigits } from "@/lib/format";
import {
  formatBaghdadDateTime,
  toBaghdadDateTimeLocal,
} from "@/lib/baghdad-time";
import { MAIN_SITE_OPTIONS } from "@/lib/iraq";
import { useActionLock } from "@/hooks/use-action-lock";
import {
  formatGradeScore,
  getExamStatus,
  hasActiveChapterLink,
  splitSelection,
  type ExamStatusLabel,
} from "@/lib/exam-utils";
import { searchAny } from "@/lib/validation";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { examStatsApi, type ExamRecordStat } from "@/lib/api";
import { ExportDialog, type ExportColumn } from "./export-dialog";

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
    label: "التليكرام",
    value: (row) => row.student?.telegram || "",
  },
  { key: "notes", label: "ملاحظات", value: (row) => row.grade.notes || "" },
];

type ViewMode = "cards" | "table";
type ExamStatusMode = "نشط" | "تفعيل مجدول" | "تعطيل مجدول" | "معطل";

type FullExamEditState = {
  open: boolean;
  id: string;
  name: string;
  type: Exam["type"];
  courseIds: string[];
  mainSites: string[];
  date: string;
  fullMark: string;
  passMark: string;
  discountMark: string;
  opportunitiesPenaltyNum: string;
  dismissalGrade: string;
  noDiscount: boolean;
  statusMode: ExamStatusMode;
  scheduledActivateAt: string;
  scheduledDeactivateAt: string;
};

type ExamDetailItem = {
  label: string;
  value: React.ReactNode;
};

function toDateTimeLocalValue(value?: string | null) {
  return toBaghdadDateTimeLocal(value);
}

function formatDateTime(value?: string | null) {
  return formatBaghdadDateTime(value);
}

function getEntryAvailability(exam: Exam) {
  const status = getExamStatus(exam);
  if (status === "نشط") {
    return { available: true, answer: "نعم", reason: "الامتحان نشط ويظهر في إدخال الدرجات." };
  }
  if (status === "تعطيل مجدول") {
    return {
      available: true,
      answer: "نعم",
      reason: `نشط حالياً وسيُعطل في ${formatDateTime(exam.scheduledDeactivateAt)}.`,
    };
  }
  if (status === "تفعيل مجدول") {
    return {
      available: false,
      answer: "لا",
      reason: `لن يظهر في إدخال الدرجات حتى ${formatDateTime(exam.scheduledActivateAt)}.`,
    };
  }
  return { available: false, answer: "لا", reason: "الامتحان معطل حالياً ولا يظهر في إدخال الدرجات." };
}

function defaultDeactivateDateTime(exam: Exam) {
  return (
    toDateTimeLocalValue(exam.scheduledDeactivateAt) ||
    `${exam.date || new Date().toISOString().slice(0, 10)}T08:00`
  );
}

function defaultDateTimeForDate(date: string) {
  return `${date || new Date().toISOString().slice(0, 10)}T08:00`;
}

function toggleSelection(values: string[], value: string): string[] {
  return values.includes(value)
    ? values.filter((item) => item !== value)
    : [...values, value];
}

function statusModeFromExam(exam: Exam): ExamStatusMode {
  const status = getExamStatus(exam);
  return status;
}

function emptyEditState(): FullExamEditState {
  return {
    open: false,
    id: "",
    name: "",
    type: "يومي",
    courseIds: [],
    mainSites: [],
    date: new Date().toISOString().slice(0, 10),
    fullMark: "100",
    passMark: "60",
    discountMark: "45",
    opportunitiesPenaltyNum: "1",
    dismissalGrade: "",
    noDiscount: false,
    statusMode: "نشط",
    scheduledActivateAt: "",
    scheduledDeactivateAt: "",
  };
}

export function ExamRecordsView() {
  const syncKey = useTeacherProSyncKey(["exams", "courses", "grades", "students", "correction", "grade-entry-notes", "dashboard"]);
  const {
    exams,
    grades,
    students,
    courses,
    courseChapters,
    updateExam,
    toggleExam,
    deleteExam,
    courseName,
    classification,
  } = useTeacherStore();

  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search, 180);
  const [filterType, setFilterType] = useState("");
  const [filterCourseId, setFilterCourseId] = useState("");
  const [filterStatus, setFilterStatus] = useState<ExamStatusLabel | "">("");
  const [viewMode, setViewMode] = useState<ViewMode>("cards");
  const [databaseExamStats, setDatabaseExamStats] = useState<Record<string, ExamRecordStat>>({});
  const [databaseExamStatsLoading, setDatabaseExamStatsLoading] = useState(false);
  const [deleteDialog, setDeleteDialog] = useState<{
    open: boolean;
    id: string;
    name: string;
    gradeCount: number | null;
  }>({
    open: false,
    id: "",
    name: "",
    gradeCount: null,
  });
  const [editDialog, setEditDialog] = useState<FullExamEditState>(() =>
    emptyEditState(),
  );
  const [deactivateDialog, setDeactivateDialog] = useState({
    open: false,
    id: "",
    name: "",
    scheduledDeactivateAt: "",
  });
  const [clockTick, setClockTick] = useState(0);
  const { locked: isDeletingExam, runLocked: runDeleteExamLocked } =
    useActionLock();

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

    let cancelled = false;
    setDatabaseExamStatsLoading(true);
    examStatsApi
      .get(examIds)
      .then((result) => {
        if (!cancelled) setDatabaseExamStats(result?.statsByExamId || {});
      })
      .catch(() => {
        if (!cancelled) setDatabaseExamStats({});
      })
      .finally(() => {
        if (!cancelled) setDatabaseExamStatsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [filteredExamIdsKey, syncKey]);

  const examStatValue = (examId: string, key: keyof ExamRecordStat) => {
    const stat = databaseExamStats[examId];
    if (databaseExamStatsLoading && !stat) return "…";
    return stat ? stat[key] : "—";
  };

  const examStatNumber = (examId: string, key: keyof ExamRecordStat): number | null => {
    const stat = databaseExamStats[examId];
    const value = stat?.[key];
    return typeof value === "number" && Number.isFinite(value) ? value : null;
  };

  const examRows = (examId: string) => {
    const exam = exams.find((item) => item.id === examId);
    if (!exam) return [];
    return grades
      .filter((grade) => grade.examId === examId)
      .map((grade) => {
        const student = students.find((item) => item.id === grade.studentId);
        const cls = classification(grade, exam, student);
        return { grade, student, cls };
      })
      .filter((row) => row.student)
      .sort((a, b) =>
        (a.student?.name || "").localeCompare(b.student?.name || "", "ar"),
      );
  };

  const examDetails = (exam: Exam, rowsCount: React.ReactNode): ExamDetailItem[] => {
    const mainSites = splitSelection(exam.mainSite);
    const entryAvailability = getEntryAvailability(exam);
    return [
      { label: "اسم الامتحان", value: exam.name },
      { label: "تاريخ الامتحان", value: formatAppDate(exam.date) },
      { label: "نوع الامتحان", value: exam.type },
      { label: "حالة الامتحان", value: getExamStatus(exam) },
      {
        label: "متاح للإدخال",
        value: (
          <span className={entryAvailability.available ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"}>
            {entryAvailability.answer} - {entryAvailability.reason}
          </span>
        ),
      },
      {
        label: "الدورات",
        value: exam.courseIds.map(courseName).join("، ") || "—",
      },
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
      {
        label: "تعطيل مجدول",
        value: formatDateTime(exam.scheduledDeactivateAt),
      },
      { label: "عدد سجلات الدرجات", value: rowsCount },
    ];
  };

  const availableMainSitesForEdit = (_state: FullExamEditState) => {
    return [...MAIN_SITE_OPTIONS];
  };

  const openEditExamDialog = (examId: string) => {
    const exam = exams.find((item) => item.id === examId);
    if (!exam) return;
    setEditDialog({
      open: true,
      id: examId,
      name: exam.name,
      type: exam.type,
      courseIds: [...exam.courseIds],
      mainSites: splitSelection(exam.mainSite),
      date: exam.date || new Date().toISOString().slice(0, 10),
      fullMark: String(exam.fullMark),
      passMark: String(exam.passMark),
      discountMark: String(exam.discountMark),
      opportunitiesPenaltyNum:
        typeof exam.opportunitiesPenalty === "number"
          ? String(exam.opportunitiesPenalty)
          : "1",
      dismissalGrade:
        exam.dismissalGrade === null || exam.dismissalGrade === undefined
          ? ""
          : String(exam.dismissalGrade),
      noDiscount: Boolean(exam.noDiscount),
      statusMode: statusModeFromExam(exam),
      scheduledActivateAt:
        toDateTimeLocalValue(exam.scheduledActivateAt) ||
        defaultDateTimeForDate(exam.date),
      scheduledDeactivateAt:
        toDateTimeLocalValue(exam.scheduledDeactivateAt) ||
        defaultDeactivateDateTime(exam),
    });
  };

  const validateEditExam = (state: FullExamEditState) => {
    const fullMark = Number(toLatinDigits(state.fullMark));
    const passMark = Number(toLatinDigits(state.passMark));
    const isFinalExam = state.type === "فاينل";
    const noDiscount = Boolean(state.noDiscount);
    const discountMark =
      isFinalExam || noDiscount ? 0 : Number(toLatinDigits(state.discountMark));
    if (!state.name.trim()) return "اسم الامتحان مطلوب";
    if (state.courseIds.length === 0) return "اختر دورة واحدة على الأقل";
    const invalidCourses = state.courseIds.filter(
      (courseId) => !hasActiveChapterLink(courseChapters, courseId),
    );
    if (invalidCourses.length > 0)
      return `لا يمكن ربط الامتحان بدورات بدون فصل نشط: ${invalidCourses.map(courseName).join("، ")}`;
    if (state.mainSites.length === 0) return "اختر موقعاً واحداً على الأقل";
    if (![fullMark, passMark, discountMark].every(Number.isFinite))
      return "درجات الامتحان يجب أن تكون أرقاماً";
    if (fullMark <= 0) return "الدرجة الكاملة يجب أن تكون أكبر من صفر";
    if (passMark < 0 || passMark > fullMark)
      return "درجة النجاح يجب أن تكون بين صفر والدرجة الكاملة";
    if (!noDiscount && (discountMark < 0 || discountMark > fullMark))
      return "درجة الخصم يجب أن تكون بين صفر والدرجة الكاملة";
    if (!noDiscount && !isFinalExam && passMark <= discountMark)
      return "درجة النجاح يجب أن تكون أكبر من درجة الخصم";
    if (
      !noDiscount &&
      !isFinalExam &&
      Number(toLatinDigits(state.opportunitiesPenaltyNum) || 0) <= 0
    )
      return "خصم الفرص يجب أن يكون أكبر من صفر";
    if (state.statusMode === "تفعيل مجدول" && !state.scheduledActivateAt)
      return "حدد تاريخ ووقت التفعيل المجدول";
    if (state.statusMode === "تعطيل مجدول" && !state.scheduledDeactivateAt)
      return "حدد تاريخ ووقت التعطيل المجدول";
    return null;
  };

  const handleEditExam = () => {
    const error = validateEditExam(editDialog);
    if (error) return toast.error(error);
    const isFinalExam = editDialog.type === "فاينل";
    const noDiscount = Boolean(editDialog.noDiscount);
    const statusPatch =
      editDialog.statusMode === "نشط"
        ? { active: true, scheduledActivateAt: "", scheduledDeactivateAt: "" }
        : editDialog.statusMode === "معطل"
          ? {
              active: false,
              scheduledActivateAt: "",
              scheduledDeactivateAt: "",
            }
          : editDialog.statusMode === "تفعيل مجدول"
            ? {
                active: false,
                scheduledActivateAt: editDialog.scheduledActivateAt,
                scheduledDeactivateAt: "",
              }
            : {
                active: true,
                scheduledActivateAt: "",
                scheduledDeactivateAt: editDialog.scheduledDeactivateAt,
              };

    updateExam(editDialog.id, {
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
          ? "فصل مؤقت"
          : Number(toLatinDigits(editDialog.opportunitiesPenaltyNum) || 1),
      dismissalGrade:
        !noDiscount && isFinalExam && editDialog.dismissalGrade
          ? Number(toLatinDigits(editDialog.dismissalGrade))
          : null,
      noDiscount,
      ...statusPatch,
    });
    setEditDialog(emptyEditState());
    toast.success("تم تعديل الامتحان بالكامل وإعادة الاحتساب");
  };

  const openScheduleDeactivateDialog = (examId: string) => {
    const exam = exams.find((item) => item.id === examId);
    if (!exam) return;
    setDeactivateDialog({
      open: true,
      id: exam.id,
      name: exam.name,
      scheduledDeactivateAt: defaultDeactivateDateTime(exam),
    });
  };

  const handleScheduleDeactivate = () => {
    if (!deactivateDialog.scheduledDeactivateAt) {
      toast.error("حدد تاريخ ووقت التعطيل المجدول");
      return;
    }
    updateExam(deactivateDialog.id, {
      active: true,
      scheduledActivateAt: "",
      scheduledDeactivateAt: deactivateDialog.scheduledDeactivateAt,
    });
    setDeactivateDialog({
      open: false,
      id: "",
      name: "",
      scheduledDeactivateAt: "",
    });
    toast.success("تمت جدولة تعطيل الامتحان");
  };

  const handleClearScheduledDeactivate = () => {
    updateExam(deactivateDialog.id, { scheduledDeactivateAt: "" });
    setDeactivateDialog({
      open: false,
      id: "",
      name: "",
      scheduledDeactivateAt: "",
    });
    toast.success("تم إلغاء التعطيل المجدول");
  };

  const openDeleteExamDialog = (examId: string) => {
    const exam = exams.find((item) => item.id === examId);
    setDeleteDialog({
      open: true,
      id: examId,
      name: exam?.name || "",
      gradeCount: examStatNumber(examId, "total"),
    });
  };

  const handleDeleteExam = runDeleteExamLocked(async () => {
    if (deleteDialog.gradeCount === null) {
      toast.error("انتظر اكتمال التحقق من سجلات الدرجات قبل الحذف.");
      return;
    }
    if (deleteDialog.gradeCount > 0) {
      toast.error(`لا يمكن حذف هذا الامتحان لأن عليه ${deleteDialog.gradeCount} سجل درجات. عطّل الامتحان بدلاً من حذفه.`);
      return;
    }
    const ok = deleteExam(deleteDialog.id);
    ok ? toast.success("تم حذف الامتحان") : toast.error("تعذر حذف الامتحان");
    setDeleteDialog({ open: false, id: "", name: "", gradeCount: null });
  });

  const renderEditExamFields = () => {
    const isFinalExam = editDialog.type === "فاينل";
    const noDiscount = Boolean(editDialog.noDiscount);
    const mainSitesForEdit = availableMainSitesForEdit(editDialog);
    const eligibleCourses = courses.filter((course) =>
      hasActiveChapterLink(courseChapters, course.id),
    );
    const allCoursesSelected =
      eligibleCourses.length > 0 &&
      eligibleCourses.every((course) =>
        editDialog.courseIds.includes(course.id),
      );
    const allSitesSelected =
      mainSitesForEdit.length > 0 &&
      mainSitesForEdit.every((site) => editDialog.mainSites.includes(site));

    return (
      <div className="max-h-[70vh] space-y-4 overflow-y-auto pr-1">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <div className="space-y-1 md:col-span-2">
            <Label htmlFor="edit-exam-name">اسم الامتحان</Label>
            <Input
              id="edit-exam-name"
              value={editDialog.name}
              onChange={(e) =>
                setEditDialog((prev) => ({ ...prev, name: e.target.value }))
              }
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="edit-exam-type">نوع الامتحان</Label>
            <Select
              value={editDialog.type}
              onValueChange={(value) =>
                setEditDialog((prev) => ({
                  ...prev,
                  type: value as Exam["type"],
                  discountMark:
                    value === "فاينل" || prev.noDiscount
                      ? "0"
                      : prev.discountMark || "45",
                  opportunitiesPenaltyNum:
                    value === "فاينل" || prev.noDiscount
                      ? "0"
                      : prev.opportunitiesPenaltyNum || "1",
                  dismissalGrade:
                    value === "فاينل" && !prev.noDiscount
                      ? prev.dismissalGrade
                      : "",
                }))
              }
            >
              <SelectTrigger id="edit-exam-type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="يومي">يومي</SelectItem>
                <SelectItem value="تراكمي">تراكمي</SelectItem>
                <SelectItem value="فاينل">فاينل</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="edit-exam-date">تاريخ الامتحان</Label>
            <DateInput
              id="edit-exam-date"
              value={editDialog.date}
              onChange={(value) =>
                setEditDialog((prev) => ({
                  ...prev,
                  date: value,
                  scheduledActivateAt:
                    prev.statusMode === "تفعيل مجدول"
                      ? defaultDateTimeForDate(value)
                      : prev.scheduledActivateAt,
                  scheduledDeactivateAt:
                    prev.statusMode === "تعطيل مجدول"
                      ? defaultDateTimeForDate(value)
                      : prev.scheduledDeactivateAt,
                }))
              }
            />
          </div>
          <div className="space-y-1 md:col-span-2">
            <Label>الدورات</Label>
            <div className="max-h-44 space-y-2 overflow-y-auto rounded-xl border p-3">
              <label className="flex items-center gap-2 border-b pb-2 text-sm font-bold">
                <Checkbox
                  checked={allCoursesSelected}
                  onCheckedChange={() =>
                    setEditDialog((prev) => ({
                      ...prev,
                      courseIds: allCoursesSelected
                        ? []
                        : eligibleCourses.map((course) => course.id),
                    }))
                  }
                />
                الكل
              </label>
              {courses.map((course) => {
                const eligible = hasActiveChapterLink(
                  courseChapters,
                  course.id,
                );
                return (
                  <label
                    key={course.id}
                    className="flex items-center gap-2 text-sm"
                  >
                    <Checkbox
                      checked={editDialog.courseIds.includes(course.id)}
                      disabled={!eligible}
                      onCheckedChange={() =>
                        setEditDialog((prev) => ({
                          ...prev,
                          courseIds: toggleSelection(prev.courseIds, course.id),
                        }))
                      }
                    />
                    <span>{course.name}</span>
                    {!eligible && (
                      <Badge variant="destructive" className="text-[10px]">
                        بدون فصل نشط
                      </Badge>
                    )}
                  </label>
                );
              })}
            </div>
          </div>
          <div className="space-y-1 md:col-span-2">
            <Label>الموقع</Label>
            <div className="max-h-44 space-y-2 overflow-y-auto rounded-xl border p-3">
              <label className="flex items-center gap-2 border-b pb-2 text-sm font-bold">
                <Checkbox
                  checked={allSitesSelected}
                  onCheckedChange={() =>
                    setEditDialog((prev) => ({
                      ...prev,
                      mainSites: allSitesSelected ? [] : [...mainSitesForEdit],
                    }))
                  }
                />
                الكل
              </label>
              {mainSitesForEdit.map((site) => (
                <label key={site} className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={editDialog.mainSites.includes(site)}
                    onCheckedChange={() =>
                      setEditDialog((prev) => ({
                        ...prev,
                        mainSites: toggleSelection(prev.mainSites, site),
                      }))
                    }
                  />
                  <span>{site}</span>
                </label>
              ))}
            </div>
          </div>
          <div className="space-y-1">
            <Label>الدرجة الكاملة</Label>
            <Input
              type="number"
              value={editDialog.fullMark}
              onChange={(e) =>
                setEditDialog((prev) => ({
                  ...prev,
                  fullMark: toLatinDigits(e.target.value),
                }))
              }
            />
          </div>
          <div className="space-y-1">
            <Label>درجة النجاح</Label>
            <Input
              type="number"
              value={editDialog.passMark}
              onChange={(e) =>
                setEditDialog((prev) => ({
                  ...prev,
                  passMark: toLatinDigits(e.target.value),
                }))
              }
            />
          </div>
          <div className="rounded-xl border border-sky-200 bg-sky-50/60 p-3 md:col-span-2 dark:border-sky-900/50 dark:bg-sky-950/20">
            <label className="flex cursor-pointer items-start gap-3 text-sm">
              <Checkbox
                checked={noDiscount}
                onCheckedChange={(value) => {
                  const enabled = Boolean(value);
                  setEditDialog((prev) => ({
                    ...prev,
                    noDiscount: enabled,
                    discountMark:
                      enabled || prev.type === "فاينل"
                        ? "0"
                        : prev.discountMark && prev.discountMark !== "0"
                          ? prev.discountMark
                          : "45",
                    opportunitiesPenaltyNum:
                      enabled || prev.type === "فاينل"
                        ? "0"
                        : prev.opportunitiesPenaltyNum &&
                            prev.opportunitiesPenaltyNum !== "0"
                          ? prev.opportunitiesPenaltyNum
                          : "1",
                    dismissalGrade: enabled ? "" : prev.dismissalGrade,
                  }));
                }}
              />
              <span>
                <span className="block font-semibold">امتحان بدون خصم</span>
                <span className="block text-xs text-muted-foreground">
                  عند التفعيل لا يحاسب الطالب على الدرجة أو الغياب، وتعطل درجة
                  الخصم وخصم الفرص ودرجة الفصل.
                </span>
              </span>
            </label>
          </div>
          <div className="space-y-1">
            <Label>درجة الخصم</Label>
            <Input
              type="number"
              disabled={isFinalExam || noDiscount}
              value={isFinalExam || noDiscount ? "0" : editDialog.discountMark}
              onChange={(e) =>
                setEditDialog((prev) => ({
                  ...prev,
                  discountMark: toLatinDigits(e.target.value),
                }))
              }
            />
            {noDiscount && (
              <p className="text-xs text-sky-600">
                معطل لأن الامتحان بدون خصم.
              </p>
            )}
            {isFinalExam && !noDiscount && (
              <p className="text-xs text-amber-600">
                معطل في الفاينل؛ الحكم يكون من درجة الفصل.
              </p>
            )}
            {!noDiscount &&
              !isFinalExam &&
              Number(editDialog.passMark) <=
                Number(editDialog.discountMark) && (
                <p className="text-xs text-destructive">
                  درجة النجاح يجب أن تكون أكبر من درجة الخصم.
                </p>
              )}
          </div>
          <div className="space-y-1">
            <Label>خصم الفرص</Label>
            <Input
              type="number"
              disabled={isFinalExam || noDiscount}
              value={
                isFinalExam || noDiscount
                  ? "0"
                  : editDialog.opportunitiesPenaltyNum
              }
              onChange={(e) =>
                setEditDialog((prev) => ({
                  ...prev,
                  opportunitiesPenaltyNum: toLatinDigits(e.target.value),
                }))
              }
            />
            {noDiscount && (
              <p className="text-xs text-sky-600">
                معطل لأن الامتحان بدون خصم.
              </p>
            )}
            {isFinalExam && !noDiscount && (
              <p className="text-xs text-amber-600">
                معطل في الفاينل؛ يعالج الفصل من درجة الفصل أو الغياب/الغش.
              </p>
            )}
          </div>
          {isFinalExam && (
            <div className="space-y-1">
              <Label>درجة الفصل</Label>
              <Input
                type="number"
                disabled={noDiscount}
                value={noDiscount ? "" : editDialog.dismissalGrade}
                onChange={(e) =>
                  setEditDialog((prev) => ({
                    ...prev,
                    dismissalGrade: toLatinDigits(e.target.value),
                  }))
                }
              />
              {noDiscount && (
                <p className="text-xs text-sky-600">
                  معطل لأن الامتحان بدون خصم.
                </p>
              )}
            </div>
          )}
          <div className="space-y-1">
            <Label>حالة الامتحان</Label>
            <Select
              value={editDialog.statusMode}
              onValueChange={(value) =>
                setEditDialog((prev) => ({
                  ...prev,
                  statusMode: value as ExamStatusMode,
                  scheduledActivateAt:
                    value === "تفعيل مجدول" && !prev.scheduledActivateAt
                      ? defaultDateTimeForDate(prev.date)
                      : prev.scheduledActivateAt,
                  scheduledDeactivateAt:
                    value === "تعطيل مجدول" && !prev.scheduledDeactivateAt
                      ? defaultDateTimeForDate(prev.date)
                      : prev.scheduledDeactivateAt,
                }))
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="نشط">نشط</SelectItem>
                <SelectItem value="تفعيل مجدول">تفعيل مجدول</SelectItem>
                <SelectItem value="تعطيل مجدول">تعطيل مجدول</SelectItem>
                <SelectItem value="معطل">معطل</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {editDialog.statusMode === "تفعيل مجدول" && (
            <div className="space-y-1">
              <Label>تاريخ ووقت التفعيل</Label>
              <Input
                type="datetime-local"
                value={editDialog.scheduledActivateAt}
                onChange={(e) =>
                  setEditDialog((prev) => ({
                    ...prev,
                    scheduledActivateAt: e.target.value,
                  }))
                }
              />
            </div>
          )}
          {editDialog.statusMode === "تعطيل مجدول" && (
            <div className="space-y-1">
              <Label>تاريخ ووقت التعطيل</Label>
              <Input
                type="datetime-local"
                value={editDialog.scheduledDeactivateAt}
                onChange={(e) =>
                  setEditDialog((prev) => ({
                    ...prev,
                    scheduledDeactivateAt: e.target.value,
                  }))
                }
              />
            </div>
          )}
        </div>
      </div>
    );
  };

  const renderExamActions = (exam: Exam) => (
    <div className="flex flex-wrap gap-1">
      <div className="min-w-32">
        <ExportDialog
          title={`تصدير درجات ${exam.name}`}
          fileName={`exam-${exam.name}`}
          rows={examRows(exam.id).map((row, index) => ({
            ...row,
            index,
            exam,
            courseName: row.student ? courseName(row.student.courseId) : "",
          }))}
          columns={examGradeExportColumns}
          triggerLabel="تصدير"
          description={`تقرير درجات امتحان ${exam.name}`}
        />
      </div>
      <Button variant="outline" size="sm" onClick={() => toggleExam(exam.id)}>
        {exam.active ? "تعطيل الآن" : "تفعيل الآن"}
      </Button>
      <Button
        variant="outline"
        size="sm"
        onClick={() => openScheduleDeactivateDialog(exam.id)}
      >
        تعطيل مجدول
      </Button>
      <Button
        variant="secondary"
        size="sm"
        onClick={() => openEditExamDialog(exam.id)}
      >
        تعديل
      </Button>
      <Button
        variant="destructive"
        size="sm"
        onClick={() => openDeleteExamDialog(exam.id)}
      >
        حذف
      </Button>
    </div>
  );

  const renderCards = () => (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
      {filteredExams.map((exam) => {
        const details = examDetails(exam, examStatValue(exam.id, "total"));
        return (
          <Card
            key={exam.id}
            className="transition-all duration-200 hover:-translate-y-0.5 hover:shadow-xl hover:shadow-primary/10"
          >
            <CardHeader className="pb-2">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <CardTitle className="text-base">{exam.name}</CardTitle>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {formatAppDate(exam.date)} -{" "}
                    {exam.courseIds.map(courseName).join("، ")}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-1">
                    <Badge>{exam.type}</Badge>
                    <Badge variant="outline">{getExamStatus(exam)}</Badge>
                    <Badge variant={getEntryAvailability(exam).available ? "secondary" : "destructive"}>
                      متاح للإدخال: {getEntryAvailability(exam).answer}
                    </Badge>
                  </div>
                </div>
                {renderExamActions(exam)}
              </div>
            </CardHeader>
            <CardContent>
              <div className="mb-3 grid grid-cols-2 gap-2 text-center md:grid-cols-4">
                <div className="rounded bg-emerald-50 p-2 dark:bg-emerald-950/40">
                  <p className="text-lg font-bold text-emerald-600 dark:text-emerald-400">
                    {examStatValue(exam.id, "passCount")}
                  </p>
                  <p className="text-[10px] text-muted-foreground">ناجح</p>
                </div>
                <div className="rounded bg-rose-50 p-2 dark:bg-rose-950/40">
                  <p className="text-lg font-bold text-rose-600 dark:text-rose-400">
                    {examStatValue(exam.id, "notPassedCount")}
                  </p>
                  <p className="text-[10px] text-muted-foreground">
                    محاسب/غائب
                  </p>
                </div>
                <div className="rounded bg-cyan-50 p-2 dark:bg-cyan-950/40">
                  <p className="text-lg font-bold text-cyan-600 dark:text-cyan-400">
                    {examStatValue(exam.id, "protectedCount")}
                  </p>
                  <p className="text-[10px] text-muted-foreground">
                    سماح/إجازة
                  </p>
                </div>
                <div className="rounded bg-sky-50 p-2 dark:bg-sky-950/40">
                  <p className="text-lg font-bold text-sky-600 dark:text-sky-400">
                    {examStatValue(exam.id, "total")}
                  </p>
                  <p className="text-[10px] text-muted-foreground">إجمالي</p>
                </div>
              </div>

              <div className="mb-3 grid grid-cols-1 gap-2 text-sm md:grid-cols-2 xl:grid-cols-3">
                {details.map((item) => (
                  <div
                    key={item.label}
                    className="rounded-xl border bg-muted/40 p-2"
                  >
                    <p className="text-[10px] text-muted-foreground">
                      {item.label}
                    </p>
                    <p className="mt-0.5 font-semibold">{item.value}</p>
                  </div>
                ))}
              </div>

              <div className="rounded-xl border border-dashed bg-muted/30 p-3 text-center text-xs text-muted-foreground">
                تم إخفاء تفاصيل درجات الطلاب من سجل الامتحانات. يمكن مراجعة
                الدرجات من قائمة سجل الدرجات.
              </div>
            </CardContent>
          </Card>
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
    <div className="table-wrap">
      <table className="responsive-table text-sm">
        <thead>
          <tr>
            <th className="p-3 text-right">اسم الامتحان</th>
            <th className="p-3 text-right">التاريخ</th>
            <th className="p-3 text-right">النوع</th>
            <th className="p-3 text-right">الحالة</th>
            <th className="p-3 text-right">متاح للإدخال</th>
            <th className="p-3 text-right">الدورات</th>
            <th className="p-3 text-right">الموقع</th>
            <th className="p-3 text-right">الكاملة</th>
            <th className="p-3 text-right">النجاح</th>
            <th className="p-3 text-right">الخصم</th>
            <th className="p-3 text-right">خصم الفرص</th>
            <th className="p-3 text-right">درجة الفصل</th>
            <th className="p-3 text-right">تفعيل مجدول</th>
            <th className="p-3 text-right">تعطيل مجدول</th>
            <th className="p-3 text-right">السجلات</th>
            <th className="p-3 text-right">الإجراءات</th>
          </tr>
        </thead>
        <tbody>
          {filteredExams.map((exam) => {
            return (
              <tr key={exam.id} className="border-t align-top">
                <td className="p-3 font-bold">{exam.name}</td>
                <td className="p-3">{formatAppDate(exam.date)}</td>
                <td className="p-3">
                  <div className="flex flex-wrap gap-1">
                    <Badge>{exam.type}</Badge>
                    {exam.noDiscount && (
                      <Badge variant="secondary">بدون خصم</Badge>
                    )}
                  </div>
                </td>
                <td className="p-3">
                  <Badge variant="outline">{getExamStatus(exam)}</Badge>
                </td>
                <td className="p-3 min-w-52">
                  <div className="space-y-1">
                    <Badge variant={getEntryAvailability(exam).available ? "secondary" : "destructive"}>{getEntryAvailability(exam).answer}</Badge>
                    <p className="text-xs text-muted-foreground">{getEntryAvailability(exam).reason}</p>
                  </div>
                </td>
                <td className="p-3 min-w-44">
                  {exam.courseIds.map(courseName).join("، ") || "—"}
                </td>
                <td className="p-3 min-w-36">
                  {splitSelection(exam.mainSite).join("، ") || "الكل"}
                </td>
                <td className="p-3">{exam.fullMark}</td>
                <td className="p-3">{exam.passMark}</td>
                <td className="p-3">
                  {exam.noDiscount ? "معطل" : exam.discountMark}
                </td>
                <td className="p-3">
                  {exam.noDiscount ? "معطل" : exam.opportunitiesPenalty}
                </td>
                <td className="p-3">
                  {exam.noDiscount ? "معطل" : (exam.dismissalGrade ?? "—")}
                </td>
                <td className="p-3 min-w-36">
                  {formatDateTime(exam.scheduledActivateAt)}
                </td>
                <td className="p-3 min-w-36">
                  {formatDateTime(exam.scheduledDeactivateAt)}
                </td>
                <td className="p-3">{examStatValue(exam.id, "total")}</td>
                <td className="p-3 min-w-80">{renderExamActions(exam)}</td>
              </tr>
            );
          })}
          {filteredExams.length === 0 && (
            <tr>
              <td
                colSpan={16}
                className="p-8 text-center text-muted-foreground"
              >
                لا توجد امتحانات مطابقة للفلاتر.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="p-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-6">
            <div className="space-y-1">
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
            <div className="space-y-1">
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
            <div className="space-y-1">
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
                  <SelectItem value="تعطيل مجدول">تعطيل مجدول</SelectItem>
                  <SelectItem value="معطل">معطل</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1 lg:col-span-2">
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
            <div className="space-y-1">
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
                  <SelectItem value="cards">الكارتات</SelectItem>
                  <SelectItem value="table">الجدول</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {viewMode === "cards" ? renderCards() : renderTable()}

      <Dialog
        open={editDialog.open}
        onOpenChange={(open) => setEditDialog((prev) => ({ ...prev, open }))}
      >
        <DialogContent dir="rtl" className="max-w-5xl">
          <DialogHeader>
            <DialogTitle>تعديل الامتحان بالكامل</DialogTitle>
          </DialogHeader>
          {renderEditExamFields()}
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => setEditDialog(emptyEditState())}
            >
              إلغاء
            </Button>
            <Button onClick={handleEditExam}>حفظ التعديل الكامل</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={deactivateDialog.open}
        onOpenChange={(open) =>
          setDeactivateDialog((prev) => ({ ...prev, open }))
        }
      >
        <DialogContent dir="rtl">
          <DialogHeader>
            <DialogTitle>تعطيل مجدول للامتحان</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              سيبقى الامتحان نشطًا إلى أن يصل تاريخ ووقت التعطيل المحدد.
            </p>
            <div className="space-y-2">
              <Label htmlFor="scheduled-deactivate-at">
                تاريخ ووقت التعطيل
              </Label>
              <Input
                id="scheduled-deactivate-at"
                type="datetime-local"
                value={deactivateDialog.scheduledDeactivateAt}
                onChange={(e) =>
                  setDeactivateDialog((prev) => ({
                    ...prev,
                    scheduledDeactivateAt: e.target.value,
                  }))
                }
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() =>
                setDeactivateDialog({
                  open: false,
                  id: "",
                  name: "",
                  scheduledDeactivateAt: "",
                })
              }
            >
              إلغاء
            </Button>
            <Button variant="outline" onClick={handleClearScheduledDeactivate}>
              إلغاء التعطيل المجدول
            </Button>
            <Button onClick={handleScheduleDeactivate}>حفظ الجدولة</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={deleteDialog.open}
        onOpenChange={(open) => setDeleteDialog((prev) => open ? { ...prev, open } : { open: false, id: "", name: "", gradeCount: null })}
      >
        <AlertDialogContent dir="rtl">
          <AlertDialogHeader>
            <AlertDialogTitle>تأكيد الحذف</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm text-muted-foreground">
                <p>الامتحان: &quot;{deleteDialog.name}&quot;</p>
                {deleteDialog.gradeCount === null ? (
                  <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 font-semibold text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-100">
                    جاري التحقق من قاعدة البيانات لمعرفة هل توجد درجات مرتبطة بهذا الامتحان.
                  </p>
                ) : deleteDialog.gradeCount > 0 ? (
                  <p className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 font-semibold text-destructive">
                    لا يمكن حذف امتحان عليه درجات. يوجد {deleteDialog.gradeCount} سجل درجات مرتبط بهذا الامتحان. استخدم التعطيل إذا كان الهدف إيقاف ظهوره في إدخال الدرجات.
                  </p>
                ) : (
                  <p>لا توجد درجات مرتبطة بهذا الامتحان حسب قاعدة البيانات، ويمكن حذفه.</p>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>إلغاء</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteExam}
              disabled={isDeletingExam || deleteDialog.gradeCount === null || Number(deleteDialog.gradeCount) > 0}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isDeletingExam
                ? "جاري الحذف..."
                : deleteDialog.gradeCount === null
                  ? "جاري التحقق..."
                  : Number(deleteDialog.gradeCount) > 0
                    ? "الحذف ممنوع"
                    : "حذف"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
