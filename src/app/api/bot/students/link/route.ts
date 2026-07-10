export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireBotToken } from "@/lib/bot-integration-auth";
import { sanitizePhoneInput } from "@/lib/format";
import { normalizeTelegramIdentifier, sanitizeTelegramInput } from "@/lib/student-utils";
import { routeErrorResponse, validationError } from "@/lib/route-helpers";
import { writeSystemAuditLog } from "@/lib/audit-log-server";

function textValue(value: unknown, max = 200): string {
  return String(value ?? "").trim().slice(0, max);
}

function readTelegramId(body: Record<string, unknown>): string {
  const telegram = body.telegram as Record<string, unknown> | undefined;
  return textValue(
    body.telegramUserId ??
      body.telegram_user_id ??
      body.telegramId ??
      body.telegram_id ??
      telegram?.id ??
      telegram?.userId,
    80,
  );
}

function readTelegramUsername(body: Record<string, unknown>): string {
  const telegram = body.telegram as Record<string, unknown> | undefined;
  return sanitizeTelegramInput(
    textValue(body.telegramUsername ?? body.telegram_username ?? body.username ?? telegram?.username, 120),
  );
}

export async function POST(req: NextRequest) {
  const tokenError = requireBotToken(req);
  if (tokenError) return tokenError;

  try {
    const body = (await req.json()) as Record<string, unknown>;
    const studentId = textValue(body.studentId ?? body.student_id, 120);
    const phone = sanitizePhoneInput(textValue(body.phone ?? body.studentPhone ?? body.student_phone, 120));
    const telegramUserId = readTelegramId(body);
    const telegramUsername = readTelegramUsername(body);

    if (!telegramUserId) return validationError("telegramUserId مطلوب لإتمام ربط الطالب بالبوت.");
    if (!studentId && !phone) return validationError("studentId أو phone مطلوب لإتمام الربط.");

    const student = await db.student.findFirst({
      where: studentId
        ? { id: studentId }
        : { OR: [{ phone }, { phoneKey: phone }, { parentPhone: phone }] },
      include: { course: true },
    });

    if (!student) return validationError("لم يتم العثور على الطالب المطلوب ربطه.", 404);

    const normalizedTelegramId = normalizeTelegramIdentifier(telegramUserId);
    const normalizedUsername = normalizeTelegramIdentifier(telegramUsername);
    const conflict = await db.student.findFirst({
      where: {
        id: { not: student.id },
        OR: [
          { telegramKey: normalizedTelegramId },
          ...(normalizedUsername ? [{ telegramKey: normalizedUsername }] : []),
          { telegram: { equals: sanitizeTelegramInput(telegramUserId), mode: "insensitive" } },
          ...(telegramUsername
            ? [{ telegram: { equals: telegramUsername, mode: "insensitive" as const } }]
            : []),
        ],
      },
      select: { id: true, name: true, phone: true, telegram: true },
    });

    if (conflict) {
      return NextResponse.json(
        {
          error: "حساب التيليجرام مرتبط بطالب آخر ولا يمكن ربطه مرتين.",
          conflictStudent: { id: conflict.id, name: conflict.name, phone: conflict.phone },
        },
        { status: 409 },
      );
    }

    const updated = await db.student.update({
      where: { id: student.id },
      data: {
        telegram: sanitizeTelegramInput(telegramUserId),
        telegramKey: normalizedTelegramId,
      },
      include: { course: true },
    });

    await writeSystemAuditLog(
      "بوت التيليجرام",
      "ربط طالب بحساب تيليجرام",
      {
        studentId: updated.id,
        studentName: updated.name,
        telegramUserId,
        telegramUsername,
        previousTelegram: student.telegram || "",
      },
      { userName: "Telegram Bot" },
    );

    return NextResponse.json({
      ok: true,
      linked: true,
      student: {
        id: updated.id,
        name: updated.name,
        phone: updated.phone,
        parentPhone: updated.parentPhone,
        telegram: updated.telegram,
        code: updated.code,
        status: updated.status,
        opportunities: updated.opportunities,
        courseId: updated.courseId,
        courseName: updated.course?.name || "",
      },
    });
  } catch (error) {
    return routeErrorResponse(error, "تعذر ربط الطالب بالبوت حالياً.");
  }
}
