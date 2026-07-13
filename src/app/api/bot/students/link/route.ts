export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireBotToken } from "@/lib/bot-integration-auth";
import { sanitizePhoneInput } from "@/lib/format";
import { sanitizeTelegramInput } from "@/lib/student-utils";
import { routeErrorResponse, validationError } from "@/lib/route-helpers";

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

    // Q81+Q82 FIX: When searching by phone (which may match parentPhone
    // shared among siblings), use findMany instead of findFirst. If multiple
    // students match, return a disambiguation list so the bot can ask the
    // user to select the correct student. Previously, findFirst with
    // orderBy: createdAt desc silently picked the newest sibling.
    //
    // Q83 FIX: Filter out archived and dismissed students — they should
    // not be linkable to a Telegram account.
    if (!studentId && phone) {
      const candidates = await db.student.findMany({
        where: {
          OR: [{ phone }, { phoneKey: phone }, { parentPhone: phone }],
          status: { in: ["نشط"] }, // Q83: only active students are linkable
        },
        include: { course: true },
        take: 10,
        orderBy: { createdAt: "desc" },
      });

      if (candidates.length === 0) {
        return validationError("لم يتم العثور على طالب نشط بهذا الرقم.", 404);
      }

      if (candidates.length > 1) {
        // Q81+Q82: Multiple matches — return disambiguation list
        return NextResponse.json(
          {
            error: "الرقم يطابق عدة طلاب. يرجى تحديد الطالب الصحيح.",
            requiresDisambiguation: true,
            candidates: candidates.map((s) => ({
              id: s.id,
              name: s.name,
              code: s.code,
              phone: s.phone,
              parentPhone: s.parentPhone,
              courseName: s.course?.name || "",
              opportunities: s.opportunities,
            })),
          },
          { status: 409 },
        );
      }

      // Exactly one match — proceed with it
      const student = candidates[0];
      return await performLink(student, telegramUserId, telegramUsername);
    }

    // studentId provided — fetch directly
    const student = await db.student.findFirst({
      where: { id: studentId },
      include: { course: true },
    });

    if (!student) return validationError("لم يتم العثور على الطالب المطلوب ربطه.", 404);

    // Q83 FIX: Reject archived and dismissed students
    if (student.status === "مؤرشف") {
      return validationError("لا يمكن ربط طالب مؤرشف بحساب تيليجرام.", 403);
    }
    if (student.status === "مفصول") {
      return validationError("لا يمكن ربط طالب مفصول بحساب تيليجرام. أعد تفعيله أولاً.", 403);
    }

    return await performLink(student, telegramUserId, telegramUsername);
  } catch (error) {
    return routeErrorResponse(error, "تعذر ربط الطالب بالبوت حالياً.");
  }
}

// Extracted helper to avoid code duplication between the phone-search path
// and the studentId path.
async function performLink(
  student: { id: string; name: string; phone: string | null; parentPhone: string | null; telegram: string | null; code: string; status: string; opportunities: number; courseId: string; course?: { name: string } | null },
  telegramUserId: string,
  telegramUsername: string,
) {
  const { db } = await import("@/lib/db");
  const { normalizeTelegramIdentifier, sanitizeTelegramInput } = await import("@/lib/student-utils");
  const { writeSystemAuditLog } = await import("@/lib/audit-log-server");

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
}
