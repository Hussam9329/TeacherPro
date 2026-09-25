import { ownerHeaders } from "@/lib/outbox-session";
import { withReadDeadline } from "@/lib/read-deadline";

export type CodeClosureStudent = {
  id: string;
  name: string;
  code: string;
  username: string | null;
  telegram: string | null;
  status: string;
  dismissedChecked: boolean;
  dismissedCheckEpoch: number;
  courseId: string | null;
  course: { id: string; name: string } | null;
  dismissalReason: string | null;
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
};
