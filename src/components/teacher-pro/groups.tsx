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
import { useActionLock } from "@/hooks/use-action-lock";
import { Users } from "lucide-react";
import { EmptyState } from "./ui-kit";

export function GroupsView() {
  const {
    groups,
    courses,
    addGroup,
    updateGroup,
    toggleGroup,
    deleteGroup,
    courseName,
  } = useTeacherStore();
  const [name, setName] = useState("");
  const [courseId, setCourseId] = useState("");
  const [electronicGroup, setElectronicGroup] = useState("");
  const [editDialog, setEditDialog] = useState({
    open: false,
    id: "",
    groupName: "",
    electronic: "",
  });
  const [deleteDialog, setDeleteDialog] = useState({
    open: false,
    id: "",
    groupName: "",
  });
  const { locked: isAddingGroup, runLocked: runAddGroupLocked } =
    useActionLock();
  const { locked: isSavingGroup, runLocked: runSaveGroupLocked } =
    useActionLock();
  const { locked: isDeletingGroup, runLocked: runDeleteGroupLocked } =
    useActionLock();

  const openEditDialog = (
    id: string,
    oldName: string,
    oldElectronic: string,
  ) => {
    setEditDialog({
      open: true,
      id,
      groupName: oldName,
      electronic: oldElectronic,
    });
  };
  const handleEditSave = runSaveGroupLocked(async () => {
    if (!editDialog.groupName.trim()) {
      toast.error("يرجى إدخال اسم المجموعة الإلكترونية");
      return;
    }
    updateGroup(editDialog.id, {
      name: editDialog.groupName.trim(),
      electronicGroup: editDialog.electronic.trim(),
    });
    setEditDialog({ open: false, id: "", groupName: "", electronic: "" });
    toast.success("تم تعديل المجموعة الإلكترونية");
  });

  const openDeleteDialog = (id: string, groupName: string) => {
    setDeleteDialog({ open: true, id, groupName });
  };
  const handleDeleteConfirm = runDeleteGroupLocked(async () => {
    const ok = deleteGroup(deleteDialog.id);
    ok
      ? toast.success("تم حذف المجموعة الإلكترونية")
      : toast.error("لا يمكن حذف المجموعة الإلكترونية لأنها مرتبطة ببيانات أخرى");
    setDeleteDialog({ open: false, id: "", groupName: "" });
  });

  const handleSubmit = runAddGroupLocked(
    async (e: React.FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      if (!name.trim()) {
        toast.error("يرجى إدخال اسم المجموعة الإلكترونية");
        return;
      }
      if (!courseId) {
        toast.error("يرجى اختيار الدورة");
        return;
      }
      addGroup(name.trim(), courseId, electronicGroup.trim());
      setName("");
      setElectronicGroup("");
      toast.success("تمت إضافة المجموعة الإلكترونية");
    },
  );

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>إضافة مجموعة إلكترونية جديدة</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground mb-4">
            إدارة المجموعات الإلكترونية المرتبطة بالدورات
          </p>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        {/* Add Group Form */}
        <Card>
          <CardHeader>
            <CardTitle>إضافة مجموعة إلكترونية جديدة</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="group-name">اسم المجموعة الإلكترونية</Label>
                <Input
                  id="group-name"
                  name="name"
                  autoComplete="off"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                  placeholder="اسم المجموعة الإلكترونية"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="group-course">الدورة</Label>
                <Select value={courseId} onValueChange={setCourseId}>
                  <SelectTrigger id="group-course">
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
                <Label htmlFor="group-electronic">رابط المجموعة</Label>
                <Input
                  id="group-electronic"
                  name="electronicGroup"
                  autoComplete="off"
                  value={electronicGroup}
                  onChange={(e) => setElectronicGroup(e.target.value)}
                  placeholder="@group"
                />
              </div>
              <Button type="submit" disabled={isAddingGroup} className="w-full">
                {isAddingGroup ? "جاري الحفظ..." : "حفظ المجموعة الإلكترونية"}
              </Button>
            </form>
          </CardContent>
        </Card>

        {/* Groups List */}
        <Card>
          <CardHeader>
            <CardTitle>المجموعات الإلكترونية المرتبطة بالدورات</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3 max-h-[500px] overflow-y-auto">
              {groups.length === 0 ? (
                <EmptyState icon={Users} title="لا توجد مجموعات إلكترونية بعد" description="أنشئ أول مجموعة إلكترونية واربطها بالدورة المناسبة ليتمكن الطلاب من التسجيل عليها." />
              ) : (
                groups.map((group) => (
                  <div
                    key={group.id}
                    className="p-4 rounded-2xl border bg-card/80 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-lg"
                  >
                    <div className="flex items-center justify-between mb-3">
                      <p className="font-bold">{group.name}</p>
                      <Badge variant={group.active ? "default" : "secondary"}>
                        {group.active ? "فعال" : "معطل"}
                      </Badge>
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-sm">
                      <div>
                        <span className="text-muted-foreground text-xs">
                          الدورة
                        </span>
                        <p className="font-medium">
                          {courseName(group.courseId)}
                        </p>
                      </div>
                      <div>
                        <span className="text-muted-foreground text-xs">
                          رابط المجموعة
                        </span>
                        <p className="font-medium">{group.electronicGroup}</p>
                      </div>
                    </div>
                    <div className="flex gap-2 mt-3">
                      <Button
                        variant="outline"
                        size="sm"
                        className="flex-1"
                        onClick={() => {
                          toggleGroup(group.id);
                          toast.success(
                            group.active
                              ? "تم تعطيل المجموعة الإلكترونية"
                              : "تم تفعيل المجموعة الإلكترونية",
                          );
                        }}
                      >
                        {group.active ? "تعطيل" : "تفعيل"}
                      </Button>
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() =>
                          openEditDialog(
                            group.id,
                            group.name,
                            group.electronicGroup,
                          )
                        }
                      >
                        تعديل
                      </Button>
                      <Button
                        variant="destructive"
                        size="sm"
                        onClick={() => openDeleteDialog(group.id, group.name)}
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
      {/* Edit Group Dialog */}
      <Dialog
        open={editDialog.open}
        onOpenChange={(o) => setEditDialog((prev) => ({ ...prev, open: o }))}
      >
        <DialogContent dir="rtl">
          <DialogHeader>
            <DialogTitle>تعديل المجموعة الإلكترونية</DialogTitle>
            <DialogDescription>أدخل البيانات الجديدة للمجموعة الإلكترونية</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="edit-group-name">اسم المجموعة الإلكترونية</Label>
              <Input
                id="edit-group-name"
                name="groupName"
                autoComplete="off"
                value={editDialog.groupName}
                onChange={(e) =>
                  setEditDialog((prev) => ({
                    ...prev,
                    groupName: e.target.value,
                  }))
                }
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-group-electronic">
                رابط المجموعة
              </Label>
              <Input
                id="edit-group-electronic"
                name="electronic"
                autoComplete="off"
                value={editDialog.electronic}
                onChange={(e) =>
                  setEditDialog((prev) => ({
                    ...prev,
                    electronic: e.target.value,
                  }))
                }
                placeholder="@group"
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
            <Button onClick={handleEditSave} disabled={isSavingGroup}>
              {isSavingGroup ? "جاري الحفظ..." : "حفظ"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Group AlertDialog */}
      <AlertDialog
        open={deleteDialog.open}
        onOpenChange={(o) => setDeleteDialog((prev) => ({ ...prev, open: o }))}
      >
        <AlertDialogContent dir="rtl">
          <AlertDialogHeader>
            <AlertDialogTitle>تأكيد الحذف</AlertDialogTitle>
            <AlertDialogDescription>
              هل تريد حذف المجموعة الإلكترونية &quot;{deleteDialog.groupName}&quot;؟ لا يمكن
              حذف مجموعة إلكترونية مرتبطة بطلاب أو امتحانات.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>إلغاء</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteConfirm}
              disabled={isDeletingGroup}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isDeletingGroup ? "جاري الحذف..." : "حذف"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
