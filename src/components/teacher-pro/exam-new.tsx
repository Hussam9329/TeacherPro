"use client";

import React, { useMemo, useState } from "react";
import { useTeacherStore, type Exam } from "@/lib/teacher-store";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DateInput } from "@/components/ui/date-input";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import { toLatinDigits } from "@/lib/format";
import { MAIN_SITE_OPTIONS } from "@/lib/iraq";
import { useActionLock } from "@/hooks/use-action-lock";
import { hasActiveChapterLink, studentMatchesExamMainSites } from "@/lib/exam-utils";

type ExamStatusMode = "نشط" | "تفعيل مجدول" | "معطل";
const EXAM_MAIN_SITE_OPTIONS: string[] = [...MAIN_SITE_OPTIONS];

type ExamFormState = {
  name: string;
  type: "يومي" | "تراكمي" | "فاينل";
  courseIds: string[];
  mainSites: string[];
  date: string;
  fullMark: number;
  passMark: number;
  discountMark: number;
  opportunitiesPenaltyNum: number;
  dismissalGrade: string;
  noDiscount: boolean;
  statusMode: ExamStatusMode;
  scheduledActivateAt: string;
};

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function defaultDateTimeForDate(date: string) {
  return `${date || todayISO()}T08:00`;
}

function numberInputValue(value: number | string) {
  return Number(value) === 0 ? "" : String(value);
}


function formatRangeNumber(value: number) {
  if (!Number.isFinite(value)) return "—";
  return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/\.?0+$/, "");
}

type JudgmentPreviewItem = {
  title: string;
  description: string;
  tone: "ok" | "warn" | "danger" | "info";
};

function buildJudgmentPreview(state: ExamFormState): JudgmentPreviewItem[] {
  const fullMark = Number(state.fullMark || 0);
  const passMark = Number(state.passMark || 0);
  const discountMark = Number(state.discountMark || 0);
  const penalty = Number(state.opportunitiesPenaltyNum || 0);
  const isFinalExam = state.type === "فاينل";
  const noDiscount = Boolean(state.noDiscount);
  const dismissalGradeRaw = state.dismissalGrade === "" ? null : Number(state.dismissalGrade);
  const dismissalGrade = Number.isFinite(Number(dismissalGradeRaw)) ? Number(dismissalGradeRaw) : null;
  const items: JudgmentPreviewItem[] = [];

  if (noDiscount) {
    items.push({
      title: `الدرجات من 0 إلى ${formatRangeNumber(fullMark)}`,
      description: `لا تخصم فرص. من ${formatRangeNumber(passMark)} فما فوق تظهر ناجح، وأقل من ذلك تظهر بدون خصم.`,
      tone: "info",
    });
    items.push({ title: "الغياب", description: "لا يخصم فرص لأن الامتحان بدون خصم.", tone: "info" });
    items.push({ title: "الغش", description: "يبقى إجراءً خطيراً: أول غش يفصل مؤقتاً ويصفر الفرص، والغش المتكرر يفصل نهائياً.", tone: "danger" });
    return items;
  }

  if (isFinalExam) {
    if (dismissalGrade !== null) {
      items.push({ title: `من 0 إلى ${formatRangeNumber(dismissalGrade)}`, description: "فصل مؤقت حسب درجة الفصل في الفاينل.", tone: "danger" });
      if (dismissalGrade >= passMark) {
        items.push({ title: "تنبيه تداخل", description: "درجة الفصل تساوي أو تتجاوز درجة النجاح، وهذا يجعل حكم الفصل يتداخل مع النجاح. راجع القيم قبل الحفظ.", tone: "danger" });
      }
      items.push({ title: `أكبر من ${formatRangeNumber(dismissalGrade)} وأقل من ${formatRangeNumber(passMark)}`, description: "راسب في الفاينل بدون خصم فرص مباشر.", tone: "warn" });
    } else {
      items.push({ title: "درجة 0", description: "فصل مؤقت في الفاينل.", tone: "danger" });
      items.push({ title: `أكبر من 0 وأقل من ${formatRangeNumber(passMark)}`, description: "راسب.", tone: "warn" });
    }
    items.push({ title: `من ${formatRangeNumber(passMark)} فما فوق`, description: "ناجح.", tone: "ok" });
    items.push({ title: "الغياب", description: "فصل مؤقت لأنه غياب ضمن فاينل.", tone: "danger" });
    items.push({ title: "الغش", description: "أول غش يفصل مؤقتاً ويصفر الفرص، والغش المتكرر يفصل نهائياً.", tone: "danger" });
    return items;
  }

  items.push({ title: `من 0 إلى ${formatRangeNumber(discountMark)}`, description: `مخصوم: يخصم ${formatRangeNumber(penalty)} فرصة من الطالب.`, tone: "danger" });
  items.push({ title: `أكبر من ${formatRangeNumber(discountMark)} وأقل من ${formatRangeNumber(passMark)}`, description: "راسب/محاسبة رسوب بدون خصم فرص مباشر.", tone: "warn" });
  items.push({ title: `من ${formatRangeNumber(passMark)} فما فوق`, description: "ناجح.", tone: "ok" });
  items.push({ title: "الغياب", description: `مخصوم: يخصم ${formatRangeNumber(penalty)} فرصة.`, tone: "danger" });
  items.push({ title: "الغش", description: "أول غش يفصل مؤقتاً ويصفر الفرص، والغش المتكرر يفصل نهائياً.", tone: "danger" });
  return items;
}

function judgmentToneClass(tone: JudgmentPreviewItem["tone"]) {
  if (tone === "ok") return "border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-100";
  if (tone === "danger") return "border-rose-200 bg-rose-50 text-rose-900 dark:border-rose-900/60 dark:bg-rose-950/30 dark:text-rose-100";
  if (tone === "warn") return "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-100";
  return "border-sky-200 bg-sky-50 text-sky-900 dark:border-sky-900/60 dark:bg-sky-950/30 dark:text-sky-100";
}

function emptyForm(): ExamFormState {
  return {
    name: "",
    type: "يومي",
    courseIds: [],
    mainSites: [],
    date: todayISO(),
    fullMark: 100,
    passMark: 60,
    discountMark: 45,
    opportunitiesPenaltyNum: 1,
    dismissalGrade: "",
    noDiscount: false,
    statusMode: "نشط",
    scheduledActivateAt: "",
  };
}

function toggleSelection(values: string[], value: string): string[] {
  return values.includes(value) ? values.filter((item) => item !== value) : [...values, value];
}

function applyStatus(form: ExamFormState) {
  if (form.statusMode === "نشط") {
    return { active: true, scheduledActivateAt: "", scheduledDeactivateAt: "" };
  }
  if (form.statusMode === "معطل") {
    return { active: false, scheduledActivateAt: "", scheduledDeactivateAt: "" };
  }
  return { active: false, scheduledActivateAt: form.scheduledActivateAt, scheduledDeactivateAt: "" };
}

function buildExamPayload(form: ExamFormState): Omit<Exam, "id"> {
  const isFinalExam = form.type === "فاينل";
  const noDiscount = Boolean(form.noDiscount);
  return {
    name: form.name.trim(),
    type: form.type,
    courseIds: form.courseIds,
    mainSite: form.mainSites.join(","),
    date: form.date,
    fullMark: form.fullMark,
    passMark: form.passMark,
    discountMark: isFinalExam || noDiscount ? 0 : form.discountMark,
    opportunitiesPenalty: noDiscount ? 0 : (isFinalExam ? "فصل مؤقت" : form.opportunitiesPenaltyNum),
    dismissalGrade: !noDiscount && isFinalExam && form.dismissalGrade ? Number(form.dismissalGrade) : null,
    noDiscount,
    ...applyStatus(form),
  };
}

export function ExamNewView() {
  const {
    courses,
    courseChapters,
    students,
    addExam,
    courseName,
  } = useTeacherStore();

  const [form, setForm] = useState<ExamFormState>(() => emptyForm());
  const { locked: isAddingExam, runLocked: runAddExamLocked } = useActionLock();

  const activeCourses = useMemo(() => courses.filter((course) => course.active), [courses]);

  const availableMainSitesFor = (_state: ExamFormState): string[] => EXAM_MAIN_SITE_OPTIONS;

  const selectedSiteMatchedStudentsCount = (state: ExamFormState) => {
    if (state.courseIds.length === 0 || state.mainSites.length === 0) return null;
    return students.filter((student) =>
      student.status === "نشط" &&
      state.courseIds.includes(student.courseId) &&
      studentMatchesExamMainSites(student, state.mainSites),
    ).length;
  };

  const validateForm = (state: ExamFormState) => {
    const fullMark = Number(state.fullMark);
    const passMark = Number(state.passMark);
    const isFinalExam = state.type === "فاينل";
    const noDiscount = Boolean(state.noDiscount);
    const discountMark = isFinalExam || noDiscount
      ? 0
      : Number(state.discountMark);

    if (!state.name.trim()) return "يرجى إدخال اسم الامتحان";
    if (state.courseIds.length === 0) return "يرجى اختيار دورة واحدة على الأقل";
    const invalidCourses = state.courseIds.filter((courseId) => !hasActiveChapterLink(courseChapters, courseId));
    if (invalidCourses.length > 0) return `لا يمكن ربط الامتحان بدورات بدون فصل نشط: ${invalidCourses.map(courseName).join("، ")}`;
    if (state.mainSites.length === 0) return "يرجى اختيار منطقة واحدة على الأقل أو اختيار الكل";
    if (![fullMark, passMark, discountMark].every(Number.isFinite)) return "درجات الامتحان يجب أن تكون أرقاماً صحيحة";
    if (fullMark <= 0) return "الدرجة الكاملة يجب أن تكون أكبر من صفر";
    if (passMark < 0 || passMark > fullMark) return "درجة النجاح يجب أن تكون بين صفر والدرجة الكاملة";
    if (!noDiscount && (discountMark < 0 || discountMark > fullMark)) return "درجة الخصم يجب أن تكون بين صفر والدرجة الكاملة";
    if (!noDiscount && !isFinalExam && passMark <= discountMark) return "درجة النجاح يجب أن تكون أكبر من درجة الخصم";
    if (!noDiscount && !isFinalExam && Number(state.opportunitiesPenaltyNum) <= 0) return "خصم الفرص يجب أن يكون أكبر من صفر";
    if (state.statusMode === "تفعيل مجدول" && !state.scheduledActivateAt) return "حدد تاريخ ووقت التفعيل المجدول";
    return null;
  };

  const handleSubmit = runAddExamLocked(async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const error = validateForm(form);
    if (error) {
      toast.error(error);
      return;
    }
    addExam(buildExamPayload(form));
    setForm(emptyForm());
    toast.success("تمت إضافة الامتحان");
  });

  const toggleCourseSelection = (state: ExamFormState, courseId: string): ExamFormState => ({
    ...state,
    courseIds: toggleSelection(state.courseIds, courseId),
  });

  const renderCourseSelector = (state: ExamFormState, setState: (updater: (prev: ExamFormState) => ExamFormState) => void, allId: string) => {
    const eligibleCourses = activeCourses.filter((course) => hasActiveChapterLink(courseChapters, course.id));
    const excludedCourses = activeCourses.filter((course) => !hasActiveChapterLink(courseChapters, course.id));
    const allSelected = eligibleCourses.length > 0 && eligibleCourses.every((course) => state.courseIds.includes(course.id));
    return (
      <div className="space-y-3">
        <div className="max-h-48 space-y-2 overflow-y-auto rounded-lg border p-3">
        <div className="flex items-center gap-2 border-b pb-2">
          <Checkbox
            id={allId}
            checked={allSelected}
            onCheckedChange={() => setState((prev) => ({ ...prev, courseIds: allSelected ? [] : eligibleCourses.map((course) => course.id) }))}
          />
          <Label htmlFor={allId} className="text-sm font-bold">الكل للدورات المربوطة بفصل</Label>
        </div>
          {activeCourses.map((course) => {
            const eligible = hasActiveChapterLink(courseChapters, course.id);
            return (
              <div key={course.id} className="flex items-center gap-2">
                <Checkbox
                  id={`${allId}-${course.id}`}
                  checked={state.courseIds.includes(course.id)}
                  disabled={!eligible}
                  onCheckedChange={() => setState((prev) => toggleCourseSelection(prev, course.id))}
                />
                <Label htmlFor={`${allId}-${course.id}`} className="text-sm">
                  {course.name}
                </Label>
                <Badge variant={eligible ? "outline" : "destructive"} className="text-[10px]">
                  {eligible ? (course.availablePrograms?.join("، ") || "—") : "مستبعدة: بلا فصل نشط"}
                </Badge>
              </div>
            );
          })}
        </div>
        {excludedCourses.length > 0 && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-100">
            <p className="font-bold">دورات مستبعدة من اختيار الكل</p>
            <ul className="mt-2 list-disc space-y-1 pr-5">
              {excludedCourses.map((course) => (
                <li key={course.id}>
                  دورة {course.name} مستبعدة لأنها بلا فصل نشط.
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    );
  };

  const renderStatusControls = (state: ExamFormState, setState: (updater: (prev: ExamFormState) => ExamFormState) => void, prefix: string) => (
    <>
      <div className="space-y-2">
        <Label htmlFor={`${prefix}-status`}>حالة الامتحان</Label>
        <Select
          value={state.statusMode}
          onValueChange={(value) => setState((p) => ({
            ...p,
            statusMode: value as ExamStatusMode,
            scheduledActivateAt: value === "تفعيل مجدول" && !p.scheduledActivateAt ? defaultDateTimeForDate(p.date) : p.scheduledActivateAt,
          }))}
        >
          <SelectTrigger id={`${prefix}-status`}><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="نشط">نشط</SelectItem>
            <SelectItem value="تفعيل مجدول">تفعيل مجدول</SelectItem>
            <SelectItem value="معطل">معطل</SelectItem>
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">تعطيل الامتحان المجدول يتم من سجل الامتحانات بعد إضافة الامتحان.</p>
      </div>
      {state.statusMode === "تفعيل مجدول" && (
        <div className="space-y-2">
          <Label htmlFor={`${prefix}-activate`}>تاريخ ووقت التفعيل</Label>
          <Input
            id={`${prefix}-activate`}
            type="datetime-local"
            value={state.scheduledActivateAt}
            onChange={(e) => setState((p) => ({ ...p, scheduledActivateAt: e.target.value }))}
          />
        </div>
      )}
    </>
  );

  const renderFormFields = (state: ExamFormState, setState: (updater: (prev: ExamFormState) => ExamFormState) => void, prefix: string) => {
    const isFinalExam = state.type === "فاينل";
    const noDiscount = Boolean(state.noDiscount);
    const mainSitesForState = availableMainSitesFor(state);
    const allMainSitesSelected = mainSitesForState.length > 0 && state.mainSites.length === mainSitesForState.length;
    const matchedStudentsCount = selectedSiteMatchedStudentsCount(state);
    const judgmentPreview = buildJudgmentPreview(state);

    return (
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        <div className="space-y-2">
          <Label htmlFor={`${prefix}-name`}>اسم الامتحان</Label>
          <Input id={`${prefix}-name`} value={state.name} onChange={(e) => setState((p) => ({ ...p, name: e.target.value }))} required placeholder="الامتحان الأول - الفصل الأول" />
        </div>
        <div className="space-y-2">
          <Label htmlFor={`${prefix}-type`}>نوع الامتحان</Label>
          <Select value={state.type} onValueChange={(v) => setState((p) => {
            const nextType = v as ExamFormState["type"];
            const nextIsFinalExam = nextType === "فاينل";
            return {
              ...p,
              type: nextType,
              discountMark: nextIsFinalExam || p.noDiscount ? 0 : (p.discountMark || 45),
              opportunitiesPenaltyNum: nextIsFinalExam || p.noDiscount ? 0 : (p.opportunitiesPenaltyNum || 1),
              dismissalGrade: nextIsFinalExam && !p.noDiscount ? p.dismissalGrade : "",
            };
          })}>
            <SelectTrigger id={`${prefix}-type`}><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="يومي">يومي</SelectItem>
              <SelectItem value="تراكمي">تراكمي</SelectItem>
              <SelectItem value="فاينل">فاينل</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label htmlFor={`${prefix}-date`}>تاريخ الامتحان</Label>
          <DateInput
            id={`${prefix}-date`}
            value={state.date}
            onChange={(value) => setState((p) => ({
              ...p,
              date: value,
              scheduledActivateAt: p.statusMode === "تفعيل مجدول" && (!p.scheduledActivateAt || p.scheduledActivateAt.startsWith(p.date))
                ? defaultDateTimeForDate(value)
                : p.scheduledActivateAt,
            }))}
          />
        </div>
        <div className="space-y-2 md:col-span-2 xl:col-span-1">
          <Label>الدورات</Label>
          {renderCourseSelector(state, setState, `${prefix}-all-courses`)}
        </div>
        <div className="space-y-2">
          <Label>الموقع الرئيسي</Label>
          <div className="max-h-48 space-y-2 overflow-y-auto rounded-lg border p-3">
            <div className="flex items-center gap-2 border-b pb-2">
              <Checkbox checked={allMainSitesSelected} onCheckedChange={() => setState((p) => ({ ...p, mainSites: allMainSitesSelected ? [] : [...mainSitesForState] }))} />
              <span className="text-sm font-bold">الكل</span>
            </div>
            {mainSitesForState.map((site) => (
              <div key={site} className="flex items-center gap-2">
                <Checkbox checked={state.mainSites.includes(site)} onCheckedChange={() => setState((p) => ({ ...p, mainSites: toggleSelection(p.mainSites, site) }))} />
                <span className="text-sm">{site}</span>
              </div>
            ))}
          </div>
          {matchedStudentsCount === 0 && (
            <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-xs font-semibold text-destructive">
              لا يوجد طلاب مطابقون لهذه المواقع في الدورات المختارة. قد يتم إنشاء الامتحان بدون نتائج متوقعة.
            </div>
          )}
          {matchedStudentsCount !== null && matchedStudentsCount > 0 && (
            <p className="text-xs text-muted-foreground">
              الطلاب المتوقع شمولهم حسب الدورات والمواقع المختارة: {matchedStudentsCount}
            </p>
          )}
        </div>
        <div className="space-y-2 rounded-lg border border-dashed p-3 md:col-span-2 xl:col-span-3">
          <div className="flex items-start gap-2">
            <Checkbox
              id={`${prefix}-no-discount`}
              checked={state.noDiscount}
              onCheckedChange={(checked) => setState((p) => {
                const enabled = Boolean(checked);
                return {
                  ...p,
                  noDiscount: enabled,
                  discountMark: enabled ? 0 : (p.discountMark || 45),
                  opportunitiesPenaltyNum: enabled ? 0 : (p.opportunitiesPenaltyNum || 1),
                  dismissalGrade: enabled ? "" : p.dismissalGrade,
                };
              })}
            />
            <div className="space-y-1">
              <Label htmlFor={`${prefix}-no-discount`} className="cursor-pointer font-semibold">امتحان بدون خصم</Label>
              <p className="text-xs text-muted-foreground">
                عند تفعيل هذا الخيار لا تتم محاسبة الطالب على الدرجة أو الغياب في هذا الامتحان، وتتعطل حقول درجة الخصم وخصم الفرص ودرجة الفصل.
              </p>
            </div>
          </div>
        </div>
        <div className="space-y-2"><Label>الدرجة الكاملة</Label><Input type="number" value={numberInputValue(state.fullMark)} onChange={(e) => setState((p) => ({ ...p, fullMark: Number(toLatinDigits(e.target.value)) || 0 }))} /></div>
        <div className="space-y-2"><Label>درجة النجاح</Label><Input type="number" value={numberInputValue(state.passMark)} onChange={(e) => setState((p) => ({ ...p, passMark: Number(toLatinDigits(e.target.value)) || 0 }))} /></div>
        <div className="space-y-2">
          <Label>درجة الخصم</Label>
          <Input
            type="number"
            value={isFinalExam || noDiscount ? "" : numberInputValue(state.discountMark)}
            disabled={isFinalExam || noDiscount}
            onChange={(e) => setState((p) => ({ ...p, discountMark: Number(toLatinDigits(e.target.value)) || 0 }))}
          />
          {isFinalExam && !noDiscount && <p className="text-xs text-amber-600">معطل في الفاينل؛ الحكم يكون فقط من درجة الفصل.</p>}
          {noDiscount && <p className="text-xs text-sky-600">معطل لأن الامتحان بدون خصم.</p>}
          {!noDiscount && !isFinalExam && Number(state.passMark) <= Number(state.discountMark) && (
            <p className="text-xs text-destructive">درجة النجاح يجب أن تكون أكبر من درجة الخصم.</p>
          )}
        </div>
        <div className="space-y-2">
          <Label>خصم الفرص</Label>
          <Input
            type="number"
            min={0}
            value={isFinalExam || noDiscount ? "" : numberInputValue(state.opportunitiesPenaltyNum)}
            disabled={isFinalExam || noDiscount}
            onChange={(e) => setState((p) => ({ ...p, opportunitiesPenaltyNum: Number(toLatinDigits(e.target.value)) || 0 }))}
          />
          {isFinalExam && !noDiscount && <p className="text-xs text-amber-600">معطل في الفاينل؛ الغياب أو الغش أو درجة الفصل يعالج كفصل مؤقت فقط.</p>}
          {noDiscount && <p className="text-xs text-sky-600">معطل لأن الامتحان بدون خصم.</p>}
        </div>
        {isFinalExam && <div className="space-y-2"><Label>درجة الفصل</Label><Input type="number" disabled={noDiscount} value={noDiscount ? "" : state.dismissalGrade} onChange={(e) => setState((p) => ({ ...p, dismissalGrade: toLatinDigits(e.target.value) }))} />{noDiscount && <p className="text-xs text-sky-600">معطل لأن الامتحان بدون خصم.</p>}</div>}
        <div className="space-y-3 rounded-xl border border-primary/20 bg-primary/5 p-4 md:col-span-2 xl:col-span-3">
          <div>
            <h3 className="font-bold">معاينة الحكم قبل الحفظ</h3>
            <p className="text-xs text-muted-foreground">هذه المعاينة توضح كيف سيتعامل النظام مع الدرجات والغياب والغش حسب القيم الحالية.</p>
          </div>
          <div className="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-3">
            {judgmentPreview.map((item) => (
              <div key={`${item.title}-${item.description}`} className={`rounded-lg border p-3 text-sm ${judgmentToneClass(item.tone)}`}>
                <p className="font-bold">{item.title}</p>
                <p className="mt-1 text-xs leading-5">{item.description}</p>
              </div>
            ))}
          </div>
        </div>
        {renderStatusControls(state, setState, prefix)}
      </div>
    );
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader><CardTitle>إضافة امتحان جديد</CardTitle></CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            {renderFormFields(form, setForm, "exam")}
            <Button type="submit" disabled={isAddingExam} className="w-full">{isAddingExam ? "جاري الإضافة..." : "إضافة الامتحان"}</Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
