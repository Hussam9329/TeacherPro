import { ownerHeaders } from "@/lib/outbox-session";
import { withReadDeadline } from "@/lib/read-deadline";

export type MirmazHoldStatus = "PENDING" | "RESOLVED" | "REJECTED";

export type MirmazStudentOption = {
  id: string;
  name: string;
  code: string;
  course: string;
  status?: string;
  matched: number;
  of: number;
  full: boolean;
};

export type MirmazExamOption = { id: string; name: string; date: string; fullMark: number };

export type MirmazHold = {
  id: string;
  answerId: string;
  status: MirmazHoldStatus;
  reason: string;
  reasonText: string;
  score: number;
  studentName: string;
  examName: string;
  examDate: string;
  examFullMark: number | null;
  correctedBy: string;
  candidates: MirmazStudentOption[];
  examCandidates: MirmazExamOption[];
  resolvedStudentName: string | null;
  resolvedExamName: string | null;
  resolvedByName: string | null;
  resolvedAt: string | null;
  createdAt: string;
};

export type MirmazHoldsResponse = { holds: MirmazHold[]; counts: Partial<Record<MirmazView, number>>; generatedAt: string };

/** «كل الدرجات» plus the three hold views. */
export type MirmazView = "ALL" | MirmazHoldStatus;

/** One grade that came from Mirmaz, as «كل الدرجات» shows it. */
export type MirmazLedgerRow = {
  answerId: string;
  /** SAVED: placed itself · RESOLVED: placed by hand · PENDING: waits · REJECTED: set aside */
  status: "SAVED" | MirmazHoldStatus;
  holdId: string | null;
  score: number;
  fullMark: number | null;
  studentName: string;
  tpStudentName: string | null;
  correctedBy: string;
  note: string;
  byName: string | null;
  at: string;
  /** The grade on the student in TeacherPro now (it may have been changed since). */
  current: { status: string; score: number | null } | null;
};

export type MirmazLedgerGroup = { key: string; title: string; date: string; fullMark: number | null; placed: boolean; rows: MirmazLedgerRow[] };

export type MirmazLedgerResponse = { groups: MirmazLedgerGroup[]; counts: Partial<Record<MirmazView | "SAVED", number>>; generatedAt: string };

/** A refusal that asks for a decision (e.g. replacing a grade already there). */
export class MirmazHoldError extends Error {
  constructor(message: string, readonly code?: string) {
    super(message);
  }
}

async function read<T>(url: string, fallbackError: string, signal?: AbortSignal): Promise<T> {
  return withReadDeadline(async (requestSignal) => {
    const response = await fetch(url, { credentials: "same-origin", cache: "no-store", signal: requestSignal, headers: ownerHeaders() });
    const data = await response.json().catch(() => null);
    if (!response.ok) throw new Error(data?.error || fallbackError);
    return data as T;
  }, signal);
}

async function patch(body: Record<string, unknown>, fallbackError: string): Promise<Record<string, unknown>> {
  const response = await fetch("/api/mirmaz-holds", {
    method: "PATCH",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json", ...ownerHeaders() },
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok || data?.ok !== true) throw new MirmazHoldError(data?.error || fallbackError, data?.code);
  return data;
}

export const mirmazHoldsApi = {
  all(signal?: AbortSignal): Promise<MirmazLedgerResponse> {
    return read("/api/mirmaz-holds?view=all", "تعذر تحميل درجات مرماز. أعد المحاولة.", signal);
  },
  list(status: MirmazHoldStatus, signal?: AbortSignal): Promise<MirmazHoldsResponse> {
    return read(`/api/mirmaz-holds?status=${status}`, "تعذر تحميل «مرماز برو». أعد المحاولة.", signal);
  },
  async searchStudents(name: string, signal?: AbortSignal): Promise<MirmazStudentOption[]> {
    const data = await read<{ students: MirmazStudentOption[] }>(`/api/mirmaz-holds?students=${encodeURIComponent(name)}`, "تعذر البحث عن الطالب.", signal);
    return data.students || [];
  },
  async examsNear(day: string, fullMark: number | null, signal?: AbortSignal): Promise<MirmazExamOption[]> {
    const query = new URLSearchParams({ examsNear: day });
    if (fullMark) query.set("fullMark", String(fullMark));
    const data = await read<{ exams: MirmazExamOption[] }>(`/api/mirmaz-holds?${query}`, "تعذر تحميل الامتحانات.", signal);
    return data.exams || [];
  },
  resolve(id: string, studentId: string, examId: string, confirmReplace = false) {
    return patch({ id, action: "resolve", studentId, examId, confirmReplace }, "تعذر حفظ الدرجة.");
  },
  reject(id: string) {
    return patch({ id, action: "reject" }, "تعذر ترك الدرجة.");
  },
};
