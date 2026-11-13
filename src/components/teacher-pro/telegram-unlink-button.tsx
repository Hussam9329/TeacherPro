"use client";

import { useState } from "react";
import { useTeacherStore } from "@/lib/teacher-store";
import { studentApi } from "@/lib/api";
import { emitTeacherProDataChanged } from "@/lib/teacherpro-sync";
import { getStudentRegistryCapabilities } from "./student-registry-helpers";

const BUTTON =
  "min-h-11 max-w-full touch-manipulation rounded-xl border px-3 py-2 text-sm font-black [overflow-wrap:anywhere] focus:outline-none focus:ring-2 disabled:opacity-60";

/**
 * «إلغاء ربط التليگرام»: frees the student from the Telegram account the exam
 * bot knows them by, so they can link again. Only the admin and the
 * supervisors see it, and only for a linked student. The server refuses while
 * the student has an exam open in the bot.
 */
export function TelegramUnlinkButton({ student, onUnlinked }: {
  student: { id: string; name: string; code?: string | null; telegram?: string | null };
  /** The open profile reloads itself here; a local change never refreshes it on its own. */
  onUnlinked?: () => void;
}) {
  const currentUser = useTeacherStore((state) => state.currentUser);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const telegram = String(student.telegram || "").trim();

  if (!getStudentRegistryCapabilities(currentUser()).isAdmin) return null;
  if (!telegram) {
    // Keep the outcome on screen after the refreshed profile drops the link.
    return result ? <p role="status" className="rounded-xl border bg-muted/40 px-3 py-2 text-xs font-bold">{result.text}</p> : null;
  }

  const unlink = async () => {
    setBusy(true);
    const response = await studentApi.unlinkTelegram(student.id, telegram);
    setBusy(false);
    setConfirming(false);
    const message = (response.data as { message?: string } | null)?.message;
    if (response.ok) {
      onUnlinked?.();
      emitTeacherProDataChanged({ reason: "إلغاء ربط تليگرام", scopes: response.syncScopes });
    }
    setResult(response.ok
      ? { ok: true, text: message || "تم إلغاء ربط تليگرام." }
      : { ok: false, text: response.error || "تعذر إلغاء ربط تليگرام حالياً." });
  };

  return (
    <div className="space-y-2">
      {confirming ? (
        <div role="alertdialog" aria-label="تأكيد إلغاء ربط التليگرام" className="space-y-2 rounded-xl border border-danger-line bg-danger-soft px-3 py-3 text-sm">
          <p className="font-bold text-danger">
            متأكد تريد تلغي ربط التليگرام للطالب {student.name}{student.code ? ` (${student.code})` : ""}؟ راح يحتاج يرسل رقمه للبوت حتى يربط من جديد.
          </p>
          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={busy} onClick={unlink} className={`${BUTTON} border-destructive/30 text-danger focus:ring-destructive/30`}>
              {busy ? "جاري إلغاء الربط…" : "نعم، ألغِ الربط"}
            </button>
            <button type="button" disabled={busy} onClick={() => setConfirming(false)} className={`${BUTTON} bg-background focus:ring-ring/30`}>
              رجوع
            </button>
          </div>
        </div>
      ) : (
        <button type="button" onClick={() => { setResult(null); setConfirming(true); }} className={`${BUTTON} border-destructive/30 text-danger focus:ring-destructive/30`}>
          إلغاء ربط التليگرام
        </button>
      )}
      {result ? (
        <p role={result.ok ? "status" : "alert"} className={`rounded-xl border px-3 py-2 text-xs font-bold ${result.ok ? "bg-muted/40" : "border-danger-line bg-danger-soft text-danger"}`}>
          {result.text}
        </p>
      ) : null}
    </div>
  );
}
