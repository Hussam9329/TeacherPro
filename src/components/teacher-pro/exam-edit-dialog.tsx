"use client";

import React, { useState } from "react";
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

export type ExamStatusMode = "نشط" | "تفعيل مجدول" | "تعطيل مجدول" | "معطل";

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
  scheduledDeactivateAt: string;
};

function toDateTimeLocalValue(value?: string | null) {
  return toBaghdadDateTimeLocal(value);
}

function defaultDateTimeForDate(date: string) {
  return `${date || baghdadTodayKey()}T08:00`;
}

function defaultDeactivateDateTime(exam: Exam) {
  return (
    toDateTimeLocalValue(exam.scheduledDeactivateAt) ||
    `${exam.date || baghdadTodayKey()}T08:00`
  );
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
    scheduledDeactivateAt:
      toDateTimeLocalValue(exam.scheduledDeactivateAt) ||
      defaultDeactivateDateTime(exam),
  };
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

  const isFinalExam = editDialog.type === "فاينل";
  const noDiscount = Boolean(editDialog.noDiscount);
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
                onChange={(e) =>
                  setEditDialog((prev) => ({ ...prev, name: e.target.value }))
                }
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
                        : prev.discountMark || "45",
                    opportunitiesPenaltyNum:
                      value === "فاينل" || prev.noDiscount
                        ? "0"
                        : prev.opportunitiesPenaltyNum || "1",
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
                onChange={(value) =>
                  setEditDialog((prev) => ({
                    ...prev,
                    date: value,
                    scheduledActivateAt:
                      prev.statusMode === "تفعيل مجدول"
                        ? defaultDateTimeForDate(value)
                        : prev.scheduledActivateAt,
                    scheduledDeactivateAt:
                      prev.statusMode === "تعطيل مجدول"
                        ? defaultDateTimeForDate(value)
                        : prev.scheduledDeactivateAt,
                  }))
                }
              />
            </div>

            <div className="space-y-1 md:col-span-2">
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
            </div>

            <div className="space-y-1 md:col-span-2">
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
            </div>

            <div className="space-y-1">
              <Label>الدرجة الكاملة</Label>
              <Input
                type="number"
                step={1}
                className={lightInputClass}
                value={editDialog.fullMark}
                onChange={(e) =>
                  setEditDialog((prev) => ({
                    ...prev,
                    fullMark: toLatinDigits(e.target.value),
                  }))
                }
              />
            </div>
            <div className="space-y-1">
              <Label>درجة النجاح</Label>
              <Input
                type="number"
                step={1}
                className={lightInputClass}
                value={editDialog.passMark}
                onChange={(e) =>
                  setEditDialog((prev) => ({
                    ...prev,
                    passMark: toLatinDigits(e.target.value),
                  }))
                }
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
              <Label>درجة الخصم</Label>
              <Input
                type="number"
                step={1}
                className={lightInputClass}
                disabled={isFinalExam || noDiscount}
                value={isFinalExam || noDiscount ? "0" : editDialog.discountMark}
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
              {!noDiscount &&
                !isFinalExam &&
                Number(editDialog.passMark) <= Number(editDialog.discountMark) && (
                  <p className="text-xs text-destructive">
                    درجة النجاح يجب أن تكون أكبر من درجة الخصم.
                  </p>
                )}
            </div>

            <div className="space-y-1">
              <Label>خصم الفرص</Label>
              <Input
                type="number"
                step={1}
                className={lightInputClass}
                disabled={isFinalExam || noDiscount}
                value={
                  isFinalExam || noDiscount
                    ? "0"
                    : editDialog.opportunitiesPenaltyNum
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
            </div>

            {isFinalExam && (
              <div className="space-y-1">
                <Label>درجة الفصل</Label>
                <Input
                  type="number"
                  step={1}
                  className={lightInputClass}
                  disabled={noDiscount}
                  value={noDiscount ? "" : editDialog.dismissalGrade}
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
                    scheduledDeactivateAt:
                      value === "تعطيل مجدول" && !prev.scheduledDeactivateAt
                        ? defaultDateTimeForDate(prev.date)
                        : prev.scheduledDeactivateAt,
                  }))
                }
              >
                <SelectTrigger className={lightInputClass}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className={lightSelectContentClass}>
                  <SelectItem value="نشط">نشط</SelectItem>
                  <SelectItem value="تفعيل مجدول">تفعيل مجدول</SelectItem>
                  <SelectItem value="تعطيل مجدول">تعطيل مجدول</SelectItem>
                  <SelectItem value="معطل">معطل</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {editDialog.statusMode === "تفعيل مجدول" && (
              <div className="space-y-1">
                <Label>تاريخ ووقت التفعيل</Label>
                <Input
                  type="datetime-local"
                  className={lightInputClass}
                  value={editDialog.scheduledActivateAt}
                  onChange={(e) =>
                    setEditDialog((prev) => ({
                      ...prev,
                      scheduledActivateAt: e.target.value,
                    }))
                  }
                />
              </div>
            )}
            {editDialog.statusMode === "تعطيل مجدول" && (
              <div className="space-y-1">
                <Label>تاريخ ووقت التعطيل</Label>
                <Input
                  type="datetime-local"
                  className={lightInputClass}
                  value={editDialog.scheduledDeactivateAt}
                  onChange={(e) =>
                    setEditDialog((prev) => ({
                      ...prev,
                      scheduledDeactivateAt: e.target.value,
                    }))
                  }
                />
              </div>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={isMutating}>
            إلغاء
          </Button>
          <Button
            onClick={() => void onSave(editDialog)}
            disabled={isMutating}
          >
            {isMutating ? "جاري..." : "حفظ التعديل الكامل"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
