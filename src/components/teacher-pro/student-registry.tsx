"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useTeacherStore, type Student } from "@/lib/teacher-store";
import { Card, CardContent } from "@/components/ui/card";
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
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
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
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import {
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
  groupId: string;
  subSite: string;
  createdAt: string;
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
  groupId: "",
  subSite: "",
  createdAt: new Date().toISOString().slice(0, 10),
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
    groupId: student.groupId,
    subSite: student.subSite || "",
    createdAt: student.createdAt || new Date().toISOString().slice(0, 10),
  };
}

function whatsappLink(phone: string): string {
  const sanitized = sanitizePhoneInput(phone);
  if (sanitized.startsWith("07") && sanitized.length === 11)
    return `https://wa.me/964${sanitized.slice(1)}`;
  return `https://wa.me/${sanitized}`;
}

function telegramLink(telegram: string): string {
  return `https://t.me/${encodeURIComponent(normalizeTelegramIdentifier(telegram))}`;
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
      target="_blank"
      rel="noreferrer"
      className="font-medium text-primary underline-offset-4 hover:underline"
    >
      {children}
    </a>
  );
}

export function StudentRegistryView() {
  const {
    students,
    courses,
    groups,
    exams,
    grades,
    opportunityLogs,
    dismissStudent,
    reactivateStudent,
    updateStudent,
    deleteStudent,
    setSection,
    courseName,
    groupName,
    activeChapterForCourse,
  } = useTeacherStore();

  const [search, setSearch] = useState("");
  const [filterCourseId, setFilterCourseId] = useState("");
  const [filterStatus, setFilterStatus] = useState("");
  const [filterGender, setFilterGender] = useState("");
  const [filterGroupId, setFilterGroupId] = useState("");
  const [pageSize, setPageSize] = useState(10);
  const [page, setPage] = useState(1);

  const [dismissDialog, setDismissDialog] = useState<{
    student: Student | null;
    open: boolean;
  }>({ student: null, open: false });
  const [dismissType, setDismissType] = useState("فصل مؤقت");
  const [dismissReason, setDismissReason] = useState("");

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

  const editFilteredGroups = useMemo(
    () =>
      groups.filter((g) => g.courseId === editDialog.form.courseId && g.active),
    [groups, editDialog.form.courseId],
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
      patch.groupId = "";
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
      [
        Boolean(form.groupId),
        editFilteredGroups.length === 0
          ? "لا توجد مجموعات إلكترونية مسجلة لهذه الدورة"
          : "المجموعة الإلكترونية مطلوبة",
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
      groupId: form.groupId,
      mainSite: form.locationScope,
      subSite: form.subSite || (editBaghdadMode === "عموم بغداد" ? "عموم بغداد" : ""),
      createdAt: form.createdAt,
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
        ])
      )
        return false;
      if (filterCourseId && s.courseId !== filterCourseId) return false;
      if (filterStatus && s.status !== filterStatus) return false;
      if (filterGender && s.gender !== filterGender) return false;
      if (filterGroupId && s.groupId !== filterGroupId) return false;
      return true;
    });
  }, [
    students,
    search,
    filterCourseId,
    filterStatus,
    filterGender,
    filterGroupId,
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
    dismissStudent(dismissDialog.student.id, dismissType, dismissReason.trim());
    setDismissDialog({ student: null, open: false });
    setDismissReason("");
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

  const resetFilters = () => {
    setSearch("");
    setFilterCourseId("");
    setFilterStatus("");
    setFilterGender("");
    setFilterGroupId("");
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
              <Label htmlFor="registry-group" className="text-xs">
                المجموعة الإلكترونية
              </Label>
              <Select
                name="groupId"
                value={filterGroupId}
                onValueChange={(v) => {
                  setFilterGroupId(v === "all" ? "" : v);
                  setPage(1);
                }}
              >
                <SelectTrigger id="registry-group">
                  <SelectValue placeholder="الكل" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">الكل</SelectItem>
                  {groups.map((g) => (
                    <SelectItem key={g.id} value={g.id}>
                      {g.name}
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
      ) : (
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {paged.map((student) => (
          <Card
            key={student.id}
            className="transition-all duration-200 hover:-translate-y-0.5 hover:shadow-xl hover:shadow-primary/10"
          >
            <CardContent className="p-4">
              <div className="flex items-start justify-between mb-3">
                <div>
                  <p className="font-bold">{student.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {student.code}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {student.school || "بدون مدرسة"}
                  </p>
                </div>
                <Badge
                  variant={student.status === "نشط" ? "default" : "destructive"}
                >
                  {student.status}
                </Badge>
              </div>

              <div className="grid grid-cols-2 gap-2 text-sm mb-3">
                <div>
                  <span className="text-muted-foreground text-xs">الدورة</span>
                  <p className="font-medium text-xs">
                    {courseName(student.courseId)}
                  </p>
                </div>
                <div>
                  <span className="text-muted-foreground text-xs">نوع الدورة</span>
                  <p className="font-medium text-xs">
                    {student.courseProgram 
                      ? student.courseProgram === "كورسات" 
                        ? `كورسات - ${student.courseTerm}` 
                        : student.courseProgram
                      : "-"}
                  </p>
                </div>
                <div>
                  <span className="text-muted-foreground text-xs">نوع الدراسة</span>
                  <p className="font-medium text-xs">{student.studyType || "-"}</p>
                </div>
                <div>
                  <span className="text-muted-foreground text-xs">المجموعة الإلكترونية</span>
                  <p className="font-medium text-xs">
                    {groupName(student.groupId)}
                  </p>
                </div>
                <div>
                  <span className="text-muted-foreground text-xs">الموقع</span>
                  <p className="font-medium text-xs">
                    {`${student.locationScope || student.mainSite} - ${student.subSite}`}
                  </p>
                </div>
                <div>
                  <span className="text-muted-foreground text-xs">الفرص</span>
                  {activeChapterForCourse(student.courseId) ? (
                    <p className="font-medium text-xs">
                      {student.opportunities} / {student.baseOpportunities}
                    </p>
                  ) : (
                    <p className="font-semibold text-xs text-destructive">
                      0 / 0 - لم يتم اختيار الفصل لهم بعد
                    </p>
                  )}
                </div>
                <div>
                  <span className="text-muted-foreground text-xs">تليكرام</span>
                  <p className="text-xs">
                    {student.telegram ? (
                      <ContactLink href={telegramLink(student.telegram)}>
                        {student.telegram}
                      </ContactLink>
                    ) : (
                      "-"
                    )}
                  </p>
                </div>
                <div>
                  <span className="text-muted-foreground text-xs">
                    رقم الطالب
                  </span>
                  <p className="text-xs">
                    <ContactLink href={whatsappLink(student.phone)}>
                      {student.phone}
                    </ContactLink>
                  </p>
                </div>
                <div>
                  <span className="text-muted-foreground text-xs">
                    ولي الأمر
                  </span>
                  <p className="text-xs">
                    <ContactLink href={whatsappLink(student.parentPhone)}>
                      {student.parentPhone}
                    </ContactLink>
                  </p>
                </div>
              </div>

              {student.status === "مفصول" && (
                <div className="text-xs p-2 rounded bg-destructive/10 text-destructive mb-3">
                  {student.dismissalType} - {student.dismissalReason}
                </div>
              )}

              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <Button
                  variant="outline"
                  size="sm"
                  className="min-h-11 text-xs"
                  onClick={() => setFileDialog({ student, open: true })}
                >
                  ملف الطالب
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  className="min-h-11 text-xs"
                  onClick={() => openEditDialog(student)}
                >
                  تعديل
                </Button>
                {student.status === "نشط" ? (
                  <Button
                    variant="destructive"
                    size="sm"
                    className="min-h-11 text-xs"
                    onClick={() => setDismissDialog({ student, open: true })}
                  >
                    فصل
                  </Button>
                ) : (
                  <Button
                    variant="default"
                    size="sm"
                    className="min-h-11 text-xs"
                    onClick={() => handleReactivate(student.id)}
                  >
                    إعادة تفعيل
                  </Button>
                )}
                <Button
                  variant="destructive"
                  size="sm"
                  className="min-h-11 text-xs"
                  onClick={() => openDeleteDialog(student)}
                >
                  حذف
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
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
                      groupId: "",
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
                        groupId: "",
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
              <Label htmlFor="edit-groupId">المجموعة الإلكترونية</Label>
              <Select
                name="groupId"
                value={editDialog.form.groupId}
                onValueChange={(v) => updateEditForm("groupId", v)}
                disabled={
                  !editDialog.form.courseId || editFilteredGroups.length === 0
                }
              >
                <SelectTrigger id="edit-groupId">
                  <SelectValue
                    placeholder={
                      editFilteredCourses.length === 0
                        ? "لا توجد مجموعات إلكترونية مسجلة"
                        : !editDialog.form.courseId
                          ? "اختر الدورة أولاً"
                          : editFilteredGroups.length === 0
                            ? "لا توجد مجموعات إلكترونية مسجلة"
                            : "اختر المجموعة الإلكترونية"
                    }
                  />
                </SelectTrigger>
                <SelectContent>
                  {editFilteredCourses.length === 0 ? (
                    <div className="px-3 py-2 text-sm text-muted-foreground">
                      لا توجد مجموعات إلكترونية مسجلة لهذا النوع
                    </div>
                  ) : !editDialog.form.courseId ? (
                    <div className="px-3 py-2 text-sm text-muted-foreground">
                      اختر الدورة أولاً
                    </div>
                  ) : editFilteredGroups.length === 0 ? (
                    <div className="px-3 py-2 text-sm text-muted-foreground">
                      لا توجد مجموعات إلكترونية مسجلة لهذه الدورة
                    </div>
                  ) : (
                    editFilteredGroups.map((g) => (
                      <SelectItem key={g.id} value={g.id}>
                        {g.name} - {g.electronicGroup}
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-createdAt">تاريخ إضافة الطالب</Label>
              <Input
                id="edit-createdAt"
                name="createdAt"
                type="date"
                autoComplete="off"
                value={editDialog.form.createdAt}
                onChange={(e) => updateEditForm("createdAt", e.target.value)}
                required
              />
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
        onOpenChange={(o) => setDismissDialog({ ...dismissDialog, open: o })}
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
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDismissDialog({ student: null, open: false })}
            >
              إلغاء
            </Button>
            <Button variant="destructive" onClick={handleDismiss}>
              تأكيد الفصل
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={fileDialog.open}
        onOpenChange={(o) => setFileDialog({ ...fileDialog, open: o })}
      >
        <DialogContent
          dir="rtl"
          className="max-w-2xl max-h-[80vh] overflow-y-auto"
        >
          <DialogHeader>
            <DialogTitle>ملف الطالب - {fileDialog.student?.name}</DialogTitle>
          </DialogHeader>
          {fileDialog.student && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <span className="text-muted-foreground">الكود:</span>{" "}
                  <strong>{fileDialog.student.code}</strong>
                </div>
                <div>
                  <span className="text-muted-foreground">الجنس:</span>{" "}
                  <strong>{fileDialog.student.gender}</strong>
                </div>
                <div>
                  <span className="text-muted-foreground">المدرسة:</span>{" "}
                  <strong>{fileDialog.student.school || "-"}</strong>
                </div>
                <div>
                  <span className="text-muted-foreground">الهاتف:</span>{" "}
                  <ContactLink href={whatsappLink(fileDialog.student.phone)}>
                    {fileDialog.student.phone}
                  </ContactLink>
                </div>
                <div>
                  <span className="text-muted-foreground">ولي الأمر:</span>{" "}
                  <ContactLink
                    href={whatsappLink(fileDialog.student.parentPhone)}
                  >
                    {fileDialog.student.parentPhone}
                  </ContactLink>
                </div>
                <div>
                  <span className="text-muted-foreground">التليكرام:</span>{" "}
                  {fileDialog.student.telegram ? (
                    <ContactLink
                      href={telegramLink(fileDialog.student.telegram)}
                    >
                      {fileDialog.student.telegram}
                    </ContactLink>
                  ) : (
                    "-"
                  )}
                </div>
                <div>
                  <span className="text-muted-foreground">الدورة:</span>{" "}
                  <strong>{courseName(fileDialog.student.courseId)}</strong>
                </div>
                <div>
                  <span className="text-muted-foreground">المجموعة الإلكترونية:</span>{" "}
                  <strong>{groupName(fileDialog.student.groupId)}</strong>
                </div>
                <div>
                  <span className="text-muted-foreground">الموقع:</span>{" "}
                  <strong>
                    {fileDialog.student.locationScope || fileDialog.student.mainSite} - {fileDialog.student.subSite}
                  </strong>
                </div>
                <div>
                  <span className="text-muted-foreground">الفرص:</span>{" "}
                  <strong>
                    {activeChapterForCourse(fileDialog.student.courseId) ? (
                      <>
                        {fileDialog.student.opportunities} /{" "}
                        {fileDialog.student.baseOpportunities}
                      </>
                    ) : (
                      "0 / 0 - لم يتم اختيار الفصل لهم بعد"
                    )}
                  </strong>
                </div>
                <div>
                  <span className="text-muted-foreground">الحالة:</span>{" "}
                  <Badge
                    variant={
                      fileDialog.student.status === "نشط"
                        ? "default"
                        : "destructive"
                    }
                  >
                    {fileDialog.student.status}
                  </Badge>
                </div>
                <div>
                  <span className="text-muted-foreground">تاريخ التسجيل:</span>{" "}
                  <strong>{fileDialog.student.createdAt}</strong>
                </div>
              </div>

              <Separator />

              <div>
                <h4 className="font-semibold mb-2">الدرجات الأخيرة</h4>
                <div className="space-y-1">
                  {studentGrades(fileDialog.student.id).length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      لا توجد درجات
                    </p>
                  ) : (
                    studentGrades(fileDialog.student.id)
                      .slice(0, 5)
                      .map((g) => {
                        const exam = exams.find((e) => e.id === g.examId);
                        return (
                          <div
                            key={g.id}
                            className="flex items-center justify-between text-sm p-2 rounded-xl bg-muted/60"
                          >
                            <span>{exam?.name || "غير محدد"}</span>
                            <Badge
                              variant={
                                g.status === "درجة" ? "default" : "secondary"
                              }
                            >
                              {g.status}
                            </Badge>
                            {g.score !== null && (
                              <span>
                                {g.score}/{exam?.fullMark || 100}
                              </span>
                            )}
                          </div>
                        );
                      })
                  )}
                </div>
              </div>

              <Separator />

              <div>
                <h4 className="font-semibold mb-2">سجل الفرص</h4>
                <div className="space-y-1 max-h-40 overflow-y-auto">
                  {studentOppLogs(fileDialog.student.id).length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      لا توجد حركات
                    </p>
                  ) : (
                    studentOppLogs(fileDialog.student.id)
                      .slice(0, 10)
                      .map((l) => (
                        <div
                          key={l.id}
                          className="flex items-center justify-between text-xs p-2 rounded-xl bg-muted/60"
                        >
                          <span>{l.date}</span>
                          <Badge
                            variant={
                              l.action === "خصم" ? "destructive" : "default"
                            }
                          >
                            {l.action} {l.amount}
                          </Badge>
                          <span className="text-muted-foreground">
                            {l.reason}
                          </span>
                        </div>
                      ))
                  )}
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
