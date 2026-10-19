"use client";

import { useRef, useState } from "react";
import { AlertCircle, Loader2, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { staleRecordsApi } from "@/lib/api";
import type { AcademicStaleRecord } from "@/lib/academic-types";
import { useTeacherStore } from "@/lib/teacher-store";
import { useShallow } from "zustand/react/shallow";
import { emitTeacherProDataChanged } from "@/lib/teacherpro-sync";
import { FormDialogHero } from "./form-dialog";
import { EmptyState } from "./ui-kit";

const FIX_BATCH = 100;

function side(record: AcademicStaleRecord["stored"]): string {
  const parts = [`${record.opportunities} فرص`];
  if (record.bonuses) parts.push(`${record.bonuses} مكافأة`);
  if (record.status && record.status !== "نشط") parts.push(record.status);
  return parts.join(" · ");
}

/**
 * «فحص الحسابات»: replays every student read-only and lists those whose
 * saved record differs from what a recalculation gives now (a result typed
 * into the database outside the app, or an input that changed without
 * recalculating them), then fixes them through the ordinary path.
 */
export function StaleRecordsDialog({ courseName, onFixed }: {
  courseName: (courseId: string) => string;
  onFixed?: () => void;
}) {
  const { currentUser } = useTeacherStore(
    useShallow((state) => ({ currentUser: state.currentUser, /* re-render when these change: */ users: state.users, currentUserId: state.currentUserId, isAuthenticated: state.isAuthenticated })),
  );
  const actor = currentUser();
  const allowed = Boolean(actor && (actor.username?.trim().toLowerCase() === "admin" ||
    actor.roleId === "role_admin" || actor.permissions?.includes("system.maintenance")));
  const [open, setOpen] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [scanned, setScanned] = useState(0);
  const [stale, setStale] = useState<AcademicStaleRecord[] | null>(null);
  const [fixing, setFixing] = useState(false);
  const [fixed, setFixed] = useState<{ healed: number; stillStale: number } | null>(null);
  const [error, setError] = useState("");
  const runRef = useRef(0);

  if (!allowed) return null;

  const scan = async (keepFixed = false) => {
    const run = ++runRef.current;
    setScanning(true);
    setScanned(0);
    setStale(null);
    if (!keepFixed) setFixed(null);
    setError("");
    const found: AcademicStaleRecord[] = [];
    let cursor: string | undefined;
    let total = 0;
    try {
      do {
        const page = await staleRecordsApi.scan(cursor);
        if (runRef.current !== run) return;
        if (!page) throw new Error("تعذر فحص الحسابات. حاول مرة ثانية.");
        total += page.scanned;
        found.push(...page.stale);
        setScanned(total);
        cursor = page.nextCursor || undefined;
      } while (cursor);
      setStale(found);
    } catch (cause) {
      if (runRef.current === run) setError(cause instanceof Error ? cause.message : "تعذر فحص الحسابات.");
    } finally {
      if (runRef.current === run) setScanning(false);
    }
  };

  const fixAll = async () => {
    if (!stale?.length) return;
    setFixing(true);
    setError("");
    let healed = 0;
    let still = 0;
    for (let index = 0; index < stale.length; index += FIX_BATCH) {
      const result = await staleRecordsApi.fix(stale.slice(index, index + FIX_BATCH).map((record) => record.studentId));
      if (!result.ok) {
        setError(result.error || "تعذر إصلاح بعض الطلاب. حاول مرة ثانية.");
        break;
      }
      const data = result.data as { healed?: unknown[]; stillStale?: unknown[] } | undefined;
      healed += data?.healed?.length || 0;
      still += data?.stillStale?.length || 0;
    }
    setFixing(false);
    setFixed({ healed, stillStale: still });
    emitTeacherProDataChanged({
      source: "local-mutation",
      reason: "stale-records-fix",
      scopes: ["opportunities", "opportunity-logs", "students", "dashboard"],
    });
    onFixed?.();
    void scan(true);
  };

  return (
    <>
      <Button type="button" variant="outline" onClick={() => { setOpen(true); void scan(); }}>
        <ShieldCheck aria-hidden="true" />
        فحص الحسابات
      </Button>
      <Dialog open={open} onOpenChange={(next) => { if (!next) { runRef.current += 1; setScanning(false); } setOpen(next); }}>
        <DialogContent dir="rtl" className="tp-form-dialog max-w-3xl">
          <FormDialogHero
            icon={ShieldCheck}
            title="فحص الحسابات"
            description="يحسب كل طالب من جديد بدون ما يغيّر شي، ويطلّع الطلاب اللي محفوظهم ما يطابق الحساب: فرص، مكافأة، أو حالة."
          />
          <div className="tp-form-dialog__body">
            {error ? (
              <div role="alert" className="tp-modal__error"><AlertCircle aria-hidden="true" /><p>{error}</p></div>
            ) : null}
            {scanning ? (
              <p className="tp-stale__progress" role="status">
                <Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden="true" /> جاري الفحص... فحصت {scanned} طالب
              </p>
            ) : null}
            {fixed ? (
              <p className="tp-btrace__fixed" role="status">
                انصلح {fixed.healed} طالب وانحفظ حسابهم{fixed.stillStale ? `، وبقى ${fixed.stillStale} ما انصلحوا` : ""}.
              </p>
            ) : null}
            {stale && !scanning ? (
              stale.length === 0 ? (
                <EmptyState compact icon={ShieldCheck} title={`كل الحسابات مطابقة (${scanned} طالب)`} />
              ) : (
                <>
                  <p className="tp-stale__lead">
                    {stale.length} طالب من {scanned} محفوظهم ما يطابق الحساب. «صلّح الكل» يعيد حسابهم بنفس طريقة حفظ الدرجة.
                  </p>
                  <ul className="tp-stale__list">
                    {stale.map((record) => (
                      <li key={record.studentId} className="tp-stale__row">
                        <div className="tp-stale__who">
                          <strong>{record.name}</strong>
                          <span>{record.code} · {courseName(record.courseId)}</span>
                        </div>
                        <div className="tp-stale__diff">
                          <span>المحفوظ: {side(record.stored)}</span>
                          <span data-tone="replay">الحساب: {side(record.replay)}</span>
                        </div>
                      </li>
                    ))}
                  </ul>
                </>
              )
            ) : null}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" disabled={scanning || fixing} onClick={() => void scan()}>
              افحص مرة ثانية
            </Button>
            {stale?.length ? (
              <Button type="button" disabled={scanning || fixing} onClick={() => void fixAll()}>
                {fixing ? <Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden="true" /> : null}
                صلّح الكل ({stale.length})
              </Button>
            ) : null}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
