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
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { toLatinDigits } from "@/lib/format";
import { searchAny } from "@/lib/validation";
import { useActionLock } from "@/hooks/use-action-lock";

export function OpportunitiesView() {
  const {
    students,
    courses,
    opportunityLogs,
    adjustOpportunities,
    resetOpportunities,
    undoOpportunityLog,
    courseName,
    activeChapterForCourse,
  } = useTeacherStore();

  const [filterCourseId, setFilterCourseId] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize] = useState(10);

  // Action dialog
  const [actionDialog, setActionDialog] = useState<{
    studentId: string;
    type: "add" | "deduct" | "reset";
    open: boolean;
  }>({ studentId: "", type: "add", open: false });
  const [amount, setAmount] = useState(1);
  const [reason, setReason] = useState("");
  const { locked: isApplyingAction, runLocked: runActionLocked } =
    useActionLock();

  const filtered = useMemo(() => {
    return students.filter((s) => {
      if (filterCourseId && s.courseId !== filterCourseId) return false;
      if (search && !searchAny(search, [s.name, s.code])) return false;
      return true;
    });
  }, [students, filterCourseId, search]);

  const totalPages = Math.ceil(filtered.length / pageSize);
  const paged = filtered.slice((page - 1) * pageSize, page * pageSize);

  const handleAction = runActionLocked(async () => {
    const selectedStudent = students.find((student) => student.id === actionDialog.studentId);
    if (!selectedStudent || !activeChapterForCourse(selectedStudent.courseId)) {
      toast.error("لا يمكن تعديل فرص طالب قبل اختيار فصل نشط لدورته");
      return;
    }
    if (actionDialog.type === "reset") {
      resetOpportunities(actionDialog.studentId);
      toast.success("تم إعادة تعيين الفرص");
    } else {
      if (!reason.trim()) {
        toast.error("يرجى إدخال السبب");
        return;
      }
      const amt = actionDialog.type === "deduct" ? -amount : amount;
      adjustOpportunities(actionDialog.studentId, amt, reason.trim());
      toast.success(
        actionDialog.type === "deduct" ? "تم خصم الفرص" : "تم إضافة الفرص",
      );
    }
    setActionDialog({ studentId: "", type: "add", open: false });
    setReason("");
    setAmount(1);
  });

  const exportCSV = () => {
    const headers = [
      "الطالب",
      "الكود",
      "الدورة",
      "الفرص الحالية",
      "الفرص الأساسية",
    ];
    const rows = filtered.map((s) =>
      [
        s.name,
        s.code,
        courseName(s.courseId),
        s.opportunities.toString(),
        s.baseOpportunities.toString(),
      ]
        .map((v) => `"${v}"`)
        .join(","),
    );
    const csv = "\ufeff" + [headers.join(","), ...rows].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `opportunities-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("تم التصدير");
  };

  return (
    <div className="space-y-4">
      {/* Filters */}
      <Card>
        <CardContent className="p-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="space-y-1">
              <Label htmlFor="opp-search" className="text-xs">
                بحث
              </Label>
              <Input
                id="opp-search"
                name="search"
                autoComplete="off"
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPage(1);
                }}
                placeholder="اسم / كود"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="opp-course" className="text-xs">
                الدورة
              </Label>
              <Select
                name="courseId"
                value={filterCourseId}
                onValueChange={(v) => {
                  setFilterCourseId(v === "all" ? "" : v);
                  setPage(1);
                }}
              >
                <SelectTrigger id="opp-course">
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

      {/* Opportunity Overview */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">
              {
                filtered.filter(
                  (s) => s.opportunities > 0 && s.status === "نشط",
                ).length
              }
            </p>
            <p className="text-xs text-muted-foreground">طلاب لديهم فرص</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold text-amber-600 dark:text-amber-400">
              {
                filtered.filter(
                  (s) => s.opportunities === 0 && s.status === "نشط",
                ).length
              }
            </p>
            <p className="text-xs text-muted-foreground">طلاب بدون فرص</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold text-rose-600 dark:text-rose-400">
              {filtered.filter((s) => s.status === "مفصول").length}
            </p>
            <p className="text-xs text-muted-foreground">مفصولون</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold">{filtered.length}</p>
            <p className="text-xs text-muted-foreground">إجمالي</p>
          </CardContent>
        </Card>
      </div>

      {/* Student Opportunities */}
      <Card>
        <CardHeader>
          <CardTitle>فرص الطلاب</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {paged.map((student) => {
              const activeChapter = activeChapterForCourse(student.courseId);
              const hasChapter = Boolean(activeChapter);
              const oppPercent =
                hasChapter && student.baseOpportunities > 0
                  ? (student.opportunities / student.baseOpportunities) * 100
                  : 0;
              return (
                <div
                  key={student.id}
                  className="flex items-center gap-3 p-3 rounded-2xl border bg-card/80 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-lg"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="font-medium text-sm truncate">
                        {student.name}
                      </p>
                      <Badge variant="outline" className="text-[10px]">
                        {student.code}
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {courseName(student.courseId)}
                    </p>
                    {!hasChapter && (
                      <p className="mt-1 text-xs font-semibold text-destructive">
                        لم يتم اختيار الفصل لهم بعد؛ كل الإجراءات مقفلة.
                      </p>
                    )}
                  </div>

                  {/* Opportunity Progress */}
                  <div className="flex items-center gap-3">
                    <div className="w-24">
                      <div className="h-2 rounded-full bg-muted overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all ${
                            oppPercent > 50
                              ? "bg-emerald-500"
                              : oppPercent > 0
                                ? "bg-amber-500"
                                : "bg-rose-500"
                          }`}
                          style={{ width: `${oppPercent}%` }}
                        />
                      </div>
                    </div>
                    <span
                      className={`font-bold text-sm ${
                        student.opportunities === 0
                          ? "text-rose-600"
                          : student.opportunities <= 2
                            ? "text-amber-600"
                            : "text-emerald-600"
                      }`}
                    >
                      {hasChapter ? `${student.opportunities}/${student.baseOpportunities}` : "0/0"}
                    </span>
                  </div>

                  {/* Actions */}
                  <div className="flex gap-1">
                    <Button
                      variant="outline"
                      size="sm"
                      className="text-xs text-emerald-600"
                      disabled={!hasChapter}
                      onClick={() =>
                        setActionDialog({
                          studentId: student.id,
                          type: "add",
                          open: true,
                        })
                      }
                    >
                      إضافة
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="text-xs text-rose-600"
                      disabled={!hasChapter}
                      onClick={() =>
                        setActionDialog({
                          studentId: student.id,
                          type: "deduct",
                          open: true,
                        })
                      }
                    >
                      خصم
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-xs"
                      disabled={!hasChapter}
                      onClick={() =>
                        setActionDialog({
                          studentId: student.id,
                          type: "reset",
                          open: true,
                        })
                      }
                    >
                      إعادة تعيين
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

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

      {/* Recent Opportunity Logs */}
      <Card>
        <CardHeader>
          <CardTitle>سجل حركات الفرص</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2 max-h-80 overflow-y-auto">
            {opportunityLogs.length === 0 ? (
              <p className="empty-state py-6">لا توجد حركات</p>
            ) : (
              opportunityLogs.slice(0, 20).map((log) => {
                const student = students.find((s) => s.id === log.studentId);
                const canUndo = Boolean(student && activeChapterForCourse(student.courseId) && (log.action === "إضافة" || log.action === "خصم"));
                return (
                  <div
                    key={log.id}
                    className="flex items-center justify-between text-sm p-2 rounded-xl bg-muted/60"
                  >
                    <div>
                      <span className="font-medium">
                        {student?.name || "غير محدد"}
                      </span>
                      <span className="text-muted-foreground mx-2">•</span>
                      <span className="text-muted-foreground">{log.date}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge
                        variant={
                          log.action === "خصم"
                            ? "destructive"
                            : log.action === "إضافة"
                              ? "default"
                              : "secondary"
                        }
                      >
                        {log.action} {log.amount}
                      </Badge>
                      <span className="text-muted-foreground text-xs">
                        {log.reason}
                      </span>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 text-xs"
                        disabled={!canUndo}
                        onClick={() => {
                          const ok = undoOpportunityLog(log.id);
                          ok ? toast.success("تم التراجع عن الحركة") : toast.error("لا يمكن التراجع عن هذه الحركة");
                        }}
                      >
                        تراجع
                      </Button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </CardContent>
      </Card>

      {/* Action Dialog */}
      <Dialog
        open={actionDialog.open}
        onOpenChange={(o) => setActionDialog({ ...actionDialog, open: o })}
      >
        <DialogContent dir="rtl">
          <DialogHeader>
            <DialogTitle>
              {actionDialog.type === "add"
                ? "إضافة فرص"
                : actionDialog.type === "deduct"
                  ? "خصم فرص"
                  : "إعادة تعيين الفرص"}
              {" - "}
              {students.find((s) => s.id === actionDialog.studentId)?.name}
            </DialogTitle>
          </DialogHeader>
          {actionDialog.type !== "reset" ? (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="opp-amount">العدد</Label>
                <Input
                  id="opp-amount"
                  name="amount"
                  type="number"
                  min={1}
                  autoComplete="off"
                  value={amount}
                  onChange={(e) =>
                    setAmount(Number(toLatinDigits(e.target.value)) || 1)
                  }
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="opp-reason">السبب</Label>
                <Input
                  id="opp-reason"
                  name="reason"
                  autoComplete="off"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="سبب الحركة"
                />
              </div>
            </div>
          ) : (
            <>
              <p className="text-sm text-muted-foreground">
                سيتم إعادة تعيين فرص الطالب إلى العدد الأساسي (
                {students.find((s) => s.id === actionDialog.studentId)
                  ?.baseOpportunities || 0}
                )
              </p>
            </>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setActionDialog({ ...actionDialog, open: false })}
            >
              إلغاء
            </Button>
            <Button onClick={handleAction} disabled={isApplyingAction}>
              {actionDialog.type === "add"
                ? "إضافة"
                : actionDialog.type === "deduct"
                  ? "خصم"
                  : "إعادة تعيين"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
