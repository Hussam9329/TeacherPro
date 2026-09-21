import { ownerHeaders } from "@/lib/outbox-session";
import { withReadDeadline } from "@/lib/read-deadline";

export type DismissedCheckSnapshot = {
  id: string;
  status: string;
  dismissedChecked: boolean;
  dismissedCheckEpoch: number;
};

export async function readDismissedChecks(ids: string[], signal?: AbortSignal): Promise<DismissedCheckSnapshot[]> {
  if (!ids.length) return [];
  const params = new URLSearchParams();
  ids.forEach((id) => params.append("id", id));
  return withReadDeadline(async (requestSignal) => {
    const response = await fetch(`/api/students/dismissed-check?${params}`, {
      credentials: "same-origin", cache: "no-store", signal: requestSignal, headers: ownerHeaders(),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "تعذر تحميل حالة اغلاق كود الطلاب.");
    return data.students;
  }, signal, 15_000);
}

export async function saveDismissedCheck(studentId: string, checked: boolean, expectedChecked: boolean, expectedEpoch: number): Promise<DismissedCheckSnapshot> {
  // Never queue/replay a stale operator choice and never invoke academic student editing.
  const response = await fetch("/api/students/dismissed-check", {
    method: "PUT", credentials: "same-origin",
    headers: { "Content-Type": "application/json", ...ownerHeaders() },
    body: JSON.stringify({ studentId, checked, expectedChecked, expectedEpoch }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "تعذر حفظ اغلاق كود الطالب.");
  return data.student;
}
