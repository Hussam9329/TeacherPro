"use client";

import React, { useMemo, useState } from "react";
import { useTeacherStore, type Student } from "@/lib/teacher-store";
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

function money(value: number) {
  return new Intl.NumberFormat("en-US").format(value || 0);
}

function amountValue(value: string): number {
  return Number(toLatinDigits(value).replace(/\D/g, "")) || 0;
}

export function AccountingView() {
  const { students, courses, updateStudent, courseName } = useTeacherStore();
  const [search, setSearch] = useState("");
  const [filterCourseId, setFilterCourseId] = useState("");
  const [filterPayment, setFilterPayment] = useState("");
  const [paymentDialog, setPaymentDialog] = useState<{ open: boolean; student: Student | null; amount: string; note: string; date: string }>({
    open: false,
    student: null,
    amount: "",
    note: "دفعة قسط",
    date: new Date().toISOString().slice(0, 10),
  });

  const privateStudents = useMemo(() => students.filter((student) => student.courseType === "خاصة"), [students]);

  const filtered = useMemo(() => {
    return privateStudents.filter((student) => {
      const remaining = Math.max((student.totalAmount || 0) - (student.paidAmount || 0), 0);
      if (search && !searchAny(search, [student.name, student.code, student.telegram, student.phone, student.parentPhone, student.receiptNo])) return false;
      if (filterCourseId && student.courseId !== filterCourseId) return false;
      if (filterPayment === "paid" && remaining > 0) return false;
      if (filterPayment === "remaining" && remaining === 0) return false;
      if (filterPayment === "overdue" && remaining === 0) return false;
      return true;
    });
  }, [privateStudents, search, filterCourseId, filterPayment]);

  const totals = useMemo(() => {
    return filtered.reduce(
      (acc, student) => {
        acc.total += student.totalAmount || 0;
        acc.paid += student.paidAmount || 0;
        acc.remaining += Math.max((student.totalAmount || 0) - (student.paidAmount || 0), 0);
        return acc;
      },
      { total: 0, paid: 0, remaining: 0 },
    );
  }, [filtered]);

  const exportCSV = () => {
    const headers = ["الكود", "الطالب", "الدورة", "الوصل", "الكلي", "المدفوع", "المتبقي", "الهاتف", "ولي الأمر", "الأقساط"];
    const rows = filtered.map((student) => [
      student.code,
      student.name,
      courseName(student.courseId),
      student.receiptNo || "",
      String(student.totalAmount || 0),
      String(student.paidAmount || 0),
      String(Math.max((student.totalAmount || 0) - (student.paidAmount || 0), 0)),
      student.phone,
      student.parentPhone,
      (student.installments || []).map((payment) => `${payment.date}: ${payment.amount} - ${payment.note}`).join(" | "),
    ]);
    const csv = "\ufeff" + [headers, ...rows].map((row) => row.map((value) => `"${String(value).replaceAll('"', '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `accounting-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("تم تصدير جدول الأقساط");
  };

  const openPaymentDialog = (student: Student) => {
    setPaymentDialog({ open: true, student, amount: "", note: "دفعة قسط", date: new Date().toISOString().slice(0, 10) });
  };

  const savePayment = () => {
    if (!paymentDialog.student) return;
    const amount = amountValue(paymentDialog.amount);
    if (amount <= 0) return toast.error("اكتب مبلغ الدفعة");
    const student = paymentDialog.student;
    const nextInstallments = [...(student.installments || []), { date: paymentDialog.date, amount, note: paymentDialog.note.trim() || "دفعة قسط" }];
    const nextPaid = nextInstallments.reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
    const result = updateStudent(student.id, { installments: nextInstallments, paidAmount: nextPaid });
    if (!result.ok) {
      toast.error(result.message);
      return;
    }
    setPaymentDialog({ open: false, student: null, amount: "", note: "دفعة قسط", date: new Date().toISOString().slice(0, 10) });
    toast.success("تم تسجيل دفعة القسط");
  };

  return (
    <div className="space-y-4">
      <div className="grid gap-3 md:grid-cols-3">
        <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">إجمالي المطلوب</p><p className="text-2xl font-black">{money(totals.total)} د.ع</p></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">إجمالي المدفوع</p><p className="text-2xl font-black text-emerald-600">{money(totals.paid)} د.ع</p></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">إجمالي المتبقي</p><p className="text-2xl font-black text-rose-600">{money(totals.remaining)} د.ع</p></CardContent></Card>
      </div>

      <Card>
        <CardHeader><CardTitle>الأقساط والمحاسبة للدورات الخاصة</CardTitle></CardHeader>
        <CardContent>
          <div className="grid gap-3 md:grid-cols-4">
            <div className="space-y-1">
              <Label className="text-xs">بحث</Label>
              <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="اسم / كود / وصل / هاتف" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">الدورة</Label>
              <Select value={filterCourseId || "all"} onValueChange={(value) => setFilterCourseId(value === "all" ? "" : value)}>
                <SelectTrigger><SelectValue placeholder="الكل" /></SelectTrigger>
                <SelectContent><SelectItem value="all">الكل</SelectItem>{courses.filter((course) => course.type === "خاصة").map((course) => <SelectItem key={course.id} value={course.id}>{course.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">حالة الدفع</Label>
              <Select value={filterPayment || "all"} onValueChange={(value) => setFilterPayment(value === "all" ? "" : value)}>
                <SelectTrigger><SelectValue placeholder="الكل" /></SelectTrigger>
                <SelectContent><SelectItem value="all">الكل</SelectItem><SelectItem value="paid">مسدد</SelectItem><SelectItem value="remaining">عليه متبقي</SelectItem><SelectItem value="overdue">متابعة محاسبة</SelectItem></SelectContent>
              </Select>
            </div>
            <div className="space-y-1"><span className="text-xs font-medium">تصدير</span><Button variant="outline" className="h-10 w-full" onClick={exportCSV}>تصدير CSV</Button></div>
          </div>
        </CardContent>
      </Card>

      <div className="overflow-hidden rounded-2xl border bg-card">
        <div className="grid grid-cols-[1.2fr_1fr_120px_120px_120px_120px] gap-2 border-b bg-muted/60 p-3 text-xs font-bold text-muted-foreground">
          <span>الطالب</span><span>الدورة / الوصل</span><span>الكلي</span><span>المدفوع</span><span>المتبقي</span><span>إجراء</span>
        </div>
        {filtered.length === 0 ? (
          <p className="empty-state m-4">لا توجد نتائج مطابقة.</p>
        ) : filtered.map((student) => {
          const remaining = Math.max((student.totalAmount || 0) - (student.paidAmount || 0), 0);
          return (
            <div key={student.id} className="grid grid-cols-1 gap-3 border-b p-3 text-sm md:grid-cols-[1.2fr_1fr_120px_120px_120px_120px] md:items-center">
              <div><p className="font-bold">{student.name}</p><p className="text-xs text-muted-foreground">{student.code} - {student.phone}</p></div>
              <div><p>{courseName(student.courseId)}</p><p className="text-xs text-muted-foreground">وصل: {student.receiptNo || "-"}</p></div>
              <span>{money(student.totalAmount)} د.ع</span>
              <span className="text-emerald-600">{money(student.paidAmount)} د.ع</span>
              <span className={remaining > 0 ? "font-bold text-rose-600" : "text-emerald-600"}>{money(remaining)} د.ع</span>
              <Button size="sm" onClick={() => openPaymentDialog(student)}>إضافة دفعة</Button>
              {student.installments?.length > 0 && (
                <div className="rounded-xl bg-muted/50 p-2 text-xs md:col-span-6">
                  <span className="font-bold">سجل الأقساط: </span>
                  {student.installments.map((payment, index) => <Badge key={`${payment.date}-${index}`} variant="outline" className="mx-1">{payment.date} - {money(payment.amount)} - {payment.note}</Badge>)}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <Dialog open={paymentDialog.open} onOpenChange={(open) => setPaymentDialog((prev) => ({ ...prev, open }))}>
        <DialogContent dir="rtl">
          <DialogHeader><DialogTitle>إضافة دفعة قسط - {paymentDialog.student?.name}</DialogTitle></DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1"><Label>تاريخ الدفعة</Label><Input type="date" value={paymentDialog.date} onChange={(e) => setPaymentDialog((prev) => ({ ...prev, date: e.target.value }))} /></div>
            <div className="space-y-1"><Label>المبلغ</Label><Input value={paymentDialog.amount} onChange={(e) => setPaymentDialog((prev) => ({ ...prev, amount: toLatinDigits(e.target.value) }))} placeholder="مثال: 25000" /></div>
            <div className="space-y-1 sm:col-span-2"><Label>ملاحظة</Label><Input value={paymentDialog.note} onChange={(e) => setPaymentDialog((prev) => ({ ...prev, note: e.target.value }))} /></div>
          </div>
          <DialogFooter><Button variant="ghost" onClick={() => setPaymentDialog((prev) => ({ ...prev, open: false }))}>إلغاء</Button><Button onClick={savePayment}>حفظ الدفعة</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
