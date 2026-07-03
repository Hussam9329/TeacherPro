"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useTeacherStore, type Student } from "@/lib/teacher-store";
import { studentApi } from "@/lib/api";
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
import { searchAny } from "@/lib/validation";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { toast } from "sonner";
import { CustomFilterPresets, type FilterPresetValues } from "./custom-filter-presets";

type ViewMode = "cards" | "table";
type NotesFilter = "all" | "with-notes" | "without-notes";

export function DismissedStudentsView() {
  const { students, courses, courseName, reactivateStudent, updateStudent, mergeStudentsCache } = useTeacherStore();
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search, 180);
  const [filterCourseId, setFilterCourseId] = useState("");
  const [filterDismissalType, setFilterDismissalType] = useState("");
  const [filterNotes, setFilterNotes] = useState<NotesFilter>("all");
  const [viewMode, setViewMode] = useState<ViewMode>("cards");
  const [noteDrafts, setNoteDrafts] = useState<Record<string, string>>({});

  useEffect(() => {
    let cancelled = false;
    studentApi
      .list({ status: "مفصول", pageSize: 200 })
      .then((result) => {
        if (!cancelled) {
          mergeStudentsCache((result?.students || []) as unknown as Student[]);
        }
      })
      .catch(() => {
        // تبقى آخر نسخة محملة متاحة إذا فشل الاتصال.
      });
    return () => {
      cancelled = true;
    };
  }, [mergeStudentsCache]);

  const dismissedTypes = useMemo(
    () => Array.from(new Set(students.filter((student) => student.status === "مفصول").map((student) => student.dismissalType || "مفصول"))).filter(Boolean),
    [students],
  );

  const dismissedStudents = useMemo(() => {
    return students
      .filter((student) => student.status === "مفصول")
      .filter((student) => {
        const hasNotes = Boolean(String(student.dismissalNotes || "").trim());
        if (filterCourseId && student.courseId !== filterCourseId) return false;
        if (filterDismissalType && (student.dismissalType || "مفصول") !== filterDismissalType) return false;
        if (filterNotes === "with-notes" && !hasNotes) return false;
        if (filterNotes === "without-notes" && hasNotes) return false;
        if (debouncedSearch && !searchAny(debouncedSearch, [
          student.name,
          student.code,
          student.phone,
          student.parentPhone,
          student.telegram,
          student.school,
          student.subSite,
          student.locationScope,
          student.dismissalType,
          student.dismissalReason,
          student.dismissalNotes,
        ])) return false;
        return true;
      })
      .sort((a, b) => a.name.localeCompare(b.name, "ar"));
  }, [students, filterCourseId, filterDismissalType, filterNotes, debouncedSearch]);

  const handleReactivate = (studentId: string) => {
    reactivateStudent(studentId);
    toast.success("تمت إعادة تفعيل الطالب");
  };

  const handleSaveNote = (studentId: string) => {
    const student = students.find((item) => item.id === studentId);
    if (!student) return;
    const nextNote = noteDrafts[studentId] ?? student.dismissalNotes ?? "";
    const result = updateStudent(studentId, { dismissalNotes: nextNote });
    if (result.ok) toast.success("تم حفظ ملاحظات الفصل");
    else toast.error(result.message);
  };

  const applyPreset = (values: FilterPresetValues) => {
    setSearch(String(values.search || ""));
    setFilterCourseId(String(values.courseId || ""));
    setFilterDismissalType(String(values.dismissalType || ""));
    setFilterNotes((values.notesFilter as NotesFilter) || "all");
    setViewMode((values.viewMode as ViewMode) || "cards");
  };

  const clearFilters = () => {
    setSearch("");
    setFilterCourseId("");
    setFilterDismissalType("");
    setFilterNotes("all");
    setViewMode("cards");
  };

  const renderNotesEditor = (student: typeof students[number]) => {
    const value = noteDrafts[student.id] ?? student.dismissalNotes ?? "";
    return (
      <div className="space-y-2">
        <Label className="text-xs">ملاحظات الفصل</Label>
        <textarea
          value={value}
          onChange={(event) => setNoteDrafts((prev) => ({ ...prev, [student.id]: event.target.value }))}
          placeholder="اكتب ملاحظات خاصة بهذا الطالب المفصول..."
          className="min-h-20 w-full rounded-2xl border bg-background/70 px-3 py-2 text-sm shadow-xs outline-none focus:border-primary"
        />
        <Button size="sm" variant="outline" onClick={() => handleSaveNote(student.id)}>
          حفظ الملاحظات
        </Button>
      </div>
    );
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>الطلاب المفصولون</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-5">
            <div className="space-y-1 md:col-span-2">
              <Label htmlFor="dismissed-search" className="text-xs">بحث ذكي</Label>
              <Input id="dismissed-search" name="search" data-teacherpro-search="true" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="اسم / كود / سبب / ملاحظات / تليكرام" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="dismissed-course" className="text-xs">الدورة</Label>
              <Select value={filterCourseId || "all"} onValueChange={(value) => setFilterCourseId(value === "all" ? "" : value)}>
                <SelectTrigger id="dismissed-course"><SelectValue placeholder="الكل" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">الكل</SelectItem>
                  {courses.map((course) => <SelectItem key={course.id} value={course.id}>{course.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="dismissed-type" className="text-xs">نوع الفصل</Label>
              <Select value={filterDismissalType || "all"} onValueChange={(value) => setFilterDismissalType(value === "all" ? "" : value)}>
                <SelectTrigger id="dismissed-type"><SelectValue placeholder="الكل" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">الكل</SelectItem>
                  {dismissedTypes.map((type) => <SelectItem key={type} value={type}>{type}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="dismissed-notes" className="text-xs">الملاحظات</Label>
              <Select value={filterNotes} onValueChange={(value) => setFilterNotes(value as NotesFilter)}>
                <SelectTrigger id="dismissed-notes"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">الكل</SelectItem>
                  <SelectItem value="with-notes">لديهم ملاحظات</SelectItem>
                  <SelectItem value="without-notes">بدون ملاحظات</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="dismissed-view" className="text-xs">طريقة العرض</Label>
              <Select value={viewMode} onValueChange={(value) => setViewMode(value as ViewMode)}>
                <SelectTrigger id="dismissed-view"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="cards">الكارتات</SelectItem>
                  <SelectItem value="table">الجدول</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <CustomFilterPresets
            storageKey="teacherpro.dismissed.customFilters"
            currentFilters={{ search, courseId: filterCourseId, dismissalType: filterDismissalType, notesFilter: filterNotes, viewMode }}
            onApply={applyPreset}
            onClear={clearFilters}
          />
        </CardContent>
      </Card>

      {viewMode === "cards" ? (
        <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
          {dismissedStudents.map((student) => (
            <Card key={student.id}>
              <CardContent className="space-y-3 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="font-bold">{student.name}</h3>
                      <Badge variant="destructive">{student.dismissalType || "مفصول"}</Badge>
                    </div>
                    <p className="text-xs text-muted-foreground">{student.code} - {courseName(student.courseId)} - {student.subSite || student.locationScope || "بدون موقع"}</p>
                  </div>
                  <Button size="sm" onClick={() => handleReactivate(student.id)}>إعادة تفعيل</Button>
                </div>
                <div className="rounded-xl bg-muted/60 p-3 text-sm text-destructive">
                  {student.dismissalReason || "لا يوجد سبب مسجل"}
                </div>
                {renderNotesEditor(student)}
                <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                  <span>الهاتف: {student.phone || "—"}</span>
                  <span>ولي الأمر: {student.parentPhone || "—"}</span>
                  <span>التليكرام: {student.telegram || "—"}</span>
                  <span>الفرص: {student.opportunities}/{student.baseOpportunities}</span>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <div className="table-wrap">
          <table className="responsive-table text-sm">
            <thead>
              <tr>
                <th className="p-3 text-right">الطالب</th>
                <th className="p-3 text-right">الكود</th>
                <th className="p-3 text-right">الدورة</th>
                <th className="p-3 text-right">نوع الفصل</th>
                <th className="p-3 text-right">السبب</th>
                <th className="p-3 text-right">الملاحظات</th>
                <th className="p-3 text-right">الفرص</th>
                <th className="p-3 text-right">الإجراء</th>
              </tr>
            </thead>
            <tbody>
              {dismissedStudents.map((student) => (
                <tr key={student.id} className="border-t align-top">
                  <td className="p-3 font-medium">{student.name}</td>
                  <td className="p-3">{student.code}</td>
                  <td className="p-3">{courseName(student.courseId)}</td>
                  <td className="p-3"><Badge variant="destructive">{student.dismissalType || "مفصول"}</Badge></td>
                  <td className="p-3 min-w-64 text-destructive">{student.dismissalReason || "—"}</td>
                  <td className="p-3 min-w-72">{renderNotesEditor(student)}</td>
                  <td className="p-3">{student.opportunities}/{student.baseOpportunities}</td>
                  <td className="p-3"><Button size="sm" onClick={() => handleReactivate(student.id)}>إعادة تفعيل</Button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {dismissedStudents.length === 0 && (
        <p className="empty-state">لا يوجد طلاب مفصولون حسب الفلترة الحالية.</p>
      )}
    </div>
  );
}
