"use client";

import React, { useState } from "react";
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
import { Separator } from "@/components/ui/separator";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
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
import { toLatinDigits } from "@/lib/format";
import { useActionLock } from "@/hooks/use-action-lock";

export function ChaptersView() {
  const {
    chapters,
    courseChapters,
    courses,
    addChapter,
    updateChapter,
    deleteChapter,
    attachChapter,
    toggleChapter,
    deleteCourseChapter,
    chapterName,
    courseName,
  } = useTeacherStore();
  const [chapterName_input, setChapterNameInput] = useState("");
  const [opportunities, setOpportunities] = useState(5);
  const [courseId, setCourseId] = useState("");
  const [chapterId, setChapterId] = useState("");
  const [showForceDialog, setShowForceDialog] = useState(false);
  const [pendingCCId, setPendingCCId] = useState("");
  const [editChapterDialog, setEditChapterDialog] = useState({
    open: false,
    id: "",
    chName: "",
    opps: 0,
  });
  const [deleteChapterDialog, setDeleteChapterDialog] = useState({
    open: false,
    id: "",
    chName: "",
  });
  const [deleteCCDialog, setDeleteCCDialog] = useState({ open: false, id: "" });
  const { locked: isAddingChapter, runLocked: runAddChapterLocked } =
    useActionLock();
  const { locked: isAttachingChapter, runLocked: runAttachChapterLocked } =
    useActionLock();
  const { locked: isSavingChapter, runLocked: runSaveChapterLocked } =
    useActionLock();
  const { locked: isDeletingChapter, runLocked: runDeleteChapterLocked } =
    useActionLock();
  const { locked: isDeletingLink, runLocked: runDeleteLinkLocked } =
    useActionLock();

  const openEditChapterDialog = (id: string) => {
    const chapter = chapters.find((ch) => ch.id === id);
    if (!chapter) return;
    setEditChapterDialog({
      open: true,
      id,
      chName: chapter.name,
      opps: chapter.opportunities,
    });
  };
  const handleEditChapterSave = runSaveChapterLocked(async () => {
    if (!editChapterDialog.chName.trim()) {
      toast.error("يرجى إدخال اسم الفصل");
      return;
    }
    updateChapter(editChapterDialog.id, {
      name: editChapterDialog.chName.trim(),
      opportunities: Math.max(0, editChapterDialog.opps),
    });
    setEditChapterDialog({ open: false, id: "", chName: "", opps: 0 });
    toast.success("تم تعديل الفصل");
  });

  const openDeleteChapterDialog = (id: string, chName: string) => {
    setDeleteChapterDialog({ open: true, id, chName });
  };
  const handleDeleteChapterConfirm = runDeleteChapterLocked(async () => {
    const ok = deleteChapter(deleteChapterDialog.id);
    ok
      ? toast.success("تم حذف الفصل")
      : toast.error("لا يمكن حذف فصل فعال حالياً");
    setDeleteChapterDialog({ open: false, id: "", chName: "" });
  });

  const openDeleteCCDialog = (id: string) => {
    setDeleteCCDialog({ open: true, id });
  };
  const handleDeleteCCConfirm = runDeleteLinkLocked(async () => {
    const ok = deleteCourseChapter(deleteCCDialog.id);
    ok
      ? toast.success("تم حذف الربط")
      : toast.error("لا يمكن حذف ربط مفعل، قم بإلغاء التفعيل أولاً");
    setDeleteCCDialog({ open: false, id: "" });
  });

  const handleAddChapter = runAddChapterLocked(
    async (e: React.FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      if (!chapterName_input.trim()) {
        toast.error("يرجى إدخال اسم الفصل");
        return;
      }
      addChapter(chapterName_input.trim(), opportunities);
      setChapterNameInput("");
      setOpportunities(5);
      toast.success("تمت إضافة الفصل");
    },
  );

  const handleAttachChapter = runAttachChapterLocked(
    async (e: React.FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      if (!courseId || !chapterId) {
        toast.error("يرجى اختيار الدورة والفصل");
        return;
      }
      const exists = courseChapters.some(
        (cc) =>
          cc.courseId === courseId &&
          cc.chapterId === chapterId &&
          !cc.archived,
      );
      if (exists) {
        toast.error("الفصل مرتبط مسبقاً بهذه الدورة");
        return;
      }
      attachChapter(courseId, chapterId);
      toast.success("تم ربط الفصل بالدورة");
    },
  );

  const handleToggleChapter = (ccId: string) => {
    const cc = courseChapters.find((x) => x.id === ccId);
    if (!cc) return;

    if (!cc.active) {
      // Check if students have non-zero opportunities
      const students = useTeacherStore
        .getState()
        .students.filter((s) => s.courseId === cc.courseId);
      const notZero = students.filter((s) => s.opportunities !== 0);
      if (notZero.length > 0) {
        setPendingCCId(ccId);
        setShowForceDialog(true);
        return;
      }
    }

    toggleChapter(ccId, false);
    toast.success(
      cc.active ? "تم إلغاء تفعيل الفصل" : "تم تفعيل الفصل وتوزيع الفرص",
    );
  };

  const handleForceActivate = () => {
    toggleChapter(pendingCCId, true);
    setShowForceDialog(false);
    toast.success("تم تفعيل الفصل وأرشفة الفرص السابقة");
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>الفصول والفرص</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            إضافة الفصول للدورات وتفعيل فصل واحد فقط لكل دورة.
          </p>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        {/* Add Chapter + Attach */}
        <Card>
          <CardHeader>
            <CardTitle>إضافة الفصول للدورات</CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Add Chapter Form */}
            <form onSubmit={handleAddChapter} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="chapter-name">اسم الفصل المنهجي</Label>
                <Input
                  id="chapter-name"
                  name="chapterName"
                  autoComplete="off"
                  value={chapterName_input}
                  onChange={(e) => setChapterNameInput(e.target.value)}
                  required
                  placeholder="الفصل الأول - الخلية"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="chapter-opportunities">
                  عدد الفرص لهذا الفصل
                </Label>
                <Input
                  id="chapter-opportunities"
                  name="opportunities"
                  type="number"
                  min={0}
                  autoComplete="off"
                  value={opportunities}
                  onChange={(e) =>
                    setOpportunities(Number(toLatinDigits(e.target.value)) || 0)
                  }
                />
              </div>
              <Button
                type="submit"
                disabled={isAddingChapter}
                className="w-full"
              >
                {isAddingChapter ? "جاري الإضافة..." : "إضافة فصل منهجي"}
              </Button>
              <div className="rounded-2xl border bg-muted/30 p-3 space-y-2">
                <p className="text-xs font-semibold">مكتبة الفصول</p>
                {chapters.map((ch) => (
                  <div
                    key={ch.id}
                    className="flex items-center justify-between gap-2 text-xs"
                  >
                    <span className="truncate">
                      {ch.name} - {ch.opportunities} فرص
                    </span>
                    <div className="flex gap-1">
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        className="h-7 text-[11px]"
                        onClick={() => openEditChapterDialog(ch.id)}
                      >
                        تعديل
                      </Button>
                      <Button
                        type="button"
                        variant="destructive"
                        size="sm"
                        className="h-7 text-[11px]"
                        onClick={() => openDeleteChapterDialog(ch.id, ch.name)}
                      >
                        حذف
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </form>

            <Separator />

            {/* Attach Chapter Form */}
            <form onSubmit={handleAttachChapter} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="chapter-course">اختر الدورة</Label>
                <Select name="courseId" value={courseId} onValueChange={setCourseId}>
                  <SelectTrigger id="chapter-course">
                    <SelectValue placeholder="اختر الدورة" />
                  </SelectTrigger>
                  <SelectContent>
                    {courses.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="chapter-id">اختر الفصل المنهجي لإضافته</Label>
                <Select name="chapterId" value={chapterId} onValueChange={setChapterId}>
                  <SelectTrigger id="chapter-id">
                    <SelectValue placeholder="اختر الفصل" />
                  </SelectTrigger>
                  <SelectContent>
                    {chapters.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name} - {c.opportunities} فرص
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Button
                type="submit"
                variant="secondary"
                disabled={isAttachingChapter}
                className="w-full"
              >
                {isAttachingChapter ? "جاري الربط..." : "إضافة الفصل للدورة"}
              </Button>
            </form>
          </CardContent>
        </Card>

        {/* Linked Chapters */}
        <Card>
          <CardHeader>
            <CardTitle>الفصول المنهجية المرتبطة بالدورات</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4 max-h-[600px] overflow-y-auto">
              {courses.map((course) => {
                const linked = courseChapters.filter(
                  (cc) => cc.courseId === course.id && !cc.archived,
                );
                return (
                  <div
                    key={course.id}
                    className="p-4 rounded-2xl border bg-card/80 shadow-sm"
                  >
                    <div className="flex items-center justify-between mb-3">
                      <p className="font-bold">{course.name}</p>
                      <Badge variant="secondary">
                        {course.availablePrograms?.join('، ') || '—'}
                      </Badge>
                    </div>
                    {linked.length === 0 ? (
                      <p className="text-sm text-muted-foreground py-2">
                        لا توجد فصول مرتبطة
                      </p>
                    ) : (
                      <div className="space-y-2">
                        {linked.map((cc) => (
                          <div
                            key={cc.id}
                            className="flex items-center justify-between p-2 rounded-xl bg-muted/60"
                          >
                            <div className="flex items-center gap-2">
                              <span className="text-sm">
                                {chapterName(cc.chapterId)}
                              </span>
                              <Badge
                                variant={cc.active ? "default" : "secondary"}
                                className="text-[10px]"
                              >
                                {cc.active ? "مفعل" : "معطل"}
                              </Badge>
                            </div>
                            <div className="flex gap-2">
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => handleToggleChapter(cc.id)}
                              >
                                {cc.active ? "إلغاء التفعيل" : "تفعيل"}
                              </Button>
                              <Button
                                variant="destructive"
                                size="sm"
                                onClick={() => openDeleteCCDialog(cc.id)}
                              >
                                حذف الربط
                              </Button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Edit Chapter Dialog */}
      <Dialog
        open={editChapterDialog.open}
        onOpenChange={(o) =>
          setEditChapterDialog((prev) => ({ ...prev, open: o }))
        }
      >
        <DialogContent dir="rtl">
          <DialogHeader>
            <DialogTitle>تعديل الفصل</DialogTitle>
            <DialogDescription>أدخل البيانات الجديدة للفصل</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="chapter-edit-name">اسم الفصل</Label>
              <Input
                id="chapter-edit-name"
                name="chName"
                autoComplete="off"
                value={editChapterDialog.chName}
                onChange={(e) =>
                  setEditChapterDialog((prev) => ({
                    ...prev,
                    chName: e.target.value,
                  }))
                }
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="chapter-edit-opps">عدد الفرص</Label>
              <Input
                id="chapter-edit-opps"
                name="opps"
                type="number"
                min={0}
                autoComplete="off"
                value={editChapterDialog.opps}
                onChange={(e) =>
                  setEditChapterDialog((prev) => ({
                    ...prev,
                    opps: Number(toLatinDigits(e.target.value)) || 0,
                  }))
                }
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() =>
                setEditChapterDialog((prev) => ({ ...prev, open: false }))
              }
            >
              إلغاء
            </Button>
            <Button onClick={handleEditChapterSave} disabled={isSavingChapter}>
              {isSavingChapter ? "جاري الحفظ..." : "حفظ"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Chapter AlertDialog */}
      <AlertDialog
        open={deleteChapterDialog.open}
        onOpenChange={(o) =>
          setDeleteChapterDialog((prev) => ({ ...prev, open: o }))
        }
      >
        <AlertDialogContent dir="rtl">
          <AlertDialogHeader>
            <AlertDialogTitle>تأكيد الحذف</AlertDialogTitle>
            <AlertDialogDescription>
              هل تريد حذف الفصل &quot;{deleteChapterDialog.chName}&quot; من
              المكتبة؟ لا يمكن حذف فصل فعال حالياً.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>إلغاء</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteChapterConfirm}
              disabled={isDeletingChapter}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isDeletingChapter ? "جاري الحذف..." : "حذف"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete Course Chapter AlertDialog */}
      <AlertDialog
        open={deleteCCDialog.open}
        onOpenChange={(o) =>
          setDeleteCCDialog((prev) => ({ ...prev, open: o }))
        }
      >
        <AlertDialogContent dir="rtl">
          <AlertDialogHeader>
            <AlertDialogTitle>تأكيد حذف الربط</AlertDialogTitle>
            <AlertDialogDescription>
              هل تريد حذف ربط الفصل بهذه الدورة؟ لا يمكن حذف ربط مفعل.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>إلغاء</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteCCConfirm}
              disabled={isDeletingLink}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isDeletingLink ? "جاري الحذف..." : "حذف الربط"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Force Activate Dialog */}
      <Dialog open={showForceDialog} onOpenChange={setShowForceDialog}>
        <DialogContent dir="rtl">
          <DialogHeader>
            <DialogTitle>تنبيه قبل التفعيل</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            حسب التعليمات يجب أن تكون فرص جميع طلاب الدورة صفر قبل تفعيل الفصل.
            النظام سيؤرشف الفرص الحالية ثم يضبط فرص الفصل الجديد.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowForceDialog(false)}>
              إلغاء
            </Button>
            <Button onClick={handleForceActivate}>أرشفة وتفعيل</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
