/**
 * «مشاكل البوت»: a notebook of Telegram-bot problems per student. It lives
 * only in its own dashboard window — no audit log, no profile, no counter.
 */

export const BOT_PROBLEMS_PERMISSION = "bot-problems.manage";
export const BOT_PROBLEM_REASON_MAX = 500;

export type BotProblemStudent = {
  id: string;
  name: string;
  code: string;
  status: string;
  courseName: string;
  telegram: string;
  username: string;
};

export type BotProblem = {
  id: string;
  reason: string;
  createdAt: string;
  createdByName: string;
  resolvedAt: string | null;
  resolvedByName: string;
  student: BotProblemStudent;
};

/** A reason as typed, on one line, never empty and never too long. */
export function cleanBotProblemReason(value: unknown): string {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}
