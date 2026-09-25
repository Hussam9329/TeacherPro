"use client";

import React, { useId, useMemo } from "react";
import {
  COURSE_PROGRAMS,
  STUDY_TYPES,
  LOCATION_SCOPES,
  BAGHDAD_MODES,
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
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Settings, MapPin, GraduationCap, Monitor } from "lucide-react";
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

export function validateCourseForm(form: CourseFormState): string | null {
  if (!form.name.trim()) return "يرجى إدخال اسم الدورة";
  if (form.availablePrograms.length === 0)
    return "يجب اختيار نوع دورة واحد على الأقل";

  for (const program of form.availablePrograms) {
    if ((form.studyTypesByProgram[program] || []).length === 0) {
      return `يجب اختيار نوع دراسة واحد على الأقل لنوع الدورة "${program}"`;
    }
  }

  for (const studyType of form.availableStudyTypes) {
    const config = form.locationConfig[studyType];
    if (!config || config.scopes.length === 0) {
      return `يجب تحديد إعدادات المواقع لنوع البرنامج "${studyType}"`;
    }
    if (config.scopes.includes("بغداد") && !config.baghdadMode) {
      return `يجب اختيار نوع بغداد لنوع البرنامج "${studyType}"`;
    }
    if (
      config.baghdadMode === "بغداد - مخصص" &&
      (!config.baghdadSites || config.baghdadSites.length === 0)
    ) {
      return `يجب اختيار موقع واحد على الأقل من مواقع بغداد لنوع البرنامج "${studyType}"`;
    }
    if (
      config.scopes.includes("محافظات") &&
      (!config.provinces || config.provinces.length === 0)
    ) {
      return `يجب اختيار محافظة واحدة على الأقل لنوع البرنامج "${studyType}"`;
    }
  }

  return null;
}

function formatListSummary(
  values: string[],
  emptyText = "لا توجد خيارات محددة",
): string {
  if (values.length === 0) return emptyText;
  if (values.length <= 4) return values.join("، ");
  return `${values.slice(0, 4).join("، ")}، +${values.length - 4}`;
}

function buildCourseFormSummary(form: CourseFormState) {
  const courseName = form.name.trim() || "الدورة الجديدة";
  const normalizedLocationConfig = normalizeCourseLocationConfig(
    form.locationConfig,
    form.availableStudyTypes,
  );
  const programLines = form.availablePrograms.map((program) => {
    const studyTypes = form.studyTypesByProgram[program] || [];
    return `${program}: ${formatListSummary(studyTypes, "لم يتم اختيار نوع دراسة")}`;
  });
  const locationLines = form.availableStudyTypes.map((studyType) => {
    const rawConfig = normalizedLocationConfig[studyType] || { scopes: [] };
    const config = normalizeStudyLocationConfig(studyType, rawConfig);
    const parts: string[] = [];

    if (config.scopes.includes("بغداد")) {
      if (config.baghdadMode === "عموم بغداد") {
        parts.push("عموم بغداد");
      } else if (config.baghdadMode === "بغداد - مخصص") {
        parts.push(
          `بغداد - مخصص: ${formatListSummary(config.baghdadSites || [], "لم تحدد مواقع بغداد بعد")}`,
        );
      } else {
        parts.push("بغداد");
      }
    }
    if (config.scopes.includes("محافظات")) {
      parts.push(
        `محافظات: ${formatListSummary(config.provinces || [], "لم تحدد المحافظات بعد")}`,
      );
    }

    return `${studyType}: ${parts.length > 0 ? parts.join("، ") : "لم تحدد المواقع بعد"}`;
  });

  return {
    courseName,
    programCount: form.availablePrograms.length,
    studyTypeCount: form.availableStudyTypes.length,
    programLines,
    locationLines,
  };
}

export function CourseBuilderForm({
  form,
  setForm,
  onSubmit,
  submitLabel,
  submitDisabled,
}: {
  form: CourseFormState;
  setForm: React.Dispatch<React.SetStateAction<CourseFormState>>;
  onSubmit: () => void;
  submitLabel: string;
  submitDisabled: boolean;
}) {
  const formId = useId();
  const summary = useMemo(() => buildCourseFormSummary(form), [form]);

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

  const handleBaghdadModeChange = (studyType: StudyType, mode: BaghdadMode) => {
    if (usesForcedCustomBaghdad(studyType) && mode !== "بغداد - مخصص") return;
    setForm((prev) => {
      const prevStudy = prev.locationConfig[studyType] || { scopes: [] };
      const nextStudy: StudyLocationConfig = {
        ...prevStudy,
        baghdadMode: mode,
        baghdadSites:
          mode === "بغداد - مخصص" ? prevStudy.baghdadSites || [] : undefined,
      };
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

  return (
    <div className="tp-course-builder">
      <section
        className="tp-course-builder__section"
        aria-labelledby={`${formId}-basics`}
      >
        <h3 id={`${formId}-basics`} className="tp-course-builder__heading">
          <Settings aria-hidden="true" />
          بيانات الدورة
        </h3>
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
            placeholder="مثال: أحياء السادس - دفعة جديدة"
          />
        </div>
      </section>

      <fieldset className="tp-course-builder__section">
        <legend className="tp-course-builder__heading">
          <GraduationCap aria-hidden="true" />
          نوع الدورة
        </legend>
        <div className="tp-course-builder__choices">
          {COURSE_PROGRAMS.map((program, programIndex) => (
            <label
              key={program}
              htmlFor={`${formId}-program-${programIndex}`}
              className="tp-course-builder__choice"
              data-checked={form.availablePrograms.includes(program)}
            >
              <Checkbox
                id={`${formId}-program-${programIndex}`}
                name={`courseProgram-${programIndex}`}
                checked={form.availablePrograms.includes(program)}
                onCheckedChange={() => handleProgramToggle(program)}
              />
              <span>{program}</span>
            </label>
          ))}
        </div>
      </fieldset>

      {form.availablePrograms.length > 0 && (
        <section
          className="tp-course-builder__section"
          aria-labelledby={`${formId}-study-types`}
        >
          <h3
            id={`${formId}-study-types`}
            className="tp-course-builder__heading"
          >
            <Monitor aria-hidden="true" />
            نوع البرنامج
          </h3>
          <div className="tp-course-builder__programs">
            {form.availablePrograms.map((program, programIndex) => (
              <fieldset key={program} className="tp-course-builder__group">
                <legend className="tp-course-builder__legend">{program}</legend>
                <div className="tp-course-builder__choices tp-course-builder__choices--study">
                  {STUDY_TYPES.map((studyType, studyIndex) => (
                    <label
                      key={studyType}
                      htmlFor={`${formId}-study-${programIndex}-${studyIndex}`}
                      className="tp-course-builder__choice"
                      data-checked={(
                        form.studyTypesByProgram[program] || []
                      ).includes(studyType)}
                    >
                      <Checkbox
                        id={`${formId}-study-${programIndex}-${studyIndex}`}
                        name={`studyType-${programIndex}-${studyIndex}`}
                        checked={(
                          form.studyTypesByProgram[program] || []
                        ).includes(studyType)}
                        onCheckedChange={() =>
                          handleStudyTypeToggle(program, studyType)
                        }
                      />
                      <span>{studyType}</span>
                    </label>
                  ))}
                </div>
              </fieldset>
            ))}
          </div>
        </section>
      )}

      {form.availableStudyTypes.length > 0 && (
        <section
          className="tp-course-builder__section"
          aria-labelledby={`${formId}-locations`}
        >
          <h3 id={`${formId}-locations`} className="tp-course-builder__heading">
            <MapPin aria-hidden="true" />
            مواقع الدراسة
          </h3>
          <div className="tp-course-builder__locations">
            {form.availableStudyTypes.map((studyType, studyIndex) => {
              const studyConfig = form.locationConfig[studyType] || {
                scopes: [],
              };
              const isAutoGeneralBaghdad = usesAutoGeneralBaghdad(studyType);
              const isForcedCustomBaghdad = usesForcedCustomBaghdad(studyType);
              return (
                <fieldset key={studyType} className="tp-course-builder__group">
                  <legend className="tp-course-builder__legend">
                    {studyType}
                  </legend>
                  <div className="tp-course-builder__location-body">
                    <div className="tp-course-builder__choices">
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
                            onCheckedChange={() =>
                              handleScopeToggle(studyType, scope)
                            }
                          />
                          <span>{scope}</span>
                        </label>
                      ))}
                    </div>

                    {studyConfig.scopes.includes("بغداد") &&
                      !isAutoGeneralBaghdad && (
                        <fieldset className="tp-course-builder__subgroup">
                          <legend
                            id={`${formId}-baghdad-${studyIndex}`}
                            className="tp-course-builder__legend"
                          >
                            بغداد
                          </legend>
                          <RadioGroup
                            aria-labelledby={`${formId}-baghdad-${studyIndex}`}
                            name={`${formId}-baghdad-mode-${studyIndex}`}
                            value={
                              isForcedCustomBaghdad
                                ? "بغداد - مخصص"
                                : studyConfig.baghdadMode || ""
                            }
                            onValueChange={(value) =>
                              handleBaghdadModeChange(
                                studyType,
                                value as BaghdadMode,
                              )
                            }
                            className="tp-course-builder__choices"
                          >
                            {BAGHDAD_MODES.map((mode, modeIndex) => {
                              const disabled =
                                isForcedCustomBaghdad && mode === "عموم بغداد";
                              return (
                                <label
                                  key={mode}
                                  htmlFor={`${formId}-mode-${studyIndex}-${modeIndex}`}
                                  className="tp-course-builder__choice"
                                  data-disabled={disabled}
                                  data-checked={
                                    (isForcedCustomBaghdad
                                      ? "بغداد - مخصص"
                                      : studyConfig.baghdadMode) === mode
                                  }
                                >
                                  <RadioGroupItem
                                    id={`${formId}-mode-${studyIndex}-${modeIndex}`}
                                    value={mode}
                                    disabled={disabled}
                                  />
                                  <span>{mode}</span>
                                </label>
                              );
                            })}
                          </RadioGroup>
                          {(isForcedCustomBaghdad ||
                            studyConfig.baghdadMode === "بغداد - مخصص") && (
                            <fieldset className="tp-course-builder__sites">
                              <legend className="tp-course-builder__legend">
                                مواقع بغداد
                              </legend>
                              <div className="tp-course-builder__choices tp-course-builder__choices--study">
                                {BAGHDAD_COURSE_SITES.map((site, siteIndex) => (
                                  <label
                                    key={site}
                                    htmlFor={`${formId}-site-${studyIndex}-${siteIndex}`}
                                    className="tp-course-builder__choice"
                                    data-checked={(
                                      studyConfig.baghdadSites || []
                                    ).includes(site)}
                                  >
                                    <Checkbox
                                      id={`${formId}-site-${studyIndex}-${siteIndex}`}
                                      name={`baghdadSite-${studyIndex}-${siteIndex}`}
                                      checked={(
                                        studyConfig.baghdadSites || []
                                      ).includes(site)}
                                      onCheckedChange={() =>
                                        handleBaghdadSiteToggle(studyType, site)
                                      }
                                    />
                                    <span>{site}</span>
                                  </label>
                                ))}
                              </div>
                            </fieldset>
                          )}
                        </fieldset>
                      )}

                    {studyConfig.scopes.includes("محافظات") && (
                      <fieldset className="tp-course-builder__subgroup">
                        <legend className="tp-course-builder__legend">
                          المحافظات
                        </legend>
                        <div className="tp-course-builder__select-all">
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => handleSelectAllProvinces(studyType)}
                          >
                            {(studyConfig.provinces || []).length ===
                            IRAQI_PROVINCES.length
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
                              data-checked={(
                                studyConfig.provinces || []
                              ).includes(province)}
                            >
                              <Checkbox
                                id={`${formId}-province-${studyIndex}-${provinceIndex}`}
                                name={`province-${studyIndex}-${provinceIndex}`}
                                checked={(studyConfig.provinces || []).includes(
                                  province,
                                )}
                                onCheckedChange={() =>
                                  handleProvinceToggle(studyType, province)
                                }
                              />
                              <span>{province}</span>
                            </label>
                          ))}
                        </div>
                      </fieldset>
                    )}
                  </div>
                </fieldset>
              );
            })}
          </div>
        </section>
      )}

      <details className="tp-course-builder__summary">
        <summary>ملخص قبل الحفظ</summary>
        <div className="tp-course-builder__summary-content">
          <p className="tp-course-builder__summary-name">
            {summary.courseName}
          </p>
          <p className="tp-course-builder__summary-counts">
            أنواع الدورة: {summary.programCount} · أنواع الدراسة:{" "}
            {summary.studyTypeCount}
          </p>
          <div className="tp-course-builder__summary-columns">
            <div>
              <h4>خيارات التسجيل</h4>
              {summary.programLines.length > 0 ? (
                <ul>
                  {summary.programLines.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              ) : (
                <p>لم تُحدد بعد</p>
              )}
            </div>
            <div>
              <h4>المواقع</h4>
              {summary.locationLines.length > 0 ? (
                <ul>
                  {summary.locationLines.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              ) : (
                <p>لم تُحدد بعد</p>
              )}
            </div>
          </div>
        </div>
      </details>

      <Button
        type="button"
        onClick={onSubmit}
        disabled={
          submitDisabled ||
          !form.name.trim() ||
          form.availablePrograms.length === 0 ||
          form.availableStudyTypes.length === 0
        }
        className="tp-course-builder__submit"
      >
        {submitDisabled ? "جاري الحفظ..." : submitLabel}
      </Button>
    </div>
  );
}
