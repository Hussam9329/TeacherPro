import { db } from "@/lib/db";
import { isMissingDatabaseObjectError } from "@/lib/route-helpers";
import { telegramChatId } from "@/lib/telegram-bot";
import { botDraftExamIds, botSessionHasOpenExam } from "@/lib/telegram-bot-session";

/**
 * Whether the student linked to this Telegram id has an exam open in the bot.
 * A saved value that is not a numeric Telegram id (an old username) has no bot
 * session, so it is never open. A read failure throws: the caller must refuse
 * rather than unlink blind.
 */
export async function hasOpenBotExam(savedTelegram: string | null | undefined): Promise<boolean> {
  const chatId = telegramChatId(savedTelegram);
  if (!chatId) return false;
  let rows: Array<{ data: unknown }>;
  try {
    rows = await db.$queryRaw<Array<{ data: unknown }>>`
      SELECT data FROM telebot_runtime_sessions WHERE user_id = ${BigInt(chatId)}`;
  } catch (error) {
    // The bot's table does not exist here (a database the bot never ran on).
    if (isMissingDatabaseObjectError(error)) return false;
    throw error;
  }
  const sessions = rows.map((row) => (typeof row.data === "string" ? safeParse(row.data) : row.data));
  const examIds = [...new Set(sessions.flatMap(botDraftExamIds))];
  const exams = examIds.length
    ? await db.exam.findMany({ where: { id: { in: examIds } }, select: { id: true, telegramCloseAt: true } })
    : [];
  const closeAtByExamId = Object.fromEntries(exams.map((exam) => [exam.id, exam.telegramCloseAt]));
  return sessions.some((session) => botSessionHasOpenExam(session, closeAtByExamId));
}

function safeParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
