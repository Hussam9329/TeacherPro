export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { oversees, requirePermissionPrincipal } from "@/lib/server-auth";
import { routeErrorResponse, validationError } from "@/lib/route-helpers";
import { ARCHIVED_STUDENT_LOCKED_MESSAGE } from "@/lib/archived-student-guard";
import { ARCHIVED_STUDENT_STATUS } from "@/lib/student-delete-impact";
import { withSerializableTransaction } from "@/lib/serializable-transaction";
import { withStudentMutationToken } from "@/lib/student-mutation-token";
import { OPEN_BOT_EXAM_MESSAGE, TELEGRAM_UNLINK_NOTICE_HTML } from "@/lib/telegram-bot-session";
import { hasOpenBotExam } from "@/lib/telegram-bot-session-server";
import { sendTelegramMessage, telegramBotToken, telegramChatId } from "@/lib/telegram-bot";

const MODULE = "سجل الطلاب";
const ACTION = "إلغاء ربط تليگرام";

class TelegramUnlinkError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

/**
 * Unlinks one student from the Telegram account the exam bot knows them by:
 * clears the Telegram id and its unique key, keeps the username and phones,
 * and tells the student in the bot. Refused while the student has an exam
 * open in the bot, because the bot delivers that answer through this link.
 */
export async function POST(req: NextRequest) {
  const principal = await requirePermissionPrincipal(req, "students.edit");
  if (principal instanceof NextResponse) return principal;
  if (!oversees(principal)) {
    return validationError("إلغاء ربط تليگرام متاح لمدير النظام والمشرفين فقط.", 403);
  }

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const studentId = String(body.studentId || "").trim();
  if (!studentId || studentId.length > 128) return validationError("تعذر تحديد الطالب المطلوب.");
  if (typeof body.expectedTelegram !== "string") {
    return validationError("حدّث بيانات الطالب ثم أعد محاولة إلغاء الربط.");
  }
  const expectedTelegram = body.expectedTelegram.trim();

  try {
    if (await hasOpenBotExam(expectedTelegram)) return validationError(OPEN_BOT_EXAM_MESSAGE, 409);

    const result = await withSerializableTransaction(async (tx) => {
      const student = await tx.student.findUnique({ where: { id: studentId } });
      if (!student) throw new TelegramUnlinkError("الطالب غير موجود.", 404);
      // An archived student's file is frozen, like every other student edit.
      if (student.status === ARCHIVED_STUDENT_STATUS) throw new TelegramUnlinkError(ARCHIVED_STUDENT_LOCKED_MESSAGE, 409);

      const currentTelegram = String(student.telegram || "").trim();
      if (!currentTelegram && !student.telegramKey) return { student, previousTelegram: "" };
      // The exam check above ran against the account the screen showed.
      if (currentTelegram !== expectedTelegram) {
        throw new TelegramUnlinkError(
          "تغير حساب تليگرام المرتبط بعد فتح النافذة. حدّث بيانات الطالب ثم حاول مجدداً.",
          409,
        );
      }

      const updated = await tx.student.update({
        where: { id: studentId },
        data: { telegram: null, telegramKey: null },
      });
      await tx.auditLog.create({
        data: {
          module: MODULE,
          action: ACTION,
          details: JSON.stringify({
            studentId: updated.id,
            studentName: updated.name,
            studentCode: updated.code,
            previousTelegram: currentTelegram,
          }),
          userId: principal.id,
          userName: principal.name,
        },
      });
      return { student: updated, previousTelegram: currentTelegram };
    });

    // Best effort: the unlink already stands, so a failed message never undoes it.
    const token = telegramBotToken();
    const chatId = telegramChatId(result.previousTelegram);
    const noticeSent = Boolean(token && chatId) &&
      (await sendTelegramMessage({ token, chatId, html: TELEGRAM_UNLINK_NOTICE_HTML })).ok;

    const message = !result.previousTelegram
      ? "حساب تليگرام غير مرتبط بهذا الطالب أصلاً."
      : noticeSent
        ? "تم إلغاء ربط تليگرام، ووصلت الطالب رسالة بالبوت حتى يربط من جديد."
        : "تم إلغاء ربط تليگرام، بس ما وصلت الطالب رسالة بالبوت. بلّغه يفتح البوت ويرسل رقمه من جديد.";
    return NextResponse.json({
      ok: true,
      unlinked: true,
      alreadyUnlinked: !result.previousTelegram,
      noticeSent,
      student: withStudentMutationToken(result.student as unknown as Record<string, unknown>),
      message,
    });
  } catch (error) {
    if (error instanceof TelegramUnlinkError) return validationError(error.message, error.status);
    return routeErrorResponse(error, "تعذر إلغاء ربط حساب تليگرام حالياً.");
  }
}
