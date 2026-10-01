import { ownerHeaders } from "@/lib/outbox-session";
import { withReadDeadline } from "@/lib/read-deadline";
import type { ClosureContactStep } from "@/lib/code-closure-contact";

export type CodeClosureStudent = {
  id: string;
  name: string;
  code: string;
  phone: string | null;
  username: string | null;
  telegram: string | null;
  status: string;
  dismissedChecked: boolean;
  dismissedCheckEpoch: number;
  /** The dismissal episode (dismissedCheckEpoch) each contact step was done in. */
  closurePlatformEpoch: number | null;
  closureTelegramEpoch: number | null;
  courseId: string | null;
  course: { id: string; name: string } | null;
  dismissalReason: string | null;
  lastDismissalAt: string | null;
  dismissalExamName: string | null;
  dismissalOutcome: string | null;
};

export type CodeClosuresResponse = {
  students: CodeClosureStudent[];
  totalCount: number;
  checkedCount: number;
  uncheckedCount: number;
  generatedAt: string;
};

export const codeClosuresApi = {
  list(signal?: AbortSignal): Promise<CodeClosuresResponse> {
    // This is the complete current dismissed population, independent of the
    // registry page, its pagination, and its saved filters.
    return withReadDeadline(async (requestSignal) => {
      const response = await fetch("/api/students/code-closures", {
        credentials: "same-origin",
        cache: "no-store",
        signal: requestSignal,
        headers: ownerHeaders(),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error || "تعذر تحميل اغلاق الكودات. أعد المحاولة.");
      if (!Array.isArray(data?.students)) throw new Error("تعذر قراءة اغلاق الكودات. أعد المحاولة.");
      return data;
    }, signal);
  },
  async markContact(studentId: string, step: ClosureContactStep, expectedEpoch: number): Promise<void> {
    const response = await fetch("/api/students/code-closures/contact", {
      method: "PUT",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json", ...ownerHeaders() },
      body: JSON.stringify({ studentId, step, expectedEpoch }),
    });
    const data = await response.json().catch(() => null);
    if (!response.ok) throw new Error(data?.error || "تعذر حفظ علامة التواصل مع الطالب.");
  },
};
