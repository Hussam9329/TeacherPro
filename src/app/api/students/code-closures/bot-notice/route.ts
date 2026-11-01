export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requirePermissionPrincipal } from "@/lib/server-auth";
import { routeErrorResponse, validationError } from "@/lib/route-helpers";
import { withDatabaseSchema } from "@/lib/schema-readiness";
import { withSerializableTransaction } from "@/lib/serializable-transaction";
import { buildDismissalNotice, dismissalNoticeHtml } from "@/lib/code-closure-contact";
import {
  BOT_NOTICE_FAILED_ACTION,
  BOT_NOTICE_SENT_ACTION,
  dismissalOutcome,
  dismissingExamLog,
  readBotNoticeDetails,
} from "@/lib/code-closure-dismissal";
import { sendTelegramMessage, telegramBotToken, telegramChatId, type TelegramSendOutcome } from "@/lib/telegram-bot";

const MODULE = "سجل الطلاب";

const FAILURE_MESSAGES: Record<Exclude<TelegramSendOutcome, { ok: true }>["reason"], string> = {
  not_started: "الطالب لم يبدأ محادثة مع البوت بعد، لذلك لا يستطيع البوت مراسلته. استخدم زر المحادثة لإرسال التبليغ من حسابك.",
  blocked: "الطالب حظر البوت، لذلك لم يصله التبليغ. استخدم زر المحادثة لإرسال التبليغ من حسابك.",
  deactivated: "حساب الطالب في تليگرام محذوف أو معطّل.",
  rate_limited: "تليگرام طلب التمهل قليلاً. أعد المحاولة بعد لحظات.",
  bad_token: "رمز بوت تليگرام في TeacherPro غير صحيح. راجع إعداد TELEGRAM_BOT_TOKEN.",
  failed: "تعذر الوصول إلى تليگرام. تأكد من المحادثة قبل إعادة الإرسال حتى لا يصل التبليغ مرتين.",
};

/** Refusals caused by the student's own Telegram account, not by Telegram or our bot. */
const STUDENT_ACCOUNT_REFUSALS = new Set<Exclude<TelegramSendOutcome, { ok: true }>["reason"]>(["not_started", "blocked", "deactivated"]);
const TELEGRAM_ID_CLEARED_NOTE = " مُسح معرّف تليگرام (الآيدي) المحفوظ للطالب، ويبقى اليوزر.";

/**
 * The student's Telegram chat id: the numeric id saved on the student, else
 * the chat their latest exam reached the bot from (Correction keeps it in the
 * same database). "" when neither is known.
 */
async function findChatId(studentId: string, savedTelegram: string | null): Promise<string> {
  const saved = telegramChatId(savedTelegram);
  if (saved) return saved;
  try {
    const rows = await db.$queryRaw<Array<{ telegram_chat_id: string | null }>>`
      SELECT telegram_chat_id FROM correction.telegram_exam_submissions
      WHERE student_id = ${studentId}
      ORDER BY created_at DESC
      LIMIT 1`;
    return telegramChatId(rows[0]?.telegram_chat_id);
  } catch (error) {
    // Correction's table may not exist (a local database without it).
    console.error("[code-closures] Telegram chat id from Correction:", error);
    return "";
  }
}

/**
 * Sends the dismissal notice to one dismissed student through the bot, once
 * per dismissal episode. It never touches the student's status, the
 * closed-code flag, or anything academic; on success the card's Telegram
 * step is marked done.
 */
export async function POST(req: NextRequest) {
  const principal = await requirePermissionPrincipal(req, "students.edit");
  if (principal instanceof NextResponse) return principal;

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const studentId = typeof body?.studentId === "string" ? body.studentId.trim() : "";
  const epoch = body?.expectedEpoch;
  if (!studentId || studentId.length > 128) return validationError("تعذر تحديد الطالب المطلوب.");
  if (typeof epoch !== "number" || !Number.isSafeInteger(epoch) || epoch < 0) {
    return validationError("حدّث قائمة اغلاق الكودات ثم أعد المحاولة.", 409);
  }

  const token = telegramBotToken();
  if (!token) return validationError("بوت تليگرام غير مُعدّ في TeacherPro بعد (TELEGRAM_BOT_TOKEN).", 503);

  try {
    const student = await withDatabaseSchema(() => db.student.findUnique({
      where: { id: studentId },
      select: {
        id: true,
        name: true,
        code: true,
        status: true,
        telegram: true,
        dismissedCheckEpoch: true,
        dismissalReason: true,
        opportunityLogs: {
          where: { action: "فصل تلقائي" },
          select: { action: true, reason: true, date: true, examId: true, exam: { select: { name: true, fullMark: true } } },
        },
      },
    }), "Student");
    if (!student) return validationError("الطالب غير موجود.", 404);
    if (student.status !== "مفصول" || student.dismissedCheckEpoch !== epoch) {
      return validationError("تغيّرت حالة الطالب منذ فتح القائمة. حدّث القائمة ثم أعد المحاولة.", 409);
    }

    // The same exam and result the list shows; missing ones keep a placeholder,
    // which must be filled by hand, so the bot does not send them.
    const log = dismissingExamLog(student.opportunityLogs, student.dismissalReason);
    const grade = log?.examId
      ? await db.grade.findFirst({ where: { studentId: student.id, examId: log.examId }, select: { status: true, score: true } })
      : null;
    const examName = log?.exam?.name ?? null;
    const outcome = log ? dismissalOutcome(grade ?? undefined, log) : null;
    if (!examName || !outcome) {
      return validationError("اسم الامتحان أو نتيجة الطالب غير معروفة، لذلك لا يُرسل البوت التبليغ. استخدم زر المحادثة وأكمل التبليغ يدوياً.", 422);
    }

    const chatId = await findChatId(student.id, student.telegram);
    if (!chatId) return validationError(FAILURE_MESSAGES.not_started, 422);

    // Claim the send first, so two clicks (or two people) never send it twice.
    const claim = await withSerializableTransaction(async (tx) => {
      const current = await tx.student.findUnique({ where: { id: student.id }, select: { status: true, dismissedCheckEpoch: true } });
      if (!current || current.status !== "مفصول" || current.dismissedCheckEpoch !== epoch) return { conflict: "changed" as const };
      const earlier = await tx.auditLog.findMany({
        where: { module: MODULE, action: BOT_NOTICE_SENT_ACTION, details: { contains: `"studentId":${JSON.stringify(student.id)}` } },
        select: { details: true },
      });
      if (earlier.some((row) => readBotNoticeDetails(row.details)?.epoch === epoch)) return { conflict: "sent" as const };
      const line = await tx.auditLog.create({
        data: {
          module: MODULE,
          action: BOT_NOTICE_SENT_ACTION,
          userId: principal.id,
          userName: principal.name,
          details: JSON.stringify({ studentId: student.id, epoch, name: student.name, code: student.code, exam: examName, outcome }),
        },
        select: { id: true },
      });
      return { lineId: line.id };
    });
    if ("conflict" in claim) {
      return claim.conflict === "sent"
        ? validationError("أُرسل التبليغ لهذا الطالب عبر البوت مسبقاً.", 409)
        : validationError("تغيّرت حالة الطالب منذ فتح القائمة. حدّث القائمة ثم أعد المحاولة.", 409);
    }

    const sent = await sendTelegramMessage({ token, chatId, html: dismissalNoticeHtml(buildDismissalNotice(examName, outcome)) });
    if (!sent.ok) {
      // The student's saved numeric Telegram id is what the bot cannot reach:
      // clear it (and its unique key) so the card stops offering it and the
      // student links the right account again. The username stays.
      const savedId = telegramChatId(student.telegram);
      const clearedTelegramId = savedId && STUDENT_ACCOUNT_REFUSALS.has(sent.reason)
        ? await db.student.updateMany({
          where: { id: student.id, status: "مفصول", dismissedCheckEpoch: epoch, telegram: student.telegram },
          data: { telegram: null, telegramKey: null },
        }).then((result) => (result.count > 0 ? savedId : ""), (error: unknown) => {
          console.error("[code-closures] clearing the Telegram id after a refusal:", error);
          return "";
        })
        : "";
      // Keep the line for the record, but it no longer counts as sent.
      await db.auditLog.update({
        where: { id: claim.lineId },
        data: {
          action: BOT_NOTICE_FAILED_ACTION,
          details: JSON.stringify({
            studentId: student.id,
            epoch,
            name: student.name,
            code: student.code,
            reason: sent.reason,
            telegram: sent.description,
            ...(clearedTelegramId ? { clearedTelegramId } : {}),
          }),
        },
      }).catch((error: unknown) => console.error("[code-closures] bot notice failure line:", error));
      const status = sent.reason === "rate_limited" ? 429 : sent.reason === "failed" || sent.reason === "bad_token" ? 502 : 422;
      const message = FAILURE_MESSAGES[sent.reason] + (clearedTelegramId ? TELEGRAM_ID_CLEARED_NOTE : "");
      return NextResponse.json(
        { error: message, reason: sent.reason, telegramIdCleared: Boolean(clearedTelegramId) },
        { status, headers: { "Cache-Control": "no-store" } },
      );
    }

    // The card's Telegram step counts as done for this dismissal.
    await db.student.updateMany({
      where: { id: student.id, status: "مفصول", dismissedCheckEpoch: epoch },
      data: { closureTelegramEpoch: epoch },
    }).catch((error: unknown) => console.error("[code-closures] Telegram mark after the bot notice:", error));

    return NextResponse.json(
      { sent: true, studentId: student.id, dismissedCheckEpoch: epoch, botNoticeSentAt: new Date().toISOString() },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return routeErrorResponse(error, "تعذر إرسال التبليغ عبر البوت.");
  }
}
