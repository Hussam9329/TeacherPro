import { ownerHeaders } from "@/lib/outbox-session";

export type DismissedCheckSnapshot = {
  id: string;
  status: string;
  dismissedChecked: boolean;
  dismissedCheckEpoch: number;
};

export async function saveDismissedCheck(studentId: string, checked: boolean, expectedChecked: boolean, expectedEpoch: number): Promise<DismissedCheckSnapshot> {
  // Never queue/replay a stale operator choice and never invoke academic student editing.
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout>;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      // Aborting does not prove whether the server committed. The manager
      // re-reads the authoritative value; this request is never sent twice.
      reject(new Error("تأخر تأكيد الحفظ. يجري التحقق من حالة اغلاق الكود."));
      controller.abort();
    }, 30_000);
  });
  const save = async () => {
    const response = await fetch("/api/students/dismissed-check", {
      method: "PUT", credentials: "same-origin",
      headers: { "Content-Type": "application/json", ...ownerHeaders() },
      body: JSON.stringify({ studentId, checked, expectedChecked, expectedEpoch }),
      signal: controller.signal,
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data?.error || "تعذر حفظ اغلاق كود الطالب.");
    if (!data?.student || data.student.id !== studentId ||
        typeof data.student.dismissedChecked !== "boolean" ||
        !Number.isSafeInteger(data.student.dismissedCheckEpoch)) {
      throw new Error("تعذر تأكيد حالة اغلاق الكود. يجري تحديثها من النظام.");
    }
    return data.student as DismissedCheckSnapshot;
  };
  try {
    return await Promise.race([save(), deadline]);
  } finally {
    clearTimeout(timer!);
  }
}
