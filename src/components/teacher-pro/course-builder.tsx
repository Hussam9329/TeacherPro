"use client";

import React, { useId, useMemo, useRef, useState } from "react";
import {
  COURSE_PROGRAMS,
  COURSE_TERMS,
  STUDY_TYPES,
  LOCATION_SCOPES,
  type CourseProgram,
  type StudyType,
  type LocationScope,
  type BaghdadMode,
  type StudyLocationConfig,
  type CourseLocationConfig,
  type StudyTypesByProgram,
} from "@/lib/course-config";
import { BAGHDAD_COURSE_SITES, IRAQI_PROVINCES } from "@/lib/iraq";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  AlertCircle,
  Check,
  ChevronLeft,
  ChevronRight,
  ClipboardCheck,
  GraduationCap,
  MapPin,
  Monitor,
} from "lucide-react";
import "./course-builder.css";

export type CourseFormState = {
  name: string;
  availablePrograms: CourseProgram[];
  availableStudyTypes: StudyType[];
  studyTypesByProgram: StudyTypesByProgram;
  locationConfig: CourseLocationConfig;
};

export function emptyCourseForm(): CourseFormState {
  return {
    name: "",
    availablePrograms: [],
    availableStudyTypes: [],
    studyTypesByProgram: {},
    locationConfig: {},
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function toggleInArray<T>(arr: T[], item: T): T[] {
  return arr.includes(item) ? arr.filter((x) => x !== item) : [...arr, item];
}

function usesAutoGeneralBaghdad(studyType: StudyType): boolean {
  return studyType === "إلكتروني" || studyType === "مدمج";
}

function usesForcedCustomBaghdad(studyType: StudyType): boolean {
  return studyType === "حضوري";
}

export function normalizeStudyLocationConfig(
  studyType: StudyType,
  config: StudyLocationConfig,
): StudyLocationConfig {
  const nextConfig: StudyLocationConfig = {
    ...config,
    scopes: [...(config.scopes || [])],
  };

  if (
    usesAutoGeneralBaghdad(studyType) &&
    nextConfig.scopes.includes("بغداد")
  ) {
    nextConfig.baghdadMode = "عموم بغداد";
    nextConfig.baghdadSites = undefined;
  }

  if (
    usesForcedCustomBaghdad(studyType) &&
    nextConfig.scopes.includes("بغداد")
  ) {
    nextConfig.baghdadMode = "بغداد - مخصص";
    nextConfig.baghdadSites = nextConfig.baghdadSites || [];
  }

  return nextConfig;
}

export function normalizeCourseLocationConfig(
  config: CourseLocationConfig,
  studyTypes: StudyType[],
): CourseLocationConfig {
  const nextConfig: CourseLocationConfig = {};

  for (const studyType of studyTypes) {
    const studyConfig = config[studyType];
    if (studyConfig) {
      nextConfig[studyType] = normalizeStudyLocationConfig(
        studyType,
        studyConfig,
      );
    }
  }

  return nextConfig;
}

function getStudyTypesFromProgramMap(
  studyTypesByProgram: StudyTypesByProgram,
  programs: CourseProgram[],
): StudyType[] {
  const values = programs.flatMap(
    (program) => studyTypesByProgram[program] || [],
  );
  return Array.from(new Set(values));
}

/** The three setup steps; each validates only its own part of the form. */
export const COURSE_BUILDER_STEPS = [
  { title: "بيانات الدورة", hint: "الاسم" },
  { title: "خيارات الاشتراك والدراسة", hint: "نظام الاشتراك ونظام الدراسة" },
  { title: "المواقع والمراجعة", hint: "أين يدرس الطالب، ثم الملخص" },
] as const;

export function validateCourseStep(
  form: CourseFormState,
  step: number,
): string | null {
  if (step === 0) {
    if (!form.name.trim()) return "يرجى إدخال اسم الدورة";
    return null;
  }

  if (step === 1) {
    if (form.availablePrograms.length === 0)
      return "يجب اختيار نظام اشتراك واحد على الأقل";
    for (const program of form.availablePrograms) {
      if ((form.studyTypesByProgram[program] || []).length === 0) {
        return `يجب اختيار نظام دراسة واحد على الأقل لنظام الاشتراك "${program}"`;
      }
    }
    return null;
  }

  for (const studyType of form.availableStudyTypes) {
    const config = form.locationConfig[studyType];
    if (!config || config.scopes.length === 0) {
      return `يجب تحديد إعدادات المواقع لنظام الدراسة "${studyType}"`;
    }
    if (config.scopes.includes("بغداد") && !config.baghdadMode) {
      return `يجب اختيار نوع بغداد لنظام الدراسة "${studyType}"`;
    }
    if (
      config.baghdadMode === "بغداد - مخصص" &&
      (!config.baghdadSites || config.baghdadSites.length === 0)
    ) {
      return `يجب اختيار موقع واحد على الأقل من مواقع بغداد لنظام الدراسة "${studyType}"`;
    }
    if (
      config.scopes.includes("محافظات") &&
      (!config.provinces || config.provinces.length === 0)
    ) {
      return `يجب اختيار محافظة واحدة على الأقل لنظام الدراسة "${studyType}"`;
    }
  }
  return null;
}

export function validateCourseForm(form: CourseFormState): string | null {
  for (let step = 0; step < COURSE_BUILDER_STEPS.length; step += 1) {
    const message = validateCourseStep(form, step);
    if (message) return message;
  }
  return null;
}

const PROGRAM_HINTS: Record<CourseProgram, string> = {
  "منهج كامل": "اشتراك بالمنهج كاملاً.",
  "كورسات": "اشتراك بكورس واحد؛ يختار الموظف الكورس الأول أو الثاني.",
};

const STUDY_TYPE_HINTS: Record<StudyType, string> = {
  "إلكتروني": "دراسة عن بعد.",
  "حضوري": "دراسة في موقع محدد.",
  "مدمج": "إلكتروني مع حضور.",
};

function listText(values: readonly string[], emptyText: string): string {
  return values.length ? values.join("، ") : emptyText;
}

/** One line per study type: which locations the employee can pick. */
function locationChoiceText(studyType: StudyType, rawConfig: StudyLocationConfig | undefined): string {
  if (!rawConfig || rawConfig.scopes.length === 0) return "لم تُحدد المواقع بعد";
  const config = normalizeStudyLocationConfig(studyType, rawConfig);
  const parts: string[] = [];
  if (config.scopes.includes("بغداد")) {
    parts.push(
      config.baghdadMode === "عموم بغداد"
        ? "بغداد، ويُسجَّل الموقع «عموم بغداد» تلقائياً"
        : `بغداد، ويختار موقعاً من: ${listText(config.baghdadSites || [], "لم تُحدد مواقع بغداد بعد")}`,
    );
  }
  if (config.scopes.includes("محافظات")) {
    const provinces = config.provinces || [];
    parts.push(
      provinces.length === IRAQI_PROVINCES.length
        ? "محافظات، ويختار أي محافظة"
        : `محافظات، ويختار من: ${listText(provinces, "لم تُحدد المحافظات بعد")}`,
    );
  }
  return parts.join(" · ");
}

/**
 * What the employee sees, in order, when registering a student in this course.
 * Used at the end of the setup wizard and in «عرض إعدادات الدورة».
 */
export function CourseRegistrationPreview({
  form,
  className = "",
}: {
  form: Pick<CourseFormState, "availablePrograms" | "availableStudyTypes" | "studyTypesByProgram" | "locationConfig">;
  className?: string;
}) {
  const programs = form.availablePrograms;
  const locationConfig = normalizeCourseLocationConfig(form.locationConfig, form.availableStudyTypes);
  return (
    <ol className={`tp-course-preview ${className}`}>
      <li>
        <b>نظام الاشتراك</b>
        <span>
          {programs.length === 0
            ? "لم يُحدد بعد"
            : programs.length === 1
              ? `خيار واحد: ${programs[0]}`
              : `يختار الموظف: ${programs.join(" أو ")}`}
        </span>
      </li>
      {programs.includes("كورسات") && (
        <li>
          <b>الكورس المطلوب</b>
          <span>يظهر عند اختيار «كورسات»: {COURSE_TERMS.join(" أو ")}</span>
        </li>
      )}
      <li>
        <b>نظام الدراسة</b>
        {programs.length === 0 ? (
          <span>لم يُحدد بعد</span>
        ) : (
          <ul>
            {programs.map((program) => (
              <li key={program}>
                مع «{program}»: {listText(form.studyTypesByProgram[program] || [], "لم يُحدد نظام دراسة بعد")}
              </li>
            ))}
          </ul>
        )}
      </li>
      <li>
        <b>الموقع</b>
        {form.availableStudyTypes.length === 0 ? (
          <span>يظهر بعد اختيار نظام الدراسة</span>
        ) : (
          <ul>
            {form.availableStudyTypes.map((studyType) => (
              <li key={studyType}>
                {studyType}: {locationChoiceText(studyType, locationConfig[studyType])}
              </li>
            ))}
            <li>خارج القطر متاح دائماً، ويكتب الموظف اسم الدولة.</li>
          </ul>
        )}
      </li>
    </ol>
  );
}

export function CourseBuilderForm({
  form,
  setForm,
  onSubmit,
  submitLabel,
  submitDisabled,
  mode = "create",
}: {
  form: CourseFormState;
  setForm: React.Dispatch<React.SetStateAction<CourseFormState>>;
  onSubmit: () => void;
  submitLabel: string;
  submitDisabled: boolean;
  /** Editing opens with every step reachable; creating walks the steps in order. */
  mode?: "create" | "edit";
}) {
  const formId = useId();
  const [step, setStep] = useState(0);
  const [showStepError, setShowStepError] = useState(false);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const lastStep = COURSE_BUILDER_STEPS.length - 1;

  const stepErrors = useMemo(
    () => COURSE_BUILDER_STEPS.map((_, index) => validateCourseStep(form, index)),
    [form],
  );
  const currentError = stepErrors[step];
  const firstInvalidStep = stepErrors.findIndex(Boolean);
  const formComplete = firstInvalidStep === -1;

  const focusPanel = () => {
    requestAnimationFrame(() => panelRef.current?.focus({ preventScroll: false }));
  };

  const goTo = (target: number) => {
    if (target === step) return;
    // Moving forward needs every earlier step to be complete.
    if (target > step) {
      const blocking = stepErrors.slice(0, target).findIndex(Boolean);
      if (blocking !== -1) {
        setStep(blocking);
        setShowStepError(true);
        focusPanel();
        return;
      }
    }
    setShowStepError(false);
    setStep(target);
    focusPanel();
  };

  const canReach = (target: number) =>
    target <= step || mode === "edit" || stepErrors.slice(0, target).every((error) => !error);

  const handleSubmit = () => {
    if (!formComplete) {
      setStep(firstInvalidStep);
      setShowStepError(true);
      focusPanel();
      return;
    }
    onSubmit();
  };

  const handleProgramToggle = (program: CourseProgram) => {
    setForm((prev) => {
      const nextPrograms = toggleInArray(prev.availablePrograms, program);
      const nextStudyTypesByProgram: StudyTypesByProgram = {
        ...prev.studyTypesByProgram,
      };

      if (nextPrograms.includes(program)) {
        nextStudyTypesByProgram[program] =
          nextStudyTypesByProgram[program] || [];
      } else {
        delete nextStudyTypesByProgram[program];
      }

      const nextStudyTypes = getStudyTypesFromProgramMap(
        nextStudyTypesByProgram,
        nextPrograms,
      );
      return {
        ...prev,
        availablePrograms: nextPrograms,
        studyTypesByProgram: nextStudyTypesByProgram,
        availableStudyTypes: nextStudyTypes,
        locationConfig: normalizeCourseLocationConfig(
          prev.locationConfig,
          nextStudyTypes,
        ),
      };
    });
  };

  const handleStudyTypeToggle = (
    program: CourseProgram,
    studyType: StudyType,
  ) => {
    setForm((prev) => {
      const currentProgramTypes = prev.studyTypesByProgram[program] || [];
      const nextProgramTypes = toggleInArray(currentProgramTypes, studyType);
      const nextStudyTypesByProgram: StudyTypesByProgram = {
        ...prev.studyTypesByProgram,
        [program]: nextProgramTypes,
      };
      const nextStudyTypes = getStudyTypesFromProgramMap(
        nextStudyTypesByProgram,
        prev.availablePrograms,
      );
      const nextConfig = normalizeCourseLocationConfig(
        prev.locationConfig,
        nextStudyTypes,
      );

      if (nextProgramTypes.includes(studyType) && !nextConfig[studyType]) {
        nextConfig[studyType] = { scopes: [] };
      }

      return {
        ...prev,
        studyTypesByProgram: nextStudyTypesByProgram,
        availableStudyTypes: nextStudyTypes,
        locationConfig: nextConfig,
      };
    });
  };

  const handleScopeToggle = (studyType: StudyType, scope: LocationScope) => {
    setForm((prev) => {
      const prevStudy = prev.locationConfig[studyType] || { scopes: [] };
      const nextScopes = toggleInArray(prevStudy.scopes, scope);
      const nextStudy: StudyLocationConfig = {
        ...prevStudy,
        scopes: nextScopes,
      };

      // Clean up if scope removed
      if (!nextScopes.includes("بغداد")) {
        nextStudy.baghdadMode = undefined;
        nextStudy.baghdadSites = undefined;
      }
      if (!nextScopes.includes("محافظات")) {
        nextStudy.provinces = undefined;
      }

      if (nextScopes.includes("بغداد") && usesAutoGeneralBaghdad(studyType)) {
        nextStudy.baghdadMode = "عموم بغداد";
        nextStudy.baghdadSites = undefined;
      }

      if (nextScopes.includes("بغداد") && usesForcedCustomBaghdad(studyType)) {
        nextStudy.baghdadMode = "بغداد - مخصص";
        nextStudy.baghdadSites = nextStudy.baghdadSites || [];
      }

      return {
        ...prev,
        locationConfig: { ...prev.locationConfig, [studyType]: nextStudy },
      };
    });
  };

  const handleBaghdadSiteToggle = (studyType: StudyType, site: string) => {
    setForm((prev) => {
      const prevStudy = prev.locationConfig[studyType] || {
        scopes: [],
        baghdadMode: "بغداد - مخصص" as BaghdadMode,
      };
      const nextSites = toggleInArray(prevStudy.baghdadSites || [], site);
      return {
        ...prev,
        locationConfig: {
          ...prev.locationConfig,
          [studyType]: { ...prevStudy, baghdadSites: nextSites },
        },
      };
    });
  };

  const handleProvinceToggle = (studyType: StudyType, province: string) => {
    setForm((prev) => {
      const prevStudy = prev.locationConfig[studyType] || { scopes: [] };
      const nextProvinces = toggleInArray(prevStudy.provinces || [], province);
      return {
        ...prev,
        locationConfig: {
          ...prev.locationConfig,
          [studyType]: { ...prevStudy, provinces: nextProvinces },
        },
      };
    });
  };

  const handleSelectAllProvinces = (studyType: StudyType) => {
    setForm((prev) => {
      const prevStudy = prev.locationConfig[studyType] || { scopes: [] };
      const allSelected =
        (prevStudy.provinces || []).length === IRAQI_PROVINCES.length;
      return {
        ...prev,
        locationConfig: {
          ...prev.locationConfig,
          [studyType]: {
            ...prevStudy,
            provinces: allSelected ? [] : [...IRAQI_PROVINCES],
          },
        },
      };
    });
  };

  const programSelected = form.availablePrograms.length > 0;

  return (
    <div className="tp-course-builder" data-step={step}>
      <ol className="tp-course-builder__steps" aria-label="خطوات إعداد الدورة">
        {COURSE_BUILDER_STEPS.map((item, index) => {
          const state =
            index === step
              ? "current"
              : stepErrors[index]
                ? index < step || mode === "edit"
                  ? "incomplete"
                  : "todo"
                : "done";
          return (
            <li key={item.title}>
              <button
                type="button"
                className="tp-course-builder__step"
                data-state={state}
                aria-current={index === step ? "step" : undefined}
                disabled={!canReach(index)}
                onClick={() => goTo(index)}
              >
                <span className="tp-course-builder__step-number" aria-hidden="true">
                  {state === "done" ? <Check /> : index + 1}
                </span>
                <span className="tp-course-builder__step-text">
                  <b>{item.title}</b>
                  <small>{item.hint}</small>
                </span>
              </button>
            </li>
          );
        })}
      </ol>

      <div
        ref={panelRef}
        tabIndex={-1}
        className="tp-course-builder__panel"
        role="group"
        aria-labelledby={`${formId}-step-title`}
      >
        <h3 id={`${formId}-step-title`} className="tp-course-builder__panel-title">
          <span className="tp-course-builder__panel-count">
            الخطوة {step + 1} من {COURSE_BUILDER_STEPS.length}
          </span>
          {COURSE_BUILDER_STEPS[step].title}
        </h3>

        {step === 0 && (
          <section className="tp-course-builder__section" aria-label="بيانات الدورة">
            <div className="tp-course-builder__field">
              <Label htmlFor={`${formId}-name`}>اسم الدورة *</Label>
              <Input
                id={`${formId}-name`}
                name="courseName"
                autoComplete="off"
                value={form.name}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, name: e.target.value }))
                }
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    goTo(1);
                  }
                }}
                placeholder="مثال: أحياء السادس - دفعة جديدة"
              />
              <p className="tp-course-builder__hint">
                الاسم يظهر للموظف عند تسجيل الطلاب، وفي التقارير والامتحانات.
              </p>
            </div>
          </section>
        )}

        {step === 1 && (
          <>
            <fieldset className="tp-course-builder__section">
              <legend className="tp-course-builder__heading">
                <GraduationCap aria-hidden="true" />
                نظام الاشتراك
              </legend>
              <div className="tp-course-builder__choices tp-course-builder__choices--cards">
                {COURSE_PROGRAMS.map((program, programIndex) => (
                  <label
                    key={program}
                    htmlFor={`${formId}-program-${programIndex}`}
                    className="tp-course-builder__choice tp-course-builder__choice--card"
                    data-checked={form.availablePrograms.includes(program)}
                  >
                    <Checkbox
                      id={`${formId}-program-${programIndex}`}
                      name={`courseProgram-${programIndex}`}
                      checked={form.availablePrograms.includes(program)}
                      onCheckedChange={() => handleProgramToggle(program)}
                    />
                    <span>
                      <b>{program}</b>
                      <small>{PROGRAM_HINTS[program]}</small>
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>

            {programSelected ? (
              <section className="tp-course-builder__section" aria-labelledby={`${formId}-study-types`}>
                <h4 id={`${formId}-study-types`} className="tp-course-builder__heading">
                  <Monitor aria-hidden="true" />
                  نظام الدراسة لكل نظام اشتراك
                </h4>
                <div className="tp-course-builder__programs">
                  {form.availablePrograms.map((program) => {
                    const programIndex = COURSE_PROGRAMS.indexOf(program);
                    return (
                      <fieldset key={program} className="tp-course-builder__group">
                        <legend className="tp-course-builder__legend">مع «{program}»</legend>
                        <div className="tp-course-builder__choices tp-course-builder__choices--study">
                          {STUDY_TYPES.map((studyType, studyIndex) => (
                            <label
                              key={studyType}
                              htmlFor={`${formId}-study-${programIndex}-${studyIndex}`}
                              className="tp-course-builder__choice tp-course-builder__choice--card"
                              data-checked={(form.studyTypesByProgram[program] || []).includes(studyType)}
                            >
                              <Checkbox
                                id={`${formId}-study-${programIndex}-${studyIndex}`}
                                name={`studyType-${programIndex}-${studyIndex}`}
                                checked={(form.studyTypesByProgram[program] || []).includes(studyType)}
                                onCheckedChange={() => handleStudyTypeToggle(program, studyType)}
                              />
                              <span>
                                <b>{studyType}</b>
                                <small>{STUDY_TYPE_HINTS[studyType]}</small>
                              </span>
                            </label>
                          ))}
                        </div>
                      </fieldset>
                    );
                  })}
                </div>
              </section>
            ) : (
              <p className="tp-course-builder__placeholder">
                اختر نظام اشتراك واحداً على الأقل حتى تظهر أنظمة الدراسة.
              </p>
            )}
          </>
        )}

        {step === 2 && (
          <>
            {form.availableStudyTypes.length === 0 ? (
              <p className="tp-course-builder__placeholder">
                حدد نظام دراسة واحداً على الأقل في الخطوة السابقة حتى تظهر إعدادات المواقع.
              </p>
            ) : (
              <section className="tp-course-builder__section" aria-labelledby={`${formId}-locations`}>
                <h4 id={`${formId}-locations`} className="tp-course-builder__heading">
                  <MapPin aria-hidden="true" />
                  أين يدرس الطالب
                </h4>
                <div className="tp-course-builder__locations">
                  {form.availableStudyTypes.map((studyType) => {
                    const studyIndex = STUDY_TYPES.indexOf(studyType);
                    const studyConfig = form.locationConfig[studyType] || { scopes: [] };
                    const isAutoGeneralBaghdad = usesAutoGeneralBaghdad(studyType);
                    const hasBaghdad = studyConfig.scopes.includes("بغداد");
                    const hasProvinces = studyConfig.scopes.includes("محافظات");
                    return (
                      <fieldset key={studyType} className="tp-course-builder__group tp-course-builder__location-card">
                        <legend className="tp-course-builder__legend">مواقع «{studyType}»</legend>
                        <div className="tp-course-builder__location-body">
                          <div className="tp-course-builder__choices tp-course-builder__choices--study">
                            {LOCATION_SCOPES.map((scope, scopeIndex) => (
                              <label
                                key={scope}
                                htmlFor={`${formId}-scope-${studyIndex}-${scopeIndex}`}
                                className="tp-course-builder__choice"
                                data-checked={studyConfig.scopes.includes(scope)}
                              >
                                <Checkbox
                                  id={`${formId}-scope-${studyIndex}-${scopeIndex}`}
                                  name={`locationScope-${studyIndex}-${scopeIndex}`}
                                  checked={studyConfig.scopes.includes(scope)}
                                  onCheckedChange={() => handleScopeToggle(studyType, scope)}
                                />
                                <span>{scope}</span>
                              </label>
                            ))}
                          </div>

                          {hasBaghdad && isAutoGeneralBaghdad && (
                            <p className="tp-course-builder__note">
                              طلاب «{studyType}» داخل بغداد يُسجَّلون «عموم بغداد» تلقائياً، بدون اختيار موقع.
                            </p>
                          )}

                          {hasBaghdad && !isAutoGeneralBaghdad && (
                            <fieldset className="tp-course-builder__subgroup">
                              <legend className="tp-course-builder__legend">مواقع الحضور في بغداد *</legend>
                              <p className="tp-course-builder__hint">
                                يختار الموظف واحداً منها عند تسجيل طالب حضوري داخل بغداد.
                              </p>
                              <div className="tp-course-builder__choices tp-course-builder__choices--study">
                                {BAGHDAD_COURSE_SITES.map((site, siteIndex) => (
                                  <label
                                    key={site}
                                    htmlFor={`${formId}-site-${studyIndex}-${siteIndex}`}
                                    className="tp-course-builder__choice"
                                    data-checked={(studyConfig.baghdadSites || []).includes(site)}
                                  >
                                    <Checkbox
                                      id={`${formId}-site-${studyIndex}-${siteIndex}`}
                                      name={`baghdadSite-${studyIndex}-${siteIndex}`}
                                      checked={(studyConfig.baghdadSites || []).includes(site)}
                                      onCheckedChange={() => handleBaghdadSiteToggle(studyType, site)}
                                    />
                                    <span>{site}</span>
                                  </label>
                                ))}
                              </div>
                            </fieldset>
                          )}

                          {hasProvinces && (
                            <details
                              className="tp-course-builder__subgroup tp-course-builder__provinces"
                              open={(studyConfig.provinces || []).length !== IRAQI_PROVINCES.length}
                            >
                              <summary className="tp-course-builder__legend">
                                المحافظات المتاحة * ·{" "}
                                {(studyConfig.provinces || []).length === IRAQI_PROVINCES.length
                                  ? "كل المحافظات"
                                  : `${(studyConfig.provinces || []).length} من ${IRAQI_PROVINCES.length}`}
                              </summary>
                              <div className="tp-course-builder__select-all">
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  onClick={() => handleSelectAllProvinces(studyType)}
                                >
                                  {(studyConfig.provinces || []).length === IRAQI_PROVINCES.length
                                    ? "إلغاء الكل"
                                    : "اختيار الكل"}
                                </Button>
                              </div>
                              <div className="tp-course-builder__choices tp-course-builder__choices--provinces">
                                {IRAQI_PROVINCES.map((province, provinceIndex) => (
                                  <label
                                    key={province}
                                    htmlFor={`${formId}-province-${studyIndex}-${provinceIndex}`}
                                    className="tp-course-builder__choice"
                                    data-checked={(studyConfig.provinces || []).includes(province)}
                                  >
                                    <Checkbox
                                      id={`${formId}-province-${studyIndex}-${provinceIndex}`}
                                      name={`province-${studyIndex}-${provinceIndex}`}
                                      checked={(studyConfig.provinces || []).includes(province)}
                                      onCheckedChange={() => handleProvinceToggle(studyType, province)}
                                    />
                                    <span>{province}</span>
                                  </label>
                                ))}
                              </div>
                            </details>
                          )}
                        </div>
                      </fieldset>
                    );
                  })}
                </div>
              </section>
            )}

            <section className="tp-course-builder__section tp-course-builder__review" aria-labelledby={`${formId}-review`}>
              <h4 id={`${formId}-review`} className="tp-course-builder__heading">
                <ClipboardCheck aria-hidden="true" />
                ما يظهر للموظف عند تسجيل طالب في «{form.name.trim() || "الدورة الجديدة"}»
              </h4>
              <CourseRegistrationPreview form={form} />
            </section>
          </>
        )}

        {showStepError && currentError && (
          <p role="alert" className="tp-course-builder__error">
            <AlertCircle aria-hidden="true" />
            {currentError}
          </p>
        )}
      </div>

      <div className="tp-course-builder__nav">
        {step > 0 && (
          <Button type="button" variant="outline" onClick={() => goTo(step - 1)}>
            <ChevronRight aria-hidden="true" />
            السابق
          </Button>
        )}
        {step < lastStep ? (
          <Button type="button" className="tp-course-builder__next" onClick={() => goTo(step + 1)}>
            التالي: {COURSE_BUILDER_STEPS[step + 1].title}
            <ChevronLeft aria-hidden="true" />
          </Button>
        ) : (
          <Button
            type="button"
            onClick={handleSubmit}
            disabled={submitDisabled}
            className="tp-course-builder__submit"
          >
            {submitDisabled ? "جاري الحفظ..." : submitLabel}
          </Button>
        )}
      </div>
    </div>
  );
}
