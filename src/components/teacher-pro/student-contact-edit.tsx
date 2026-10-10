"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Check, Loader2, Pencil, X } from "lucide-react";
import { studentApi } from "@/lib/api";
import { getPhoneValidationError, sanitizePhoneInput } from "@/lib/format";
import { emitTeacherProDataChanged } from "@/lib/teacherpro-sync";

export type StudentContactField = "username" | "phone" | "parentPhone";

const FIELDS: Record<StudentContactField, { label: string; placeholder: string; prefix: string; inputMode: "text" | "tel" }> = {
  username: { label: "معرف تيليجرام", placeholder: "username", prefix: "@", inputMode: "text" },
  phone: { label: "رقم الطالب", placeholder: "07XXXXXXXXX", prefix: "", inputMode: "tel" },
  parentPhone: { label: "رقم ولي الأمر", placeholder: "07XXXXXXXXX", prefix: "", inputMode: "tel" },
};

type Props = {
  student: { id: string; name: string; username?: string | null; phone?: string | null; parentPhone?: string | null };
  field: StudentContactField;
  /** The saved value (or null when a username was cleared). */
  onSaved?: (value: string | null) => void;
  /** Words on the button when the field is empty, so a missing number can be added. */
  emptyLabel?: string;
};

/** The value as the server keeps it. */
function cleanValue(field: StudentContactField, value: string): string {
  return field === "username"
    ? value.trim().replace(/^@+/, "").replace(/\s+/g, "")
    : sanitizePhoneInput(value);
}

/**
 * A quick edit of one contact of the student — the Telegram username, the
 * student's number or the parent's number — right on the card, without going
 * through the full edit in «سجل الطلاب». Only that field is saved, with the
 * registry's permission and log line, so it shows on the student's file.
 */
export function StudentContactEdit({ student, field, onSaved, emptyLabel }: Props) {
  const config = FIELDS[field];
  const stored = String(student[field] || "");
  // What this edit saved, until the card's own data catches up.
  const [saved, setSaved] = useState<string | null>(null);
  const current = saved ?? stored;
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);
  const inputId = useId();
  const errorId = `${inputId}-error`;

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);
  useEffect(() => {
    setSaved(null);
  }, [stored]);

  const start = () => {
    setValue(field === "username" ? current.replace(/^@+/, "") : current);
    setError("");
    setEditing(true);
  };

  const save = async () => {
    const next = cleanValue(field, value);
    if (field === "username" && /^\d+$/.test(next)) {
      setError("اكتب اليوزر (حروف)، مو الرقم.");
      return;
    }
    if (field !== "username") {
      const phoneError = getPhoneValidationError(value.replace(/[\s-]/g, ""), config.label, true);
      if (phoneError) {
        setError(phoneError);
        return;
      }
    }
    if (next === cleanValue(field, current)) {
      setEditing(false);
      return;
    }
    setSaving(true);
    setError("");
    const result = await studentApi.updateContact(student.id, field, next);
    setSaving(false);
    if (!result.ok) {
      setError(result.error || "تعذر الحفظ. حاول مرة ثانية.");
      return;
    }
    const returned = (result.data as { student?: Record<string, string | null | undefined> } | undefined)?.student?.[field];
    const savedValue = returned !== undefined ? returned || null : next || null;
    setSaved(savedValue || "");
    onSaved?.(savedValue);
    setEditing(false);
    emitTeacherProDataChanged({
      source: "local-mutation",
      reason: "student-contact-edit",
      scopes: ["students", "follow-up", "dismissed", "dashboard"],
      dispatchLocal: true,
    });
  };

  if (!editing) {
    return (
      <button
        type="button"
        className="tp-tg-edit__open"
        data-labelled={!current && emptyLabel ? "true" : undefined}
        onClick={start}
        aria-label={`تعديل ${config.label} ${student.name}`}
        title={`تعديل ${config.label}`}
      >
        <Pencil aria-hidden="true" />
        {!current && emptyLabel ? <span>{emptyLabel}</span> : null}
      </button>
    );
  }

  return (
    <form
      className="tp-tg-edit"
      onSubmit={(event) => { event.preventDefault(); void save(); }}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.stopPropagation();
          setEditing(false);
        }
      }}
    >
      <label htmlFor={inputId} className="sr-only">{config.label} {student.name}</label>
      <span className="tp-tg-edit__field" dir="ltr">
        {config.prefix ? <span aria-hidden="true">{config.prefix}</span> : null}
        <input
          ref={inputRef}
          id={inputId}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          placeholder={config.placeholder}
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          inputMode={config.inputMode}
          disabled={saving}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
        />
      </span>
      <button type="submit" className="tp-tg-edit__save" disabled={saving} aria-label={`حفظ ${config.label}`}>
        {saving ? <Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <Check aria-hidden="true" />}
      </button>
      <button type="button" className="tp-tg-edit__cancel" disabled={saving} onClick={() => setEditing(false)} aria-label="إلغاء">
        <X aria-hidden="true" />
      </button>
      {error ? <p id={errorId} role="alert" className="tp-tg-edit__error">{error}</p> : null}
    </form>
  );
}
