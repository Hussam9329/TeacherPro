"use client";

import { ChevronDown } from "lucide-react";
import { useCallback, useState } from "react";
import { formatBaghdadDateTime } from "@/lib/baghdad-time";
import { studentDevicesApi, type StudentAppDevice } from "@/lib/api";

const PLATFORM_LABELS: Record<string, string> = { ios: "آيفون", android: "أندرويد" };

function platformLabel(value: string): string {
  return PLATFORM_LABELS[value.trim().toLowerCase()] || "جهاز";
}

type LoadState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "forbidden" }
  | { kind: "error" }
  | { kind: "ready"; devices: StudentAppDevice[] };

/** «أجهزة التطبيق»: the student's signed-in app devices with a revoke action.
 * Loaded only when the fold is opened, so a profile without that permission
 * never sees a request fail. */
export function StudentDevicesFold({ studentId }: { studentId: string }) {
  const [state, setState] = useState<LoadState>({ kind: "idle" });
  const [busyId, setBusyId] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setState((current) => (current.kind === "ready" ? current : { kind: "loading" }));
    const result = await studentDevicesApi.list(studentId);
    if (result.ok && result.data) setState({ kind: "ready", devices: result.data.devices ?? [] });
    else if (result.status === 403) setState({ kind: "forbidden" });
    else setState({ kind: "error" });
  }, [studentId]);

  const onToggle = (event: React.SyntheticEvent<HTMLDetailsElement>) => {
    if (event.currentTarget.open && state.kind === "idle") void reload();
  };

  const revoke = async (deviceId: string) => {
    setBusyId(deviceId);
    try {
      const result = await studentDevicesApi.revoke(deviceId);
      if (!result.ok) setState({ kind: "error" });
      else await reload();
    } finally {
      setBusyId(null);
    }
  };

  const devices = state.kind === "ready" ? state.devices : null;
  const activeCount = devices?.filter((d) => d.active).length ?? 0;
  const summary =
    state.kind === "ready" ? (activeCount ? `${activeCount} جهاز نشط` : "لا يوجد جهاز مرتبط")
    : state.kind === "loading" ? "جارٍ التحميل"
    : "افتح للاطلاع";

  return (
    <details className="tp-pf-fold" onToggle={onToggle}>
      <summary>
        <span className="min-w-0">
          <b>أجهزة التطبيق</b>
          <small>{summary}</small>
        </span>
        <ChevronDown className="tp-pf-fold__icon" aria-hidden="true" />
      </summary>
      <div className="mt-3 space-y-2">
        {state.kind === "forbidden" ? <p className="text-sm text-muted-foreground">غير متاح لصلاحيتك.</p> : null}
        {state.kind === "error" ? <p className="text-sm text-destructive">تعذر تحميل أجهزة التطبيق حالياً.</p> : null}
        {devices && devices.length === 0 ? (
          <p className="text-sm text-muted-foreground">لم يسجّل الطالب الدخول إلى التطبيق بعد.</p>
        ) : null}
        {devices?.map((device) => (
          <div key={device.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border bg-muted/40 px-3 py-2 text-sm">
            <span className="min-w-0">
              <b>{device.deviceName || platformLabel(device.platform)}</b>
              <span className="text-muted-foreground"> · {platformLabel(device.platform)}</span>
              <br />
              <small className="text-muted-foreground">
                {device.active
                  ? `آخر استخدام: ${formatBaghdadDateTime(device.lastSeenAt)}`
                  : `ملغى منذ: ${formatBaghdadDateTime(device.revokedAt)}`}
              </small>
            </span>
            {device.active ? (
              <button
                type="button"
                className="rounded-lg border px-3 py-1 text-sm hover:bg-muted disabled:opacity-60"
                disabled={busyId === device.id}
                onClick={() => void revoke(device.id)}
              >
                إلغاء الجهاز
              </button>
            ) : (
              <span className="text-xs text-muted-foreground">ملغى</span>
            )}
          </div>
        ))}
      </div>
    </details>
  );
}
