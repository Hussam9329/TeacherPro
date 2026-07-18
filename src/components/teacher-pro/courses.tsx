"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useTeacherStore, type Course } from "@/lib/teacher-store";
import {
  courseApi,
  type CourseOverviewResponse,
  type CourseStudentSyncPreview,
} from "@/lib/api";
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
  getAvailablePrograms,
  getAvailableStudyTypes,
  getCourseLocationConfig,
  getStudyTypesByProgram,
} from "@/lib/course-config";
import { BAGHDAD_COURSE_SITES, IRAQI_PROVINCES } from "@/lib/iraq";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Separator } from "@/components/ui/separator";
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
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { toast } from "@/lib/user-toast";
import { useActionLock } from "@/hooks/use-action-lock";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import {
  useTeacherProBackgroundSyncDetector,
  useTeacherProSyncKey,
} from "@/hooks/use-teacherpro-sync";
import { emitTeacherProDataChanged } from "@/lib/teacherpro-sync";
import {
  BookOpen,
  Settings,
  MapPin,
  GraduationCap,
  Monitor,
  Building,
} from "lucide-react";
import { EmptyState } from "./ui-kit";
import { formatAppDate } from "@/lib/format";

// ─── Types ────────────────────────────────────────────────────────────────────

type CourseFormState = {
  name: string;
  availablePrograms: CourseProgram[];
  availableStudyTypes: StudyType[];
  studyTypesByProgram: StudyTypesByProgram;
  locationConfig: CourseLocationConfig;
};

type CourseOverviewRow = NonNullable<CourseOverviewResponse["rows"]>[number] & {
  course: Course;
};

type CourseStatusFilter = "all" | "active" | "inactive";
type CourseDeleteFilter = "all" | "deletable" | "blocked";

const courseStatusFilterLabels: Record<CourseStatusFilter, string> = {
  all: "كل الدورات",
  active: "نشطة للتسجيل",
  inactive: "موقوفة عن التسجيل",
};

const courseDeleteFilterLabels: Record<CourseDeleteFilter, string> = {
  all: "كل حالات الحذف",
  deletable: "قابلة للحذف",
  blocked: "محمية من الحذف",
};

function emptyCourseForm(): CourseFormState {
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

function normalizeStudyLocationConfig(
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

function normalizeCourseLocationConfig(
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

function validateCourseForm(form: CourseFormState): string | null {
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

/** Generate a human-readable location summary for a course */
function buildLocationSummary(course: Course): string {
  const config = getCourseLocationConfig(course);
  const studyTypes = getAvailableStudyTypes(course);
  const parts: string[] = [];

  for (const st of studyTypes) {
    const rawConfig = config[st as StudyType];
    if (!rawConfig) continue;
    const sc = normalizeStudyLocationConfig(st as StudyType, rawConfig);
    const segments: string[] = [];
    if (sc.scopes.includes("بغداد")) {
      if (sc.baghdadMode === "عموم بغداد") {
        segments.push("عموم بغداد");
      } else if (
        sc.baghdadMode === "بغداد - مخصص" &&
        sc.baghdadSites &&
        sc.baghdadSites.length > 0
      ) {
        segments.push(`بغداد-مخصص(${sc.baghdadSites.join("، ")})`);
      } else {
        segments.push("بغداد");
      }
    }
    if (sc.scopes.includes("محافظات")) {
      segments.push(
        sc.provinces && sc.provinces.length > 0
          ? `محافظات(${sc.provinces.join("، ")})`
          : "محافظات(غير محددة)",
      );
    }
    if (segments.length > 0) {
      parts.push(`${st}: ${segments.join("، ")}`);
    }
  }

  return parts.join(" | ");
}

// ─── Course Builder Form ─────────────────────────────────────────────────────

function CourseBuilderForm({
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
    <div className="space-y-6">
      {/* بيانات أساسية */}
      <div className="space-y-4">
        <div className="flex items-center gap-2 text-sm font-bold text-foreground">
          <Settings className="size-4 text-primary" />
          <span>بيانات أساسية</span>
        </div>
        <div className="space-y-2">
          <Label htmlFor="courseName">اسم الدورة *</Label>
          <Input
            id="courseName"
            autoComplete="off"
            value={form.name}
            onChange={(e) =>
              setForm((prev) => ({ ...prev, name: e.target.value }))
            }
            placeholder="مثال: أحياء السادس - دفعة جديدة"
          />
        </div>
      </div>

      <Separator />

      {/* نوع الدورة */}
      <div className="space-y-3">
        <div className="flex items-center gap-2 text-sm font-bold text-foreground">
          <GraduationCap className="size-4 text-primary" />
          <span>نوع الدورة</span>
        </div>
        <div className="flex flex-wrap gap-4">
          {COURSE_PROGRAMS.map((program) => (
            <label
              key={program}
              className="flex items-center gap-2 cursor-pointer"
            >
              <Checkbox
                checked={form.availablePrograms.includes(program)}
                onCheckedChange={() => handleProgramToggle(program)}
              />
              <span className="text-sm">{program}</span>
            </label>
          ))}
        </div>
      </div>

      {form.availablePrograms.length > 0 && (
        <>
          <Separator />

          {/* نوع البرنامج حسب نوع الدورة */}
          <div className="space-y-4">
            <div className="flex items-center gap-2 text-sm font-bold text-foreground">
              <Monitor className="size-4 text-primary" />
              <span>نوع البرنامج لكل نوع دورة</span>
            </div>
            {form.availablePrograms.map((program) => (
              <Card key={program} className="border-dashed bg-muted/20">
                <CardHeader className="pb-3 pt-4 px-4">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <GraduationCap className="size-4 text-muted-foreground" />
                    {program}
                  </CardTitle>
                </CardHeader>
                <CardContent className="px-4 pb-4">
                  <div className="flex flex-wrap gap-4">
                    {STUDY_TYPES.map((st) => (
                      <label
                        key={`${program}-${st}`}
                        className="flex items-center gap-2 cursor-pointer"
                      >
                        <Checkbox
                          checked={(
                            form.studyTypesByProgram[program] || []
                          ).includes(st)}
                          onCheckedChange={() =>
                            handleStudyTypeToggle(program, st)
                          }
                        />
                        <span className="text-sm">{st}</span>
                      </label>
                    ))}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </>
      )}

      {/* إعداد المواقع لكل نوع دراسة */}
      {form.availableStudyTypes.length > 0 && (
        <>
          <Separator />
          <div className="space-y-4">
            <div className="flex items-center gap-2 text-sm font-bold text-foreground">
              <MapPin className="size-4 text-primary" />
              <span>إعداد المواقع لكل نوع دراسة مستخدم</span>
            </div>
            {form.availableStudyTypes.map((studyType) => {
              const studyConfig = form.locationConfig[studyType] || {
                scopes: [],
              };
              const isAutoGeneralBaghdad = usesAutoGeneralBaghdad(studyType);
              const isForcedCustomBaghdad = usesForcedCustomBaghdad(studyType);
              return (
                <Card key={studyType} className="border-dashed">
                  <CardHeader className="pb-3 pt-4 px-4">
                    <CardTitle className="text-sm flex items-center gap-2">
                      <Building className="size-4 text-muted-foreground" />
                      {studyType}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="px-4 pb-4 space-y-4">
                    {/* Scopes */}
                    <div className="flex flex-wrap gap-4">
                      {LOCATION_SCOPES.map((scope) => (
                        <label
                          key={scope}
                          className="flex items-center gap-2 cursor-pointer"
                        >
                          <Checkbox
                            checked={studyConfig.scopes.includes(scope)}
                            onCheckedChange={() =>
                              handleScopeToggle(studyType, scope)
                            }
                          />
                          <span className="text-sm">{scope}</span>
                        </label>
                      ))}
                    </div>

                    {/* Baghdad options */}
                    {studyConfig.scopes.includes("بغداد") &&
                      !isAutoGeneralBaghdad && (
                        <div className="space-y-3 rounded-lg border bg-muted/30 p-3">
                          <RadioGroup
                            value={
                              isForcedCustomBaghdad
                                ? "بغداد - مخصص"
                                : studyConfig.baghdadMode || ""
                            }
                            onValueChange={(v) =>
                              handleBaghdadModeChange(
                                studyType,
                                v as BaghdadMode,
                              )
                            }
                            className="flex flex-wrap gap-4"
                          >
                            {BAGHDAD_MODES.map((mode) => {
                              const disabled =
                                isForcedCustomBaghdad && mode === "عموم بغداد";
                              return (
                                <label
                                  key={mode}
                                  className={`flex items-center gap-2 ${disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer"}`}
                                >
                                  <RadioGroupItem
                                    value={mode}
                                    disabled={disabled}
                                  />
                                  <span className="text-sm">{mode}</span>
                                </label>
                              );
                            })}
                          </RadioGroup>

                          {/* Baghdad sites */}
                          {(isForcedCustomBaghdad ||
                            studyConfig.baghdadMode === "بغداد - مخصص") && (
                            <div className="flex flex-wrap gap-3 pt-1">
                              {BAGHDAD_COURSE_SITES.map((site) => (
                                <label
                                  key={site}
                                  className="flex items-center gap-2 cursor-pointer"
                                >
                                  <Checkbox
                                    checked={(
                                      studyConfig.baghdadSites || []
                                    ).includes(site)}
                                    onCheckedChange={() =>
                                      handleBaghdadSiteToggle(studyType, site)
                                    }
                                  />
                                  <span className="text-sm">{site}</span>
                                </label>
                              ))}
                            </div>
                          )}
                        </div>
                      )}

                    {/* Provinces */}
                    {studyConfig.scopes.includes("محافظات") && (
                      <div className="space-y-3 rounded-lg border bg-muted/30 p-3">
                        <div className="flex items-center justify-between">
                          <span className="text-sm font-medium">المحافظات</span>
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
                        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
                          {IRAQI_PROVINCES.map((province) => (
                            <label
                              key={province}
                              className="flex items-center gap-2 cursor-pointer"
                            >
                              <Checkbox
                                checked={(studyConfig.provinces || []).includes(
                                  province,
                                )}
                                onCheckedChange={() =>
                                  handleProvinceToggle(studyType, province)
                                }
                              />
                              <span className="text-sm">{province}</span>
                            </label>
                          ))}
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </>
      )}

      <Separator />

      <Card className="border-primary/20 bg-primary/5 shadow-none">
        <CardHeader className="pb-3 pt-4 px-4">
          <CardTitle className="text-sm flex items-center gap-2">
            <BookOpen className="size-4 text-primary" />
            ملخص قبل الحفظ
          </CardTitle>
        </CardHeader>
        <CardContent className="px-4 pb-4 text-sm leading-7 space-y-3">
          <p className="font-medium text-foreground">
            هذه الدورة تحتوي على {summary.programCount} نوع دورة و{" "}
            {summary.studyTypeCount} نوع دراسة.
          </p>
          <div className="rounded-xl border bg-background/70 p-3">
            <p className="mb-1 font-semibold text-foreground">
              ستظهر للطلاب بهذه الخيارات:
            </p>
            {summary.programLines.length > 0 ? (
              <ul className="list-disc space-y-1 pr-5 text-muted-foreground">
                {summary.programLines.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            ) : (
              <p className="text-muted-foreground">
                اختر نوع دورة واحد على الأقل حتى تظهر خيارات التسجيل للطلاب.
              </p>
            )}
          </div>
          <div className="rounded-xl border bg-background/70 p-3">
            <p className="mb-1 font-semibold text-foreground">
              هذه المواقع مفعلة:
            </p>
            {summary.locationLines.length > 0 ? (
              <ul className="list-disc space-y-1 pr-5 text-muted-foreground">
                {summary.locationLines.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            ) : (
              <p className="text-muted-foreground">
                بعد اختيار نوع البرنامج ستظهر هنا المواقع التي ستكون مفعلة في
                التسجيل.
              </p>
            )}
          </div>
        </CardContent>
      </Card>

      <Separator />

      {/* Submit */}
      <Button
        onClick={onSubmit}
        disabled={
          submitDisabled ||
          !form.name.trim() ||
          form.availablePrograms.length === 0 ||
          form.availableStudyTypes.length === 0
        }
        className="w-full"
      >
        {submitDisabled ? "جاري الحفظ..." : submitLabel}
      </Button>
    </div>
  );
}

// ─── Main Component ──────────────────────────────────────────────────────────

function normalizeCourseFromApi(course: Record<string, unknown>): Course {
  return {
    id: String(course.id || ""),
    name: String(course.name || ""),
    createdAt: course.createdAt ? String(course.createdAt).slice(0, 10) : "",
    active: course.active !== undefined ? Boolean(course.active) : true,
    availablePrograms: getAvailablePrograms(course) as CourseProgram[],
    availableStudyTypes: getAvailableStudyTypes(course) as StudyType[],
    studyTypesByProgram: getStudyTypesByProgram(course),
    locationConfig: normalizeCourseLocationConfig(
      JSON.parse(JSON.stringify(getCourseLocationConfig(course))),
      getAvailableStudyTypes(course) as StudyType[],
    ),
  };
}

function normalizeOverviewRows(
  rows: CourseOverviewResponse["rows"] = [],
): CourseOverviewRow[] {
  return rows.map((row) => ({
    ...row,
    course: normalizeCourseFromApi(row.course),
  })) as CourseOverviewRow[];
}

function courseFormToPayload(form: CourseFormState) {
  return {
    name: form.name.trim(),
    availablePrograms: form.availablePrograms,
    availableStudyTypes: form.availableStudyTypes,
    studyTypesByProgram: form.studyTypesByProgram,
    locationConfig: normalizeCourseLocationConfig(
      form.locationConfig,
      form.availableStudyTypes,
    ),
  };
}

function courseToForm(course: Course): CourseFormState {
  const studyTypes = getAvailableStudyTypes(course) as StudyType[];
  return {
    name: course.name,
    availablePrograms: getAvailablePrograms(course) as CourseProgram[],
    availableStudyTypes: studyTypes,
    studyTypesByProgram: getStudyTypesByProgram(course),
    locationConfig: normalizeCourseLocationConfig(
      JSON.parse(JSON.stringify(getCourseLocationConfig(course))),
      studyTypes,
    ),
  };
}

function topUsageItems(record: Record<string, number>, limit = 4): string[] {
  return Object.entries(record || {})
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([label, count]) => `${label}: ${count}`);
}

function courseDeleteBadge(row: CourseOverviewRow) {
  return row.deleteSafety.canDelete ? "آمنة للحذف" : "الحذف محمي";
}

export function CoursesView() {
  const { loadSectionDataFromServer } = useTeacherStore();
  const syncKey = useTeacherProSyncKey([
    "courses",
    "chapters",
    "students",
    "exams",
  ]);
  const isBackgroundSync = useTeacherProBackgroundSyncDetector(syncKey);

  const [rows, setRows] = useState<CourseOverviewRow[]>([]);
  const [stats, setStats] = useState<CourseOverviewResponse["stats"] | null>(
    null,
  );
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [searchText, setSearchText] = useState("");
  const debouncedSearchText = useDebouncedValue(searchText, 250);
  const [statusFilter, setStatusFilter] = useState<CourseStatusFilter>("all");
  const [deleteFilter, setDeleteFilter] = useState<CourseDeleteFilter>("all");

  // Create form
  const [createForm, setCreateForm] =
    useState<CourseFormState>(emptyCourseForm);

  // Edit dialog
  const [editDialog, setEditDialog] = useState<{
    open: boolean;
    courseId: string;
    form: CourseFormState;
    row: CourseOverviewRow | null;
  }>({ open: false, courseId: "", form: emptyCourseForm(), row: null });

  const [courseSyncDialog, setCourseSyncDialog] = useState<{
    open: boolean;
    courseId: string;
    payload: Record<string, unknown> | null;
    preview: CourseStudentSyncPreview | null;
  }>({ open: false, courseId: "", payload: null, preview: null });

  // Delete dialog
  const [deleteDialog, setDeleteDialog] = useState<{
    open: boolean;
    id: string;
    courseName: string;
    confirmText: string;
    row: CourseOverviewRow | null;
  }>({ open: false, id: "", courseName: "", confirmText: "", row: null });

  // Action locks
  const { locked: isAddingCourse, runLocked: runAddCourseLocked } =
    useActionLock();
  const { locked: isSavingCourse, runLocked: runSaveCourseLocked } =
    useActionLock();
  const { locked: isApplyingCourseSync, runLocked: runApplyCourseSyncLocked } =
    useActionLock();
  const { locked: isDeletingCourse, runLocked: runDeleteCourseLocked } =
    useActionLock();
  const { locked: isTogglingCourse, runLocked: runToggleCourseLocked } =
    useActionLock();

  const refreshOverview = useCallback(
    async (signal?: AbortSignal, options: { silent?: boolean } = {}) => {
      if (!options.silent) setIsLoading(true);
      if (!options.silent) setLoadError("");
      const data = await courseApi.overview({ signal, quietAbort: true });
      if (!data) {
        if (!signal?.aborted && !options.silent) {
          setLoadError("تعذر تحميل ملخص الدورات من بيانات النظام.");
          setIsLoading(false);
        }
        return;
      }
      if (signal?.aborted) return;
      setRows(normalizeOverviewRows(data.rows));
      setStats(data.stats);
      setIsLoading(false);
    },
    [],
  );

  useEffect(() => {
    const controller = new AbortController();
    void refreshOverview(controller.signal, { silent: isBackgroundSync() });
    return () => controller.abort();
  }, [refreshOverview, syncKey, isBackgroundSync]);

  const syncCoursesAfterMutation = useCallback(
    async (reason: string) => {
      await refreshOverview(undefined, { silent: true });
      void loadSectionDataFromServer("courses");
      emitTeacherProDataChanged({
        source: "local-mutation",
        reason,
        scopes: ["courses", "students", "exams", "dashboard"],
      });
    },
    [loadSectionDataFromServer, refreshOverview],
  );

  const filteredRows = useMemo(() => {
    const q = debouncedSearchText.trim().toLowerCase();
    return rows.filter((row) => {
      if (statusFilter === "active" && !row.course.active) return false;
      if (statusFilter === "inactive" && row.course.active) return false;
      if (deleteFilter === "deletable" && !row.deleteSafety.canDelete)
        return false;
      if (deleteFilter === "blocked" && row.deleteSafety.canDelete)
        return false;
      if (!q) return true;
      const haystack = [
        row.course.name,
        ...row.course.availablePrograms,
        ...row.course.availableStudyTypes,
        buildLocationSummary(row.course),
        row.activeChapter?.name || "",
        ...row.deleteSafety.blockers,
        ...row.configWarnings,
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [debouncedSearchText, deleteFilter, rows, statusFilter]);

  const filteredStats = useMemo(
    () => ({
      total: filteredRows.length,
      active: filteredRows.filter((row) => row.course.active).length,
      inactive: filteredRows.filter((row) => !row.course.active).length,
      deletable: filteredRows.filter((row) => row.deleteSafety.canDelete)
        .length,
      blocked: filteredRows.filter((row) => !row.deleteSafety.canDelete).length,
    }),
    [filteredRows],
  );

  const hasActiveFilters =
    Boolean(debouncedSearchText.trim()) ||
    statusFilter !== "all" ||
    deleteFilter !== "all";

  // ─── Create course handler ─────────────────────────────────────────────────
  const handleCreate = runAddCourseLocked(async () => {
    const validationMessage = validateCourseForm(createForm);
    if (validationMessage) {
      toast.error(validationMessage);
      return;
    }
    const payload = courseFormToPayload(createForm);
    const result = await courseApi.add(
      payload as unknown as Record<string, unknown>,
    );
    if (!result.ok) {
      toast.error(result.error || "تعذر إضافة الدورة");
      return;
    }
    setCreateForm(emptyCourseForm());
    setShowCreateForm(false);
    toast.success("تمت إضافة الدورة من بيانات النظام");
    await syncCoursesAfterMutation("إضافة دورة");
  });

  // ─── Edit handlers ─────────────────────────────────────────────────────────
  const openEditDialog = (row: CourseOverviewRow) => {
    setEditDialog({
      open: true,
      courseId: row.course.id,
      form: courseToForm(row.course),
      row,
    });
  };

  const applyCourseUpdate = async (
    courseId: string,
    payload: Record<string, unknown>,
    syncStudentSnapshots: boolean,
  ) => {
    const result = await courseApi.update(courseId, {
      ...payload,
      syncStudentSnapshots,
    });
    if (!result.ok) {
      toast.error(result.error || "تعذر تعديل الدورة");
      return false;
    }
    const impact = (
      result.data as {
        studentConfigImpact?: {
          affectedStudents?: number;
          syncedStudents?: number;
          message?: string;
        } | null;
      } | null
    )?.studentConfigImpact;
    setCourseSyncDialog({
      open: false,
      courseId: "",
      payload: null,
      preview: null,
    });
    setEditDialog({
      open: false,
      courseId: "",
      form: emptyCourseForm(),
      row: null,
    });
    toast.success(impact?.message || "تم تعديل الدورة بعد التحقق من الحفظ");
    await syncCoursesAfterMutation(
      syncStudentSnapshots ? "تعديل ومزامنة إعدادات دورة" : "تعديل دورة",
    );
    return true;
  };

  const handleEditSave = runSaveCourseLocked(async () => {
    const validationMessage = validateCourseForm(editDialog.form);
    if (validationMessage) {
      toast.error(validationMessage);
      return;
    }
    const payload = courseFormToPayload(editDialog.form) as unknown as Record<
      string,
      unknown
    >;
    const result = await courseApi.previewUpdate(editDialog.courseId, payload);
    if (!result.ok) {
      toast.error(result.error || "تعذر معاينة أثر تعديل الدورة");
      return;
    }
    const preview = (
      result.data as { preview?: CourseStudentSyncPreview } | null
    )?.preview;
    if (!preview) {
      toast.error(
        "لم يُرجع النظام معاينة موثوقة لأثر التعديل، لذلك لم يتم الحفظ.",
      );
      return;
    }
    if (!preview.canSave) {
      toast.error(
        preview.blockingMessage ||
          "لا يمكن حفظ هذا التعديل لأنه سيجعل بيانات طلاب حاليين غير صالحة.",
      );
      return;
    }
    if (preview.configTouched && preview.eligibleStudents > 0) {
      setCourseSyncDialog({
        open: true,
        courseId: editDialog.courseId,
        payload,
        preview,
      });
      return;
    }
    await applyCourseUpdate(editDialog.courseId, payload, false);
  });

  const handleCourseSyncDecision = runApplyCourseSyncLocked(
    async (syncStudentSnapshots: boolean) => {
      if (!courseSyncDialog.payload || !courseSyncDialog.courseId) return;
      await applyCourseUpdate(
        courseSyncDialog.courseId,
        courseSyncDialog.payload,
        syncStudentSnapshots,
      );
    },
  );

  // ─── Delete handler ────────────────────────────────────────────────────────
  const openDeleteDialog = (row: CourseOverviewRow) => {
    setDeleteDialog({
      open: true,
      id: row.course.id,
      courseName: row.course.name,
      confirmText: "",
      row,
    });
  };

  const handleDeleteConfirm = runDeleteCourseLocked(async () => {
    if (!deleteDialog.row?.deleteSafety.canDelete) {
      toast.error(
        "لا يمكن حذف هذه الدورة لأنها مرتبطة ببيانات. استخدم التعطيل بدل الحذف.",
      );
      return;
    }
    const result = await courseApi.remove(deleteDialog.id);
    if (!result.ok) {
      toast.error(result.error || "تعذر حذف الدورة");
      return;
    }
    toast.success("تم حذف الدورة بعد التحقق من الحفظ");
    setDeleteDialog({
      open: false,
      id: "",
      courseName: "",
      confirmText: "",
      row: null,
    });
    await syncCoursesAfterMutation("حذف دورة");
  });

  // ─── Toggle handler ────────────────────────────────────────────────────────
  const handleToggle = runToggleCourseLocked(async (row: CourseOverviewRow) => {
    const nextActive = !row.course.active;
    const result = await courseApi.update(row.course.id, {
      active: nextActive,
    });
    if (!result.ok) {
      toast.error(result.error || "تعذر تغيير حالة الدورة");
      return;
    }
    toast.success(
      nextActive
        ? "تم تفعيل الدورة للاختيارات الجديدة"
        : "تم إيقاف الدورة عن التسجيل والاختيارات الجديدة",
    );
    await syncCoursesAfterMutation(nextActive ? "تفعيل دورة" : "تعطيل دورة");
  });

  const renderStats = () => (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
      <div className="rounded-2xl border bg-card/80 p-4 shadow-sm">
        <p className="text-xs text-muted-foreground">
          إجمالي الدورات في النظام
        </p>
        <p className="mt-1 text-2xl font-black">
          {stats?.total ?? rows.length}
        </p>
      </div>
      <div className="rounded-2xl border bg-emerald-500/5 p-4 shadow-sm">
        <p className="text-xs text-muted-foreground">نشطة للتسجيل</p>
        <p className="mt-1 text-2xl font-black text-emerald-600 dark:text-emerald-400">
          {stats?.active ?? 0}
        </p>
      </div>
      <div className="rounded-2xl border bg-amber-500/5 p-4 shadow-sm">
        <p className="text-xs text-muted-foreground">موقوفة عن الاختيارات</p>
        <p className="mt-1 text-2xl font-black text-amber-600 dark:text-amber-400">
          {stats?.inactive ?? 0}
        </p>
      </div>
      <div className="rounded-2xl border bg-primary/5 p-4 shadow-sm">
        <p className="text-xs text-muted-foreground">عليها طلاب</p>
        <p className="mt-1 text-2xl font-black text-primary">
          {stats?.withStudents ?? 0}
        </p>
      </div>
      <div className="rounded-2xl border bg-muted/30 p-4 shadow-sm">
        <p className="text-xs text-muted-foreground">آمنة للحذف</p>
        <p className="mt-1 text-2xl font-black">{stats?.deletable ?? 0}</p>
      </div>
    </div>
  );

  const renderLoadingSkeleton = () => (
    <div className="grid gap-4 xl:grid-cols-2">
      {[0, 1, 2, 3].map((index) => (
        <div
          key={index}
          className="rounded-3xl border bg-card/80 p-5 shadow-sm"
        >
          <div className="flex items-start justify-between gap-3 border-b pb-4">
            <div className="space-y-2">
              <span className="block h-5 w-44 animate-pulse rounded-full bg-muted" />
              <span className="block h-4 w-28 animate-pulse rounded-full bg-muted" />
            </div>
            <span className="h-7 w-24 animate-pulse rounded-full bg-muted" />
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            <span className="h-20 animate-pulse rounded-2xl bg-muted" />
            <span className="h-20 animate-pulse rounded-2xl bg-muted" />
            <span className="h-20 animate-pulse rounded-2xl bg-muted" />
          </div>
          <span className="mt-4 block h-14 animate-pulse rounded-2xl bg-muted" />
        </div>
      ))}
    </div>
  );

  const renderCourseCard = (row: CourseOverviewRow) => {
    const programs = getAvailablePrograms(row.course);
    const studyTypesByProgram = getStudyTypesByProgram(row.course);
    const locationSummary = buildLocationSummary(row.course);
    const studyTypeUsage = topUsageItems(row.usage.studyTypes);
    const locationUsage = topUsageItems(row.usage.locations);
    return (
      <div
        key={row.id}
        className="rounded-3xl border bg-card/90 p-5 shadow-sm transition-colors hover:border-primary/25"
      >
        <div className="flex flex-wrap items-start justify-between gap-3 border-b pb-4">
          <div className="min-w-0 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <b className="text-lg leading-tight">{row.course.name}</b>
              <Badge variant={row.course.active ? "default" : "secondary"}>
                {row.course.active ? "نشطة للتسجيل" : "موقوفة عن الاختيارات"}
              </Badge>
              <Badge
                variant={row.deleteSafety.canDelete ? "outline" : "destructive"}
              >
                {courseDeleteBadge(row)}
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground">
              أنشئت: {formatAppDate(row.course.createdAt)} — البيانات من بيانات
              النظام
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => openEditDialog(row)}
            >
              تعديل
            </Button>
            <Button
              variant={row.course.active ? "outline" : "default"}
              size="sm"
              disabled={isTogglingCourse}
              onClick={() => void handleToggle(row)}
            >
              {row.course.active ? "إيقاف الاختيارات" : "تفعيل الاختيارات"}
            </Button>
          </div>
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-2xl border bg-muted/20 p-3">
            <p className="text-[11px] text-muted-foreground">الطلاب</p>
            <p className="text-xl font-black">{row.counts.students}</p>
            <p className="text-[11px] text-muted-foreground">
              نشط {row.counts.activeStudents} / مفصول{" "}
              {row.counts.dismissedStudents} / مؤرشف{" "}
              {row.counts.archivedStudents}
            </p>
          </div>
          <div className="rounded-2xl border bg-muted/20 p-3">
            <p className="text-[11px] text-muted-foreground">الامتحانات</p>
            <p className="text-xl font-black">{row.counts.exams}</p>
            <p className="text-[11px] text-muted-foreground">
              فعالة {row.counts.activeExams} / معطلة {row.counts.inactiveExams}
            </p>
          </div>
          <div className="rounded-2xl border bg-muted/20 p-3">
            <p className="text-[11px] text-muted-foreground">الفصول</p>
            <p className="text-xl font-black">{row.counts.courseChapters}</p>
            <p className="text-[11px] text-muted-foreground">
              النشط:{" "}
              {row.activeChapter
                ? `${row.activeChapter.name} (${row.activeChapter.opportunities} فرص)`
                : "لا يوجد"}
            </p>
          </div>
          <div className="rounded-2xl border bg-muted/20 p-3">
            <p className="text-[11px] text-muted-foreground">الحذف</p>
            <p className="text-sm font-black">
              {row.deleteSafety.canDelete ? "مسموح" : "مرفوض"}
            </p>
            <p className="text-[11px] text-muted-foreground">
              {row.deleteSafety.blockers.length
                ? row.deleteSafety.blockers.join("، ")
                : "لا توجد روابط مانعة"}
            </p>
          </div>
        </div>

        <div className="mt-4 grid gap-4 lg:grid-cols-[1.2fr_1fr]">
          <div className="space-y-3 rounded-2xl border bg-muted/15 p-4">
            <p className="text-xs font-bold text-muted-foreground">
              إعدادات التسجيل
            </p>
            <div className="flex flex-wrap gap-1.5">
              {programs.map((program) => (
                <Badge
                  key={program}
                  variant="outline"
                  className="whitespace-normal leading-5 text-start"
                >
                  <GraduationCap className="ml-1 size-3" />
                  {program}:{" "}
                  {(studyTypesByProgram[program] || []).join("، ") ||
                    "بدون نوع دراسة"}
                </Badge>
              ))}
            </div>
            {locationSummary ? (
              <div className="flex items-start gap-2 rounded-xl border bg-background/70 p-3 text-xs text-muted-foreground">
                <MapPin className="mt-0.5 size-4 shrink-0" />
                <span className="leading-6">{locationSummary}</span>
              </div>
            ) : (
              <p className="rounded-xl border border-dashed bg-background/70 p-3 text-xs text-muted-foreground">
                لا توجد إعدادات مواقع مكتملة لهذه الدورة.
              </p>
            )}
          </div>

          <div className="space-y-3 rounded-2xl border bg-muted/15 p-4">
            <p className="text-xs font-bold text-muted-foreground">
              الأثر الحالي
            </p>
            {studyTypeUsage.length > 0 ? (
              <div className="space-y-1 text-xs text-muted-foreground">
                <p className="font-bold text-foreground">
                  استخدام أنواع الدراسة
                </p>
                {studyTypeUsage.map((item) => (
                  <p key={item}>{item}</p>
                ))}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">
                لا يوجد طلاب مرتبطون بهذه الإعدادات حالياً.
              </p>
            )}
            {locationUsage.length > 0 ? (
              <div className="space-y-1 text-xs text-muted-foreground">
                <p className="font-bold text-foreground">
                  أكثر المواقع استخداماً
                </p>
                {locationUsage.map((item) => (
                  <p key={item}>{item}</p>
                ))}
              </div>
            ) : null}
            {row.configWarnings.length > 0 ? (
              <div className="space-y-1 rounded-xl border border-amber-200/70 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/25 dark:text-amber-100">
                {row.configWarnings.map((warning) => (
                  <p key={warning}>{warning}</p>
                ))}
              </div>
            ) : null}
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t pt-4">
          <p className="max-w-2xl text-xs leading-6 text-muted-foreground">
            {row.deleteSafety.recommendedAction} التعطيل يوقف الدورة عن التسجيل
            والاختيارات الجديدة فقط ولا يغيّر بيانات الطلاب الحاليين.
          </p>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => openDeleteDialog(row)}
            className="text-destructive hover:text-destructive"
          >
            حذف نهائي
          </Button>
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-6">
      <div className="rounded-3xl border bg-card/90 p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <BookOpen className="size-5 text-primary" />
              <h2 className="text-xl font-black">إدارة الدورات</h2>
            </div>
            <p className="max-w-3xl text-sm leading-7 text-muted-foreground">
              هذه الصفحة تقرأ الدورات وأثرها من بيانات النظام: الطلاب،
              الامتحانات، الفصول، وإمكانية الحذف. أي تعديل لا يظهر كنجاح إلا بعد
              تأكيد الحفظ.
            </p>
          </div>
          <Button onClick={() => setShowCreateForm((value) => !value)}>
            {showCreateForm ? "إخفاء نموذج الإضافة" : "إضافة دورة جديدة"}
          </Button>
        </div>
      </div>

      {renderStats()}

      {showCreateForm ? (
        <Card className="rounded-3xl border-primary/20 shadow-sm">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <BookOpen className="size-5 text-primary" />
              إضافة دورة جديدة
            </CardTitle>
          </CardHeader>
          <CardContent>
            <CourseBuilderForm
              form={createForm}
              setForm={setCreateForm}
              onSubmit={handleCreate}
              submitLabel="حفظ الدورة من بيانات النظام"
              submitDisabled={isAddingCourse}
            />
          </CardContent>
        </Card>
      ) : null}

      <Card className="tp-filter-card rounded-3xl shadow-sm">
        <CardHeader className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <CardTitle>قائمة الدورات</CardTitle>
            <Badge variant="outline">
              {filteredRows.length} من {rows.length}
            </Badge>
          </div>
          <div className="tp-filter-grid lg:grid-cols-[minmax(0,1fr)_220px_230px]">
            <Input
              className="tp-filter-search h-11 rounded-2xl"
              value={searchText}
              onChange={(event) => setSearchText(event.target.value)}
              placeholder="بحث باسم الدورة، النوع، الموقع، الفصل أو سبب منع الحذف..."
              autoComplete="off"
            />
            <div className="tp-filter-field tp-filter-primary">
              <Label className="text-xs text-muted-foreground">
                حالة الدورة
              </Label>
              <Select
                value={statusFilter}
                onValueChange={(value) =>
                  setStatusFilter(value as CourseStatusFilter)
                }
              >
                <SelectTrigger className="h-10 rounded-2xl">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(courseStatusFilterLabels).map(
                    ([value, label]) => (
                      <SelectItem key={value} value={value}>
                        {label}
                      </SelectItem>
                    ),
                  )}
                </SelectContent>
              </Select>
            </div>
            <div className="tp-filter-field tp-filter-secondary">
              <Label className="text-xs text-muted-foreground">
                حماية الحذف
              </Label>
              <Select
                value={deleteFilter}
                onValueChange={(value) =>
                  setDeleteFilter(value as CourseDeleteFilter)
                }
              >
                <SelectTrigger className="h-10 rounded-2xl">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(courseDeleteFilterLabels).map(
                    ([value, label]) => (
                      <SelectItem key={value} value={value}>
                        {label}
                      </SelectItem>
                    ),
                  )}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="tp-filter-summary">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline" data-count-scope="filtered">
                المطابقون للفلاتر: {filteredStats.total}
              </Badge>
              <Badge variant="secondary">نشطة: {filteredStats.active}</Badge>
              <Badge variant="secondary">
                موقوفة: {filteredStats.inactive}
              </Badge>
              <Badge variant="outline">
                قابلة للحذف: {filteredStats.deletable}
              </Badge>
              <Badge variant="outline">محمية: {filteredStats.blocked}</Badge>
              {hasActiveFilters ? (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="h-7 rounded-full px-3 text-[11px]"
                  onClick={() => {
                    setSearchText("");
                    setStatusFilter("all");
                    setDeleteFilter("all");
                  }}
                >
                  تصفير الفلاتر
                </Button>
              ) : null}
            </div>
            <p className="mt-2 leading-6">
              {courseStatusFilterLabels[statusFilter]} —{" "}
              {courseDeleteFilterLabels[deleteFilter]}. هذه الفلاتر للعرض فقط
              ولا تغيّر حالة أي دورة.
            </p>
          </div>
        </CardHeader>
        <CardContent>
          {loadError ? (
            <div className="rounded-2xl border border-destructive/25 bg-destructive/10 p-4 text-sm text-destructive">
              {loadError}
            </div>
          ) : isLoading ? (
            renderLoadingSkeleton()
          ) : filteredRows.length === 0 ? (
            <EmptyState
              icon={BookOpen}
              title="لا توجد دورات مطابقة"
              description="غيّر البحث أو الفلاتر، أو أضف دورة جديدة من زر الإضافة أعلاه."
            />
          ) : (
            <div className="grid gap-4 xl:grid-cols-2">
              {filteredRows.map(renderCourseCard)}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ─── Edit Course Dialog ──────────────────────────────────────────── */}
      <Dialog
        open={editDialog.open}
        onOpenChange={(open) => setEditDialog((prev) => ({ ...prev, open }))}
      >
        <DialogContent
          dir="rtl"
          className="!left-0 !top-0 z-[70] h-dvh w-screen !max-w-none !translate-x-0 !translate-y-0 overflow-hidden rounded-none border-0 bg-background p-0 shadow-none sm:!max-w-none sm:p-0"
        >
          <div className="flex h-full min-h-0 flex-col">
            <DialogHeader className="shrink-0 border-b bg-background/95 px-5 py-5 text-right shadow-sm backdrop-blur md:px-8">
              <div className="mx-auto w-full max-w-6xl space-y-2 pl-10">
                <DialogTitle className="text-2xl font-black">
                  تعديل الدورة
                </DialogTitle>
                <DialogDescription>
                  الحفظ يتم من النظام أولاً. إذا كان التعديل يحذف خياراً يستخدمه
                  طلاب مسجلون، سيتم رفضه برسالة واضحة حتى لا يتغير تصنيف طالب
                  قديم بدون قصد.
                </DialogDescription>
                {editDialog.row ? (
                  <div className="mt-3 grid gap-2 text-xs sm:grid-cols-3">
                    <div className="rounded-xl border bg-muted/30 p-3">
                      الطلاب: {editDialog.row.counts.students}
                    </div>
                    <div className="rounded-xl border bg-muted/30 p-3">
                      الامتحانات: {editDialog.row.counts.exams}
                    </div>
                    <div className="rounded-xl border bg-muted/30 p-3">
                      الفصل النشط:{" "}
                      {editDialog.row.activeChapter?.name || "لا يوجد"}
                    </div>
                  </div>
                ) : null}
              </div>
            </DialogHeader>
            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5 md:px-8 md:py-6">
              <div className="mx-auto w-full max-w-6xl rounded-3xl border bg-card/80 p-4 shadow-sm md:p-6">
                <CourseBuilderForm
                  form={editDialog.form}
                  setForm={(action) =>
                    setEditDialog((prev) => ({
                      ...prev,
                      form:
                        typeof action === "function"
                          ? action(prev.form)
                          : action,
                    }))
                  }
                  onSubmit={handleEditSave}
                  submitLabel="حفظ التعديلات بعد فحص النظام"
                  submitDisabled={isSavingCourse}
                />
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* ─── Course snapshot synchronization preview ─────────────────────── */}
      <AlertDialog
        open={courseSyncDialog.open}
        onOpenChange={(open) => {
          if (isApplyingCourseSync) return;
          setCourseSyncDialog((prev) =>
            open
              ? { ...prev, open: true }
              : { open: false, courseId: "", payload: null, preview: null },
          );
        }}
      >
        <AlertDialogContent dir="rtl" className="max-w-2xl">
          <AlertDialogHeader>
            <AlertDialogTitle>معاينة أثر تعديل إعدادات الدورة</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-4 text-right leading-7">
                <p>
                  تم حساب الأثر الآن من بيانات النظام. اختر هل تبقى بيانات
                  الطلاب القدامى كنسخة تاريخية، أم تتم مزامنتها مع الإعدادات
                  الجديدة ضمن عملية واحدة.
                </p>
                {courseSyncDialog.preview ? (
                  <>
                    <div className="grid gap-2 sm:grid-cols-3">
                      <div className="rounded-xl border bg-muted/35 p-3">
                        <p className="text-xs text-muted-foreground">
                          طلاب حاليون
                        </p>
                        <p className="text-xl font-black text-foreground">
                          {courseSyncDialog.preview.eligibleStudents}
                        </p>
                      </div>
                      <div className="rounded-xl border bg-primary/5 p-3">
                        <p className="text-xs text-muted-foreground">
                          تحتاج بياناتهم تحديثاً
                        </p>
                        <p className="text-xl font-black text-primary">
                          {courseSyncDialog.preview.studentsToUpdate}
                        </p>
                      </div>
                      <div className="rounded-xl border bg-muted/35 p-3">
                        <p className="text-xs text-muted-foreground">
                          مؤرشفون لن يتغيروا
                        </p>
                        <p className="text-xl font-black text-foreground">
                          {courseSyncDialog.preview.skippedArchived}
                        </p>
                      </div>
                    </div>
                    <div className="rounded-xl border bg-muted/25 p-3 text-sm">
                      <p className="mb-2 font-bold text-foreground">
                        الحقول التي ستتغير عند اختيار المزامنة:
                      </p>
                      <div className="grid gap-1 sm:grid-cols-2">
                        <p>
                          الفترة/نوع الدورة:{" "}
                          {courseSyncDialog.preview.fieldChanges.courseTerm}
                        </p>
                        <p>
                          نمط بغداد:{" "}
                          {courseSyncDialog.preview.fieldChanges.baghdadMode}
                        </p>
                        <p>
                          الموقع الرئيسي:{" "}
                          {courseSyncDialog.preview.fieldChanges.mainSite}
                        </p>
                        <p>
                          الموقع الفرعي:{" "}
                          {courseSyncDialog.preview.fieldChanges.subSite}
                        </p>
                      </div>
                    </div>
                    {courseSyncDialog.preview.studentsToUpdate === 0 ? (
                      <p className="rounded-xl border border-emerald-500/25 bg-emerald-500/10 p-3 text-emerald-800 dark:text-emerald-200">
                        جميع بيانات الطلاب الحالية متوافقة أصلاً؛ خيار المزامنة
                        لن يغير أي سجل.
                      </p>
                    ) : null}
                  </>
                ) : null}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2 sm:justify-start">
            <AlertDialogCancel disabled={isApplyingCourseSync}>
              إلغاء التعديل
            </AlertDialogCancel>
            <Button
              type="button"
              variant="outline"
              disabled={isApplyingCourseSync}
              onClick={() => void handleCourseSyncDecision(false)}
            >
              حفظ الإعداد فقط
            </Button>
            <AlertDialogAction
              disabled={
                isApplyingCourseSync || !courseSyncDialog.preview?.canSync
              }
              onClick={() => void handleCourseSyncDecision(true)}
            >
              {isApplyingCourseSync ? "جاري الحفظ..." : "حفظ ومزامنة الطلاب"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ─── Delete Course AlertDialog ───────────────────────────────────── */}
      <AlertDialog
        open={deleteDialog.open}
        onOpenChange={(open) =>
          setDeleteDialog((prev) => ({
            ...prev,
            open,
            confirmText: open ? prev.confirmText : "",
          }))
        }
      >
        <AlertDialogContent dir="rtl">
          <AlertDialogHeader>
            <AlertDialogTitle>حذف نهائي للدورة</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3 text-right leading-7">
                <p>
                  الحذف لا يعتمد على بيانات الصفحة المؤقتة. يتم السماح به فقط
                  إذا أكدت بيانات النظام أن الدورة غير مرتبطة بطلاب أو امتحانات.
                </p>
                {deleteDialog.row ? (
                  <div
                    className={`rounded-xl border p-3 ${deleteDialog.row.deleteSafety.canDelete ? "bg-muted/40" : "border-destructive/25 bg-destructive/10 text-destructive"}`}
                  >
                    <p className="font-bold">
                      {deleteDialog.row.deleteSafety.canDelete
                        ? "هذه الدورة آمنة للحذف"
                        : "لا يمكن حذف هذه الدورة حالياً"}
                    </p>
                    <p className="text-sm">
                      {deleteDialog.row.deleteSafety.blockers.length
                        ? deleteDialog.row.deleteSafety.blockers.join("، ")
                        : "لا توجد روابط مانعة حسب آخر فحص من بيانات النظام."}
                    </p>
                    <p className="text-sm">
                      {deleteDialog.row.deleteSafety.recommendedAction}
                    </p>
                  </div>
                ) : null}
                <div className="space-y-2">
                  <Label htmlFor="deleteCourseConfirm">
                    اكتب اسم الدورة لتأكيد الحذف النهائي:
                  </Label>
                  <Input
                    id="deleteCourseConfirm"
                    value={deleteDialog.confirmText}
                    onChange={(event) =>
                      setDeleteDialog((prev) => ({
                        ...prev,
                        confirmText: event.target.value,
                      }))
                    }
                    placeholder={deleteDialog.courseName}
                    autoComplete="off"
                    disabled={!deleteDialog.row?.deleteSafety.canDelete}
                  />
                </div>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>إلغاء</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteConfirm}
              disabled={
                isDeletingCourse ||
                !deleteDialog.row?.deleteSafety.canDelete ||
                deleteDialog.confirmText.trim() !==
                  deleteDialog.courseName.trim()
              }
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isDeletingCourse ? "جاري الحذف..." : "حذف نهائي"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
