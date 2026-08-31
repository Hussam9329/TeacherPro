"use client";

import React, { useEffect, useMemo, useState, useCallback, startTransition } from "react";
import type { Exam } from "@/lib/teacher-store";
import {
  examApi,
  examCreateContextApi,
  type ExamCreateContextRow,
} from "@/lib/api";
import { emitTeacherProDataChanged } from "@/lib/teacherpro-sync";
import { useTeacherProBackgroundSyncDetector, useTeacherProSyncKey } from "@/hooks/use-teacherpro-sync";
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
import { toast } from "@/lib/user-toast";
import { toLatinDigits } from "@/lib/format";
import { MAIN_SITE_OPTIONS } from "@/lib/iraq";
import { useActionLock } from "@/hooks/use-action-lock";
import { normalizeExamSiteValue } from "@/lib/exam-utils";
import { baghdadTodayKey } from "@/lib/baghdad-time";
import {
  validateExamForm,
  validateExamGradePolicy,
  type ExamValidationResult,
} from "@/lib/exam-form-validation";

type ExamStatusMode = "نشط" | "تفعيل مجدول" | "معطل";
const EXAM_MAIN_SITE_OPTIONS: string[] = [...MAIN_SITE_OPTIONS];

type ExamFormState = {
  name: string;
  type: "يومي" | "تراكمي" | "فاينل";
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

function todayISO() {
  return baghdadTodayKey();
}

function defaultDateTimeForDate(date: string) {
  return `${date || todayISO()}T08:00`;
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
  const gradeValidation = validateExamGradePolicy({
    type: state.type,
    noDiscount: state.noDiscount,
    fullMark: state.fullMark,
    passMark: state.passMark,
    discountMark: state.discountMark,
    opportunitiesPenalty: state.opportunitiesPenaltyNum,
    dismissalGrade: state.dismissalGrade,
  });
  const { values } = gradeValidation;
  if (
    !gradeValidation.isValid ||
    values.fullMark === null ||
    values.passMark === null ||
    values.discountMark === null ||
    values.opportunitiesPenalty === null
  ) {
    return [
      {
        title: "أكمل قيم الدرجات",
        description:
          gradeValidation.firstError ||
          "أدخل قيماً صحيحة حتى تظهر معاينة الحكم الأكاديمي.",
        tone: "warn",
      },
    ];
  }

  const fullMark = values.fullMark;
  const passMark = values.passMark;
  const discountMark = values.discountMark;
  const penalty = values.opportunitiesPenalty;
  const dismissalGrade = values.dismissalGrade;
  const isFinalExam = state.type === "فاينل";
  const noDiscount = Boolean(state.noDiscount);
  const items: JudgmentPreviewItem[] = [];

  if (noDiscount) {
    items.push({
      title: `الدرجات من 0 إلى ${formatRangeNumber(fullMark)}`,
      description: `لا تخصم فرص. من ${formatRangeNumber(passMark)} فما فوق تظهر ناجح، وأقل من ذلك تظهر بدون خصم.`,
      tone: "info",
    });
    items.push({ title: "الغياب", description: "لا يخصم فرص لأن الامتحان بدون خصم.", tone: "info" });
    items.push({ title: "الغش", description: "يبقى إجراءً خطيراً: الغش يؤدي إلى فصل الطالب ويصفر رصيد الفرص.", tone: "danger" });
    return items;
  }

  if (isFinalExam) {
    if (dismissalGrade !== null) {
      items.push({ title: `من 0 إلى ${formatRangeNumber(dismissalGrade)}`, description: "فصل الطالب حسب درجة الفصل في الفاينل.", tone: "danger" });
      if (dismissalGrade >= passMark) {
        items.push({ title: "تنبيه تداخل", description: "درجة الفصل تساوي أو تتجاوز درجة النجاح، وهذا يجعل حكم الفصل يتداخل مع النجاح. راجع القيم قبل الحفظ.", tone: "danger" });
      }
      items.push({ title: `أكبر من ${formatRangeNumber(dismissalGrade)} وأقل من ${formatRangeNumber(passMark)}`, description: "راسب في الفاينل بدون خصم فرص مباشر.", tone: "warn" });
    } else {
      items.push({ title: "درجة 0", description: "فصل الطالب في الفاينل.", tone: "danger" });
      items.push({ title: `أكبر من 0 وأقل من ${formatRangeNumber(passMark)}`, description: "راسب.", tone: "warn" });
    }
    items.push({ title: `من ${formatRangeNumber(passMark)} فما فوق`, description: "ناجح.", tone: "ok" });
    items.push({ title: "الغياب", description: "فصل الطالب لأنه غياب ضمن فاينل.", tone: "danger" });
    items.push({ title: "الغش", description: "الغش يؤدي إلى فصل الطالب ويصفر رصيد الفرص.", tone: "danger" });
    return items;
  }

  items.push({ title: `من 0 إلى ${formatRangeNumber(discountMark)}`, description: `مخصوم: يخصم ${formatRangeNumber(penalty)} فرصة من الطالب.`, tone: "danger" });
  items.push({ title: `أكبر من ${formatRangeNumber(discountMark)} وأقل من ${formatRangeNumber(passMark)}`, description: "راسب/محاسبة رسوب بدون خصم فرص مباشر.", tone: "warn" });
  items.push({ title: `من ${formatRangeNumber(passMark)} فما فوق`, description: "ناجح.", tone: "ok" });
  items.push({ title: "الغياب", description: `مخصوم: يخصم ${formatRangeNumber(penalty)} فرصة.`, tone: "danger" });
  items.push({ title: "الغش", description: "الغش يؤدي إلى فصل الطالب ويصفر رصيد الفرص.", tone: "danger" });
  return items;
}

function judgmentToneClass(tone: JudgmentPreviewItem["tone"]) {
  if (tone === "ok") return "border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-100";
  if (tone === "danger") return "border-rose-200 bg-rose-50 text-rose-900 dark:border-rose-900/60 dark:bg-rose-950/30 dark:text-rose-100";
  if (tone === "warn") return "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-100";
  return "border-sky-200 bg-sky-50 text-sky-900 dark:border-sky-900/60 dark:bg-sky-950/30 dark:text-sky-100";
}

function ExamFieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null;
  return (
    <p id={id} role="alert" className="text-xs font-medium text-destructive">
      {message}
    </p>
  );
}

function emptyForm(): ExamFormState {
  return {
    name: "",
    type: "يومي",
    courseIds: [],
    mainSites: [],
    date: todayISO(),
    fullMark: "100",
    passMark: "60",
    discountMark: "45",
    opportunitiesPenaltyNum: "1",
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
    return { active: true, scheduledActivateAt: "" };
  }
  if (form.statusMode === "معطل") {
    return { active: false, scheduledActivateAt: "" };
  }
  return { active: false, scheduledActivateAt: form.scheduledActivateAt };
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
    fullMark: Number(toLatinDigits(form.fullMark)),
    passMark: Number(toLatinDigits(form.passMark)),
    discountMark:
      isFinalExam || noDiscount
        ? 0
        : Number(toLatinDigits(form.discountMark)),
    opportunitiesPenalty: noDiscount
      ? 0
      : isFinalExam
        ? 0
        : Number(toLatinDigits(form.opportunitiesPenaltyNum)),
    dismissalGrade:
      !noDiscount && isFinalExam && form.dismissalGrade.trim()
        ? Number(toLatinDigits(form.dismissalGrade))
        : null,
    noDiscount,
    ...applyStatus(form),
  };
}

function selectedCourseBlockers(rows: ExamCreateContextRow[], selectedIds: string[]): string[] {
  return selectedIds.flatMap((id) => {
    const row = rows.find((item) => item.id === id);
    if (!row) return [`الدورة ${id} غير موجودة في سياق بيانات النظام`];
    return row.canSelectForExam ? [] : row.blockers.map((blocker) => `${String(row.course?.name || row.id)}: ${blocker}`);
  });
}

function selectedSiteActiveStudentCount(rows: ExamCreateContextRow[], selectedCourseIds: string[], selectedSites: string[]): number | null {
  if (selectedCourseIds.length === 0 || selectedSites.length === 0) return null;
  const selectedRows = rows.filter((row) => selectedCourseIds.includes(row.id));
  const normalizedSites = selectedSites.map(normalizeExamSiteValue).filter(Boolean);
  const allSelected = EXAM_MAIN_SITE_OPTIONS.every((site) => normalizedSites.includes(normalizeExamSiteValue(site)));
  if (allSelected) {
    return selectedRows.reduce((sum, row) => sum + Number(row.activeStudents || 0), 0);
  }
  return selectedRows.reduce((sum, row) => {
    return sum + normalizedSites.reduce((siteSum, site) => siteSum + Number(row.siteCounts?.[site] || 0), 0);
  }, 0);
}

export function ExamNewView() {
  const syncKey = useTeacherProSyncKey(["courses", "chapters", "students", "exams"]);
  const isBackgroundSync = useTeacherProBackgroundSyncDetector(syncKey);
  const [form, setForm] = useState<ExamFormState>(() => emptyForm());
  const [contextRows, setContextRows] = useState<ExamCreateContextRow[]>([]);
  const [contextLoading, setContextLoading] = useState(true);
  const [contextError, setContextError] = useState("");
  const { locked: isAddingExam, runLocked: runAddExamLocked } = useActionLock();

  useEffect(() => {
    const controller = new AbortController();
    const silent = isBackgroundSync();
    if (!silent) setContextLoading(true);
    if (!silent) setContextError("");
    examCreateContextApi
      .get({ signal: controller.signal, quietAbort: true })
      .then((payload) => {
        if (controller.signal.aborted) return;
        if (!payload?.rows) {
          if (!silent) {
            setContextRows([]);
            setContextError("تعذر تحميل سياق إضافة الامتحان من بيانات النظام.");
          }
          return;
        }
        // استخدام startTransition لتحديث البيانات بدون حظر الواجهة
        startTransition(() => {
          setContextRows(payload.rows);
        });
      })
      .catch(() => {
        if (!controller.signal.aborted && !silent) {
          setContextRows([]);
          setContextError("تعذر تحميل سياق إضافة الامتحان من بيانات النظام.");
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setContextLoading(false);
      });
    return () => controller.abort();
  }, [syncKey, isBackgroundSync]);

  const selectableCourses = useMemo(
    () => contextRows.filter((row) => row.canSelectForExam),
    [contextRows],
  );
  const blockedCourses = useMemo(
    () => contextRows.filter((row) => !row.canSelectForExam),
    [contextRows],
  );

  const availableMainSitesFor = (_state: ExamFormState): string[] => EXAM_MAIN_SITE_OPTIONS;

  const validateForm = useCallback(
    (state: ExamFormState): ExamValidationResult => {
      const blockers = selectedCourseBlockers(contextRows, state.courseIds);
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
        preflightError: contextLoading
          ? "انتظر تحميل سياق إضافة الامتحان من بيانات النظام"
          : contextError || null,
        courseSelectionError:
          blockers.length > 0
            ? `لا يمكن حفظ الامتحان بسبب مشاكل الدورات: ${blockers.join("، ")}`
            : null,
      });
    },
    [contextError, contextLoading, contextRows],
  );

  const formValidation = useMemo(
    () => validateForm(form),
    [form, validateForm],
  );
  const isFormValid = formValidation.isValid;

  const handleSubmit = runAddExamLocked(async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const validation = validateForm(form);
    if (!validation.isValid) {
      toast.error(validation.firstError || "راجع بيانات الامتحان قبل الحفظ");
      return;
    }
    const result = await examApi.add(buildExamPayload(form) as unknown as Record<string, unknown>);
    if (!result.ok || result.queued) {
      toast.error(result.error || "تعذر إضافة الامتحان من النظام.");
      return;
    }
    setForm(emptyForm());
    // إصلاح: استخدام dispatchLocal لضمان تحديث الواجهة فوراً بعد الإضافة
    emitTeacherProDataChanged({
      source: "local-mutation",
      reason: "exam-created",
      scopes: ["exams", "grades", "opportunities", "follow-up", "dashboard"],
      dispatchLocal: true  // ← إضافة هذا السطر لإصلاح المشكلة
    });
    toast.success("تمت إضافة الامتحان من بيانات النظام");
  });

  const toggleCourseSelection = (state: ExamFormState, courseId: string): ExamFormState => ({
    ...state,
    courseIds: toggleSelection(state.courseIds, courseId),
  });

  const renderCourseSelector = (state: ExamFormState, setState: (updater: (prev: ExamFormState) => ExamFormState) => void, allId: string) => {
    const allSelected = selectableCourses.length > 0 && selectableCourses.every((row) => state.courseIds.includes(row.id));
    return (
      <div className="space-y-3">
        {contextLoading ? (
          <div className="rounded-lg border bg-muted/40 p-3 text-sm text-muted-foreground">
            جاري تحميل الدورات والفصول النشطة من بيانات النظام...
          </div>
        ) : contextError ? (
          <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
            {contextError}
          </div>
        ) : (
          <div className="max-h-56 space-y-2 overflow-y-auto rounded-lg border p-3">
            <div className="flex items-center gap-2 border-b pb-2">
              <Checkbox
                id={allId}
                checked={allSelected}
                disabled={selectableCourses.length === 0}
                onCheckedChange={() => setState((prev) => ({ ...prev, courseIds: allSelected ? [] : selectableCourses.map((row) => row.id) }))}
              />
              <Label htmlFor={allId} className="text-sm font-bold">الكل للدورات الصالحة من بيانات النظام</Label>
              <Badge variant="outline" className="text-[10px]">{selectableCourses.length} صالحة</Badge>
            </div>
            {contextRows.map((row) => {
              const courseName = String(row.course?.name || row.id);
              return (
                <div key={row.id} className="space-y-1 rounded-xl border bg-background/60 p-2">
                  <div className="flex items-center gap-2">
                    <Checkbox
                      id={`${allId}-${row.id}`}
                      checked={state.courseIds.includes(row.id)}
                      disabled={!row.canSelectForExam}
                      onCheckedChange={() => setState((prev) => toggleCourseSelection(prev, row.id))}
                    />
                    <Label htmlFor={`${allId}-${row.id}`} className="text-sm font-bold">
                      {courseName}
                    </Label>
                    <Badge variant={row.canSelectForExam ? "outline" : "destructive"} className="text-[10px]">
                      {row.canSelectForExam ? "صالحة للامتحان" : "غير صالحة"}
                    </Badge>
                  </div>
                  <div className="flex flex-wrap gap-1 pr-7 text-[11px] text-muted-foreground">
                    <span>الطلاب النشطون: {row.activeStudents}</span>
                    <span>الفصل النشط: {row.activeChapter?.name || "—"}</span>
                    <span>فرص الفصل: {row.activeChapter?.opportunities ?? "—"}</span>
                  </div>
                  {row.blockers.length > 0 ? (
                    <div className="pr-7 text-[11px] text-destructive">
                      {row.blockers.join("، ")}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
        {blockedCourses.length > 0 && !contextLoading && !contextError && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-100">
            <p className="font-bold">دورات مستبعدة من اختيار الكل</p>
            <ul className="mt-2 list-disc space-y-1 pr-5">
              {blockedCourses.slice(0, 6).map((row) => (
                <li key={row.id}>
                  {String(row.course?.name || row.id)}: {row.blockers.join("، ")}
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
      <div className="tp-form-field tp-form-status space-y-2">
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
        <p className="text-xs text-muted-foreground">تعطيل الامتحان يتم فورياً من سجل الامتحانات عند الحاجة.</p>
      </div>
      {state.statusMode === "تفعيل مجدول" && (
        <div className="tp-form-field space-y-2">
          <Label htmlFor={`${prefix}-activate`}>تاريخ ووقت التفعيل</Label>
          <Input
            id={`${prefix}-activate`}
            type="datetime-local"
            value={state.scheduledActivateAt}
            aria-invalid={Boolean(
              formValidation.fieldErrors.scheduledActivateAt,
            )}
            aria-describedby={
              formValidation.fieldErrors.scheduledActivateAt
                ? `${prefix}-activate-error`
                : undefined
            }
            onChange={(e) => setState((p) => ({ ...p, scheduledActivateAt: e.target.value }))}
          />
          <ExamFieldError
            id={`${prefix}-activate-error`}
            message={formValidation.fieldErrors.scheduledActivateAt}
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
    const matchedStudentsCount = selectedSiteActiveStudentCount(contextRows, state.courseIds, state.mainSites);
    const judgmentPreview = buildJudgmentPreview(state);
    const numericFullMark = Number(toLatinDigits(state.fullMark));
    const fullMarkMax =
      Number.isInteger(numericFullMark) && numericFullMark > 0
        ? numericFullMark
        : undefined;
    const fieldErrors = formValidation.fieldErrors;

    return (
      <div className="tp-exam-form-grid grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        <div className="tp-form-field space-y-2">
          <Label htmlFor={`${prefix}-name`}>اسم الامتحان</Label>
          <Input
            id={`${prefix}-name`}
            value={state.name}
            aria-invalid={Boolean(fieldErrors.name)}
            aria-describedby={
              fieldErrors.name ? `${prefix}-name-error` : undefined
            }
            onChange={(e) =>
              setState((p) => ({ ...p, name: e.target.value }))
            }
            required
            placeholder="الامتحان الأول - الفصل الأول"
          />
          <ExamFieldError
            id={`${prefix}-name-error`}
            message={fieldErrors.name}
          />
        </div>
        <div className="tp-form-field space-y-2">
          <Label htmlFor={`${prefix}-type`}>نوع الامتحان</Label>
          <Select value={state.type} onValueChange={(v) => setState((p) => {
            const nextType = v as ExamFormState["type"];
            const nextIsFinalExam = nextType === "فاينل";
            return {
              ...p,
              type: nextType,
              discountMark:
                nextIsFinalExam || p.noDiscount
                  ? "0"
                  : p.discountMark && p.discountMark !== "0"
                    ? p.discountMark
                    : "45",
              opportunitiesPenaltyNum:
                nextIsFinalExam || p.noDiscount
                  ? "0"
                  : p.opportunitiesPenaltyNum &&
                      p.opportunitiesPenaltyNum !== "0"
                    ? p.opportunitiesPenaltyNum
                    : "1",
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
        <div className="tp-form-field space-y-2">
          <Label htmlFor={`${prefix}-date`}>تاريخ الامتحان</Label>
          <DateInput
            id={`${prefix}-date`}
            value={state.date}
            aria-invalid={Boolean(fieldErrors.date)}
            aria-describedby={
              fieldErrors.date ? `${prefix}-date-error` : undefined
            }
            onChange={(value) => setState((p) => ({
              ...p,
              date: value,
              scheduledActivateAt: p.statusMode === "تفعيل مجدول" && (!p.scheduledActivateAt || p.scheduledActivateAt.startsWith(p.date))
                ? defaultDateTimeForDate(value)
                : p.scheduledActivateAt,
            }))}
          />
          <ExamFieldError
            id={`${prefix}-date-error`}
            message={fieldErrors.date}
          />
        </div>
        <div
          className="tp-form-field tp-form-field-tall space-y-2 md:col-span-2 xl:col-span-1"
          role="group"
          aria-describedby={
            fieldErrors.courseIds ? `${prefix}-courses-error` : undefined
          }
        >
          <Label>الدورات</Label>
          {renderCourseSelector(state, setState, `${prefix}-all-courses`)}
          <ExamFieldError
            id={`${prefix}-courses-error`}
            message={fieldErrors.courseIds}
          />
        </div>
        <div
          className="tp-form-field tp-form-field-tall space-y-2"
          role="group"
          aria-describedby={
            fieldErrors.mainSites ? `${prefix}-sites-error` : undefined
          }
        >
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
              لا يوجد طلاب نشطون ظاهرون من سياق النظام لهذه المواقع في الدورات المختارة. قد يتم إنشاء الامتحان بدون نتائج متوقعة.
            </div>
          )}
          {matchedStudentsCount !== null && matchedStudentsCount > 0 && (
            <p className="text-xs text-muted-foreground">
              مؤشر الطلاب النشطين حسب الدورات والمواقع المختارة من النظام: {matchedStudentsCount}
            </p>
          )}
          <ExamFieldError
            id={`${prefix}-sites-error`}
            message={fieldErrors.mainSites}
          />
        </div>
        <div className="tp-form-policy space-y-2 rounded-lg border border-dashed p-3 md:col-span-2 xl:col-span-3">
          <div className="flex items-start gap-2">
            <Checkbox
              id={`${prefix}-no-discount`}
              checked={state.noDiscount}
              onCheckedChange={(checked) => setState((p) => {
                const enabled = Boolean(checked);
                return {
                  ...p,
                  noDiscount: enabled,
                  discountMark:
                    enabled || p.type === "فاينل"
                      ? "0"
                      : p.discountMark && p.discountMark !== "0"
                        ? p.discountMark
                        : "45",
                  opportunitiesPenaltyNum:
                    enabled || p.type === "فاينل"
                      ? "0"
                      : p.opportunitiesPenaltyNum &&
                          p.opportunitiesPenaltyNum !== "0"
                        ? p.opportunitiesPenaltyNum
                        : "1",
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
        <div className="tp-form-field space-y-2">
          <Label htmlFor={`${prefix}-full-mark`}>الدرجة الكاملة</Label>
          <Input
            id={`${prefix}-full-mark`}
            type="number"
            min={1}
            step={1}
            value={state.fullMark}
            aria-invalid={Boolean(fieldErrors.fullMark)}
            aria-describedby={
              fieldErrors.fullMark
                ? `${prefix}-full-mark-error`
                : undefined
            }
            onChange={(e) =>
              setState((p) => ({
                ...p,
                fullMark: toLatinDigits(e.target.value),
              }))
            }
          />
          <ExamFieldError
            id={`${prefix}-full-mark-error`}
            message={fieldErrors.fullMark}
          />
        </div>
        <div className="tp-form-field space-y-2">
          <Label htmlFor={`${prefix}-pass-mark`}>درجة النجاح</Label>
          <Input
            id={`${prefix}-pass-mark`}
            type="number"
            min={0}
            max={fullMarkMax}
            step={1}
            value={state.passMark}
            aria-invalid={Boolean(fieldErrors.passMark)}
            aria-describedby={
              fieldErrors.passMark
                ? `${prefix}-pass-mark-error`
                : undefined
            }
            onChange={(e) =>
              setState((p) => ({
                ...p,
                passMark: toLatinDigits(e.target.value),
              }))
            }
          />
          <ExamFieldError
            id={`${prefix}-pass-mark-error`}
            message={fieldErrors.passMark}
          />
        </div>
        <div className="tp-form-field space-y-2">
          <Label htmlFor={`${prefix}-discount-mark`}>درجة الخصم</Label>
          <Input
            id={`${prefix}-discount-mark`}
            type="number"
            min={0}
            max={fullMarkMax}
            step={1}
            value={isFinalExam || noDiscount ? "0" : state.discountMark}
            disabled={isFinalExam || noDiscount}
            aria-invalid={Boolean(fieldErrors.discountMark)}
            aria-describedby={
              fieldErrors.discountMark
                ? `${prefix}-discount-mark-error`
                : undefined
            }
            onChange={(e) =>
              setState((p) => ({
                ...p,
                discountMark: toLatinDigits(e.target.value),
              }))
            }
          />
          {isFinalExam && !noDiscount && <p className="text-xs text-amber-600">معطل في الفاينل؛ الحكم يكون فقط من درجة الفصل.</p>}
          {noDiscount && <p className="text-xs text-sky-600">معطل لأن الامتحان بدون خصم.</p>}
          <ExamFieldError
            id={`${prefix}-discount-mark-error`}
            message={fieldErrors.discountMark}
          />
        </div>
        <div className="tp-form-field space-y-2">
          <Label htmlFor={`${prefix}-opportunities-penalty`}>خصم الفرص</Label>
          <Input
            id={`${prefix}-opportunities-penalty`}
            type="number"
            min={1}
            step={1}
            value={isFinalExam || noDiscount ? "0" : state.opportunitiesPenaltyNum}
            disabled={isFinalExam || noDiscount}
            aria-invalid={Boolean(fieldErrors.opportunitiesPenalty)}
            aria-describedby={
              fieldErrors.opportunitiesPenalty
                ? `${prefix}-opportunities-penalty-error`
                : undefined
            }
            onChange={(e) =>
              setState((p) => ({
                ...p,
                opportunitiesPenaltyNum: toLatinDigits(e.target.value),
              }))
            }
          />
          {isFinalExam && !noDiscount && <p className="text-xs text-amber-600">معطل في الفاينل؛ الغياب أو الغش أو درجة الفصل يعالج كفصل للطالب.</p>}
          {noDiscount && <p className="text-xs text-sky-600">معطل لأن الامتحان بدون خصم.</p>}
          <ExamFieldError
            id={`${prefix}-opportunities-penalty-error`}
            message={fieldErrors.opportunitiesPenalty}
          />
        </div>
        {isFinalExam && (
          <div className="tp-form-field space-y-2">
            <Label htmlFor={`${prefix}-dismissal-grade`}>درجة الفصل</Label>
            <Input
              id={`${prefix}-dismissal-grade`}
              type="number"
              min={0}
              max={fullMarkMax}
              step={1}
              disabled={noDiscount}
              value={noDiscount ? "" : state.dismissalGrade}
              aria-invalid={Boolean(fieldErrors.dismissalGrade)}
              aria-describedby={
                fieldErrors.dismissalGrade
                  ? `${prefix}-dismissal-grade-error`
                  : undefined
              }
              onChange={(e) =>
                setState((p) => ({
                  ...p,
                  dismissalGrade: toLatinDigits(e.target.value),
                }))
              }
            />
            {noDiscount && <p className="text-xs text-sky-600">معطل لأن الامتحان بدون خصم.</p>}
            <ExamFieldError
              id={`${prefix}-dismissal-grade-error`}
              message={fieldErrors.dismissalGrade}
            />
          </div>
        )}
        <div className="tp-form-preview space-y-3 rounded-xl border border-primary/20 bg-primary/5 p-4 md:col-span-2 xl:col-span-3">
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
    <div className="tp-exam-new space-y-6">
      <Card className="tp-exam-new__shell">
        <CardHeader className="tp-exam-new__header">
          <CardTitle>إضافة امتحان جديد</CardTitle>
        </CardHeader>
        <CardContent className="tp-exam-new__content space-y-4">
          <div className="tp-exam-new__stats grid grid-cols-2 gap-3 md:grid-cols-4">
            <div className="rounded-2xl border bg-muted/30 p-3">
              <p className="text-xs text-muted-foreground">الدورات الصالحة</p>
              <p className="text-2xl font-black">{contextLoading ? "..." : selectableCourses.length}</p>
            </div>
            <div className="rounded-2xl border bg-muted/30 p-3">
              <p className="text-xs text-muted-foreground">الدورات المستبعدة</p>
              <p className="text-2xl font-black">{contextLoading ? "..." : blockedCourses.length}</p>
            </div>
            <div className="rounded-2xl border bg-muted/30 p-3">
              <p className="text-xs text-muted-foreground">الطلاب النشطون</p>
              <p className="text-2xl font-black">{contextLoading ? "..." : contextRows.reduce((sum, row) => sum + Number(row.activeStudents || 0), 0)}</p>
            </div>
            <div className="rounded-2xl border bg-muted/30 p-3">
              <p className="text-xs text-muted-foreground">مصدر الصفحة</p>
              <p className="text-sm font-bold text-emerald-600">بيانات النظام</p>
            </div>
          </div>

          <form onSubmit={handleSubmit} className="tp-validation-form tp-long-form tp-exam-form tp-exam-new__form space-y-4">
            {renderFormFields(form, setForm, "exam")}
            {!isFormValid && formValidation.firstError ? (
              <div
                id="exam-new-validation-summary"
                role={contextLoading ? "status" : "alert"}
                aria-live="polite"
                className="rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm font-medium text-destructive"
              >
                لا يمكن إضافة الامتحان حالياً: {formValidation.firstError}
              </div>
            ) : null}
            <Button
              type="submit"
              disabled={isAddingExam || !isFormValid}
              aria-describedby={
                !isFormValid ? "exam-new-validation-summary" : undefined
              }
              className="tp-form-submit w-full"
            >
              {isAddingExam ? "جاري الإضافة..." : "إضافة الامتحان"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
