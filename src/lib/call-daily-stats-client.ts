import type { CallDailyStats } from "@/lib/call-daily-stats";

export type CallDailyStatsResponse = CallDailyStats & { day: string; today: string };

async function body<T>(response: Response, fallback: string): Promise<T> {
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(typeof data?.error === "string" ? data.error : fallback);
  if (!data) throw new Error(fallback);
  return data as T;
}

/** «إحصائيات المكالمات»: the admin's and the supervisors' daily view. */
export const callDailyStatsApi = {
  async get(day: string, signal?: AbortSignal): Promise<CallDailyStatsResponse> {
    const response = await fetch(`/api/student-calls/daily-stats?day=${encodeURIComponent(day)}`, {
      credentials: "same-origin",
      cache: "no-store",
      signal,
    });
    return body(response, "تعذر تحميل إحصائيات المكالمات. أعد المحاولة.");
  },
};
