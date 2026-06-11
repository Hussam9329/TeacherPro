"use client";

import * as React from "react";
import { CalendarDays } from "lucide-react";

import { formatAppDate, parseAppDateInput } from "@/lib/format";
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

function DateInput({
  value,
  onChange,
  onBlur,
  onFocus,
  className,
  placeholder = "اختر التاريخ",
  disabled,
  required,
  name,
  id,
  min,
  max,
  "aria-label": ariaLabel,
  ...props
}: DateInputProps) {
  const inputRef = React.useRef<HTMLInputElement | null>(null);
  const normalizedValue = isoDateValue(value);
  const displayValue = normalizedValue ? formatAppDate(normalizedValue, "") : "";
  const generatedId = React.useId();
  const controlId = id || generatedId;

  const openPicker = React.useCallback(() => {
    if (disabled) return;
    const input = inputRef.current;
    if (!input) return;

    const pickerInput = input as HTMLInputElement & { showPicker?: () => void };

    try {
      if (typeof pickerInput.showPicker === "function") {
        pickerInput.showPicker();
        return;
      }
    } catch {
      // بعض المتصفحات تمنع showPicker في حالات محددة، فنستخدم focus/click كبديل آمن.
    }

    input.focus();
    input.click();
  }, [disabled]);

  return (
    <div className={cn("relative", className)}>
      <input
        {...props}
        ref={inputRef}
        id={controlId}
        name={name}
        type="date"
        value={normalizedValue}
        min={min}
        max={max}
        disabled={disabled}
        required={required}
        aria-label={ariaLabel || placeholder}
        tabIndex={-1}
        onFocus={onFocus}
        onBlur={onBlur}
        onKeyDown={(event) => {
          // لا نسمح بكتابة نص داخل التاريخ. الاختيار يكون من زر التقويم فقط.
          event.preventDefault();
        }}
        onChange={(event) => {
          const nextValue = event.target.value;
          onChange?.(/^\d{4}-\d{2}-\d{2}$/.test(nextValue) ? nextValue : "");
        }}
        className="pointer-events-none absolute inset-0 h-px w-px opacity-0"
      />

      <button
        type="button"
        disabled={disabled}
        aria-label={ariaLabel || placeholder}
        aria-controls={controlId}
        onClick={openPicker}
        className={cn(
          "border-input focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive flex h-10 w-full min-w-0 items-center justify-between gap-3 rounded-xl border bg-background/70 px-3.5 py-2 text-sm shadow-xs backdrop-blur transition-[color,box-shadow,border-color,background-color] outline-none focus-visible:ring-[3px] disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50",
          props["aria-invalid"] && "border-destructive ring-destructive/20",
        )}
      >
        <span className={cn("truncate text-right [unicode-bidi:isolate]", !displayValue && "text-muted-foreground")} dir="ltr">
          {displayValue || placeholder}
        </span>
        <CalendarDays className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      </button>
    </div>
  );
}

export { DateInput };
