/**
 * Sends one text message through the team's Telegram bot (the same bot the
 * students send their exams to, whose token Correction also uses). Server
 * only: the token never reaches the browser.
 *
 * Telegram only lets a bot write to a numeric chat id of someone who has
 * started it; an @username is never enough.
 */

export type TelegramSendOutcome =
  | { ok: true; messageId: number | null }
  | {
      ok: false;
      /** not_started: the student never started the bot (or the id is wrong). */
      reason: "not_started" | "blocked" | "deactivated" | "rate_limited" | "bad_token" | "failed";
      retryAfter?: number;
      description?: string;
    };

const SEND_TIMEOUT_MS = 15_000;

/** The bot token from the environment, or "" when it is not configured. */
export function telegramBotToken(env: Record<string, string | undefined> = process.env): string {
  return String(env.TELEGRAM_BOT_TOKEN ?? "").trim().replace(/^["']|["']$/g, "");
}

/** A private chat id is a positive whole number; anything else is not one. */
export function telegramChatId(value: unknown): string {
  const text = String(value ?? "").trim();
  return /^[1-9]\d{4,19}$/.test(text) ? text : "";
}

/** Reads Telegram's refusal into a reason the screen can explain. */
export function classifyTelegramFailure(status: number, description: string): Exclude<TelegramSendOutcome, { ok: true }>["reason"] {
  const text = description.toLowerCase();
  if (status === 429) return "rate_limited";
  if (status === 401 || status === 404) return "bad_token";
  if (status === 403 && text.includes("blocked")) return "blocked";
  if (status === 403 && text.includes("deactivated")) return "deactivated";
  if (status === 403 || (status === 400 && text.includes("chat not found"))) return "not_started";
  return "failed";
}

export async function sendTelegramMessage(input: {
  token: string;
  chatId: string;
  html: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
}): Promise<TelegramSendOutcome> {
  const fetchImplementation = input.fetch ?? globalThis.fetch;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), input.timeoutMs ?? SEND_TIMEOUT_MS);
  try {
    const response = await fetchImplementation(`https://api.telegram.org/bot${input.token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: input.chatId,
        text: input.html,
        parse_mode: "HTML",
        link_preview_options: { is_disabled: true },
      }),
      signal: controller.signal,
    });
    const payload = (await response.json().catch(() => null)) as {
      ok?: boolean;
      result?: { message_id?: number };
      error_code?: number;
      description?: string;
      parameters?: { retry_after?: number };
    } | null;
    if (response.ok && payload?.ok === true) {
      const messageId = Number(payload.result?.message_id);
      return { ok: true, messageId: Number.isSafeInteger(messageId) ? messageId : null };
    }
    const status = Number(payload?.error_code) || response.status;
    const description = String(payload?.description || "");
    const retryAfter = Number(payload?.parameters?.retry_after);
    return {
      ok: false,
      reason: classifyTelegramFailure(status, description),
      description: description.slice(0, 200),
      ...(Number.isFinite(retryAfter) && retryAfter > 0 ? { retryAfter } : {}),
    };
  } catch (error) {
    const aborted = (error as { name?: string } | null)?.name === "AbortError";
    return { ok: false, reason: "failed", description: aborted ? "timeout" : "network error" };
  } finally {
    clearTimeout(timeout);
  }
}
