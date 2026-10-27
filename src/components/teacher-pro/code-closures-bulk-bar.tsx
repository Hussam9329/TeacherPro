"use client";

import { useState } from "react";
import { Loader2, Radiation, Send, UserMinus, X } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import type { CodeClosureStudent } from "@/lib/code-closures-client";
import { studentApi } from "@/lib/api";
import { emitTeacherProDataChanged } from "@/lib/teacherpro-sync";
import { toast } from "@/lib/user-toast";

type Running = { kind: "bot" | "withdraw"; done: number; total: number } | null;
type Confirm = "bot" | "withdraw" | null;

/** Up to five names, then «و N غيرهم». */
function namesOf(students: CodeClosureStudent[]): string {
  const shown = students.slice(0, 5).map((student) => student.name).join("، ");
  return students.length > 5 ? `${shown} و${students.length - 5} غيرهم` : shown;
}

/**
 * The bulk actions of «اغلاق الكودات» for the selected cards:
 *  - «إغلاق بالمنصة»: a browser opens one tab per click, so each click opens
 *    the platform for the next selected student whose code is not closed yet;
 *  - «إرسال عبر البوت»: sends the notice to each one not sent yet, in turn;
 *  - «انسحاب»: withdraws the selected students whose code is closed.
 * Each student goes through the same single action, so its rules stay as they are.
 */
export function CodeClosuresBulkBar({
  selected,
  canManage,
  canWithdraw,
  platformDone,
  botSentAt,
  openPlatform,
  sendBotNotice,
  onWithdrawn,
  onClear,
}: {
  selected: CodeClosureStudent[];
  canManage: boolean;
  canWithdraw: boolean;
  platformDone: (student: CodeClosureStudent) => boolean;
  botSentAt: (student: CodeClosureStudent) => string | null;
  openPlatform: (student: CodeClosureStudent, button: Element) => void;
  /** Sends one notice; resolves with an error message, or null when sent. */
  sendBotNotice: (student: CodeClosureStudent) => Promise<string | null>;
  onWithdrawn: (studentIds: string[]) => void;
  onClear: () => void;
}) {
  const [running, setRunning] = useState<Running>(null);
  const [confirm, setConfirm] = useState<Confirm>(null);

  const platformQueue = selected.filter((student) => !platformDone(student));
  const nextPlatform = platformQueue[0];
  const botQueue = canManage
    ? selected.filter((student) => !botSentAt(student) && student.dismissalExamName && student.dismissalOutcome)
    : [];
  const withdrawQueue = canWithdraw ? selected.filter((student) => student.dismissedChecked) : [];
  const busy = running !== null;

  const runBot = async () => {
    const queue = [...botQueue];
    setRunning({ kind: "bot", done: 0, total: queue.length });
    const failed: string[] = [];
    for (const [index, student] of queue.entries()) {
      const error = await sendBotNotice(student);
      if (error) failed.push(`${student.name}: ${error}`);
      setRunning({ kind: "bot", done: index + 1, total: queue.length });
    }
    setRunning(null);
    const sent = queue.length - failed.length;
    if (sent) toast.success(`أرسل البوت التبليغ إلى ${sent} من ${queue.length} طالب.`);
    if (failed.length) toast.error(`ما انرسل إلى ${failed.length}: ${failed.slice(0, 3).join(" — ")}${failed.length > 3 ? " …" : ""}`);
  };

  const runWithdraw = async () => {
    const queue = [...withdrawQueue];
    setRunning({ kind: "withdraw", done: 0, total: queue.length });
    const done: string[] = [];
    const failed: string[] = [];
    for (const [index, student] of queue.entries()) {
      const result = await studentApi.withdraw(student.id);
      if (result.ok) done.push(student.id);
      else failed.push(`${student.name}: ${result.error || "تعذر تسجيل الانسحاب"}`);
      setRunning({ kind: "withdraw", done: index + 1, total: queue.length });
    }
    setRunning(null);
    if (done.length) {
      emitTeacherProDataChanged({
        source: "local-mutation",
        reason: "student-withdrawal",
        scopes: ["students", "follow-up", "dismissed", "dashboard"],
      });
      toast.success(`تم تسجيل انسحاب ${done.length} من ${queue.length} طالب وأرشفتهم.`);
      onWithdrawn(done);
    }
    if (failed.length) toast.error(`ما انسحب ${failed.length}: ${failed.slice(0, 3).join(" — ")}${failed.length > 3 ? " …" : ""}`);
  };

  if (!selected.length && !busy) return null;

  return (
    <div className="tp-closures__bulk" role="region" aria-label="الإجراءات الجماعية">
      <span className="tp-closures__bulk-count" aria-live="polite">
        {running
          ? `${running.kind === "bot" ? "جاري الإرسال" : "جاري الانسحاب"} ${running.done} من ${running.total}…`
          : `محدد ${selected.length}`}
      </span>
      <div className="tp-closures__bulk-actions">
        <button
          type="button"
          className="tp-closures__bulk-btn"
          data-tone="danger"
          disabled={busy || !nextPlatform}
          onClick={(event) => nextPlatform && openPlatform(nextPlatform, event.currentTarget)}
          title={nextPlatform ? `يفتح المنصة لـ${nextPlatform.name} وينسخ رقمه؛ كل ضغطة تفتح الطالب اللي بعده` : "فتحت المنصة لكل المحددين"}
        >
          <Radiation aria-hidden="true" />
          <span>
            {nextPlatform
              ? platformQueue.length === 1 ? `إغلاق بالمنصة: ${nextPlatform.name}` : `إغلاق بالمنصة: ${nextPlatform.name} (باقي ${platformQueue.length})`
              : "تم فتح المنصة للكل"}
          </span>
        </button>
        {canManage && (
          <button
            type="button"
            className="tp-closures__bulk-btn"
            data-tone="success"
            disabled={busy || !botQueue.length}
            onClick={() => setConfirm("bot")}
            title={botQueue.length ? "يرسل تبليغ الفصل لكل المحددين اللي ما انرسلهم بعد" : "انرسل لكل المحددين، أو ما معروف امتحانهم أو نتيجتهم"}
          >
            {running?.kind === "bot" ? <Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <Send aria-hidden="true" />}
            <span>إرسال عبر البوت ({botQueue.length})</span>
          </button>
        )}
        {canWithdraw && (
          <button
            type="button"
            className="tp-closures__bulk-btn"
            data-tone="withdraw"
            disabled={busy || !withdrawQueue.length}
            onClick={() => setConfirm("withdraw")}
            title={withdrawQueue.length ? "انسحاب المحددين المغلقة أكوادهم" : "الانسحاب بس للأكواد المغلقة"}
          >
            {running?.kind === "withdraw" ? <Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <UserMinus aria-hidden="true" />}
            <span>انسحاب ({withdrawQueue.length})</span>
          </button>
        )}
        <button type="button" className="tp-closures__bulk-clear" disabled={busy} onClick={onClear} aria-label="إلغاء التحديد" title="إلغاء التحديد">
          <X aria-hidden="true" />
        </button>
      </div>

      <AlertDialog open={confirm !== null} onOpenChange={(open) => { if (!open) setConfirm(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirm === "bot" ? `إرسال تبليغ الفصل إلى ${botQueue.length} طالب؟` : `انسحاب ${withdrawQueue.length} طالب؟`}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirm === "bot"
                ? `البوت يرسل التبليغ لـ: ${namesOf(botQueue)}.`
                : `راح تنضاف «انسحاب» لأسمائهم وينأرشفون: ${namesOf(withdrawQueue)}. تكدر ترجع أي واحد بـ«استعادة من الأرشيف».`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>إلغاء</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                const kind = confirm;
                setConfirm(null);
                void (kind === "bot" ? runBot() : runWithdraw());
              }}
              className={confirm === "withdraw" ? "bg-destructive text-destructive-foreground hover:bg-destructive/90" : undefined}
            >
              {confirm === "bot" ? <Send className="size-4" aria-hidden="true" /> : <UserMinus className="size-4" aria-hidden="true" />}
              {confirm === "bot" ? "إرسال" : "انسحاب"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
