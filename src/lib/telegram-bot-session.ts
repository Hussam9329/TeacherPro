/**
 * Reads what the Telegram exam bot has saved for one Telegram account. The bot
 * keeps each account's exam progress in `telebot_runtime_sessions`, in this
 * same database, so TeacherPro can tell whether an answer is still on its way
 * before it breaks the link the bot needs to deliver that answer. Pure: the
 * database read lives in telegram-bot-session-server.ts.
 */

/** The bot still accepts a started answer for this long after the exam closes. */
export const BOT_EXAM_GRACE_MS = 10 * 60 * 1000;

export const OPEN_BOT_EXAM_MESSAGE =
  "الطالب عنده امتحان مفتوح بالبوت، لازم يكمل التسليم أولاً وبعدها نلغي الربط.";

/** What the student reads in the bot once staff unlink the account. */
export const TELEGRAM_UNLINK_NOTICE_HTML =
  "⚠️ تم إلغاء ربط حسابك بالبوت من قبل الإدارة.\n" +
  "حتى ترجع تستخدم البوت، اضغط /start وارسل رقم هاتفك المسجل حتى تنربط من جديد.";

type BotDraft = { exam_pages?: unknown; pending_upload?: unknown };

function hasItems(value: unknown): boolean {
  if (Array.isArray(value)) return value.length > 0;
  return Boolean(value && typeof value === "object" && Object.keys(value).length > 0);
}

/**
 * The exam ids of every answer this account has started in the bot: the one in
 * progress, plus the drafts set aside. Used to load their closing times.
 */
export function botDraftExamIds(data: unknown): string[] {
  if (!data || typeof data !== "object") return [];
  const session = data as Record<string, unknown>;
  const ids = new Set<string>();
  if (typeof session.active_exam_id === "string" && session.active_exam_id) ids.add(session.active_exam_id);
  if (session.paused_drafts && typeof session.paused_drafts === "object") {
    Object.keys(session.paused_drafts).forEach((id) => ids.add(id));
  }
  return [...ids];
}

/**
 * True when unlinking now would strand an answer: one being sent, one whose
 * saved pages the bot has yet to deliver, or one whose exam can still be
 * answered. A started exam that closed with no pages saved does not count, or
 * the student could never be unlinked.
 */
export function botSessionHasOpenExam(
  data: unknown,
  closeAtByExamId: Record<string, Date | null | undefined>,
  now: number = Date.now(),
): boolean {
  if (!data || typeof data !== "object") return false;
  const session = data as Record<string, unknown>;
  if (session.is_submitting || hasItems(session.pending_submission) || hasItems(session.pending_expired_draft)) return true;

  const drafts: Array<[string, BotDraft]> = [];
  if (typeof session.active_exam_id === "string" && session.active_exam_id) {
    drafts.push([session.active_exam_id, session as BotDraft]);
  }
  if (session.paused_drafts && typeof session.paused_drafts === "object") {
    for (const [examId, draft] of Object.entries(session.paused_drafts as Record<string, unknown>)) {
      drafts.push([examId, (draft && typeof draft === "object" ? draft : {}) as BotDraft]);
    }
  }
  return drafts.some(([examId, draft]) => {
    if (hasItems(draft.exam_pages) || hasItems(draft.pending_upload)) return true;
    const closeAt = closeAtByExamId[examId];
    return Boolean(closeAt) && now < closeAt!.getTime() + BOT_EXAM_GRACE_MS;
  });
}
