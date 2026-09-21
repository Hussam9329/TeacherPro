"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CheckCheck, ClipboardList, Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { callNotesManagementApi, type ManagedCallNote } from "@/lib/call-notes-management-client";
import { emitTeacherProDataChanged } from "@/lib/teacherpro-sync";
import { toast } from "@/lib/user-toast";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  courseId: string;
  examId: string;
  examName: string;
  canManage: boolean;
};

function actionColor(status: string) {
  if (status === "تم الاتصال") return "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300";
  if (status === "لم يرد") return "bg-amber-500/10 text-amber-800 dark:text-amber-200";
  if (status === "الرقم خاطئ") return "bg-red-500/10 text-red-700 dark:text-red-300";
  return "bg-muted text-muted-foreground";
}

export function CallNotesManagementDialog({ open, onOpenChange, courseId, examId, examName, canManage }: Props) {
  const [notes, setNotes] = useState<ManagedCallNote[]>([]);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const [pendingIds, setPendingIds] = useState<Set<string>>(new Set());
  const pendingRef = useRef(new Set<string>());
  const activeRequestRef = useRef<AbortController | null>(null);
  const requestSequenceRef = useRef(0);
  const mutationVersionRef = useRef(0);
  const generationRef = useRef(0);

  const refresh = useCallback(async () => {
    if (!open || !courseId || !examId || pendingRef.current.size > 0) return;
    // A slow read must be allowed to finish, rather than being aborted at every
    // polling tick on a mobile connection.
    if (activeRequestRef.current && !activeRequestRef.current.signal.aborted) return;
    const controller = new AbortController();
    activeRequestRef.current = controller;
    const sequence = ++requestSequenceRef.current;
    const mutationVersion = mutationVersionRef.current;
    setLoading(true);
    try {
      const result = await callNotesManagementApi.list(courseId, examId, controller.signal);
      if (controller.signal.aborted || sequence !== requestSequenceRef.current ||
          mutationVersion !== mutationVersionRef.current) return;
      setNotes(result.notes);
      setLoaded(true);
      setError("");
    } catch (cause) {
      if (!controller.signal.aborted && sequence === requestSequenceRef.current) {
        setError(cause instanceof Error ? cause.message : "تعذر تحميل الملاحظات. أعد المحاولة.");
      }
    } finally {
      if (activeRequestRef.current === controller) activeRequestRef.current = null;
      if (sequence === requestSequenceRef.current) setLoading(false);
    }
  }, [open, courseId, examId]);

  useEffect(() => {
    generationRef.current += 1;
    setNotes([]);
    setLoaded(false);
    setLoading(false);
    setError("");
    if (!open) return;
    void refresh();
    // The ordinary background sync intentionally waits while dialogs are open.
    // Poll this small, read-only list directly so other users' checks reach it.
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, 5000);
    const onVisible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      generationRef.current += 1;
      requestSequenceRef.current += 1;
      activeRequestRef.current?.abort();
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, [open, refresh]);

  async function resolveNote(note: ManagedCallNote) {
    if (!canManage || pendingRef.current.has(note.id)) return;
    const generation = generationRef.current;
    pendingRef.current.add(note.id);
    setPendingIds(new Set(pendingRef.current));
    mutationVersionRef.current += 1;
    activeRequestRef.current?.abort();
    try {
      await callNotesManagementApi.resolve(note);
      if (generation === generationRef.current) {
        setNotes((current) => current.filter((item) => item.id !== note.id));
      }
      emitTeacherProDataChanged({
        source: "local-mutation",
        reason: "إنجاز ملاحظة المكالمات",
        scopes: ["follow-up", "students", "dashboard", "logs"],
        dispatchLocal: false,
      });
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "تعذر حفظ الإنجاز. أعد المحاولة.");
    } finally {
      mutationVersionRef.current += 1;
      pendingRef.current.delete(note.id);
      setPendingIds(new Set(pendingRef.current));
      // Reconcile both failed/uncertain requests and changes by another user.
      if (generation === generationRef.current) void refresh();
    }
  }

  const visibleNotes = notes.filter((note) => !pendingIds.has(note.id));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl gap-3 p-3 sm:p-5" dir="rtl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ClipboardList className="size-5 shrink-0 text-primary" aria-hidden="true" />
            إدارة ملاحظات المكالمات
          </DialogTitle>
          <p className="break-words text-sm text-muted-foreground">{examName}</p>
        </DialogHeader>

        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-sm font-semibold" aria-live="polite">
            {loaded ? `${visibleNotes.length} ملاحظة بانتظار الإجراء` : "الملاحظات"}
          </span>
          <Button type="button" variant="outline" size="sm" disabled={loading || pendingIds.size > 0} onClick={() => void refresh()}>
            <RefreshCw className={`size-4 ${loading ? "animate-spin" : ""}`} aria-hidden="true" />
            تحديث
          </Button>
        </div>

        {error && <p role="alert" className="rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{error}</p>}

        {!loaded && loading ? (
          <div className="flex min-h-40 items-center justify-center gap-2 text-sm text-muted-foreground" role="status">
            <Loader2 className="size-5 animate-spin" aria-hidden="true" />
            جاري تحميل الملاحظات...
          </div>
        ) : loaded && visibleNotes.length === 0 ? (
          <div className="flex min-h-40 flex-col items-center justify-center gap-3 rounded-2xl border border-dashed p-5 text-center">
            <CheckCheck className="size-9 text-emerald-600" aria-hidden="true" />
            <p className="text-sm font-semibold">{pendingIds.size > 0 ? "جاري حفظ الإنجاز..." : "لا توجد ملاحظات معلّقة"}</p>
          </div>
        ) : (
          <div className="space-y-2">
            <div aria-hidden="true" className="hidden grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)_minmax(0,2fr)_3rem] gap-3 rounded-xl bg-muted/60 px-4 py-2 text-xs font-semibold text-muted-foreground md:grid">
              <span>الطالب</span><span>الإجراء</span><span>الملاحظة</span><span className="text-center">تم</span>
            </div>
            {visibleNotes.map((note) => (
              <article key={note.id} className="grid min-w-0 grid-cols-[minmax(0,1fr)_2.75rem] gap-x-2 gap-y-3 rounded-2xl border bg-background/80 p-3 md:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)_minmax(0,2fr)_3rem] md:items-start md:gap-3 md:p-4">
                <div className="min-w-0">
                  <p className="break-words text-sm font-bold leading-6">{note.student.name}</p>
                  <span className="text-xs text-muted-foreground" dir="ltr">{note.student.code}</span>
                </div>
                <div className="col-start-1 row-start-2 md:col-start-2 md:row-start-1">
                  <span className={`inline-flex max-w-full rounded-lg px-2 py-1 text-xs font-semibold ${actionColor(note.contactStatus)}`}>
                    {note.contactStatus || "بدون إجراء"}
                  </span>
                </div>
                <div className="col-span-2 min-w-0 md:col-span-1 md:col-start-3 md:row-start-1">
                  <p className="mb-1 text-[11px] font-medium text-muted-foreground">
                    {note.scope === "general" ? "ملاحظة عامة سابقة" : examName}
                  </p>
                  <p className="whitespace-pre-wrap break-words text-sm leading-7 [overflow-wrap:anywhere]">{note.notes}</p>
                </div>
                <label className="col-start-2 row-start-1 flex min-h-11 cursor-pointer flex-col items-center justify-center gap-1 rounded-lg hover:bg-primary/5 md:col-start-4">
                  <Checkbox
                    checked={false}
                    disabled={!canManage}
                    onCheckedChange={(checked) => { if (checked === true) void resolveNote(note); }}
                    aria-label={`إنجاز ملاحظة ${note.student.name}: ${note.notes}`}
                    className="size-6 border-primary/50"
                  />
                  <span className="text-[10px] text-muted-foreground md:hidden">تم</span>
                </label>
              </article>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
