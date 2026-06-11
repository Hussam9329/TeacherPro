"use client";

import * as React from "react";

import { Input } from "@/components/ui/input";
import { formatAppDate, parseAppDateInput, toLatinDigits } from "@/lib/format";
import { cn } from "@/lib/utils";

type DateInputProps = Omit<
  React.ComponentProps<"input">,
  "type" | "value" | "defaultValue" | "onChange"
> & {
  value?: string | Date | null;
  onChange?: (value: string) => void;
};

function displayDate(value: DateInputProps["value"]): string {
  return formatAppDate(value, "");
}

function DateInput({
  value,
  onChange,
  onBlur,
  onFocus,
  className,
  placeholder = "2026/6/11",
  ...props
}: DateInputProps) {
  const [focused, setFocused] = React.useState(false);
  const [displayValue, setDisplayValue] = React.useState(() => displayDate(value));

  React.useEffect(() => {
    if (!focused) {
      setDisplayValue(displayDate(value));
    }
  }, [focused, value]);

  const commitDisplayValue = React.useCallback(
    (nextDisplayValue: string) => {
      const normalized = toLatinDigits(nextDisplayValue).trim();
      setDisplayValue(toLatinDigits(nextDisplayValue));

      if (!normalized) {
        onChange?.("");
        return;
      }

      const parsed = parseAppDateInput(normalized, "");
      if (parsed) {
        onChange?.(parsed);
      }
    },
    [onChange]
  );

  return (
    <Input
      {...props}
      type="text"
      inputMode="numeric"
      dir="ltr"
      placeholder={placeholder}
      value={displayValue}
      onFocus={(event) => {
        setFocused(true);
        onFocus?.(event);
      }}
      onChange={(event) => commitDisplayValue(event.target.value)}
      onBlur={(event) => {
        setFocused(false);
        const parsed = parseAppDateInput(displayValue, "");
        setDisplayValue(parsed ? formatAppDate(parsed, "") : displayDate(value));
        onBlur?.(event);
      }}
      className={cn("text-right [unicode-bidi:isolate]", className)}
    />
  );
}

export { DateInput };
