"use client";

import React, { useState, useMemo } from "react";
import { useTeacherStore, type Course } from "@/lib/teacher-store";
import {
  COURSE_PROGRAMS, STUDY_TYPES, LOCATION_SCOPES, BAGHDAD_MODES,
  type CourseProgram, type StudyType, type LocationScope, type BaghdadMode,
  type StudyLocationConfig, type CourseLocationConfig, type StudyTypesByProgram,
  getAvailablePrograms, getAvailableStudyTypes, getCourseLocationConfig, getStudyTypesByProgram,
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
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { toast } from "sonner";
import { useActionLock } from "@/hooks/use-action-lock";
import { BookOpen, Settings, MapPin, GraduationCap, Monitor, Building } from "lucide-react";
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
  return arr.includes(item) ? arr.filter(x => x !== item) : [...arr, item];
}

function usesAutoGeneralBaghdad(studyType: StudyType): boolean {
  return studyType === "إلكتروني" || studyType === "مدمج";
}

function usesForcedCustomBaghdad(studyType: StudyType): boolean {
  return studyType === "حضوري";
}

function normalizeStudyLocationConfig(studyType: StudyType, config: StudyLocationConfig): StudyLocationConfig {
  const nextConfig: StudyLocationConfig = {
    ...config,
    scopes: [...(config.scopes || [])],
  };

  if (usesAutoGeneralBaghdad(studyType) && nextConfig.scopes.includes("بغداد")) {
    nextConfig.baghdadMode = "عموم بغداد";
    nextConfig.baghdadSites = undefined;
  }

  if (usesForcedCustomBaghdad(studyType) && nextConfig.scopes.includes("بغداد")) {
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
      nextConfig[studyType] = normalizeStudyLocationConfig(studyType, studyConfig);
    }
  }

  return nextConfig;
}

function getStudyTypesFromProgramMap(
  studyTypesByProgram: StudyTypesByProgram,
  programs: CourseProgram[],
): StudyType[] {
  const values = programs.flatMap((program) => studyTypesByProgram[program] || []);
  return Array.from(new Set(values));
}

function validateCourseForm(form: CourseFormState): string | null {
  if (!form.name.trim()) return "يرجى إدخال اسم الدورة";
  if (form.availablePrograms.length === 0) return "يجب اختيار نوع دورة واحد على الأقل";

  for (const program of form.availablePrograms) {
    if ((form.studyTypesByProgram[program] || []).length === 0) {
      return `يجب اختيار نوع دراسة واحد على الأقل لنوع الدورة "${program}"`;
    }
  }

  for (const studyType of form.availableStudyTypes) {
    const config = form.locationConfig[studyType];
    if (!config || config.scopes.length === 0) {
      return `يجب تحديد إعدادات المواقع لنوع الدراسة "${studyType}"`;
    }
    if (config.scopes.includes("بغداد") && !config.baghdadMode) {
      return `يجب اختيار نوع بغداد لنوع الدراسة "${studyType}"`;
    }
    if (config.baghdadMode === "بغداد - مخصص" && (!config.baghdadSites || config.baghdadSites.length === 0)) {
      return `يجب اختيار موقع واحد على الأقل من مواقع بغداد لنوع الدراسة "${studyType}"`;
    }
    if (config.scopes.includes("محافظات") && (!config.provinces || config.provinces.length === 0)) {
      return `يجب اختيار محافظة واحدة على الأقل لنوع الدراسة "${studyType}"`;
    }
  }

  return null;
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
      } else if (sc.baghdadMode === "بغداد - مخصص" && sc.baghdadSites && sc.baghdadSites.length > 0) {
        segments.push(`بغداد-مخصص(${sc.baghdadSites.join("، ")})`);
      } else {
        segments.push("بغداد");
      }
    }
    if (sc.scopes.includes("محافظات")) {
      segments.push(sc.provinces && sc.provinces.length > 0
        ? `محافظات(${sc.provinces.join("، ")})`
        : "محافظات(غير محددة)");
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
  const handleProgramToggle = (program: CourseProgram) => {
    setForm(prev => {
      const nextPrograms = toggleInArray(prev.availablePrograms, program);
      const nextStudyTypesByProgram: StudyTypesByProgram = { ...prev.studyTypesByProgram };

      if (nextPrograms.includes(program)) {
        nextStudyTypesByProgram[program] = nextStudyTypesByProgram[program] || [];
      } else {
        delete nextStudyTypesByProgram[program];
      }

      const nextStudyTypes = getStudyTypesFromProgramMap(nextStudyTypesByProgram, nextPrograms);
      return {
        ...prev,
        availablePrograms: nextPrograms,
        studyTypesByProgram: nextStudyTypesByProgram,
        availableStudyTypes: nextStudyTypes,
        locationConfig: normalizeCourseLocationConfig(prev.locationConfig, nextStudyTypes),
      };
    });
  };

  const handleStudyTypeToggle = (program: CourseProgram, studyType: StudyType) => {
    setForm(prev => {
      const currentProgramTypes = prev.studyTypesByProgram[program] || [];
      const nextProgramTypes = toggleInArray(currentProgramTypes, studyType);
      const nextStudyTypesByProgram: StudyTypesByProgram = {
        ...prev.studyTypesByProgram,
        [program]: nextProgramTypes,
      };
      const nextStudyTypes = getStudyTypesFromProgramMap(nextStudyTypesByProgram, prev.availablePrograms);
      const nextConfig = normalizeCourseLocationConfig(prev.locationConfig, nextStudyTypes);

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
    setForm(prev => {
      const prevStudy = prev.locationConfig[studyType] || { scopes: [] };
      const nextScopes = toggleInArray(prevStudy.scopes, scope);
      const nextStudy: StudyLocationConfig = { ...prevStudy, scopes: nextScopes };

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
    setForm(prev => {
      const prevStudy = prev.locationConfig[studyType] || { scopes: [] };
      const nextStudy: StudyLocationConfig = {
        ...prevStudy,
        baghdadMode: mode,
        baghdadSites: mode === "بغداد - مخصص" ? (prevStudy.baghdadSites || []) : undefined,
      };
      return {
        ...prev,
        locationConfig: { ...prev.locationConfig, [studyType]: nextStudy },
      };
    });
  };

  const handleBaghdadSiteToggle = (studyType: StudyType, site: string) => {
    setForm(prev => {
      const prevStudy = prev.locationConfig[studyType] || { scopes: [], baghdadMode: "بغداد - مخصص" as BaghdadMode };
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
    setForm(prev => {
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
    setForm(prev => {
      const prevStudy = prev.locationConfig[studyType] || { scopes: [] };
      const allSelected = (prevStudy.provinces || []).length === IRAQI_PROVINCES.length;
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
            onChange={(e) => setForm(prev => ({ ...prev, name: e.target.value }))}
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
            <label key={program} className="flex items-center gap-2 cursor-pointer">
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

          {/* نوع الدراسة حسب نوع الدورة */}
          <div className="space-y-4">
            <div className="flex items-center gap-2 text-sm font-bold text-foreground">
              <Monitor className="size-4 text-primary" />
              <span>نوع الدراسة لكل نوع دورة</span>
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
                      <label key={`${program}-${st}`} className="flex items-center gap-2 cursor-pointer">
                        <Checkbox
                          checked={(form.studyTypesByProgram[program] || []).includes(st)}
                          onCheckedChange={() => handleStudyTypeToggle(program, st)}
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
              const studyConfig = form.locationConfig[studyType] || { scopes: [] };
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
                        <label key={scope} className="flex items-center gap-2 cursor-pointer">
                          <Checkbox
                            checked={studyConfig.scopes.includes(scope)}
                            onCheckedChange={() => handleScopeToggle(studyType, scope)}
                          />
                          <span className="text-sm">{scope}</span>
                        </label>
                      ))}
                    </div>

                    {/* Baghdad options */}
                    {studyConfig.scopes.includes("بغداد") && !isAutoGeneralBaghdad && (
                      <div className="space-y-3 rounded-lg border bg-muted/30 p-3">
                        <RadioGroup
                          value={isForcedCustomBaghdad ? "بغداد - مخصص" : (studyConfig.baghdadMode || "")}
                          onValueChange={(v) => handleBaghdadModeChange(studyType, v as BaghdadMode)}
                          className="flex flex-wrap gap-4"
                        >
                          {BAGHDAD_MODES.map((mode) => {
                            const disabled = isForcedCustomBaghdad && mode === "عموم بغداد";
                            return (
                              <label
                                key={mode}
                                className={`flex items-center gap-2 ${disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer"}`}
                              >
                                <RadioGroupItem value={mode} disabled={disabled} />
                                <span className="text-sm">{mode}</span>
                              </label>
                            );
                          })}
                        </RadioGroup>

                        {/* Baghdad sites */}
                        {(isForcedCustomBaghdad || studyConfig.baghdadMode === "بغداد - مخصص") && (
                          <div className="flex flex-wrap gap-3 pt-1">
                            {BAGHDAD_COURSE_SITES.map((site) => (
                              <label key={site} className="flex items-center gap-2 cursor-pointer">
                                <Checkbox
                                  checked={(studyConfig.baghdadSites || []).includes(site)}
                                  onCheckedChange={() => handleBaghdadSiteToggle(studyType, site)}
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
                            {(studyConfig.provinces || []).length === IRAQI_PROVINCES.length
                              ? "إلغاء الكل"
                              : "اختيار الكل"}
                          </Button>
                        </div>
                        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
                          {IRAQI_PROVINCES.map((province) => (
                            <label key={province} className="flex items-center gap-2 cursor-pointer">
                              <Checkbox
                                checked={(studyConfig.provinces || []).includes(province)}
                                onCheckedChange={() => handleProvinceToggle(studyType, province)}
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

      {/* Submit */}
      <Button
        onClick={onSubmit}
        disabled={submitDisabled || !form.name.trim() || form.availablePrograms.length === 0 || form.availableStudyTypes.length === 0}
        className="w-full"
      >
        {submitDisabled ? "جاري الحفظ..." : submitLabel}
      </Button>
    </div>
  );
}

// ─── Main Component ──────────────────────────────────────────────────────────

export function CoursesView() {
  const { courses, addCourse, updateCourse, toggleCourse, deleteCourse } = useTeacherStore();

  // Create form
  const [createForm, setCreateForm] = useState<CourseFormState>(emptyCourseForm);

  // Edit dialog
  const [editDialog, setEditDialog] = useState<{
    open: boolean;
    courseId: string;
    form: CourseFormState;
  }>({ open: false, courseId: "", form: emptyCourseForm() });

  // Delete dialog
  const [deleteDialog, setDeleteDialog] = useState({
    open: false,
    id: "",
    courseName: "",
  });

  // Action locks
  const { locked: isAddingCourse, runLocked: runAddCourseLocked } = useActionLock();
  const { locked: isSavingCourse, runLocked: runSaveCourseLocked } = useActionLock();
  const { locked: isDeletingCourse, runLocked: runDeleteCourseLocked } = useActionLock();

  // ─── Create course handler ─────────────────────────────────────────────────
  const handleCreate = runAddCourseLocked(async () => {
    const validationMessage = validateCourseForm(createForm);
    if (validationMessage) {
      toast.error(validationMessage);
      return;
    }
    addCourse({
      name: createForm.name.trim(),
      availablePrograms: createForm.availablePrograms,
      availableStudyTypes: createForm.availableStudyTypes,
      studyTypesByProgram: createForm.studyTypesByProgram,
      locationConfig: normalizeCourseLocationConfig(createForm.locationConfig, createForm.availableStudyTypes),
    });
    setCreateForm(emptyCourseForm());
    toast.success("تمت إضافة الدورة");
  });

  // ─── Edit handlers ─────────────────────────────────────────────────────────
  const openEditDialog = (course: Course) => {
    setEditDialog({
      open: true,
      courseId: course.id,
      form: {
        name: course.name,
        availablePrograms: getAvailablePrograms(course),
        availableStudyTypes: getAvailableStudyTypes(course),
        studyTypesByProgram: getStudyTypesByProgram(course),
        locationConfig: normalizeCourseLocationConfig(
          JSON.parse(JSON.stringify(getCourseLocationConfig(course))),
          getAvailableStudyTypes(course),
        ),
      },
    });
  };

  const handleEditSave = runSaveCourseLocked(async () => {
    const validationMessage = validateCourseForm(editDialog.form);
    if (validationMessage) {
      toast.error(validationMessage);
      return;
    }
    const result = updateCourse(editDialog.courseId, {
      name: editDialog.form.name.trim(),
      availablePrograms: editDialog.form.availablePrograms,
      availableStudyTypes: editDialog.form.availableStudyTypes,
      studyTypesByProgram: editDialog.form.studyTypesByProgram,
      locationConfig: normalizeCourseLocationConfig(editDialog.form.locationConfig, editDialog.form.availableStudyTypes),
    });
    if (!result.ok) {
      toast.error(result.message);
      return;
    }
    setEditDialog({ open: false, courseId: "", form: emptyCourseForm() });
    toast.success("تم تعديل الدورة");
  });

  // ─── Delete handler ────────────────────────────────────────────────────────
  const openDeleteDialog = (id: string, courseName: string) => {
    setDeleteDialog({ open: true, id, courseName });
  };

  const handleDeleteConfirm = runDeleteCourseLocked(async () => {
    const ok = deleteCourse(deleteDialog.id);
    if (ok) {
      toast.success("تم حذف الدورة");
    } else {
      toast.error("لا يمكن حذف الدورة لأنها مرتبطة ببيانات أخرى");
    }
    setDeleteDialog({ open: false, id: "", courseName: "" });
  });

  // ─── Toggle handler ────────────────────────────────────────────────────────
  const handleToggle = (course: Course) => {
    toggleCourse(course.id);
    toast.success(course.active ? "تم تعطيل الدورة" : "تم تفعيل الدورة");
  };

  return (
    <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
      {/* ─── Create Course Form ──────────────────────────────────────────── */}
      <Card>
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
            submitLabel="حفظ الدورة"
            submitDisabled={isAddingCourse}
          />
        </CardContent>
      </Card>

      {/* ─── Course List ─────────────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle>قائمة الدورات</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3 max-h-[700px] overflow-y-auto">
            {courses.length === 0 ? (
              <EmptyState
                icon={BookOpen}
                title="لا توجد دورات بعد"
                description="أضف أول دورة من النموذج المجاور لتظهر هنا وتبدأ ربط الطلاب والمواقع."
              />
            ) : (
              courses.map((course) => {
                const programs = getAvailablePrograms(course);
                const studyTypes = getAvailableStudyTypes(course);
                const studyTypesByProgram = getStudyTypesByProgram(course);
                const locationSummary = buildLocationSummary(course);

                return (
                  <div
                    key={course.id}
                    className="rounded-2xl border bg-card/80 p-4 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-lg space-y-3"
                  >
                    {/* Header row */}
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <p className="font-bold text-sm leading-6">{course.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {formatAppDate(course.createdAt)}
                        </p>
                      </div>
                      <Badge variant={course.active ? "default" : "secondary"}>
                        {course.active ? "فعالة" : "معطلة"}
                      </Badge>
                    </div>

                    {/* Program & Study Type badges */}
                    {(programs.length > 0 || studyTypes.length > 0) && (
                      <div className="flex flex-wrap gap-1.5">
                        {programs.map((p) => (
                          <Badge key={p} variant="outline" className="text-xs">
                            <GraduationCap className="size-3 ml-1" />
                            {p}: {(studyTypesByProgram[p] || []).join("، ") || "بدون نوع دراسة"}
                          </Badge>
                        ))}
                      </div>
                    )}

                    {/* Location summary */}
                    {locationSummary && (
                      <div className="flex items-start gap-1.5 text-xs text-muted-foreground">
                        <MapPin className="size-3.5 mt-0.5 shrink-0" />
                        <span className="leading-5">{locationSummary}</span>
                      </div>
                    )}

                    {/* Actions */}
                    <div className="flex gap-2 pt-1">
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => openEditDialog(course)}
                      >
                        تعديل
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleToggle(course)}
                      >
                        {course.active ? "تعطيل" : "تفعيل"}
                      </Button>
                      <Button
                        variant="destructive"
                        size="sm"
                        onClick={() => openDeleteDialog(course.id, course.name)}
                      >
                        حذف
                      </Button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </CardContent>
      </Card>

      {/* ─── Edit Course Dialog ──────────────────────────────────────────── */}
      <Dialog
        open={editDialog.open}
        onOpenChange={(o) => setEditDialog(prev => ({ ...prev, open: o }))}
      >
        <DialogContent dir="rtl" className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>تعديل الدورة</DialogTitle>
            <DialogDescription>عدّل إعدادات الدورة. لا يمكنك إزالة خيارات يستخدمها طلاب مسجلون.</DialogDescription>
          </DialogHeader>
          <CourseBuilderForm
            form={editDialog.form}
            setForm={(action) =>
              setEditDialog(prev => ({
                ...prev,
                form: typeof action === "function" ? action(prev.form) : action,
              }))
            }
            onSubmit={handleEditSave}
            submitLabel="حفظ التعديلات"
            submitDisabled={isSavingCourse}
          />
        </DialogContent>
      </Dialog>

      {/* ─── Delete Course AlertDialog ───────────────────────────────────── */}
      <AlertDialog
        open={deleteDialog.open}
        onOpenChange={(o) => setDeleteDialog(prev => ({ ...prev, open: o }))}
      >
        <AlertDialogContent dir="rtl">
          <AlertDialogHeader>
            <AlertDialogTitle>تأكيد الحذف</AlertDialogTitle>
            <AlertDialogDescription>
              هل تريد حذف الدورة &quot;{deleteDialog.courseName}&quot;؟ لا يمكن
              حذف دورة مرتبطة بطلاب أو امتحانات.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>إلغاء</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteConfirm}
              disabled={isDeletingCourse}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isDeletingCourse ? "جاري الحذف..." : "حذف"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
