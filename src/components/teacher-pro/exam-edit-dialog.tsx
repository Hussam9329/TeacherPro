"use client";

import { useMemo, useState } from "react";
import type { Course, CourseChapter, Exam } from "@/lib/teacher-store";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { DateInput, DateTimeInput } from "@/components/ui/date-input";
import {
  Dialog,
  DialogContent,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { BookOpen, CalendarClock, ChevronDown, FilePen, SlidersHorizontal } from "lucide-react";
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
import { FormDialogHero } from "./form-dialog";
import "./exam-new.css";

export type ExamStatusMode = "نشط" | "تفعيل مجدول" | "معطل";

export type FullExamEditState = {
  id: string;
  mutationToken?: string;
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
  telegramOpenAt: string;
  telegramCloseAt: string;
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
    mutationToken: exam.mutationToken || "",
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
    telegramOpenAt: toDateTimeLocalValue(exam.telegramOpenAt),
    telegramCloseAt: toDateTimeLocalValue(exam.telegramCloseAt),
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
    <p id={id} role="alert" className="text-xs font-medium text-danger">
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
    telegramOpenAt: state.telegramOpenAt,
    telegramCloseAt: state.telegramCloseAt,
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
  // Like the add-exam page: a field shows its error once it was left or
  // after «حفظ» was pressed, never the moment the window opens.
  const [touchedFields, setTouchedFields] = useState<Record<string, true>>({});
  const [saveAttempted, setSaveAttempted] = useState(false);
  const fieldErrors = Object.fromEntries(
    Object.entries(formValidation.fieldErrors).filter(
      ([field]) => saveAttempted || field === "form" || touchedFields[field],
    ),
  ) as typeof formValidation.fieldErrors;
  const showValidationSummary =
    !isFormValid && Boolean(formValidation.firstError) && saveAttempted;

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
  const unavailableCourses = courses.filter(
    (course) => !hasActiveChapterLink(courseChapters, course.id),
  );
  const hasSelectedUnavailable = unavailableCourses.some((course) =>
    editDialog.courseIds.includes(course.id),
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
        className="tp-form-dialog tp-exam-edit-dialog max-w-5xl backdrop-blur-none [&>[data-slot=dialog-footer]]:backdrop-blur-none"
      >
        <FormDialogHero icon={FilePen} title="تعديل الامتحان بالكامل" />

        <div
          className="tp-form-dialog__body tp-exam-new"
          onBlurCapture={(event) => {
            const field = event.target.closest<HTMLElement>("[data-exam-field]");
            if (
              !field ||
              (event.relatedTarget instanceof Node &&
                field.contains(event.relatedTarget))
            )
              return;
            const key = field.dataset.examField;
            if (key)
              setTouchedFields((current) =>
                current[key] ? current : { ...current, [key]: true },
              );
          }}
        >
          <div className="tp-exam-new__main">
            <Card className="tp-exam-new__section">
              <CardHeader className="tp-exam-new__section-heading">
                <span className="tp-exam-new__section-icon">
                  <FilePen aria-hidden="true" />
                </span>
                <CardTitle>بيانات الامتحان</CardTitle>
              </CardHeader>
              <CardContent className="tp-exam-new__section-body">
                <div className="tp-exam-new__fields">
                  <div
                    data-exam-field="name"
                    className="tp-exam-new__field tp-exam-new__field--wide"
                  >
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

                  <div data-exam-field="type" className="tp-exam-new__field">
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

                  <div data-exam-field="date" className="tp-exam-new__field">
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
                </div>
              </CardContent>
            </Card>

            <Card className="tp-exam-new__section">
              <CardHeader className="tp-exam-new__section-heading">
                <span className="tp-exam-new__section-icon">
                  <BookOpen aria-hidden="true" />
                </span>
                <CardTitle>الدورات والمواقع</CardTitle>
              </CardHeader>
              <CardContent className="tp-exam-new__section-body">
                <div className="tp-exam-new__scope">
                  <div
                    data-exam-field="courseIds"
                    className="tp-exam-new__field"
                    role="group"
                    aria-labelledby="edit-exam-courses-label"
                    aria-describedby={
                      fieldErrors.courseIds ? "edit-exam-courses-error" : undefined
                    }
                  >
                    <div className="tp-exam-new__group-title">
                      <h3 id="edit-exam-courses-label">الدورات</h3>
                      {eligibleCourses.length > 0 && (
                        <Label
                          htmlFor="edit-exam-all-courses"
                          className="tp-exam-new__select-all"
                        >
                          <Checkbox
                            id="edit-exam-all-courses"
                            checked={allCoursesSelected}
                            onCheckedChange={() =>
                              setEditDialog((prev) => ({
                                ...prev,
                                courseIds: allCoursesSelected
                                  ? prev.courseIds.filter(
                                      (id) => !eligibleCourses.some((course) => course.id === id),
                                    )
                                  : Array.from(
                                      new Set([
                                        ...prev.courseIds,
                                        ...eligibleCourses.map((course) => course.id),
                                      ]),
                                    ),
                              }))
                            }
                          />
                          تحديد الكل
                        </Label>
                      )}
                    </div>
                    {eligibleCourses.length > 0 ? (
                      <div className="tp-exam-new__courses">
                        {eligibleCourses.map((course) => (
                          <Label
                            key={course.id}
                            htmlFor={`edit-exam-course-${course.id}`}
                            className="tp-exam-new__course"
                            data-selected={editDialog.courseIds.includes(course.id)}
                          >
                            <Checkbox
                              id={`edit-exam-course-${course.id}`}
                              checked={editDialog.courseIds.includes(course.id)}
                              onCheckedChange={() =>
                                setEditDialog((prev) => ({
                                  ...prev,
                                  courseIds: toggleSelection(prev.courseIds, course.id),
                                }))
                              }
                            />
                            <span className="tp-exam-new__course-copy">
                              <strong>{course.name}</strong>
                            </span>
                          </Label>
                        ))}
                      </div>
                    ) : (
                      <p className="tp-exam-new__course-note">
                        ماكو دورة بيها فصل نشط هسه.
                      </p>
                    )}
                    {unavailableCourses.length > 0 && (
                      <details
                        className="tp-exam-new__unavailable"
                        open={hasSelectedUnavailable || undefined}
                      >
                        <summary>
                          <span>
                            {unavailableCourses.length === 1
                              ? "دورة وحدة غير متاحة: بلا فصل نشط"
                              : `${unavailableCourses.length} دورات غير متاحة: بلا فصل نشط`}
                          </span>
                          <ChevronDown aria-hidden="true" />
                        </summary>
                        <ul className="tp-exam-new__unavailable-list">
                          {unavailableCourses.map((course) => {
                            const selected = editDialog.courseIds.includes(course.id);
                            return (
                              <li key={course.id}>
                                <Label
                                  htmlFor={`edit-exam-course-${course.id}`}
                                  className="tp-exam-new__unavailable-course"
                                >
                                  <Checkbox
                                    id={`edit-exam-course-${course.id}`}
                                    checked={selected}
                                    // A linked course that lost its chapter can only be taken off.
                                    disabled={!selected}
                                    onCheckedChange={() =>
                                      setEditDialog((prev) => ({
                                        ...prev,
                                        courseIds: prev.courseIds.filter((id) => id !== course.id),
                                      }))
                                    }
                                  />
                                  <span className="tp-exam-new__unavailable-copy">
                                    <strong>{course.name}</strong>
                                    <Badge variant="outline" className="w-fit border-warning-line bg-warning-soft text-[11px] text-warning">
                                      بدون فصل نشط
                                    </Badge>
                                  </span>
                                </Label>
                              </li>
                            );
                          })}
                        </ul>
                      </details>
                    )}
                    <ExamEditFieldError
                      id="edit-exam-courses-error"
                      message={fieldErrors.courseIds}
                    />
                  </div>

                  <div
                    data-exam-field="mainSites"
                    className="tp-exam-new__field"
                    role="group"
                    aria-labelledby="edit-exam-sites-label"
                    aria-describedby={
                      fieldErrors.mainSites ? "edit-exam-sites-error" : undefined
                    }
                  >
                    <div className="tp-exam-new__group-title">
                      <h3 id="edit-exam-sites-label">المواقع</h3>
                      <Label
                        htmlFor="edit-exam-all-sites"
                        className="tp-exam-new__select-all"
                      >
                        <Checkbox
                          id="edit-exam-all-sites"
                          checked={allSitesSelected}
                          onCheckedChange={() =>
                            setEditDialog((prev) => ({
                              ...prev,
                              mainSites: allSitesSelected ? [] : [...mainSitesForEdit],
                            }))
                          }
                        />
                        تحديد الكل
                      </Label>
                    </div>
                    <div className="tp-exam-new__sites">
                      {mainSitesForEdit.map((site, index) => (
                        <Label
                          key={site}
                          htmlFor={`edit-exam-site-${index}`}
                          className="tp-exam-new__site"
                          data-selected={editDialog.mainSites.includes(site)}
                        >
                          <Checkbox
                            id={`edit-exam-site-${index}`}
                            checked={editDialog.mainSites.includes(site)}
                            onCheckedChange={() =>
                              setEditDialog((prev) => ({
                                ...prev,
                                mainSites: toggleSelection(prev.mainSites, site),
                              }))
                            }
                          />
                          <span>{site}</span>
                        </Label>
                      ))}
                    </div>
                    <ExamEditFieldError
                      id="edit-exam-sites-error"
                      message={fieldErrors.mainSites}
                    />
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="tp-exam-new__section">
              <CardHeader className="tp-exam-new__section-heading">
                <span className="tp-exam-new__section-icon">
                  <SlidersHorizontal aria-hidden="true" />
                </span>
                <CardTitle>الدرجات والفرص</CardTitle>
              </CardHeader>
              <CardContent className="tp-exam-new__section-body">
                <Label htmlFor="edit-exam-no-discount" className="tp-exam-new__policy">
                  <Checkbox
                    id="edit-exam-no-discount"
                    checked={noDiscount}
                    onCheckedChange={(value) => {
                      const enabled = Boolean(value);
                      setEditDialog((prev) => ({
                        ...prev,
                        noDiscount: enabled,
                        // Keep the draft policy when temporarily disabling it.
                        // A stored no-discount exam starts safely at cutoff 0.
                        opportunitiesPenaltyNum:
                          !enabled && prev.type !== "فاينل" &&
                          Number(toLatinDigits(prev.opportunitiesPenaltyNum)) === 0
                            ? "1"
                            : prev.opportunitiesPenaltyNum,
                      }));
                    }}
                  />
                  <span>امتحان بدون خصم</span>
                </Label>
                <div className="tp-exam-new__fields">
                  <div data-exam-field="fullMark" className="tp-exam-new__field">
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
                        fieldErrors.fullMark ? "edit-exam-full-mark-error" : undefined
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
                  <div data-exam-field="passMark" className="tp-exam-new__field">
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
                        fieldErrors.passMark ? "edit-exam-pass-mark-error" : undefined
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
                  <div data-exam-field="discountMark" className="tp-exam-new__field">
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
                    <ExamEditFieldError
                      id="edit-exam-discount-mark-error"
                      message={fieldErrors.discountMark}
                    />
                  </div>
                  <div data-exam-field="opportunitiesPenalty" className="tp-exam-new__field">
                    <Label htmlFor="edit-exam-opportunities-penalty">خصم الفرص</Label>
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
                    <ExamEditFieldError
                      id="edit-exam-opportunities-penalty-error"
                      message={fieldErrors.opportunitiesPenalty}
                    />
                  </div>
                  {isFinalExam && (
                    <div data-exam-field="dismissalGrade" className="tp-exam-new__field">
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
                      <ExamEditFieldError
                        id="edit-exam-dismissal-grade-error"
                        message={fieldErrors.dismissalGrade}
                      />
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>

            <Card className="tp-exam-new__section">
              <CardHeader className="tp-exam-new__section-heading">
                <span className="tp-exam-new__section-icon">
                  <CalendarClock aria-hidden="true" />
                </span>
                <CardTitle>التفعيل والتسليم</CardTitle>
              </CardHeader>
              <CardContent className="tp-exam-new__section-body">
                <div className="tp-exam-new__fields">
                  <div className="tp-exam-new__field">
                    <Label htmlFor="edit-exam-status">حالة الامتحان</Label>
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
                      <SelectTrigger id="edit-exam-status" className={lightInputClass}>
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
                    <div data-exam-field="scheduledActivateAt" className="tp-exam-new__field">
                      <Label htmlFor="edit-exam-scheduled-activate-at">
                        تاريخ ووقت التفعيل
                      </Label>
                      <DateTimeInput
                        id="edit-exam-scheduled-activate-at"
                        className={lightInputClass}
                        value={editDialog.scheduledActivateAt}
                        aria-invalid={Boolean(fieldErrors.scheduledActivateAt)}
                        aria-describedby={
                          fieldErrors.scheduledActivateAt
                            ? "edit-exam-scheduled-activate-at-error"
                            : undefined
                        }
                        onChange={(value) =>
                          setEditDialog((prev) => ({
                            ...prev,
                            scheduledActivateAt: value,
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

                <div className="tp-exam-new__telegram">
                  <div>
                    <h3 className="tp-exam-new__group-title">نافذة تسليم الإجابات عبر تيليجرام</h3>
                    <p id="edit-exam-telegram-window-help" className="mt-1 text-xs leading-5 text-muted-foreground">
                      املأ الوقتين معاً، أو امسحهما معاً لتعطيل التسليم عبر تيليجرام.
                    </p>
                  </div>
                  <div className="tp-exam-new__fields">
                    <div data-exam-field="telegramOpenAt" className="tp-exam-new__field">
                      <Label htmlFor="edit-exam-telegram-open-at">فتح التسليم عبر تيليجرام</Label>
                      <DateTimeInput
                        id="edit-exam-telegram-open-at"
                        className={lightInputClass}
                        value={editDialog.telegramOpenAt}
                        aria-invalid={Boolean(fieldErrors.telegramOpenAt)}
                        aria-describedby={`edit-exam-telegram-window-help${fieldErrors.telegramOpenAt ? " edit-exam-telegram-open-at-error" : ""}`}
                        onChange={(value) =>
                          setEditDialog((prev) => ({
                            ...prev,
                            telegramOpenAt: value,
                          }))
                        }
                      />
                      <ExamEditFieldError
                        id="edit-exam-telegram-open-at-error"
                        message={fieldErrors.telegramOpenAt}
                      />
                    </div>
                    <div data-exam-field="telegramCloseAt" className="tp-exam-new__field">
                      <Label htmlFor="edit-exam-telegram-close-at">إغلاق التسليم عبر تيليجرام</Label>
                      <DateTimeInput
                        id="edit-exam-telegram-close-at"
                        min={editDialog.telegramOpenAt || undefined}
                        className={lightInputClass}
                        value={editDialog.telegramCloseAt}
                        aria-invalid={Boolean(fieldErrors.telegramCloseAt)}
                        aria-describedby={`edit-exam-telegram-window-help${fieldErrors.telegramCloseAt ? " edit-exam-telegram-close-at-error" : ""}`}
                        onChange={(value) =>
                          setEditDialog((prev) => ({
                            ...prev,
                            telegramCloseAt: value,
                          }))
                        }
                      />
                      <ExamEditFieldError
                        id="edit-exam-telegram-close-at-error"
                        message={fieldErrors.telegramCloseAt}
                      />
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>

        {showValidationSummary ? (
          <div
            id="edit-exam-validation-summary"
            role="alert"
            aria-live="polite"
            className="mx-4 mb-3 shrink-0 rounded-xl border border-danger-line border-s-4 border-s-danger-vivid bg-danger-soft px-4 py-3 text-sm font-medium text-danger sm:mx-5"
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
              // An invalid form never saves; pressing «حفظ» shows why.
              setSaveAttempted(true);
              if (isFormValid) void onSave(editDialog);
            }}
            disabled={isMutating}
            aria-describedby={
              showValidationSummary ? "edit-exam-validation-summary" : undefined
            }
          >
            {isMutating ? "جاري..." : "حفظ التعديل الكامل"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
