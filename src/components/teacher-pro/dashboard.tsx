'use client';

import React from 'react';
import { useTeacherStore } from '@/lib/teacher-store';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Users, Shield, BookOpen, Clock } from 'lucide-react';
import { EmptyState, StatCard } from './ui-kit';

export function DashboardView() {
  const { students, correctionSheets, logs, setSection } = useTeacherStore();

  const activeCount = students.filter(s => s.status === 'نشط').length;
  const dismissedCount = students.filter(s => s.status === 'مفصول').length;
  const privateCount = students.filter(s => s.courseType === 'خاصة').length;
  const pendingSheets = correctionSheets.filter(s => s.status !== 'مكتمل').length;

  const kpiCards = [
    { label: 'طلاب نشطون', value: activeCount, icon: Users, tone: 'success' as const, hint: 'جاهزون للمتابعة' },
    { label: 'طلاب مفصولون', value: dismissedCount, icon: Shield, tone: 'warning' as const, hint: 'بحاجة لمراجعة' },
    { label: 'طلاب الدورة الخاصة', value: privateCount, icon: BookOpen, tone: 'info' as const, hint: 'ضمن المسار الخاص' },
    { label: 'أوراق بانتظار التصحيح', value: pendingSheets, icon: Clock, tone: 'danger' as const, hint: 'قيد المعالجة' },
  ];

  const recentLogs = logs.slice(0, 6);
  return (
    <div className="section-stack">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {kpiCards.map((card) => (
          <StatCard key={card.label} label={card.label} value={card.value} icon={card.icon} tone={card.tone} hint={card.hint} />
        ))}
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <div>
            <CardTitle className="text-base">آخر الفعاليات</CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">أحدث عمليات النظام وسجل التغييرات</p>
          </div>
          <Button variant="outline" size="sm" onClick={() => setSection('logs')}>
            عرض Log
          </Button>
        </CardHeader>
        <CardContent>
          <div className="max-h-80 space-y-3 overflow-y-auto pr-1">
            {recentLogs.length === 0 ? (
              <EmptyState title="لا توجد فعاليات بعد" description="سيظهر سجل العمليات هنا بمجرد إضافة أو تعديل البيانات." />
            ) : (
              recentLogs.map((log) => (
                <div key={log.id} className="list-row border-r-4 border-r-primary/40">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-bold text-sm">{log.action}</p>
                      <p className="text-xs text-muted-foreground">
                        {log.user} - {log.module} - {log.time}
                      </p>
                    </div>
                    <span className="chip">نشاط</span>
                  </div>
                  {log.details && (
                    <p className="mt-2 text-xs leading-6 text-muted-foreground">{log.details}</p>
                  )}
                </div>
              ))
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
