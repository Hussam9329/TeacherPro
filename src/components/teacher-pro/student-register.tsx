"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useTeacherStore } from "@/lib/teacher-store";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
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
} from "@/components/ui/dialog";
import { toast } from "sonner";
import {
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
  sanitizeTelegramInput,
} from "@/lib/student-utils";
import {
  getRequiredTextError,
  hasMeaningfulDraftValue,
  TEXT_ONLY_PATTERN,
} from "@/lib/validation";
import { useActionLock } from "@/hooks/use-action-lock";
import {
  AlertCircle,
  Barcode,
  BookOpen,
  CheckCircle2,
  Coins,
  Lock,
  MapPin,
  PhoneCall,
  Receipt,
  Save,
  School,
  Smartphone,
  Star,
  User,
  UserPlus,
  Users,
  VenusAndMars,
  WalletCards,
} from "lucide-react";
import { Send } from "lucide-react";

const fieldBaseClass =
  "h-12 rounded-xl border-input bg-background/70 pr-10 pl-4 text-right shadow-xs backdrop-blur transition-all focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] dark:bg-input/30";
const selectTriggerClass =
  "h-12 rounded-xl border-input bg-background/70 px-4 shadow-xs backdrop-blur focus:ring-ring/50 dark:bg-input/30";
const privateFieldClass =
  "h-12 rounded-xl border-primary/20 bg-background/80 pr-10 pl-4 shadow-xs backdrop-blur focus-visible:border-primary/50 focus-visible:ring-primary/20 dark:bg-input/30";
const moneyFieldClass =
  "h-12 rounded-xl border-primary/20 bg-background/80 pl-12 pr-4 shadow-xs backdrop-blur focus-visible:border-primary/50 focus-visible:ring-primary/20 dark:bg-input/30";

const STUDENT_DRAFT_KEY = "teacherpro:student-register-draft";

type CourseType = "خاصة" | "عامة";

type StudentRegisterForm = {
  name: string;
  school: string;
  gender: "ذكر" | "أنثى";
  phone: string;
  parentPhone: string;
  telegram: string;
  courseType: CourseType;
  courseId: string;
  groupId: string;
  mainSite: string;
  subSite: string;
  receiptNo: string;
  codeSequence: string;
  totalAmount: string;
  paidAmount: string;
  accountingStart: string;
  createdAt: string;
};

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

function readStudentDraft(): StudentRegisterForm {
  if (typeof window === "undefined") return emptyForm();
  try {
    const saved = window.localStorage.getItem(STUDENT_DRAFT_KEY);
    if (!saved) return emptyForm();
    return { ...emptyForm(), ...JSON.parse(saved) } as StudentRegisterForm;
  } catch {
    return emptyForm();
  }
}

function emptyForm(): StudentRegisterForm {
  return {
    name: "",
    school: "",
    gender: "ذكر",
    phone: "",
    parentPhone: "",
    telegram: "",
    courseType: "عامة",
    courseId: "",
    groupId: "",
    mainSite: "بغداد",
    subSite: "",
    receiptNo: "",
    codeSequence: "",
    totalAmount: "",
    paidAmount: "",
    accountingStart: "0",
    createdAt: todayISO(),
  };
}

function amountValue(value: string): number {
  return Number(toLatinDigits(value).replace(/\D/g, "")) || 0;
}

function formatAmount(value: number): string {
  return new Intl.NumberFormat("en-US").format(value);
}

function FieldIcon({
  icon: Icon,
  className = "",
}: {
  icon: React.ElementType;
  className?: string;
}) {
  return (
    <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-3">
      <Icon className={`h-4 w-4 text-muted-foreground ${className}`} />
    </div>
  );
}

function RequiredMark() {
  return <span className="text-destructive">*</span>;
}

function SectionTitle({
  icon: Icon,
  title,
  description,
  actions,
}: {
  icon: React.ElementType;
  title: string;
  description?: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className="mb-5 flex flex-col gap-3 border-b pb-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-start gap-3">
        <span className="flex size-11 shrink-0 items-center justify-center rounded-2xl border border-primary/20 bg-primary/10 text-primary shadow-sm">
          <Icon className="size-5" />
        </span>
        <div>
          <h3 className="text-base font-black tracking-tight text-foreground md:text-lg">
            {title}
          </h3>
          {description && (
            <p className="mt-1 text-xs leading-6 text-muted-foreground">
              {description}
            </p>
          )}
        </div>
      </div>
      {actions && <div className="shrink-0">{actions}</div>}
    </div>
  );
}

export function StudentRegisterView() {
  const { students, courses, groups, addStudent, activeChapterForCourse } =
    useTeacherStore();
  const [form, setForm] = useState<StudentRegisterForm>(() =>
    readStudentDraft(),
  );
  const [showRules, setShowRules] = useState(false);
  const { locked: isSubmitting, runLocked } = useActionLock();

  const isPrivate = form.courseType === "خاصة";

  const filteredCourses = useMemo(
    () => courses.filter((c) => c.type === form.courseType && c.active),
    [courses, form.courseType],
  );

  const filteredGroups = useMemo(
    () => groups.filter((g) => g.courseId === form.courseId && g.active),
    [groups, form.courseId],
  );

  const mainSiteOptions = useMemo(() => {
    if (isPrivate) return ["بغداد"];
    return [...PUBLIC_MAIN_SITE_OPTIONS];
  }, [isPrivate]);

  const subSiteOptions = useMemo<string[]>(() => {
    if (isPrivate && form.mainSite === "بغداد")
      return [...PRIVATE_BAGHDAD_SUB_SITES];
    if (!isPrivate && form.mainSite === "بغداد") return [];
    if (!isPrivate && form.mainSite === "محافظات") return [...IRAQI_PROVINCES];
    return [];
  }, [isPrivate, form.mainSite]);

  const totalAmount = useMemo(
    () => amountValue(form.totalAmount),
    [form.totalAmount],
  );
  const paidAmount = useMemo(
    () => amountValue(form.paidAmount),
    [form.paidAmount],
  );
  const remainingAmount = Math.max(totalAmount - paidAmount, 0);
  const hasDraftData = useMemo(
    () =>
      hasMeaningfulDraftValue(form, [
        "createdAt",
        "gender",
        "courseType",
        "mainSite",
        "accountingStart",
      ]),
    [form],
  );

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (hasDraftData) {
      window.localStorage.setItem(STUDENT_DRAFT_KEY, JSON.stringify(form));
    } else {
      window.localStorage.removeItem(STUDENT_DRAFT_KEY);
    }
  }, [form, hasDraftData]);

  useEffect(() => {
    if (!hasDraftData) return;
    const warnBeforeLeave = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warnBeforeLeave);
    return () => window.removeEventListener("beforeunload", warnBeforeLeave);
  }, [hasDraftData]);

  const updateForm = (key: keyof StudentRegisterForm, value: string) => {
    setForm((prev) => ({ ...prev, [key]: toLatinDigits(value) }));
  };

  const updateAmountForm = (
    key: "totalAmount" | "paidAmount",
    value: string,
  ) => {
    setForm((prev) => ({
      ...prev,
      [key]: toLatinDigits(value).replace(/\D/g, ""),
    }));
  };

  const updateGraceDays = (value: string) => {
    setForm((prev) => ({
      ...prev,
      accountingStart: toLatinDigits(value).replace(/\D/g, "").slice(0, 2),
    }));
  };

  const updatePhoneForm = (key: "phone" | "parentPhone", value: string) => {
    setForm((prev) => ({ ...prev, [key]: sanitizePhoneInput(value) }));
  };

  const handleCourseTypeChange = (value: string) => {
    const nextType = value as CourseType;
    setForm((prev) => ({
      ...prev,
      courseType: nextType,
      courseId: "",
      groupId: "",
      mainSite: "بغداد",
      subSite: "",
      receiptNo: nextType === "خاصة" ? prev.receiptNo : "",
      codeSequence: nextType === "خاصة" ? prev.codeSequence : "",
      totalAmount: nextType === "خاصة" ? prev.totalAmount : "",
      paidAmount: nextType === "خاصة" ? prev.paidAmount : "",
    }));
  };

  const handleCourseChange = (value: string) => {
    setForm((prev) => ({ ...prev, courseId: value, groupId: "", subSite: "" }));
  };

  const validateRequiredFields = () => {
    const requiredChecks: [boolean, string][] = [
      [Boolean(form.name.trim()), "اسم الطالب: هذا الحقل مطلوب"],
      [Boolean(form.school.trim()), "اسم المدرسة: هذا الحقل مطلوب"],
      [Boolean(form.gender), "الجنس مطلوب"],
      [Boolean(form.phone.trim()), "رقم هاتف الطالب مطلوب"],
      [Boolean(form.parentPhone.trim()), "رقم هاتف ولي الأمر مطلوب"],
      [Boolean(form.courseType), "نوع الدورة مطلوب"],
      [
        Boolean(form.courseId),
        filteredCourses.length === 0
          ? "لا توجد دورات مسجلة لهذا النوع"
          : "يرجى اختيار الدورة",
      ],
      [Boolean(form.mainSite), "الموقع الرئيسي مطلوب"],
      [
        subSiteOptions.length === 0 || Boolean(form.subSite),
        "الموقع الفرعي مطلوب",
      ],
      [
        Boolean(form.groupId),
        filteredGroups.length === 0
          ? "لا توجد كروبات إلكترونية لهذه الدورة"
          : "يرجى اختيار الكروب الإلكتروني",
      ],
      [form.accountingStart.trim() !== "", "فترة السماح مطلوبة"],
    ];

    if (isPrivate) {
      requiredChecks.push(
        [Boolean(form.receiptNo.trim()), "رقم الوصل مطلوب للدورة الخاصة"],
        [Boolean(form.codeSequence.trim()), "تسلسل الكود مطلوب للدورة الخاصة"],
        [form.totalAmount.trim() !== "", "المبلغ الكلي مطلوب للدورة الخاصة"],
        [form.paidAmount.trim() !== "", "المبلغ المدفوع مطلوب للدورة الخاصة"],
      );
    }

    const missing = requiredChecks.find(([ok]) => !ok);
    if (missing) return missing[1];

    const nameError = getRequiredTextError(form.name, "اسم الطالب");
    if (nameError) return nameError;

    const phoneError = getPhoneValidationError(
      form.phone,
      "رقم هاتف الطالب",
      true,
    );
    if (phoneError) return phoneError;

    const parentPhoneError = getPhoneValidationError(
      form.parentPhone,
      "رقم هاتف ولي الأمر",
      true,
    );
    if (parentPhoneError) return parentPhoneError;

    if (!isValidAccountingGraceDays(form.accountingStart))
      return "فترة السماح يجب أن تكون رقماً من 0 إلى 30 يوم";

    if (isPrivate && paidAmount > totalAmount)
      return "المبلغ المدفوع لا يمكن أن يكون أكبر من المبلغ الكلي";

    const duplicateMessage = getStudentDuplicateMessage(students, {
      name: form.name,
      phone: form.phone,
      telegram: form.telegram,
    });
    if (duplicateMessage) return duplicateMessage;

    return null;
  };

  const handleSubmit = runLocked(
    async (e: React.FormEvent<HTMLFormElement>) => {
      e.preventDefault();

      const requiredError = validateRequiredFields();
      if (requiredError) {
        toast.error(requiredError);
        return;
      }

      const chapter = activeChapterForCourse(form.courseId);
      const result = addStudent({
        name: form.name.trim(),
        school: form.school.trim(),
        gender: form.gender,
        phone: form.phone.trim(),
        parentPhone: form.parentPhone.trim(),
        telegram: sanitizeTelegramInput(form.telegram),
        courseType: form.courseType,
        courseId: form.courseId,
        groupId: form.groupId,
        mainSite: isPrivate ? "بغداد" : form.mainSite,
        subSite: form.subSite,
        receiptNo: isPrivate ? form.receiptNo.trim() : "",
        codeSequence: isPrivate ? form.codeSequence.trim() : "",
        totalAmount: isPrivate ? totalAmount : 0,
        paidAmount: isPrivate ? paidAmount : 0,
        installments: isPrivate
          ? [{ date: todayISO(), amount: paidAmount, note: "دفعة التسجيل" }]
          : [],
        status: "نشط",
        dismissalType: "",
        dismissalReason: "",
        createdAt: form.createdAt,
        accountingStart: form.accountingStart,
        opportunities: chapter?.opportunities ?? 0,
        baseOpportunities: chapter?.opportunities ?? 0,
      });

      if (!result.ok) {
        toast.error(result.message);
        return;
      }

      window.localStorage.removeItem(STUDENT_DRAFT_KEY);
      setForm(emptyForm());
      toast.success("تم حفظ بيانات الطالب", {
        description: "تمت إضافة الطالب إلى سجل الطلاب بنجاح",
      });
    },
  );

  return (
    <div className="section-stack mx-auto max-w-7xl">
      <Card className="gap-0 overflow-hidden py-0">
        <CardHeader className="relative overflow-hidden border-b bg-card/70 p-5 md:p-6">
          <div className="absolute inset-inline-start-0 top-0 h-28 w-28 rounded-full bg-primary/20 blur-3xl" />
          <div className="absolute inset-inline-end-0 bottom-0 h-24 w-36 rounded-full bg-primary/10 blur-3xl" />
          <div className="relative flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div className="flex items-center gap-3">
              <div className="flex size-14 shrink-0 items-center justify-center rounded-3xl border border-primary/20 bg-primary/10 text-primary shadow-sm">
                <UserPlus className="size-7" />
              </div>
              <div>
                <CardTitle className="text-2xl font-black tracking-tight text-gradient-brand md:text-3xl">
                  إضافة طالب جديد
                </CardTitle>
                <CardDescription className="mt-2 leading-6">
                  سجّل بيانات الطالب واختر الدورة والموقع المناسب.
                </CardDescription>
              </div>
            </div>
            <div className="chip w-fit border-primary/20 bg-primary/10 text-primary">
              {isPrivate ? "دورة خاصة" : "دورة عامة"}
            </div>
          </div>
        </CardHeader>

        <CardContent className="p-4 md:p-6 lg:p-8">
          <form onSubmit={handleSubmit} className="space-y-6">
            <input
              type="hidden"
              id="reg-createdAt"
              name="createdAt"
              value={form.createdAt}
              readOnly
              autoComplete="off"
            />

            <section className="surface-card p-5 md:p-6">
              <SectionTitle
                icon={User}
                title="بيانات الطالب"
                description="المعلومات الأساسية المطلوبة لإنشاء ملف الطالب."
              />
              <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
                <div className="space-y-2">
                  <Label
                    htmlFor="reg-name"
                    className="font-bold text-foreground"
                  >
                    اسم الطالب <RequiredMark />
                  </Label>
                  <div className="relative">
                    <FieldIcon icon={User} />
                    <Input
                      id="reg-name"
                      name="name"
                      autoComplete="name"
                      value={form.name}
                      onChange={(e) => updateForm("name", e.target.value)}
                      required
                      pattern={TEXT_ONLY_PATTERN}
                      title="يجب إدخال نص فقط بدون أرقام أو رموز غير مسموحة"
                      onInvalid={(event) =>
                        event.currentTarget.setCustomValidity(
                          event.currentTarget.validity.valueMissing
                            ? "هذا الحقل مطلوب"
                            : "يجب إدخال نص فقط",
                        )
                      }
                      onInput={(event) =>
                        event.currentTarget.setCustomValidity("")
                      }
                      placeholder="الاسم الرباعي واللقب"
                      className={fieldBaseClass}
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label
                    htmlFor="reg-school"
                    className="font-bold text-foreground"
                  >
                    اسم المدرسة <RequiredMark />
                  </Label>
                  <div className="relative">
                    <FieldIcon icon={School} />
                    <Input
                      id="reg-school"
                      name="school"
                      autoComplete="organization"
                      value={form.school}
                      onChange={(e) => updateForm("school", e.target.value)}
                      required
                      placeholder="اسم المدرسة"
                      className={fieldBaseClass}
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label
                    htmlFor="reg-gender-male"
                    className="font-bold text-foreground"
                  >
                    الجنس <RequiredMark />
                  </Label>
                  {/* radios labelled by their own wrapping labels */}
                  <div className="flex gap-8">
                    <label className="inline-flex cursor-pointer items-center">
                      <input
                        type="radio"
                        id="reg-gender-male"
                        name="gender"
                        value="ذكر"
                        checked={form.gender === "ذكر"}
                        onChange={() => updateForm("gender", "ذكر")}
                        required
                        className="h-5 w-5 accent-primary"
                      />
                      <span className="mr-2 font-medium text-foreground">
                        ذكر
                      </span>
                    </label>
                    <label className="inline-flex cursor-pointer items-center">
                      <input
                        type="radio"
                        id="reg-gender-female"
                        name="gender"
                        value="أنثى"
                        checked={form.gender === "أنثى"}
                        onChange={() => updateForm("gender", "أنثى")}
                        required
                        className="h-5 w-5 accent-primary"
                      />
                      <span className="mr-2 font-medium text-foreground">
                        أنثى
                      </span>
                    </label>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label
                    htmlFor="reg-telegram"
                    className="font-bold text-foreground"
                  >
                    معرف التليكرام
                  </Label>
                  <div className="relative">
                    <FieldIcon icon={Send} />
                    <Input
                      id="reg-telegram"
                      name="telegram"
                      autoComplete="username"
                      value={form.telegram}
                      onChange={(e) =>
                        setForm((prev) => ({
                          ...prev,
                          telegram: sanitizeTelegramInput(e.target.value),
                        }))
                      }
                      placeholder="username بدون @"
                      dir="ltr"
                      className={`${fieldBaseClass} text-left font-tabular`}
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label
                    htmlFor="reg-phone"
                    className="font-bold text-foreground"
                  >
                    رقم هاتف الطالب <RequiredMark />
                  </Label>
                  <div className="relative">
                    <FieldIcon icon={Smartphone} />
                    <Input
                      id="reg-phone"
                      name="phone"
                      autoComplete="tel"
                      value={form.phone}
                      onChange={(e) => updatePhoneForm("phone", e.target.value)}
                      required
                      placeholder="07xxxxxxxxx"
                      inputMode="numeric"
                      maxLength={11}
                      pattern="07[0-9]{9}"
                      dir="ltr"
                      className={`${fieldBaseClass} text-left font-tabular`}
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label
                    htmlFor="reg-parentPhone"
                    className="font-bold text-foreground"
                  >
                    رقم هاتف ولي الأمر <RequiredMark />
                  </Label>
                  <div className="relative">
                    <FieldIcon icon={PhoneCall} />
                    <Input
                      id="reg-parentPhone"
                      name="parentPhone"
                      autoComplete="tel"
                      value={form.parentPhone}
                      onChange={(e) =>
                        updatePhoneForm("parentPhone", e.target.value)
                      }
                      required
                      placeholder="07xxxxxxxxx"
                      inputMode="numeric"
                      maxLength={11}
                      pattern="07[0-9]{9}"
                      dir="ltr"
                      className={`${fieldBaseClass} text-left font-tabular`}
                    />
                  </div>
                </div>
              </div>
            </section>

            <section className="surface-card p-5 md:p-6">
              <SectionTitle
                icon={BookOpen}
                title="تفاصيل الدورة"
                description="اختيار نوع الدورة يحدد الدورات والكروبات والمواقع المتاحة تلقائياً."
                actions={
                  isPrivate && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setShowRules(true)}
                    >
                      عرض شروط الدورة الخاصة
                    </Button>
                  )
                }
              />

              <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
                <div className="space-y-2">
                  <Label
                    htmlFor="reg-courseType"
                    className="font-bold text-foreground"
                  >
                    نوع الدورة <RequiredMark />
                  </Label>
                  <Select
                    value={form.courseType}
                    onValueChange={handleCourseTypeChange}
                  >
                    <SelectTrigger
                      id="reg-courseType"
                      className={selectTriggerClass}
                      aria-required="true"
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="عامة">عامة</SelectItem>
                      <SelectItem value="خاصة">خاصة</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label
                    htmlFor="reg-courseId"
                    className="font-bold text-foreground"
                  >
                    الدورة <RequiredMark />
                  </Label>
                  <Select
                    value={form.courseId}
                    onValueChange={handleCourseChange}
                    disabled={filteredCourses.length === 0}
                  >
                    <SelectTrigger
                      id="reg-courseId"
                      className={selectTriggerClass}
                      aria-required="true"
                    >
                      <SelectValue
                        placeholder={
                          filteredCourses.length === 0
                            ? "لا توجد دورات مسجلة"
                            : "اختر الدورة..."
                        }
                      />
                    </SelectTrigger>
                    <SelectContent>
                      {filteredCourses.length === 0 ? (
                        <div className="px-3 py-2 text-sm text-muted-foreground">
                          لا توجد دورات مسجلة لهذا النوع
                        </div>
                      ) : (
                        filteredCourses.map((c) => (
                          <SelectItem key={c.id} value={c.id}>
                            {c.name}
                          </SelectItem>
                        ))
                      )}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {isPrivate && (
                <div className="mt-6 rounded-3xl border border-primary/20 bg-primary/5 p-5 shadow-sm md:p-6">
                  <div className="mb-5 flex items-center gap-3">
                    <span className="flex size-10 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                      <Star className="size-5" />
                    </span>
                    <div>
                      <h4 className="font-black text-foreground">
                        بيانات الدورة الخاصة
                      </h4>
                      <p className="text-xs text-muted-foreground">
                        تظهر هذه الحقول للدورات الخاصة فقط.
                      </p>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
                    <div className="space-y-2">
                      <Label
                        htmlFor="reg-receiptNo"
                        className="font-bold text-foreground"
                      >
                        رقم الوصل <RequiredMark />
                      </Label>
                      <div className="relative">
                        <FieldIcon icon={Receipt} className="text-primary" />
                        <Input
                          id="reg-receiptNo"
                          name="receiptNo"
                          autoComplete="off"
                          value={form.receiptNo}
                          onChange={(e) =>
                            updateForm("receiptNo", e.target.value)
                          }
                          required
                          placeholder="أدخل رقم الوصل"
                          className={privateFieldClass}
                        />
                      </div>
                    </div>
                    <div className="space-y-2">
                      <Label
                        htmlFor="reg-codeSequence"
                        className="font-bold text-foreground"
                      >
                        تسلسل الكود <RequiredMark />
                      </Label>
                      <div className="relative">
                        <FieldIcon icon={Barcode} className="text-primary" />
                        <Input
                          id="reg-codeSequence"
                          name="codeSequence"
                          autoComplete="off"
                          value={form.codeSequence}
                          onChange={(e) =>
                            updateForm("codeSequence", e.target.value)
                          }
                          required
                          placeholder="أدخل تسلسل الكود"
                          className={privateFieldClass}
                        />
                      </div>
                    </div>
                  </div>

                  <div className="mt-6 border-t border-primary/20 pt-6">
                    <h4 className="mb-4 flex items-center font-black text-foreground">
                      <Coins className="ml-2 h-5 w-5 text-primary" />
                      نظام الأقساط
                    </h4>
                    <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                      <div className="space-y-2">
                        <Label
                          htmlFor="reg-totalAmount"
                          className="font-bold text-foreground"
                        >
                          المبلغ الكلي <RequiredMark />
                        </Label>
                        <div className="relative">
                          <Input
                            id="reg-totalAmount"
                            name="totalAmount"
                            autoComplete="off"
                            value={form.totalAmount}
                            onChange={(e) =>
                              updateAmountForm("totalAmount", e.target.value)
                            }
                            required
                            inputMode="numeric"
                            placeholder="0"
                            className={`${moneyFieldClass} font-tabular`}
                          />
                          <span className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 font-bold text-muted-foreground">
                            د.ع
                          </span>
                        </div>
                      </div>
                      <div className="space-y-2">
                        <Label
                          htmlFor="reg-paidAmount"
                          className="font-bold text-foreground"
                        >
                          المبلغ المدفوع <RequiredMark />
                        </Label>
                        <div className="relative">
                          <Input
                            id="reg-paidAmount"
                            name="paidAmount"
                            autoComplete="off"
                            value={form.paidAmount}
                            onChange={(e) =>
                              updateAmountForm("paidAmount", e.target.value)
                            }
                            required
                            inputMode="numeric"
                            placeholder="0"
                            className={`${moneyFieldClass} font-tabular`}
                          />
                          <span className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 font-bold text-muted-foreground">
                            د.ع
                          </span>
                        </div>
                      </div>
                      <div className="space-y-2">
                        <Label
                          htmlFor="reg-remainingAmount"
                          className="font-bold text-foreground"
                        >
                          المبلغ المتبقي
                        </Label>
                        <div className="relative">
                          <Input
                            id="reg-remainingAmount"
                            name="remainingAmount"
                            autoComplete="off"
                            value={String(remainingAmount)}
                            readOnly
                            placeholder="0"
                            className="h-12 rounded-xl border-input bg-muted/55 pl-12 pr-4 font-bold text-destructive shadow-xs dark:bg-muted/25"
                          />
                          <span className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 font-bold text-muted-foreground">
                            د.ع
                          </span>
                        </div>
                        <p className="text-xs text-muted-foreground">
                          المتبقي: {formatAmount(remainingAmount)} د.ع
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              <div className="mt-6 grid grid-cols-1 gap-5 md:grid-cols-2">
                <div className="space-y-2">
                  <Label
                    htmlFor="reg-mainSite"
                    className="font-bold text-foreground"
                  >
                    الموقع الرئيسي <RequiredMark />
                  </Label>
                  <Select
                    value={form.mainSite}
                    onValueChange={(v) =>
                      setForm((prev) => ({ ...prev, mainSite: v, subSite: "" }))
                    }
                    disabled={isPrivate}
                  >
                    <SelectTrigger
                      id="reg-mainSite"
                      className={`${selectTriggerClass} disabled:opacity-100`}
                      aria-required="true"
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {mainSiteOptions.map((s) => (
                        <SelectItem key={s} value={s}>
                          {s}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p
                    className={
                      isPrivate
                        ? "text-xs font-bold text-primary"
                        : "text-xs text-muted-foreground"
                    }
                  >
                    {isPrivate ? (
                      <>
                        <Lock className="ml-1 inline h-3.5 w-3.5" /> تم تحديد
                        بغداد تلقائياً للدورة الخاصة
                      </>
                    ) : (
                      "اختر الموقع الرئيسي حسب الدورة"
                    )}
                  </p>
                </div>

                <div className="space-y-2">
                  <Label
                    htmlFor="reg-subSite"
                    className="font-bold text-foreground"
                  >
                    الموقع الفرعي{" "}
                    {subSiteOptions.length > 0 && <RequiredMark />}
                  </Label>
                  <Select
                    value={form.subSite}
                    onValueChange={(v) => updateForm("subSite", v)}
                    disabled={subSiteOptions.length === 0}
                  >
                    <SelectTrigger
                      id="reg-subSite"
                      className={selectTriggerClass}
                      aria-required={subSiteOptions.length > 0}
                    >
                      <SelectValue
                        placeholder={
                          subSiteOptions.length === 0
                            ? "لا توجد مواقع فرعية"
                            : "اختر الموقع الفرعي..."
                        }
                      />
                    </SelectTrigger>
                    <SelectContent>
                      {subSiteOptions.length === 0 ? (
                        <div className="px-3 py-2 text-sm text-muted-foreground">
                          لا توجد مواقع فرعية لهذا الموقع
                        </div>
                      ) : (
                        subSiteOptions.map((s) => (
                          <SelectItem key={s} value={s}>
                            {s}
                          </SelectItem>
                        ))
                      )}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2 md:col-span-2">
                  <Label
                    htmlFor="reg-groupId"
                    className="font-bold text-foreground"
                  >
                    الكروب الإلكتروني <RequiredMark />
                  </Label>
                  <Select
                    value={form.groupId}
                    onValueChange={(v) => updateForm("groupId", v)}
                    disabled={!form.courseId || filteredGroups.length === 0}
                  >
                    <SelectTrigger
                      id="reg-groupId"
                      className={selectTriggerClass}
                      aria-required="true"
                    >
                      <SelectValue
                        placeholder={
                          !form.courseId
                            ? "اختر الدورة أولاً..."
                            : filteredGroups.length === 0
                              ? "لا توجد كروبات إلكترونية"
                              : "اختر الكروب الإلكتروني..."
                        }
                      />
                    </SelectTrigger>
                    <SelectContent>
                      {!form.courseId ? (
                        <div className="px-3 py-2 text-sm text-muted-foreground">
                          اختر الدورة أولاً
                        </div>
                      ) : filteredGroups.length === 0 ? (
                        <div className="px-3 py-2 text-sm text-muted-foreground">
                          لا توجد كروبات إلكترونية لهذه الدورة
                        </div>
                      ) : (
                        filteredGroups.map((g) => (
                          <SelectItem key={g.id} value={g.id}>
                            {g.name} - {g.electronicGroup}
                          </SelectItem>
                        ))
                      )}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </section>

            <section className="surface-card p-5 md:p-6">
              <SectionTitle
                icon={VenusAndMars}
                title="إعدادات التسجيل"
                description="بيانات مساعدة لاكتمال ملف الطالب ونظام المحاسبة."
              />
              <div className="soft-panel">
                <Label
                  htmlFor="reg-accountingStart"
                  className="mb-2 block font-bold text-foreground"
                >
                  فترة السماح (أيام)
                </Label>
                <div className="flex flex-wrap items-center gap-4">
                  <Input
                    id="reg-accountingStart"
                    name="accountingStart"
                    autoComplete="off"
                    value={form.accountingStart}
                    onChange={(e) => updateGraceDays(e.target.value)}
                    inputMode="numeric"
                    pattern="(?:[0-9]|[12][0-9]|30)"
                    required
                    className="h-11 w-24 rounded-xl text-center font-tabular"
                  />
                  <span className="text-sm text-muted-foreground">
                    أيام لا تُحتسب فيها النقاط
                  </span>
                </div>
              </div>
            </section>

            <div className="flex flex-col gap-3 rounded-3xl border bg-muted/35 p-4 md:flex-row md:items-center md:justify-between">
              <div className="flex items-start gap-2 text-sm leading-6 text-muted-foreground">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                <span>
                  الدورة الخاصة تثبت الموقع الرئيسي على بغداد وتطلب اختيار
                  المنصور أو زيونة أو البنوك مع بيانات الوصل والأقساط.
                </span>
              </div>
              <Button
                type="submit"
                size="lg"
                disabled={isSubmitting}
                className="h-14 min-w-56 rounded-2xl px-10 text-base font-black shadow-lg shadow-primary/20"
              >
                <Save className="ml-2 h-5 w-5" />
                {isSubmitting ? "جاري الحفظ..." : "حفظ بيانات الطالب"}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Dialog open={showRules} onOpenChange={setShowRules}>
        <DialogContent dir="rtl">
          <DialogHeader>
            <DialogTitle>شروط الدورة الخاصة</DialogTitle>
          </DialogHeader>
          <ul className="space-y-3 text-sm leading-7">
            <li className="flex gap-2">
              <CheckCircle2 className="mt-1 h-4 w-4 text-emerald-600 dark:text-emerald-400" />{" "}
              الموقع الرئيسي يثبت تلقائياً على بغداد.
            </li>
            <li className="flex gap-2">
              <MapPin className="mt-1 h-4 w-4 text-primary" /> الموقع الفرعي
              مطلوب ويعرض فقط: المنصور، زيونة، البنوك.
            </li>
            <li className="flex gap-2">
              <WalletCards className="mt-1 h-4 w-4 text-primary" /> تظهر حقول
              رقم الوصل، تسلسل الكود، المبلغ الكلي، المدفوع، والمتبقي للدورات
              الخاصة فقط.
            </li>
            <li className="flex gap-2">
              <Users className="mt-1 h-4 w-4 text-primary" /> الكروب الإلكتروني
              يتغير حسب الدورة المختارة.
            </li>
            <li className="flex gap-2">
              <VenusAndMars className="mt-1 h-4 w-4 text-primary" /> الجنس وفترة
              السماح من بيانات التسجيل الأساسية.
            </li>
          </ul>
        </DialogContent>
      </Dialog>
    </div>
  );
}
