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
  formatNumberLatin,
  getPhoneValidationError,
  sanitizePhoneInput,
  toLatinDigits,
} from "@/lib/format";
import {
  PUBLIC_MAIN_SITE_OPTIONS,
  PRIVATE_BAGHDAD_SUB_SITES,
  IRAQI_PROVINCES,
} from "@/lib/iraq";
import {
  getStudentDuplicateMessage,
  isValidAccountingGraceDays,
  normalizeTelegramIdentifier,
  sanitizeTelegramInput,
} from "@/lib/student-utils";
import {
  getRequiredTextError,
  searchAny,
  TEXT_ONLY_PATTERN,
} from "@/lib/validation";
import { useActionLock } from "@/hooks/use-action-lock";

type StudentEditForm = {
  name: string;
  school: string;
  gender: "ذكر" | "أنثى";
  phone: string;
  parentPhone: string;
  telegram: string;
  courseType: "خاصة" | "عامة";
  courseId: string;
  groupId: string;
  mainSite: string;
  subSite: string;
  receiptNo: string;
  codeSequence: string;
  totalAmount: string;
  paidAmount: string;
  createdAt: string;
  accountingStart: string;
};

const emptyEditForm: StudentEditForm = {
  name: "",
  school: "",
  gender: "ذكر",
  phone: "",
  parentPhone: "",
  telegram: "",
  courseType: "خاصة",
  courseId: "",
  groupId: "",
  mainSite: "بغداد",
  subSite: "",
  receiptNo: "",
  codeSequence: "",
  totalAmount: "",
  paidAmount: "",
  createdAt: new Date().toISOString().slice(0, 10),
  accountingStart: "",
};

function getStudentEditForm(student: Student): StudentEditForm {
  return {
    name: student.name,
    school: student.school || "",
    gender: student.gender,
    phone: student.phone,
    parentPhone: student.parentPhone,
    telegram: sanitizeTelegramInput(student.telegram),
    courseType: student.courseType,
    courseId: student.courseId,
    groupId: student.groupId,
    mainSite: student.mainSite || "بغداد",
    subSite: student.subSite || "",
    receiptNo: student.receiptNo || "",
    codeSequence: student.codeSequence || "",
    totalAmount: student.totalAmount ? String(student.totalAmount) : "",
    paidAmount: student.paidAmount
      ? String(student.paidAmount)
      : student.installments?.[0]?.amount
        ? String(student.installments[0].amount)
        : "",
    createdAt: student.createdAt || new Date().toISOString().slice(0, 10),
    accountingStart: student.accountingStart || "",
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
    sites,
    exams,
    grades,
    opportunityLogs,
    dismissStudent,
    reactivateStudent,
    updateStudent,
    deleteStudent,
    courseName,
    groupName,
  } = useTeacherStore();

  const [search, setSearch] = useState("");
  const [filterCourseType, setFilterCourseType] = useState("");
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

  const editIsPrivate = editDialog.form.courseType === "خاصة";

  const editFilteredCourses = useMemo(
    () =>
      courses.filter((c) => c.type === editDialog.form.courseType && c.active),
    [courses, editDialog.form.courseType],
  );

  const editFilteredGroups = useMemo(
    () =>
      groups.filter((g) => g.courseId === editDialog.form.courseId && g.active),
    [groups, editDialog.form.courseId],
  );

  const editMainSiteOptions = useMemo(() => {
    if (editIsPrivate) return ["بغداد"];
    return [...PUBLIC_MAIN_SITE_OPTIONS];
  }, [editIsPrivate]);

  const editSubSiteOptions = useMemo<string[]>(() => {
    // خاصة + بغداد → المنصور، زيونة، البنوك
    if (editIsPrivate && editDialog.form.mainSite === "بغداد")
      return [...PRIVATE_BAGHDAD_SUB_SITES];
    // عامة + بغداد → لا مواقع فرعية
    if (!editIsPrivate && editDialog.form.mainSite === "بغداد") return [];
    // عامة + محافظات → المحافظات الـ17
    if (!editIsPrivate && editDialog.form.mainSite === "محافظات")
      return [...IRAQI_PROVINCES];
    return [];
  }, [editIsPrivate, editDialog.form.mainSite]);

  const editTotalAmount = Number(editDialog.form.totalAmount || 0);
  const editPaidAmount = Number(editDialog.form.paidAmount || 0);
  const editRemainingAmount = Math.max(editTotalAmount - editPaidAmount, 0);

  useEffect(() => {
    if (!editDialog.open) return;
    let nextPatch: Partial<StudentEditForm> | null = null;
    if (!editMainSiteOptions.includes(editDialog.form.mainSite)) {
      nextPatch = { mainSite: editMainSiteOptions[0] || "", subSite: "" };
    } else if (editSubSiteOptions.length === 0 && editDialog.form.subSite) {
      nextPatch = { subSite: "" };
    } else if (
      editSubSiteOptions.length > 0 &&
      !editSubSiteOptions.includes(editDialog.form.subSite)
    ) {
      nextPatch = { subSite: "" };
    }
    if (!nextPatch) return;
    const patch = nextPatch;
    queueMicrotask(() => {
      setEditDialog((prev) => ({ ...prev, form: { ...prev.form, ...patch } }));
    });
  }, [
    editDialog.open,
    editDialog.form.mainSite,
    editDialog.form.subSite,
    editMainSiteOptions,
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

  const updateEditAccountingDays = (value: string) => {
    setEditDialog((prev) => ({
      ...prev,
      form: {
        ...prev.form,
        accountingStart: toLatinDigits(value).replace(/\D/g, "").slice(0, 2),
      },
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
      [Boolean(form.courseType), "نوع الدورة مطلوب"],
      [
        Boolean(form.courseId),
        editFilteredCourses.length === 0
          ? "لا توجد دورات مسجلة لهذا النوع"
          : "يرجى اختيار الدورة",
      ],
      [Boolean(form.mainSite), "الموقع الرئيسي مطلوب"],
      [
        editSubSiteOptions.length === 0 || Boolean(form.subSite),
        editSubSiteOptions.length === 0
          ? "لا توجد مناطق فرعية لهذا الموقع"
          : "الموقع الفرعي مطلوب",
      ],
      [
        Boolean(form.groupId),
        editFilteredGroups.length === 0
          ? "لا توجد كروبات مسجلة لهذه الدورة"
          : "الكروب الإلكتروني مطلوب",
      ],
      [Boolean(form.createdAt), "تاريخ إضافة الطالب مطلوب"],
      [form.accountingStart.trim() !== "", "فترة السماح مطلوبة"],
    ];

    if (form.courseType === "خاصة") {
      requiredChecks.push(
        [Boolean(form.receiptNo.trim()), "رقم الوصل مطلوب"],
        [Boolean(form.codeSequence.trim()), "تسلسل الكود مطلوب"],
        [form.totalAmount.trim() !== "", "المبلغ الكلي مطلوب"],
        [form.paidAmount.trim() !== "", "المبلغ المدفوع مطلوب"],
      );
    }

    const missing = requiredChecks.find(([ok]) => !ok);
    if (missing) return missing[1];

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

    if (!isValidAccountingGraceDays(form.accountingStart))
      return "فترة السماح يجب أن تكون رقماً من 0 إلى 30 يوم";
    if (
      form.courseType === "خاصة" &&
      Number(form.paidAmount || 0) > Number(form.totalAmount || 0)
    )
      return "المبلغ المدفوع لا يمكن أن يكون أكبر من المبلغ الكلي";

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

    const originalStudent = students.find((s) => s.id === editDialog.id);
    const form = editDialog.form;
    const result = updateStudent(editDialog.id, {
      name: form.name.trim(),
      school: form.school.trim(),
      gender: form.gender,
      phone: form.phone.trim(),
      parentPhone: form.parentPhone.trim(),
      telegram: sanitizeTelegramInput(form.telegram),
      courseType: form.courseType,
      courseId: form.courseId,
      groupId: form.groupId,
      mainSite: form.mainSite,
      subSite: form.subSite,
      receiptNo: form.courseType === "خاصة" ? form.receiptNo.trim() : "",
      codeSequence: form.courseType === "خاصة" ? form.codeSequence.trim() : "",
      totalAmount:
        form.courseType === "خاصة" ? Number(form.totalAmount) || 0 : 0,
      paidAmount: form.courseType === "خاصة" ? Number(form.paidAmount) || 0 : 0,
      installments:
        form.courseType === "خاصة"
          ? [
              {
                date:
                  originalStudent?.installments?.[0]?.date ||
                  new Date().toISOString().slice(0, 10),
                amount: Number(form.paidAmount) || 0,
                note:
                  originalStudent?.installments?.[0]?.note || "دفعة التسجيل",
              },
            ]
          : [],
      createdAt: form.createdAt,
      accountingStart: form.accountingStart,
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
    ok ? toast.success("تم حذف الطالب") : toast.error("تعذر حذف الطالب");
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
      if (filterCourseType && s.courseType !== filterCourseType) return false;
      if (filterCourseId && s.courseId !== filterCourseId) return false;
      if (filterStatus && s.status !== filterStatus) return false;
      if (filterGender && s.gender !== filterGender) return false;
      if (filterGroupId && s.groupId !== filterGroupId) return false;
      return true;
    });
  }, [
    students,
    search,
    filterCourseType,
    filterCourseId,
    filterStatus,
    filterGender,
    filterGroupId,
  ]);

  const totalPages = Math.ceil(filtered.length / pageSize);
  const paged = filtered.slice((page - 1) * pageSize, page * pageSize);

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
      "نوع الدورة",
      "الدورة",
      "الموقع",
      "الحالة",
      "الفرص",
      "الهاتف",
      "ولي الأمر",
      "التلكرام",
      "المبلغ الكلي",
      "المبلغ المدفوع",
      "المبلغ المتبقي",
    ];
    const rows = filtered.map((s) => ({
      الكود: s.code,
      الاسم: s.name,
      المدرسة: s.school || "",
      الجنس: s.gender,
      "نوع الدورة": s.courseType,
      الدورة: courseName(s.courseId),
      الموقع: `${s.mainSite} - ${s.subSite}`,
      الحالة: s.status,
      الفرص: String(s.opportunities),
      الهاتف: s.phone,
      "ولي الأمر": s.parentPhone,
      التلكرام: s.telegram || "",
      "المبلغ الكلي": String(s.totalAmount || 0),
      "المبلغ المدفوع": String(s.paidAmount || 0),
      "المبلغ المتبقي": String(
        Math.max((s.totalAmount || 0) - (s.paidAmount || 0), 0),
      ),
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

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="p-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-7">
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
                placeholder="اسم / كود / تلكرام / هاتف"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="registry-courseType" className="text-xs">
                نوع الدورة
              </Label>
              <Select
                value={filterCourseType}
                onValueChange={(v) => {
                  setFilterCourseType(v === "all" ? "" : v);
                  setPage(1);
                }}
              >
                <SelectTrigger id="registry-courseType">
                  <SelectValue placeholder="الكل" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">الكل</SelectItem>
                  <SelectItem value="خاصة">خاصة</SelectItem>
                  <SelectItem value="عامة">عامة</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="registry-course" className="text-xs">
                الدورة
              </Label>
              <Select
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
                الكروب
              </Label>
              <Select
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

      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <span>
          عرض {paged.length} من {filtered.length} طالب
        </span>
        <div className="flex items-center gap-2">
          <Label htmlFor="registry-pageSize" className="text-xs">
            حجم الصفحة:
          </Label>
          <Select
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
                  <span className="text-muted-foreground text-xs">الكروب</span>
                  <p className="font-medium text-xs">
                    {groupName(student.groupId)}
                  </p>
                </div>
                <div>
                  <span className="text-muted-foreground text-xs">الموقع</span>
                  <p className="font-medium text-xs">
                    {student.mainSite} - {student.subSite}
                  </p>
                </div>
                <div>
                  <span className="text-muted-foreground text-xs">الفرص</span>
                  <p className="font-medium text-xs">
                    {student.opportunities} / {student.baseOpportunities}
                  </p>
                </div>
                <div>
                  <span className="text-muted-foreground text-xs">تلكرام</span>
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
                <div>
                  <span className="text-muted-foreground text-xs">
                    فترة السماح
                  </span>
                  <p className="font-medium text-xs">
                    {student.accountingStart || "0"} يوم
                  </p>
                </div>
                {student.courseType === "خاصة" && (
                  <div>
                    <span className="text-muted-foreground text-xs">
                      الأقساط
                    </span>
                    <p className="font-medium text-xs">
                      {student.paidAmount || 0} / {student.totalAmount || 0} د.ع
                    </p>
                  </div>
                )}
              </div>

              {student.status === "مفصول" && (
                <div className="text-xs p-2 rounded bg-destructive/10 text-destructive mb-3">
                  {student.dismissalType} - {student.dismissalReason}
                </div>
              )}

              <div className="grid grid-cols-2 gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="text-xs"
                  onClick={() => setFileDialog({ student, open: true })}
                >
                  ملف الطالب
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  className="text-xs"
                  onClick={() => openEditDialog(student)}
                >
                  تعديل
                </Button>
                {student.status === "نشط" ? (
                  <Button
                    variant="destructive"
                    size="sm"
                    className="text-xs"
                    onClick={() => setDismissDialog({ student, open: true })}
                  >
                    فصل
                  </Button>
                ) : (
                  <Button
                    variant="default"
                    size="sm"
                    className="text-xs"
                    onClick={() => handleReactivate(student.id)}
                  >
                    إعادة تفعيل
                  </Button>
                )}
                <Button
                  variant="destructive"
                  size="sm"
                  className="text-xs"
                  onClick={() => openDeleteDialog(student)}
                >
                  حذف
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

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
              <Label htmlFor="edit-telegram">معرف التلكرام</Label>
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
              <Label htmlFor="edit-courseType">نوع الدورة</Label>
              <Select
                value={editDialog.form.courseType}
                onValueChange={(v) =>
                  setEditDialog((prev) => ({
                    ...prev,
                    form: {
                      ...prev.form,
                      courseType: v as "خاصة" | "عامة",
                      courseId: "",
                      groupId: "",
                      mainSite: "بغداد",
                      subSite: "",
                      receiptNo: v === "خاصة" ? prev.form.receiptNo : "",
                      codeSequence: v === "خاصة" ? prev.form.codeSequence : "",
                      totalAmount: v === "خاصة" ? prev.form.totalAmount : "",
                      paidAmount: v === "خاصة" ? prev.form.paidAmount : "",
                    },
                  }))
                }
              >
                <SelectTrigger id="edit-courseType">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="خاصة">خاصة</SelectItem>
                  <SelectItem value="عامة">عامة</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-courseId">اختر الدورة</Label>
              <Select
                value={editDialog.form.courseId}
                onValueChange={(v) =>
                  setEditDialog((prev) => ({
                    ...prev,
                    form: {
                      ...prev.form,
                      courseId: v,
                      groupId: "",
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
                      لا توجد دورات مسجلة لهذا النوع
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
            <div className="space-y-2">
              <Label htmlFor="edit-mainSite">الموقع الرئيسي</Label>
              <Select
                value={editDialog.form.mainSite}
                onValueChange={(v) =>
                  setEditDialog((prev) => ({
                    ...prev,
                    form: { ...prev.form, mainSite: v, subSite: "" },
                  }))
                }
                disabled={editIsPrivate}
              >
                <SelectTrigger id="edit-mainSite">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {editMainSiteOptions.map((s) => (
                    <SelectItem key={s} value={s}>
                      {s}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-subSite">الموقع الفرعي</Label>
              <Select
                value={editDialog.form.subSite}
                onValueChange={(v) => updateEditForm("subSite", v)}
                disabled={editSubSiteOptions.length === 0}
              >
                <SelectTrigger id="edit-subSite">
                  <SelectValue
                    placeholder={
                      editSubSiteOptions.length === 0
                        ? editIsPrivate
                          ? "بغداد فقط - لا مواقع فرعية"
                          : editDialog.form.mainSite === "بغداد"
                            ? "بغداد فقط - لا مواقع فرعية"
                            : "اختر المحافظة"
                        : "اختر الموقع الفرعي"
                    }
                  />
                </SelectTrigger>
                <SelectContent>
                  {editSubSiteOptions.length === 0 ? (
                    <div className="px-3 py-2 text-sm text-muted-foreground">
                      لا توجد مناطق فرعية
                    </div>
                  ) : (
                    editSubSiteOptions.map((s) => (
                      <SelectItem key={s} value={s}>
                        {s}
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-groupId">الكروب الإلكتروني</Label>
              <Select
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
                        ? "لا توجد كروبات مسجلة"
                        : !editDialog.form.courseId
                          ? "اختر الدورة أولاً"
                          : editFilteredGroups.length === 0
                            ? "لا توجد كروبات مسجلة"
                            : "اختر الكروب"
                    }
                  />
                </SelectTrigger>
                <SelectContent>
                  {editFilteredCourses.length === 0 ? (
                    <div className="px-3 py-2 text-sm text-muted-foreground">
                      لا توجد كروبات مسجلة لهذا النوع
                    </div>
                  ) : !editDialog.form.courseId ? (
                    <div className="px-3 py-2 text-sm text-muted-foreground">
                      اختر الدورة أولاً
                    </div>
                  ) : editFilteredGroups.length === 0 ? (
                    <div className="px-3 py-2 text-sm text-muted-foreground">
                      لا توجد كروبات مسجلة لهذه الدورة
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
            {editIsPrivate && (
              <>
                <div className="space-y-2">
                  <Label htmlFor="edit-receiptNo">رقم الوصل</Label>
                  <Input
                    id="edit-receiptNo"
                    name="receiptNo"
                    autoComplete="off"
                    value={editDialog.form.receiptNo}
                    onChange={(e) =>
                      updateEditForm("receiptNo", e.target.value)
                    }
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="edit-codeSequence">تسلسل الكود</Label>
                  <Input
                    id="edit-codeSequence"
                    name="codeSequence"
                    autoComplete="off"
                    value={editDialog.form.codeSequence}
                    onChange={(e) =>
                      updateEditForm("codeSequence", e.target.value)
                    }
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="edit-totalAmount">المبلغ الكلي</Label>
                  <Input
                    id="edit-totalAmount"
                    name="totalAmount"
                    type="number"
                    min={0}
                    autoComplete="off"
                    value={editDialog.form.totalAmount}
                    onChange={(e) =>
                      updateEditForm("totalAmount", e.target.value)
                    }
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="edit-paidAmount">المبلغ المدفوع</Label>
                  <Input
                    id="edit-paidAmount"
                    name="paidAmount"
                    type="number"
                    min={0}
                    autoComplete="off"
                    value={editDialog.form.paidAmount}
                    onChange={(e) =>
                      updateEditForm("paidAmount", e.target.value)
                    }
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="edit-remainingAmount">المبلغ المتبقي</Label>
                  <Input
                    id="edit-remainingAmount"
                    name="remainingAmount"
                    autoComplete="off"
                    value={String(editRemainingAmount)}
                    readOnly
                    className="font-bold text-destructive"
                  />
                </div>
              </>
            )}
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
            <div className="space-y-2">
              <Label htmlFor="edit-accountingStart">فترة السماح</Label>
              <Input
                id="edit-accountingStart"
                name="accountingStart"
                autoComplete="off"
                value={editDialog.form.accountingStart}
                onChange={(e) => updateEditAccountingDays(e.target.value)}
                inputMode="numeric"
                pattern="(?:[0-9]|[12][0-9]|30)"
                required
                placeholder="مثلاً 7"
              />
              <p className="text-xs leading-5 text-muted-foreground">
                الرقم من 0 إلى 30 هو عدد الأيام التي لا تُحتسب فيها النقاط.
              </p>
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
              <Select value={dismissType} onValueChange={setDismissType}>
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
                  <span className="text-muted-foreground">التلكرام:</span>{" "}
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
                  <span className="text-muted-foreground">الكروب:</span>{" "}
                  <strong>{groupName(fileDialog.student.groupId)}</strong>
                </div>
                <div>
                  <span className="text-muted-foreground">الموقع:</span>{" "}
                  <strong>
                    {fileDialog.student.mainSite} - {fileDialog.student.subSite}
                  </strong>
                </div>
                <div>
                  <span className="text-muted-foreground">الفرص:</span>{" "}
                  <strong>
                    {fileDialog.student.opportunities} /{" "}
                    {fileDialog.student.baseOpportunities}
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
                <div>
                  <span className="text-muted-foreground">فترة السماح:</span>{" "}
                  <strong>
                    {fileDialog.student.accountingStart || "0"} يوم
                  </strong>
                </div>
                {fileDialog.student.courseType === "خاصة" && (
                  <div>
                    <span className="text-muted-foreground">الأقساط:</span>{" "}
                    <strong>
                      {fileDialog.student.paidAmount || 0} /{" "}
                      {fileDialog.student.totalAmount || 0} د.ع
                    </strong>
                  </div>
                )}
              </div>

              {fileDialog.student.courseType === "خاصة" &&
                fileDialog.student.installments.length > 0 && (
                  <div>
                    <h4 className="font-semibold mb-2">الأقساط</h4>
                    <div className="space-y-1">
                      {fileDialog.student.installments.map((inst, i) => (
                        <div
                          key={i}
                          className="flex items-center justify-between text-sm p-2 rounded-xl bg-muted/60"
                        >
                          <span>{inst.date}</span>
                          <span>{formatNumberLatin(inst.amount)} د.ع</span>
                          <span className="text-muted-foreground">
                            {inst.note}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

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
