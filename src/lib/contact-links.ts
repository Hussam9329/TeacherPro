import { sanitizePhoneInput } from "@/lib/format";
import { normalizeTelegramIdentifier } from "@/lib/student-utils";

/**
 * The one way every page turns a stored phone or Telegram value into a link
 * (it was written four times, and the copies disagreed on Arabic digits,
 * «t.me/» addresses and what to return when there is nothing to open).
 */

/** The phone as WhatsApp wants it: digits only, 07… becomes 9647…; "" when there is none. */
export function whatsappPhone(phone: string | null | undefined): string {
  const digits = sanitizePhoneInput(phone ?? "");
  if (!digits) return "";
  if (digits.startsWith("964")) return digits;
  if (digits.startsWith("0")) return `964${digits.slice(1)}`;
  return digits;
}

/** A WhatsApp chat with this number, or "" when there is no usable number. */
export function whatsappLink(phone: string | null | undefined): string {
  const digits = whatsappPhone(phone);
  return digits ? `https://wa.me/${encodeURIComponent(digits)}` : "";
}

/** The Telegram username in a stored value («@ali», «t.me/ali», «https://t.me/ali?x»), without «@». */
export function telegramUsername(value: string | null | undefined): string {
  return normalizeTelegramIdentifier(value ?? "")
    .replace(/^https?:\/\/t\.me\//i, "")
    .replace(/^t\.me\//i, "")
    .split(/[/?#]/)[0]
    .replace(/^@+/, "")
    .trim();
}

/**
 * A Telegram chat with this user, opened in the app rather than the web
 * version; "" for a numeric id, which cannot open a chat.
 */
export function telegramLink(value: string | null | undefined): string {
  const username = telegramUsername(value);
  if (!username || /^\d+$/.test(username)) return "";
  return `tg://resolve?domain=${encodeURIComponent(username)}`;
}
