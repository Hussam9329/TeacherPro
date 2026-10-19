/** Text of the exam-window push: name plus the close time in Baghdad. */
import type { PushMessage } from "./push-types.ts";

const BAGHDAD_OFFSET_MS = 3 * 60 * 60 * 1000;
const pad = (n: number) => String(n).padStart(2, "0");

function baghdad(date: Date): Date {
  return new Date(date.getTime() + BAGHDAD_OFFSET_MS);
}

/** «6:00 م» in Baghdad wall time. */
export function formatBaghdadClock(date: Date): string {
  const s = baghdad(date);
  const hours24 = s.getUTCHours();
  const hours12 = hours24 % 12 === 0 ? 12 : hours24 % 12;
  return `${hours12}:${pad(s.getUTCMinutes())} ${hours24 < 12 ? "ص" : "م"}`;
}

export function formatBaghdadDay(date: Date): string {
  const s = baghdad(date);
  return `${pad(s.getUTCDate())}/${pad(s.getUTCMonth() + 1)}/${s.getUTCFullYear()}`;
}

function sameBaghdadDay(a: Date, b: Date): boolean {
  return formatBaghdadDay(a) === formatBaghdadDay(b);
}

export function buildExamWindowMessage(exam: { id: string; name: string; telegramOpenAt: Date; telegramCloseAt: Date }): PushMessage {
  const clock = formatBaghdadClock(exam.telegramCloseAt);
  const when = sameBaghdadDay(exam.telegramOpenAt, exam.telegramCloseAt) ? "اليوم" : `يوم ${formatBaghdadDay(exam.telegramCloseAt)}`;
  return {
    title: `فتحت نافذة امتحان «${exam.name.trim()}»`,
    body: `يمكنك الإرسال الآن عبر @hfexam_bot. تغلق النافذة الساعة ${clock} ${when}.`,
    data: { kind: "exam-window", examId: exam.id },
  };
}
