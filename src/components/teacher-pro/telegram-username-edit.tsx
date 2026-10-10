"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Check, Loader2, Pencil, X } from "lucide-react";
import { studentApi } from "@/lib/api";

type Props = {
  student: { id: string; name: string; username?: string | null };
  /** The saved username (or null when it was cleared). */
  onSaved: (username: string | null) => void;
};

/** The username as the server keeps it: no «@», no spaces; a number is not a username. */
function cleanUsername(value: string): string {
  return value.trim().replace(/^@+/, "").replace(/\s+/g, "");
}

/**
 * A quick edit of the student's Telegram username («يوزر تيليجرام»), right on
 * the card, without going to «سجل الطلاب». Only the username is saved, with
 * the registry's permission and log line, so it shows on the student's file.
 */
export function TelegramUsernameEdit({ student, onSaved }: Props) {
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

  const start = () => {
    setValue(String(student.username || "").replace(/^@+/, ""));
    setError("");
    setEditing(true);
  };

  const save = async () => {
    const username = cleanUsername(value);
    if (/^\d+$/.test(username)) {
      setError("اكتب اليوزر (حروف)، مو الرقم.");
      return;
    }
    if (username === cleanUsername(String(student.username || ""))) {
      setEditing(false);
      return;
    }
    setSaving(true);
    setError("");
    const result = await studentApi.updateTelegramUsername(student.id, username);
    setSaving(false);
    if (!result.ok) {
      setError(result.error || "تعذر حفظ اليوزر. حاول مرة ثانية.");
      return;
    }
    const saved = (result.data as { student?: { username?: string | null } } | undefined)?.student?.username;
    onSaved(saved !== undefined ? saved || null : username || null);
    setEditing(false);
  };

  if (!editing) {
    return (
      <button
        type="button"
        className="tp-tg-edit__open"
        onClick={start}
        aria-label={`تعديل معرف تيليجرام ${student.name}`}
        title="تعديل معرف تيليجرام"
      >
        <Pencil aria-hidden="true" />
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
      <label htmlFor={inputId} className="sr-only">يوزر تيليجرام {student.name}</label>
      <span className="tp-tg-edit__field" dir="ltr">
        <span aria-hidden="true">@</span>
        <input
          ref={inputRef}
          id={inputId}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          placeholder="username"
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          inputMode="text"
          disabled={saving}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
        />
      </span>
      <button type="submit" className="tp-tg-edit__save" disabled={saving} aria-label="حفظ اليوزر">
        {saving ? <Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <Check aria-hidden="true" />}
      </button>
      <button type="button" className="tp-tg-edit__cancel" disabled={saving} onClick={() => setEditing(false)} aria-label="إلغاء">
        <X aria-hidden="true" />
      </button>
      {error ? <p id={errorId} role="alert" className="tp-tg-edit__error">{error}</p> : null}
    </form>
  );
}
