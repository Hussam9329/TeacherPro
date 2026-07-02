"use client";

import * as React from "react";
import { CalendarDays } from "lucide-react";

import { parseAppDateInput } from "@/lib/format";
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
  className,
  placeholder = "اختر التاريخ",
  disabled,
  name,
  id,
  min,
  max,
  "aria-label": ariaLabel,
  ...props
}: DateInputProps) {
  const inputRef = React.useRef<HTMLInputElement | null>(null);
  const normalizedValue = isoDateValue(value);
  const generatedId = React.useId();
  const controlId = id || generatedId;

  const openPicker = React.useCallback(() => {
    if (disabled) return;
    const input = inputRef.current;
    if (!input) return;

    const pickerInput = input as HTMLInputElement & { showPicker?: () => void };
    input.focus();

    try {
      if (typeof pickerInput.showPicker === "function") {
        pickerInput.showPicker();
      }
    } catch {
      // بعض المتصفحات لا تسمح بفتح المنتقي إلا من تفاعل مباشر؛ يبقى الإدخال اليدوي متاحاً.
    }
  }, [disabled]);

  return (
    <div className="relative w-full">
      <input
        {...props}
        ref={inputRef}
        id={controlId}
        name={name}
        type="date"
        autoComplete="off"
        value={normalizedValue}
        min={min}
        max={max}
        disabled={disabled}
        aria-label={ariaLabel || placeholder}
        onChange={(event) => {
          const nextValue = event.target.value;
          onChange?.(/^\d{4}-\d{2}-\d{2}$/.test(nextValue) ? nextValue : "");
        }}
        className={cn(
          "border-input focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive flex h-10 w-full min-w-0 rounded-xl border bg-background/70 px-3.5 py-2 pl-10 text-sm shadow-xs backdrop-blur transition-[color,box-shadow,border-color,background-color] outline-none focus-visible:ring-[3px] disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50",
          className,
          props["aria-invalid"] && "border-destructive ring-destructive/20",
        )}
      />
      <button
        type="button"
        tabIndex={-1}
        disabled={disabled}
        aria-label={ariaLabel || placeholder}
        aria-controls={controlId}
        onClick={openPicker}
        className="absolute left-2 top-1/2 inline-flex size-7 -translate-y-1/2 items-center justify-center rounded-lg text-muted-foreground transition hover:bg-accent hover:text-accent-foreground disabled:pointer-events-none disabled:opacity-50"
      >
        <CalendarDays className="size-4" aria-hidden="true" />
      </button>
    </div>
  );
}

export { DateInput };
