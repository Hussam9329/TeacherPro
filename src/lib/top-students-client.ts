import { ownerHeaders } from "@/lib/outbox-session";
import { withReadDeadline } from "@/lib/read-deadline";
import type { TopStudentsAttendance, TopStudentsResult } from "@/lib/top-students";

export type TopStudentsQuery = {
  courseId: string;
  chapterId?: string;
  withFinals?: boolean;
  /** «آخر N امتحانات», or a date range when `range` is set. */
  last?: number;
  range?: { from: string; to: string };
  attendance: TopStudentsAttendance;
  limit: number;
  gender?: string;
  studyType?: string;
  courseProgram?: string;
  locationScope?: string;
};

export type TopStudentsResponse = TopStudentsResult & {
  course: { id: string; name: string };
  chapters: Array<{ id: string; name: string }>;
  generatedAt: string;
};

export function topStudentsSearch(query: TopStudentsQuery): string {
  const params = new URLSearchParams({ courseId: query.courseId, attendance: query.attendance, limit: String(query.limit) });
  if (query.chapterId) params.set("chapterId", query.chapterId);
  if (query.withFinals) params.set("types", "withFinals");
  if (query.range) {
    params.set("period", "range");
    if (query.range.from) params.set("from", query.range.from);
    if (query.range.to) params.set("to", query.range.to);
  } else {
    params.set("period", "last");
    params.set("last", String(query.last || 3));
  }
  for (const key of ["gender", "studyType", "courseProgram", "locationScope"] as const) {
    if (query[key]) params.set(key, query[key] as string);
  }
  return params.toString();
}

export const topStudentsApi = {
  load(query: TopStudentsQuery, signal?: AbortSignal): Promise<TopStudentsResponse> {
    return withReadDeadline(async (requestSignal) => {
      const response = await fetch(`/api/stats/top-students?${topStudentsSearch(query)}`, {
        credentials: "same-origin",
        cache: "no-store",
        signal: requestSignal,
        headers: ownerHeaders(),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.error || "تعذر تحميل الطلبة المتميزين. أعد المحاولة.");
      if (!Array.isArray(data?.rows)) throw new Error("تعذر قراءة الطلبة المتميزين. أعد المحاولة.");
      return data;
    }, signal);
  },
};
