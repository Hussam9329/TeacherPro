"use client";

import { useState } from "react";
import { LockKeyholeOpen, Radiation } from "lucide-react";
import { codeClosuresApi } from "@/lib/code-closures-client";
import { canUseStudentCodeButtons, isStudentCodeClosed } from "@/lib/code-closure-contact";
import { openMzCodePage } from "@/lib/code-closure-open";
import { useTeacherStore } from "@/lib/teacher-store";
import { emitTeacherProDataChanged } from "@/lib/teacherpro-sync";
import { toast } from "@/lib/user-toast";
import "./student-code-buttons.css";

export type StudentCodeButtonsStudent = {
  id: string;
  name: string;
  phone?: string | null;
  status: string;
  dismissedChecked?: boolean | null;
  dismissedCheckEpoch?: number | null;
  closurePlatformEpoch?: number | null;
};

/**
 * ☢️ «إغلاق الكود» and the green «فتح الكود» on every card of a dismissed
 * student, doing exactly what the «اغلاق الكودات» window does. Only one is
 * enabled at a time: ☢️ while the code is open, the green one once it is closed.
 */
export function StudentCodeButtons({ student }: { student: StudentCodeButtonsStudent }) {
  const allowed = useTeacherStore((state) => canUseStudentCodeButtons(state.currentUser()));
  // What this card just did, until the refreshed student arrives from the server.
  const saved = `${student.dismissedCheckEpoch ?? 0}:${student.closurePlatformEpoch ?? ""}:${student.dismissedChecked === true}`;
  const [local, setLocal] = useState<{ saved: string; closed: boolean } | null>(null);
  const [pending, setPending] = useState(false);

  if (student.status !== "مفصول") return null;
  const closed = local?.saved === saved ? local.closed : isStudentCodeClosed(student);
  const epoch = student.dismissedCheckEpoch ?? 0;

  async function press(action: "close" | "open", button: Element) {
    if (!allowed || pending) return;
    openMzCodePage(student, action, button);
    setPending(true);
    setLocal({ saved, closed: action === "close" });
    try {
      if (action === "close") await codeClosuresApi.markContact(student.id, "platform", epoch);
      else await codeClosuresApi.reopenCode(student.id, epoch);
      emitTeacherProDataChanged({
        source: "local-mutation",
        reason: action === "close" ? "إغلاق كود الطالب" : "فتح كود الطالب",
        scopes: ["students", "dashboard", "logs"],
        dispatchLocal: true,
      });
    } catch (cause) {
      setLocal(null);
      toast.error(cause instanceof Error ? cause.message : "تعذر حفظ حالة كود الطالب.");
    } finally {
      setPending(false);
    }
  }

  const locked = !allowed || pending;
  return (
    <span className="tp-code-buttons" role="group" aria-label={`كود ${student.name}`}>
      <button
        type="button"
        className="tp-code-buttons__close"
        data-done={closed || undefined}
        disabled={locked || closed}
        onClick={(event) => void press("close", event.currentTarget)}
        aria-label={closed ? `كود ${student.name} مغلق` : `إغلاق كود ${student.name} على المنصة ونسخ رقم هاتفه`}
        title={!allowed ? "للأدمن والمشرف فقط" : closed ? "الكود مغلق؛ افتحه بالزر الأخضر حتى تگدر تغلقه مرة ثانية" : "إغلاق الكود: يفتح المنصة وينسخ رقم الطالب"}
      >
        <Radiation aria-hidden="true" />
      </button>
      <button
        type="button"
        className="tp-code-buttons__open"
        disabled={locked || !closed}
        onClick={(event) => void press("open", event.currentTarget)}
        aria-label={closed ? `فتح كود ${student.name} على المنصة ونسخ رقم هاتفه` : `كود ${student.name} مفتوح`}
        title={!allowed ? "للأدمن والمشرف فقط" : closed ? "فتح الكود: يفتح المنصة وينسخ رقم الطالب" : "الكود مفتوح"}
      >
        <LockKeyholeOpen aria-hidden="true" />
      </button>
    </span>
  );
}
