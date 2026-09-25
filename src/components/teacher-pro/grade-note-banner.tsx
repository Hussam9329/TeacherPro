"use client";

import {
  CalendarClock,
  FileClock,
  Hourglass,
  Leaf,
  PenLine,
  StickyNote,
  UserX,
  type LucideIcon,
} from "lucide-react";

import { resolveGradeNoteBanner } from "@/lib/grade-note-banners";

const TONES: Record<
  string,
  { Icon: LucideIcon; wrapper: string; icon: string }
> = {
  corrected: {
    Icon: PenLine,
    wrapper:
      "border border-sky-200/80 bg-gradient-to-l from-sky-50 to-sky-50/40 text-sky-900 dark:border-sky-900/50 dark:from-sky-950/40 dark:to-sky-950/20 dark:text-sky-100",
    icon: "bg-sky-100 text-sky-600 dark:bg-sky-900/60 dark:text-sky-300",
  },
  "batch-absent": {
    Icon: UserX,
    wrapper:
      "border border-rose-200/80 bg-gradient-to-l from-rose-50 to-rose-50/40 text-rose-900 dark:border-rose-900/50 dark:from-rose-950/40 dark:to-rose-950/20 dark:text-rose-100",
    icon: "bg-rose-100 text-rose-600 dark:bg-rose-900/60 dark:text-rose-300",
  },
  "auto-absent": {
    Icon: UserX,
    wrapper:
      "border border-rose-200/80 bg-gradient-to-l from-rose-50 to-rose-50/40 text-rose-900 dark:border-rose-900/50 dark:from-rose-950/40 dark:to-rose-950/20 dark:text-rose-100",
    icon: "bg-rose-100 text-rose-600 dark:bg-rose-900/60 dark:text-rose-300",
  },
  "before-registration": {
    Icon: CalendarClock,
    wrapper:
      "border border-slate-200/80 bg-gradient-to-l from-slate-50 to-slate-50/40 text-slate-700 dark:border-slate-800 dark:from-slate-900/50 dark:to-slate-900/25 dark:text-slate-200",
    icon: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300",
  },
  grace: {
    Icon: Hourglass,
    wrapper:
      "border border-violet-200/80 bg-gradient-to-l from-violet-50 to-violet-50/40 text-violet-900 dark:border-violet-900/50 dark:from-violet-950/40 dark:to-violet-950/20 dark:text-violet-100",
    icon: "bg-violet-100 text-violet-600 dark:bg-violet-900/60 dark:text-violet-300",
  },
  excused: {
    Icon: Leaf,
    wrapper:
      "border border-emerald-200/80 bg-gradient-to-l from-emerald-50 to-emerald-50/40 text-emerald-900 dark:border-emerald-900/50 dark:from-emerald-950/40 dark:to-emerald-950/20 dark:text-emerald-100",
    icon: "bg-emerald-100 text-emerald-600 dark:bg-emerald-900/60 dark:text-emerald-300",
  },
  deferred: {
    Icon: FileClock,
    wrapper:
      "border border-teal-200/80 bg-gradient-to-l from-teal-50 to-teal-50/40 text-teal-900 dark:border-teal-900/50 dark:from-teal-950/40 dark:to-teal-950/20 dark:text-teal-100",
    icon: "bg-teal-100 text-teal-600 dark:bg-teal-900/60 dark:text-teal-300",
  },
};

const CUSTOM = {
  Icon: StickyNote,
  wrapper:
    "border border-amber-200/70 bg-amber-50/80 text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/25 dark:text-amber-100",
  icon: "bg-amber-100 text-amber-600 dark:bg-amber-900/60 dark:text-amber-300",
};

/**
 * بانر ملاحظة الدرجة — عرض قصير ملوّن وأيقونة واضحة بدل النصوص الآلية الطويلة.
 * الملاحظات المخصصة (التي كتبها المستخدم) تبقى بنصها الكامل داخل بانر محايد.
 */
export function GradeNoteBanner({
  notes,
  className = "",
}: {
  notes: string | null | undefined;
  className?: string;
}) {
  const raw = (notes ?? "").trim();
  if (!raw) return null;

  const banner = resolveGradeNoteBanner(raw);

  if (!banner) {
    const { Icon, wrapper, icon } = CUSTOM;
    return (
      <div
        className={`inline-flex max-w-full items-start gap-2 rounded-xl px-3 py-2 text-xs leading-5 ${wrapper} ${className}`}
      >
        <span
          className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-lg ${icon}`}
        >
          <Icon className="h-3 w-3" aria-hidden="true" />
        </span>
        <span className="min-w-0 break-words [overflow-wrap:anywhere]">
          {raw}
        </span>
      </div>
    );
  }

  const { Icon, wrapper, icon } = TONES[banner.key] ?? CUSTOM;
  return (
    <div
      title={banner.title}
      className={`inline-flex max-w-full items-center gap-2 rounded-xl px-3 py-2 text-xs font-semibold leading-5 shadow-sm ${wrapper} ${className}`}
    >
      <span
        className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-lg ${icon}`}
      >
        <Icon className="h-3 w-3" aria-hidden="true" />
      </span>
      <span>{banner.label}</span>
      {banner.detail ? (
        <span className="min-w-0 truncate font-normal opacity-80 [overflow-wrap:anywhere]">
          {banner.detail}
        </span>
      ) : null}
    </div>
  );
}
