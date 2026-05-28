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
import { toast } from "sonner";
import { toLatinDigits } from "@/lib/format";
import { MAIN_SITE_OPTIONS } from "@/lib/iraq";
import { useActionLock } from "@/hooks/use-action-lock";

function splitSelection(value: string): string[] {
  return value
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
}

function toggleSelection(values: string[], value: string): string[] {
  return values.includes(value)
    ? values.filter((v) => v !== value)
    : [...values, value];
}

export function ExamNewView() {
  const {
    courses,
    groups,
    sites,
    exams,
    students,
    addExam,
    toggleExam,
    toggleAttendance,
    closeAttendance,
    courseName,
    groupName,
  } = useTeacherStore();

  const [form, setForm] = useState({
    name: "",
    type: "يومي" as "يومي" | "تراكمي" | "فاينل",
    courseIds: [] as string[],
    mainSites: [] as string[],
    groupIds: [] as string[],
    date: new Date().toISOString().slice(0, 10),
    fullMark: 100,
    passMark: 60,
    discountMark: 45,
    opportunitiesPenaltyNum: 1,
    dismissalGrade: "",
  });

  const { locked: isAddingExam, runLocked: runAddExamLocked } = useActionLock();

  const isCumulativeOrFinal = form.type === "تراكمي" || form.type === "فاينل";

  const availableGroups = useMemo(
    () => groups.filter((g) => form.courseIds.includes(g.courseId) && g.active),
    [groups, form.courseIds],
  );

  const availableMainSites = useMemo(() => {
    const courseSites = sites
      .filter(
        (s) =>
          s.active &&
          (form.courseIds.length === 0 || form.courseIds.includes(s.courseId)),
      )
      .map((s) => s.main);
    return [...new Set([...MAIN_SITE_OPTIONS, ...courseSites])];
  }, [form.courseIds, sites]);

  useEffect(() => {
    setForm((prev) => ({
      ...prev,
      groupIds: prev.groupIds.filter((id) =>
        availableGroups.some((g) => g.id === id),
      ),
      mainSites: prev.mainSites.filter((site) =>
        availableMainSites.includes(site),
      ),
    }));
  }, [availableGroups, availableMainSites]);

  const [selectedExamId, setSelectedExamId] = useState("");
  const selectedExam = exams.find((e) => e.id === selectedExamId);

  const allCoursesSelected =
    courses.length > 0 && form.courseIds.length === courses.length;
  const allMainSitesSelected =
    availableMainSites.length > 0 &&
    form.mainSites.length === availableMainSites.length;
  const allGroupsSelected =
    availableGroups.length > 0 &&
    form.groupIds.length === availableGroups.length;

  const handleSubmit = runAddExamLocked(
    async (e: React.FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      if (!form.name.trim()) {
        toast.error("يرجى إدخال اسم الامتحان");
        return;
      }
      if (form.courseIds.length === 0) {
        toast.error("يرجى اختيار دورة واحدة على الأقل");
        return;
      }
      if (form.mainSites.length === 0) {
        toast.error("يرجى اختيار منطقة واحدة على الأقل أو اختيار الكل");
        return;
      }
      if (availableGroups.length > 0 && form.groupIds.length === 0) {
        toast.error("يرجى اختيار كروب واحد على الأقل أو اختيار الكل");
        return;
      }

      const examData: Omit<Exam, "id"> = {
        name: form.name.trim(),
        type: form.type,
        courseIds: form.courseIds,
        mainSite: form.mainSites.join(","),
        groupId: form.groupIds.join(","),
        date: form.date,
        fullMark: form.fullMark,
        passMark: form.passMark,
        discountMark: form.discountMark,
        opportunitiesPenalty: isCumulativeOrFinal
          ? "فصل مؤقت"
          : form.opportunitiesPenaltyNum,
        dismissalGrade:
          isCumulativeOrFinal && form.dismissalGrade
            ? Number(form.dismissalGrade)
            : null,
        active: true,
        attendanceClosed: false,
        attendance: [],
      };

      addExam(examData);
      setForm({
        name: "",
        type: "يومي",
        courseIds: [],
        mainSites: [],
        groupIds: [],
        date: new Date().toISOString().slice(0, 10),
        fullMark: 100,
        passMark: 60,
        discountMark: 45,
        opportunitiesPenaltyNum: 1,
        dismissalGrade: "",
      });
      toast.success("تمت إضافة الامتحان");
    },
  );

  const toggleCourseSelection = (courseId: string) => {
    setForm((prev) => ({
      ...prev,
      courseIds: toggleSelection(prev.courseIds, courseId),
      groupIds: [],
    }));
  };

  const toggleAllCourses = () => {
    setForm((prev) => ({
      ...prev,
      courseIds: allCoursesSelected ? [] : courses.map((c) => c.id),
      groupIds: [],
    }));
  };

  const toggleMainSiteSelection = (mainSite: string) => {
    setForm((prev) => ({
      ...prev,
      mainSites: toggleSelection(prev.mainSites, mainSite),
    }));
  };

  const toggleAllMainSites = () => {
    setForm((prev) => ({
      ...prev,
      mainSites: allMainSitesSelected ? [] : [...availableMainSites],
    }));
  };

  const toggleGroupSelection = (groupId: string) => {
    setForm((prev) => ({
      ...prev,
      groupIds: toggleSelection(prev.groupIds, groupId),
    }));
  };

  const toggleAllGroups = () => {
    setForm((prev) => ({
      ...prev,
      groupIds: allGroupsSelected ? [] : availableGroups.map((g) => g.id),
    }));
  };

  const handleToggleAttendance = (examId: string, studentId: string) => {
    toggleAttendance(examId, studentId);
  };

  const selectedExamStudents = useMemo(() => {
    if (!selectedExam) return [];
    const selectedMainSites = splitSelection(selectedExam.mainSite);
    const selectedGroupIds = splitSelection(selectedExam.groupId);
    return students.filter((s) => {
      if (!selectedExam.courseIds.includes(s.courseId) || s.status !== "نشط")
        return false;
      if (
        selectedMainSites.length > 0 &&
        !selectedMainSites.includes(s.mainSite)
      )
        return false;
      if (selectedGroupIds.length > 0 && !selectedGroupIds.includes(s.groupId))
        return false;
      return true;
    });
  }, [selectedExam, students]);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>إضافة امتحان جديد</CardTitle>
        </CardHeader>
        <CardContent>
          <form
            onSubmit={handleSubmit}
            className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3"
          >
            <div className="space-y-2">
              <Label htmlFor="exam-name">اسم الامتحان</Label>
              <Input
                id="exam-name"
                name="name"
                autoComplete="off"
                value={form.name}
                onChange={(e) =>
                  setForm((p) => ({ ...p, name: e.target.value }))
                }
                required
                placeholder="اختبار يومي - الخلية"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="exam-type">نوع الامتحان</Label>
              <Select
                value={form.type}
                onValueChange={(v) =>
                  setForm((p) => ({
                    ...p,
                    type: v as "يومي" | "تراكمي" | "فاينل",
                  }))
                }
              >
                <SelectTrigger id="exam-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="يومي">يومي</SelectItem>
                  <SelectItem value="تراكمي">تراكمي</SelectItem>
                  <SelectItem value="فاينل">فاينل</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="exam-courses">الدورات</Label>
              <div className="space-y-2 border rounded-lg p-3 max-h-44 overflow-y-auto">
                <div className="flex items-center gap-2 border-b pb-2">
                  <Checkbox
                    id="exam-all-courses"
                    name="allCourses"
                    checked={allCoursesSelected}
                    onCheckedChange={toggleAllCourses}
                  />
                  <Label
                    htmlFor="exam-all-courses"
                    className="text-sm font-bold"
                  >
                    الكل
                  </Label>
                </div>
                {courses.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    لا توجد دورات مسجلة
                  </p>
                ) : (
                  courses.map((c) => (
                    <div key={c.id} className="flex items-center gap-2">
                      <Checkbox
                        id={`exam-course-${c.id}`}
                        name={`course-${c.id}`}
                        checked={form.courseIds.includes(c.id)}
                        onCheckedChange={() => toggleCourseSelection(c.id)}
                      />
                      <Label
                        htmlFor={`exam-course-${c.id}`}
                        className="text-sm"
                      >
                        {c.name}
                      </Label>
                      <Badge
                        variant={c.type === "خاصة" ? "default" : "secondary"}
                        className="text-[10px]"
                      >
                        {c.type}
                      </Badge>
                    </div>
                  ))
                )}
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="exam-mainSites">المناطق الرئيسية</Label>
              <div className="space-y-2 border rounded-lg p-3 max-h-44 overflow-y-auto">
                <div className="flex items-center gap-2 border-b pb-2">
                  <Checkbox
                    id="exam-all-sites"
                    name="allSites"
                    checked={allMainSitesSelected}
                    onCheckedChange={toggleAllMainSites}
                  />
                  <Label htmlFor="exam-all-sites" className="text-sm font-bold">
                    الكل
                  </Label>
                </div>
                {availableMainSites.map((site) => (
                  <div key={site} className="flex items-center gap-2">
                    <Checkbox
                      id={`exam-site-${site}`}
                      name={`site-${site}`}
                      checked={form.mainSites.includes(site)}
                      onCheckedChange={() => toggleMainSiteSelection(site)}
                    />
                    <Label htmlFor={`exam-site-${site}`} className="text-sm">
                      {site}
                    </Label>
                  </div>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="exam-groups">الكروبات</Label>
              <div className="space-y-2 border rounded-lg p-3 max-h-44 overflow-y-auto">
                <div className="flex items-center gap-2 border-b pb-2">
                  <Checkbox
                    id="exam-all-groups"
                    name="allGroups"
                    checked={allGroupsSelected}
                    disabled={availableGroups.length === 0}
                    onCheckedChange={toggleAllGroups}
                  />
                  <Label
                    htmlFor="exam-all-groups"
                    className="text-sm font-bold"
                  >
                    الكل
                  </Label>
                </div>
                {form.courseIds.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    اختر دورة أولاً لعرض الكروبات
                  </p>
                ) : availableGroups.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    لا توجد كروبات مسجلة لهذه الدورات
                  </p>
                ) : (
                  availableGroups.map((g) => (
                    <div key={g.id} className="flex items-center gap-2">
                      <Checkbox
                        id={`exam-group-${g.id}`}
                        name={`group-${g.id}`}
                        checked={form.groupIds.includes(g.id)}
                        onCheckedChange={() => toggleGroupSelection(g.id)}
                      />
                      <Label htmlFor={`exam-group-${g.id}`} className="text-sm">
                        {g.name} - {courseName(g.courseId)}
                      </Label>
                    </div>
                  ))
                )}
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="exam-date">تاريخ الامتحان</Label>
              <Input
                id="exam-date"
                name="date"
                type="date"
                autoComplete="off"
                value={form.date}
                onChange={(e) =>
                  setForm((p) => ({ ...p, date: e.target.value }))
                }
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="exam-fullMark">الدرجة الكاملة</Label>
              <Input
                id="exam-fullMark"
                name="fullMark"
                type="number"
                autoComplete="off"
                value={form.fullMark}
                onChange={(e) =>
                  setForm((p) => ({
                    ...p,
                    fullMark: Number(toLatinDigits(e.target.value)) || 100,
                  }))
                }
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="exam-passMark">درجة النجاح</Label>
              <Input
                id="exam-passMark"
                name="passMark"
                type="number"
                autoComplete="off"
                value={form.passMark}
                onChange={(e) =>
                  setForm((p) => ({
                    ...p,
                    passMark: Number(toLatinDigits(e.target.value)) || 60,
                  }))
                }
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="exam-discountMark">درجة الخصم</Label>
              <Input
                id="exam-discountMark"
                name="discountMark"
                type="number"
                autoComplete="off"
                value={form.discountMark}
                onChange={(e) =>
                  setForm((p) => ({
                    ...p,
                    discountMark: Number(toLatinDigits(e.target.value)) || 45,
                  }))
                }
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="exam-penalty">خصم الفرص</Label>
              {isCumulativeOrFinal ? (
                <div className="p-2 rounded bg-amber-50 dark:bg-amber-950/40 text-sm">
                  فصل مؤقت تلقائياً عند الغياب
                </div>
              ) : (
                <Input
                  id="exam-penalty"
                  name="opportunitiesPenaltyNum"
                  type="number"
                  min={0}
                  autoComplete="off"
                  value={form.opportunitiesPenaltyNum}
                  onChange={(e) =>
                    setForm((p) => ({
                      ...p,
                      opportunitiesPenaltyNum:
                        Number(toLatinDigits(e.target.value)) || 1,
                    }))
                  }
                />
              )}
            </div>

            {isCumulativeOrFinal && (
              <div className="space-y-2">
                <Label htmlFor="exam-dismissalGrade">درجة الفصل</Label>
                <Input
                  id="exam-dismissalGrade"
                  name="dismissalGrade"
                  type="number"
                  autoComplete="off"
                  value={form.dismissalGrade}
                  onChange={(e) =>
                    setForm((p) => ({
                      ...p,
                      dismissalGrade: toLatinDigits(e.target.value),
                    }))
                  }
                  placeholder="أدنى درجة للفصل"
                />
              </div>
            )}

            <div className="md:col-span-2 lg:col-span-3 space-y-3">
              <Button type="submit" disabled={isAddingExam} className="w-full">
                {isAddingExam ? "جاري الإضافة..." : "إضافة الامتحان"}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>قائمة الامتحانات</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {exams.map((exam) => {
              const examMainSites = splitSelection(exam.mainSite);
              const examGroupIds = splitSelection(exam.groupId);
              return (
                <div
                  key={exam.id}
                  className="p-4 rounded-2xl border bg-card/80 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-lg"
                >
                  <div className="flex items-start justify-between mb-2">
                    <div>
                      <p className="font-bold">{exam.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {exam.date} - {exam.type}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge
                        variant={
                          exam.type === "يومي"
                            ? "secondary"
                            : exam.type === "تراكمي"
                              ? "default"
                              : "destructive"
                        }
                      >
                        {exam.type}
                      </Badge>
                      <Badge variant={exam.active ? "default" : "secondary"}>
                        {exam.active ? "فعال" : "معطل"}
                      </Badge>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-sm mb-2">
                    <div>
                      <span className="text-muted-foreground text-xs">
                        النجاح:
                      </span>{" "}
                      {exam.passMark}
                    </div>
                    <div>
                      <span className="text-muted-foreground text-xs">
                        الخصم:
                      </span>{" "}
                      {exam.discountMark}
                    </div>
                    <div>
                      <span className="text-muted-foreground text-xs">
                        الحضور:
                      </span>{" "}
                      {exam.attendance.length} طالب
                    </div>
                    <div>
                      <span className="text-muted-foreground text-xs">
                        الدورات:
                      </span>{" "}
                      {exam.courseIds.map((id) => courseName(id)).join(", ")}
                    </div>
                    <div>
                      <span className="text-muted-foreground text-xs">
                        المناطق:
                      </span>{" "}
                      {examMainSites.join(", ") || "الكل"}
                    </div>
                    <div>
                      <span className="text-muted-foreground text-xs">
                        الكروبات:
                      </span>{" "}
                      {examGroupIds.map((id) => groupName(id)).join(", ") ||
                        "الكل"}
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => toggleExam(exam.id)}
                    >
                      {exam.active ? "تعطيل" : "تفعيل"}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setSelectedExamId(exam.id)}
                    >
                      إدارة الحضور ({exam.attendance.length})
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {selectedExam && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>إدارة الحضور - {selectedExam.name}</CardTitle>
            <div className="flex gap-2">
              {!selectedExam.attendanceClosed && (
                <Button
                  size="sm"
                  onClick={() => {
                    closeAttendance(selectedExam.id);
                    toast.success("تم إغلاق الحضور");
                  }}
                >
                  إغلاق الحضور
                </Button>
              )}
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setSelectedExamId("")}
              >
                إغلاق
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {selectedExamStudents.length === 0 ? (
                <p className="empty-state">
                  لا يوجد طلاب مطابقون للدورات والمناطق والكروبات المختارة.
                </p>
              ) : (
                selectedExamStudents.map((s) => (
                  <div
                    key={s.id}
                    className="flex items-center justify-between p-2 rounded-xl bg-muted/60"
                  >
                    <span className="text-sm">
                      {s.name} ({s.code})
                    </span>
                    <div className="flex items-center gap-2">
                      <Checkbox
                        id={`exam-attendance-${s.id}`}
                        name={`attendance-${s.id}`}
                        checked={selectedExam.attendance.includes(s.id)}
                        onCheckedChange={() =>
                          handleToggleAttendance(selectedExam.id, s.id)
                        }
                        disabled={selectedExam.attendanceClosed}
                        aria-label={`حضور ${s.name}`}
                      />
                      <Label htmlFor={`exam-attendance-${s.id}`}>
                        <Badge
                          variant={
                            selectedExam.attendance.includes(s.id)
                              ? "default"
                              : "secondary"
                          }
                        >
                          {selectedExam.attendance.includes(s.id)
                            ? "حاضر"
                            : "غائب"}
                        </Badge>
                      </Label>
                    </div>
                  </div>
                ))
              )}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
