"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  useTeacherStore,
  type Course,
  type Student,
} from "@/lib/teacher-store";
import {
  studentApi,
  studentRegisterApi,
  type StudentRegisterContextResponse,
} from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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

import { toast } from "@/lib/user-toast";
import {
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
import { LoadingState, EmptyState } from "./ui-kit";
import "./student-register.css";
import { emitTeacherProDataChanged } from "@/lib/teacherpro-sync";
import { baghdadTodayKey } from "@/lib/baghdad-time";
import {
  AlertCircle,
  BookOpen,
  CalendarDays,
  Loader2,
  MapPin,
  PhoneCall,
  RefreshCcw,
  Save,
  School,
  ShieldCheck,
  Smartphone,
  User,
  CheckCircle2,
  WifiOff,
} from "lucide-react";
import { Send } from "lucide-react";

const fieldBaseClass =
  "tp-register__input h-11 rounded-xl border-input bg-background pr-10 pl-3 text-right shadow-xs focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] dark:bg-input/30";
const selectTriggerClass =
  "tp-register__select h-11 rounded-xl border-input bg-background px-3 shadow-xs focus:ring-ring/50 dark:bg-input/30";

const STUDENT_DRAFT_KEY = "teacherpro:student-register-draft";

type StudentRegisterForm = {
  name: string;
  school: string;
  gender: "ذكر" | "أنثى";
  phone: string;
  parentPhone: string;
  telegram: string;
  username: string;
  courseProgram: string;
  courseTerm: string;
  studyType: string;
  locationScope: string;
  baghdadMode: string;
  courseId: string;
  subSite: string;
  createdAt: string;
};

type RegisterContextRow = StudentRegisterContextResponse["courses"][number];

type StudentCreateResponse = {
  student?: Student;
  opportunitiesWarning?: string;
  source?: "database";
};

function todayISO(): string {
  return baghdadTodayKey();
}

function readStudentDraft(): StudentRegisterForm {
  if (typeof window === "undefined") return emptyForm();
  try {
    const saved = window.localStorage.getItem(STUDENT_DRAFT_KEY);
    if (!saved) return emptyForm();
    const draft = JSON.parse(saved) as Record<string, unknown>;
    const form = emptyForm();
    // Keep only current fields so fields retired from the form (such as the
    // old grace days) never come back from an older saved draft.
    for (const key of Object.keys(form) as Array<keyof StudentRegisterForm>) {
      if (typeof draft?.[key] === "string") {
        Object.assign(form, { [key]: draft[key] });
      }
    }
    return form;
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
    username: "",
    courseProgram: "",
    courseTerm: "",
    studyType: "",
    locationScope: "",
    baghdadMode: "",
    courseId: "",
    subSite: "",
    createdAt: todayISO(),
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
  return <span className="text-danger">*</span>;
}

function normalizeRegisterContextCourse(row: RegisterContextRow): Course {
  return {
    ...(row.course as Record<string, unknown>),
    id: String(row.course.id || row.id),
    name: String(row.course.name || ""),
    active: row.course.active !== undefined ? Boolean(row.course.active) : true,
    createdAt: row.course.createdAt
      ? String(row.course.createdAt).slice(0, 10)
      : todayISO(),
    availablePrograms: Array.isArray(row.course.availablePrograms)
      ? row.course.availablePrograms.map(String)
      : [],
    availableStudyTypes: Array.isArray(row.course.availableStudyTypes)
      ? row.course.availableStudyTypes.map(String)
      : [],
    studyTypesByProgram:
      row.course.studyTypesByProgram &&
      typeof row.course.studyTypesByProgram === "object"
        ? (row.course.studyTypesByProgram as Course["studyTypesByProgram"])
        : {},
    locationConfig:
      row.course.locationConfig && typeof row.course.locationConfig === "object"
        ? (row.course.locationConfig as Course["locationConfig"])
        : {},
  };
}

function getStudentCreateResponse(data: unknown): StudentCreateResponse {
  return data && typeof data === "object"
    ? (data as StudentCreateResponse)
    : {};
}

function SectionTitle({
  icon: Icon,
  title,
}: {
  icon: React.ElementType;
  title: string;
}) {
  return (
    <CardHeader className="tp-register__section-heading">
      <div className="flex min-w-0 items-center gap-2">
        <Icon className="size-4 shrink-0 text-primary" aria-hidden="true" />
        <h3 className="text-sm font-bold text-foreground">{title}</h3>
      </div>
    </CardHeader>
  );
}

export function StudentRegisterView() {
  const { students, courses, mergeStudentsCache } = useTeacherStore();
  const [form, setForm] = useState<StudentRegisterForm>(() =>
    readStudentDraft(),
  );
  const [registerContext, setRegisterContext] =
    useState<StudentRegisterContextResponse | null>(null);
  const [contextLoading, setContextLoading] = useState(true);
  const [contextError, setContextError] = useState("");
  const { locked: isSubmitting, runLocked } = useActionLock();

  const loadRegisterContext = useCallback(async () => {
    setContextLoading(true);
    setContextError("");
    try {
      const context = await studentRegisterApi.context();
      if (!context) {
        setRegisterContext(null);
        setContextError("تعذر تحميل الدورات.");
        return;
      }
      setRegisterContext(context);
    } catch {
      setRegisterContext(null);
      setContextError("تعذر تحميل بيانات التسجيل. حاول مجدداً.");
    } finally {
      setContextLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadRegisterContext();
  }, [loadRegisterContext]);

  const contextRows = registerContext?.rows || [];

  const filteredCourseRows = useMemo(
    () => contextRows.filter((row) => row.course.active !== false),
    [contextRows],
  );

  const filteredCourses = useMemo(
    () => filteredCourseRows.map(normalizeRegisterContextCourse),
    [filteredCourseRows],
  );

  const selectedCourseRow = useMemo(
    () => contextRows.find((row) => row.id === form.courseId) || null,
    [contextRows, form.courseId],
  );

  const selectedCourse = useMemo(
    () =>
      selectedCourseRow
        ? normalizeRegisterContextCourse(selectedCourseRow)
        : courses.find((c) => c.id === form.courseId) || null,
    [courses, form.courseId, selectedCourseRow],
  );

  const selectedCourseActiveChapter = selectedCourseRow?.activeChapter || null;
  const selectedCourseHasNoActiveChapter = Boolean(
    form.courseId &&
      selectedCourseRow &&
      selectedCourseRow.activeChapterCount === 0,
  );
  const selectedCourseHasChapterConflict = Boolean(
    form.courseId &&
      selectedCourseRow &&
      selectedCourseRow.activeChapterCount > 1,
  );
  const selectedCourseCannotRegister = Boolean(
    form.courseId && selectedCourseRow && !selectedCourseRow.canRegister,
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
            !selectedCourseCannotRegister &&
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
        complete: Boolean(form.createdAt),
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
      selectedCourseCannotRegister,
    ],
  );
  const hasDraftData = useMemo(
    () =>
      hasMeaningfulDraftValue(form, [
        "createdAt",
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
    if (contextLoading) return "انتظر اكتمال تحميل بيانات التسجيل";
    if (!registerContext) {
      return contextError || "تعذر تحميل بيانات التسجيل";
    }
    if (selectedCourseCannotRegister) {
      return selectedCourseHasChapterConflict
        ? "لا يمكن التسجيل لأن الدورة تحتوي أكثر من فصل نشط. أصلح الفصول والفرص أولاً."
        : "لا يمكن التسجيل في هذه الدورة حالياً.";
    }

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
      return "يرجى اختيار نوع البرنامج";
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

    // فحص التكرار النهائي يتم في النظام باستعلام مباشر على المفاتيح الفريدة.
    // الفحص المحلي أدناه للعرض فقط لأن بيانات الطلاب المؤقتة قد يكون جزئياً أو غير محمّل بالكامل.
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

      const result = await studentApi.add({
        name: form.name.trim(),
        school: form.school.trim(),
        gender: form.gender,
        phone: form.phone.trim(),
        parentPhone: form.parentPhone.trim(),
        telegram: sanitizeTelegramInput(form.telegram),
        username: sanitizeTelegramInput(form.username),
        courseProgram: effectiveCourseProgram,
        courseTerm: effectiveCourseProgram === "كورسات" ? form.courseTerm : "",
        studyType: form.studyType,
        locationScope: form.locationScope,
        baghdadMode: effectiveBaghdadMode,
        courseId: form.courseId,
        mainSite: form.locationScope,
        subSite: effectiveSubSite,
        createdAt: form.createdAt,
      });

      if (!result.ok) {
        toast.error(result.error || "تعذر حفظ بيانات الطالب");
        return;
      }

      const response = getStudentCreateResponse(result.data);
      if (response.student) {
        mergeStudentsCache([response.student]);
      }
      emitTeacherProDataChanged({
        source: "local-mutation",
        reason: "تسجيل طالب من النظام",
        scopes: ["students", "opportunities", "dashboard"],
      });

      window.localStorage.removeItem(STUDENT_DRAFT_KEY);
      setForm(emptyForm());
      void loadRegisterContext();
      const successDetails = [
        response.student?.code ? `الكود: ${response.student.code}` : "",
        response.opportunitiesWarning || "",
      ].filter(Boolean);
      toast.success("تم حفظ بيانات الطالب", {
        description: successDetails.length ? successDetails.join(" — ") : undefined,
      });
    },
  );

  return (
    <div className="tp-management-page tp-register-page space-y-4">
      <Card className="tp-management-action-card tp-register__intro">
        <CardHeader>
          <CardTitle className="text-base">إضافة طالب جديد</CardTitle>
        </CardHeader>
        <CardContent>
          <ol className="tp-register__progress" aria-label="تقدم التسجيل">
            {formSteps.map((step, index) => (
              <li key={step.label} data-complete={step.complete}>
                {step.complete ? (
                  <CheckCircle2
                    className="size-4 shrink-0"
                    aria-hidden="true"
                  />
                ) : (
                  <span className="tp-register__step-number" aria-hidden="true">
                    {index + 1}
                  </span>
                )}
                <span>
                  {step.label}
                  <span className="sr-only">
                    {step.complete ? "، مكتملة" : "، غير مكتملة"}
                  </span>
                </span>
              </li>
            ))}
          </ol>
        </CardContent>
      </Card>
      <div className="tp-management-workspace">
        <section
          className="tp-management-main-flow"
          aria-label="نموذج تسجيل الطالب"
        >
          {contextLoading ? (
            <LoadingState title="جاري تحميل بيانات التسجيل..." />
          ) : contextError ? (
            <EmptyState
              icon={WifiOff}
              title="تعذر تحميل بيانات التسجيل"
              description={contextError}
              action={
                <Button
                  type="button"
                  onClick={() => void loadRegisterContext()}
                >
                  <RefreshCcw className="size-4" />
                  إعادة المحاولة
                </Button>
              }
            />
          ) : null}
          <form
            onSubmit={handleSubmit}
            autoComplete="off"
            className="tp-register__form tp-validation-form"
          >
            <Card className="tp-register__section tp-management-results-card">
              <SectionTitle icon={BookOpen} title="تفاصيل الدورة" />
              <CardContent className="tp-register__section-content">
                <div className="tp-register__fields">
                  <div className="tp-register__course-fields">
                    <div className="space-y-2">
                      <Label
                        htmlFor="reg-courseId"
                        className="text-xs font-bold text-foreground"
                      >
                        الدورة <RequiredMark />
                      </Label>
                      <Select
                        name="courseId"
                        value={form.courseId}
                        onValueChange={handleCourseChange}
                        disabled={
                          contextLoading ||
                          !registerContext ||
                          filteredCourses.length === 0
                        }
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
                            filteredCourseRows.map((row) => {
                              const c = normalizeRegisterContextCourse(row);
                              return (
                                <SelectItem key={c.id} value={c.id}>
                                  {c.name}
                                  {row.activeChapter
                                    ? ` — ${row.activeChapter.opportunities} فرص`
                                    : " — بلا فصل نشط"}
                                </SelectItem>
                              );
                            })
                          )}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  {/* ── Course Program ── */}
                  {form.courseId && courseAvailablePrograms.length > 1 && (
                    <div className="tp-register__course-fields">
                      <div className="space-y-2">
                        <Label
                          htmlFor="reg-courseProgram"
                          className="text-xs font-bold text-foreground"
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
                    <div className="tp-register__course-fields">
                      <div className="space-y-2">
                        <Label
                          htmlFor="reg-courseTerm"
                          className="text-xs font-bold text-foreground"
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
                    <div className="tp-register__course-fields">
                      <div className="space-y-2">
                        <Label
                          htmlFor="reg-studyType"
                          className="text-xs font-bold text-foreground"
                        >
                          نوع البرنامج <RequiredMark />
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
                            <SelectValue placeholder="اختر نوع البرنامج..." />
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
                    <div className="tp-register__course-fields">
                      <div className="space-y-2">
                        <Label
                          htmlFor="reg-locationScope"
                          className="text-xs font-bold text-foreground"
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
                        <label className="tp-register__choice tp-register__outside-choice">
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
                            className="text-xs font-bold text-foreground"
                          >
                            الدولة <RequiredMark />
                          </Label>
                          <Input
                            id="reg-outOfCountrySite"
                            name="subSite"
                            autoComplete="off"
                            value={form.subSite}
                            onChange={(e) =>
                              updateForm("subSite", e.target.value)
                            }
                            placeholder="مثلاً: تركيا"
                            required
                            className={fieldBaseClass}
                          />
                        </div>
                      )}

                      {/* ── Sub-Site ── */}
                      {!isOutOfCountry && subSiteOptions.length > 0 && (
                        <div className="space-y-2">
                          <Label
                            htmlFor="reg-subSite"
                            className="text-xs font-bold text-foreground"
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
                </div>
                {form.courseId && selectedCourseRow && (
                  <div
                    className={`tp-register__course-status ${
                      selectedCourseHasChapterConflict
                        ? "border-danger-line border-s-4 border-s-danger-vivid bg-danger-soft text-danger"
                        : selectedCourseHasNoActiveChapter
                          ? "border-warning-line bg-warning-soft text-warning"
                          : "border-primary/20 bg-primary/5 text-foreground"
                    }`}
                  >
                    <div className="flex min-w-0 items-start gap-2">
                      {selectedCourseHasChapterConflict ||
                      selectedCourseHasNoActiveChapter ? (
                        <AlertCircle
                          className="mt-0.5 size-4 shrink-0"
                          aria-hidden="true"
                        />
                      ) : (
                        <ShieldCheck
                          className="mt-0.5 size-4 shrink-0 text-primary"
                          aria-hidden="true"
                        />
                      )}
                      <div className="min-w-0 space-y-1">
                        <p className="font-bold">
                          {selectedCourseHasChapterConflict
                            ? "التسجيل موقوف: أكثر من فصل نشط"
                            : selectedCourseHasNoActiveChapter
                              ? "هذه الدورة لا تحتوي على فصل نشط"
                              : selectedCourseActiveChapter?.name}
                        </p>
                        {selectedCourseHasChapterConflict ? (
                          <p>أصلح تعارض الفصول قبل تسجيل الطالب.</p>
                        ) : selectedCourseHasNoActiveChapter ? (
                          <p>
                            يمكن التسجيل، لكن الطالب سيبدأ بفرص 0 إلى أن يتم
                            تفعيل فصل للدورة.
                          </p>
                        ) : null}
                        {selectedCourseRow.warnings.length > 0 && (
                          <ul className="space-y-1">
                            {selectedCourseRow.warnings.map((warning) => (
                              <li key={warning}>{warning}</li>
                            ))}
                          </ul>
                        )}
                      </div>
                    </div>
                    <dl className="tp-register__course-metrics">
                      <div>
                        <dt>الطلاب</dt>
                        <dd>{selectedCourseRow.counts.total}</dd>
                      </div>
                      <div>
                        <dt>النشطون</dt>
                        <dd>{selectedCourseRow.counts.active}</dd>
                      </div>
                      <div>
                        <dt>فرص البداية</dt>
                        <dd className="text-primary">
                          {selectedCourseOpportunityPreview}
                        </dd>
                      </div>
                    </dl>
                  </div>
                )}
                {/* ── عموم بغداد auto-resolved info ── */}
                {form.locationScope === "بغداد" &&
                  courseBaghdadMode === "عموم بغداد" && (
                    <div className="mt-3 flex items-center gap-2 text-xs font-bold text-primary">
                      <MapPin className="h-3.5 w-3.5" />
                      الموقع: عموم بغداد
                    </div>
                  )}
              </CardContent>
            </Card>

            <Card className="tp-register__section tp-management-results-card">
              <SectionTitle icon={User} title="بيانات الطالب" />
              <CardContent className="tp-register__section-content">
                <div className="tp-register__fields">
                  <div className="space-y-2">
                    <Label
                      htmlFor="reg-name"
                      className="text-xs font-bold text-foreground"
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
                      className="text-xs font-bold text-foreground"
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
                      className="text-xs font-bold text-foreground"
                    >
                      الجنس <RequiredMark />
                    </Label>
                    {/* radios labelled by their own wrapping labels */}
                    <div className="tp-register__gender-options">
                      <label className="tp-register__choice">
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
                      <label className="tp-register__choice">
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
                      className="text-xs font-bold text-foreground"
                    >
                      معرف التيليجرام
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
                      <p className="tp-field-feedback tp-field-feedback-warning">
                        قد يكون معرف التيليجرام مرتبطاً بالطالب{" "}
                        {duplicateTelegramStudent.name}. راجع المعرف قبل الحفظ.
                      </p>
                    )}
                  </div>

                  <div className="space-y-2">
                    <Label
                      htmlFor="reg-username"
                      className="text-xs font-bold text-foreground"
                    >
                      يوزر التيليجرام (المستعاد)
                    </Label>
                    <div className="relative">
                      <FieldIcon icon={Send} />
                      <Input
                        id="reg-username"
                        name="username"
                        autoComplete="off"
                        value={form.username}
                        onChange={(e) =>
                          setForm((prev) => ({
                            ...prev,
                            username: sanitizeTelegramInput(e.target.value),
                          }))
                        }
                        placeholder="يوزر إضافي بدون @ (اختياري)"
                        dir="ltr"
                        className={`${fieldBaseClass} text-left font-tabular`}
                      />
                    </div>
                    <p className="text-[11px] text-muted-foreground">
                      إن تُرك فارغاً يُعتمد نفس معرف التيليجرام تلقائياً.
                    </p>
                  </div>

                  <div className="space-y-2">
                    <Label
                      htmlFor="reg-phone"
                      className="text-xs font-bold text-foreground"
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
                        onChange={(e) =>
                          updatePhoneForm("phone", e.target.value)
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
                    {duplicatePhoneStudent && (
                      <p className="tp-field-feedback tp-field-feedback-warning">
                        قد يكون رقم الهاتف مرتبطاً بالطالب{" "}
                        {duplicatePhoneStudent.name}. راجع الرقم قبل الحفظ.
                      </p>
                    )}
                  </div>

                  <div className="space-y-2">
                    <Label
                      htmlFor="reg-parentPhone"
                      className="text-xs font-bold text-foreground"
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
              </CardContent>
            </Card>

            <Card className="tp-register__section tp-management-results-card">
              <SectionTitle icon={CalendarDays} title="إعدادات التسجيل" />
              <CardContent className="tp-register__section-content">
                <div className="tp-register__fields">
                  <div className="space-y-2">
                    <Label
                      htmlFor="reg-createdAt"
                      className="text-xs font-bold text-foreground"
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
                      فترة السماح تُضاف من شاشة «إدارة فترة السماح».
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <div className="tp-register__actions">
              <div className="min-w-0 space-y-2">
                {hasDraftData && (
                  <p className="text-xs text-muted-foreground" role="status">
                    المسودة محفوظة على هذا الجهاز
                  </p>
                )}
                {(selectedCourseHasChapterConflict ||
                  selectedCourseHasNoActiveChapter) && (
                  <div className="flex items-start gap-2 text-sm font-bold leading-6 text-danger">
                    <AlertCircle
                      className={`mt-0.5 h-4 w-4 shrink-0 ${selectedCourseHasChapterConflict || selectedCourseHasNoActiveChapter ? "text-danger" : "text-primary"}`}
                    />
                    <span>
                      {selectedCourseHasChapterConflict
                        ? "التسجيل موقوف لهذه الدورة لأن فيها أكثر من فصل نشط."
                        : "تنبيه قبل الحفظ: هذه الدورة لا تحتوي على فصل نشط، الطالب سيُسجل بدون فرص."}
                    </span>
                  </div>
                )}
              </div>
              <Button
                type="submit"
                disabled={
                  isSubmitting ||
                  contextLoading ||
                  !registerContext ||
                  selectedCourseCannotRegister
                }
                className="tp-register__submit"
              >
                {isSubmitting ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Save className="size-4" />
                )}
                {isSubmitting ? "جارٍ الحفظ..." : "حفظ بيانات الطالب"}
              </Button>
            </div>
          </form>
        </section>
        <aside
          className="tp-management-stats-rail"
          aria-label="إحصائيات التسجيل"
        >
          <div className="space-y-2">
            <h3 className="text-sm font-black">إحصائيات التسجيل</h3>
            <div
              className="grid"
              role="group"
              aria-label="إحصائيات الدورات المتاحة للتسجيل"
              tabIndex={0}
            >
              <Card>
                <CardContent className="p-4 text-center">
                  <p className="text-2xl font-bold text-foreground">
                    {registerContext?.stats.active ?? "—"}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    الدورات النشطة
                  </p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-4 text-center">
                  <p className="text-2xl font-bold text-primary">
                    {registerContext?.stats.selectable ?? "—"}
                  </p>
                  <p className="text-xs text-muted-foreground">جاهزة للتسجيل</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-4 text-center">
                  <p className="text-2xl font-bold text-warning">
                    {registerContext?.stats.withoutActiveChapter ?? "—"}
                  </p>
                  <p className="text-xs text-muted-foreground">بلا فصل نشط</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-4 text-center">
                  <p className="text-2xl font-bold text-danger">
                    {registerContext?.stats.withChapterConflict ?? "—"}
                  </p>
                  <p className="text-xs text-muted-foreground">تعارض فصل</p>
                </CardContent>
              </Card>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
