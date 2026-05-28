'use client';

import React, { useState, useMemo } from 'react';
import { useTeacherStore } from '@/lib/teacher-store';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { toast } from 'sonner';

export function ExamRecordsView() {
  const { exams, grades, students, courses, updateExam, deleteExam, courseName, classification } = useTeacherStore();

  const [filterType, setFilterType] = useState('');
  const [filterCourseId, setFilterCourseId] = useState('');
  const [accountingFilter, setAccountingFilter] = useState(false);

  const filteredExams = useMemo(() => {
    return exams.filter(e => {
      if (filterType && e.type !== filterType) return false;
      if (filterCourseId && !e.courseIds.includes(filterCourseId)) return false;
      return true;
    });
  }, [exams, filterType, filterCourseId]);

  const exportPDF = (examId: string) => {
    const exam = exams.find(e => e.id === examId);
    if (!exam) return;

    const examGrades = grades.filter(g => g.examId === examId);
    const data = examGrades.map(g => {
      const student = students.find(s => s.id === g.studentId);
      const cls = classification(g, exam);
      return {
        name: student?.name || '',
        code: student?.code || '',
        status: g.status,
        score: g.score,
        classification: cls.text,
      };
    }).sort((a, b) => a.name.localeCompare(b.name, 'ar'));

    const rows = data.map((d, i) => `<tr><td>${i + 1}</td><td>${d.code}</td><td>${d.name}</td><td>${d.status}</td><td>${d.score ?? '-'}/${exam.fullMark}</td><td>${d.classification}</td></tr>`).join('');
    const html = `<!doctype html><html dir="rtl" lang="ar"><head><meta charset="utf-8"/><title>${exam.name}</title><style>body{font-family:Arial,sans-serif;padding:24px;direction:rtl}h1{font-size:22px}table{width:100%;border-collapse:collapse;margin-top:16px}td,th{border:1px solid #ddd;padding:8px;text-align:right}th{background:#f4f4f4}@media print{button{display:none}}</style></head><body><button onclick="window.print()">حفظ PDF / طباعة</button><h1>سجل الامتحان: ${exam.name}</h1><p>التاريخ: ${exam.date} | النوع: ${exam.type} | النجاح: ${exam.passMark} | الخصم: ${exam.discountMark}</p><table><thead><tr><th>#</th><th>الكود</th><th>الطالب</th><th>الحالة</th><th>الدرجة</th><th>التصنيف</th></tr></thead><tbody>${rows}</tbody></table><script>window.onload=()=>setTimeout(()=>window.print(),250)</script></body></html>`;
    const win = window.open('', '_blank');
    if (!win) { toast.error('المتصفح منع نافذة الطباعة'); return; }
    win.document.write(html);
    win.document.close();
    toast.success('تم فتح نافذة PDF');
  };

  const handleEditExam = (examId: string) => {
    const exam = exams.find(e => e.id === examId);
    if (!exam) return;
    const nextName = prompt('اسم الامتحان', exam.name);
    if (!nextName || !nextName.trim()) return;
    const passMark = Number(prompt('درجة النجاح', String(exam.passMark)) || exam.passMark);
    const discountMark = Number(prompt('درجة الخصم', String(exam.discountMark)) || exam.discountMark);
    updateExam(examId, { name: nextName.trim(), passMark, discountMark });
    toast.success('تم تعديل الامتحان');
  };

  const handleDeleteExam = (examId: string) => {
    if (!confirm('هل تريد حذف الامتحان؟ سيتم حذف الدرجات وأوراق التصحيح التابعة له.')) return;
    const ok = deleteExam(examId);
    ok ? toast.success('تم حذف الامتحان') : toast.error('تعذر حذف الامتحان');
  };

  return (
    <div className="space-y-4">
      {/* Filters */}
      <Card>
        <CardContent className="p-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="space-y-1">
              <Label htmlFor="exam-records-type" className="text-xs">نوع الامتحان</Label>
              <Select value={filterType} onValueChange={v => setFilterType(v === 'all' ? '' : v)}>
                <SelectTrigger id="exam-records-type"><SelectValue placeholder="الكل" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">الكل</SelectItem>
                  <SelectItem value="يومي">يومي</SelectItem>
                  <SelectItem value="تراكمي">تراكمي</SelectItem>
                  <SelectItem value="فاينل">فاينل</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="exam-records-course" className="text-xs">الدورة</Label>
              <Select value={filterCourseId} onValueChange={v => setFilterCourseId(v === 'all' ? '' : v)}>
                <SelectTrigger id="exam-records-course"><SelectValue placeholder="الكل" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">الكل</SelectItem>
                  {courses.map(c => (
                    <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-2 pt-5">
              <Checkbox id="exam-records-accounting" checked={accountingFilter} onCheckedChange={v => setAccountingFilter(!!v)} />
              <Label htmlFor="exam-records-accounting" className="text-xs">محاسبة فقط</Label>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Exam Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {filteredExams.map(exam => {
          const examStudents = grades
            .filter(g => g.examId === exam.id)
            .map(g => {
              const student = students.find(s => s.id === g.studentId);
              const cls = classification(g, exam);
              return { ...g, student, cls };
            })
            .filter(g => {
              if (!g.student) return false;
              if (accountingFilter && g.cls.kind !== 'accounting') return false;
              return true;
            })
            .sort((a, b) => (a.student?.name || '').localeCompare(b.student?.name || '', 'ar'));

          const passCount = examStudents.filter(g => g.cls.kind === 'pass').length;
          const failCount = examStudents.filter(g => g.cls.kind === 'deducted').length;
          const absentCount = examStudents.filter(g => g.status === 'غائب').length;

          return (
            <Card key={exam.id} className="transition-all duration-200 hover:-translate-y-0.5 hover:shadow-xl hover:shadow-primary/10">
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between">
                  <div>
                    <CardTitle className="text-base">{exam.name}</CardTitle>
                    <p className="text-xs text-muted-foreground mt-1">{exam.date} - {courseName(exam.courseIds[0])}</p>
                  </div>
                  <div className="flex gap-1">
                    <Badge variant={exam.type === 'يومي' ? 'secondary' : exam.type === 'تراكمي' ? 'default' : 'destructive'}>
                      {exam.type}
                    </Badge>
                    <Button variant="ghost" size="sm" onClick={() => exportPDF(exam.id)}>PDF</Button>
                    <Button variant="secondary" size="sm" onClick={() => handleEditExam(exam.id)}>تعديل</Button>
                    <Button variant="destructive" size="sm" onClick={() => handleDeleteExam(exam.id)}>حذف</Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                {/* Stats */}
                <div className="grid grid-cols-3 gap-2 mb-3 text-center">
                  <div className="p-2 rounded bg-emerald-50 dark:bg-emerald-950/40">
                    <p className="text-lg font-bold text-emerald-600 dark:text-emerald-400">{passCount}</p>
                    <p className="text-[10px] text-muted-foreground">ناجح</p>
                  </div>
                  <div className="p-2 rounded bg-rose-50 dark:bg-rose-950/40">
                    <p className="text-lg font-bold text-rose-600 dark:text-rose-400">{failCount + absentCount}</p>
                    <p className="text-[10px] text-muted-foreground">راسب/غائب</p>
                  </div>
                  <div className="p-2 rounded bg-sky-50 dark:bg-sky-950/40">
                    <p className="text-lg font-bold text-sky-600 dark:text-sky-400">{examStudents.length}</p>
                    <p className="text-[10px] text-muted-foreground">إجمالي</p>
                  </div>
                </div>

                {/* Student Results */}
                <div className="space-y-1 max-h-60 overflow-y-auto">
                  {examStudents.map(g => (
                    <div key={g.id} className="flex items-center justify-between text-sm p-2 rounded-xl bg-muted/60">
                      <span className="truncate">{g.student?.name}</span>
                      <div className="flex items-center gap-2">
                        {g.score !== null && <span className="font-bold">{g.score}</span>}
                        <Badge variant={g.cls.type === 'ok' ? 'default' : g.cls.type === 'danger' ? 'destructive' : g.cls.type === 'warn' ? 'secondary' : 'outline'} className="text-[10px]">
                          {g.cls.text}
                        </Badge>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
