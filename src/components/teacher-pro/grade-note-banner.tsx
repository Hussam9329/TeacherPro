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

// Full class strings (Tailwind only sees literal class names).
const SIGNAL = {
  info: {
    wrapper: "border border-info-line border-s-4 border-s-info-vivid bg-gradient-to-l from-info-soft to-info-soft/40 text-info",
    icon: "bg-info-solid text-info-on shadow-sm",
  },
  danger: {
    wrapper: "border border-danger-line border-s-4 border-s-danger-vivid bg-gradient-to-l from-danger-soft to-danger-soft/40 text-danger",
    icon: "bg-danger-solid text-danger-on shadow-sm",
  },
  warning: {
    wrapper: "border border-warning-line border-s-4 border-s-warning-vivid bg-gradient-to-l from-warning-soft to-warning-soft/40 text-warning",
    icon: "bg-warning-solid text-warning-on shadow-sm",
  },
  success: {
    wrapper: "border border-success-line border-s-4 border-s-success-vivid bg-gradient-to-l from-success-soft to-success-soft/40 text-success",
    icon: "bg-success-solid text-success-on shadow-sm",
  },
} as const;

const TONES: Record<
  string,
  { Icon: LucideIcon; wrapper: string; icon: string }
> = {
  corrected: { Icon: PenLine, ...SIGNAL.info },
  "batch-absent": { Icon: UserX, ...SIGNAL.danger },
  "auto-absent": { Icon: UserX, ...SIGNAL.danger },
  "before-registration": {
    Icon: CalendarClock,
    wrapper:
      "border border-border/80 border-s-4 border-s-muted-foreground/60 bg-gradient-to-l from-muted to-muted/40 text-foreground",
    icon: "bg-muted-foreground text-background",
  },
  grace: { Icon: Hourglass, ...SIGNAL.warning },
  excused: { Icon: Leaf, ...SIGNAL.success },
  deferred: { Icon: FileClock, ...SIGNAL.info },
};

const CUSTOM = {
  Icon: StickyNote,
  wrapper:
    "border border-warning-line border-s-4 border-s-warning-vivid bg-warning-soft/80 text-warning",
  icon: "bg-warning-solid text-warning-on shadow-sm",
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
