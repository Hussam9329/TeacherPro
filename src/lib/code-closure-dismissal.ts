/**
 * Server-side pieces shared by the code-closures list and the bot notice:
 * which dismissal (exam and result) the notice names, and the audit line that
 * records a notice the bot sent.
 */

export type DismissalLog = {
  action: string;
  reason: string | null;
  date: Date;
  examId: string | null;
  exam: { name: string; fullMark: number } | null;
};

/** The automatic dismissal behind the recorded reason, else the latest one with an exam. */
export function dismissingExamLog(logs: DismissalLog[], dismissalReason: string | null): DismissalLog | null {
  const withExam = logs.filter((log) => log.action === "فصل تلقائي" && log.examId && log.exam);
  const recorded = `تلقائي: ${dismissalReason || ""}`.trim();
  return withExam.find((log) => String(log.reason || "").trim() === recorded) ||
    withExam.reduce<DismissalLog | null>((latest, log) => (!latest || log.date > latest.date ? log : latest), null);
}

/** «غياب», «غش» or «12 من 100»; null when neither the grade nor the reason says. */
export function dismissalOutcome(
  grade: { status: string; score: number | null } | undefined,
  log: DismissalLog,
): string | null {
  const fullMark = log.exam?.fullMark;
  if (grade?.status === "غائب") return "غياب";
  if (grade?.status === "غش") return "غش";
  if (grade?.status === "درجة" && typeof grade.score === "number") return `${grade.score} من ${fullMark}`;
  const reason = String(log.reason || "");
  if (reason.includes("غش")) return "غش";
  if (reason.includes("غياب")) return "غياب";
  const score = reason.match(/\((\d+)\)/)?.[1] ?? (reason.includes("درجة صفر") ? "0" : null);
  return score === null ? null : `${score} من ${fullMark}`;
}

/** «السجلات» line written when the bot delivered the notice. */
export const BOT_NOTICE_SENT_ACTION = "إرسال تبليغ الفصل عبر بوت تليكرام";
/** The same line after Telegram refused it, so it no longer counts as sent. */
export const BOT_NOTICE_FAILED_ACTION = "تعذر إرسال تبليغ الفصل عبر بوت تليكرام";

/** The student and dismissal episode a bot-notice line belongs to; null when it names none. */
export function readBotNoticeDetails(details: string | null | undefined): { studentId: string; epoch: number } | null {
  try {
    const parsed = JSON.parse(String(details || "")) as { studentId?: unknown; epoch?: unknown } | null;
    const studentId = typeof parsed?.studentId === "string" ? parsed.studentId : "";
    const epoch = parsed?.epoch;
    return studentId && typeof epoch === "number" && Number.isSafeInteger(epoch) ? { studentId, epoch } : null;
  } catch {
    return null;
  }
}
