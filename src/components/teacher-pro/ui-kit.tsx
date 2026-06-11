'use client';

import React from 'react';
import { CheckCircle2, Loader2, SearchX } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Card, CardContent } from '@/components/ui/card';

type IconComponent = React.ComponentType<{ className?: string }>;

export function StatCard({
  label,
  value,
  icon: Icon,
  tone = 'primary',
  hint,
}: {
  label: string;
  value: React.ReactNode;
  icon: IconComponent;
  tone?: 'primary' | 'success' | 'warning' | 'danger' | 'info';
  hint?: string;
}) {
  const toneClass = {
    primary: 'bg-primary/10 text-primary border-primary/20',
    success: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20',
    warning: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20',
    danger: 'bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/20',
    info: 'bg-sky-500/10 text-sky-600 dark:text-sky-400 border-sky-500/20',
  }[tone];

  return (
    <Card className="metric-card py-0">
      <CardContent className="relative p-4">
        <div className="flex items-center gap-4">
          <div className={cn('flex size-12 items-center justify-center rounded-2xl border', toneClass)}>
            <Icon className="size-6" />
          </div>
          <div className="min-w-0">
            <p className="text-sm text-muted-foreground">{label}</p>
            <p className="text-2xl font-black tracking-tight">{value}</p>
            {hint && <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export function EmptyState({
  title = 'لا توجد بيانات',
  description = 'ستظهر النتائج هنا بعد إضافة البيانات أو تعديل الفلاتر.',
  icon: Icon = SearchX,
  action,
}: {
  title?: string;
  description?: string;
  icon?: IconComponent;
  action?: React.ReactNode;
}) {
  return (
    <div className="empty-state">
      <div className="mx-auto mb-3 flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary">
        <Icon className="size-5" />
      </div>
      <p className="font-bold text-foreground">{title}</p>
      <p className="mx-auto mt-1 max-w-md text-xs leading-6 text-muted-foreground">{description}</p>
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  );
}

export function LoadingState({
  title = 'جاري تحميل البيانات...',
  description = 'نجهّز المعلومات من قاعدة البيانات، ستظهر النتائج بعد لحظات.',
}: {
  title?: string;
  description?: string;
}) {
  return (
    <div className="rounded-2xl border bg-card/85 p-4 shadow-sm">
      <div className="flex items-start gap-3">
        <div className="flex size-11 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
          <Loader2 className="size-5 animate-spin" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-bold text-foreground">{title}</p>
          <p className="mt-1 text-xs leading-6 text-muted-foreground">{description}</p>
          <div className="mt-3 space-y-2">
            <div className="h-3 w-full animate-pulse rounded-full bg-muted" />
            <div className="h-3 w-2/3 animate-pulse rounded-full bg-muted" />
          </div>
        </div>
      </div>
    </div>
  );
}

export function StepProgress({
  steps,
}: {
  steps: { label: string; complete: boolean }[];
}) {
  const completed = steps.filter((step) => step.complete).length;
  const percent = steps.length ? Math.round((completed / steps.length) * 100) : 0;

  return (
    <div className="rounded-3xl border bg-muted/35 p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-sm">
        <span className="font-black text-foreground">تقدّم النموذج</span>
        <span className="rounded-full bg-primary/10 px-3 py-1 text-xs font-bold text-primary">
          {completed} من {steps.length} خطوات مكتملة
        </span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-muted">
        <div className="h-full rounded-full bg-primary transition-all duration-300" style={{ width: `${percent}%` }} />
      </div>
      <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
        {steps.map((step, index) => (
          <div
            key={step.label}
            className={cn(
              'flex items-center gap-2 rounded-2xl border px-3 py-2 text-xs font-bold',
              step.complete
                ? 'border-primary/25 bg-primary/10 text-primary'
                : 'border-border bg-background/60 text-muted-foreground',
            )}
          >
            {step.complete ? <CheckCircle2 className="size-4" /> : <span className="flex size-4 items-center justify-center rounded-full border text-[10px]">{index + 1}</span>}
            <span>{step.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
