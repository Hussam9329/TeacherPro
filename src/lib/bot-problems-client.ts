import { withReadDeadline } from "@/lib/read-deadline";
import type { BotProblem, BotProblemStudent } from "@/lib/bot-problems";

async function responseBody<T>(response: Response, fallback: string): Promise<T> {
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(typeof body?.error === "string" ? body.error : fallback);
  if (!body) throw new Error(fallback);
  return body as T;
}

export const botProblemsApi = {
  list(signal?: AbortSignal): Promise<{ problems: BotProblem[] }> {
    return withReadDeadline(async (readSignal) => {
      const response = await fetch("/api/bot-problems", { credentials: "same-origin", cache: "no-store", signal: readSignal });
      return responseBody(response, "تعذر تحميل مشاكل البوت. أعد المحاولة.");
    }, signal);
  },

  searchStudents(query: string, signal?: AbortSignal): Promise<{ students: BotProblemStudent[] }> {
    return withReadDeadline(async (readSignal) => {
      const response = await fetch(`/api/bot-problems/students?q=${encodeURIComponent(query)}`, {
        credentials: "same-origin",
        cache: "no-store",
        signal: readSignal,
      });
      return responseBody(response, "تعذر البحث عن الطالب. أعد المحاولة.");
    }, signal);
  },

  async add(studentId: string, reason: string): Promise<{ problem: BotProblem }> {
    const response = await fetch("/api/bot-problems", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ studentId, reason }),
    });
    return responseBody(response, "تعذر حفظ المشكلة. أعد المحاولة.");
  },

  async setResolved(id: string, resolved: boolean): Promise<{ problem: BotProblem }> {
    const response = await fetch("/api/bot-problems", {
      method: "PATCH",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, resolved }),
    });
    return responseBody(response, "تعذر تحديث المشكلة. أعد المحاولة.");
  },
};
