'use client';

import React from 'react';
import { ChevronLeft, ChevronRight, Loader2, RotateCcw, SearchX } from 'lucide-react';
import { Button } from '@/components/ui/button';
import './tp-list.css';

type IconComponent = React.ComponentType<{ className?: string }>;

/**
 * A list that failed to load: says so (it is not «ماكو نتائج») and offers to
 * try again. Shown instead of the empty box, never under it.
 */
export function ErrorState({ message, onRetry }: { message: React.ReactNode; onRetry?: () => void }) {
  return (
    <div
      role="alert"
      className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-danger-line border-s-4 border-s-danger-vivid bg-danger-soft p-3 text-sm font-medium text-danger"
    >
      <span className="min-w-0 [overflow-wrap:anywhere]">{message}</span>
      {onRetry ? (
        <button
          type="button"
          onClick={onRetry}
          className="inline-flex items-center gap-1.5 rounded-xl border border-danger-line bg-card px-3 py-1.5 text-xs font-semibold text-foreground hover:bg-muted"
        >
          <RotateCcw className="size-4" aria-hidden="true" />
          إعادة المحاولة
        </button>
      ) : null}
    </div>
  );
}

/**
 * «ماكو بيانات»: the one empty box of every page and window. `compact` is for
 * a part of a card or window (a tab, a student's history), not a whole list.
 */
export function EmptyState({
  title = 'ماكو بيانات',
  description,
  icon: Icon = SearchX,
  action,
  compact = false,
  className,
}: {
  title?: React.ReactNode;
  description?: React.ReactNode;
  icon?: IconComponent;
  action?: React.ReactNode;
  compact?: boolean;
  className?: string;
}) {
  return (
    <div className={`empty-state${compact ? ' py-5' : ''}${className ? ` ${className}` : ''}`}>
      <div
        className={`mx-auto flex items-center justify-center rounded-full bg-primary/10 text-primary ${compact ? 'mb-2 size-9' : 'mb-3 size-12'}`}
        aria-hidden="true"
      >
        <Icon className={compact ? 'size-4' : 'size-5'} />
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

/**
 * The one page bar of every list: «السابق» / «التالي» with the page count in
 * the middle. Changing page scrolls back to the top of the list (the element
 * passed as `scrollTarget`, or the bar's own parent), so the user is never
 * left at the bottom of the new page.
 */
export function ListPagination({
  page,
  totalPages,
  onPageChange,
  summary,
  disabled = false,
  scrollTarget,
  label = 'التنقل بين الصفحات',
}: {
  page: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  summary?: React.ReactNode;
  disabled?: boolean;
  scrollTarget?: React.RefObject<HTMLElement | null>;
  label?: string;
}) {
  const navRef = React.useRef<HTMLElement | null>(null);
  if (totalPages <= 1) return null;
  const go = (next: number) => {
    onPageChange(next);
    window.requestAnimationFrame(() => {
      const target = scrollTarget?.current || navRef.current?.parentElement;
      target?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  };
  return (
    <nav ref={navRef} className="tp-list-pagination" aria-label={label}>
      <Button type="button" variant="outline" size="sm" disabled={disabled || page <= 1} onClick={() => go(page - 1)}>
        <ChevronRight aria-hidden="true" className="size-4" />
        السابق
      </Button>
      <span className="tp-list-pagination__summary">
        {summary ?? <>صفحة <b>{page}</b> من <b>{totalPages}</b></>}
      </span>
      <Button type="button" variant="outline" size="sm" disabled={disabled || page >= totalPages} onClick={() => go(page + 1)}>
        التالي
        <ChevronLeft aria-hidden="true" className="size-4" />
      </Button>
    </nav>
  );
}
