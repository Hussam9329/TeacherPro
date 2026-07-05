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
import { DateInput } from "@/components/ui/date-input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

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
  normalizePhoneForDuplicate,
  normalizeTelegramIdentifier,
  sanitizeTelegramInput,
} from "@/lib/student-utils";
import {
  getRequiredTextError,
  hasMeaningfulDraftValue,
  TEXT_ONLY_PATTERN,
} from "@/lib/validation";
import { useActionLock } from "@/hooks/use-action-lock";
import { StepProgress } from "./ui-kit";
import {
  AlertCircle,
  BookOpen,
  CalendarDays,
  MapPin,
  PhoneCall,
  Save,
  School,
  Smartphone,
  User,
  UserPlus,
} from "lucide-react";
import { Send } from "lucide-react";

const fieldBaseClass =
  "h-12 rounded-xl border-input bg-background/70 pr-10 pl-4 text-right shadow-xs backdrop-blur transition-all focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] dark:bg-input/30";
const selectTriggerClass =
  "h-12 rounded-xl border-input bg-background/70 px-4 shadow-xs backdrop-blur focus:ring-ring/50 dark:bg-input/30";

const STUDENT_DRAFT_KEY = "teacherpro:student-register-draft";

type StudentRegisterForm = {
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

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

function calculateGracePeriodEnd(dateISO: string, days: number): string {
  if (!dateISO || days <= 0) return "";
  const date = new Date(`${dateISO}T00:00:00`);
  if (Number.isNaN(date.getTime())) return "";
  date.setDate(date.getDate() + days - 1);
  return date.toISOString().slice(0, 10);
}

function formatGraceDate(dateISO: string): string {
  return formatAppDate(dateISO);
}

function normalizeGraceDays(value: string): string {
  const digits = toLatinDigits(value).replace(/\D/g, "");
  if (!digits) return "";
  return String(Math.min(Number(digits), 30));
}

function isValidGraceDays(value: string): boolean {
  if (!/^\d+$/.test(value)) return false;
  const days = Number(value);
  return Number.isInteger(days) && days >= 0 && days <= 30;
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
    courseProgram: "",
    courseTerm: "",
    studyType: "",
    locationScope: "",
    baghdadMode: "",
    courseId: "",
    subSite: "",
    createdAt: todayISO(),
    accountingGraceDays: "0",
  };
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
  const { students, courses, addStudent, activeChapterForCourse } =
    useTeacherStore();
  const [form, setForm] = useState<StudentRegisterForm>(() =>
    readStudentDraft(),
  );
  const { locked: isSubmitting, runLocked } = useActionLock();

  const filteredCourses = useMemo(
    () => courses.filter((c) => c.active),
    [courses],
  );

  const selectedCourse = useMemo(
    () => courses.find((c) => c.id === form.courseId),
    [courses, form.courseId],
  );

  const selectedCourseActiveChapter = form.courseId
    ? activeChapterForCourse(form.courseId)
    : null;
  const selectedCourseHasNoActiveChapter = Boolean(
    form.courseId && !selectedCourseActiveChapter,
  );
  const selectedCourseOpportunityPreview =
    selectedCourseActiveChapter?.opportunities ?? 0;

  const courseAvailablePrograms = useMemo(
    () => (selectedCourse ? getAvailablePrograms(selectedCourse) : []),
    [selectedCourse],
  );

  // Effective courseProgram: auto-select when only one option
  const effectiveCourseProgram = useMemo(
    () =>
      courseAvailablePrograms.length === 1
        ? courseAvailablePrograms[0]
        : form.courseProgram,
    [courseAvailablePrograms, form.courseProgram],
  );

  const courseAvailableStudyTypes = useMemo(
    () =>
      selectedCourse && effectiveCourseProgram
        ? getAvailableStudyTypesForProgram(
            selectedCourse,
            effectiveCourseProgram,
          )
        : [],
    [selectedCourse, effectiveCourseProgram],
  );

  const courseLocationScopes = useMemo(
    () =>
      selectedCourse && form.studyType
        ? getLocationScopes(selectedCourse, form.studyType)
        : [],
    [selectedCourse, form.studyType],
  );

  const courseBaghdadMode = useMemo(
    () =>
      selectedCourse && form.studyType
        ? getBaghdadMode(selectedCourse, form.studyType)
        : undefined,
    [selectedCourse, form.studyType],
  );

  const courseBaghdadSites = useMemo(
    () =>
      selectedCourse && form.studyType
        ? getBaghdadSites(selectedCourse, form.studyType)
        : [],
    [selectedCourse, form.studyType],
  );

  const courseProvinces = useMemo(
    () =>
      selectedCourse && form.studyType
        ? getProvinceOptions(selectedCourse, form.studyType)
        : [],
    [selectedCourse, form.studyType],
  );

  const isOutOfCountry = form.locationScope === OUT_OF_COUNTRY_LOCATION_SCOPE;

  const subSiteOptions = useMemo<string[]>(() => {
    if (!selectedCourse || !form.studyType || isOutOfCountry) return [];
    if (form.locationScope === "بغداد") {
      if (courseBaghdadMode === "عموم بغداد") return [];
      if (courseBaghdadMode === "بغداد - مخصص") return courseBaghdadSites;
    }
    if (form.locationScope === "محافظات") return courseProvinces;
    return [];
  }, [
    selectedCourse,
    form.studyType,
    form.locationScope,
    isOutOfCountry,
    courseBaghdadMode,
    courseBaghdadSites,
    courseProvinces,
  ]);

  // Effective baghdadMode: auto-set from course config
  const effectiveBaghdadMode = useMemo(
    () => courseBaghdadMode || form.baghdadMode,
    [courseBaghdadMode, form.baghdadMode],
  );

  // Effective subSite: auto-resolve for عموم بغداد
  const effectiveSubSite = useMemo(
    () =>
      form.locationScope === "بغداد" && courseBaghdadMode === "عموم بغداد"
        ? "عموم بغداد"
        : form.subSite,
    [form.locationScope, courseBaghdadMode, form.subSite],
  );

  const accountingGraceDays = useMemo(
    () => Number(form.accountingGraceDays || 0),
    [form.accountingGraceDays],
  );

  const gracePeriodEnd = useMemo(
    () => calculateGracePeriodEnd(form.createdAt, accountingGraceDays),
    [form.createdAt, accountingGraceDays],
  );

  const formattedGraceStart = useMemo(
    () => formatGraceDate(form.createdAt),
    [form.createdAt],
  );

  const formattedGraceEnd = useMemo(
    () => formatGraceDate(gracePeriodEnd),
    [gracePeriodEnd],
  );

  const gracePeriodDescription = useMemo(() => {
    if (accountingGraceDays <= 0) {
      return `هذا الطالب سيحاسب من تاريخ ${formattedGraceStart} ولا توجد فترة سماح`;
    }
    return `هذا الطالب لن يحاسب من تاريخ ${formattedGraceStart} إلى تاريخ ${formattedGraceEnd}`;
  }, [formattedGraceStart, formattedGraceEnd, accountingGraceDays]);

  const duplicatePhoneStudent = useMemo(() => {
    const phoneKey = normalizePhoneForDuplicate(form.phone);
    if (!phoneKey) return null;
    return (
      students.find(
        (student) => normalizePhoneForDuplicate(student.phone) === phoneKey,
      ) ?? null
    );
  }, [students, form.phone]);

  const duplicateTelegramStudent = useMemo(() => {
    const telegramKey = normalizeTelegramIdentifier(form.telegram);
    if (!telegramKey) return null;
    return (
      students.find(
        (student) =>
          normalizeTelegramIdentifier(student.telegram) === telegramKey,
      ) ?? null
    );
  }, [students, form.telegram]);

  const hasDuplicateContact = Boolean(
    duplicatePhoneStudent || duplicateTelegramStudent,
  );

  useEffect(() => {
    if (!form.studyType) return;
    if (
      (courseAvailableStudyTypes as readonly string[]).includes(form.studyType)
    )
      return;
    queueMicrotask(() => {
      setForm((prev) => ({
        ...prev,
        studyType: "",
        locationScope: "",
        baghdadMode: "",
        subSite: "",
      }));
    });
  }, [courseAvailableStudyTypes, form.studyType]);

  const formSteps = useMemo(
    () => [
      {
        label: "الدورة والموقع",
        complete: Boolean(
          form.courseId &&
          effectiveCourseProgram &&
          (effectiveCourseProgram !== "كورسات" || form.courseTerm) &&
          (courseAvailableStudyTypes.length === 0 || form.studyType) &&
          (courseLocationScopes.length === 0 || form.locationScope) &&
          (!isOutOfCountry || Boolean(form.subSite.trim())) &&
          (subSiteOptions.length === 0 || effectiveSubSite),
        ),
      },
      {
        label: "بيانات الطالب",
        complete: Boolean(
          form.name.trim() &&
          form.school.trim() &&
          form.phone.trim() &&
          form.parentPhone.trim(),
        ),
      },
      {
        label: "إعدادات التسجيل",
        complete: Boolean(
          form.createdAt && isValidGraceDays(form.accountingGraceDays),
        ),
      },
    ],
    [
      form,
      courseAvailableStudyTypes,
      courseLocationScopes,
      subSiteOptions.length,
      effectiveCourseProgram,
      effectiveSubSite,
      isOutOfCountry,
    ],
  );
  const hasDraftData = useMemo(
    () =>
      hasMeaningfulDraftValue(form, [
        "createdAt",
        "accountingGraceDays",
        "gender",
        "courseProgram",
        "courseTerm",
        "studyType",
        "locationScope",
        "baghdadMode",
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

  const updatePhoneForm = (key: "phone" | "parentPhone", value: string) => {
    setForm((prev) => ({ ...prev, [key]: sanitizePhoneInput(value) }));
  };

  const handleCourseChange = (value: string) => {
    setForm((prev) => ({
      ...prev,
      courseId: value,
      courseProgram: "",
      courseTerm: "",
      studyType: "",
      locationScope: "",
      baghdadMode: "",
      subSite: "",
    }));
  };

  const validateRequiredFields = () => {
    const requiredChecks: [boolean, string][] = [
      [Boolean(form.name.trim()), "اسم الطالب: هذا الحقل مطلوب"],
      [Boolean(form.school.trim()), "اسم المدرسة: هذا الحقل مطلوب"],
      [Boolean(form.gender), "الجنس مطلوب"],
      [Boolean(form.phone.trim()), "رقم هاتف الطالب مطلوب"],
      [Boolean(form.parentPhone.trim()), "رقم هاتف ولي الأمر مطلوب"],
      [
        Boolean(form.courseId),
        filteredCourses.length === 0
          ? "لا توجد دورات مسجلة"
          : "يرجى اختيار الدورة",
      ],
    ];

    // Course program validation
    if (courseAvailablePrograms.length > 1 && !form.courseProgram) {
      return "يرجى اختيار نوع الدورة (منهج كامل/كورسات)";
    }
    // Course term validation (only if كورسات)
    if (effectiveCourseProgram === "كورسات" && !form.courseTerm) {
      return "يرجى اختيار الكورس";
    }
    // Study type validation
    if (courseAvailableStudyTypes.length > 0 && !form.studyType) {
      return "يرجى اختيار نوع الدراسة";
    }
    // Location scope validation
    if (courseLocationScopes.length > 0 && !form.locationScope) {
      return "يرجى اختيار الموقع";
    }
    if (isOutOfCountry && !form.subSite.trim()) {
      return "يرجى إدخال الدولة عند اختيار خارج القطر";
    }
    // Sub-site validation
    if (!isOutOfCountry && subSiteOptions.length > 0 && !form.subSite) {
      return "يرجى اختيار الموقع الفرعي";
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

    if (!form.createdAt) return "تاريخ تسجيل الطالب مطلوب";
    if (!isValidGraceDays(form.accountingGraceDays)) {
      return "فترة السماح يجب أن تكون رقماً من 0 إلى 30 يوم";
    }

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

      const chapter = selectedCourseActiveChapter;
      const result = addStudent({
        name: form.name.trim(),
        school: form.school.trim(),
        gender: form.gender,
        phone: form.phone.trim(),
        parentPhone: form.parentPhone.trim(),
        telegram: sanitizeTelegramInput(form.telegram),
        courseProgram: effectiveCourseProgram as any,
        courseTerm: (effectiveCourseProgram === "كورسات"
          ? form.courseTerm
          : "") as any,
        studyType: form.studyType as any,
        locationScope: form.locationScope as any,
        baghdadMode: effectiveBaghdadMode as any,
        courseId: form.courseId,
        mainSite: form.locationScope,
        subSite: effectiveSubSite,
        status: "نشط",
        dismissalType: "",
        dismissalReason: "",
        dismissalNotes: "",
        createdAt: form.createdAt,
        opportunities: chapter?.opportunities ?? 0,
        baseOpportunities: chapter?.opportunities ?? 0,
        accountingGraceDays,
      });

      if (!result.ok) {
        toast.error(result.message);
        return;
      }

      window.localStorage.removeItem(STUDENT_DRAFT_KEY);
      setForm(emptyForm());
      toast.success("تم حفظ بيانات الطالب", {
        description: `${gracePeriodDescription}، وتمت إضافة الطالب إلى سجل الطلاب بنجاح`,
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
          </div>
        </CardHeader>

        <CardContent className="p-4 md:p-6 lg:p-8">
          <form
            onSubmit={handleSubmit}
            autoComplete="off"
            className="space-y-6"
          >
            <StepProgress steps={formSteps} />
            <section className="surface-card p-5 md:p-6">
              <SectionTitle
                icon={BookOpen}
                title="تفاصيل الدورة"
                description="اختيار الدورة يحدد المواقع المتاحة تلقائياً."
              />

              <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
                <div className="space-y-2">
                  <Label
                    htmlFor="reg-courseId"
                    className="font-bold text-foreground"
                  >
                    الدورة <RequiredMark />
                  </Label>
                  <Select
                    name="courseId"
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
                          لا توجد دورات مسجلة
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

              {form.courseId && (
                <div
                  className={`mt-5 rounded-2xl border p-4 text-sm leading-6 ${
                    selectedCourseHasNoActiveChapter
                      ? "border-destructive/50 bg-destructive/10 text-destructive"
                      : "border-primary/20 bg-primary/5 text-foreground"
                  }`}
                >
                  <div className="flex items-start gap-2">
                    <AlertCircle
                      className={`mt-0.5 h-4 w-4 shrink-0 ${
                        selectedCourseHasNoActiveChapter
                          ? "text-destructive"
                          : "text-primary"
                      }`}
                    />
                    <div className="space-y-1">
                      <p className="font-black">
                        {selectedCourseHasNoActiveChapter
                          ? "هذه الدورة لا تحتوي على فصل نشط"
                          : "الفصل النشط جاهز لهذه الدورة"}
                      </p>
                      <p>
                        {selectedCourseHasNoActiveChapter
                          ? "هذه الدورة لا تحتوي على فصل نشط، الطالب سيُسجل بدون فرص."
                          : `سيُسجل الطالب بعدد فرص ${selectedCourseOpportunityPreview} من الفصل النشط الحالي.`}
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {/* ── Course Program ── */}
              {form.courseId && courseAvailablePrograms.length > 1 && (
                <div className="mt-5 grid grid-cols-1 gap-5 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label
                      htmlFor="reg-courseProgram"
                      className="font-bold text-foreground"
                    >
                      نوع الدورة <RequiredMark />
                    </Label>
                    <Select
                      name="courseProgram"
                      value={form.courseProgram}
                      onValueChange={(v) =>
                        setForm((prev) => ({
                          ...prev,
                          courseProgram: v,
                          courseTerm: v === "كورسات" ? prev.courseTerm : "",
                          studyType: "",
                          locationScope: "",
                          baghdadMode: "",
                          subSite: "",
                        }))
                      }
                    >
                      <SelectTrigger
                        id="reg-courseProgram"
                        className={selectTriggerClass}
                        aria-required="true"
                      >
                        <SelectValue placeholder="اختر نوع الدورة..." />
                      </SelectTrigger>
                      <SelectContent>
                        {courseAvailablePrograms.map((p) => (
                          <SelectItem key={p} value={p}>
                            {p}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              )}

              {/* ── Course Term (only if كورسات) ── */}
              {effectiveCourseProgram === "كورسات" && (
                <div className="mt-5 grid grid-cols-1 gap-5 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label
                      htmlFor="reg-courseTerm"
                      className="font-bold text-foreground"
                    >
                      الكورس <RequiredMark />
                    </Label>
                    <Select
                      name="courseTerm"
                      value={form.courseTerm}
                      onValueChange={(v) =>
                        setForm((prev) => ({
                          ...prev,
                          courseTerm: v,
                          studyType: "",
                          locationScope: "",
                          baghdadMode: "",
                          subSite: "",
                        }))
                      }
                    >
                      <SelectTrigger
                        id="reg-courseTerm"
                        className={selectTriggerClass}
                        aria-required="true"
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
                </div>
              )}

              {/* ── Study Type ── */}
              {form.courseId && courseAvailableStudyTypes.length > 0 && (
                <div className="mt-5 grid grid-cols-1 gap-5 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label
                      htmlFor="reg-studyType"
                      className="font-bold text-foreground"
                    >
                      نوع الدراسة <RequiredMark />
                    </Label>
                    <Select
                      name="studyType"
                      value={form.studyType}
                      onValueChange={(v) =>
                        setForm((prev) => ({
                          ...prev,
                          studyType: v,
                          locationScope: "",
                          baghdadMode: "",
                          subSite: "",
                        }))
                      }
                    >
                      <SelectTrigger
                        id="reg-studyType"
                        className={selectTriggerClass}
                        aria-required="true"
                      >
                        <SelectValue placeholder="اختر نوع الدراسة..." />
                      </SelectTrigger>
                      <SelectContent>
                        {courseAvailableStudyTypes.map((st) => (
                          <SelectItem key={st} value={st}>
                            {st}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              )}

              {/* ── Location Scope ── */}
              {form.studyType && courseLocationScopes.length > 0 && (
                <div className="mt-5 grid grid-cols-1 gap-5 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label
                      htmlFor="reg-locationScope"
                      className="font-bold text-foreground"
                    >
                      الموقع <RequiredMark />
                    </Label>
                    <Select
                      name="locationScope"
                      value={isOutOfCountry ? "" : form.locationScope}
                      onValueChange={(v) =>
                        setForm((prev) => ({
                          ...prev,
                          locationScope: v,
                          subSite: "",
                        }))
                      }
                    >
                      <SelectTrigger
                        id="reg-locationScope"
                        className={selectTriggerClass}
                        aria-required="true"
                      >
                        <SelectValue placeholder="اختر الموقع..." />
                      </SelectTrigger>
                      <SelectContent>
                        {courseLocationScopes.map((s) => (
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
                        checked={isOutOfCountry}
                        onChange={(event) =>
                          setForm((prev) => ({
                            ...prev,
                            locationScope: event.target.checked
                              ? OUT_OF_COUNTRY_LOCATION_SCOPE
                              : "",
                            baghdadMode: "",
                            subSite: "",
                          }))
                        }
                      />
                      الطالب خارج القطر
                    </label>
                  </div>

                  {/* ── Out of Country ── */}
                  {isOutOfCountry && (
                    <div className="space-y-2">
                      <Label
                        htmlFor="reg-outOfCountrySite"
                        className="font-bold text-foreground"
                      >
                        الدولة <RequiredMark />
                      </Label>
                      <Input
                        id="reg-outOfCountrySite"
                        name="subSite"
                        autoComplete="off"
                        value={form.subSite}
                        onChange={(e) => updateForm("subSite", e.target.value)}
                        placeholder="مثلاً: تركيا"
                        required
                        className={fieldBaseClass}
                      />
                      <p className="text-xs leading-5 text-muted-foreground">
                        خيار خارج القطر عام لكل الدورات ولا يحتاج تفعيله من
                        إعدادات الدورة.
                      </p>
                    </div>
                  )}

                  {/* ── Sub-Site ── */}
                  {!isOutOfCountry && subSiteOptions.length > 0 && (
                    <div className="space-y-2">
                      <Label
                        htmlFor="reg-subSite"
                        className="font-bold text-foreground"
                      >
                        الموقع الفرعي <RequiredMark />
                      </Label>
                      <Select
                        name="subSite"
                        value={form.subSite}
                        onValueChange={(v) => updateForm("subSite", v)}
                      >
                        <SelectTrigger
                          id="reg-subSite"
                          className={selectTriggerClass}
                          aria-required="true"
                        >
                          <SelectValue placeholder="اختر الموقع الفرعي..." />
                        </SelectTrigger>
                        <SelectContent>
                          {subSiteOptions.map((s) => (
                            <SelectItem key={s} value={s}>
                              {s}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                </div>
              )}

              {/* ── عموم بغداد auto-resolved info ── */}
              {form.locationScope === "بغداد" &&
                courseBaghdadMode === "عموم بغداد" && (
                  <div className="mt-3 flex items-center gap-2 text-xs font-bold text-primary">
                    <MapPin className="h-3.5 w-3.5" />
                    تم تحديد الموقع تلقائياً: عموم بغداد
                  </div>
                )}
            </section>

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
                      autoComplete="off"
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
                      autoComplete="off"
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
                      autoComplete="off"
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
                  {duplicateTelegramStudent && (
                    <p className="text-xs font-bold text-destructive">
                      معرف التليكرام مستخدم للطالب:{" "}
                      {duplicateTelegramStudent.name}
                    </p>
                  )}
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
                      autoComplete="off"
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
                  {duplicatePhoneStudent && (
                    <p className="text-xs font-bold text-destructive">
                      رقم الهاتف مستخدم للطالب: {duplicatePhoneStudent.name}
                    </p>
                  )}
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
                      autoComplete="off"
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
                icon={CalendarDays}
                title="إعدادات التسجيل"
                description="حدد تاريخ تسجيل الطالب وعدد أيام السماح التي لا يُحاسَب خلالها على الامتحانات أو الإخفاقات."
              />
              <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
                <div className="space-y-2">
                  <Label
                    htmlFor="reg-createdAt"
                    className="font-bold text-foreground"
                  >
                    تاريخ تسجيل الطالب <RequiredMark />
                  </Label>
                  <DateInput
                    id="reg-createdAt"
                    name="createdAt"
                    value={form.createdAt}
                    onChange={(value) => updateForm("createdAt", value)}
                    required
                    className={fieldBaseClass}
                  />
                  <p className="text-xs leading-5 text-muted-foreground">
                    بداية السماح:{" "}
                    <span className="font-semibold text-foreground">
                      {formattedGraceStart}
                    </span>
                  </p>
                </div>

                <div className="space-y-2">
                  <Label
                    htmlFor="reg-accountingGraceDays"
                    className="font-bold text-foreground"
                  >
                    فترة السماح بالأيام <RequiredMark />
                  </Label>
                  <Input
                    id="reg-accountingGraceDays"
                    name="accountingGraceDays"
                    value={form.accountingGraceDays}
                    onChange={(e) =>
                      updateForm(
                        "accountingGraceDays",
                        normalizeGraceDays(e.target.value),
                      )
                    }
                    required
                    inputMode="numeric"
                    min={0}
                    max={30}
                    pattern="(?:[0-9]|[12][0-9]|30)"
                    placeholder="مثلاً 7"
                    dir="ltr"
                    className={`${fieldBaseClass} text-left font-tabular`}
                  />
                  <p className="text-xs leading-5 text-muted-foreground">
                    {accountingGraceDays > 0 ? (
                      <>
                        تبدأ فترة السماح تلقائياً من{" "}
                        <span className="font-semibold text-foreground">
                          {formattedGraceStart}
                        </span>{" "}
                        وتنتهي في{" "}
                        <span className="font-semibold text-foreground">
                          {formattedGraceEnd}
                        </span>{" "}
                        حسب عدد الأيام المدخل.
                      </>
                    ) : (
                      "لا توجد أيام سماح عند اختيار 0."
                    )}
                  </p>
                </div>
              </div>

              <div className="mt-5 flex items-start gap-2 rounded-2xl border border-primary/20 bg-primary/5 p-4 text-sm leading-6 text-foreground">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                <span>
                  مثال عملي:{" "}
                  <span className="font-black">{gracePeriodDescription}.</span>
                </span>
              </div>
            </section>

            <div className="flex flex-col gap-3 rounded-3xl border bg-muted/35 p-4 md:flex-row md:items-center md:justify-between">
              <div
                className={`flex items-start gap-2 text-sm leading-6 ${selectedCourseHasNoActiveChapter ? "font-bold text-destructive" : "text-muted-foreground"}`}
              >
                <AlertCircle
                  className={`mt-0.5 h-4 w-4 shrink-0 ${selectedCourseHasNoActiveChapter ? "text-destructive" : "text-primary"}`}
                />
                <span>
                  {selectedCourseHasNoActiveChapter
                    ? "تنبيه قبل الحفظ: هذه الدورة لا تحتوي على فصل نشط، الطالب سيُسجل بدون فرص."
                    : "راجع بيانات الطالب والدورة قبل الحفظ."}
                </span>
              </div>
              <Button
                type="submit"
                size="lg"
                disabled={isSubmitting || hasDuplicateContact}
                className="h-14 min-w-56 rounded-2xl px-10 text-base font-black shadow-lg shadow-primary/20"
              >
                <Save className="ml-2 h-5 w-5" />
                {isSubmitting ? "جاري الحفظ..." : "حفظ بيانات الطالب"}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
