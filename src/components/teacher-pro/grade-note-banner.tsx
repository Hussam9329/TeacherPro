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
      "border border-info-line/80 bg-gradient-to-l from-info-soft to-info-soft/40 text-info",
    icon: "bg-info-soft text-info",
  },
  "batch-absent": {
    Icon: UserX,
    wrapper:
      "border border-danger-line/80 bg-gradient-to-l from-danger-soft to-danger-soft/40 text-danger",
    icon: "bg-danger-soft text-danger",
  },
  "auto-absent": {
    Icon: UserX,
    wrapper:
      "border border-danger-line/80 bg-gradient-to-l from-danger-soft to-danger-soft/40 text-danger",
    icon: "bg-danger-soft text-danger",
  },
  "before-registration": {
    Icon: CalendarClock,
    wrapper:
      "border border-border/80 bg-gradient-to-l from-muted to-muted/40 text-foreground",
    icon: "bg-muted text-muted-foreground",
  },
  grace: {
    Icon: Hourglass,
    wrapper:
      "border border-primary/30 bg-gradient-to-l from-primary/10 to-primary/5 text-primary",
    icon: "bg-primary/10 text-primary",
  },
  excused: {
    Icon: Leaf,
    wrapper:
      "border border-success-line/80 bg-gradient-to-l from-success-soft to-success-soft/40 text-success",
    icon: "bg-success-soft text-success",
  },
  deferred: {
    Icon: FileClock,
    wrapper:
      "border border-success-line/80 bg-gradient-to-l from-success-soft to-success-soft/40 text-success",
    icon: "bg-success-soft text-success",
  },
};

const CUSTOM = {
  Icon: StickyNote,
  wrapper:
    "border border-warning-line/70 bg-warning-soft/80 text-warning",
  icon: "bg-warning-soft text-warning",
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
