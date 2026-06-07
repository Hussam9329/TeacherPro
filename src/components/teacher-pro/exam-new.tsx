"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useTeacherStore, type Exam } from "@/lib/teacher-store";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { toLatinDigits } from "@/lib/format";
import { MAIN_SITE_OPTIONS } from "@/lib/iraq";
import { useActionLock } from "@/hooks/use-action-lock";
import { getExamStatus, hasActiveChapterLink, splitSelection } from "@/lib/exam-utils";

type ExamStatusMode = "نشط" | "تفعيل مجدول" | "تعطيل مجدول" | "معطل";

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
  statusMode: ExamStatusMode;
  scheduledActivateAt: string;
  scheduledDeactivateAt: string;
};

function todayISO() {
  return new Date().toISOString().slice(0, 10);
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
    statusMode: "نشط",
    scheduledActivateAt: "",
    scheduledDeactivateAt: "",
  };
}

function formFromExam(exam: Exam): ExamFormState {
  return {
    name: exam.name,
    type: exam.type,
    courseIds: [...exam.courseIds],
    mainSites: splitSelection(exam.mainSite),
    date: exam.date,
    fullMark: exam.fullMark,
    passMark: exam.passMark,
    discountMark: exam.discountMark,
    opportunitiesPenaltyNum: typeof exam.opportunitiesPenalty === "number" ? exam.opportunitiesPenalty : 1,
    dismissalGrade: exam.dismissalGrade !== null ? String(exam.dismissalGrade) : "",
    statusMode: getExamStatus(exam),
    scheduledActivateAt: exam.scheduledActivateAt || "",
    scheduledDeactivateAt: exam.scheduledDeactivateAt || "",
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
  if (form.statusMode === "تفعيل مجدول") {
    return { active: false, scheduledActivateAt: form.scheduledActivateAt || form.date, scheduledDeactivateAt: "" };
  }
  return { active: true, scheduledActivateAt: "", scheduledDeactivateAt: form.scheduledDeactivateAt || form.date };
}

function buildExamPayload(form: ExamFormState): Omit<Exam, "id"> {
  const isCumulativeOrFinal = form.type === "تراكمي" || form.type === "فاينل";
  return {
    name: form.name.trim(),
    type: form.type,
    courseIds: form.courseIds,
    mainSite: form.mainSites.join(","),
    date: form.date,
    fullMark: form.fullMark,
    passMark: form.passMark,
    discountMark: isCumulativeOrFinal ? 0 : form.discountMark,
    opportunitiesPenalty: isCumulativeOrFinal ? "فصل مؤقت" : form.opportunitiesPenaltyNum,
    dismissalGrade: isCumulativeOrFinal && form.dismissalGrade ? Number(form.dismissalGrade) : null,
    ...applyStatus(form),
  };
}

export function ExamNewView() {
  const {
    courses,
    sites,
    exams,
    courseChapters,
    addExam,
    updateExam,
    toggleExam,
    courseName,
  } = useTeacherStore();

  const [form, setForm] = useState<ExamFormState>(() => emptyForm());
  const [editDialog, setEditDialog] = useState<{ open: boolean; id: string; form: ExamFormState }>({ open: false, id: "", form: emptyForm() });
  const { locked: isAddingExam, runLocked: runAddExamLocked } = useActionLock();

  const activeCourses = useMemo(() => courses.filter((course) => course.active), [courses]);

  const availableMainSitesFor = (state: ExamFormState) => {
    const courseSites = sites
      .filter((s) => s.active && (state.courseIds.length === 0 || state.courseIds.includes(s.courseId)))
      .map((s) => s.main);
    return [...new Set([...MAIN_SITE_OPTIONS, ...courseSites])];
  };

  const availableMainSites = useMemo(() => availableMainSitesFor(form), [sites, form.courseIds]);

  useEffect(() => {
    setForm((prev) => ({
      ...prev,
      mainSites: prev.mainSites.filter((site) => availableMainSites.includes(site)),
    }));
  }, [availableMainSites]);

  const validateForm = (state: ExamFormState) => {
    if (!state.name.trim()) return "يرجى إدخال اسم الامتحان";
    if (state.courseIds.length === 0) return "يرجى اختيار دورة واحدة على الأقل";
    const invalidCourses = state.courseIds.filter((courseId) => !hasActiveChapterLink(courseChapters, courseId));
    if (invalidCourses.length > 0) return `لا يمكن ربط الامتحان بدورات بدون فصل نشط: ${invalidCourses.map(courseName).join("، ")}`;
    if (state.mainSites.length === 0) return "يرجى اختيار منطقة واحدة على الأقل أو اختيار الكل";
    if (state.statusMode === "تفعيل مجدول" && !state.scheduledActivateAt) return "حدد تاريخ التفعيل المجدول";
    if (state.statusMode === "تعطيل مجدول" && !state.scheduledDeactivateAt) return "حدد تاريخ التعطيل المجدول";
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
    const allSelected = eligibleCourses.length > 0 && eligibleCourses.every((course) => state.courseIds.includes(course.id));
    return (
      <div className="space-y-2 border rounded-lg p-3 max-h-48 overflow-y-auto">
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
                {eligible ? (course.availablePrograms?.join('، ') || '—') : "لم يتم اختيار فصل"}
              </Badge>
            </div>
          );
        })}
      </div>
    );
  };

  const renderStatusControls = (state: ExamFormState, setState: (updater: (prev: ExamFormState) => ExamFormState) => void, prefix: string) => (
    <>
      <div className="space-y-2">
        <Label htmlFor={`${prefix}-status`}>حالة الامتحان</Label>
        <Select value={state.statusMode} onValueChange={(value) => setState((p) => ({ ...p, statusMode: value as ExamStatusMode }))}>
          <SelectTrigger id={`${prefix}-status`}><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="نشط">نشط</SelectItem>
            <SelectItem value="تفعيل مجدول">تفعيل مجدول</SelectItem>
            <SelectItem value="تعطيل مجدول">تعطيل مجدول</SelectItem>
            <SelectItem value="معطل">معطل</SelectItem>
          </SelectContent>
        </Select>
      </div>
      {state.statusMode === "تفعيل مجدول" && (
        <div className="space-y-2">
          <Label htmlFor={`${prefix}-activate`}>تاريخ التفعيل</Label>
          <Input id={`${prefix}-activate`} type="date" value={state.scheduledActivateAt} onChange={(e) => setState((p) => ({ ...p, scheduledActivateAt: e.target.value }))} />
        </div>
      )}
      {state.statusMode === "تعطيل مجدول" && (
        <div className="space-y-2">
          <Label htmlFor={`${prefix}-deactivate`}>تاريخ التعطيل</Label>
          <Input id={`${prefix}-deactivate`} type="date" value={state.scheduledDeactivateAt} onChange={(e) => setState((p) => ({ ...p, scheduledDeactivateAt: e.target.value }))} />
        </div>
      )}
    </>
  );


  const saveExamEdit = () => {
    const error = validateForm(editDialog.form);
    if (error) {
      toast.error(error);
      return;
    }
    const payload = buildExamPayload(editDialog.form);
    updateExam(editDialog.id, payload);
    setEditDialog({ open: false, id: "", form: emptyForm() });
    toast.success("تم تعديل الامتحان وإعادة احتساب تأثيراته على الطلاب");
  };

  const renderFormFields = (state: ExamFormState, setState: (updater: (prev: ExamFormState) => ExamFormState) => void, prefix: string) => {
    const isCumulativeOrFinal = state.type === "تراكمي" || state.type === "فاينل";
    const mainSitesForState = availableMainSitesFor(state);
    const allMainSitesSelected = mainSitesForState.length > 0 && state.mainSites.length === mainSitesForState.length;

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
            const nextIsCumulativeOrFinal = nextType === "تراكمي" || nextType === "فاينل";
            return {
              ...p,
              type: nextType,
              discountMark: nextIsCumulativeOrFinal ? 0 : (p.discountMark || 45),
              opportunitiesPenaltyNum: nextIsCumulativeOrFinal ? 0 : (p.opportunitiesPenaltyNum || 1),
              dismissalGrade: nextIsCumulativeOrFinal ? p.dismissalGrade : "",
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
          <Input id={`${prefix}-date`} type="date" value={state.date} onChange={(e) => setState((p) => ({ ...p, date: e.target.value }))} />
        </div>
        <div className="space-y-2 md:col-span-2 xl:col-span-1">
          <Label>الدورات</Label>
          {renderCourseSelector(state, setState, `${prefix}-all-courses`)}
        </div>
        <div className="space-y-2">
          <Label>الموقع الرئيسي</Label>
          <div className="space-y-2 border rounded-lg p-3 max-h-48 overflow-y-auto">
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
        </div>
        <div className="space-y-2"><Label>الدرجة الكاملة</Label><Input type="number" value={state.fullMark} onChange={(e) => setState((p) => ({ ...p, fullMark: Number(toLatinDigits(e.target.value)) || 100 }))} /></div>
        <div className="space-y-2"><Label>درجة النجاح</Label><Input type="number" value={state.passMark} onChange={(e) => setState((p) => ({ ...p, passMark: Number(toLatinDigits(e.target.value)) || 60 }))} /></div>
        <div className="space-y-2">
          <Label>درجة الخصم</Label>
          <Input
            type="number"
            value={isCumulativeOrFinal ? 0 : state.discountMark}
            disabled={isCumulativeOrFinal}
            onChange={(e) => setState((p) => ({ ...p, discountMark: Number(toLatinDigits(e.target.value)) || 0 }))}
          />
          {isCumulativeOrFinal && <p className="text-xs text-amber-600">معطل في التراكمي/الفاينل؛ الحكم يكون فقط من درجة الفصل.</p>}
        </div>
        <div className="space-y-2">
          <Label>خصم الفرص</Label>
          <Input
            type="number"
            min={0}
            value={isCumulativeOrFinal ? 0 : state.opportunitiesPenaltyNum}
            disabled={isCumulativeOrFinal}
            onChange={(e) => setState((p) => ({ ...p, opportunitiesPenaltyNum: Number(toLatinDigits(e.target.value)) || 1 }))}
          />
          {isCumulativeOrFinal && <p className="text-xs text-amber-600">معطل في التراكمي/الفاينل؛ الغياب أو الغش أو درجة الفصل يعالج كفصل مؤقت فقط.</p>}
        </div>
        {isCumulativeOrFinal && <div className="space-y-2"><Label>درجة الفصل</Label><Input type="number" value={state.dismissalGrade} onChange={(e) => setState((p) => ({ ...p, dismissalGrade: toLatinDigits(e.target.value) }))} /></div>}
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

      <Card>
        <CardHeader><CardTitle>قائمة الامتحانات</CardTitle></CardHeader>
        <CardContent>
          <div className="space-y-3">
            {exams.map((exam) => {
              const status = getExamStatus(exam);
              const examMainSites = splitSelection(exam.mainSite);
              return (
                <div key={exam.id} className="rounded-2xl border bg-card/80 p-4 shadow-sm">
                  <div className="mb-2 flex items-start justify-between gap-3">
                    <div>
                      <p className="font-bold">{exam.name}</p>
                      <p className="text-xs text-muted-foreground">{exam.date} - {exam.type}</p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge>{exam.type}</Badge>
                      <Badge variant={status === "نشط" ? "default" : status === "معطل" ? "secondary" : "outline"}>{status}</Badge>
                    </div>
                  </div>
                  <div className="mb-3 grid grid-cols-2 gap-2 text-sm md:grid-cols-4">
                    <div><span className="text-xs text-muted-foreground">النجاح:</span> {exam.passMark}</div>
                    <div><span className="text-xs text-muted-foreground">الخصم:</span> {exam.discountMark}</div>
                    <div><span className="text-xs text-muted-foreground">الدورات:</span> {exam.courseIds.map((id) => courseName(id)).join("، ")}</div>
                    <div><span className="text-xs text-muted-foreground">المناطق:</span> {examMainSites.join("، ") || "الكل"}</div>
                    {exam.scheduledActivateAt && <div><span className="text-xs text-muted-foreground">تفعيل:</span> {exam.scheduledActivateAt}</div>}
                    {exam.scheduledDeactivateAt && <div><span className="text-xs text-muted-foreground">تعطيل:</span> {exam.scheduledDeactivateAt}</div>}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button variant="outline" size="sm" onClick={() => toggleExam(exam.id)}>{exam.active ? "تعطيل" : "تفعيل"}</Button>
                    <Button variant="secondary" size="sm" onClick={() => setEditDialog({ open: true, id: exam.id, form: formFromExam(exam) })}>تعديل كل التفاصيل</Button>
                  </div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      <Dialog open={editDialog.open} onOpenChange={(open) => setEditDialog((prev) => ({ ...prev, open }))}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-5xl" dir="rtl">
          <DialogHeader><DialogTitle>تعديل الامتحان بالكامل</DialogTitle></DialogHeader>
          {renderFormFields(editDialog.form, (updater) => setEditDialog((prev) => ({ ...prev, form: updater(prev.form) })), "edit-exam")}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setEditDialog({ open: false, id: "", form: emptyForm() })}>إلغاء</Button>
            <Button onClick={saveExamEdit}>حفظ التعديلات وإعادة الاحتساب</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
