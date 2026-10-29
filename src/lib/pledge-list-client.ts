import { ownerHeaders } from "@/lib/outbox-session";
import { withReadDeadline } from "@/lib/read-deadline";
import type { PledgeListRow } from "@/lib/pledge-limit";

export type PledgeListQuery = {
  courseIds: string;
  chapter: "active" | "all";
  count: string;
  status: string;
  q: string;
  sort: "count" | "last" | "name";
};

export type PledgeListResponse = {
  rows: PledgeListRow[];
  totalStudents: number;
  totalPledges: number;
  limitReached: number;
  limit: number;
};

/** «قائمة التعهدات». */
export function loadPledgeList(query: PledgeListQuery, signal?: AbortSignal): Promise<PledgeListResponse> {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) if (value) params.set(key, value);
  return withReadDeadline(async (requestSignal) => {
    const response = await fetch(`/api/opportunities/pledges?${params}`, {
      credentials: "same-origin",
      cache: "no-store",
      signal: requestSignal,
      headers: ownerHeaders(),
    });
    const data = await response.json().catch(() => null);
    if (!response.ok) throw new Error(data?.error || "تعذر تحميل قائمة التعهدات. أعد المحاولة.");
    if (!Array.isArray(data?.rows)) throw new Error("تعذر قراءة قائمة التعهدات. أعد المحاولة.");
    return data;
  }, signal);
}
