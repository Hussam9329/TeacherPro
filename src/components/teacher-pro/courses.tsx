"use client";

import React, { useState, useMemo } from "react";
import { useTeacherStore, type Course } from "@/lib/teacher-store";
import {
  COURSE_PROGRAMS, STUDY_TYPES, LOCATION_SCOPES, BAGHDAD_MODES,
  type CourseProgram, type StudyType, type LocationScope, type BaghdadMode,
  type StudyLocationConfig, type CourseLocationConfig,
  parseJsonArray, parseJsonRecord, stringifyJson,
  getAvailablePrograms, getAvailableStudyTypes, getCourseLocationConfig,
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
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
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

// ─── Types ────────────────────────────────────────────────────────────────────

type CourseFormState = {
  name: string;
  type: "خاصة" | "عامة";
  availablePrograms: CourseProgram[];
  availableStudyTypes: StudyType[];
  locationConfig: CourseLocationConfig;
};

function emptyCourseForm(): CourseFormState {
  return {
    name: "",
    type: "عامة",
    availablePrograms: [],
    availableStudyTypes: [],
    locationConfig: {},
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function toggleInArray<T>(arr: T[], item: T): T[] {
  return arr.includes(item) ? arr.filter(x => x !== item) : [...arr, item];
}

/** Generate a human-readable location summary for a course */
function buildLocationSummary(course: Course): string {
  const config = getCourseLocationConfig(course);
  const studyTypes = getAvailableStudyTypes(course);
  const parts: string[] = [];

  for (const st of studyTypes) {
    const sc = config[st as StudyType];
    if (!sc) continue;
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
    if (sc.scopes.includes("محافظات") && sc.provinces && sc.provinces.length > 0) {
      segments.push(`محافظات(${sc.provinces.join("، ")})`);
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
    setForm(prev => ({
      ...prev,
      availablePrograms: toggleInArray(prev.availablePrograms, program),
    }));
  };

  const handleStudyTypeToggle = (studyType: StudyType) => {
    setForm(prev => {
      const nextTypes = toggleInArray(prev.availableStudyTypes, studyType);
      const nextConfig = { ...prev.locationConfig };
      // If unchecked, remove its config
      if (!nextTypes.includes(studyType)) {
        delete nextConfig[studyType];
      } else if (!nextConfig[studyType]) {
        // If newly checked, create empty config
        nextConfig[studyType] = { scopes: [] };
      }
      return {
        ...prev,
        availableStudyTypes: nextTypes,
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

      return {
        ...prev,
        locationConfig: { ...prev.locationConfig, [studyType]: nextStudy },
      };
    });
  };

  const handleBaghdadModeChange = (studyType: StudyType, mode: BaghdadMode) => {
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
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
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
          <div className="space-y-2">
            <Label htmlFor="course-financial-type">تصنيف الدورة المالي</Label>
            <Select
              value={form.type}
              onValueChange={(v) => setForm(prev => ({ ...prev, type: v as "خاصة" | "عامة" }))}
            >
              <SelectTrigger id="course-financial-type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="عامة">عامة</SelectItem>
                <SelectItem value="خاصة">خاصة</SelectItem>
              </SelectContent>
            </Select>
          </div>
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

      <Separator />

      {/* نوع الدراسة */}
      <div className="space-y-3">
        <div className="flex items-center gap-2 text-sm font-bold text-foreground">
          <Monitor className="size-4 text-primary" />
          <span>نوع الدراسة</span>
        </div>
        <div className="flex flex-wrap gap-4">
          {STUDY_TYPES.map((st) => (
            <label key={st} className="flex items-center gap-2 cursor-pointer">
              <Checkbox
                checked={form.availableStudyTypes.includes(st)}
                onCheckedChange={() => handleStudyTypeToggle(st)}
              />
              <span className="text-sm">{st}</span>
            </label>
          ))}
        </div>
      </div>

      {/* إعداد المواقع لكل نوع دراسة */}
      {form.availableStudyTypes.length > 0 && (
        <>
          <Separator />
          <div className="space-y-4">
            <div className="flex items-center gap-2 text-sm font-bold text-foreground">
              <MapPin className="size-4 text-primary" />
              <span>إعداد المواقع لكل نوع دراسة</span>
            </div>
            {form.availableStudyTypes.map((studyType) => {
              const studyConfig = form.locationConfig[studyType] || { scopes: [] };
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
                    {studyConfig.scopes.includes("بغداد") && (
                      <div className="space-y-3 rounded-lg border bg-muted/30 p-3">
                        <RadioGroup
                          value={studyConfig.baghdadMode || ""}
                          onValueChange={(v) => handleBaghdadModeChange(studyType, v as BaghdadMode)}
                          className="flex flex-wrap gap-4"
                        >
                          {BAGHDAD_MODES.map((mode) => (
                            <label key={mode} className="flex items-center gap-2 cursor-pointer">
                              <RadioGroupItem value={mode} />
                              <span className="text-sm">{mode}</span>
                            </label>
                          ))}
                        </RadioGroup>

                        {/* Baghdad sites */}
                        {studyConfig.baghdadMode === "بغداد - مخصص" && (
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
        disabled={submitDisabled || !form.name.trim()}
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
    if (!createForm.name.trim()) {
      toast.error("يرجى إدخال اسم الدورة");
      return;
    }
    addCourse({
      name: createForm.name.trim(),
      type: createForm.type,
      availablePrograms: createForm.availablePrograms,
      availableStudyTypes: createForm.availableStudyTypes,
      locationConfig: createForm.locationConfig,
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
        type: course.type,
        availablePrograms: getAvailablePrograms(course),
        availableStudyTypes: getAvailableStudyTypes(course),
        locationConfig: JSON.parse(JSON.stringify(getCourseLocationConfig(course))),
      },
    });
  };

  const handleEditSave = runSaveCourseLocked(async () => {
    if (!editDialog.form.name.trim()) {
      toast.error("يرجى إدخال اسم الدورة");
      return;
    }
    const result = updateCourse(editDialog.courseId, {
      name: editDialog.form.name.trim(),
      type: editDialog.form.type,
      availablePrograms: editDialog.form.availablePrograms,
      availableStudyTypes: editDialog.form.availableStudyTypes,
      locationConfig: editDialog.form.locationConfig,
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
                description="أضف أول دورة من النموذج المجاور لتظهر هنا وتبدأ ربط الطلاب والمجموعات الإلكترونية."
              />
            ) : (
              courses.map((course) => {
                const programs = getAvailablePrograms(course);
                const studyTypes = getAvailableStudyTypes(course);
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
                          {course.createdAt} — تصنيف: {course.type}
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
                            {p}
                          </Badge>
                        ))}
                        {studyTypes.map((st) => (
                          <Badge key={st} variant="outline" className="text-xs">
                            <Monitor className="size-3 ml-1" />
                            {st}
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
