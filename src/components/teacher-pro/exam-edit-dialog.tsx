"use client";

import React, { useMemo, useState } from "react";
import type { Course, CourseChapter, Exam } from "@/lib/teacher-store";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { DateInput } from "@/components/ui/date-input";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { baghdadTodayKey, toBaghdadDateTimeLocal } from "@/lib/baghdad-time";
import { getExamStatus, hasActiveChapterLink, splitSelection } from "@/lib/exam-utils";
import { toLatinDigits } from "@/lib/format";
import { MAIN_SITE_OPTIONS } from "@/lib/iraq";
import {
  validateExamForm,
  type ExamValidationResult,
} from "@/lib/exam-form-validation";

export type ExamStatusMode = "نشط" | "تفعيل مجدول" | "معطل";

export type FullExamEditState = {
  id: string;
  name: string;
  type: Exam["type"];
  courseIds: string[];
  mainSites: string[];
  date: string;
  fullMark: string;
  passMark: string;
  discountMark: string;
  opportunitiesPenaltyNum: string;
  dismissalGrade: string;
  noDiscount: boolean;
  statusMode: ExamStatusMode;
  scheduledActivateAt: string;
};

function toDateTimeLocalValue(value?: string | null) {
  return toBaghdadDateTimeLocal(value);
}

function defaultDateTimeForDate(date: string) {
  return `${date || baghdadTodayKey()}T08:00`;
}

function statusModeFromExam(exam: Exam): ExamStatusMode {
  return getExamStatus(exam);
}

function toggleSelection(values: string[], value: string): string[] {
  return values.includes(value)
    ? values.filter((item) => item !== value)
    : [...values, value];
}

function createEditState(exam: Exam): FullExamEditState {
  return {
    id: exam.id,
    name: exam.name,
    type: exam.type,
    courseIds: [...exam.courseIds],
    mainSites: splitSelection(exam.mainSite),
    date: exam.date || baghdadTodayKey(),
    fullMark: String(exam.fullMark),
    passMark: String(exam.passMark),
    discountMark: String(exam.discountMark),
    opportunitiesPenaltyNum:
      typeof exam.opportunitiesPenalty === "number"
        ? String(exam.opportunitiesPenalty)
        : "1",
    dismissalGrade:
      exam.dismissalGrade === null || exam.dismissalGrade === undefined
        ? ""
        : String(exam.dismissalGrade),
    noDiscount: Boolean(exam.noDiscount),
    statusMode: statusModeFromExam(exam),
    scheduledActivateAt:
      toDateTimeLocalValue(exam.scheduledActivateAt) ||
      defaultDateTimeForDate(exam.date),
  };
}

function ExamEditFieldError({
  id,
  message,
}: {
  id: string;
  message?: string;
}) {
  if (!message) return null;
  return (
    <p id={id} role="alert" className="text-xs font-medium text-destructive">
      {message}
    </p>
  );
}

export function validateFullExamEditState(
  state: FullExamEditState,
  courses: Course[],
  courseChapters: CourseChapter[],
): ExamValidationResult {
  const courseNameById = new Map(
    courses.map((course) => [course.id, course.name] as const),
  );
  const invalidCourses = state.courseIds.filter(
    (courseId) => !hasActiveChapterLink(courseChapters, courseId),
  );

  return validateExamForm({
    name: state.name,
    type: state.type,
    courseIds: state.courseIds,
    mainSites: state.mainSites,
    date: state.date,
    fullMark: state.fullMark,
    passMark: state.passMark,
    discountMark: state.discountMark,
    opportunitiesPenalty: state.opportunitiesPenaltyNum,
    dismissalGrade: state.dismissalGrade,
    noDiscount: state.noDiscount,
    statusMode: state.statusMode,
    scheduledActivateAt: state.scheduledActivateAt,
    courseSelectionError:
      invalidCourses.length > 0
        ? `لا يمكن ربط الامتحان بدورات بدون فصل نشط: ${invalidCourses
            .map((courseId) => courseNameById.get(courseId) || courseId)
            .join("، ")}`
        : null,
  });
}

export function ExamEditDialog({
  exam,
  courses,
  courseChapters,
  isMutating,
  onClose,
  onSave,
}: {
  exam: Exam;
  courses: Course[];
  courseChapters: CourseChapter[];
  isMutating: boolean;
  onClose: () => void;
  onSave: (state: FullExamEditState) => void | Promise<void>;
}) {
  // Local state is intentionally owned by the dialog. Typing here must not
  // re-render the full exam list behind the modal.
  const [editDialog, setEditDialog] = useState<FullExamEditState>(() =>
    createEditState(exam),
  );

  const formValidation = useMemo(
    () => validateFullExamEditState(editDialog, courses, courseChapters),
    [courseChapters, courses, editDialog],
  );
  const isFormValid = formValidation.isValid;
  const fieldErrors = formValidation.fieldErrors;

  const isFinalExam = editDialog.type === "فاينل";
  const noDiscount = Boolean(editDialog.noDiscount);
  const numericFullMark = Number(toLatinDigits(editDialog.fullMark));
  const fullMarkMax =
    Number.isInteger(numericFullMark) && numericFullMark > 0
      ? numericFullMark
      : undefined;
  const mainSitesForEdit = MAIN_SITE_OPTIONS;
  const eligibleCourses = courses.filter((course) =>
    hasActiveChapterLink(courseChapters, course.id),
  );
  const allCoursesSelected =
    eligibleCourses.length > 0 &&
    eligibleCourses.every((course) => editDialog.courseIds.includes(course.id));
  const allSitesSelected =
    mainSitesForEdit.length > 0 &&
    mainSitesForEdit.every((site) => editDialog.mainSites.includes(site));

  const lightInputClass = "backdrop-blur-none";
  const lightSelectContentClass = "backdrop-blur-none";

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !isMutating) onClose();
      }}
    >
      <DialogContent
        dir="rtl"
        className="tp-exam-edit-dialog max-w-5xl backdrop-blur-none [&>[data-slot=dialog-footer]]:backdrop-blur-none [&>[data-slot=dialog-header]]:backdrop-blur-none"
      >
        <DialogHeader>
          <DialogTitle>تعديل الامتحان بالكامل</DialogTitle>
        </DialogHeader>

        <div className="min-h-0 max-h-[calc(100dvh-11rem)] space-y-4 overflow-y-auto pe-1 sm:max-h-[calc(100dvh-13rem)]">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div className="space-y-1 md:col-span-2">
              <Label htmlFor="edit-exam-name">اسم الامتحان</Label>
              <Input
                id="edit-exam-name"
                className={lightInputClass}
                value={editDialog.name}
                aria-invalid={Boolean(fieldErrors.name)}
                aria-describedby={
                  fieldErrors.name ? "edit-exam-name-error" : undefined
                }
                onChange={(e) =>
                  setEditDialog((prev) => ({ ...prev, name: e.target.value }))
                }
              />
              <ExamEditFieldError
                id="edit-exam-name-error"
                message={fieldErrors.name}
              />
            </div>

            <div className="space-y-1">
              <Label htmlFor="edit-exam-type">نوع الامتحان</Label>
              <Select
                value={editDialog.type}
                onValueChange={(value) =>
                  setEditDialog((prev) => ({
                    ...prev,
                    type: value as Exam["type"],
                    discountMark:
                      value === "فاينل" || prev.noDiscount
                        ? "0"
                        : prev.discountMark && prev.discountMark !== "0"
                          ? prev.discountMark
                          : "45",
                    opportunitiesPenaltyNum:
                      value === "فاينل" || prev.noDiscount
                        ? "0"
                        : prev.opportunitiesPenaltyNum &&
                            prev.opportunitiesPenaltyNum !== "0"
                          ? prev.opportunitiesPenaltyNum
                          : "1",
                    dismissalGrade:
                      value === "فاينل" && !prev.noDiscount
                        ? prev.dismissalGrade
                        : "",
                  }))
                }
              >
                <SelectTrigger id="edit-exam-type" className={lightInputClass}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className={lightSelectContentClass}>
                  <SelectItem value="يومي">يومي</SelectItem>
                  <SelectItem value="تراكمي">تراكمي</SelectItem>
                  <SelectItem value="فاينل">فاينل</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <Label htmlFor="edit-exam-date">تاريخ الامتحان</Label>
              <DateInput
                id="edit-exam-date"
                className={lightInputClass}
                value={editDialog.date}
                aria-invalid={Boolean(fieldErrors.date)}
                aria-describedby={
                  fieldErrors.date ? "edit-exam-date-error" : undefined
                }
                onChange={(value) =>
                  setEditDialog((prev) => ({
                    ...prev,
                    date: value,
                    scheduledActivateAt:
                      prev.statusMode === "تفعيل مجدول"
                        ? defaultDateTimeForDate(value)
                        : prev.scheduledActivateAt,
                  }))
                }
              />
              <ExamEditFieldError
                id="edit-exam-date-error"
                message={fieldErrors.date}
              />
            </div>

            <div
              className="space-y-1 md:col-span-2"
              role="group"
              aria-describedby={
                fieldErrors.courseIds ? "edit-exam-courses-error" : undefined
              }
            >
              <Label>الدورات</Label>
              <div className="max-h-44 space-y-2 overflow-y-auto rounded-xl border p-3">
                <label className="flex items-center gap-2 border-b pb-2 text-sm font-bold">
                  <Checkbox
                    checked={allCoursesSelected}
                    onCheckedChange={() =>
                      setEditDialog((prev) => ({
                        ...prev,
                        courseIds: allCoursesSelected
                          ? []
                          : eligibleCourses.map((course) => course.id),
                      }))
                    }
                  />
                  الكل
                </label>
                {courses.map((course) => {
                  const eligible = hasActiveChapterLink(
                    courseChapters,
                    course.id,
                  );
                  return (
                    <label
                      key={course.id}
                      className="flex items-center gap-2 text-sm"
                    >
                      <Checkbox
                        checked={editDialog.courseIds.includes(course.id)}
                        disabled={!eligible}
                        onCheckedChange={() =>
                          setEditDialog((prev) => ({
                            ...prev,
                            courseIds: toggleSelection(prev.courseIds, course.id),
                          }))
                        }
                      />
                      <span>{course.name}</span>
                      {!eligible && (
                        <Badge variant="destructive" className="text-[10px]">
                          بدون فصل نشط
                        </Badge>
                      )}
                    </label>
                  );
                })}
              </div>
              <ExamEditFieldError
                id="edit-exam-courses-error"
                message={fieldErrors.courseIds}
              />
            </div>

            <div
              className="space-y-1 md:col-span-2"
              role="group"
              aria-describedby={
                fieldErrors.mainSites ? "edit-exam-sites-error" : undefined
              }
            >
              <Label>الموقع</Label>
              <div className="max-h-44 space-y-2 overflow-y-auto rounded-xl border p-3">
                <label className="flex items-center gap-2 border-b pb-2 text-sm font-bold">
                  <Checkbox
                    checked={allSitesSelected}
                    onCheckedChange={() =>
                      setEditDialog((prev) => ({
                        ...prev,
                        mainSites: allSitesSelected ? [] : [...mainSitesForEdit],
                      }))
                    }
                  />
                  الكل
                </label>
                {mainSitesForEdit.map((site) => (
                  <label key={site} className="flex items-center gap-2 text-sm">
                    <Checkbox
                      checked={editDialog.mainSites.includes(site)}
                      onCheckedChange={() =>
                        setEditDialog((prev) => ({
                          ...prev,
                          mainSites: toggleSelection(prev.mainSites, site),
                        }))
                      }
                    />
                    <span>{site}</span>
                  </label>
                ))}
              </div>
              <ExamEditFieldError
                id="edit-exam-sites-error"
                message={fieldErrors.mainSites}
              />
            </div>

            <div className="space-y-1">
              <Label htmlFor="edit-exam-full-mark">الدرجة الكاملة</Label>
              <Input
                id="edit-exam-full-mark"
                type="number"
                min={1}
                step={1}
                className={lightInputClass}
                value={editDialog.fullMark}
                aria-invalid={Boolean(fieldErrors.fullMark)}
                aria-describedby={
                  fieldErrors.fullMark
                    ? "edit-exam-full-mark-error"
                    : undefined
                }
                onChange={(e) =>
                  setEditDialog((prev) => ({
                    ...prev,
                    fullMark: toLatinDigits(e.target.value),
                  }))
                }
              />
              <ExamEditFieldError
                id="edit-exam-full-mark-error"
                message={fieldErrors.fullMark}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="edit-exam-pass-mark">درجة النجاح</Label>
              <Input
                id="edit-exam-pass-mark"
                type="number"
                min={0}
                max={fullMarkMax}
                step={1}
                className={lightInputClass}
                value={editDialog.passMark}
                aria-invalid={Boolean(fieldErrors.passMark)}
                aria-describedby={
                  fieldErrors.passMark
                    ? "edit-exam-pass-mark-error"
                    : undefined
                }
                onChange={(e) =>
                  setEditDialog((prev) => ({
                    ...prev,
                    passMark: toLatinDigits(e.target.value),
                  }))
                }
              />
              <ExamEditFieldError
                id="edit-exam-pass-mark-error"
                message={fieldErrors.passMark}
              />
            </div>

            <div className="rounded-xl border border-sky-200 bg-sky-50/60 p-3 md:col-span-2 dark:border-sky-900/50 dark:bg-sky-950/20">
              <label className="flex cursor-pointer items-start gap-3 text-sm">
                <Checkbox
                  checked={noDiscount}
                  onCheckedChange={(value) => {
                    const enabled = Boolean(value);
                    setEditDialog((prev) => ({
                      ...prev,
                      noDiscount: enabled,
                      discountMark:
                        enabled || prev.type === "فاينل"
                          ? "0"
                          : prev.discountMark && prev.discountMark !== "0"
                            ? prev.discountMark
                            : "45",
                      opportunitiesPenaltyNum:
                        enabled || prev.type === "فاينل"
                          ? "0"
                          : prev.opportunitiesPenaltyNum &&
                              prev.opportunitiesPenaltyNum !== "0"
                            ? prev.opportunitiesPenaltyNum
                            : "1",
                      dismissalGrade: enabled ? "" : prev.dismissalGrade,
                    }));
                  }}
                />
                <span>
                  <span className="block font-semibold">امتحان بدون خصم</span>
                  <span className="block text-xs text-muted-foreground">
                    عند التفعيل لا يحاسب الطالب على الدرجة أو الغياب، وتعطل درجة
                    الخصم وخصم الفرص ودرجة الفصل.
                  </span>
                </span>
              </label>
            </div>

            <div className="space-y-1">
              <Label htmlFor="edit-exam-discount-mark">درجة الخصم</Label>
              <Input
                id="edit-exam-discount-mark"
                type="number"
                min={0}
                max={fullMarkMax}
                step={1}
                className={lightInputClass}
                disabled={isFinalExam || noDiscount}
                value={isFinalExam || noDiscount ? "0" : editDialog.discountMark}
                aria-invalid={Boolean(fieldErrors.discountMark)}
                aria-describedby={
                  fieldErrors.discountMark
                    ? "edit-exam-discount-mark-error"
                    : undefined
                }
                onChange={(e) =>
                  setEditDialog((prev) => ({
                    ...prev,
                    discountMark: toLatinDigits(e.target.value),
                  }))
                }
              />
              {noDiscount && (
                <p className="text-xs text-sky-600">
                  معطل لأن الامتحان بدون خصم.
                </p>
              )}
              {isFinalExam && !noDiscount && (
                <p className="text-xs text-amber-600">
                  معطل في الفاينل؛ الحكم يكون من درجة الفصل.
                </p>
              )}
              <ExamEditFieldError
                id="edit-exam-discount-mark-error"
                message={fieldErrors.discountMark}
              />
            </div>

            <div className="space-y-1">
              <Label htmlFor="edit-exam-opportunities-penalty">
                خصم الفرص
              </Label>
              <Input
                id="edit-exam-opportunities-penalty"
                type="number"
                min={1}
                step={1}
                className={lightInputClass}
                disabled={isFinalExam || noDiscount}
                value={
                  isFinalExam || noDiscount
                    ? "0"
                    : editDialog.opportunitiesPenaltyNum
                }
                aria-invalid={Boolean(fieldErrors.opportunitiesPenalty)}
                aria-describedby={
                  fieldErrors.opportunitiesPenalty
                    ? "edit-exam-opportunities-penalty-error"
                    : undefined
                }
                onChange={(e) =>
                  setEditDialog((prev) => ({
                    ...prev,
                    opportunitiesPenaltyNum: toLatinDigits(e.target.value),
                  }))
                }
              />
              {noDiscount && (
                <p className="text-xs text-sky-600">
                  معطل لأن الامتحان بدون خصم.
                </p>
              )}
              {isFinalExam && !noDiscount && (
                <p className="text-xs text-amber-600">
                  معطل في الفاينل؛ يعالج الفصل من درجة الفصل أو الغياب/الغش.
                </p>
              )}
              <ExamEditFieldError
                id="edit-exam-opportunities-penalty-error"
                message={fieldErrors.opportunitiesPenalty}
              />
            </div>

            {isFinalExam && (
              <div className="space-y-1">
                <Label htmlFor="edit-exam-dismissal-grade">درجة الفصل</Label>
                <Input
                  id="edit-exam-dismissal-grade"
                  type="number"
                  min={0}
                  max={fullMarkMax}
                  step={1}
                  className={lightInputClass}
                  disabled={noDiscount}
                  value={noDiscount ? "" : editDialog.dismissalGrade}
                  aria-invalid={Boolean(fieldErrors.dismissalGrade)}
                  aria-describedby={
                    fieldErrors.dismissalGrade
                      ? "edit-exam-dismissal-grade-error"
                      : undefined
                  }
                  onChange={(e) =>
                    setEditDialog((prev) => ({
                      ...prev,
                      dismissalGrade: toLatinDigits(e.target.value),
                    }))
                  }
                />
                {noDiscount && (
                  <p className="text-xs text-sky-600">
                    معطل لأن الامتحان بدون خصم.
                  </p>
                )}
                <ExamEditFieldError
                  id="edit-exam-dismissal-grade-error"
                  message={fieldErrors.dismissalGrade}
                />
              </div>
            )}

            <div className="space-y-1">
              <Label>حالة الامتحان</Label>
              <Select
                value={editDialog.statusMode}
                onValueChange={(value) =>
                  setEditDialog((prev) => ({
                    ...prev,
                    statusMode: value as ExamStatusMode,
                    scheduledActivateAt:
                      value === "تفعيل مجدول" && !prev.scheduledActivateAt
                        ? defaultDateTimeForDate(prev.date)
                        : prev.scheduledActivateAt,
                  }))
                }
              >
                <SelectTrigger className={lightInputClass}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className={lightSelectContentClass}>
                  <SelectItem value="نشط">نشط</SelectItem>
                  <SelectItem value="تفعيل مجدول">تفعيل مجدول</SelectItem>
                  <SelectItem value="معطل">معطل</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {editDialog.statusMode === "تفعيل مجدول" && (
              <div className="space-y-1">
                <Label htmlFor="edit-exam-scheduled-activate-at">
                  تاريخ ووقت التفعيل
                </Label>
                <Input
                  id="edit-exam-scheduled-activate-at"
                  type="datetime-local"
                  className={lightInputClass}
                  value={editDialog.scheduledActivateAt}
                  aria-invalid={Boolean(fieldErrors.scheduledActivateAt)}
                  aria-describedby={
                    fieldErrors.scheduledActivateAt
                      ? "edit-exam-scheduled-activate-at-error"
                      : undefined
                  }
                  onChange={(e) =>
                    setEditDialog((prev) => ({
                      ...prev,
                      scheduledActivateAt: e.target.value,
                    }))
                  }
                />
                <ExamEditFieldError
                  id="edit-exam-scheduled-activate-at-error"
                  message={fieldErrors.scheduledActivateAt}
                />
              </div>
            )}
          </div>
        </div>

        {!isFormValid && formValidation.firstError ? (
          <div
            id="edit-exam-validation-summary"
            role="alert"
            aria-live="polite"
            className="rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm font-medium text-destructive"
          >
            لا يمكن حفظ التعديل حالياً: {formValidation.firstError}
          </div>
        ) : null}

        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={isMutating}>
            إلغاء
          </Button>
          <Button
            onClick={() => {
              if (isFormValid) void onSave(editDialog);
            }}
            disabled={isMutating || !isFormValid}
            aria-describedby={
              !isFormValid ? "edit-exam-validation-summary" : undefined
            }
          >
            {isMutating ? "جاري..." : "حفظ التعديل الكامل"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
