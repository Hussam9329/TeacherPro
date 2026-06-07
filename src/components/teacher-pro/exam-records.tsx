"use client";

import React, { useMemo, useState } from "react";
import { useTeacherStore } from "@/lib/teacher-store";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
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
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { useActionLock } from "@/hooks/use-action-lock";
import { downloadTextFile, escapeHtml, getExamStatus } from "@/lib/exam-utils";
import { searchAny } from "@/lib/validation";

type ReportOptions = {
  orientation: "portrait" | "landscape";
  showPhone: boolean;
  showTelegram: boolean;
  showNotes: boolean;
};

const defaultReportOptions: ReportOptions = {
  orientation: "portrait",
  showPhone: false,
  showTelegram: true,
  showNotes: true,
};

export function ExamRecordsView() {
  const {
    exams,
    grades,
    students,
    courses,
    updateExam,
    deleteExam,
    courseName,
    classification,
  } = useTeacherStore();

  const [search, setSearch] = useState("");
  const [filterType, setFilterType] = useState("");
  const [filterCourseId, setFilterCourseId] = useState("");
  const [reportOptions, setReportOptions] = useState<ReportOptions>(defaultReportOptions);
  const [customizeOpen, setCustomizeOpen] = useState(false);
  const [deleteDialog, setDeleteDialog] = useState({ open: false, id: "", name: "" });
  const [editDialog, setEditDialog] = useState({ open: false, id: "", name: "", passMark: "", discountMark: "", fullMark: "" });
  const { locked: isDeletingExam, runLocked: runDeleteExamLocked } = useActionLock();

  const filteredExams = useMemo(() => {
    return exams.filter((exam) => {
      if (search && !searchAny(search, [exam.name, exam.date, ...exam.courseIds.map(courseName)])) return false;
      if (filterType && exam.type !== filterType) return false;
      if (filterCourseId && !exam.courseIds.includes(filterCourseId)) return false;
      return true;
    });
  }, [exams, search, filterType, filterCourseId, courseName]);

  const examRows = (examId: string) => {
    const exam = exams.find((item) => item.id === examId);
    if (!exam) return [];
    return grades
      .filter((grade) => grade.examId === examId)
      .map((grade) => {
        const student = students.find((item) => item.id === grade.studentId);
        const cls = classification(grade, exam);
        return { grade, student, cls };
      })
      .filter((row) => row.student)
      .sort((a, b) => (a.student?.name || "").localeCompare(b.student?.name || "", "ar"));
  };

  const exportCSV = (examId: string) => {
    const exam = exams.find((item) => item.id === examId);
    if (!exam) return;
    const headers = ["#", "الكود", "الطالب", "الدورة", "الحالة", "الدرجة", "التصنيف", "الهاتف", "التليكرام", "ملاحظات"];
    const rows = examRows(examId).map((row, index) => [
      String(index + 1),
      row.student?.code || "",
      row.student?.name || "",
      row.student ? courseName(row.student.courseId) : "",
      row.grade.status,
      row.grade.score === null ? "" : `${row.grade.score}/${exam.fullMark}`,
      row.cls.text,
      row.student?.phone || "",
      row.student?.telegram || "",
      row.grade.notes || "",
    ]);
    const csv = "\ufeff" + [headers, ...rows].map((row) => row.map((value) => `"${String(value).replaceAll('"', '""')}"`).join(",")).join("\n");
    downloadTextFile(csv, `exam-${exam.name}-${new Date().toISOString().slice(0, 10)}.csv`, "text/csv;charset=utf-8");
    toast.success("تم تصدير CSV");
  };

  const exportExcel = (examId: string) => {
    const exam = exams.find((item) => item.id === examId);
    if (!exam) return;
    const rows = examRows(examId).map((row, index) => `
      <tr>
        <td>${index + 1}</td><td>${escapeHtml(row.student?.code)}</td><td>${escapeHtml(row.student?.name)}</td>
        <td>${escapeHtml(row.student ? courseName(row.student.courseId) : "")}</td><td>${escapeHtml(row.grade.status)}</td>
        <td>${escapeHtml(row.grade.score === null ? "" : `${row.grade.score}/${exam.fullMark}`)}</td><td>${escapeHtml(row.cls.text)}</td>
        <td>${escapeHtml(row.student?.phone)}</td><td>${escapeHtml(row.student?.telegram)}</td><td>${escapeHtml(row.grade.notes)}</td>
      </tr>`).join("");
    const html = `<!doctype html><html dir="rtl"><head><meta charset="utf-8" /></head><body><table border="1"><thead><tr><th>#</th><th>الكود</th><th>الطالب</th><th>الدورة</th><th>الحالة</th><th>الدرجة</th><th>التصنيف</th><th>الهاتف</th><th>التليكرام</th><th>ملاحظات</th></tr></thead><tbody>${rows}</tbody></table></body></html>`;
    downloadTextFile(html, `exam-${exam.name}.xls`, "application/vnd.ms-excel;charset=utf-8");
    toast.success("تم تصدير Excel");
  };

  const exportPDF = (examId: string) => {
    const exam = exams.find((item) => item.id === examId);
    if (!exam) return;
    const rows = examRows(examId);
    const passCount = rows.filter((row) => row.cls.kind === "pass").length;
    const belowPassCount = rows.filter((row) => row.cls.kind === "below-pass" || row.cls.kind === "fail").length;
    const deductedCount = rows.filter((row) => row.cls.kind === "deducted" || row.cls.kind === "dismissal" || row.cls.kind === "cheat").length;

    const tableRows = rows.map((row, index) => `
      <tr>
        <td>${index + 1}</td>
        <td>${escapeHtml(row.student?.code)}</td>
        <td>${escapeHtml(row.student?.name)}</td>
        <td>${escapeHtml(row.student ? courseName(row.student.courseId) : "")}</td>
        <td>${escapeHtml(row.grade.status)}</td>
        <td>${escapeHtml(row.grade.score === null ? "-" : `${row.grade.score}/${exam.fullMark}`)}</td>
        <td><span class="pill">${escapeHtml(row.cls.text)}</span></td>
        ${reportOptions.showPhone ? `<td>${escapeHtml(row.student?.phone)}</td>` : ""}
        ${reportOptions.showTelegram ? `<td>${escapeHtml(row.student?.telegram)}</td>` : ""}
        ${reportOptions.showNotes ? `<td>${escapeHtml(row.grade.notes || "-")}</td>` : ""}
      </tr>`).join("");

    const extraHeaders = `${reportOptions.showPhone ? "<th>الهاتف</th>" : ""}${reportOptions.showTelegram ? "<th>التليكرام</th>" : ""}${reportOptions.showNotes ? "<th>ملاحظات</th>" : ""}`;
    const html = `<!doctype html>
<html dir="rtl" lang="ar">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(exam.name)}</title>
<style>
@page { size: A4 ${reportOptions.orientation}; margin: 12mm; }
* { box-sizing: border-box; }
body { margin: 0; font-family: "Cairo", "Tahoma", Arial, sans-serif; color: #111827; background: #f8fafc; direction: rtl; }
.toolbar { position: sticky; top: 0; display: flex; gap: 8px; padding: 12px; background: #111827; color: white; z-index: 3; }
.toolbar button { border: 0; border-radius: 12px; padding: 10px 16px; cursor: pointer; font-weight: 700; }
.report { max-width: 1200px; margin: 24px auto; background: white; border-radius: 24px; padding: 28px; box-shadow: 0 24px 80px rgba(15,23,42,.12); }
.header { display: flex; justify-content: space-between; gap: 16px; border-bottom: 3px solid #7c3aed; padding-bottom: 18px; }
.brand { font-size: 28px; font-weight: 900; color: #6d28d9; }
h1 { margin: 8px 0 0; font-size: 22px; }
.meta { color: #64748b; line-height: 1.9; font-size: 13px; }
.stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin: 20px 0; }
.stat { border: 1px solid #e5e7eb; border-radius: 18px; padding: 14px; background: #faf5ff; }
.stat strong { display:block; font-size: 22px; color: #581c87; }
table { width: 100%; border-collapse: collapse; overflow: hidden; border-radius: 18px; font-size: 12px; }
th { background: #ede9fe; color: #2e1065; }
th,td { border: 1px solid #e5e7eb; padding: 9px; text-align: right; }
tr:nth-child(even) td { background: #f8fafc; }
.pill { display:inline-block; border-radius:999px; padding:4px 10px; background:#f3e8ff; color:#6b21a8; font-weight:700; }
.footer { margin-top: 18px; color: #64748b; font-size: 11px; display:flex; justify-content:space-between; }
@media print { body { background: white; } .toolbar { display: none; } .report { box-shadow: none; margin: 0; border-radius: 0; padding: 0; max-width: none; } }
</style>
</head>
<body>
<div class="toolbar"><button onclick="window.print()">طباعة / حفظ PDF</button><button onclick="window.close()">إغلاق</button></div>
<main class="report">
  <section class="header">
    <div><div class="brand">TeacherPro</div><h1>سجل الامتحان: ${escapeHtml(exam.name)}</h1><div class="meta">التاريخ: ${escapeHtml(exam.date)} | النوع: ${escapeHtml(exam.type)} | الحالة: ${escapeHtml(getExamStatus(exam))}</div></div>
    <div class="meta">الدورات: ${escapeHtml(exam.courseIds.map(courseName).join("، "))}<br/>النجاح: ${exam.passMark} | الخصم: ${exam.discountMark} | الدرجة الكاملة: ${exam.fullMark}</div>
  </section>
  <section class="stats">
    <div class="stat"><strong>${rows.length}</strong><span>إجمالي السجلات</span></div>
    <div class="stat"><strong>${passCount}</strong><span>ناجح</span></div>
    <div class="stat"><strong>${belowPassCount}</strong><span>دون النجاح</span></div>
    <div class="stat"><strong>${deductedCount}</strong><span>خصم / فصل / غش</span></div>
  </section>
  <table><thead><tr><th>#</th><th>الكود</th><th>الطالب</th><th>الدورة</th><th>الحالة</th><th>الدرجة</th><th>التصنيف</th>${extraHeaders}</tr></thead><tbody>${tableRows}</tbody></table>
  <div class="footer"><span>تم إنشاء التقرير آلياً</span><span>${new Date().toLocaleString("ar-IQ")}</span></div>
</main>
</body></html>`;
    const win = window.open("", "_blank");
    if (!win) {
      toast.error("المتصفح منع نافذة الطباعة");
      return;
    }
    win.document.write(html);
    win.document.close();
    toast.success("تم فتح تقرير PDF الاحترافي");
  };

  const openEditExamDialog = (examId: string) => {
    const exam = exams.find((item) => item.id === examId);
    if (!exam) return;
    setEditDialog({ open: true, id: examId, name: exam.name, passMark: String(exam.passMark), discountMark: String(exam.discountMark), fullMark: String(exam.fullMark) });
  };

  const handleEditExam = () => {
    if (!editDialog.name.trim()) return toast.error("اسم الامتحان مطلوب");
    updateExam(editDialog.id, {
      name: editDialog.name.trim(),
      fullMark: Number(editDialog.fullMark) || 100,
      passMark: Number(editDialog.passMark) || 60,
      discountMark: Number(editDialog.discountMark) || 0,
    });
    setEditDialog({ open: false, id: "", name: "", passMark: "", discountMark: "", fullMark: "" });
    toast.success("تم تعديل الامتحان وإعادة الاحتساب");
  };

  const openDeleteExamDialog = (examId: string) => {
    const exam = exams.find((item) => item.id === examId);
    setDeleteDialog({ open: true, id: examId, name: exam?.name || "" });
  };

  const handleDeleteExam = runDeleteExamLocked(async () => {
    const ok = deleteExam(deleteDialog.id);
    ok ? toast.success("تم حذف الامتحان") : toast.error("تعذر حذف الامتحان");
    setDeleteDialog({ open: false, id: "", name: "" });
  });

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="p-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <div className="space-y-1 lg:col-span-2">
              <Label htmlFor="exam-records-search" className="text-xs">بحث</Label>
              <Input id="exam-records-search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="اسم الامتحان / التاريخ / الدورة" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="exam-records-type" className="text-xs">نوع الامتحان</Label>
              <Select value={filterType || "all"} onValueChange={(v) => setFilterType(v === "all" ? "" : v)}>
                <SelectTrigger id="exam-records-type"><SelectValue placeholder="الكل" /></SelectTrigger>
                <SelectContent><SelectItem value="all">الكل</SelectItem><SelectItem value="يومي">يومي</SelectItem><SelectItem value="تراكمي">تراكمي</SelectItem><SelectItem value="فاينل">فاينل</SelectItem></SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="exam-records-course" className="text-xs">الدورة</Label>
              <Select value={filterCourseId || "all"} onValueChange={(v) => setFilterCourseId(v === "all" ? "" : v)}>
                <SelectTrigger id="exam-records-course"><SelectValue placeholder="الكل" /></SelectTrigger>
                <SelectContent><SelectItem value="all">الكل</SelectItem>{courses.map((course) => <SelectItem key={course.id} value={course.id}>{course.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <span className="text-xs font-medium">تخصيص التقرير</span>
              <Button variant="outline" size="sm" className="h-9 w-full" onClick={() => setCustomizeOpen(true)}>تخصيص PDF</Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {filteredExams.map((exam) => {
          const rows = examRows(exam.id);
          const passCount = rows.filter((row) => row.cls.kind === "pass").length;
          const notPassedCount = rows.filter((row) => row.cls.kind !== "pass" && row.cls.kind !== "leave").length;
          return (
            <Card key={exam.id} className="transition-all duration-200 hover:-translate-y-0.5 hover:shadow-xl hover:shadow-primary/10">
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <CardTitle className="text-base">{exam.name}</CardTitle>
                    <p className="mt-1 text-xs text-muted-foreground">{exam.date} - {exam.courseIds.map(courseName).join("، ")}</p>
                    <Badge variant="outline" className="mt-2">{getExamStatus(exam)}</Badge>
                  </div>
                  <div className="flex flex-wrap justify-end gap-1">
                    <Badge>{exam.type}</Badge>
                    <Button variant="ghost" size="sm" onClick={() => exportPDF(exam.id)}>PDF</Button>
                    <Button variant="ghost" size="sm" onClick={() => exportExcel(exam.id)}>Excel</Button>
                    <Button variant="ghost" size="sm" onClick={() => exportCSV(exam.id)}>CSV</Button>
                    <Button variant="secondary" size="sm" onClick={() => openEditExamDialog(exam.id)}>تعديل</Button>
                    <Button variant="destructive" size="sm" onClick={() => openDeleteExamDialog(exam.id)}>حذف</Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="mb-3 grid grid-cols-3 gap-2 text-center">
                  <div className="rounded bg-emerald-50 p-2 dark:bg-emerald-950/40"><p className="text-lg font-bold text-emerald-600 dark:text-emerald-400">{passCount}</p><p className="text-[10px] text-muted-foreground">ناجح</p></div>
                  <div className="rounded bg-rose-50 p-2 dark:bg-rose-950/40"><p className="text-lg font-bold text-rose-600 dark:text-rose-400">{notPassedCount}</p><p className="text-[10px] text-muted-foreground">غير ناجح/غائب</p></div>
                  <div className="rounded bg-sky-50 p-2 dark:bg-sky-950/40"><p className="text-lg font-bold text-sky-600 dark:text-sky-400">{rows.length}</p><p className="text-[10px] text-muted-foreground">إجمالي</p></div>
                </div>
                <div className="max-h-60 space-y-1 overflow-y-auto">
                  {rows.map((row) => (
                    <div key={row.grade.id} className="flex items-center justify-between rounded-xl bg-muted/60 p-2 text-sm">
                      <span className="truncate">{row.student?.name}</span>
                      <div className="flex items-center gap-2">{row.grade.score !== null && <span className="font-bold">{row.grade.score}</span>}<Badge variant={row.cls.type === "ok" ? "default" : row.cls.type === "danger" ? "destructive" : row.cls.type === "warn" ? "secondary" : "outline"} className="text-[10px]">{row.cls.text}</Badge></div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Dialog open={customizeOpen} onOpenChange={setCustomizeOpen}>
        <DialogContent dir="rtl">
          <DialogHeader><DialogTitle>تخصيص تقرير PDF</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>اتجاه الصفحة</Label>
              <Select value={reportOptions.orientation} onValueChange={(value) => setReportOptions((prev) => ({ ...prev, orientation: value as ReportOptions["orientation"] }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="portrait">A4 بالطول</SelectItem><SelectItem value="landscape">A4 بالعرض</SelectItem></SelectContent>
              </Select>
            </div>
            {[ ["showTelegram", "إظهار التليكرام"], ["showPhone", "إظهار الهاتف"], ["showNotes", "إظهار الملاحظات"] ].map(([key, label]) => (
              <label key={key} className="flex items-center gap-2 text-sm"><Checkbox checked={Boolean(reportOptions[key as keyof ReportOptions])} onCheckedChange={(value) => setReportOptions((prev) => ({ ...prev, [key]: Boolean(value) }))} />{label}</label>
            ))}
          </div>
          <DialogFooter><Button onClick={() => setCustomizeOpen(false)}>حفظ التخصيص</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={editDialog.open} onOpenChange={(open) => setEditDialog((prev) => ({ ...prev, open }))}>
        <DialogContent dir="rtl">
          <DialogHeader><DialogTitle>تعديل سريع للامتحان</DialogTitle></DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1 sm:col-span-2"><Label>اسم الامتحان</Label><Input value={editDialog.name} onChange={(e) => setEditDialog((prev) => ({ ...prev, name: e.target.value }))} /></div>
            <div className="space-y-1"><Label>الدرجة الكاملة</Label><Input type="number" value={editDialog.fullMark} onChange={(e) => setEditDialog((prev) => ({ ...prev, fullMark: e.target.value }))} /></div>
            <div className="space-y-1"><Label>درجة النجاح</Label><Input type="number" value={editDialog.passMark} onChange={(e) => setEditDialog((prev) => ({ ...prev, passMark: e.target.value }))} /></div>
            <div className="space-y-1"><Label>درجة الخصم</Label><Input type="number" value={editDialog.discountMark} onChange={(e) => setEditDialog((prev) => ({ ...prev, discountMark: e.target.value }))} /></div>
          </div>
          <DialogFooter><Button variant="ghost" onClick={() => setEditDialog({ open: false, id: "", name: "", passMark: "", discountMark: "", fullMark: "" })}>إلغاء</Button><Button onClick={handleEditExam}>حفظ</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleteDialog.open} onOpenChange={(open) => setDeleteDialog((prev) => ({ ...prev, open }))}>
        <AlertDialogContent dir="rtl">
          <AlertDialogHeader><AlertDialogTitle>تأكيد الحذف</AlertDialogTitle><AlertDialogDescription>هل أنت متأكد من حذف الامتحان &quot;{deleteDialog.name}&quot;؟ سيتم حذف الدرجات وأوراق التصحيح التابعة له.</AlertDialogDescription></AlertDialogHeader>
          <AlertDialogFooter><AlertDialogCancel>إلغاء</AlertDialogCancel><AlertDialogAction onClick={handleDeleteExam} disabled={isDeletingExam} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">{isDeletingExam ? "جاري الحذف..." : "حذف"}</AlertDialogAction></AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
