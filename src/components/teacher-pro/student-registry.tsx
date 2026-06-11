"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useTeacherStore, type Student } from "@/lib/teacher-store";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DateInput } from "@/components/ui/date-input";
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
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
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
import { toast } from "sonner";
import {
  formatAppDate,
  getPhoneValidationError,
  sanitizePhoneInput,
  toLatinDigits,
} from "@/lib/format";
import {
  COURSE_TERMS,
  getAvailablePrograms, getAvailableStudyTypesForProgram,
  getBaghdadSites, getProvinceOptions, getLocationScopes, getBaghdadMode,
} from "@/lib/course-config";
import {
  getStudentDuplicateMessage,
  normalizeTelegramIdentifier,
  sanitizeTelegramInput,
} from "@/lib/student-utils";
import {
  getRequiredTextError,
  searchAny,
  TEXT_ONLY_PATTERN,
} from "@/lib/validation";
import { useActionLock } from "@/hooks/use-action-lock";
import { SearchX, UserPlus } from "lucide-react";
import { EmptyState } from "./ui-kit";
import { StudentProfileDialog } from "./student-profile-dialog";
import { CustomFilterPresets, type FilterPresetValues } from "./custom-filter-presets";

type RegistryViewMode = "cards" | "table";

type StudentEditForm = {
  name: string;
  school: string;
  gender: "ذكر" | "أنثى";
  phone: string;
  parentPhone: string;
  telegram: string;
  courseProgram: string;
  courseTerm: string;
  studyType: string;
  locationScope: string;
  baghdadMode: string;
  courseId: string;
  subSite: string;
  createdAt: string;
  accountingGraceDays: string;
};

const emptyEditForm: StudentEditForm = {
  name: "",
  school: "",
  gender: "ذكر",
  phone: "",
  parentPhone: "",
  telegram: "",
  courseProgram: "",
  courseTerm: "",
  studyType: "",
  locationScope: "",
  baghdadMode: "",
  courseId: "",
  subSite: "",
  createdAt: new Date().toISOString().slice(0, 10),
  accountingGraceDays: "0",
};

function getStudentEditForm(student: Student): StudentEditForm {
  return {
    name: student.name,
    school: student.school || "",
    gender: student.gender,
    phone: student.phone,
    parentPhone: student.parentPhone,
    telegram: sanitizeTelegramInput(student.telegram),
    courseProgram: student.courseProgram || "",
    courseTerm: student.courseTerm || "",
    studyType: student.studyType || "",
    locationScope: student.locationScope || "",
    baghdadMode: student.baghdadMode || "",
    courseId: student.courseId,
    subSite: student.subSite || "",
    createdAt: student.createdAt || new Date().toISOString().slice(0, 10),
    accountingGraceDays: String(student.accountingGraceDays ?? 0),
  };
}

function whatsappLink(phone: string): string {
  const sanitized = sanitizePhoneInput(phone);
  const appPhone = sanitized.startsWith("07") && sanitized.length === 11
    ? `964${sanitized.slice(1)}`
    : sanitized;
  return `whatsapp://send?phone=${encodeURIComponent(appPhone)}`;
}

function telegramLink(telegram: string): string {
  const username = normalizeTelegramIdentifier(telegram).replace(/^@+/, "");
  return `tg://resolve?domain=${encodeURIComponent(username)}`;
}

function normalizeGraceDaysInput(value: string): string {
  const digits = toLatinDigits(value).replace(/\D/g, "");
  if (!digits) return "0";
  return String(Math.min(Number(digits), 30));
}

function isValidGraceDays(value: string): boolean {
  if (!/^\d+$/.test(value)) return false;
  const days = Number(value);
  return Number.isInteger(days) && days >= 0 && days <= 30;
}

function graceEndDate(student: Student): string {
  const start = new Date(`${String(student.createdAt || '').slice(0, 10)}T00:00:00`);
  const days = Number(student.accountingGraceDays || 0);
  if (!Number.isFinite(start.getTime()) || days <= 0) return formatAppDate(student.createdAt, String(student.createdAt || '').slice(0, 10) || '-');
  const end = new Date(start);
  end.setDate(end.getDate() + days - 1);
  return formatAppDate(end);
}

function isStudentCurrentlyInGrace(student: Student): boolean {
  const days = Number(student.accountingGraceDays || 0);
  if (days <= 0) return false;
  const start = new Date(`${String(student.createdAt || '').slice(0, 10)}T00:00:00`);
  const today = new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00`);
  const endExclusive = new Date(start);
  endExclusive.setDate(endExclusive.getDate() + days);
  return Number.isFinite(start.getTime()) && today >= start && today < endExclusive;
}

function ContactLink({
  href,
  children,
}: {
  href: string;
  children: React.ReactNode;
}) {
  return (
    <a
      href={href}
      className="break-all font-bold text-primary underline-offset-4 hover:underline"
    >
      {children || "—"}
    </a>
  );
}

function StudentFileItem({
  label,
  children,
  className = "",
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      <span className="text-muted-foreground">{label}:</span>{" "}
      <strong>{children}</strong>
    </div>
  );
}

export function StudentRegistryView() {
  const {
    students,
    courses,
    exams,
    grades,
    opportunityLogs,
    dismissStudent,
    reactivateStudent,
    updateStudent,
    deleteStudent,
    setSection,
    courseName,
    activeChapterForCourse,
  } = useTeacherStore();

  const [search, setSearch] = useState("");
  const [filterCourseId, setFilterCourseId] = useState("");
  const [filterStatus, setFilterStatus] = useState("");
  const [filterGender, setFilterGender] = useState("");
  const [viewMode, setViewMode] = useState<RegistryViewMode>("cards");
  const [pageSize, setPageSize] = useState(10);
  const [page, setPage] = useState(1);

  const [dismissDialog, setDismissDialog] = useState<{
    student: Student | null;
    open: boolean;
  }>({ student: null, open: false });
  const [dismissType, setDismissType] = useState("فصل مؤقت");
  const [dismissReason, setDismissReason] = useState("");
  const [dismissNotes, setDismissNotes] = useState("");

  const [fileDialog, setFileDialog] = useState<{
    student: Student | null;
    open: boolean;
  }>({ student: null, open: false });
  const [editDialog, setEditDialog] = useState<{
    open: boolean;
    id: string;
    form: StudentEditForm;
  }>({ open: false, id: "", form: emptyEditForm });
  const [deleteDialog, setDeleteDialog] = useState({
    open: false,
    id: "",
    studentName: "",
  });
  const { locked: isSavingEdit, runLocked: runSaveEditLocked } =
    useActionLock();
  const { locked: isDeletingStudent, runLocked: runDeleteStudentLocked } =
    useActionLock();

  const editFilteredCourses = useMemo(
    () => courses.filter((c) => c.active),
    [courses],
  );


  const editSelectedCourse = useMemo(
    () => courses.find((c) => c.id === editDialog.form.courseId),
    [courses, editDialog.form.courseId],
  );

  const editAvailablePrograms = useMemo(
    () => (editSelectedCourse ? getAvailablePrograms(editSelectedCourse) : []),
    [editSelectedCourse],
  );

  const editEffectiveCourseProgram = useMemo(
    () => editAvailablePrograms.length === 1 ? editAvailablePrograms[0] : editDialog.form.courseProgram,
    [editAvailablePrograms, editDialog.form.courseProgram],
  );

  const editAvailableStudyTypes = useMemo(
    () => (editSelectedCourse && editEffectiveCourseProgram
      ? getAvailableStudyTypesForProgram(editSelectedCourse, editEffectiveCourseProgram)
      : []),
    [editSelectedCourse, editEffectiveCourseProgram],
  );

  const editLocationScopes = useMemo(
    () => (editSelectedCourse && editDialog.form.studyType ? getLocationScopes(editSelectedCourse, editDialog.form.studyType) : []),
    [editSelectedCourse, editDialog.form.studyType],
  );

  const editBaghdadMode = useMemo(
    () => (editSelectedCourse && editDialog.form.studyType ? getBaghdadMode(editSelectedCourse, editDialog.form.studyType) : undefined),
    [editSelectedCourse, editDialog.form.studyType],
  );

  const editBaghdadSites = useMemo(
    () => (editSelectedCourse && editDialog.form.studyType ? getBaghdadSites(editSelectedCourse, editDialog.form.studyType) : []),
    [editSelectedCourse, editDialog.form.studyType],
  );

  const editProvinces = useMemo(
    () => (editSelectedCourse && editDialog.form.studyType ? getProvinceOptions(editSelectedCourse, editDialog.form.studyType) : []),
    [editSelectedCourse, editDialog.form.studyType],
  );

  const editSubSiteOptions = useMemo<string[]>(() => {
    if (!editSelectedCourse || !editDialog.form.studyType) return [];
    if (editDialog.form.locationScope === "بغداد") {
      if (editBaghdadMode === "عموم بغداد") return [];
      if (editBaghdadMode === "بغداد - مخصص") return editBaghdadSites;
    }
    if (editDialog.form.locationScope === "محافظات") return editProvinces;
    return [];
  }, [editSelectedCourse, editDialog.form.studyType, editDialog.form.locationScope, editBaghdadMode, editBaghdadSites, editProvinces]);


  // Reset dependent fields when course or studyType changes
  useEffect(() => {
    if (!editDialog.open) return;
    const patch: Partial<StudentEditForm> = {};
    let needsPatch = false;

    // Auto-select courseProgram if only one option
    if (editAvailablePrograms.length === 1 && !editDialog.form.courseProgram) {
      patch.courseProgram = editAvailablePrograms[0];
      needsPatch = true;
    }

    if (editDialog.form.studyType && !editAvailableStudyTypes.includes(editDialog.form.studyType as any)) {
      patch.studyType = "";
      patch.locationScope = "";
      patch.baghdadMode = "";
      patch.subSite = "";
      needsPatch = true;
    }

    // Auto-set baghdadMode from course config
    if (editBaghdadMode && !editDialog.form.baghdadMode) {
      patch.baghdadMode = editBaghdadMode;
      needsPatch = true;
    }

    // Auto-resolve subSite for عموم بغداد
    if (editDialog.form.locationScope === "بغداد" && editBaghdadMode === "عموم بغداد" && editDialog.form.subSite !== "عموم بغداد") {
      patch.subSite = "عموم بغداد";
      needsPatch = true;
    }

    // Reset subSite if not in options
    if (editSubSiteOptions.length > 0 && editDialog.form.subSite && !editSubSiteOptions.includes(editDialog.form.subSite) && !(editDialog.form.locationScope === "بغداد" && editBaghdadMode === "عموم بغداد")) {
      patch.subSite = "";
      needsPatch = true;
    }

    // Clear subSite if no options available
    if (editSubSiteOptions.length === 0 && editDialog.form.subSite && editDialog.form.subSite !== "عموم بغداد") {
      patch.subSite = "";
      needsPatch = true;
    }

    if (!needsPatch) return;
    queueMicrotask(() => {
      setEditDialog((prev) => ({ ...prev, form: { ...prev.form, ...patch } }));
    });
  }, [
    editDialog.open,
    editDialog.form.courseProgram,
    editDialog.form.studyType,
    editDialog.form.locationScope,
    editDialog.form.subSite,
    editAvailablePrograms,
    editAvailableStudyTypes,
    editBaghdadMode,
    editSubSiteOptions,
  ]);

  const openEditDialog = (student: Student) => {
    setEditDialog({
      open: true,
      id: student.id,
      form: getStudentEditForm(student),
    });
  };

  const updateEditForm = (key: keyof StudentEditForm, value: string) => {
    setEditDialog((prev) => ({
      ...prev,
      form: { ...prev.form, [key]: toLatinDigits(value) },
    }));
  };

  const updateEditTelegram = (value: string) => {
    setEditDialog((prev) => ({
      ...prev,
      form: { ...prev.form, telegram: sanitizeTelegramInput(value) },
    }));
  };

  const updateEditPhone = (key: "phone" | "parentPhone", value: string) => {
    setEditDialog((prev) => ({
      ...prev,
      form: { ...prev.form, [key]: sanitizePhoneInput(value) },
    }));
  };


  const validateEditForm = () => {
    const form = editDialog.form;
    const requiredChecks: [boolean, string][] = [
      [Boolean(form.name.trim()), "اسم الطالب: هذا الحقل مطلوب"],
      [Boolean(form.school.trim()), "اسم المدرسة مطلوب"],
      [Boolean(form.gender), "الجنس مطلوب"],
      [Boolean(form.phone.trim()), "رقم الطالب مطلوب"],
      [Boolean(form.parentPhone.trim()), "رقم ولي الأمر مطلوب"],
      [
        Boolean(form.courseId),
        editFilteredCourses.length === 0
          ? "لا توجد دورات مسجلة"
          : "يرجى اختيار الدورة",
      ],
      [Boolean(form.createdAt), "تاريخ إضافة الطالب مطلوب"],
    ];


    const missing = requiredChecks.find(([ok]) => !ok);
    if (missing) return missing[1];

    // Course settings-based validation
    if (editAvailablePrograms.length > 1 && !form.courseProgram) {
      return "يرجى اختيار نوع الدورة (منهج كامل/كورسات)";
    }
    if (editEffectiveCourseProgram === "كورسات" && !form.courseTerm) {
      return "يرجى اختيار الكورس";
    }
    if (editAvailableStudyTypes.length > 0 && !form.studyType) {
      return "يرجى اختيار نوع الدراسة";
    }
    if (editLocationScopes.length > 0 && !form.locationScope) {
      return "يرجى اختيار الموقع";
    }
    if (editSubSiteOptions.length > 0 && !form.subSite) {
      return "يرجى اختيار الموقع الفرعي";
    }

    const nameError = getRequiredTextError(form.name, "اسم الطالب");
    if (nameError) return nameError;

    const phoneError = getPhoneValidationError(form.phone, "رقم الطالب", true);
    if (phoneError) return phoneError;

    const parentPhoneError = getPhoneValidationError(
      form.parentPhone,
      "رقم ولي الأمر",
      true,
    );
    if (parentPhoneError) return parentPhoneError;

    if (!isValidGraceDays(form.accountingGraceDays)) {
      return "فترة السماح يجب أن تكون رقماً من 0 إلى 30 يوم";
    }

    const duplicateMessage = getStudentDuplicateMessage(
      students,
      {
        id: editDialog.id,
        name: form.name,
        phone: form.phone,
        telegram: form.telegram,
      },
      editDialog.id,
    );
    if (duplicateMessage) return duplicateMessage.replace("إضافة", "تعديل");

    return null;
  };

  const handleEditSave = runSaveEditLocked(async () => {
    const error = validateEditForm();
    if (error) {
      toast.error(error);
      return;
    }

    const form = editDialog.form;
    const result = updateStudent(editDialog.id, {
      name: form.name.trim(),
      school: form.school.trim(),
      gender: form.gender,
      phone: form.phone.trim(),
      parentPhone: form.parentPhone.trim(),
      telegram: sanitizeTelegramInput(form.telegram),
      courseProgram: (editEffectiveCourseProgram || "") as any,
      courseTerm: (editEffectiveCourseProgram === "كورسات" ? form.courseTerm : "") as any,
      studyType: form.studyType as any,
      locationScope: form.locationScope as any,
      baghdadMode: (form.baghdadMode || (editBaghdadMode || "")) as any,
      courseId: form.courseId,
      mainSite: form.locationScope,
      subSite: form.subSite || (editBaghdadMode === "عموم بغداد" ? "عموم بغداد" : ""),
      createdAt: form.createdAt,
      accountingGraceDays: Number(form.accountingGraceDays || 0),
    });

    if (!result.ok) {
      toast.error(result.message);
      return;
    }
    setEditDialog({ open: false, id: "", form: emptyEditForm });
    toast.success("تم تعديل بيانات الطالب", {
      description: "تم تحديث جميع حقول الطالب بنجاح",
    });
  });

  const openDeleteDialog = (student: Student) => {
    setDeleteDialog({ open: true, id: student.id, studentName: student.name });
  };

  const handleDeleteConfirm = runDeleteStudentLocked(async () => {
    const ok = deleteStudent(deleteDialog.id);
    if (ok) { toast.success("تم حذف الطالب"); } else { toast.error("تعذر حذف الطالب"); }
    setDeleteDialog({ open: false, id: "", studentName: "" });
  });

  const filtered = useMemo(() => {
    return students.filter((s) => {
      if (
        search &&
        !searchAny(search, [
          s.name,
          s.school,
          s.code,
          s.telegram,
          s.phone,
          s.parentPhone,
          s.dismissalType,
          s.dismissalReason,
          s.dismissalNotes,
        ])
      )
        return false;
      if (filterCourseId && s.courseId !== filterCourseId) return false;
      if (filterStatus && s.status !== filterStatus) return false;
      if (filterGender && s.gender !== filterGender) return false;
      return true;
    });
  }, [
    students,
    search,
    filterCourseId,
    filterStatus,
    filterGender,
  ]);

  const totalPages = Math.ceil(filtered.length / pageSize);
  const paged = filtered.slice((page - 1) * pageSize, page * pageSize);
  const dismissedStudents = students.filter((student) => student.status === "مفصول");
  const noActiveChapterStudents = students.filter((student) => !activeChapterForCourse(student.courseId));

  const handleDismiss = () => {
    if (!dismissDialog.student) return;
    if (!dismissReason.trim()) {
      toast.error("يرجى إدخال سبب الفصل");
      return;
    }
    dismissStudent(dismissDialog.student.id, dismissType, dismissReason.trim(), dismissNotes.trim());
    setDismissDialog({ student: null, open: false });
    setDismissReason("");
    setDismissNotes("");
    toast.success("تم فصل الطالب");
  };

  const handleReactivate = (studentId: string) => {
    reactivateStudent(studentId);
    toast.success("تم إعادة تفعيل الطالب");
  };

  const exportCSV = () => {
    const headers = [
      "الكود",
      "الاسم",
      "المدرسة",
      "الجنس",
      "الدورة",
      "نوع الدورة",
      "الكورس",
      "نوع الدراسة",
      "نطاق الموقع",
      "الموقع",
      "الحالة",
      "الفرص",
      "فترة السماح",
      "الهاتف",
      "ولي الأمر",
      "التليكرام",
    ];
    const rows = filtered.map((s) => ({
      الكود: s.code,
      الاسم: s.name,
      المدرسة: s.school || "",
      الجنس: s.gender,
      الدورة: courseName(s.courseId),
      "نوع الدورة": s.courseProgram || "",
      "الكورس": s.courseTerm || "",
      "نوع الدراسة": s.studyType || "",
      "نطاق الموقع": s.locationScope || "",
      الموقع: `${s.locationScope || s.mainSite} - ${s.subSite}`,
      الحالة: s.status,
      الفرص: String(s.opportunities),
      "فترة السماح": `${s.accountingGraceDays ?? 0} يوم`,
      الهاتف: s.phone,
      "ولي الأمر": s.parentPhone,
      التليكرام: s.telegram || "",
    }));
    const csv =
      "\ufeff" +
      [
        headers.join(","),
        ...rows.map((r) =>
          headers
            .map(
              (h) => `"${(r as unknown as Record<string, string>)[h] || ""}"`,
            )
            .join(","),
        ),
      ].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `students-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("تم تصدير CSV");
  };

  const studentOppLogs = (studentId: string) =>
    opportunityLogs.filter((l) => l.studentId === studentId);
  const studentGrades = (studentId: string) =>
    grades.filter((g) => g.studentId === studentId);

  const applyFilterPreset = (values: FilterPresetValues) => {
    setSearch(String(values.search || ""));
    setFilterCourseId(String(values.courseId || ""));
    setFilterStatus(String(values.status || ""));
    setFilterGender(String(values.gender || ""));
    setViewMode((values.viewMode as RegistryViewMode) || "cards");
    setPage(1);
  };

  const resetFilters = () => {
    setSearch("");
    setFilterCourseId("");
    setFilterStatus("");
    setFilterGender("");
    setViewMode("cards");
    setPage(1);
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="p-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-6">
            <div className="space-y-1">
              <Label htmlFor="registry-search" className="text-xs">
                بحث
              </Label>
              <Input
                id="registry-search"
                name="search"
                autoComplete="off"
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPage(1);
                }}
                placeholder="اسم / كود / تليكرام / هاتف"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="registry-course" className="text-xs">
                الدورة
              </Label>
              <Select
                name="courseId"
                value={filterCourseId}
                onValueChange={(v) => {
                  setFilterCourseId(v === "all" ? "" : v);
                  setPage(1);
                }}
              >
                <SelectTrigger id="registry-course">
                  <SelectValue placeholder="الكل" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">الكل</SelectItem>
                  {courses.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="registry-status" className="text-xs">
                الحالة
              </Label>
              <Select
                name="status"
                value={filterStatus}
                onValueChange={(v) => {
                  setFilterStatus(v === "all" ? "" : v);
                  setPage(1);
                }}
              >
                <SelectTrigger id="registry-status">
                  <SelectValue placeholder="الكل" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">الكل</SelectItem>
                  <SelectItem value="نشط">نشط</SelectItem>
                  <SelectItem value="مفصول">مفصول</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="registry-gender" className="text-xs">
                الجنس
              </Label>
              <Select
                name="gender"
                value={filterGender}
                onValueChange={(v) => {
                  setFilterGender(v === "all" ? "" : v);
                  setPage(1);
                }}
              >
                <SelectTrigger id="registry-gender">
                  <SelectValue placeholder="الكل" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">الكل</SelectItem>
                  <SelectItem value="ذكر">ذكر</SelectItem>
                  <SelectItem value="أنثى">أنثى</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="registry-view" className="text-xs">طريقة العرض</Label>
              <Select value={viewMode} onValueChange={(v) => setViewMode(v as RegistryViewMode)}>
                <SelectTrigger id="registry-view"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="cards">الكارتات</SelectItem><SelectItem value="table">الجدول</SelectItem></SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <span className="text-xs font-medium">تصدير</span>
              <Button
                variant="outline"
                size="sm"
                className="w-full h-9"
                onClick={exportCSV}
              >
                تصدير CSV
              </Button>
            </div>
          </div>
          <div className="mt-3">
            <CustomFilterPresets
              storageKey="teacherpro.registry.customFilters"
              currentFilters={{ search, courseId: filterCourseId, status: filterStatus, gender: filterGender, viewMode }}
              onApply={applyFilterPreset}
              onClear={resetFilters}
            />
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <Card className="bg-card/80">
          <CardContent className="flex items-center justify-between gap-3 p-4">
            <div>
              <p className="text-xs text-muted-foreground">الطلاب النشطون</p>
              <p className="text-2xl font-black">{students.filter((student) => student.status === "نشط").length}</p>
            </div>
            <Button variant="outline" size="sm" onClick={() => { setFilterStatus("نشط"); setPage(1); }}>عرض</Button>
          </CardContent>
        </Card>
        <Card className="border-destructive/30 bg-destructive/5">
          <CardContent className="flex items-center justify-between gap-3 p-4">
            <div>
              <p className="text-xs text-muted-foreground">قائمة المفصولين</p>
              <p className="text-2xl font-black text-destructive">{dismissedStudents.length}</p>
            </div>
            <Button variant="destructive" size="sm" onClick={() => { setFilterStatus("مفصول"); setPage(1); }}>عرض المفصولين</Button>
          </CardContent>
        </Card>
        <Card className="border-amber-500/30 bg-amber-500/5">
          <CardContent className="flex items-center justify-between gap-3 p-4">
            <div>
              <p className="text-xs text-muted-foreground">بدون فصل نشط</p>
              <p className="text-2xl font-black text-amber-600">{noActiveChapterStudents.length}</p>
            </div>
            <Button variant="outline" size="sm" onClick={() => { setFilterStatus(""); setFilterCourseId(""); setSearch(""); setPage(1); }}>عرض الكل</Button>
          </CardContent>
        </Card>
      </div>

      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <span>
          عرض {paged.length} من {filtered.length} طالب
        </span>
        <div className="flex items-center gap-2">
          <Label htmlFor="registry-pageSize" className="text-xs">
            حجم الصفحة:
          </Label>
          <Select
            name="pageSize"
            value={String(pageSize)}
            onValueChange={(v) => {
              setPageSize(Number(v));
              setPage(1);
            }}
          >
            <SelectTrigger id="registry-pageSize" className="w-20 h-8">
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

      {students.length === 0 ? (
        <EmptyState
          icon={UserPlus}
          title="لم تقم بإضافة طلاب بعد"
          description="ابدأ بإضافة أول طالب، وبعدها ستظهر البطاقات والفلاتر والإحصائيات هنا تلقائياً."
          action={
            <Button onClick={() => setSection("student-register")} className="min-h-11 px-6">
              إضافة طالب الآن
            </Button>
          }
        />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={SearchX}
          title="لا توجد نتائج مطابقة"
          description="الفلاتر تعمل معاً؛ غيّر شروط البحث أو امسح الفلاتر لعرض كل الطلاب."
          action={
            <Button variant="outline" onClick={resetFilters} className="min-h-11 px-6">
              مسح الفلاتر
            </Button>
          }
        />
      ) : viewMode === "cards" ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {paged.map((student) => (
            <Card key={student.id} className="transition-all duration-200 hover:-translate-y-0.5 hover:shadow-xl hover:shadow-primary/10">
              <CardContent className="p-4">
                <div className="mb-3 flex items-start justify-between gap-3">
                  <div>
                    <p className="font-bold">{student.name}</p>
                    <p className="text-xs text-muted-foreground">{student.code} - {student.school || "بدون مدرسة"}</p>
                  </div>
                  <Badge variant={student.status === "نشط" ? "default" : "destructive"}>{student.status}</Badge>
                </div>

                <div className="mb-3 grid grid-cols-2 gap-2 text-sm">
                  <div><span className="text-xs text-muted-foreground">الدورة</span><p className="text-xs font-medium">{courseName(student.courseId)}</p></div>
                  <div><span className="text-xs text-muted-foreground">نوع الدورة</span><p className="text-xs font-medium">{student.courseProgram ? student.courseProgram === "كورسات" ? `كورسات - ${student.courseTerm}` : student.courseProgram : "-"}</p></div>
                  <div><span className="text-xs text-muted-foreground">نوع الدراسة</span><p className="text-xs font-medium">{student.studyType || "-"}</p></div>
                  <div><span className="text-xs text-muted-foreground">الموقع</span><p className="text-xs font-medium">{`${student.locationScope || student.mainSite || "-"} - ${student.subSite || "-"}`}</p></div>
                  <div><span className="text-xs text-muted-foreground">الفرص</span><p className="text-xs font-medium">{activeChapterForCourse(student.courseId) ? `${student.opportunities} / ${student.baseOpportunities}` : "0 / 0 - لم يتم اختيار الفصل"}</p></div>
                  <div><span className="text-xs text-muted-foreground">السماح</span><p className="text-xs font-medium">{student.accountingGraceDays ?? 0} يوم</p></div>
                  <div><span className="text-xs text-muted-foreground">تليكرام</span><p className="text-xs">{student.telegram ? <ContactLink href={telegramLink(student.telegram)}>{student.telegram}</ContactLink> : "-"}</p></div>
                  <div><span className="text-xs text-muted-foreground">رقم الطالب</span><p className="text-xs"><ContactLink href={whatsappLink(student.phone)}>{student.phone}</ContactLink></p></div>
                  <div><span className="text-xs text-muted-foreground">ولي الأمر</span><p className="text-xs"><ContactLink href={whatsappLink(student.parentPhone)}>{student.parentPhone}</ContactLink></p></div>
                </div>

                {student.status === "مفصول" && (
                  <div className="mb-3 rounded bg-destructive/10 p-2 text-xs text-destructive">
                    <div>{student.dismissalType} - {student.dismissalReason}</div>
                    {student.dismissalNotes && <div className="mt-1 text-destructive/80">ملاحظات: {student.dismissalNotes}</div>}
                  </div>
                )}

                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <Button variant="outline" size="sm" className="min-h-11 text-xs" onClick={() => setFileDialog({ student, open: true })}>ملف الطالب</Button>
                  <Button variant="secondary" size="sm" className="min-h-11 text-xs" onClick={() => openEditDialog(student)}>تعديل</Button>
                  {student.status === "نشط" ? (
                    <Button variant="destructive" size="sm" className="min-h-11 text-xs" onClick={() => setDismissDialog({ student, open: true })}>فصل</Button>
                  ) : (
                    <Button variant="default" size="sm" className="min-h-11 text-xs" onClick={() => handleReactivate(student.id)}>إعادة تفعيل</Button>
                  )}
                  <Button variant="destructive" size="sm" className="min-h-11 text-xs" onClick={() => openDeleteDialog(student)}>حذف</Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <div className="table-wrap">
          <table className="responsive-table text-sm">
            <thead>
              <tr>
                <th className="p-3 text-right">الطالب</th>
                <th className="p-3 text-right">الكود</th>
                <th className="p-3 text-right">الدورة</th>
                <th className="p-3 text-right">الدراسة</th>
                <th className="p-3 text-right">الموقع</th>
                <th className="p-3 text-right">الهاتف</th>
                <th className="p-3 text-right">التليكرام</th>
                <th className="p-3 text-right">الفرص</th>
                <th className="p-3 text-right">السماح</th>
                <th className="p-3 text-right">الحالة</th>
                <th className="p-3 text-right">الإجراءات</th>
              </tr>
            </thead>
            <tbody>
              {paged.map((student) => (
                <tr key={student.id} className="border-t align-top">
                  <td className="p-3 font-medium">{student.name}<div className="text-xs text-muted-foreground">{student.school || "بدون مدرسة"}</div></td>
                  <td className="p-3">{student.code}</td>
                  <td className="p-3">{courseName(student.courseId)}</td>
                  <td className="p-3">{student.studyType || "—"}</td>
                  <td className="p-3 min-w-40">{`${student.locationScope || student.mainSite || "-"} - ${student.subSite || "-"}`}</td>
                  <td className="p-3"><ContactLink href={whatsappLink(student.phone)}>{student.phone}</ContactLink></td>
                  <td className="p-3">{student.telegram ? <ContactLink href={telegramLink(student.telegram)}>{student.telegram}</ContactLink> : "—"}</td>
                  <td className="p-3">{activeChapterForCourse(student.courseId) ? `${student.opportunities} / ${student.baseOpportunities}` : "0 / 0"}</td>
                  <td className="p-3">{student.accountingGraceDays ?? 0} يوم</td>
                  <td className="p-3"><Badge variant={student.status === "نشط" ? "default" : "destructive"}>{student.status}</Badge></td>
                  <td className="p-3 min-w-56">
                    <div className="flex flex-wrap gap-1">
                      <Button variant="outline" size="sm" onClick={() => setFileDialog({ student, open: true })}>ملف</Button>
                      <Button variant="secondary" size="sm" onClick={() => openEditDialog(student)}>تعديل</Button>
                      {student.status === "نشط" ? <Button variant="destructive" size="sm" onClick={() => setDismissDialog({ student, open: true })}>فصل</Button> : <Button size="sm" onClick={() => handleReactivate(student.id)}>تفعيل</Button>}
                      <Button variant="destructive" size="sm" onClick={() => openDeleteDialog(student)}>حذف</Button>
                    </div>
                  </td>
                </tr>
              ))}
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
            onClick={() => setPage((p) => p - 1)}
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
            onClick={() => setPage((p) => p + 1)}
          >
            التالي
          </Button>
        </div>
      )}

      <Dialog
        open={editDialog.open}
        onOpenChange={(o) => setEditDialog((prev) => ({ ...prev, open: o }))}
      >
        <DialogContent
          dir="rtl"
          className="max-w-4xl max-h-[85vh] overflow-y-auto"
        >
          <DialogHeader>
            <DialogTitle>تعديل بيانات الطالب</DialogTitle>
            <DialogDescription>
              يمكن تعديل نفس حقول صفحة تسجيل الطالب كاملة.
            </DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            <div className="space-y-2">
              <Label htmlFor="edit-name">اسم الطالب</Label>
              <Input
                id="edit-name"
                name="name"
                autoComplete="name"
                value={editDialog.form.name}
                onChange={(e) => updateEditForm("name", e.target.value)}
                required
                placeholder="اسم الطالب الرباعي"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-school">اسم المدرسة</Label>
              <Input
                id="edit-school"
                name="school"
                autoComplete="organization"
                value={editDialog.form.school}
                onChange={(e) => updateEditForm("school", e.target.value)}
                required
                placeholder="اسم المدرسة"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-gender">الجنس</Label>
              <Select
                name="gender"
                value={editDialog.form.gender}
                onValueChange={(v) => updateEditForm("gender", v)}
              >
                <SelectTrigger id="edit-gender">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ذكر">ذكر</SelectItem>
                  <SelectItem value="أنثى">أنثى</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-telegram">معرف التليكرام</Label>
              <Input
                id="edit-telegram"
                name="telegram"
                autoComplete="username"
                value={editDialog.form.telegram}
                onChange={(e) => updateEditTelegram(e.target.value)}
                placeholder="اختياري - username بدون @"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-phone">رقم الطالب</Label>
              <Input
                id="edit-phone"
                name="phone"
                autoComplete="tel"
                value={editDialog.form.phone}
                onChange={(e) => updateEditPhone("phone", e.target.value)}
                inputMode="numeric"
                maxLength={11}
                pattern="07[0-9]{9}"
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-parentPhone">رقم ولي الأمر</Label>
              <Input
                id="edit-parentPhone"
                name="parentPhone"
                autoComplete="tel"
                value={editDialog.form.parentPhone}
                onChange={(e) => updateEditPhone("parentPhone", e.target.value)}
                inputMode="numeric"
                maxLength={11}
                pattern="07[0-9]{9}"
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-courseId">اختر الدورة</Label>
              <Select
                name="courseId"
                value={editDialog.form.courseId}
                onValueChange={(v) =>
                  setEditDialog((prev) => ({
                    ...prev,
                    form: {
                      ...prev.form,
                      courseId: v,
                                          courseProgram: "",
                      courseTerm: "",
                      studyType: "",
                      locationScope: "",
                      baghdadMode: "",
                      subSite: "",
                    },
                  }))
                }
                disabled={editFilteredCourses.length === 0}
              >
                <SelectTrigger id="edit-courseId">
                  <SelectValue
                    placeholder={
                      editFilteredCourses.length === 0
                        ? "لا توجد دورات مسجلة"
                        : "اختر الدورة"
                    }
                  />
                </SelectTrigger>
                <SelectContent>
                  {editFilteredCourses.length === 0 ? (
                    <div className="px-3 py-2 text-sm text-muted-foreground">
                      لا توجد دورات مسجلة
                    </div>
                  ) : (
                    editFilteredCourses.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name}
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
            </div>
            {editDialog.form.courseId && editAvailablePrograms.length > 1 && (
              <div className="space-y-2">
                <Label htmlFor="edit-courseProgram">نوع الدورة</Label>
                <Select
                  name="courseProgram"
                  value={editDialog.form.courseProgram}
                  onValueChange={(v) =>
                    setEditDialog((prev) => ({
                      ...prev,
                      form: {
                        ...prev.form,
                        courseProgram: v,
                        courseTerm: v === "كورسات" ? prev.form.courseTerm : "",
                        studyType: "",
                        locationScope: "",
                        baghdadMode: "",
                        subSite: "",
                                            },
                    }))
                  }
                >
                  <SelectTrigger id="edit-courseProgram">
                    <SelectValue placeholder="اختر نوع الدورة..." />
                  </SelectTrigger>
                  <SelectContent>
                    {editAvailablePrograms.map((p) => (
                      <SelectItem key={p} value={p}>
                        {p}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            {editEffectiveCourseProgram === "كورسات" && (
              <div className="space-y-2">
                <Label htmlFor="edit-courseTerm">الكورس</Label>
                <Select
                  name="courseTerm"
                  value={editDialog.form.courseTerm}
                  onValueChange={(v) => updateEditForm("courseTerm", v)}
                >
                  <SelectTrigger id="edit-courseTerm">
                    <SelectValue placeholder="اختر الكورس..." />
                  </SelectTrigger>
                  <SelectContent>
                    {COURSE_TERMS.map((t) => (
                      <SelectItem key={t} value={t}>
                        {t}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            {editDialog.form.courseId && editAvailableStudyTypes.length > 0 && (
              <div className="space-y-2">
                <Label htmlFor="edit-studyType">نوع الدراسة</Label>
                <Select
                  name="studyType"
                  value={editDialog.form.studyType}
                  onValueChange={(v) =>
                    setEditDialog((prev) => ({
                      ...prev,
                      form: {
                        ...prev.form,
                        studyType: v,
                        locationScope: "",
                        baghdadMode: "",
                        subSite: "",
                      },
                    }))
                  }
                >
                  <SelectTrigger id="edit-studyType">
                    <SelectValue placeholder="اختر نوع الدراسة..." />
                  </SelectTrigger>
                  <SelectContent>
                    {editAvailableStudyTypes.map((t) => (
                      <SelectItem key={t} value={t}>
                        {t}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            {editDialog.form.studyType && editLocationScopes.length > 0 && (
              <div className="space-y-2">
                <Label htmlFor="edit-locationScope">الموقع</Label>
                <Select
                  name="locationScope"
                  value={editDialog.form.locationScope}
                  onValueChange={(v) =>
                    setEditDialog((prev) => ({
                      ...prev,
                      form: {
                        ...prev.form,
                        locationScope: v,
                        subSite: "",
                      },
                    }))
                  }
                >
                  <SelectTrigger id="edit-locationScope">
                    <SelectValue placeholder="اختر الموقع..." />
                  </SelectTrigger>
                  <SelectContent>
                    {editLocationScopes.map((s) => (
                      <SelectItem key={s} value={s}>
                        {s}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            {editDialog.form.locationScope && editSubSiteOptions.length > 0 && (
              <div className="space-y-2">
                <Label htmlFor="edit-subSite">الموقع الفرعي</Label>
                <Select
                  name="subSite"
                  value={editDialog.form.subSite}
                  onValueChange={(v) => updateEditForm("subSite", v)}
                >
                  <SelectTrigger id="edit-subSite">
                    <SelectValue placeholder="اختر الموقع الفرعي..." />
                  </SelectTrigger>
                  <SelectContent>
                    {editSubSiteOptions.map((s) => (
                      <SelectItem key={s} value={s}>
                        {s}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="edit-createdAt">تاريخ إضافة الطالب / بداية السماح</Label>
              <DateInput
                id="edit-createdAt"
                name="createdAt"
                autoComplete="off"
                value={editDialog.form.createdAt}
                onChange={(value) => updateEditForm("createdAt", value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-accountingGraceDays">فترة السماح بالأيام</Label>
              <Input
                id="edit-accountingGraceDays"
                name="accountingGraceDays"
                inputMode="numeric"
                min={0}
                max={30}
                pattern="(?:[0-9]|[12][0-9]|30)"
                autoComplete="off"
                value={editDialog.form.accountingGraceDays}
                onChange={(e) => updateEditForm("accountingGraceDays", normalizeGraceDaysInput(e.target.value))}
                required
              />
              <p className="text-xs text-muted-foreground">لا يُحاسَب الطالب على الامتحانات أو الإخفاقات خلال هذه الأيام.</p>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() =>
                setEditDialog({ open: false, id: "", form: emptyEditForm })
              }
            >
              إلغاء
            </Button>
            <Button onClick={handleEditSave} disabled={isSavingEdit}>
              {isSavingEdit ? "جاري الحفظ..." : "حفظ"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={deleteDialog.open}
        onOpenChange={(o) => setDeleteDialog((prev) => ({ ...prev, open: o }))}
      >
        <AlertDialogContent dir="rtl">
          <AlertDialogHeader>
            <AlertDialogTitle>تأكيد الحذف</AlertDialogTitle>
            <AlertDialogDescription>
              هل تريد حذف الطالب &quot;{deleteDialog.studentName}&quot;؟ سيتم
              حذف درجاته وحركاته التابعة أيضاً.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>إلغاء</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteConfirm}
              disabled={isDeletingStudent}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isDeletingStudent ? "جاري الحذف..." : "حذف"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog
        open={dismissDialog.open}
        onOpenChange={(o) => {
          setDismissDialog({ ...dismissDialog, open: o });
          if (!o) setDismissNotes("");
        }}
      >
        <DialogContent dir="rtl">
          <DialogHeader>
            <DialogTitle>
              فصل الطالب - {dismissDialog.student?.name}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="dismiss-type">نوع الفصل</Label>
              <Select name="type" value={dismissType} onValueChange={setDismissType}>
                <SelectTrigger id="dismiss-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="فصل مؤقت">فصل مؤقت</SelectItem>
                  <SelectItem value="فصل نهائي">فصل نهائي</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="dismiss-reason">سبب الفصل</Label>
              <Input
                id="dismiss-reason"
                name="dismissReason"
                autoComplete="off"
                value={dismissReason}
                onChange={(e) => setDismissReason(e.target.value)}
                placeholder="سبب الفصل"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="dismiss-notes">ملاحظات الفصل</Label>
              <textarea
                id="dismiss-notes"
                name="dismissNotes"
                value={dismissNotes}
                onChange={(e) => setDismissNotes(e.target.value)}
                placeholder="ملاحظات خاصة بالطالب المفصول"
                className="min-h-24 w-full rounded-2xl border bg-background/70 px-3 py-2 text-sm shadow-xs outline-none focus:border-primary"
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setDismissDialog({ student: null, open: false });
                setDismissNotes("");
              }}
            >
              إلغاء
            </Button>
            <Button variant="destructive" onClick={handleDismiss}>
              تأكيد الفصل
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <StudentProfileDialog
        student={fileDialog.student}
        open={fileDialog.open}
        onOpenChange={(open) => setFileDialog((prev) => ({ ...prev, open }))}
        exams={exams}
        grades={grades}
        opportunityLogs={opportunityLogs}
        courseName={courseName}
        activeChapterForCourse={activeChapterForCourse}
        whatsappLink={whatsappLink}
        telegramLink={telegramLink}
        isStudentCurrentlyInGrace={isStudentCurrentlyInGrace}
        graceEndDate={graceEndDate}
      />
    </div>
  );
}
