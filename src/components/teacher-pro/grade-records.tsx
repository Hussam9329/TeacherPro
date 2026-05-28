"use client";

import React, { useState, useMemo } from "react";
import { useTeacherStore } from "@/lib/teacher-store";
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
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import { searchAny } from "@/lib/validation";
import { useActionLock } from "@/hooks/use-action-lock";

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
  const [accountingChecked, setAccountingChecked] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [deleteDialog, setDeleteDialog] = useState({
    open: false,
    id: "",
    label: "",
  });
  const { locked: isDeletingGrade, runLocked: runDeleteGradeLocked } =
    useActionLock();

  const filtered = useMemo(() => {
    return grades.filter((g) => {
      const student = students.find((s) => s.id === g.studentId);
      const exam = exams.find((e) => e.id === g.examId);
      if (!student || !exam) return false;
      if (
        search &&
        !searchAny(search, [student.name, student.code, student.telegram])
      )
        return false;
      if (filterExamId && g.examId !== filterExamId) return false;
      if (filterStatus && g.status !== filterStatus) return false;
      if (filterCourseId && !exam.courseIds.includes(filterCourseId))
        return false;
      if (accountingChecked && !g.accountingChecked) return false;
      return true;
    });
  }, [
    grades,
    students,
    exams,
    search,
    filterExamId,
    filterStatus,
    filterCourseId,
    accountingChecked,
  ]);

  const totalPages = Math.ceil(filtered.length / pageSize);
  const paged = filtered.slice((page - 1) * pageSize, page * pageSize);

  const handleEditGrade = (gradeId: string) => {
    const grade = grades.find((g) => g.id === gradeId);
    if (!grade) return;
    const nextStatus = prompt(
      "الحالة: درجة / غائب / مجاز / غش",
      grade.status,
    ) as "درجة" | "غائب" | "مجاز" | "غش" | null;
    if (!nextStatus || !["درجة", "غائب", "مجاز", "غش"].includes(nextStatus))
      return;
    const nextScore =
      nextStatus === "درجة"
        ? Number(prompt("الدرجة", String(grade.score ?? 0)) || 0)
        : null;
    const notes = prompt("الملاحظات", grade.notes) ?? grade.notes;
    updateGrade(gradeId, { status: nextStatus, score: nextScore, notes });
    toast.success("تم تعديل السجل");
  };

  const openDeleteGradeDialog = (gradeId: string) => {
    const grade = grades.find((g) => g.id === gradeId);
    const student = grade
      ? students.find((s) => s.id === grade.studentId)
      : null;
    const exam = grade ? exams.find((e) => e.id === grade.examId) : null;
    setDeleteDialog({
      open: true,
      id: gradeId,
      label: [student?.name, exam?.name].filter(Boolean).join(" - "),
    });
  };

  const handleDeleteGrade = runDeleteGradeLocked(async () => {
    const ok = deleteGrade(deleteDialog.id);
    ok ? toast.success("تم حذف الدرجة") : toast.error("تعذر حذف الدرجة");
    setDeleteDialog({ open: false, id: "", label: "" });
  });

  const exportCSV = () => {
    const headers = [
      "الطالب",
      "الكود",
      "التلكرام",
      "الامتحان",
      "الحالة",
      "الدرجة",
      "التصنيف",
      "محاسبة",
      "ملاحظات",
    ];
    const rows = filtered.map((g) => {
      const student = students.find((s) => s.id === g.studentId);
      const exam = exams.find((e) => e.id === g.examId);
      const cls = classification(g, exam!);
      return [
        student?.name || "",
        student?.code || "",
        student?.telegram || "",
        exam?.name || "",
        g.status,
        g.score?.toString() || "",
        cls.text,
        g.accountingChecked ? "نعم" : "لا",
        g.notes,
      ]
        .map((v) => `"${v}"`)
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
      {/* Filters */}
      <Card>
        <CardContent className="p-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-6">
            <div className="space-y-1">
              <Label htmlFor="grade-records-search" className="text-xs">
                بحث
              </Label>
              <Input
                id="grade-records-search"
                name="search"
                autoComplete="off"
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPage(1);
                }}
                placeholder="اسم / كود / تلكرام"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="grade-records-exam" className="text-xs">
                الامتحان
              </Label>
              <Select
                value={filterExamId}
                onValueChange={(v) => {
                  setFilterExamId(v === "all" ? "" : v);
                  setPage(1);
                }}
              >
                <SelectTrigger id="grade-records-exam">
                  <SelectValue placeholder="الكل" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">الكل</SelectItem>
                  {exams.map((e) => (
                    <SelectItem key={e.id} value={e.id}>
                      {e.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="grade-records-status" className="text-xs">
                الحالة
              </Label>
              <Select
                value={filterStatus}
                onValueChange={(v) => {
                  setFilterStatus(v === "all" ? "" : v);
                  setPage(1);
                }}
              >
                <SelectTrigger id="grade-records-status">
                  <SelectValue placeholder="الكل" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">الكل</SelectItem>
                  <SelectItem value="درجة">درجة</SelectItem>
                  <SelectItem value="غائب">غائب</SelectItem>
                  <SelectItem value="مجاز">مجاز</SelectItem>
                  <SelectItem value="غش">غش</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="grade-records-course" className="text-xs">
                الدورة
              </Label>
              <Select
                value={filterCourseId}
                onValueChange={(v) => {
                  setFilterCourseId(v === "all" ? "" : v);
                  setPage(1);
                }}
              >
                <SelectTrigger id="grade-records-course">
                  <SelectValue placeholder="الكل" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">الكل</SelectItem>
                  {courses.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-2 pt-5">
              <Checkbox
                id="grade-records-accounting"
                checked={accountingChecked}
                onCheckedChange={(v) => {
                  setAccountingChecked(!!v);
                  setPage(1);
                }}
              />
              <Label htmlFor="grade-records-accounting" className="text-xs">
                محاسبة فقط
              </Label>
            </div>
            <div className="space-y-1">
              <span className="text-xs font-medium">تصدير</span>
              <Button
                variant="outline"
                size="sm"
                className="w-full h-9"
                onClick={exportCSV}
              >
                تصدير CSV
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Count */}
      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <span>
          عرض {paged.length} من {filtered.length} سجل
        </span>
        <div className="flex items-center gap-2">
          <Label htmlFor="grade-records-pageSize" className="text-xs">
            حجم الصفحة:
          </Label>
          <Select
            value={String(pageSize)}
            onValueChange={(v) => {
              setPageSize(Number(v));
              setPage(1);
            }}
          >
            <SelectTrigger id="grade-records-pageSize" className="w-20 h-8">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="10">10</SelectItem>
              <SelectItem value="50">50</SelectItem>
              <SelectItem value="100">100</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Grade Cards */}
      <div className="space-y-2">
        {paged.map((g) => {
          const student = students.find((s) => s.id === g.studentId);
          const exam = exams.find((e) => e.id === g.examId);
          if (!student || !exam) return null;
          const cls = classification(g, exam);

          return (
            <div
              key={g.id}
              className="flex items-center justify-between gap-3 p-3 rounded-2xl border bg-card/80 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-lg"
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="font-medium text-sm truncate">{student.name}</p>
                  <Badge variant="outline" className="text-[10px]">
                    {student.code}
                  </Badge>
                </div>
                <div className="flex items-center gap-2 text-xs text-muted-foreground mt-1">
                  <span>{student.telegram}</span>
                  <span>•</span>
                  <span>{exam.name}</span>
                  <span>•</span>
                  <span>{g.createdAt}</span>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {g.score !== null && (
                  <span className="font-bold">
                    {g.score}/{exam.fullMark}
                  </span>
                )}
                <Badge
                  variant={
                    cls.type === "ok"
                      ? "default"
                      : cls.type === "danger"
                        ? "destructive"
                        : cls.type === "warn"
                          ? "secondary"
                          : "outline"
                  }
                >
                  {cls.text}
                </Badge>
                {g.accountingChecked && <Badge variant="outline">محاسبة</Badge>}
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => handleEditGrade(g.id)}
                >
                  تعديل
                </Button>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => openDeleteGradeDialog(g.id)}
                >
                  حذف
                </Button>
              </div>
            </div>
          );
        })}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={page <= 1}
            onClick={() => setPage((p) => p - 1)}
          >
            السابق
          </Button>
          <span className="text-sm text-muted-foreground">
            {page} / {totalPages}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={page >= totalPages}
            onClick={() => setPage((p) => p + 1)}
          >
            التالي
          </Button>
        </div>
      )}

      <AlertDialog
        open={deleteDialog.open}
        onOpenChange={(open) => setDeleteDialog((prev) => ({ ...prev, open }))}
      >
        <AlertDialogContent dir="rtl">
          <AlertDialogHeader>
            <AlertDialogTitle>تأكيد الحذف</AlertDialogTitle>
            <AlertDialogDescription>
              هل أنت متأكد من حذف سجل الدرجة
              {deleteDialog.label ? ` (${deleteDialog.label})` : ""}؟ لا يمكن
              التراجع عن هذه العملية.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>إلغاء</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteGrade}
              disabled={isDeletingGrade}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isDeletingGrade ? "جاري الحذف..." : "حذف"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
