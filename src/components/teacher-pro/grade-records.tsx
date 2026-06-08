"use client";

import React, { useMemo, useState } from "react";
import { useTeacherStore } from "@/lib/teacher-store";
import { Card, CardContent } from "@/components/ui/card";
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
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { toLatinDigits } from "@/lib/format";
import { searchAny } from "@/lib/validation";
import { isGradeEntered } from "@/lib/exam-utils";
import { useActionLock } from "@/hooks/use-action-lock";

type GradeStatus = "درجة" | "غائب" | "مجاز" | "غش";
type ViewMode = "cards" | "table";

export function GradeRecordsView() {
  const {
    grades,
    exams,
    students,
    courses,
    updateGrade,
    deleteGrade,
    classification,
  } = useTeacherStore();

  const [search, setSearch] = useState("");
  const [filterExamId, setFilterExamId] = useState("");
  const [filterStatus, setFilterStatus] = useState("");
  const [filterCourseId, setFilterCourseId] = useState("");
  const [viewMode, setViewMode] = useState<ViewMode>("cards");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [deleteDialog, setDeleteDialog] = useState({ open: false, id: "", label: "" });
  const [editDialog, setEditDialog] = useState({
    open: false,
    id: "",
    status: "درجة" as GradeStatus,
    score: "",
    notes: "",
  });
  const { locked: isDeletingGrade, runLocked: runDeleteGradeLocked } = useActionLock();

  const filtered = useMemo(() => {
    return grades.filter((grade) => {
      const student = students.find((item) => item.id === grade.studentId);
      const exam = exams.find((item) => item.id === grade.examId);
      if (!student || !exam || !isGradeEntered(grade, exam)) return false;
      if (search && !searchAny(search, [student.name, student.code, student.telegram, student.phone, student.subSite, student.locationScope, exam.name, grade.notes])) return false;
      if (filterExamId && grade.examId !== filterExamId) return false;
      if (filterStatus && grade.status !== filterStatus) return false;
      if (filterCourseId && !exam.courseIds.includes(filterCourseId)) return false;
      return true;
    });
  }, [grades, students, exams, search, filterExamId, filterStatus, filterCourseId]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const paged = filtered.slice((page - 1) * pageSize, page * pageSize);

  const openEditGradeDialog = (gradeId: string) => {
    const grade = grades.find((item) => item.id === gradeId);
    if (!grade) return;
    setEditDialog({
      open: true,
      id: grade.id,
      status: grade.status as GradeStatus,
      score: grade.score !== null && grade.score !== undefined ? String(grade.score) : "",
      notes: grade.notes || "",
    });
  };

  const handleSaveEditGrade = () => {
    const grade = grades.find((item) => item.id === editDialog.id);
    const exam = grade ? exams.find((item) => item.id === grade.examId) : null;
    if (!grade || !exam) return;
    const score = editDialog.status === "درجة" ? Number(toLatinDigits(editDialog.score)) : null;
    if (editDialog.status === "درجة" && (!Number.isFinite(score) || score === null || score < 0 || score > exam.fullMark)) {
      toast.error(`الدرجة يجب أن تكون بين 0 و ${exam.fullMark}`);
      return;
    }
    updateGrade(editDialog.id, {
      status: editDialog.status,
      score,
      notes: editDialog.notes,
    });
    setEditDialog({ open: false, id: "", status: "درجة", score: "", notes: "" });
    toast.success("تم تعديل الدرجة وإعادة الاحتساب");
  };

  const openDeleteGradeDialog = (gradeId: string) => {
    const grade = grades.find((item) => item.id === gradeId);
    const student = grade ? students.find((item) => item.id === grade.studentId) : null;
    const exam = grade ? exams.find((item) => item.id === grade.examId) : null;
    setDeleteDialog({ open: true, id: gradeId, label: [student?.name, exam?.name].filter(Boolean).join(" - ") });
  };

  const handleDeleteGrade = runDeleteGradeLocked(async () => {
    const ok = deleteGrade(deleteDialog.id);
    ok ? toast.success("تم حذف الدرجة") : toast.error("تعذر حذف الدرجة");
    setDeleteDialog({ open: false, id: "", label: "" });
  });

  const exportCSV = () => {
    const headers = ["الطالب", "الكود", "التليكرام", "الامتحان", "الحالة", "الدرجة", "التصنيف", "ملاحظات"];
    const rows = filtered.map((grade) => {
      const student = students.find((item) => item.id === grade.studentId);
      const exam = exams.find((item) => item.id === grade.examId);
      const cls = exam ? classification(grade, exam, student) : { text: "" };
      return [student?.name || "", student?.code || "", student?.telegram || "", exam?.name || "", grade.status, grade.score?.toString() || "", cls.text, grade.notes || ""]
        .map((value) => `"${String(value).replaceAll('"', '""')}"`)
        .join(",");
    });
    const csv = "\ufeff" + [headers.join(","), ...rows].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `grades-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("تم تصدير السجل");
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="p-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-6">
            <div className="space-y-1">
              <Label htmlFor="grade-records-search" className="text-xs">بحث</Label>
              <Input id="grade-records-search" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} placeholder="اسم / كود / تليكرام / امتحان" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="grade-records-exam" className="text-xs">الامتحان</Label>
              <Select value={filterExamId || "all"} onValueChange={(v) => { setFilterExamId(v === "all" ? "" : v); setPage(1); }}>
                <SelectTrigger id="grade-records-exam"><SelectValue placeholder="الكل" /></SelectTrigger>
                <SelectContent><SelectItem value="all">الكل</SelectItem>{exams.map((exam) => <SelectItem key={exam.id} value={exam.id}>{exam.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="grade-records-status" className="text-xs">الحالة</Label>
              <Select value={filterStatus || "all"} onValueChange={(v) => { setFilterStatus(v === "all" ? "" : v); setPage(1); }}>
                <SelectTrigger id="grade-records-status"><SelectValue placeholder="الكل" /></SelectTrigger>
                <SelectContent><SelectItem value="all">الكل</SelectItem><SelectItem value="درجة">درجة</SelectItem><SelectItem value="غائب">غائب</SelectItem><SelectItem value="مجاز">مجاز</SelectItem><SelectItem value="غش">غش</SelectItem></SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="grade-records-course" className="text-xs">الدورة</Label>
              <Select value={filterCourseId || "all"} onValueChange={(v) => { setFilterCourseId(v === "all" ? "" : v); setPage(1); }}>
                <SelectTrigger id="grade-records-course"><SelectValue placeholder="الكل" /></SelectTrigger>
                <SelectContent><SelectItem value="all">الكل</SelectItem>{courses.map((course) => <SelectItem key={course.id} value={course.id}>{course.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="grade-records-view" className="text-xs">طريقة العرض</Label>
              <Select value={viewMode} onValueChange={(v) => setViewMode(v as ViewMode)}>
                <SelectTrigger id="grade-records-view"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="cards">الكارتات</SelectItem><SelectItem value="table">الجدول</SelectItem></SelectContent>
              </Select>
            </div>
            <div className="space-y-1"><span className="text-xs font-medium">تصدير</span><Button variant="outline" size="sm" className="h-9 w-full" onClick={exportCSV}>تصدير CSV</Button></div>
          </div>
        </CardContent>
      </Card>

      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <span>عرض {paged.length} من {filtered.length} سجل</span>
        <div className="flex items-center gap-2">
          <Label htmlFor="grade-records-pageSize" className="text-xs">حجم الصفحة:</Label>
          <Select value={String(pageSize)} onValueChange={(v) => { setPageSize(Number(v)); setPage(1); }}>
            <SelectTrigger id="grade-records-pageSize" className="h-8 w-20"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="10">10</SelectItem><SelectItem value="50">50</SelectItem><SelectItem value="100">100</SelectItem></SelectContent>
          </Select>
        </div>
      </div>

      {viewMode === "cards" ? (
        <div className="space-y-2">
          {paged.map((grade) => {
            const student = students.find((item) => item.id === grade.studentId);
            const exam = exams.find((item) => item.id === grade.examId);
            if (!student || !exam) return null;
            const cls = classification(grade, exam, student);
            return (
              <div key={grade.id} className="flex flex-col gap-3 rounded-2xl border bg-card/80 p-3 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-lg lg:flex-row lg:items-center lg:justify-between">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2"><p className="truncate text-sm font-medium">{student.name}</p><Badge variant="outline" className="text-[10px]">{student.code}</Badge></div>
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground"><span>{student.telegram}</span><span>•</span><span>{student.subSite || student.locationScope || "—"}</span><span>•</span><span>{exam.name}</span><span>•</span><span>{grade.createdAt}</span></div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {grade.score !== null && <span className="font-bold">{grade.score}/{exam.fullMark}</span>}
                  <Badge variant={cls.type === "ok" ? "default" : cls.type === "danger" ? "destructive" : cls.type === "warn" ? "secondary" : "outline"}>{cls.text}</Badge>
                  <Button variant="secondary" size="sm" onClick={() => openEditGradeDialog(grade.id)}>تعديل</Button>
                  <Button variant="destructive" size="sm" onClick={() => openDeleteGradeDialog(grade.id)}>حذف</Button>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="table-wrap">
          <table className="responsive-table text-sm">
            <thead>
              <tr>
                <th className="p-3 text-right">الطالب</th>
                <th className="p-3 text-right">الكود</th>
                <th className="p-3 text-right">الموقع</th>
                <th className="p-3 text-right">الامتحان</th>
                <th className="p-3 text-right">الحالة</th>
                <th className="p-3 text-right">الدرجة</th>
                <th className="p-3 text-right">التصنيف</th>
                <th className="p-3 text-right">ملاحظات</th>
                <th className="p-3 text-right">الإجراءات</th>
              </tr>
            </thead>
            <tbody>
              {paged.map((grade) => {
                const student = students.find((item) => item.id === grade.studentId);
                const exam = exams.find((item) => item.id === grade.examId);
                if (!student || !exam) return null;
                const cls = classification(grade, exam, student);
                return (
                  <tr key={grade.id} className="border-t align-top">
                    <td className="p-3 font-medium">{student.name}</td>
                    <td className="p-3">{student.code}</td>
                    <td className="p-3">{student.subSite || student.locationScope || student.mainSite || "—"}</td>
                    <td className="p-3">{exam.name}</td>
                    <td className="p-3">{grade.status}</td>
                    <td className="p-3">{grade.score !== null ? `${grade.score}/${exam.fullMark}` : "—"}</td>
                    <td className="p-3"><Badge variant={cls.type === "ok" ? "default" : cls.type === "danger" ? "destructive" : cls.type === "warn" ? "secondary" : "outline"}>{cls.text}</Badge></td>
                    <td className="p-3 min-w-48">{grade.notes || "—"}</td>
                    <td className="p-3 min-w-32"><div className="flex flex-wrap gap-1"><Button variant="secondary" size="sm" onClick={() => openEditGradeDialog(grade.id)}>تعديل</Button><Button variant="destructive" size="sm" onClick={() => openDeleteGradeDialog(grade.id)}>حذف</Button></div></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2">
          <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((prev) => prev - 1)}>السابق</Button>
          <span className="text-sm text-muted-foreground">{page} / {totalPages}</span>
          <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage((prev) => prev + 1)}>التالي</Button>
        </div>
      )}

      <Dialog open={editDialog.open} onOpenChange={(open) => setEditDialog((prev) => ({ ...prev, open }))}>
        <DialogContent dir="rtl">
          <DialogHeader><DialogTitle>تعديل درجة الطالب</DialogTitle></DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label>الحالة</Label>
              <Select value={editDialog.status} onValueChange={(value) => setEditDialog((prev) => ({ ...prev, status: value as GradeStatus }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="درجة">درجة</SelectItem><SelectItem value="غائب">غائب</SelectItem><SelectItem value="مجاز">مجاز</SelectItem><SelectItem value="غش">غش</SelectItem></SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>الدرجة</Label>
              <Input type="number" disabled={editDialog.status !== "درجة"} value={editDialog.score} onChange={(e) => setEditDialog((prev) => ({ ...prev, score: toLatinDigits(e.target.value) }))} />
            </div>
            <div className="space-y-1 sm:col-span-2">
              <Label>الملاحظات</Label>
              <Input value={editDialog.notes} onChange={(e) => setEditDialog((prev) => ({ ...prev, notes: e.target.value }))} placeholder="سبب الإجازة أو ملاحظة التصحيح" />
            </div>
          </div>
          <DialogFooter><Button variant="ghost" onClick={() => setEditDialog({ open: false, id: "", status: "درجة", score: "", notes: "" })}>إلغاء</Button><Button onClick={handleSaveEditGrade}>حفظ التعديل</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleteDialog.open} onOpenChange={(open) => setDeleteDialog((prev) => ({ ...prev, open }))}>
        <AlertDialogContent dir="rtl">
          <AlertDialogHeader><AlertDialogTitle>تأكيد الحذف</AlertDialogTitle><AlertDialogDescription>هل أنت متأكد من حذف سجل الدرجة{deleteDialog.label ? ` (${deleteDialog.label})` : ""}؟ لا يمكن التراجع عن هذه العملية.</AlertDialogDescription></AlertDialogHeader>
          <AlertDialogFooter><AlertDialogCancel>إلغاء</AlertDialogCancel><AlertDialogAction onClick={handleDeleteGrade} disabled={isDeletingGrade} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">{isDeletingGrade ? "جاري الحذف..." : "حذف"}</AlertDialogAction></AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
