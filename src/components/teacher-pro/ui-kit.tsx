'use client';

import React from 'react';
import { SearchX } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Card, CardContent } from '@/components/ui/card';

type IconComponent = React.ComponentType<{ className?: string }>;

export function PageHero({
  title,
  description,
  icon: Icon,
  actions,
}: {
  title: string;
  description?: string;
  icon?: IconComponent;
  actions?: React.ReactNode;
}) {
  return (
    <section className="relative overflow-hidden rounded-3xl border bg-card/85 p-5 shadow-card backdrop-blur-xl md:p-6">
      <div className="absolute inset-inline-start-0 top-0 h-24 w-24 rounded-full bg-primary/20 blur-3xl" />
      <div className="absolute inset-inline-end-0 bottom-0 h-20 w-32 rounded-full bg-primary/10 blur-3xl" />
      <div className="relative flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <div>
            <h3 className="text-2xl font-extrabold tracking-tight md:text-3xl" style={{
              background: 'linear-gradient(135deg, oklch(0.55 0.22 300), oklch(0.70 0.20 288), oklch(0.60 0.18 255))',
              WebkitBackgroundClip: 'text',
              backgroundClip: 'text',
              color: 'transparent',
              filter: 'drop-shadow(0 1px 2px oklch(0.55 0.22 300 / 0.25))',
            }}>{title}</h3>
            {description && <p className="mt-1.5 text-sm leading-6 text-muted-foreground/80">{description}</p>}
          </div>
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </section>
  );
}

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
}: {
  title?: string;
  description?: string;
  icon?: IconComponent;
}) {
  return (
    <div className="empty-state">
      <div className="mx-auto mb-3 flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary">
        <Icon className="size-5" />
      </div>
      <p className="font-bold text-foreground">{title}</p>
      <p className="mx-auto mt-1 max-w-md text-xs leading-6 text-muted-foreground">{description}</p>
    </div>
  );
}
