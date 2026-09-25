import { ownerHeaders } from "@/lib/outbox-session";
import { withReadDeadline } from "@/lib/read-deadline";
import type { GracePeriodRange, GracePeriodRecord } from "@/lib/grace-periods";

export type GraceStudentSearchResult = {
  id: string;
  name: string;
  code: string;
  status: string;
  telegram: string;
  courseName: string;
};

export type GraceStudentCard = {
  id: string;
  name: string;
  code: string;
  status: string;
  createdAt: string;
  courseName: string;
};

export type GracePeriodsResponse = {
  student: GraceStudentCard;
  periods: GracePeriodRecord[];
  today: string;
};

export type GraceChangeAction = "create" | "update" | "cancel";

export type GraceChangeInput = {
  studentId: string;
  action: GraceChangeAction;
  periodId?: string;
  startDate?: string;
  endDate?: string;
  cancelReason?: string;
};

export type GraceAffectedExam = {
  examId: string;
  examName: string;
  examDate: string;
  examType: string;
  change: "enters" | "leaves";
  result: string;
  accountingChanged: boolean;
};

export type GraceProjectionSide = {
  opportunities: number;
  status: string;
  dismissalReason: string;
};

export type GraceChangePreview = {
  summary: string;
  proposed: GracePeriodRange | null;
  affectedExams: GraceAffectedExam[];
  projection: { current: GraceProjectionSide; projected: GraceProjectionSide } | null;
  previewToken: string;
};

export type GraceChangeResult = {
  ok: true;
  periodId: string;
  student: { opportunities: number; status: string } | null;
  affectedExams: number;
  periods: GracePeriodRecord[];
};

async function readJson(response: Response, fallback: string) {
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.error || fallback);
  return data;
}

async function postGrace<T>(body: Record<string, unknown>, fallback: string): Promise<T> {
  // A grace change is never queued or replayed: the operator confirms one
  // preview, and an uncertain save is re-read from the server instead.
  const response = await fetch("/api/grace-periods", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json", ...ownerHeaders() },
    body: JSON.stringify(body),
  });
  return readJson(response, fallback) as Promise<T>;
}

export const gracePeriodsApi = {
  search(query: string, signal?: AbortSignal): Promise<{ students: GraceStudentSearchResult[] }> {
    return withReadDeadline(async (requestSignal) => {
      const response = await fetch(`/api/grace-periods/search?q=${encodeURIComponent(query)}`, {
        credentials: "same-origin",
        cache: "no-store",
        signal: requestSignal,
        headers: ownerHeaders(),
      });
      return readJson(response, "تعذر البحث عن الطالب. أعد المحاولة.");
    }, signal);
  },
  load(studentId: string, signal?: AbortSignal): Promise<GracePeriodsResponse> {
    return withReadDeadline(async (requestSignal) => {
      const response = await fetch(`/api/grace-periods?studentId=${encodeURIComponent(studentId)}`, {
        credentials: "same-origin",
        cache: "no-store",
        signal: requestSignal,
        headers: ownerHeaders(),
      });
      return readJson(response, "تعذر تحميل فترات السماح. أعد المحاولة.");
    }, signal);
  },
  preview(input: GraceChangeInput): Promise<GraceChangePreview> {
    return postGrace({ ...input, mode: "preview" }, "تعذر معاينة التعديل.");
  },
  apply(input: GraceChangeInput & { previewToken: string }): Promise<GraceChangeResult> {
    return postGrace({ ...input, mode: "apply" }, "تعذر حفظ فترة السماح.");
  },
};
