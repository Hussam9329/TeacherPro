'use client';

import React, { useState } from 'react';
import { useTeacherStore } from '@/lib/teacher-store';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { toast } from 'sonner';

export function CoursesView() {
  const { courses, addCourse, updateCourse, toggleCourse, deleteCourse } = useTeacherStore();
  const [name, setName] = useState('');
  const [type, setType] = useState<'خاصة' | 'عامة'>('خاصة');
  const [editDialog, setEditDialog] = useState({ open: false, id: '', courseName: '' });
  const [deleteDialog, setDeleteDialog] = useState({ open: false, id: '', courseName: '' });

  const openEditDialog = (id: string, oldName: string) => {
    setEditDialog({ open: true, id, courseName: oldName });
  };
  const handleEditSave = () => {
    if (!editDialog.courseName.trim()) { toast.error('يرجى إدخال اسم الدورة'); return; }
    updateCourse(editDialog.id, { name: editDialog.courseName.trim() });
    setEditDialog({ open: false, id: '', courseName: '' });
    toast.success('تم تعديل الدورة');
  };

  const openDeleteDialog = (id: string, courseName: string) => {
    setDeleteDialog({ open: true, id, courseName });
  };
  const handleDeleteConfirm = () => {
    const ok = deleteCourse(deleteDialog.id);
    ok ? toast.success('تم حذف الدورة') : toast.error('لا يمكن حذف الدورة لأنها مرتبطة ببيانات أخرى');
    setDeleteDialog({ open: false, id: '', courseName: '' });
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) { toast.error('يرجى إدخال اسم الدورة'); return; }
    addCourse(name.trim(), type);
    setName('');
    toast.success('تمت إضافة الدورة');
  };

  return (
    <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
      {/* Add Course Form */}
      <Card>
        <CardHeader>
          <CardTitle>إضافة دورة جديدة</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="courseName">اسم الدورة</Label>
              <Input
                id="courseName"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="مثال: أحياء السادس - دفعة جديدة"
                required
              />
            </div>
            <div className="space-y-2">
              <Label>نوع الدورة</Label>
              <Select value={type} onValueChange={(v) => setType(v as 'خاصة' | 'عامة')}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="خاصة">خاصة</SelectItem>
                  <SelectItem value="عامة">عامة</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button type="submit" className="w-full">حفظ الدورة</Button>
          </form>
        </CardContent>
      </Card>

      {/* Course List */}
      <Card>
        <CardHeader>
          <CardTitle>قائمة الدورات</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3 max-h-[500px] overflow-y-auto">
            {courses.length === 0 ? (
              <p className="empty-state">لا توجد دورات بعد</p>
            ) : (
              courses.map((course) => (
                <div key={course.id} className="flex items-center justify-between gap-3 p-3 rounded-2xl border bg-card/80 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-lg">
                  <div className="flex-1">
                    <p className="font-medium text-sm">{course.name}</p>
                    <p className="text-xs text-muted-foreground">{course.createdAt} - {course.type}</p>
                  </div>
                  <Badge variant={course.active ? 'default' : 'secondary'}>
                    {course.active ? 'فعالة' : 'معطلة'}
                  </Badge>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        toggleCourse(course.id);
                        toast.success(course.active ? 'تم تعطيل الدورة' : 'تم تفعيل الدورة');
                      }}
                    >
                      {course.active ? 'تعطيل' : 'تفعيل'}
                    </Button>
                    <Button variant="secondary" size="sm" onClick={() => openEditDialog(course.id, course.name)}>تعديل</Button>
                    <Button variant="destructive" size="sm" onClick={() => openDeleteDialog(course.id, course.name)}>حذف</Button>
                  </div>
                </div>
              ))
            )}
          </div>
        </CardContent>
      </Card>
      {/* Edit Course Dialog */}
      <Dialog open={editDialog.open} onOpenChange={o => setEditDialog(prev => ({ ...prev, open: o }))}>
        <DialogContent dir="rtl">
          <DialogHeader>
            <DialogTitle>تعديل اسم الدورة</DialogTitle>
            <DialogDescription>أدخل الاسم الجديد للدورة</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>اسم الدورة</Label>
              <Input value={editDialog.courseName} onChange={e => setEditDialog(prev => ({ ...prev, courseName: e.target.value }))} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditDialog(prev => ({ ...prev, open: false }))}>إلغاء</Button>
            <Button onClick={handleEditSave}>حفظ</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Course AlertDialog */}
      <AlertDialog open={deleteDialog.open} onOpenChange={o => setDeleteDialog(prev => ({ ...prev, open: o }))}>
        <AlertDialogContent dir="rtl">
          <AlertDialogHeader>
            <AlertDialogTitle>تأكيد الحذف</AlertDialogTitle>
            <AlertDialogDescription>
              هل تريد حذف الدورة &quot;{deleteDialog.courseName}&quot;؟ لا يمكن حذف دورة مرتبطة بطلاب أو امتحانات.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>إلغاء</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteConfirm} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              حذف
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
