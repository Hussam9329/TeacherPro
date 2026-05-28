'use client';

import React, { useState, useMemo } from 'react';
import { useTeacherStore } from '@/lib/teacher-store';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { toast } from 'sonner';
import { toLatinDigits } from '@/lib/format';

export function ECorrectionView() {
  const { correctionSheets, students, exams, users, addCorrectionSheet, updateCorrectionSheet, deleteCorrectionSheet, leaderboardSettings, studentName, userName } = useTeacherStore();

  const [filterExamId, setFilterExamId] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [completeDialog, setCompleteDialog] = useState({ open: false, sheetId: '', correctionErrors: 0, sumErrors: 0 });
  const [deleteSheetDialog, setDeleteSheetDialog] = useState({ open: false, id: '' });

  // Filter sheets
  const filteredSheets = useMemo(() => {
    return correctionSheets.filter(s => {
      if (filterExamId && s.examId !== filterExamId) return false;
      if (filterStatus && s.status !== filterStatus) return false;
      return true;
    });
  }, [correctionSheets, filterExamId, filterStatus]);

  // Stats
  const completed = correctionSheets.filter(s => s.status === 'مكتمل').length;
  const pending = correctionSheets.filter(s => s.status !== 'مكتمل').length;
  const totalErrors = correctionSheets.reduce((acc, s) => acc + s.correctionErrors + s.sumErrors, 0);

  // Leaderboard: sorted by total errors (ascending)
  const leaderboard = useMemo(() => {
    const correctorMap = new Map<string, { name: string; totalCorrectionErrors: number; totalSumErrors: number; sheets: number }>();
    correctionSheets.filter(s => s.status === 'مكتمل').forEach(s => {
      const existing = correctorMap.get(s.correctorId) || { name: userName(s.correctorId), totalCorrectionErrors: 0, totalSumErrors: 0, sheets: 0 };
      existing.totalCorrectionErrors += s.correctionErrors;
      existing.totalSumErrors += s.sumErrors;
      existing.sheets += 1;
      correctorMap.set(s.correctorId, existing);
    });
    return Array.from(correctorMap.entries()).map(([id, data]) => ({
      id,
      ...data,
      penalty: data.totalCorrectionErrors * leaderboardSettings.correctionErrorPenalty + data.totalSumErrors * leaderboardSettings.sumErrorPenalty,
    })).sort((a, b) => a.penalty - b.penalty);
  }, [correctionSheets, leaderboardSettings, userName]);

  // Add new sheet
  const handleAddSheet = () => {
    const firstExam = exams[0];
    const firstStudent = students[0];
    if (!firstExam || !firstStudent) return;
    addCorrectionSheet({
      studentId: firstStudent.id,
      examId: firstExam.id,
      correctorId: users[0]?.id || '',
      status: 'بانتظار التصحيح',
      startedAt: new Date().toISOString(),
      finishedAt: '',
      correctionErrors: 0,
      sumErrors: 0,
    });
    toast.success('تم إضافة ورقة تصحيح');
  };

  const handleCompleteSheet = () => {
    updateCorrectionSheet(completeDialog.sheetId, {
      status: 'مكتمل',
      finishedAt: new Date().toISOString(),
      correctionErrors: Math.max(0, Number(completeDialog.correctionErrors) || 0),
      sumErrors: Math.max(0, Number(completeDialog.sumErrors) || 0),
    });
    setCompleteDialog({ open: false, sheetId: '', correctionErrors: 0, sumErrors: 0 });
    toast.success('تم إكمال التصحيح وتسجيل الأخطاء');
  };

  const openDeleteSheetDialog = (sheetId: string) => {
    setDeleteSheetDialog({ open: true, id: sheetId });
  };
  const handleDeleteSheetConfirm = () => {
    const ok = deleteCorrectionSheet(deleteSheetDialog.id);
    ok ? toast.success('تم حذف ورقة التصحيح') : toast.error('تعذر حذف الورقة');
    setDeleteSheetDialog({ open: false, id: '' });
  };

  return (
    <div className="space-y-6">
      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">{completed}</p>
            <p className="text-xs text-muted-foreground">مكتمل</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold text-amber-600 dark:text-amber-400">{pending}</p>
            <p className="text-xs text-muted-foreground">بانتظار التصحيح</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold text-rose-600 dark:text-rose-400">{totalErrors}</p>
            <p className="text-xs text-muted-foreground">إجمالي الأخطاء</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <Button size="sm" className="w-full" onClick={handleAddSheet} title="يضيف ورقة تصحيح تجريبية إلى القائمة">إضافة ورقة</Button>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="sheets" dir="rtl">
        <TabsList className="w-full justify-start">
          <TabsTrigger value="sheets">أوراق التصحيح</TabsTrigger>
          <TabsTrigger value="leaderboard">المتصدرين</TabsTrigger>
          <TabsTrigger value="errors">تتبع الأخطاء</TabsTrigger>
        </TabsList>

        {/* Sheets Tab */}
        <TabsContent value="sheets" className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="ecorrection-exam" className="text-xs">الامتحان</Label>
              <Select value={filterExamId} onValueChange={v => setFilterExamId(v === 'all' ? '' : v)}>
                <SelectTrigger id="ecorrection-exam"><SelectValue placeholder="الكل" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">الكل</SelectItem>
                  {exams.map(e => <SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="ecorrection-status" className="text-xs">الحالة</Label>
              <Select value={filterStatus} onValueChange={v => setFilterStatus(v === 'all' ? '' : v)}>
                <SelectTrigger id="ecorrection-status"><SelectValue placeholder="الكل" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">الكل</SelectItem>
                  <SelectItem value="بانتظار التصحيح">بانتظار التصحيح</SelectItem>
                  <SelectItem value="قيد التصحيح">قيد التصحيح</SelectItem>
                  <SelectItem value="مكتمل">مكتمل</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>


          <div className="space-y-2">
            {filteredSheets.map(sheet => (
              <Card key={sheet.id}>
                <CardContent className="p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-medium text-sm">{studentName(sheet.studentId)}</p>
                      <p className="text-xs text-muted-foreground">
                        {exams.find(e => e.id === sheet.examId)?.name || ''} - المصحح: {userName(sheet.correctorId)}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant={sheet.status === 'مكتمل' ? 'default' : 'secondary'}>
                        {sheet.status}
                      </Badge>
                      {sheet.status === 'مكتمل' && (
                        <div className="text-xs text-muted-foreground">
                          أخطاء التصحيح: {sheet.correctionErrors} | أخطاء الجمع: {sheet.sumErrors}
                        </div>
                      )}
                      {sheet.status !== 'مكتمل' && (
                        <Button
                          size="sm"
                          onClick={() => setCompleteDialog({ open: true, sheetId: sheet.id, correctionErrors: sheet.correctionErrors, sumErrors: sheet.sumErrors })}
                        >
                          إكمال
                        </Button>
                      )}
                      <Button variant="destructive" size="sm" onClick={() => openDeleteSheetDialog(sheet.id)}>حذف</Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>

        {/* Leaderboard Tab */}
        <TabsContent value="leaderboard">
          <Card>
            <CardHeader>
              <CardTitle>لوحة المتصدرين - المصححون</CardTitle>
            </CardHeader>
            <CardContent>
              {leaderboard.length === 0 ? (
                <p className="empty-state">لا توجد بيانات</p>
              ) : (
                <div className="space-y-2">
                  {leaderboard.map((entry, index) => (
                    <div key={entry.id} className="flex items-center justify-between p-3 rounded-2xl border bg-card/80 shadow-sm">
                      <div className="flex items-center gap-3">
                        <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold ${
                          index === 0 ? 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200' :
                          index === 1 ? 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200' :
                          index === 2 ? 'bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200' :
                          'bg-muted text-muted-foreground'
                        }`}>
                          {index + 1}
                        </div>
                        <div>
                          <p className="font-medium">{entry.name}</p>
                          <p className="text-xs text-muted-foreground">{entry.sheets} ورقة</p>
                        </div>
                      </div>
                      <div className="text-left">
                        <p className="font-bold">{entry.penalty} نقطة جزاء</p>
                        <p className="text-xs text-muted-foreground">
                          تصحيح: {entry.totalCorrectionErrors} | جمع: {entry.totalSumErrors}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Errors Tab */}
        <TabsContent value="errors">
          <Card>
            <CardHeader>
              <CardTitle>تتبع الأخطاء</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {correctionSheets.filter(s => s.status === 'مكتمل' && (s.correctionErrors > 0 || s.sumErrors > 0)).length === 0 ? (
                  <p className="empty-state">لا توجد أخطاء مسجلة</p>
                ) : (
                  correctionSheets.filter(s => s.status === 'مكتمل' && (s.correctionErrors > 0 || s.sumErrors > 0)).map(sheet => (
                    <div key={sheet.id} className="flex items-center justify-between p-3 rounded-2xl border bg-card/80 shadow-sm">
                      <div>
                        <p className="font-medium text-sm">{studentName(sheet.studentId)}</p>
                        <p className="text-xs text-muted-foreground">
                          المصحح: {userName(sheet.correctorId)} - {exams.find(e => e.id === sheet.examId)?.name}
                        </p>
                      </div>
                      <div className="flex gap-2">
                        {sheet.correctionErrors > 0 && <Badge variant="destructive">تصحيح: {sheet.correctionErrors}</Badge>}
                        {sheet.sumErrors > 0 && <Badge variant="secondary">جمع: {sheet.sumErrors}</Badge>}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Delete Sheet AlertDialog */}
      <AlertDialog open={deleteSheetDialog.open} onOpenChange={o => setDeleteSheetDialog(prev => ({ ...prev, open: o }))}>
        <AlertDialogContent dir="rtl">
          <AlertDialogHeader>
            <AlertDialogTitle>تأكيد الحذف</AlertDialogTitle>
            <AlertDialogDescription>
              هل تريد حذف ورقة التصحيح؟
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>إلغاء</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteSheetConfirm} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              حذف
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={completeDialog.open} onOpenChange={(open) => setCompleteDialog(prev => ({ ...prev, open }))}>
        <DialogContent dir="rtl">
          <DialogHeader>
            <DialogTitle>إكمال ورقة التصحيح وتسجيل الأخطاء</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="ecorrection-errors">أخطاء التصحيح</Label>
              <Input id="ecorrection-errors" name="correctionErrors" type="number" min={0} autoComplete="off" value={completeDialog.correctionErrors} onChange={e => setCompleteDialog(prev => ({ ...prev, correctionErrors: Number(toLatinDigits(e.target.value)) || 0 }))} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="ecorrection-sum-errors">أخطاء الجمع</Label>
              <Input id="ecorrection-sum-errors" name="sumErrors" type="number" min={0} autoComplete="off" value={completeDialog.sumErrors} onChange={e => setCompleteDialog(prev => ({ ...prev, sumErrors: Number(toLatinDigits(e.target.value)) || 0 }))} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCompleteDialog({ open: false, sheetId: '', correctionErrors: 0, sumErrors: 0 })}>إلغاء</Button>
            <Button onClick={handleCompleteSheet}>حفظ وإكمال</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
