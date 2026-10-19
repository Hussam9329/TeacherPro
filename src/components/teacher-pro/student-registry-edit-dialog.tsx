"use client";

import type { Dispatch, SetStateAction, RefObject } from "react";
import { type Course, type CourseTransferPolicy, type Student } from "@/lib/teacher-store";
import { type StudentAcademicUpdateImpactResponse } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DateInput } from "@/components/ui/date-input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { formatAppDate } from "@/lib/format";
import { COURSE_TERMS, OUT_OF_COUNTRY_LOCATION_SCOPE } from "@/lib/course-config";
import { formatOpportunityBalance } from "@/lib/opportunity-balance";
import {
  UserPen,
  UserRound,
  AlertTriangle,
  BookOpen,
  PhoneCall,
  X,
  Save,
} from "lucide-react";
import { FormDialogHero } from "./form-dialog";
import { emptyEditForm, academicImpactKindLabel, type StudentEditForm } from "./student-registry-helpers";
import {
  studentEditFieldLabels,
  resolveStudentEditRecovery,
  type StudentEditRecovery,
  type StudentEditRecoveryChoice,
} from "./student-edit-recovery";
import { displayReasonText } from "@/lib/reason-display";

export type StudentRegistryEditDialogProps = {
  editDialog: { open: boolean; id: string; form: StudentEditForm; };
  isSavingEdit: boolean;
  setEditDialog: Dispatch<SetStateAction<{ open: boolean; id: string; form: StudentEditForm; }>>;
  editRecoveryRequestRef: RefObject<number>;
  setEditRecoveryReason: Dispatch<SetStateAction<"conflict" | "unknown" | null>>;
  setEditRecovery: Dispatch<SetStateAction<{ student: Student; review: StudentEditRecovery; } | null>>;
  setEditRecoveryLoading: Dispatch<SetStateAction<boolean>>;
  setEditOriginalStudent: Dispatch<SetStateAction<Student | null>>;
  setCourseTransferPolicy: Dispatch<SetStateAction<"" | CourseTransferPolicy>>;
  editRecoveryReason: "conflict" | "unknown" | null;
  editRecoveryPanel: RefObject<HTMLDivElement | null>;
  editRecovery: { student: Student; review: StudentEditRecovery; } | null;
  editRecoveryChoices: Partial<Record<keyof StudentEditForm, StudentEditRecoveryChoice>>;
  setEditRecoveryChoices: Dispatch<SetStateAction<Partial<Record<keyof StudentEditForm, StudentEditRecoveryChoice>>>>;
  courses: Course[];
  loadEditRecovery: () => Promise<void>;
  editRecoveryLoading: boolean;
  acceptEditRecovery: () => void;
  mergeStudentsCache: (students: Student[]) => void;
  setServerRefreshKey: Dispatch<SetStateAction<number>>;
  updateEditForm: (key: keyof StudentEditForm, value: string) => void;
  editOriginalGraceText: string;
  editNeedsAcademicImpactPreview: boolean;
  hasCurrentAcademicImpactPreview: boolean;
  academicImpactPreview: StudentAcademicUpdateImpactResponse | null;
  academicImpactConfirmed: boolean;
  setAcademicImpactConfirmed: Dispatch<SetStateAction<boolean>>;
  academicImpactLoading: boolean;
  editFilteredCourses: Course[];
  editOriginalStudent: Student | null;
  editNeedsTransferPolicy: boolean;
  editCourseChanged: boolean;
  effectiveCourseTransferPolicy: "" | CourseTransferPolicy;
  editResetChapterUnresolved: boolean;
  editTargetActiveChapterLoading: boolean;
  editTargetActiveChapterLookupFailed: boolean;
  editTargetActiveChapterConflict: boolean;
  editAvailablePrograms: ("منهج كامل" | "كورسات")[];
  editEffectiveCourseProgram: string;
  editAvailableStudyTypes: ("إلكتروني" | "حضوري" | "مدمج")[];
  editLocationScopes: ("بغداد" | "محافظات")[];
  isEditOutOfCountry: boolean;
  editSubSiteOptions: string[];
  updateEditTelegram: (value: string) => void;
  isAdmin: boolean;
  updateEditUsername: (value: string) => void;
  updateEditPhone: (key: "phone" | "parentPhone", value: string) => void;
  handleEditSave: () => Promise<void>;
};

export function StudentRegistryEditDialog({
  editDialog,
  isSavingEdit,
  setEditDialog,
  editRecoveryRequestRef,
  setEditRecoveryReason,
  setEditRecovery,
  setEditRecoveryLoading,
  setEditOriginalStudent,
  setCourseTransferPolicy,
  editRecoveryReason,
  editRecoveryPanel,
  editRecovery,
  editRecoveryChoices,
  setEditRecoveryChoices,
  courses,
  loadEditRecovery,
  editRecoveryLoading,
  acceptEditRecovery,
  mergeStudentsCache,
  setServerRefreshKey,
  updateEditForm,
  editOriginalGraceText,
  editNeedsAcademicImpactPreview,
  hasCurrentAcademicImpactPreview,
  academicImpactPreview,
  academicImpactConfirmed,
  setAcademicImpactConfirmed,
  academicImpactLoading,
  editFilteredCourses,
  editOriginalStudent,
  editNeedsTransferPolicy,
  editCourseChanged,
  effectiveCourseTransferPolicy,
  editResetChapterUnresolved,
  editTargetActiveChapterLoading,
  editTargetActiveChapterLookupFailed,
  editTargetActiveChapterConflict,
  editAvailablePrograms,
  editEffectiveCourseProgram,
  editAvailableStudyTypes,
  editLocationScopes,
  isEditOutOfCountry,
  editSubSiteOptions,
  updateEditTelegram,
  isAdmin,
  updateEditUsername,
  updateEditPhone,
  handleEditSave,
}: StudentRegistryEditDialogProps) {
  return (
    <Dialog
      open={editDialog.open}
      onOpenChange={(open) => {
        if (isSavingEdit) return;
        setEditDialog((prev) => ({ ...prev, open }));
        if (!open) {
          editRecoveryRequestRef.current += 1;
          setEditRecoveryReason(null);
          setEditRecovery(null);
          setEditRecoveryLoading(false);
          setEditOriginalStudent(null);
          setCourseTransferPolicy("");
        }
      }}
    >
      <DialogContent dir="rtl" className="tp-form-dialog tp-registry-editor sm:max-w-3xl">
        <FormDialogHero icon={UserPen} title="تعديل بيانات الطالب" />
        <div className="tp-form-dialog__body tp-registry-editor__body">
          {editRecoveryReason && (
            <div
              ref={editRecoveryPanel}
              tabIndex={-1}
              role="region"
              aria-label="مراجعة أحدث بيانات الطالب"
              className="mb-4 space-y-3 rounded-2xl border border-warning-line border-s-4 border-s-warning-vivid bg-warning-soft p-4 text-sm outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              <p className="font-bold">
                {editRecoveryReason === "unknown"
                  ? "تعذّر تأكيد نتيجة الحفظ؛ راجع أحدث سجل"
                  : "تحتاج نسخة التعديل إلى تحديث"}
              </p>
              <p className="text-xs leading-6">
                تعديلاتك ما زالت موجودة. راجع أحدث سجل قبل إعادة الحفظ؛ تحميله لا يغيّر أي بيانات.
              </p>
              {editRecovery && (
                <div className="space-y-3">
                  <div className="rounded-xl border bg-background p-3 text-xs leading-6">
                    <p>المحفوظ الآن: {editRecovery.student.status} · الفرص: {formatOpportunityBalance(editRecovery.student)}</p>
                    {editRecoveryReason === "unknown" && editRecovery.review.matchesDraft && (
                      <p className="mt-2 font-bold">القيم الحالية تطابق ما كتبته؛ قد تكون العملية السابقة حُفظت بالفعل.</p>
                    )}
                  </div>
                  {editRecovery.review.conflicts.length ? (
                    <div className="space-y-3">
                      <p className="text-xs font-bold">تغيّرت هذه الحقول أيضاً في النظام؛ اختر القيمة التي تريدها:</p>
                      {editRecovery.review.conflicts.map((conflict) => (
                        <fieldset key={conflict.field} className="min-w-0 rounded-xl border bg-background p-3">
                          <legend className="px-1 text-xs font-bold">{studentEditFieldLabels[conflict.field]}</legend>
                          <RadioGroup
                            value={editRecoveryChoices[conflict.field] || ""}
                            onValueChange={(value) => {
                              if (value === "draft" || value === "latest") {
                                setEditRecoveryChoices((current) => ({ ...current, [conflict.field]: value }));
                              }
                            }}
                            className="grid gap-2 sm:grid-cols-2"
                          >
                            {(["latest", "draft"] as const).map((choice) => {
                              const id = `student-recovery-${conflict.field}-${choice}`;
                              const value = conflict[choice];
                              const display = conflict.field === "courseId"
                                ? courses.find((course) => course.id === value)?.name || value
                                : value;
                              return (
                                <Label key={choice} htmlFor={id} className="flex min-w-0 cursor-pointer items-start gap-2 rounded-lg border p-3 text-xs leading-6">
                                  <RadioGroupItem id={id} value={choice} className="mt-1 shrink-0" />
                                  <span className="min-w-0 break-words">
                                    <span className="block text-muted-foreground">{choice === "latest" ? "المحفوظ الآن" : "تعديلي"}</span>
                                    {display || "فارغ"}
                                  </span>
                                </Label>
                              );
                            })}
                          </RadioGroup>
                        </fieldset>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs leading-6">ماكو تعارض بين الحقول. سنحتفظ بتعديلاتك ونحدّث الحقول التي لم تعدّلها، ثم تراجع الأثر من جديد.</p>
                  )}
                </div>
              )}
              <div className="flex flex-wrap gap-2">
                <Button type="button" size="sm" variant="outline" onClick={() => void loadEditRecovery()} disabled={editRecoveryLoading}>
                  {editRecoveryLoading ? "جاري جلب أحدث سجل…" : editRecovery ? "تحديث المراجعة" : "مراجعة أحدث بيانات الطالب"}
                </Button>
                {editRecovery && (
                  <Button type="button" size="sm" onClick={acceptEditRecovery} disabled={editRecoveryLoading || !resolveStudentEditRecovery(editRecovery.review, editRecoveryChoices)}>
                    اعتماد المراجعة دون حفظ
                  </Button>
                )}
                {editRecoveryReason === "unknown" && editRecovery && (
                  <Button type="button" size="sm" variant="outline" onClick={() => {
                    editRecoveryRequestRef.current += 1;
                    mergeStudentsCache([editRecovery.student]);
                    setServerRefreshKey((value) => value + 1);
                    setEditDialog({ open: false, id: "", form: emptyEditForm });
                    setEditOriginalStudent(null);
                    setEditRecoveryReason(null);
                    setEditRecovery(null);
                    setEditRecoveryLoading(false);
                  }} disabled={editRecoveryLoading}>
                    إغلاق بدون إعادة الحفظ
                  </Button>
                )}
              </div>
            </div>
          )}
          <div>
            <fieldset disabled={Boolean(editRecoveryReason) || isSavingEdit} className="min-w-0 space-y-4">
              <section className="tp-registry-editor__section">
                <div className="mb-4 flex items-center gap-2">
                  <UserRound className="size-5 text-primary" />
                  <div>
                    <h3 className="font-black">بيانات الطالب</h3>
                  </div>
                </div>
                <div className="tp-registry-editor__fields">
                  <div className="space-y-2 tp-registry-editor__wide">
                    <Label htmlFor="edit-name">اسم الطالب</Label>
                    <Input
                      id="edit-name"
                      name="name"
                      autoComplete="off"
                      value={editDialog.form.name}
                      onChange={(e) => updateEditForm("name", e.target.value)}
                      required
                      placeholder="اسم الطالب الرباعي"
                      className="h-11 rounded-xl"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="edit-school">اسم المدرسة</Label>
                    <Input
                      id="edit-school"
                      name="school"
                      autoComplete="off"
                      value={editDialog.form.school}
                      onChange={(e) =>
                        updateEditForm("school", e.target.value)
                      }
                      required
                      placeholder="اسم المدرسة"
                      className="h-11 rounded-xl"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="edit-gender">الجنس</Label>
                    <Select
                      name="gender"
                      value={editDialog.form.gender}
                      onValueChange={(v) => updateEditForm("gender", v)}
                    >
                      <SelectTrigger
                        id="edit-gender"
                        className="h-11 rounded-xl"
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="ذكر">ذكر</SelectItem>
                        <SelectItem value="أنثى">أنثى</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="tp-registry-editor__fields">
                  <div className="space-y-2">
                    <Label htmlFor="edit-createdAt">
                      تاريخ إضافة الطالب
                    </Label>
                    <DateInput
                      id="edit-createdAt"
                      name="createdAt"
                      autoComplete="off"
                      value={editDialog.form.createdAt}
                      onChange={(value) => updateEditForm("createdAt", value)}
                      required
                    />
                  </div>
                </div>

                {editOriginalGraceText && (
                  <p className="mt-4 rounded-xl border border-primary/20 bg-primary/5 px-3 py-2 text-xs leading-6">
                    {editOriginalGraceText}. تُعدّل فترة السماح من شاشة «إدارة
                    فترة السماح».
                  </p>
                )}

                {editNeedsAcademicImpactPreview && (
                  <div className="mt-4 rounded-2xl border border-warning-line border-s-4 border-s-warning-vivid bg-warning-soft p-4 text-sm text-warning">
                    <div className="flex items-start gap-2">
                      <AlertTriangle className="mt-0.5 size-5 shrink-0" />
                      <div className="min-w-0 flex-1">
                        <p className="font-black">
                          تغيير تاريخ التسجيل يعيد تفسير الامتحانات القديمة
                        </p>
                        {!hasCurrentAcademicImpactPreview ? (
                          <p className="mt-1 text-xs leading-6 opacity-90">
                            سيظهر أثر التعديل على الدرجات والفرص قبل الحفظ
                            لتأكيده.
                          </p>
                        ) : academicImpactPreview ? (
                          <div className="mt-3 space-y-3">
                            <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
                              <div className="rounded-xl bg-background/80 p-3 text-foreground">
                                <p className="text-xs text-muted-foreground">
                                  درجات تغير تفسيرها
                                </p>
                                <p className="mt-1 text-xl font-black">
                                  {academicImpactPreview.impact.changedGrades}
                                </p>
                              </div>
                              <div className="rounded-xl bg-background/80 p-3 text-foreground">
                                <p className="text-xs text-muted-foreground">
                                  أصبحت محمية
                                </p>
                                <p className="mt-1 text-xl font-black">
                                  {
                                    academicImpactPreview.impact
                                      .becameProtected
                                  }
                                </p>
                              </div>
                              <div className="rounded-xl bg-background/80 p-3 text-foreground">
                                <p className="text-xs text-muted-foreground">
                                  عادت للمحاسبة
                                </p>
                                <p className="mt-1 text-xl font-black">
                                  {
                                    academicImpactPreview.impact
                                      .becameChargeable
                                  }
                                </p>
                              </div>
                              <div className="rounded-xl bg-background/80 p-3 text-foreground">
                                <p className="text-xs text-muted-foreground">
                                  الفرص المتوقعة
                                </p>
                                <p className="mt-1 text-xl font-black">
                                  {academicImpactPreview.projection?.current
                                    .opportunities ?? "—"}{" "}
                                  ←{" "}
                                  {academicImpactPreview.projection?.projected
                                    .opportunities ?? "—"}
                                </p>
                              </div>
                            </div>
                            {academicImpactPreview.projection && (
                              <p className="rounded-xl bg-background/80 p-3 text-xs leading-6 text-foreground">
                                الحالة المتوقعة:{" "}
                                {
                                  academicImpactPreview.projection.current
                                    .status
                                }{" "}
                                ←{" "}
                                {
                                  academicImpactPreview.projection.projected
                                    .status
                                }
                                {academicImpactPreview.projection.projected
                                  .dismissalReason
                                  ? ` — ${displayReasonText(academicImpactPreview.projection.projected.dismissalReason)}`
                                  : ""}
                              </p>
                            )}
                            {academicImpactPreview.impact.sample.length >
                              0 && (
                              <div className="max-h-48 space-y-2 overflow-y-auto">
                                {academicImpactPreview.impact.sample.map(
                                  (item) => (
                                    <div
                                      key={item.examId}
                                      className="rounded-xl bg-background/80 p-3 text-xs text-foreground"
                                    >
                                      <p className="font-bold">
                                        {item.examName} —{" "}
                                        {formatAppDate(item.examDate)}
                                      </p>
                                      <p className="mt-1 text-muted-foreground">
                                        {academicImpactKindLabel(item.before)}{" "}
                                        ←{" "}
                                        {academicImpactKindLabel(item.after)}
                                      </p>
                                    </div>
                                  ),
                                )}
                              </div>
                            )}
                            <Button
                              type="button"
                              variant={
                                academicImpactConfirmed
                                  ? "default"
                                  : "outline"
                              }
                              onClick={() =>
                                setAcademicImpactConfirmed((value) => !value)
                              }
                              className="min-h-11 w-full rounded-xl sm:w-auto"
                            >
                              {academicImpactConfirmed
                                ? "تم تأكيد الأثر — يمكن الحفظ"
                                : "أؤكد تطبيق هذا الأثر عند الحفظ"}
                            </Button>
                          </div>
                        ) : null}
                        {academicImpactLoading && (
                          <p className="mt-2 text-xs font-bold">
                            جاري حساب أثر التعديل…
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </section>

              <section className="tp-registry-editor__section">
                <div className="mb-4 flex items-center gap-2">
                  <BookOpen className="size-5 text-primary" />
                  <div>
                    <h3 className="font-black">الاشتراك</h3>
                  </div>
                </div>
                <div className="tp-registry-editor__fields">
                  <div className="space-y-2 tp-registry-editor__wide">
                    <Label htmlFor="edit-courseId">اسم الدورة</Label>
                    <Select
                      name="courseId"
                      value={editDialog.form.courseId}
                      onValueChange={(v) => {
                        setEditDialog((prev) => ({
                          ...prev,
                          form: {
                            ...prev.form,
                            courseId: v,
                            courseProgram: "",
                            courseTerm: "",
                            studyType: "",
                            locationScope: "",
                            baghdadMode: "",
                            subSite: "",
                          },
                        }));
                      }}
                      disabled={editFilteredCourses.length === 0}
                    >
                      <SelectTrigger
                        id="edit-courseId"
                        className="h-11 rounded-xl"
                      >
                        <SelectValue
                          placeholder={
                            editFilteredCourses.length === 0
                              ? "ماكو دورات مسجلة"
                              : "اختر اسم الدورة"
                          }
                        />
                      </SelectTrigger>
                      <SelectContent>
                        {editFilteredCourses.length === 0 ? (
                          <div className="px-3 py-2 text-sm text-muted-foreground">
                            ماكو دورات مسجلة
                          </div>
                        ) : (
                          editFilteredCourses.map((c) => (
                            <SelectItem key={c.id} value={c.id}>
                              {c.name}
                              {!c.active &&
                              c.id === editOriginalStudent?.courseId
                                ? " — الدورة الحالية (غير نشطة)"
                                : ""}
                            </SelectItem>
                          ))
                        )}
                      </SelectContent>
                    </Select>
                  </div>

                  {editNeedsTransferPolicy && editOriginalStudent && (
                    <div className="tp-registry-editor__wide rounded-2xl border border-warning-line border-s-4 border-s-warning-vivid bg-warning-soft p-3 text-sm text-warning">
                      {editCourseChanged && (
                        <p className="mb-2 flex items-center gap-2 font-black">
                          <AlertTriangle aria-hidden="true" className="size-4 shrink-0" />
                          نقل إلى دورة جديدة — سيبدأ الطالب بملف نظيف
                        </p>
                      )}
                      <RadioGroup
                        value={effectiveCourseTransferPolicy}
                        onValueChange={(value) => {
                          setCourseTransferPolicy(
                            value as CourseTransferPolicy,
                          );
                          setAcademicImpactConfirmed(false);
                        }}
                        className="flex flex-wrap gap-2"
                      >
                        {!editCourseChanged && (
                          <label className="flex min-h-11 cursor-pointer items-center gap-2 rounded-xl border bg-background/80 px-3 font-bold text-foreground transition hover:border-primary/50">
                            <RadioGroupItem value="keep" />
                            الإبقاء على ملفه
                          </label>
                        )}
                        <label className="flex min-h-11 cursor-pointer items-center gap-2 rounded-xl border bg-background/80 px-3 font-bold text-foreground transition hover:border-primary/50">
                          <RadioGroupItem value="reset" />
                          {editCourseChanged
                            ? "تأكيد النقل كطالب جديد"
                            : "اعتباره طالباً جديداً"}
                        </label>
                      </RadioGroup>

                      {effectiveCourseTransferPolicy === "reset" &&
                        editResetChapterUnresolved && (
                          <p
                            className="mt-2 text-xs font-bold"
                            aria-live="polite"
                          >
                            {editTargetActiveChapterLoading
                              ? "جاري التحقق من الفصل النشط…"
                              : editTargetActiveChapterLookupFailed
                                ? "تعذر التحقق من الفصل النشط. أعد المحاولة."
                                : editTargetActiveChapterConflict
                                  ? "للدورة أكثر من فصل نشط؛ حلّ التعارض أولاً."
                                  : "ماكو فصل نشط لهذه الدورة؛ فعّل فصلاً أولاً."}
                          </p>
                        )}
                    </div>
                  )}

                  {editDialog.form.courseId &&
                    editAvailablePrograms.length > 1 && (
                      <div className="space-y-2">
                        <Label htmlFor="edit-courseProgram">نظام الاشتراك</Label>
                        <Select
                          name="courseProgram"
                          value={editDialog.form.courseProgram}
                          onValueChange={(v) =>
                            setEditDialog((prev) => ({
                              ...prev,
                              form: {
                                ...prev.form,
                                courseProgram: v,
                                courseTerm:
                                  v === "كورسات" ? prev.form.courseTerm : "",
                                studyType: "",
                                locationScope: "",
                                baghdadMode: "",
                                subSite: "",
                              },
                            }))
                          }
                        >
                          <SelectTrigger
                            id="edit-courseProgram"
                            className="h-11 rounded-xl"
                          >
                            <SelectValue placeholder="اختر نظام الاشتراك..." />
                          </SelectTrigger>
                          <SelectContent>
                            {editAvailablePrograms.map((p) => (
                              <SelectItem key={p} value={p}>
                                {p}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    )}

                  {editEffectiveCourseProgram === "كورسات" && (
                    <div className="space-y-2">
                      <Label htmlFor="edit-courseTerm">الكورس المطلوب</Label>
                      <Select
                        name="courseTerm"
                        value={editDialog.form.courseTerm}
                        onValueChange={(v) => updateEditForm("courseTerm", v)}
                      >
                        <SelectTrigger
                          id="edit-courseTerm"
                          className="h-11 rounded-xl"
                        >
                          <SelectValue placeholder="اختر الكورس المطلوب..." />
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
                  )}

                  {editDialog.form.courseId &&
                    editAvailableStudyTypes.length > 0 && (
                      <div className="space-y-2">
                        <Label htmlFor="edit-studyType">نظام الدراسة</Label>
                        <Select
                          name="studyType"
                          value={editDialog.form.studyType}
                          onValueChange={(v) =>
                            setEditDialog((prev) => ({
                              ...prev,
                              form: {
                                ...prev.form,
                                studyType: v,
                                locationScope: "",
                                baghdadMode: "",
                                subSite: "",
                              },
                            }))
                          }
                        >
                          <SelectTrigger
                            id="edit-studyType"
                            className="h-11 rounded-xl"
                          >
                            <SelectValue placeholder="اختر نظام الدراسة..." />
                          </SelectTrigger>
                          <SelectContent>
                            {editAvailableStudyTypes.map((t) => (
                              <SelectItem key={t} value={t}>
                                {t}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    )}
                </div>
                <div className="tp-registry-editor__fields mt-4">
                  {editDialog.form.studyType &&
                  editLocationScopes.length > 0 ? (
                    <div className="space-y-2">
                      <Label htmlFor="edit-locationScope">الموقع</Label>
                      <Select
                        name="locationScope"
                        value={
                          isEditOutOfCountry
                            ? ""
                            : editDialog.form.locationScope
                        }
                        onValueChange={(v) =>
                          setEditDialog((prev) => ({
                            ...prev,
                            form: {
                              ...prev.form,
                              locationScope: v,
                              subSite: "",
                            },
                          }))
                        }
                      >
                        <SelectTrigger
                          id="edit-locationScope"
                          className="h-11 rounded-xl"
                        >
                          <SelectValue placeholder="اختر الموقع..." />
                        </SelectTrigger>
                        <SelectContent>
                          {editLocationScopes.map((s) => (
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
                          checked={isEditOutOfCountry}
                          onChange={(event) =>
                            setEditDialog((prev) => ({
                              ...prev,
                              form: {
                                ...prev.form,
                                locationScope: event.target.checked
                                  ? OUT_OF_COUNTRY_LOCATION_SCOPE
                                  : "",
                                baghdadMode: "",
                                subSite: "",
                              },
                            }))
                          }
                        />
                        الطالب خارج القطر
                      </label>
                    </div>
                  ) : (
                    <div className="rounded-2xl border border-dashed bg-muted/30 p-4 text-sm text-muted-foreground tp-registry-editor__wide">
                      اختر اسم الدورة ونظام الدراسة لعرض خيارات الموقع.
                    </div>
                  )}

                  {isEditOutOfCountry && (
                    <div className="space-y-2">
                      <Label htmlFor="edit-outOfCountrySite">الدولة</Label>
                      <Input
                        id="edit-outOfCountrySite"
                        name="subSite"
                        autoComplete="off"
                        value={editDialog.form.subSite}
                        onChange={(e) =>
                          updateEditForm("subSite", e.target.value)
                        }
                        placeholder="مثلاً: تركيا"
                        required
                        className="h-11 rounded-xl"
                      />
                    </div>
                  )}

                  {editDialog.form.locationScope &&
                    !isEditOutOfCountry &&
                    editSubSiteOptions.length > 0 && (
                      <div className="space-y-2">
                        <Label htmlFor="edit-subSite">الموقع الفرعي</Label>
                        <Select
                          name="subSite"
                          value={editDialog.form.subSite}
                          onValueChange={(v) => updateEditForm("subSite", v)}
                        >
                          <SelectTrigger
                            id="edit-subSite"
                            className="h-11 rounded-xl"
                          >
                            <SelectValue placeholder="اختر الموقع الفرعي..." />
                          </SelectTrigger>
                          <SelectContent>
                            {editSubSiteOptions.map((s) => (
                              <SelectItem key={s} value={s}>
                                {s}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    )}
                </div>
              </section>

              <section className="tp-registry-editor__section">
                <div className="mb-4 flex items-center gap-2">
                  <PhoneCall className="size-5 text-primary" />
                  <div>
                    <h3 className="font-black">التواصل</h3>
                  </div>
                </div>
                <div className="tp-registry-editor__fields">
                  <div className="space-y-2">
                    <Label htmlFor="edit-telegram">معرف التليگرام</Label>
                    <Input
                      id="edit-telegram"
                      name="telegram"
                      autoComplete="off"
                      value={editDialog.form.telegram}
                      onChange={(e) => updateEditTelegram(e.target.value)}
                      disabled={!isAdmin}
                      placeholder="username بدون @"
                      className="h-11 rounded-xl"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="edit-username">
                      يوزر التليگرام (المستعاد)
                    </Label>
                    <Input
                      id="edit-username"
                      name="username"
                      autoComplete="off"
                      value={editDialog.form.username}
                      onChange={(e) => updateEditUsername(e.target.value)}
                      placeholder="يوزر إضافي بدون @ (اختياري)"
                      className="h-11 rounded-xl"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="edit-phone">رقم هاتف الطالب</Label>
                    <Input
                      id="edit-phone"
                      name="phone"
                      autoComplete="off"
                      value={editDialog.form.phone}
                      onChange={(e) =>
                        updateEditPhone("phone", e.target.value)
                      }
                      inputMode="numeric"
                      maxLength={11}
                      pattern="07[0-9]{9}"
                      dir="ltr"
                      required
                      className="h-12 rounded-2xl text-left"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="edit-parentPhone">رقم هاتف ولي الأمر</Label>
                    <Input
                      id="edit-parentPhone"
                      name="parentPhone"
                      autoComplete="off"
                      value={editDialog.form.parentPhone}
                      onChange={(e) =>
                        updateEditPhone("parentPhone", e.target.value)
                      }
                      inputMode="numeric"
                      maxLength={11}
                      pattern="07[0-9]{9}"
                      dir="ltr"
                      required
                      className="h-12 rounded-2xl text-left"
                    />
                  </div>
                </div>
              </section>
            </fieldset>
          </div>
        </div>

        <DialogFooter>
          <div className="tp-student-registry__dialog-actions">
            <Button
              variant="outline"
              className="tp-student-registry__dialog-button"
              disabled={isSavingEdit}
              onClick={() => {
                editRecoveryRequestRef.current += 1;
                setEditRecoveryReason(null);
                setEditRecovery(null);
                setEditRecoveryLoading(false);
                setEditDialog({ open: false, id: "", form: emptyEditForm });
                setEditOriginalStudent(null);
              }}
            >
              <X aria-hidden="true" className="size-4" />
              إلغاء
            </Button>
            <Button
              className="tp-student-registry__dialog-button"
              onClick={handleEditSave}
              disabled={isSavingEdit || editResetChapterUnresolved || Boolean(editRecoveryReason)}
            >
              <Save aria-hidden="true" className="size-4" />
              {isSavingEdit
                ? "جاري الحفظ..."
                : editResetChapterUnresolved
                  ? "الحفظ متوقف لحماية الفرص"
                  : "حفظ التعديلات"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
