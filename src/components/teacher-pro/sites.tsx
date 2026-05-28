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
import { MAIN_SITE_OPTIONS } from "@/lib/iraq";
import { useActionLock } from "@/hooks/use-action-lock";

export function SitesView() {
  const {
    sites,
    courses,
    addSite,
    updateSite,
    toggleSite,
    deleteSite,
    courseName,
  } = useTeacherStore();
  const [courseId, setCourseId] = useState("");
  const [main, setMain] = useState("بغداد");
  const [sub, setSub] = useState("");
  const [editDialog, setEditDialog] = useState({
    open: false,
    id: "",
    mainSite: "",
    subSite: "",
  });
  const [deleteDialog, setDeleteDialog] = useState({
    open: false,
    id: "",
    siteName: "",
  });
  const { locked: isAddingSite, runLocked: runAddSiteLocked } = useActionLock();
  const { locked: isSavingSite, runLocked: runSaveSiteLocked } =
    useActionLock();
  const { locked: isDeletingSite, runLocked: runDeleteSiteLocked } =
    useActionLock();

  const openEditDialog = (id: string, oldMain: string, oldSub: string) => {
    setEditDialog({ open: true, id, mainSite: oldMain, subSite: oldSub });
  };
  const handleEditSave = runSaveSiteLocked(async () => {
    if (!editDialog.mainSite.trim()) {
      toast.error("يرجى إدخال الموقع الرئيسي");
      return;
    }
    if (!editDialog.subSite.trim()) {
      toast.error("يرجى إدخال الموقع الفرعي");
      return;
    }
    updateSite(editDialog.id, {
      main: editDialog.mainSite.trim(),
      sub: editDialog.subSite.trim(),
    });
    setEditDialog({ open: false, id: "", mainSite: "", subSite: "" });
    toast.success("تم تعديل الموقع");
  });

  const openDeleteDialog = (id: string, siteName: string) => {
    setDeleteDialog({ open: true, id, siteName });
  };
  const handleDeleteConfirm = runDeleteSiteLocked(async () => {
    const ok = deleteSite(deleteDialog.id);
    ok ? toast.success("تم حذف الموقع") : toast.error("تعذر حذف الموقع");
    setDeleteDialog({ open: false, id: "", siteName: "" });
  });

  const handleSubmit = runAddSiteLocked(
    async (e: React.FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      if (!courseId) {
        toast.error("يرجى اختيار الدورة");
        return;
      }
      if (!sub.trim()) {
        toast.error("يرجى إدخال الموقع الفرعي");
        return;
      }
      addSite(courseId, main, sub.trim());
      setSub("");
      toast.success("تم حفظ الموقع");
    },
  );

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>إدارة مواقع الطلاب</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            الموقع الرئيسي ثابت من قائمة المحافظات العراقية الـ18 مع خيار
            أونلاين، والمستخدم يضيف المناطق الفرعية فقط لكل موقع رئيسي.
          </p>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        {/* Add Site Form */}
        <Card>
          <CardHeader>
            <CardTitle>إضافة موقع</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="site-course">الدورة</Label>
                <Select value={courseId} onValueChange={setCourseId}>
                  <SelectTrigger id="site-course">
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
                <Label htmlFor="site-mainSite">الموقع الرئيسي</Label>
                <Select value={main} onValueChange={setMain}>
                  <SelectTrigger id="site-mainSite">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {MAIN_SITE_OPTIONS.map((site) => (
                      <SelectItem key={site} value={site}>
                        {site}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="site-subSite">الموقع الفرعي</Label>
                <Input
                  id="site-subSite"
                  name="sub"
                  autoComplete="off"
                  value={sub}
                  onChange={(e) => setSub(e.target.value)}
                  placeholder="المنصور / زيونة / بنوك"
                />
              </div>
              <Button type="submit" disabled={isAddingSite} className="w-full">
                {isAddingSite ? "جاري الحفظ..." : "حفظ الموقع"}
              </Button>
            </form>
          </CardContent>
        </Card>

        {/* Sites List */}
        <Card>
          <CardHeader>
            <CardTitle>هيكل المواقع</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3 max-h-[500px] overflow-y-auto">
              {sites.length === 0 ? (
                <p className="empty-state">لا توجد مواقع بعد</p>
              ) : (
                sites.map((site) => (
                  <div
                    key={site.id}
                    className="p-4 rounded-2xl border bg-card/80 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-lg"
                  >
                    <div className="flex items-center justify-between mb-2">
                      <p className="font-bold">
                        {site.main} - {site.sub}
                      </p>
                      <Badge variant={site.active ? "default" : "secondary"}>
                        {site.active ? "فعال" : "معطل"}
                      </Badge>
                    </div>
                    <p className="text-sm text-muted-foreground mb-3">
                      {courseName(site.courseId)}
                    </p>
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        className="flex-1"
                        onClick={() => {
                          toggleSite(site.id);
                          toast.success(
                            site.active ? "تم تعطيل الموقع" : "تم تفعيل الموقع",
                          );
                        }}
                      >
                        {site.active ? "تعطيل" : "تفعيل"}
                      </Button>
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() =>
                          openEditDialog(site.id, site.main, site.sub)
                        }
                      >
                        تعديل
                      </Button>
                      <Button
                        variant="destructive"
                        size="sm"
                        onClick={() =>
                          openDeleteDialog(
                            site.id,
                            `${site.main} - ${site.sub}`,
                          )
                        }
                      >
                        حذف
                      </Button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </CardContent>
        </Card>
      </div>
      {/* Edit Site Dialog */}
      <Dialog
        open={editDialog.open}
        onOpenChange={(o) => setEditDialog((prev) => ({ ...prev, open: o }))}
      >
        <DialogContent dir="rtl">
          <DialogHeader>
            <DialogTitle>تعديل الموقع</DialogTitle>
            <DialogDescription>أدخل البيانات الجديدة للموقع</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="edit-site-mainSite">الموقع الرئيسي</Label>
              <Select
                value={editDialog.mainSite}
                onValueChange={(value) =>
                  setEditDialog((prev) => ({ ...prev, mainSite: value }))
                }
              >
                <SelectTrigger id="edit-site-mainSite">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MAIN_SITE_OPTIONS.map((site) => (
                    <SelectItem key={site} value={site}>
                      {site}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-site-subSite">الموقع الفرعي</Label>
              <Input
                id="edit-site-subSite"
                name="subSite"
                autoComplete="off"
                value={editDialog.subSite}
                onChange={(e) =>
                  setEditDialog((prev) => ({
                    ...prev,
                    subSite: e.target.value,
                  }))
                }
                placeholder="المنصور / زيونة / بنوك"
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() =>
                setEditDialog((prev) => ({ ...prev, open: false }))
              }
            >
              إلغاء
            </Button>
            <Button onClick={handleEditSave} disabled={isSavingSite}>
              {isSavingSite ? "جاري الحفظ..." : "حفظ"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Site AlertDialog */}
      <AlertDialog
        open={deleteDialog.open}
        onOpenChange={(o) => setDeleteDialog((prev) => ({ ...prev, open: o }))}
      >
        <AlertDialogContent dir="rtl">
          <AlertDialogHeader>
            <AlertDialogTitle>تأكيد الحذف</AlertDialogTitle>
            <AlertDialogDescription>
              هل تريد حذف الموقع &quot;{deleteDialog.siteName}&quot;؟
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>إلغاء</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteConfirm}
              disabled={isDeletingSite}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isDeletingSite ? "جاري الحذف..." : "حذف"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
