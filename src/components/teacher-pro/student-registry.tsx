"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useTeacherStore, type Student } from "@/lib/teacher-store";
import { studentApi } from "@/lib/api";
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
  getAvailablePrograms,
  getAvailableStudyTypesForProgram,
  getBaghdadSites,
  getProvinceOptions,
  getLocationScopes,
  getBaghdadMode,
  OUT_OF_COUNTRY_LOCATION_SCOPE,
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
import {
  CalendarDays,
  GraduationCap,
  MapPin,
  Phone,
  SearchX,
  ShieldCheck,
  UserPlus,
  UserRound,
} from "lucide-react";
import { EmptyState } from "./ui-kit";
import { StudentProfileDialog } from "./student-profile-dialog";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { ExportDialog, type ExportColumn } from "./export-dialog";
import {
  STUDENT_FILTER_COURSE_PROGRAMS,
  STUDENT_FILTER_COURSE_TERMS,
  STUDENT_FILTER_STUDY_TYPES,
  getStudentLocationFilterOptions,
  studentMatchesListFilters,
} from "@/lib/student-list-filters";

const studentExportColumns: ExportColumn<any>[] = [
  { key: "code", label: "الكود", value: (s) => s.code || "" },
  { key: "name", label: "الاسم", value: (s) => s.name || "" },
  { key: "school", label: "المدرسة", value: (s) => s.school || "" },
  { key: "gender", label: "الجنس", value: (s) => s.gender || "" },
  { key: "course", label: "الدورة", value: (s) => s.courseName || "" },
  {
    key: "courseProgram",
    label: "نوع الدورة",
    value: (s) => s.courseProgram || "",
  },
  { key: "courseTerm", label: "الكورس", value: (s) => s.courseTerm || "" },
  { key: "studyType", label: "نوع الدراسة", value: (s) => s.studyType || "" },
  {
    key: "locationScope",
    label: "نطاق الموقع",
    value: (s) => s.locationScope || "",
  },
  { key: "location", label: "الموقع", value: (s) => s.locationText || "" },
  { key: "status", label: "الحالة", value: (s) => s.status || "" },
  { key: "opportunities", label: "الفرص", value: (s) => s.opportunities ?? "" },
  {
    key: "grace",
    label: "فترة السماح",
    value: (s) => `${s.accountingGraceDays ?? 0} يوم`,
  },
  { key: "phone", label: "الهاتف", value: (s) => s.phone || "" },
  { key: "parentPhone", label: "ولي الأمر", value: (s) => s.parentPhone || "" },
  { key: "telegram", label: "التليكرام", value: (s) => s.telegram || "" },
];

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
  const appPhone =
    sanitized.startsWith("07") && sanitized.length === 11
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
  const start = new Date(
    `${String(student.createdAt || "").slice(0, 10)}T00:00:00`,
  );
  const days = Number(student.accountingGraceDays || 0);
  if (!Number.isFinite(start.getTime()) || days <= 0)
    return formatAppDate(
      student.createdAt,
      String(student.createdAt || "").slice(0, 10) || "-",
    );
  const end = new Date(start);
  end.setDate(end.getDate() + days - 1);
  return formatAppDate(end);
}

function isStudentCurrentlyInGrace(student: Student): boolean {
  const days = Number(student.accountingGraceDays || 0);
  if (days <= 0) return false;
  const start = new Date(
    `${String(student.createdAt || "").slice(0, 10)}T00:00:00`,
  );
  const today = new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00`);
  const endExclusive = new Date(start);
  endExclusive.setDate(endExclusive.getDate() + days);
  return (
    Number.isFinite(start.getTime()) && today >= start && today < endExclusive
  );
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
    studentLeaves,
    studentCalls,
    studentNotes,
    logs,
    dismissStudent,
    reactivateStudent,
    updateStudent,
    deleteStudent,
    setSection,
    courseName,
    activeChapterForCourse,
  } = useTeacherStore();

  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState("");
  const [filterCourseProgram, setFilterCourseProgram] = useState("");
  const [filterCourseTerm, setFilterCourseTerm] = useState("");
  const [filterStudyType, setFilterStudyType] = useState("");
  const [filterLocation, setFilterLocation] = useState("");
  const [viewMode, setViewMode] = useState<RegistryViewMode>("cards");
  const [pageSize, setPageSize] = useState(10);
  const [page, setPage] = useState(1);
  const [serverStudents, setServerStudents] = useState<Student[] | null>(null);
  const [serverTotalCount, setServerTotalCount] = useState(0);
  const [serverTotalPages, setServerTotalPages] = useState(1);
  const [serverStudentsLoading, setServerStudentsLoading] = useState(false);
  const [serverStudentsError, setServerStudentsError] = useState<string | null>(
    null,
  );
  const [serverRefreshKey, setServerRefreshKey] = useState(0);

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
  const debouncedSearch = useDebouncedValue(search, 180);
  const locationFilterOptions = useMemo(
    () => getStudentLocationFilterOptions(students),
    [students],
  );

  useEffect(() => {
    let cancelled = false;

    setServerStudentsLoading(true);
    setServerStudentsError(null);

    studentApi
      .list({
        q: debouncedSearch,
        status: filterStatus,
        courseProgram: filterCourseProgram,
        courseTerm: filterCourseProgram === "كورسات" ? filterCourseTerm : "",
        studyType: filterStudyType,
        location: filterLocation,
        page,
        pageSize,
      })
      .then((result) => {
        if (cancelled) return;
        if (!result) {
          setServerStudents(null);
          setServerStudentsError(
            "تعذر تحميل نتائج الطلاب من الخادم. سيتم عرض النسخة المحلية مؤقتاً.",
          );
          return;
        }

        const nextTotalPages = Math.max(1, Number(result.totalPages || 1));
        setServerStudents((result.students || []) as Student[]);
        setServerTotalCount(Number(result.totalCount || 0));
        setServerTotalPages(nextTotalPages);

        if (page > nextTotalPages) {
          setPage(nextTotalPages);
        }
      })
      .catch(() => {
        if (cancelled) return;
        setServerStudents(null);
        setServerStudentsError(
          "تعذر تحميل نتائج الطلاب من الخادم. سيتم عرض النسخة المحلية مؤقتاً.",
        );
      })
      .finally(() => {
        if (!cancelled) setServerStudentsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [
    debouncedSearch,
    filterStatus,
    filterCourseProgram,
    filterCourseTerm,
    filterStudyType,
    filterLocation,
    page,
    pageSize,
    serverRefreshKey,
  ]);

  useEffect(() => {
    if (filterCourseProgram !== "كورسات" && filterCourseTerm) {
      setFilterCourseTerm("");
    }
  }, [filterCourseProgram, filterCourseTerm]);

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
    () =>
      editAvailablePrograms.length === 1
        ? editAvailablePrograms[0]
        : editDialog.form.courseProgram,
    [editAvailablePrograms, editDialog.form.courseProgram],
  );

  const editAvailableStudyTypes = useMemo(
    () =>
      editSelectedCourse && editEffectiveCourseProgram
        ? getAvailableStudyTypesForProgram(
            editSelectedCourse,
            editEffectiveCourseProgram,
          )
        : [],
    [editSelectedCourse, editEffectiveCourseProgram],
  );

  const editLocationScopes = useMemo(
    () =>
      editSelectedCourse && editDialog.form.studyType
        ? getLocationScopes(editSelectedCourse, editDialog.form.studyType)
        : [],
    [editSelectedCourse, editDialog.form.studyType],
  );

  const editBaghdadMode = useMemo(
    () =>
      editSelectedCourse && editDialog.form.studyType
        ? getBaghdadMode(editSelectedCourse, editDialog.form.studyType)
        : undefined,
    [editSelectedCourse, editDialog.form.studyType],
  );

  const editBaghdadSites = useMemo(
    () =>
      editSelectedCourse && editDialog.form.studyType
        ? getBaghdadSites(editSelectedCourse, editDialog.form.studyType)
        : [],
    [editSelectedCourse, editDialog.form.studyType],
  );

  const editProvinces = useMemo(
    () =>
      editSelectedCourse && editDialog.form.studyType
        ? getProvinceOptions(editSelectedCourse, editDialog.form.studyType)
        : [],
    [editSelectedCourse, editDialog.form.studyType],
  );

  const isEditOutOfCountry =
    editDialog.form.locationScope === OUT_OF_COUNTRY_LOCATION_SCOPE;

  const editSubSiteOptions = useMemo<string[]>(() => {
    if (!editSelectedCourse || !editDialog.form.studyType || isEditOutOfCountry)
      return [];
    if (editDialog.form.locationScope === "بغداد") {
      if (editBaghdadMode === "عموم بغداد") return [];
      if (editBaghdadMode === "بغداد - مخصص") return editBaghdadSites;
    }
    if (editDialog.form.locationScope === "محافظات") return editProvinces;
    return [];
  }, [
    editSelectedCourse,
    editDialog.form.studyType,
    editDialog.form.locationScope,
    isEditOutOfCountry,
    editBaghdadMode,
    editBaghdadSites,
    editProvinces,
  ]);

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

    if (
      editDialog.form.studyType &&
      !editAvailableStudyTypes.includes(editDialog.form.studyType as any)
    ) {
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
    if (
      editDialog.form.locationScope === "بغداد" &&
      editBaghdadMode === "عموم بغداد" &&
      editDialog.form.subSite !== "عموم بغداد"
    ) {
      patch.subSite = "عموم بغداد";
      needsPatch = true;
    }

    // Reset subSite if not in options
    if (
      !isEditOutOfCountry &&
      editSubSiteOptions.length > 0 &&
      editDialog.form.subSite &&
      !editSubSiteOptions.includes(editDialog.form.subSite) &&
      !(
        editDialog.form.locationScope === "بغداد" &&
        editBaghdadMode === "عموم بغداد"
      )
    ) {
      patch.subSite = "";
      needsPatch = true;
    }

    // Clear subSite if no options available
    if (
      !isEditOutOfCountry &&
      editSubSiteOptions.length === 0 &&
      editDialog.form.subSite &&
      editDialog.form.subSite !== "عموم بغداد"
    ) {
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
    isEditOutOfCountry,
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
    if (
      form.locationScope === OUT_OF_COUNTRY_LOCATION_SCOPE &&
      !form.subSite.trim()
    ) {
      return "يرجى إدخال الدولة عند اختيار خارج القطر";
    }
    if (
      form.locationScope !== OUT_OF_COUNTRY_LOCATION_SCOPE &&
      editSubSiteOptions.length > 0 &&
      !form.subSite
    ) {
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
      courseTerm: (editEffectiveCourseProgram === "كورسات"
        ? form.courseTerm
        : "") as any,
      studyType: form.studyType as any,
      locationScope: form.locationScope as any,
      baghdadMode: (form.locationScope === OUT_OF_COUNTRY_LOCATION_SCOPE
        ? ""
        : form.baghdadMode || editBaghdadMode || "") as any,
      courseId: form.courseId,
      mainSite: form.locationScope,
      subSite:
        form.subSite ||
        (form.locationScope === OUT_OF_COUNTRY_LOCATION_SCOPE
          ? ""
          : editBaghdadMode === "عموم بغداد"
            ? "عموم بغداد"
            : ""),
      createdAt: form.createdAt,
      accountingGraceDays: Number(form.accountingGraceDays || 0),
    });

    if (!result.ok) {
      toast.error(result.message);
      return;
    }
    setEditDialog({ open: false, id: "", form: emptyEditForm });
    setServerRefreshKey((value) => value + 1);
    toast.success("تم تعديل بيانات الطالب", {
      description: "تم تحديث جميع حقول الطالب بنجاح",
    });
  });

  const openDeleteDialog = (student: Student) => {
    setDeleteDialog({ open: true, id: student.id, studentName: student.name });
  };

  const handleDeleteConfirm = runDeleteStudentLocked(async () => {
    const ok = deleteStudent(deleteDialog.id);
    if (ok) {
      setServerRefreshKey((value) => value + 1);
      toast.success("تم حذف الطالب");
    } else {
      toast.error("تعذر حذف الطالب");
    }
    setDeleteDialog({ open: false, id: "", studentName: "" });
  });

  const localFiltered = useMemo(() => {
    return students.filter((s) => {
      if (
        debouncedSearch &&
        !searchAny(debouncedSearch, [
          s.name,
          s.code,
          s.telegram,
          s.phone,
          s.parentPhone,
        ])
      )
        return false;
      if (filterStatus && s.status !== filterStatus) return false;
      if (
        !studentMatchesListFilters(s, {
          courseProgram: filterCourseProgram,
          courseTerm: filterCourseTerm,
          studyType: filterStudyType,
          location: filterLocation,
        })
      )
        return false;
      return true;
    });
  }, [
    students,
    debouncedSearch,
    filterStatus,
    filterCourseProgram,
    filterCourseTerm,
    filterStudyType,
    filterLocation,
  ]);

  const usingServerStudents = Boolean(serverStudents);
  const filtered = usingServerStudents ? serverStudents! : localFiltered;
  const filteredTotalCount = usingServerStudents
    ? serverTotalCount
    : localFiltered.length;
  const totalPages = usingServerStudents
    ? serverTotalPages
    : Math.max(1, Math.ceil(localFiltered.length / pageSize));
  const paged = usingServerStudents
    ? filtered
    : localFiltered.slice((page - 1) * pageSize, page * pageSize);
  const dismissedStudents = students.filter(
    (student) => student.status === "مفصول",
  );
  const noActiveChapterStudents = students.filter(
    (student) => !activeChapterForCourse(student.courseId),
  );

  const handleDismiss = () => {
    if (!dismissDialog.student) return;
    if (!dismissReason.trim()) {
      toast.error("يرجى إدخال سبب الفصل");
      return;
    }
    dismissStudent(
      dismissDialog.student.id,
      dismissType,
      dismissReason.trim(),
      dismissNotes.trim(),
    );
    setDismissDialog({ student: null, open: false });
    setDismissReason("");
    setDismissNotes("");
    toast.success("تم فصل الطالب");
  };

  const handleReactivate = (studentId: string) => {
    reactivateStudent(studentId);
    toast.success("تم إعادة تفعيل الطالب");
  };

  const studentExportRows = localFiltered.map((student) => ({
    ...student,
    courseName: courseName(student.courseId),
    locationText: `${student.locationScope || student.mainSite || ""} - ${student.subSite || ""}`,
  }));

  const studentOppLogs = (studentId: string) =>
    opportunityLogs.filter((l) => l.studentId === studentId);
  const studentGrades = (studentId: string) =>
    grades.filter((g) => g.studentId === studentId);

  const resetFilters = () => {
    setSearch("");
    setFilterStatus("");
    setFilterCourseProgram("");
    setFilterCourseTerm("");
    setFilterStudyType("");
    setFilterLocation("");
    setViewMode("cards");
    setPage(1);
  };

  const activeFileStudent = fileDialog.student
    ? students.find((student) => student.id === fileDialog.student?.id) ||
      fileDialog.student
    : null;

  if (fileDialog.open && activeFileStudent) {
    return (
      <StudentProfileDialog
        student={activeFileStudent}
        open
        onOpenChange={(open) => {
          if (!open) setFileDialog({ student: null, open: false });
        }}
        exams={exams}
        grades={grades}
        opportunityLogs={opportunityLogs}
        studentLeaves={studentLeaves}
        studentCalls={studentCalls}
        studentNotes={studentNotes}
        logs={logs}
        courseName={courseName}
        activeChapterForCourse={activeChapterForCourse}
        whatsappLink={whatsappLink}
        telegramLink={telegramLink}
        isStudentCurrentlyInGrace={isStudentCurrentlyInGrace}
        graceEndDate={graceEndDate}
      />
    );
  }

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
                data-teacherpro-search="true"
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
              <Label htmlFor="registry-program" className="text-xs">
                نوع الدورة
              </Label>
              <Select
                name="courseProgram"
                value={filterCourseProgram || "all"}
                onValueChange={(v) => {
                  setFilterCourseProgram(v === "all" ? "" : v);
                  setPage(1);
                }}
              >
                <SelectTrigger id="registry-program">
                  <SelectValue placeholder="الكل" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">الكل</SelectItem>
                  {STUDENT_FILTER_COURSE_PROGRAMS.map((program) => (
                    <SelectItem key={program} value={program}>
                      {program}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {filterCourseProgram === "كورسات" && (
              <div className="space-y-1">
                <Label htmlFor="registry-term" className="text-xs">
                  الكورس
                </Label>
                <Select
                  name="courseTerm"
                  value={filterCourseTerm || "all"}
                  onValueChange={(v) => {
                    setFilterCourseTerm(v === "all" ? "" : v);
                    setPage(1);
                  }}
                >
                  <SelectTrigger id="registry-term">
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
            <div className="space-y-1">
              <Label htmlFor="registry-study-type" className="text-xs">
                نوع الدراسة
              </Label>
              <Select
                name="studyType"
                value={filterStudyType || "all"}
                onValueChange={(v) => {
                  setFilterStudyType(v === "all" ? "" : v);
                  setPage(1);
                }}
              >
                <SelectTrigger id="registry-study-type">
                  <SelectValue placeholder="الكل" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">الكل</SelectItem>
                  {STUDENT_FILTER_STUDY_TYPES.map((studyType) => (
                    <SelectItem key={studyType} value={studyType}>
                      {studyType}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="registry-location" className="text-xs">
                المحافظة / الموقع
              </Label>
              <Select
                name="location"
                value={filterLocation || "all"}
                onValueChange={(v) => {
                  setFilterLocation(v === "all" ? "" : v);
                  setPage(1);
                }}
              >
                <SelectTrigger id="registry-location">
                  <SelectValue placeholder="الكل" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">الكل</SelectItem>
                  {locationFilterOptions.map((location) => (
                    <SelectItem key={location} value={location}>
                      {location}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="registry-view" className="text-xs">
                طريقة العرض
              </Label>
              <Select
                value={viewMode}
                onValueChange={(v) => setViewMode(v as RegistryViewMode)}
              >
                <SelectTrigger id="registry-view">
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
                title="تصدير سجل الطلاب"
                fileName="students"
                rows={studentExportRows}
                columns={studentExportColumns}
                triggerLabel="تصدير"
                description="تقرير سجل الطلاب حسب الفلاتر الحالية"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <Card className="bg-card/80">
          <CardContent className="flex items-center justify-between gap-3 p-4">
            <div>
              <p className="text-xs text-muted-foreground">الطلاب النشطون</p>
              <p className="text-2xl font-black">
                {students.filter((student) => student.status === "نشط").length}
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setFilterStatus("نشط");
                setPage(1);
              }}
            >
              عرض
            </Button>
          </CardContent>
        </Card>
        <Card className="border-destructive/30 bg-destructive/5">
          <CardContent className="flex items-center justify-between gap-3 p-4">
            <div>
              <p className="text-xs text-muted-foreground">قائمة المفصولين</p>
              <p className="text-2xl font-black text-destructive">
                {dismissedStudents.length}
              </p>
            </div>
            <Button
              variant="destructive"
              size="sm"
              onClick={() => {
                setFilterStatus("مفصول");
                setPage(1);
              }}
            >
              عرض المفصولين
            </Button>
          </CardContent>
        </Card>
        <Card className="border-amber-500/30 bg-amber-500/5">
          <CardContent className="flex items-center justify-between gap-3 p-4">
            <div>
              <p className="text-xs text-muted-foreground">بدون فصل نشط</p>
              <p className="text-2xl font-black text-amber-600">
                {noActiveChapterStudents.length}
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                resetFilters();
              }}
            >
              عرض الكل
            </Button>
          </CardContent>
        </Card>
      </div>

      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <span>
          عرض {paged.length} من {filteredTotalCount} طالب
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

      {serverStudentsLoading && (
        <div className="rounded-2xl border border-primary/20 bg-primary/5 p-3 text-sm font-medium text-primary">
          جاري تحميل نتائج الطلاب من قاعدة البيانات...
        </div>
      )}

      {serverStudentsError && (
        <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-3 text-sm font-medium text-amber-700 dark:text-amber-300">
          {serverStudentsError}
        </div>
      )}

      {students.length === 0 &&
      filteredTotalCount === 0 &&
      !serverStudentsLoading ? (
        <EmptyState
          icon={UserPlus}
          title="لم تقم بإضافة طلاب بعد"
          description="ابدأ بإضافة أول طالب، وبعدها ستظهر البطاقات والفلاتر والإحصائيات هنا تلقائياً."
          action={
            <Button
              onClick={() => setSection("student-register")}
              className="min-h-11 px-6"
            >
              إضافة طالب الآن
            </Button>
          }
        />
      ) : filteredTotalCount === 0 ? (
        <EmptyState
          icon={SearchX}
          title="لا توجد نتائج مطابقة"
          description="الفلاتر تعمل معاً؛ غيّر شروط البحث أو امسح الفلاتر لعرض كل الطلاب."
          action={
            <Button
              variant="outline"
              onClick={resetFilters}
              className="min-h-11 px-6"
            >
              مسح الفلاتر
            </Button>
          }
        />
      ) : viewMode === "cards" ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {paged.map((student) => (
            <Card
              key={student.id}
              className="transition-all duration-200 hover:-translate-y-0.5 hover:shadow-xl hover:shadow-primary/10"
            >
              <CardContent className="p-4">
                <div className="mb-3 flex items-start justify-between gap-3">
                  <div>
                    <p className="font-bold">{student.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {student.code} - {student.school || "بدون مدرسة"}
                    </p>
                  </div>
                  <Badge
                    variant={
                      student.status === "نشط" ? "default" : "destructive"
                    }
                  >
                    {student.status}
                  </Badge>
                </div>

                <div className="mb-3 grid grid-cols-2 gap-2 text-sm">
                  <div>
                    <span className="text-xs text-muted-foreground">
                      الدورة
                    </span>
                    <p className="text-xs font-medium">
                      {courseName(student.courseId)}
                    </p>
                  </div>
                  <div>
                    <span className="text-xs text-muted-foreground">
                      نوع الدورة
                    </span>
                    <p className="text-xs font-medium">
                      {student.courseProgram
                        ? student.courseProgram === "كورسات"
                          ? `كورسات - ${student.courseTerm}`
                          : student.courseProgram
                        : "-"}
                    </p>
                  </div>
                  <div>
                    <span className="text-xs text-muted-foreground">
                      نوع الدراسة
                    </span>
                    <p className="text-xs font-medium">
                      {student.studyType || "-"}
                    </p>
                  </div>
                  <div>
                    <span className="text-xs text-muted-foreground">
                      الموقع
                    </span>
                    <p className="text-xs font-medium">{`${student.locationScope || student.mainSite || "-"} - ${student.subSite || "-"}`}</p>
                  </div>
                  <div>
                    <span className="text-xs text-muted-foreground">الفرص</span>
                    <p className="text-xs font-medium">
                      {activeChapterForCourse(student.courseId)
                        ? `${student.opportunities} / ${student.baseOpportunities}`
                        : "0 / 0 - لم يتم اختيار الفصل"}
                    </p>
                  </div>
                  <div>
                    <span className="text-xs text-muted-foreground">
                      السماح
                    </span>
                    <p className="text-xs font-medium">
                      {student.accountingGraceDays ?? 0} يوم
                    </p>
                  </div>
                  <div>
                    <span className="text-xs text-muted-foreground">
                      تاريخ الإضافة
                    </span>
                    <p className="text-xs font-medium">
                      {formatAppDate(
                        student.createdAt,
                        student.createdAt || "-",
                      )}
                    </p>
                  </div>
                  <div>
                    <span className="text-xs text-muted-foreground">
                      تليكرام
                    </span>
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
                    <span className="text-xs text-muted-foreground">
                      رقم الطالب
                    </span>
                    <p className="text-xs">
                      <ContactLink href={whatsappLink(student.phone)}>
                        {student.phone}
                      </ContactLink>
                    </p>
                  </div>
                  <div>
                    <span className="text-xs text-muted-foreground">
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
                  <div className="mb-3 rounded bg-destructive/10 p-2 text-xs text-destructive">
                    <div>
                      {student.dismissalType} - {student.dismissalReason}
                    </div>
                    {student.dismissalNotes && (
                      <div className="mt-1 text-destructive/80">
                        ملاحظات: {student.dismissalNotes}
                      </div>
                    )}
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
                  <td className="p-3 font-medium">
                    {student.name}
                    <div className="text-xs text-muted-foreground">
                      {student.school || "بدون مدرسة"}
                    </div>
                  </td>
                  <td className="p-3">{student.code}</td>
                  <td className="p-3">{courseName(student.courseId)}</td>
                  <td className="p-3">{student.studyType || "—"}</td>
                  <td className="p-3 min-w-40">{`${student.locationScope || student.mainSite || "-"} - ${student.subSite || "-"}`}</td>
                  <td className="p-3">
                    <ContactLink href={whatsappLink(student.phone)}>
                      {student.phone}
                    </ContactLink>
                  </td>
                  <td className="p-3">
                    {student.telegram ? (
                      <ContactLink href={telegramLink(student.telegram)}>
                        {student.telegram}
                      </ContactLink>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="p-3">
                    {activeChapterForCourse(student.courseId)
                      ? `${student.opportunities} / ${student.baseOpportunities}`
                      : "0 / 0"}
                  </td>
                  <td className="p-3">
                    {student.accountingGraceDays ?? 0} يوم
                  </td>
                  <td className="p-3">
                    <Badge
                      variant={
                        student.status === "نشط" ? "default" : "destructive"
                      }
                    >
                      {student.status}
                    </Badge>
                  </td>
                  <td className="p-3 min-w-56">
                    <div className="flex flex-wrap gap-1">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setFileDialog({ student, open: true })}
                      >
                        ملف
                      </Button>
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => openEditDialog(student)}
                      >
                        تعديل
                      </Button>
                      {student.status === "نشط" ? (
                        <Button
                          variant="destructive"
                          size="sm"
                          onClick={() =>
                            setDismissDialog({ student, open: true })
                          }
                        >
                          فصل
                        </Button>
                      ) : (
                        <Button
                          size="sm"
                          onClick={() => handleReactivate(student.id)}
                        >
                          تفعيل
                        </Button>
                      )}
                      <Button
                        variant="destructive"
                        size="sm"
                        onClick={() => openDeleteDialog(student)}
                      >
                        حذف
                      </Button>
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
          className="left-0 top-0 h-screen max-h-screen w-screen max-w-none translate-x-0 translate-y-0 gap-0 overflow-hidden rounded-none border-0 p-0 shadow-none sm:max-w-none sm:rounded-none sm:p-0"
        >
          <DialogHeader className="border-b border-border/70 bg-gradient-to-l from-primary/12 via-background to-muted/50 px-6 py-5 pr-16 text-right">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div>
                <DialogTitle className="text-2xl font-black tracking-tight text-gradient-brand">
                  تعديل بيانات الطالب
                </DialogTitle>
                <DialogDescription className="mt-2 text-sm leading-6">
                  واجهة منظمة لتحديث البيانات الأساسية، الاتصال، الدورة، وفترة
                  السماح بدون تغيير آلية الحفظ.
                </DialogDescription>
              </div>
              <Badge
                variant="secondary"
                className="w-fit rounded-full px-4 py-1 text-xs font-bold"
              >
                {editDialog.form.gender || "بيانات الطالب"}
              </Badge>
            </div>
          </DialogHeader>

          <div className="app-scrollbar h-[calc(100vh-10.5rem)] overflow-y-auto p-4 md:p-6">
            <div className="grid gap-5 lg:grid-cols-[0.9fr_1.6fr]">
              <aside className="space-y-4">
                <div className="rounded-[1.75rem] border border-primary/20 bg-primary/5 p-4 shadow-sm">
                  <div className="flex items-center gap-3">
                    <div className="flex size-14 shrink-0 items-center justify-center rounded-3xl bg-primary text-xl font-black text-primary-foreground shadow-lg shadow-primary/20">
                      {editDialog.form.name.trim().slice(0, 1) || "ط"}
                    </div>
                    <div className="min-w-0">
                      <p className="truncate text-lg font-black">
                        {editDialog.form.name || "اسم الطالب"}
                      </p>
                      <p className="truncate text-xs text-muted-foreground">
                        {editDialog.form.school || "المدرسة غير محددة"}
                      </p>
                    </div>
                  </div>

                  <div className="mt-4 grid gap-2 text-sm">
                    <div className="rounded-2xl bg-background/80 p-3">
                      <span className="text-xs text-muted-foreground">
                        الدورة
                      </span>
                      <p className="mt-1 font-bold">
                        {editDialog.form.courseId
                          ? courseName(editDialog.form.courseId)
                          : "لم يتم اختيار دورة"}
                      </p>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div className="rounded-2xl bg-background/80 p-3 text-center">
                        <p className="text-xs text-muted-foreground">الهاتف</p>
                        <p className="mt-1 truncate font-black">
                          {editDialog.form.phone || "—"}
                        </p>
                      </div>
                      <div className="rounded-2xl bg-background/80 p-3 text-center">
                        <p className="text-xs text-muted-foreground">السماح</p>
                        <p className="mt-1 font-black">
                          {editDialog.form.accountingGraceDays || "0"} يوم
                        </p>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="rounded-[1.75rem] border bg-card p-4 shadow-sm">
                  <div className="mb-3 flex items-center gap-2">
                    <ShieldCheck className="size-4 text-primary" />
                    <h4 className="font-black">ملاحظات الإدخال</h4>
                  </div>
                  <ul className="space-y-2 text-xs leading-6 text-muted-foreground">
                    <li>• الأرقام تقبل الصيغة العراقية 07 وتتكون من 11 رقم.</li>
                    <li>• فترة السماح لا تتجاوز 30 يوم.</li>
                    <li>
                      • تغيير الدورة يعيد تهيئة خيارات نوع الدراسة والموقع.
                    </li>
                  </ul>
                </div>
              </aside>

              <div className="space-y-5">
                <section className="rounded-[1.75rem] border bg-card p-4 shadow-sm md:p-5">
                  <div className="mb-4 flex items-center gap-2">
                    <UserRound className="size-5 text-primary" />
                    <div>
                      <h3 className="font-black">البيانات الأساسية</h3>
                      <p className="text-xs text-muted-foreground">
                        الاسم، المدرسة، الجنس، ومعرف التليكرام.
                      </p>
                    </div>
                  </div>
                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="space-y-2 md:col-span-2">
                      <Label htmlFor="edit-name">اسم الطالب</Label>
                      <Input
                        id="edit-name"
                        name="name"
                        autoComplete="off"
                        value={editDialog.form.name}
                        onChange={(e) => updateEditForm("name", e.target.value)}
                        required
                        placeholder="اسم الطالب الرباعي"
                        className="h-12 rounded-2xl"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="edit-school">اسم المدرسة</Label>
                      <Input
                        id="edit-school"
                        name="school"
                        autoComplete="off"
                        value={editDialog.form.school}
                        onChange={(e) =>
                          updateEditForm("school", e.target.value)
                        }
                        required
                        placeholder="اسم المدرسة"
                        className="h-12 rounded-2xl"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="edit-gender">الجنس</Label>
                      <Select
                        name="gender"
                        value={editDialog.form.gender}
                        onValueChange={(v) => updateEditForm("gender", v)}
                      >
                        <SelectTrigger
                          id="edit-gender"
                          className="h-12 rounded-2xl"
                        >
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="ذكر">ذكر</SelectItem>
                          <SelectItem value="أنثى">أنثى</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2 md:col-span-2">
                      <Label htmlFor="edit-telegram">معرف التليكرام</Label>
                      <Input
                        id="edit-telegram"
                        name="telegram"
                        autoComplete="off"
                        value={editDialog.form.telegram}
                        onChange={(e) => updateEditTelegram(e.target.value)}
                        placeholder="اختياري - username بدون @"
                        className="h-12 rounded-2xl"
                      />
                    </div>
                  </div>
                </section>

                <section className="rounded-[1.75rem] border bg-card p-4 shadow-sm md:p-5">
                  <div className="mb-4 flex items-center gap-2">
                    <Phone className="size-5 text-primary" />
                    <div>
                      <h3 className="font-black">بيانات الاتصال</h3>
                      <p className="text-xs text-muted-foreground">
                        أرقام الطالب وولي الأمر مع ضبط الصيغة تلقائياً.
                      </p>
                    </div>
                  </div>
                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor="edit-phone">رقم الطالب</Label>
                      <Input
                        id="edit-phone"
                        name="phone"
                        autoComplete="off"
                        value={editDialog.form.phone}
                        onChange={(e) =>
                          updateEditPhone("phone", e.target.value)
                        }
                        inputMode="numeric"
                        maxLength={11}
                        pattern="07[0-9]{9}"
                        dir="ltr"
                        required
                        className="h-12 rounded-2xl text-left"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="edit-parentPhone">رقم ولي الأمر</Label>
                      <Input
                        id="edit-parentPhone"
                        name="parentPhone"
                        autoComplete="off"
                        value={editDialog.form.parentPhone}
                        onChange={(e) =>
                          updateEditPhone("parentPhone", e.target.value)
                        }
                        inputMode="numeric"
                        maxLength={11}
                        pattern="07[0-9]{9}"
                        dir="ltr"
                        required
                        className="h-12 rounded-2xl text-left"
                      />
                    </div>
                  </div>
                </section>

                <section className="rounded-[1.75rem] border bg-card p-4 shadow-sm md:p-5">
                  <div className="mb-4 flex items-center gap-2">
                    <GraduationCap className="size-5 text-primary" />
                    <div>
                      <h3 className="font-black">الدورة ونوع الدراسة</h3>
                      <p className="text-xs text-muted-foreground">
                        اختر الدورة ثم أكمل الخيارات المرتبطة بها.
                      </p>
                    </div>
                  </div>
                  <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                    <div className="space-y-2 xl:col-span-2">
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
                        <SelectTrigger
                          id="edit-courseId"
                          className="h-12 rounded-2xl"
                        >
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

                    {editDialog.form.courseId &&
                      editAvailablePrograms.length > 1 && (
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
                                  courseTerm:
                                    v === "كورسات" ? prev.form.courseTerm : "",
                                  studyType: "",
                                  locationScope: "",
                                  baghdadMode: "",
                                  subSite: "",
                                },
                              }))
                            }
                          >
                            <SelectTrigger
                              id="edit-courseProgram"
                              className="h-12 rounded-2xl"
                            >
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
                          <SelectTrigger
                            id="edit-courseTerm"
                            className="h-12 rounded-2xl"
                          >
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

                    {editDialog.form.courseId &&
                      editAvailableStudyTypes.length > 0 && (
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
                            <SelectTrigger
                              id="edit-studyType"
                              className="h-12 rounded-2xl"
                            >
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
                  </div>
                </section>

                <section className="rounded-[1.75rem] border bg-card p-4 shadow-sm md:p-5">
                  <div className="mb-4 flex items-center gap-2">
                    <MapPin className="size-5 text-primary" />
                    <div>
                      <h3 className="font-black">الموقع</h3>
                      <p className="text-xs text-muted-foreground">
                        تظهر الخيارات حسب نوع الدراسة والدورة المختارة.
                      </p>
                    </div>
                  </div>
                  <div className="grid gap-4 md:grid-cols-2">
                    {editDialog.form.studyType &&
                    editLocationScopes.length > 0 ? (
                      <div className="space-y-2">
                        <Label htmlFor="edit-locationScope">الموقع</Label>
                        <Select
                          name="locationScope"
                          value={
                            isEditOutOfCountry
                              ? ""
                              : editDialog.form.locationScope
                          }
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
                          <SelectTrigger
                            id="edit-locationScope"
                            className="h-12 rounded-2xl"
                          >
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
                        <label className="mt-3 flex cursor-pointer items-center gap-2 rounded-2xl border border-dashed bg-muted/30 p-3 text-sm font-bold text-foreground transition hover:bg-muted/50">
                          <input
                            type="checkbox"
                            className="size-4 accent-primary"
                            checked={isEditOutOfCountry}
                            onChange={(event) =>
                              setEditDialog((prev) => ({
                                ...prev,
                                form: {
                                  ...prev.form,
                                  locationScope: event.target.checked
                                    ? OUT_OF_COUNTRY_LOCATION_SCOPE
                                    : "",
                                  baghdadMode: "",
                                  subSite: "",
                                },
                              }))
                            }
                          />
                          الطالب خارج القطر
                        </label>
                      </div>
                    ) : (
                      <div className="rounded-2xl border border-dashed bg-muted/30 p-4 text-sm text-muted-foreground md:col-span-2">
                        اختر الدورة ونوع الدراسة لعرض خيارات الموقع.
                      </div>
                    )}

                    {isEditOutOfCountry && (
                      <div className="space-y-2">
                        <Label htmlFor="edit-outOfCountrySite">الدولة</Label>
                        <Input
                          id="edit-outOfCountrySite"
                          name="subSite"
                          autoComplete="off"
                          value={editDialog.form.subSite}
                          onChange={(e) =>
                            updateEditForm("subSite", e.target.value)
                          }
                          placeholder="مثلاً: تركيا"
                          required
                          className="h-12 rounded-2xl"
                        />
                        <p className="text-xs text-muted-foreground">
                          خيار خارج القطر عام لكل الدورات ولا يحتاج تفعيله من
                          إعدادات الدورة.
                        </p>
                      </div>
                    )}

                    {editDialog.form.locationScope &&
                      !isEditOutOfCountry &&
                      editSubSiteOptions.length > 0 && (
                        <div className="space-y-2">
                          <Label htmlFor="edit-subSite">الموقع الفرعي</Label>
                          <Select
                            name="subSite"
                            value={editDialog.form.subSite}
                            onValueChange={(v) => updateEditForm("subSite", v)}
                          >
                            <SelectTrigger
                              id="edit-subSite"
                              className="h-12 rounded-2xl"
                            >
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
                  </div>
                </section>

                <section className="rounded-[1.75rem] border bg-card p-4 shadow-sm md:p-5">
                  <div className="mb-4 flex items-center gap-2">
                    <CalendarDays className="size-5 text-primary" />
                    <div>
                      <h3 className="font-black">التسجيل وفترة السماح</h3>
                      <p className="text-xs text-muted-foreground">
                        يحدد هذا الجزء بداية احتساب الطالب أكاديمياً.
                      </p>
                    </div>
                  </div>
                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor="edit-createdAt">
                        تاريخ إضافة الطالب / بداية السماح
                      </Label>
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
                      <Label htmlFor="edit-accountingGraceDays">
                        فترة السماح بالأيام
                      </Label>
                      <Input
                        id="edit-accountingGraceDays"
                        name="accountingGraceDays"
                        inputMode="numeric"
                        min={0}
                        max={30}
                        pattern="(?:[0-9]|[12][0-9]|30)"
                        autoComplete="off"
                        value={editDialog.form.accountingGraceDays}
                        onChange={(e) =>
                          updateEditForm(
                            "accountingGraceDays",
                            normalizeGraceDaysInput(e.target.value),
                          )
                        }
                        required
                        className="h-12 rounded-2xl"
                      />
                      <p className="text-xs text-muted-foreground">
                        لا يُحاسَب الطالب على الامتحانات أو الإخفاقات خلال هذه
                        الأيام.
                      </p>
                    </div>
                  </div>
                </section>
              </div>
            </div>
          </div>

          <DialogFooter className="border-t border-border/70 bg-muted/30 px-4 py-4 sm:justify-between md:px-6">
            <p className="hidden text-xs text-muted-foreground sm:block">
              راجع الحقول المطلوبة قبل حفظ التعديل.
            </p>
            <div className="flex w-full flex-col-reverse gap-2 sm:w-auto sm:flex-row">
              <Button
                variant="outline"
                className="min-w-28 rounded-2xl"
                onClick={() =>
                  setEditDialog({ open: false, id: "", form: emptyEditForm })
                }
              >
                إلغاء
              </Button>
              <Button
                className="min-w-32 rounded-2xl"
                onClick={handleEditSave}
                disabled={isSavingEdit}
              >
                {isSavingEdit ? "جاري الحفظ..." : "حفظ التعديلات"}
              </Button>
            </div>
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
              <Select
                name="type"
                value={dismissType}
                onValueChange={setDismissType}
              >
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
    </div>
  );
}
