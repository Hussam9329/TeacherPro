'use client';

import React from 'react';
import { Loader2, SearchX } from 'lucide-react';

type IconComponent = React.ComponentType<{ className?: string }>;

export function EmptyState({
  title = 'لا توجد بيانات',
  description,
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
      {description && <p className="mx-auto mt-1 max-w-md text-xs leading-6 text-muted-foreground">{description}</p>}
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  );
}

export function LoadingState({
  title = 'جاري تحميل البيانات...',
  description,
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
          {description && <p className="tp-loading-state__description">{description}</p>}
          <div className="tp-loading-state__skeleton" aria-hidden="true">
            <div className="tp-loading-state__line w-full" />
            <div className="tp-loading-state__line w-2/3" />
          </div>
        </div>
      </div>
    </div>
  );
}
