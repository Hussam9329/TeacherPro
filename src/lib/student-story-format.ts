import { toBaghdadDateTimeLocal } from "@/lib/baghdad-time";
import { APP_MONTHS, formatAppTime } from "@/lib/format";

/** Gregorian month names as people say them here: «8 أكتوبر 2026». */
export const STORY_MONTHS = APP_MONTHS;

/** A piece of story text: bold for grades, exam names and dates; struck for
 * something that happened and was later cancelled. */
export type StoryPart = { t: string; b?: boolean; s?: boolean };

/** «2026-10-08» → «8 أكتوبر 2026». */
export function storyDay(dayKey: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(dayKey || ""));
  if (!match) return "";
  return `${Number(match[3])} ${STORY_MONTHS[Number(match[2]) - 1]} ${match[1]}`;
}

/** «14:20» → «2:20 م». */
export function storyTime(hhmm: string): string {
  return formatAppTime(hhmm);
}

/** The Baghdad day and minute of a stored timestamp. */
export function storyStamp(value: unknown): { at: string; dayKey: string; time: string } {
  const local = toBaghdadDateTimeLocal(value as string | Date | null | undefined);
  if (!local) return { at: "", dayKey: "", time: "" };
  return { at: local, dayKey: local.slice(0, 10), time: local.slice(11, 16) };
}

/** Values typed by people never carry the markup characters. */
export function storyValue(value: unknown): string {
  return String(value ?? "").replace(/[*~]/g, "").replace(/\s+/g, " ").trim();
}

/**
 * «**امتحان يومي 2**: غاب» → parts. `**x**` is bold, `~~x~~` is struck.
 */
export function storyParts(text: string): StoryPart[] {
  const parts: StoryPart[] = [];
  const pattern = /\*\*([^*]+)\*\*|~~([^~]+)~~/g;
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text))) {
    if (match.index > last) parts.push({ t: text.slice(last, match.index) });
    if (match[1] !== undefined) parts.push({ t: match[1], b: true });
    else parts.push({ t: match[2], s: true });
    last = match.index + match[0].length;
  }
  if (last < text.length) parts.push({ t: text.slice(last) });
  return parts.filter((part) => part.t);
}

export function storyPlain(parts: StoryPart[]): string {
  return parts.map((part) => part.t).join("");
}

/** WhatsApp formatting: *bold* and ~struck~. */
export function storyWhatsApp(parts: StoryPart[]): string {
  return parts
    .map((part) => (part.b ? `*${part.t.trim()}*` : part.s ? `~${part.t.trim()}~` : part.t))
    .join("");
}

/** «0» → «ما عنده ولا فرصة», «1» → «فرصة وحدة», «2» → «فرصتين». */
export function storyOpportunityCount(count: number): string {
  if (count <= 0) return "ولا فرصة";
  if (count === 1) return "فرصة وحدة";
  if (count === 2) return "فرصتين";
  return `${count} فرص`;
}

/** Simple standard Arabic for messages that leave the system. */
export function messageOpportunityCount(count: number): string {
  if (count <= 0) return "لا فرص";
  if (count === 1) return "فرصة واحدة";
  if (count === 2) return "فرصتان";
  if (count <= 10) return `${count} فرص`;
  return `${count} فرصة`;
}
