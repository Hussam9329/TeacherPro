"use client";

import * as React from "react";
import { CalendarClock, CalendarDays } from "lucide-react";

import { formatAppDate, formatAppTime, parseAppDateInput } from "@/lib/format";
import { cn } from "@/lib/utils";

type NativeDateInputProps = Omit<
  React.ComponentProps<"input">,
  "type" | "value" | "defaultValue" | "onChange" | "readOnly"
>;

type DateInputProps = NativeDateInputProps & {
  value?: string | Date | null;
  onChange?: (value: string) => void;
};

function isoDateValue(value: DateInputProps["value"]): string {
  if (!value) return "";
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value.trim())) {
    return value.trim();
  }
  return parseAppDateInput(String(value), "");
}

function isoDateTimeValue(value: DateInputProps["value"]): string {
  if (!value) return "";
  const raw = String(value).trim();
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(raw) ? raw.slice(0, 16) : "";
}

/**
 * One date field for the whole system: it shows «20 سبتمبر 2026» with one
 * calendar icon, and the browser's own picker (calendar on a computer, wheel
 * on a phone) opens from anywhere on the field. The browser input sits on
 * top, invisible, so typing and the keyboard still work.
 */
function PickerField({
  kind,
  value,
  shown,
  onValue,
  className,
  placeholder,
  disabled,
  id,
  "aria-label": ariaLabel,
  ...props
}: NativeDateInputProps & {
  kind: "date" | "datetime-local";
  value: string;
  shown: string;
  onValue: (value: string) => void;
}) {
  const generatedId = React.useId();
  const controlId = id || generatedId;
  const Icon = kind === "date" ? CalendarDays : CalendarClock;

  const openPicker = (event: React.MouseEvent<HTMLInputElement>) => {
    if (disabled) return;
    const input = event.currentTarget as HTMLInputElement & { showPicker?: () => void };
    try {
      input.showPicker?.();
    } catch {
      // بعض المتصفحات ما تسمح بفتح المنتقي؛ يبقى الإدخال بالكيبورد متاحاً.
    }
  };

  return (
    <div data-slot="date-input" className="relative w-full max-w-full min-w-0">
      <input
        {...props}
        id={controlId}
        type={kind}
        autoComplete="off"
        value={value}
        disabled={disabled}
        aria-label={ariaLabel || placeholder}
        onClick={openPicker}
        onChange={(event) => onValue(event.target.value)}
        className="peer absolute inset-0 z-10 h-full w-full min-w-0 cursor-pointer appearance-none opacity-0 disabled:cursor-not-allowed [&::-webkit-calendar-picker-indicator]:absolute [&::-webkit-calendar-picker-indicator]:inset-0 [&::-webkit-calendar-picker-indicator]:h-full [&::-webkit-calendar-picker-indicator]:w-full [&::-webkit-calendar-picker-indicator]:cursor-pointer"
      />
      <div
        aria-hidden="true"
        className={cn(
          "border-input flex h-11 w-full max-w-full min-w-0 items-center gap-2 rounded-xl border bg-background/70 py-2 pe-1 ps-3.5 text-start text-sm shadow-xs transition-[color,box-shadow,border-color,background-color] peer-hover:border-ring/60 peer-focus-visible:border-ring peer-focus-visible:ring-[3px] peer-focus-visible:ring-ring/50 peer-aria-invalid:border-destructive peer-aria-invalid:ring-destructive/20 peer-disabled:opacity-50 dark:bg-input/30",
          className,
          props["aria-invalid"] && "border-destructive ring-destructive/20",
        )}
      >
        <span className={cn("min-w-0 flex-1 truncate", !shown && "text-muted-foreground")}>
          {shown || placeholder}
        </span>
        <span
          data-slot="date-input-trigger"
          className="touch-target inline-flex size-11 shrink-0 items-center justify-center rounded-lg text-muted-foreground"
        >
          <Icon className="size-4" />
        </span>
      </div>
    </div>
  );
}

function DateInput({ value, onChange, placeholder = "اختر التاريخ", ...props }: DateInputProps) {
  const normalizedValue = isoDateValue(value);
  return (
    <PickerField
      {...props}
      kind="date"
      placeholder={placeholder}
      value={normalizedValue}
      shown={normalizedValue ? formatAppDate(normalizedValue, "") : ""}
      onValue={(next) => onChange?.(/^\d{4}-\d{2}-\d{2}$/.test(next) ? next : "")}
    />
  );
}

/** «8 أكتوبر 2026 · 1:54 م»; the value stays the browser's 2026-10-08T13:54. */
function DateTimeInput({ value, onChange, placeholder = "اختر التاريخ والوقت", ...props }: DateInputProps) {
  const normalizedValue = isoDateTimeValue(value);
  return (
    <PickerField
      {...props}
      kind="datetime-local"
      placeholder={placeholder}
      value={normalizedValue}
      shown={
        normalizedValue
          ? `${formatAppDate(normalizedValue.slice(0, 10), "")} · ${formatAppTime(normalizedValue.slice(11, 16))}`
          : ""
      }
      onValue={(next) => onChange?.(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(next) ? next.slice(0, 16) : "")}
    />
  );
}

export { DateInput, DateTimeInput };
