"use client";

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
import { formatAppDate, formatAppDateTime, toLatinDigits } from "@/lib/format";
import { formatBaghdadDateTime, toBaghdadDateTimeLocal } from "@/lib/baghdad-time";
import { MAIN_SITE_OPTIONS } from "@/lib/iraq";
import { useActionLock } from "@/hooks/use-action-lock";
import { downloadTextFile, escapeHtml, formatGradeScore, getExamStatus, hasActiveChapterLink, splitSelection } from "@/lib/exam-utils";
import { searchAny } from "@/lib/validation";
import { useDebouncedValue } from "@/hooks/use-debounced-value";

type ReportOptions = {
  orientation: "portrait" | "landscape";
  showPhone: boolean;
  showTelegram: boolean;
  showNotes: boolean;
};

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
  statusMode: ExamStatusMode;
  scheduledActivateAt: string;
  scheduledDeactivateAt: string;
};

type ExamDetailItem = {
  label: string;
  value: React.ReactNode;
};

const defaultReportOptions: ReportOptions = {
  orientation: "portrait",
  showPhone: false,
  showTelegram: true,
  showNotes: true,
};

function toDateTimeLocalValue(value?: string | null) {
  return toBaghdadDateTimeLocal(value);
}

function formatDateTime(value?: string | null) {
  return formatBaghdadDateTime(value);
}

function defaultDeactivateDateTime(exam: Exam) {
  return toDateTimeLocalValue(exam.scheduledDeactivateAt) || `${exam.date || new Date().toISOString().slice(0, 10)}T08:00`;
}

function defaultDateTimeForDate(date: string) {
  return `${date || new Date().toISOString().slice(0, 10)}T08:00`;
}

function toggleSelection(values: string[], value: string): string[] {
  return values.includes(value) ? values.filter((item) => item !== value) : [...values, value];
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
    statusMode: "نشط",
    scheduledActivateAt: "",
    scheduledDeactivateAt: "",
  };
}

export function ExamRecordsView() {
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
  const [viewMode, setViewMode] = useState<ViewMode>("cards");
  const [reportOptions, setReportOptions] = useState<ReportOptions>(defaultReportOptions);
  const [customizeOpen, setCustomizeOpen] = useState(false);
  const [deleteDialog, setDeleteDialog] = useState({ open: false, id: "", name: "" });
  const [editDialog, setEditDialog] = useState<FullExamEditState>(() => emptyEditState());
  const [deactivateDialog, setDeactivateDialog] = useState({ open: false, id: "", name: "", scheduledDeactivateAt: "" });
  const [clockTick, setClockTick] = useState(0);
  const { locked: isDeletingExam, runLocked: runDeleteExamLocked } = useActionLock();

  useEffect(() => {
    const timer = window.setInterval(() => setClockTick((tick) => tick + 1), 30000);
    return () => window.clearInterval(timer);
  }, []);

  const filteredExams = useMemo(() => {
    return exams.filter((exam) => {
      if (debouncedSearch && !searchAny(debouncedSearch, [exam.name, exam.date, getExamStatus(exam), exam.mainSite, ...exam.courseIds.map(courseName)])) return false;
      if (filterType && exam.type !== filterType) return false;
      if (filterCourseId && !exam.courseIds.includes(filterCourseId)) return false;
      return true;
    });
  }, [exams, debouncedSearch, filterType, filterCourseId, courseName, clockTick]);

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
      .sort((a, b) => (a.student?.name || "").localeCompare(b.student?.name || "", "ar"));
  };

  const examStats = (examId: string) => {
    const rows = examRows(examId);
    const protectedKinds = ["grace", "excused", "before-registration", "missing", "no-discount"];
    const accountableRows = rows.filter((row) => !protectedKinds.includes(row.cls.kind));
    return {
      rows,
      passCount: rows.filter((row) => row.cls.kind === "pass").length,
      notPassedCount: accountableRows.filter((row) => row.cls.kind !== "pass").length,
      protectedCount: rows.filter((row) => protectedKinds.includes(row.cls.kind)).length,
    };
  };

  const examDetails = (exam: Exam, rowsCount: number): ExamDetailItem[] => {
    const mainSites = splitSelection(exam.mainSite);
    return [
      { label: "اسم الامتحان", value: exam.name },
      { label: "تاريخ الامتحان", value: formatAppDate(exam.date) },
      { label: "نوع الامتحان", value: exam.type },
      { label: "حالة الامتحان", value: getExamStatus(exam) },
      { label: "الدورات", value: exam.courseIds.map(courseName).join("، ") || "—" },
      { label: "الموقع", value: mainSites.join("، ") || "الكل" },
      { label: "الدرجة الكاملة", value: exam.fullMark },
      { label: "درجة النجاح", value: exam.passMark },
      { label: "بدون خصم", value: exam.noDiscount ? "نعم" : "لا" },
      { label: "درجة الخصم", value: exam.noDiscount ? "معطل" : exam.discountMark },
      { label: "خصم الفرص", value: exam.noDiscount ? "معطل" : exam.opportunitiesPenalty },
      { label: "درجة الفصل", value: exam.noDiscount ? "معطل" : (exam.dismissalGrade ?? "—") },
      { label: "تفعيل مجدول", value: formatDateTime(exam.scheduledActivateAt) },
      { label: "تعطيل مجدول", value: formatDateTime(exam.scheduledDeactivateAt) },
      { label: "عدد سجلات الدرجات", value: rowsCount },
    ];
  };

  const exportCSV = (examId: string) => {
    const exam = exams.find((item) => item.id === examId);
    if (!exam) return;
    const headers = ["#", "الكود", "الطالب", "الدورة", "الحالة", "الدرجة", "التصنيف", "الهاتف", "التليكرام", "ملاحظات"];
    const rows = examRows(examId).map((row, index) => [
      String(index + 1),
      row.student?.code || "",
      row.student?.name || "",
      row.student ? courseName(row.student.courseId) : "",
      row.grade.status,
      formatGradeScore(row.grade, exam, ""),
      row.cls.text,
      row.student?.phone || "",
      row.student?.telegram || "",
      row.grade.notes || "",
    ]);
    const csv = "\ufeff" + [headers, ...rows].map((row) => row.map((value) => `"${String(value).replaceAll('"', '""')}"`).join(",")).join("\n");
    downloadTextFile(csv, `exam-${exam.name}-${new Date().toISOString().slice(0, 10)}.csv`, "text/csv;charset=utf-8");
    toast.success("تم تصدير CSV");
  };

  const exportExcel = (examId: string) => {
    const exam = exams.find((item) => item.id === examId);
    if (!exam) return;
    const rows = examRows(examId).map((row, index) => `
      <tr>
        <td>${index + 1}</td><td>${escapeHtml(row.student?.code)}</td><td>${escapeHtml(row.student?.name)}</td>
        <td>${escapeHtml(row.student ? courseName(row.student.courseId) : "")}</td><td>${escapeHtml(row.grade.status)}</td>
        <td>${escapeHtml(formatGradeScore(row.grade, exam, ""))}</td><td>${escapeHtml(row.cls.text)}</td>
        <td>${escapeHtml(row.student?.phone)}</td><td>${escapeHtml(row.student?.telegram)}</td><td>${escapeHtml(row.grade.notes)}</td>
      </tr>`).join("");
    const html = `<!doctype html><html dir="rtl"><head><meta charset="utf-8" /></head><body><table border="1"><thead><tr><th>#</th><th>الكود</th><th>الطالب</th><th>الدورة</th><th>الحالة</th><th>الدرجة</th><th>التصنيف</th><th>الهاتف</th><th>التليكرام</th><th>ملاحظات</th></tr></thead><tbody>${rows}</tbody></table></body></html>`;
    downloadTextFile(html, `exam-${exam.name}.xls`, "application/vnd.ms-excel;charset=utf-8");
    toast.success("تم تصدير Excel");
  };

  const exportPDF = (examId: string) => {
    const exam = exams.find((item) => item.id === examId);
    if (!exam) return;
    const rows = examRows(examId);
    const passCount = rows.filter((row) => row.cls.kind === "pass").length;
    const belowPassCount = rows.filter((row) => row.cls.kind === "academic-accounting" || row.cls.kind === "fail").length;
    const deductedCount = rows.filter((row) => row.cls.kind === "deducted" || row.cls.kind === "dismissal" || row.cls.kind === "cheat").length;
    const protectedCount = rows.filter((row) => ["grace", "excused", "before-registration"].includes(row.cls.kind)).length;

    const tableRows = rows.map((row, index) => `
      <tr>
        <td>${index + 1}</td>
        <td>${escapeHtml(row.student?.code)}</td>
        <td>${escapeHtml(row.student?.name)}</td>
        <td>${escapeHtml(row.student ? courseName(row.student.courseId) : "")}</td>
        <td>${escapeHtml(row.grade.status)}</td>
        <td>${escapeHtml(formatGradeScore(row.grade, exam, "-"))}</td>
        <td><span class="pill">${escapeHtml(row.cls.text)}</span></td>
        ${reportOptions.showPhone ? `<td>${escapeHtml(row.student?.phone)}</td>` : ""}
        ${reportOptions.showTelegram ? `<td>${escapeHtml(row.student?.telegram)}</td>` : ""}
        ${reportOptions.showNotes ? `<td>${escapeHtml(row.grade.notes || "-")}</td>` : ""}
      </tr>`).join("");

    const extraHeaders = `${reportOptions.showPhone ? "<th>الهاتف</th>" : ""}${reportOptions.showTelegram ? "<th>التليكرام</th>" : ""}${reportOptions.showNotes ? "<th>ملاحظات</th>" : ""}`;
    const html = `<!doctype html>
<html dir="rtl" lang="ar">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(exam.name)}</title>
<style>
@page { size: A4 ${reportOptions.orientation}; margin: 12mm; }
* { box-sizing: border-box; }
body { margin: 0; font-family: "Cairo", "Tahoma", Arial, sans-serif; color: #111827; background: #f8fafc; direction: rtl; }
.toolbar { position: sticky; top: 0; display: flex; gap: 8px; padding: 12px; background: #111827; color: white; z-index: 3; }
.toolbar button { border: 0; border-radius: 12px; padding: 10px 16px; cursor: pointer; font-weight: 700; }
.report { max-width: 1200px; margin: 24px auto; background: white; border-radius: 24px; padding: 28px; box-shadow: 0 24px 80px rgba(15,23,42,.12); }
.header { display: flex; justify-content: space-between; gap: 16px; border-bottom: 3px solid #7c3aed; padding-bottom: 18px; }
.brand { font-size: 28px; font-weight: 900; color: #6d28d9; }
h1 { margin: 8px 0 0; font-size: 22px; }
.meta { color: #64748b; line-height: 1.9; font-size: 13px; }
.stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin: 20px 0; }
.stat { border: 1px solid #e5e7eb; border-radius: 18px; padding: 14px; background: #faf5ff; }
.stat strong { display:block; font-size: 22px; color: #581c87; }
table { width: 100%; border-collapse: collapse; overflow: hidden; border-radius: 18px; font-size: 12px; }
th { background: #ede9fe; color: #2e1065; }
th,td { border: 1px solid #e5e7eb; padding: 9px; text-align: right; }
tr:nth-child(even) td { background: #f8fafc; }
.pill { display:inline-block; border-radius:999px; padding:4px 10px; background:#f3e8ff; color:#6b21a8; font-weight:700; }
.footer { margin-top: 18px; color: #64748b; font-size: 11px; display:flex; justify-content:space-between; }
@media print { body { background: white; } .toolbar { display: none; } .report { box-shadow: none; margin: 0; border-radius: 0; padding: 0; max-width: none; } }
</style>
</head>
<body>
<div class="toolbar"><button onclick="window.print()">طباعة / حفظ PDF</button><button onclick="window.close()">إغلاق</button></div>
<main class="report">
  <section class="header">
    <div><div class="brand">TeacherPro</div><h1>سجل الامتحان: ${escapeHtml(exam.name)}</h1><div class="meta">التاريخ: ${escapeHtml(formatAppDate(exam.date))} | النوع: ${escapeHtml(exam.type)} | الحالة: ${escapeHtml(getExamStatus(exam))}</div></div>
    <div class="meta">الدورات: ${escapeHtml(exam.courseIds.map(courseName).join("، "))}<br/>النجاح: ${exam.passMark} | الخصم: ${exam.discountMark} | الدرجة الكاملة: ${exam.fullMark}</div>
  </section>
  <section class="stats">
    <div class="stat"><strong>${rows.length}</strong><span>إجمالي السجلات</span></div>
    <div class="stat"><strong>${passCount}</strong><span>ناجح</span></div>
    <div class="stat"><strong>${belowPassCount}</strong><span>محاسبة رسوب / رسوب</span></div>
    <div class="stat"><strong>${deductedCount}</strong><span>خصم / فصل / غش</span></div>
    <div class="stat"><strong>${protectedCount}</strong><span>سماح / إجازة</span></div>
  </section>
  <table><thead><tr><th>#</th><th>الكود</th><th>الطالب</th><th>الدورة</th><th>الحالة</th><th>الدرجة</th><th>التصنيف</th>${extraHeaders}</tr></thead><tbody>${tableRows}</tbody></table>
  <div class="footer"><span>تم إنشاء التقرير آلياً</span><span>${formatAppDateTime(new Date())}</span></div>
</main>
</body></html>`;
    const win = window.open("", "_blank");
    if (!win) {
      toast.error("المتصفح منع نافذة الطباعة");
      return;
    }
    win.document.write(html);
    win.document.close();
    toast.success("تم فتح تقرير PDF الاحترافي");
  };

  const availableMainSitesForEdit = (state: FullExamEditState) => {
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
      opportunitiesPenaltyNum: typeof exam.opportunitiesPenalty === "number" ? String(exam.opportunitiesPenalty) : "1",
      dismissalGrade: exam.dismissalGrade === null || exam.dismissalGrade === undefined ? "" : String(exam.dismissalGrade),
      statusMode: statusModeFromExam(exam),
      scheduledActivateAt: toDateTimeLocalValue(exam.scheduledActivateAt) || defaultDateTimeForDate(exam.date),
      scheduledDeactivateAt: toDateTimeLocalValue(exam.scheduledDeactivateAt) || defaultDeactivateDateTime(exam),
    });
  };

  const validateEditExam = (state: FullExamEditState) => {
    const fullMark = Number(toLatinDigits(state.fullMark));
    const passMark = Number(toLatinDigits(state.passMark));
    const isFinalExam = state.type === "فاينل";
    const discountMark = isFinalExam ? 0 : Number(toLatinDigits(state.discountMark));
    if (!state.name.trim()) return "اسم الامتحان مطلوب";
    if (state.courseIds.length === 0) return "اختر دورة واحدة على الأقل";
    const invalidCourses = state.courseIds.filter((courseId) => !hasActiveChapterLink(courseChapters, courseId));
    if (invalidCourses.length > 0) return `لا يمكن ربط الامتحان بدورات بدون فصل نشط: ${invalidCourses.map(courseName).join("، ")}`;
    if (state.mainSites.length === 0) return "اختر موقعاً واحداً على الأقل";
    if (![fullMark, passMark, discountMark].every(Number.isFinite)) return "درجات الامتحان يجب أن تكون أرقاماً";
    if (fullMark <= 0) return "الدرجة الكاملة يجب أن تكون أكبر من صفر";
    if (passMark < 0 || passMark > fullMark) return "درجة النجاح يجب أن تكون بين صفر والدرجة الكاملة";
    if (discountMark < 0 || discountMark > fullMark) return "درجة الخصم يجب أن تكون بين صفر والدرجة الكاملة";
    if (!isFinalExam && passMark <= discountMark) return "درجة النجاح يجب أن تكون أكبر من درجة الخصم";
    if (!isFinalExam && Number(toLatinDigits(state.opportunitiesPenaltyNum) || 0) <= 0) return "خصم الفرص يجب أن يكون أكبر من صفر";
    if (state.statusMode === "تفعيل مجدول" && !state.scheduledActivateAt) return "حدد تاريخ ووقت التفعيل المجدول";
    if (state.statusMode === "تعطيل مجدول" && !state.scheduledDeactivateAt) return "حدد تاريخ ووقت التعطيل المجدول";
    return null;
  };

  const handleEditExam = () => {
    const error = validateEditExam(editDialog);
    if (error) return toast.error(error);
    const isFinalExam = editDialog.type === "فاينل";
    const statusPatch = editDialog.statusMode === "نشط"
      ? { active: true, scheduledActivateAt: "", scheduledDeactivateAt: "" }
      : editDialog.statusMode === "معطل"
        ? { active: false, scheduledActivateAt: "", scheduledDeactivateAt: "" }
        : editDialog.statusMode === "تفعيل مجدول"
          ? { active: false, scheduledActivateAt: editDialog.scheduledActivateAt, scheduledDeactivateAt: "" }
          : { active: true, scheduledActivateAt: "", scheduledDeactivateAt: editDialog.scheduledDeactivateAt };

    updateExam(editDialog.id, {
      name: editDialog.name.trim(),
      type: editDialog.type,
      courseIds: editDialog.courseIds,
      mainSite: editDialog.mainSites.join(","),
      date: editDialog.date,
      fullMark: Number(toLatinDigits(editDialog.fullMark)),
      passMark: Number(toLatinDigits(editDialog.passMark)),
      discountMark: isFinalExam ? 0 : Number(toLatinDigits(editDialog.discountMark)),
      opportunitiesPenalty: isFinalExam ? "فصل مؤقت" : Number(toLatinDigits(editDialog.opportunitiesPenaltyNum) || 1),
      dismissalGrade: isFinalExam && editDialog.dismissalGrade ? Number(toLatinDigits(editDialog.dismissalGrade)) : null,
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
    setDeactivateDialog({ open: false, id: "", name: "", scheduledDeactivateAt: "" });
    toast.success("تمت جدولة تعطيل الامتحان");
  };

  const handleClearScheduledDeactivate = () => {
    updateExam(deactivateDialog.id, { scheduledDeactivateAt: "" });
    setDeactivateDialog({ open: false, id: "", name: "", scheduledDeactivateAt: "" });
    toast.success("تم إلغاء التعطيل المجدول");
  };

  const openDeleteExamDialog = (examId: string) => {
    const exam = exams.find((item) => item.id === examId);
    setDeleteDialog({ open: true, id: examId, name: exam?.name || "" });
  };

  const handleDeleteExam = runDeleteExamLocked(async () => {
    const ok = deleteExam(deleteDialog.id);
    ok ? toast.success("تم حذف الامتحان") : toast.error("تعذر حذف الامتحان");
    setDeleteDialog({ open: false, id: "", name: "" });
  });

  const renderEditExamFields = () => {
    const isFinalExam = editDialog.type === "فاينل";
    const mainSitesForEdit = availableMainSitesForEdit(editDialog);
    const eligibleCourses = courses.filter((course) => hasActiveChapterLink(courseChapters, course.id));
    const allCoursesSelected = eligibleCourses.length > 0 && eligibleCourses.every((course) => editDialog.courseIds.includes(course.id));
    const allSitesSelected = mainSitesForEdit.length > 0 && mainSitesForEdit.every((site) => editDialog.mainSites.includes(site));

    return (
      <div className="max-h-[70vh] space-y-4 overflow-y-auto pr-1">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <div className="space-y-1 md:col-span-2">
            <Label htmlFor="edit-exam-name">اسم الامتحان</Label>
            <Input id="edit-exam-name" value={editDialog.name} onChange={(e) => setEditDialog((prev) => ({ ...prev, name: e.target.value }))} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="edit-exam-type">نوع الامتحان</Label>
            <Select value={editDialog.type} onValueChange={(value) => setEditDialog((prev) => ({
              ...prev,
              type: value as Exam["type"],
              discountMark: value === "فاينل" ? "0" : (prev.discountMark || "45"),
              opportunitiesPenaltyNum: value === "فاينل" ? "0" : (prev.opportunitiesPenaltyNum || "1"),
            }))}>
              <SelectTrigger id="edit-exam-type"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="يومي">يومي</SelectItem><SelectItem value="تراكمي">تراكمي</SelectItem><SelectItem value="فاينل">فاينل</SelectItem></SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="edit-exam-date">تاريخ الامتحان</Label>
            <DateInput
              id="edit-exam-date"
              value={editDialog.date}
              onChange={(value) => setEditDialog((prev) => ({
                ...prev,
                date: value,
                scheduledActivateAt: prev.statusMode === "تفعيل مجدول" ? defaultDateTimeForDate(value) : prev.scheduledActivateAt,
                scheduledDeactivateAt: prev.statusMode === "تعطيل مجدول" ? defaultDateTimeForDate(value) : prev.scheduledDeactivateAt,
              }))}
            />
          </div>
          <div className="space-y-1 md:col-span-2">
            <Label>الدورات</Label>
            <div className="max-h-44 space-y-2 overflow-y-auto rounded-xl border p-3">
              <label className="flex items-center gap-2 border-b pb-2 text-sm font-bold">
                <Checkbox checked={allCoursesSelected} onCheckedChange={() => setEditDialog((prev) => ({ ...prev, courseIds: allCoursesSelected ? [] : eligibleCourses.map((course) => course.id) }))} />
                الكل
              </label>
              {courses.map((course) => {
                const eligible = hasActiveChapterLink(courseChapters, course.id);
                return (
                  <label key={course.id} className="flex items-center gap-2 text-sm">
                    <Checkbox checked={editDialog.courseIds.includes(course.id)} disabled={!eligible} onCheckedChange={() => setEditDialog((prev) => ({ ...prev, courseIds: toggleSelection(prev.courseIds, course.id) }))} />
                    <span>{course.name}</span>
                    {!eligible && <Badge variant="destructive" className="text-[10px]">بدون فصل نشط</Badge>}
                  </label>
                );
              })}
            </div>
          </div>
          <div className="space-y-1 md:col-span-2">
            <Label>الموقع</Label>
            <div className="max-h-44 space-y-2 overflow-y-auto rounded-xl border p-3">
              <label className="flex items-center gap-2 border-b pb-2 text-sm font-bold">
                <Checkbox checked={allSitesSelected} onCheckedChange={() => setEditDialog((prev) => ({ ...prev, mainSites: allSitesSelected ? [] : [...mainSitesForEdit] }))} />
                الكل
              </label>
              {mainSitesForEdit.map((site) => (
                <label key={site} className="flex items-center gap-2 text-sm">
                  <Checkbox checked={editDialog.mainSites.includes(site)} onCheckedChange={() => setEditDialog((prev) => ({ ...prev, mainSites: toggleSelection(prev.mainSites, site) }))} />
                  <span>{site}</span>
                </label>
              ))}
            </div>
          </div>
          <div className="space-y-1">
            <Label>الدرجة الكاملة</Label>
            <Input type="number" value={editDialog.fullMark} onChange={(e) => setEditDialog((prev) => ({ ...prev, fullMark: toLatinDigits(e.target.value) }))} />
          </div>
          <div className="space-y-1">
            <Label>درجة النجاح</Label>
            <Input type="number" value={editDialog.passMark} onChange={(e) => setEditDialog((prev) => ({ ...prev, passMark: toLatinDigits(e.target.value) }))} />
          </div>
          <div className="space-y-1">
            <Label>درجة الخصم</Label>
            <Input type="number" disabled={isFinalExam} value={isFinalExam ? "0" : editDialog.discountMark} onChange={(e) => setEditDialog((prev) => ({ ...prev, discountMark: toLatinDigits(e.target.value) }))} />
            {!isFinalExam && Number(editDialog.passMark) <= Number(editDialog.discountMark) && <p className="text-xs text-destructive">درجة النجاح يجب أن تكون أكبر من درجة الخصم.</p>}
          </div>
          <div className="space-y-1">
            <Label>خصم الفرص</Label>
            <Input type="number" disabled={isFinalExam} value={isFinalExam ? "0" : editDialog.opportunitiesPenaltyNum} onChange={(e) => setEditDialog((prev) => ({ ...prev, opportunitiesPenaltyNum: toLatinDigits(e.target.value) }))} />
          </div>
          {isFinalExam && (
            <div className="space-y-1">
              <Label>درجة الفصل</Label>
              <Input type="number" value={editDialog.dismissalGrade} onChange={(e) => setEditDialog((prev) => ({ ...prev, dismissalGrade: toLatinDigits(e.target.value) }))} />
            </div>
          )}
          <div className="space-y-1">
            <Label>حالة الامتحان</Label>
            <Select value={editDialog.statusMode} onValueChange={(value) => setEditDialog((prev) => ({
              ...prev,
              statusMode: value as ExamStatusMode,
              scheduledActivateAt: value === "تفعيل مجدول" && !prev.scheduledActivateAt ? defaultDateTimeForDate(prev.date) : prev.scheduledActivateAt,
              scheduledDeactivateAt: value === "تعطيل مجدول" && !prev.scheduledDeactivateAt ? defaultDateTimeForDate(prev.date) : prev.scheduledDeactivateAt,
            }))}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="نشط">نشط</SelectItem><SelectItem value="تفعيل مجدول">تفعيل مجدول</SelectItem><SelectItem value="تعطيل مجدول">تعطيل مجدول</SelectItem><SelectItem value="معطل">معطل</SelectItem></SelectContent>
            </Select>
          </div>
          {editDialog.statusMode === "تفعيل مجدول" && (
            <div className="space-y-1">
              <Label>تاريخ ووقت التفعيل</Label>
              <Input type="datetime-local" value={editDialog.scheduledActivateAt} onChange={(e) => setEditDialog((prev) => ({ ...prev, scheduledActivateAt: e.target.value }))} />
            </div>
          )}
          {editDialog.statusMode === "تعطيل مجدول" && (
            <div className="space-y-1">
              <Label>تاريخ ووقت التعطيل</Label>
              <Input type="datetime-local" value={editDialog.scheduledDeactivateAt} onChange={(e) => setEditDialog((prev) => ({ ...prev, scheduledDeactivateAt: e.target.value }))} />
            </div>
          )}
        </div>
      </div>
    );
  };

  const renderExamActions = (exam: Exam) => (
    <div className="flex flex-wrap gap-1">
      <Button variant="ghost" size="sm" onClick={() => exportPDF(exam.id)}>PDF</Button>
      <Button variant="ghost" size="sm" onClick={() => exportExcel(exam.id)}>Excel</Button>
      <Button variant="ghost" size="sm" onClick={() => exportCSV(exam.id)}>CSV</Button>
      <Button variant="outline" size="sm" onClick={() => toggleExam(exam.id)}>{exam.active ? "تعطيل الآن" : "تفعيل الآن"}</Button>
      <Button variant="outline" size="sm" onClick={() => openScheduleDeactivateDialog(exam.id)}>تعطيل مجدول</Button>
      <Button variant="secondary" size="sm" onClick={() => openEditExamDialog(exam.id)}>تعديل</Button>
      <Button variant="destructive" size="sm" onClick={() => openDeleteExamDialog(exam.id)}>حذف</Button>
    </div>
  );

  const renderCards = () => (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
      {filteredExams.map((exam) => {
        const { rows, passCount, notPassedCount, protectedCount } = examStats(exam.id);
        const details = examDetails(exam, rows.length);
        return (
          <Card key={exam.id} className="transition-all duration-200 hover:-translate-y-0.5 hover:shadow-xl hover:shadow-primary/10">
            <CardHeader className="pb-2">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <CardTitle className="text-base">{exam.name}</CardTitle>
                  <p className="mt-1 text-xs text-muted-foreground">{formatAppDate(exam.date)} - {exam.courseIds.map(courseName).join("، ")}</p>
                  <div className="mt-2 flex flex-wrap gap-1">
                    <Badge>{exam.type}</Badge>
                    <Badge variant="outline">{getExamStatus(exam)}</Badge>
                  </div>
                </div>
                {renderExamActions(exam)}
              </div>
            </CardHeader>
            <CardContent>
              <div className="mb-3 grid grid-cols-2 gap-2 text-center md:grid-cols-4">
                <div className="rounded bg-emerald-50 p-2 dark:bg-emerald-950/40"><p className="text-lg font-bold text-emerald-600 dark:text-emerald-400">{passCount}</p><p className="text-[10px] text-muted-foreground">ناجح</p></div>
                <div className="rounded bg-rose-50 p-2 dark:bg-rose-950/40"><p className="text-lg font-bold text-rose-600 dark:text-rose-400">{notPassedCount}</p><p className="text-[10px] text-muted-foreground">محاسب/غائب</p></div>
                <div className="rounded bg-cyan-50 p-2 dark:bg-cyan-950/40"><p className="text-lg font-bold text-cyan-600 dark:text-cyan-400">{protectedCount}</p><p className="text-[10px] text-muted-foreground">سماح/إجازة</p></div>
                <div className="rounded bg-sky-50 p-2 dark:bg-sky-950/40"><p className="text-lg font-bold text-sky-600 dark:text-sky-400">{rows.length}</p><p className="text-[10px] text-muted-foreground">إجمالي</p></div>
              </div>

              <div className="mb-3 grid grid-cols-1 gap-2 text-sm md:grid-cols-2 xl:grid-cols-3">
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
            </CardContent>
          </Card>
        );
      })}
      {filteredExams.length === 0 && <div className="empty-state xl:col-span-2">لا توجد امتحانات مطابقة للفلاتر.</div>}
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
            const { rows } = examStats(exam.id);
            return (
              <tr key={exam.id} className="border-t align-top">
                <td className="p-3 font-bold">{exam.name}</td>
                <td className="p-3">{formatAppDate(exam.date)}</td>
                <td className="p-3"><div className="flex flex-wrap gap-1"><Badge>{exam.type}</Badge>{exam.noDiscount && <Badge variant="secondary">بدون خصم</Badge>}</div></td>
                <td className="p-3"><Badge variant="outline">{getExamStatus(exam)}</Badge></td>
                <td className="p-3 min-w-44">{exam.courseIds.map(courseName).join("، ") || "—"}</td>
                <td className="p-3 min-w-36">{splitSelection(exam.mainSite).join("، ") || "الكل"}</td>
                <td className="p-3">{exam.fullMark}</td>
                <td className="p-3">{exam.passMark}</td>
                <td className="p-3">{exam.noDiscount ? "معطل" : exam.discountMark}</td>
                <td className="p-3">{exam.noDiscount ? "معطل" : exam.opportunitiesPenalty}</td>
                <td className="p-3">{exam.noDiscount ? "معطل" : (exam.dismissalGrade ?? "—")}</td>
                <td className="p-3 min-w-36">{formatDateTime(exam.scheduledActivateAt)}</td>
                <td className="p-3 min-w-36">{formatDateTime(exam.scheduledDeactivateAt)}</td>
                <td className="p-3">{rows.length}</td>
                <td className="p-3 min-w-80">{renderExamActions(exam)}</td>
              </tr>
            );
          })}
          {filteredExams.length === 0 && (
            <tr>
              <td colSpan={15} className="p-8 text-center text-muted-foreground">لا توجد امتحانات مطابقة للفلاتر.</td>
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
            <div className="space-y-1 lg:col-span-2">
              <Label htmlFor="exam-records-search" className="text-xs">بحث</Label>
              <Input id="exam-records-search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="اسم الامتحان / التاريخ / الدورة / الحالة" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="exam-records-type" className="text-xs">نوع الامتحان</Label>
              <Select value={filterType || "all"} onValueChange={(v) => setFilterType(v === "all" ? "" : v)}>
                <SelectTrigger id="exam-records-type"><SelectValue placeholder="الكل" /></SelectTrigger>
                <SelectContent><SelectItem value="all">الكل</SelectItem><SelectItem value="يومي">يومي</SelectItem><SelectItem value="تراكمي">تراكمي</SelectItem><SelectItem value="فاينل">فاينل</SelectItem></SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="exam-records-course" className="text-xs">الدورة</Label>
              <Select value={filterCourseId || "all"} onValueChange={(v) => setFilterCourseId(v === "all" ? "" : v)}>
                <SelectTrigger id="exam-records-course"><SelectValue placeholder="الكل" /></SelectTrigger>
                <SelectContent><SelectItem value="all">الكل</SelectItem>{courses.map((course) => <SelectItem key={course.id} value={course.id}>{course.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="exam-records-view" className="text-xs">طريقة العرض</Label>
              <Select value={viewMode} onValueChange={(v) => setViewMode(v as ViewMode)}>
                <SelectTrigger id="exam-records-view"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="cards">الكارتات</SelectItem><SelectItem value="table">الجدول</SelectItem></SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <span className="text-xs font-medium">تخصيص التقرير</span>
              <Button variant="outline" size="sm" className="h-9 w-full" onClick={() => setCustomizeOpen(true)}>تخصيص PDF</Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {viewMode === "cards" ? renderCards() : renderTable()}

      <Dialog open={customizeOpen} onOpenChange={setCustomizeOpen}>
        <DialogContent dir="rtl">
          <DialogHeader><DialogTitle>تخصيص تقرير PDF</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>اتجاه الصفحة</Label>
              <Select value={reportOptions.orientation} onValueChange={(value) => setReportOptions((prev) => ({ ...prev, orientation: value as ReportOptions["orientation"] }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="portrait">A4 بالطول</SelectItem><SelectItem value="landscape">A4 بالعرض</SelectItem></SelectContent>
              </Select>
            </div>
            {[["showTelegram", "إظهار التليكرام"], ["showPhone", "إظهار الهاتف"], ["showNotes", "إظهار الملاحظات"]].map(([key, label]) => (
              <label key={key} className="flex items-center gap-2 text-sm"><Checkbox checked={Boolean(reportOptions[key as keyof ReportOptions])} onCheckedChange={(value) => setReportOptions((prev) => ({ ...prev, [key]: Boolean(value) }))} />{label}</label>
            ))}
          </div>
          <DialogFooter><Button onClick={() => setCustomizeOpen(false)}>حفظ التخصيص</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={editDialog.open} onOpenChange={(open) => setEditDialog((prev) => ({ ...prev, open }))}>
        <DialogContent dir="rtl" className="max-w-5xl">
          <DialogHeader><DialogTitle>تعديل الامتحان بالكامل</DialogTitle></DialogHeader>
          {renderEditExamFields()}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setEditDialog(emptyEditState())}>إلغاء</Button>
            <Button onClick={handleEditExam}>حفظ التعديل الكامل</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={deactivateDialog.open} onOpenChange={(open) => setDeactivateDialog((prev) => ({ ...prev, open }))}>
        <DialogContent dir="rtl">
          <DialogHeader><DialogTitle>تعطيل مجدول للامتحان</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">سيبقى الامتحان نشطًا إلى أن يصل تاريخ ووقت التعطيل المحدد.</p>
            <div className="space-y-2">
              <Label htmlFor="scheduled-deactivate-at">تاريخ ووقت التعطيل</Label>
              <Input
                id="scheduled-deactivate-at"
                type="datetime-local"
                value={deactivateDialog.scheduledDeactivateAt}
                onChange={(e) => setDeactivateDialog((prev) => ({ ...prev, scheduledDeactivateAt: e.target.value }))}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDeactivateDialog({ open: false, id: "", name: "", scheduledDeactivateAt: "" })}>إلغاء</Button>
            <Button variant="outline" onClick={handleClearScheduledDeactivate}>إلغاء التعطيل المجدول</Button>
            <Button onClick={handleScheduleDeactivate}>حفظ الجدولة</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleteDialog.open} onOpenChange={(open) => setDeleteDialog((prev) => ({ ...prev, open }))}>
        <AlertDialogContent dir="rtl">
          <AlertDialogHeader><AlertDialogTitle>تأكيد الحذف</AlertDialogTitle><AlertDialogDescription>هل أنت متأكد من حذف الامتحان &quot;{deleteDialog.name}&quot;؟ سيتم حذف الدرجات وأوراق التصحيح التابعة له.</AlertDialogDescription></AlertDialogHeader>
          <AlertDialogFooter><AlertDialogCancel>إلغاء</AlertDialogCancel><AlertDialogAction onClick={handleDeleteExam} disabled={isDeletingExam} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">{isDeletingExam ? "جاري الحذف..." : "حذف"}</AlertDialogAction></AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
