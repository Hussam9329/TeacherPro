'use client';

import React from 'react';
import { CheckCircle2, Loader2, SearchX } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Card, CardContent } from '@/components/ui/card';
import { TEACHERPRO_COUNT_SCOPE_COPY } from '@/lib/teacherpro-language';

type IconComponent = React.ComponentType<{ className?: string }>;

export type CountScope = 'system' | 'filtered' | 'page' | 'context';

const countScopeStyles: Record<CountScope, string> = {
  system: 'border-primary/20 bg-card/90',
  filtered: 'border-dashed border-sky-500/35 bg-sky-500/5',
  page: 'border-dotted border-muted-foreground/30 bg-muted/25',
  context: 'border-dashed border-violet-500/35 bg-violet-500/5',
};

const countScopePillStyles: Record<CountScope, string> = {
  system: 'bg-primary/10 text-primary',
  filtered: 'bg-sky-500/10 text-sky-700 dark:text-sky-300',
  page: 'bg-muted text-muted-foreground',
  context: 'bg-violet-500/10 text-violet-700 dark:text-violet-300',
};

export function StatCard({
  label,
  value,
  icon: Icon,
  tone = 'primary',
  hint,
  scope = 'system',
  scopeLabel,
}: {
  label: string;
  value: React.ReactNode;
  icon: IconComponent;
  tone?: 'primary' | 'success' | 'warning' | 'danger' | 'info';
  hint?: string;
  scope?: CountScope;
  scopeLabel?: string;
}) {
  const toneClass = {
    primary: 'bg-primary/10 text-primary border-primary/20',
    success: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20',
    warning: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20',
    danger: 'bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/20',
    info: 'bg-sky-500/10 text-sky-600 dark:text-sky-400 border-sky-500/20',
  }[tone];

  return (
    <Card className={cn('metric-card py-0', countScopeStyles[scope])} data-count-scope={scope}>
      <CardContent className="relative p-4">
        <div className="flex items-center gap-4">
          <div className={cn('flex size-12 items-center justify-center rounded-2xl border', toneClass)}>
            <Icon className="size-6" />
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-sm text-muted-foreground">{label}</p>
              <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-bold', countScopePillStyles[scope])}>
                {scopeLabel || TEACHERPRO_COUNT_SCOPE_COPY[scope]}
              </span>
            </div>
            <p className="text-2xl font-black tracking-tight">{value}</p>
            {hint && <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}


export function CountScopeSummary({
  systemTotal,
  filteredTotal,
  pageCount,
  subject = 'سجل',
  className,
}: {
  systemTotal?: React.ReactNode;
  filteredTotal: React.ReactNode;
  pageCount: React.ReactNode;
  subject?: string;
  className?: string;
}) {
  const items: Array<{ scope: CountScope; label: string; value: React.ReactNode }> = [
    ...(systemTotal === undefined
      ? []
      : [{ scope: 'system' as const, label: `إجمالي ${subject} في النظام`, value: systemTotal }]),
    { scope: 'filtered', label: 'المطابقون للفلاتر', value: filteredTotal },
    { scope: 'page', label: 'المعروض في الصفحة', value: pageCount },
  ];

  return (
    <div className={cn('grid gap-2 rounded-2xl border bg-card/70 p-2 sm:grid-cols-3', className)} aria-label="نطاق العدادات">
      {items.map((item) => (
        <div
          key={item.scope}
          className={cn('flex items-center justify-between gap-3 rounded-xl border px-3 py-2', countScopeStyles[item.scope])}
          data-count-scope={item.scope}
        >
          <span className="text-xs font-semibold text-muted-foreground">{item.label}</span>
          <strong className="text-base text-foreground">{item.value}</strong>
        </div>
      ))}
    </div>
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
  description = 'نجهّز المعلومات من بيانات النظام، ستظهر النتائج بعد لحظات.',
}: {
  title?: string;
  description?: string;
}) {
  return (
    <div
      className="tp-loading-state"
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <div className="tp-loading-state__layout">
        <div className="tp-loading-state__icon" aria-hidden="true">
          <Loader2 className="size-5 animate-spin" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="tp-loading-state__title">{title}</p>
          <p className="tp-loading-state__description">{description}</p>
          <div className="tp-loading-state__skeleton" aria-hidden="true">
            <div className="tp-loading-state__line w-full" />
            <div className="tp-loading-state__line w-2/3" />
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
