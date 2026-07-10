export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { requireBotToken } from "@/lib/bot-integration-auth";
import { sanitizePhoneInput } from "@/lib/format";
import { normalizeTelegramIdentifier, sanitizeTelegramInput } from "@/lib/student-utils";
import { validationError, routeErrorResponse } from "@/lib/route-helpers";

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
    textValue(
      body.telegramUsername ??
        body.telegram_username ??
        body.username ??
        telegram?.username,
      120,
    ),
  );
}

function buildStudentWhere(body: Record<string, unknown>): Prisma.StudentWhereInput | null {
  const studentId = textValue(body.studentId ?? body.student_id, 120);
  if (studentId) return { id: studentId };

  const code = textValue(body.studentCode ?? body.student_code ?? body.code, 120);
  if (code) return { code };

  const phone = sanitizePhoneInput(
    textValue(body.phone ?? body.studentPhone ?? body.student_phone ?? body.parentPhone ?? body.parent_phone, 120),
  );
  if (phone) {
    return {
      OR: [{ phone }, { phoneKey: phone }, { parentPhone: phone }],
    };
  }

  const telegramId = readTelegramId(body);
  const telegramUsername = readTelegramUsername(body);
  const telegramCandidates = [telegramId, telegramUsername]
    .map((item) => item.trim())
    .filter(Boolean);
  if (telegramCandidates.length > 0) {
    return {
      OR: telegramCandidates.flatMap((candidate) => {
        const sanitized = sanitizeTelegramInput(candidate);
        const normalized = normalizeTelegramIdentifier(candidate);
        return [
          { telegram: { equals: sanitized, mode: "insensitive" as const } },
          { telegramKey: { equals: normalized, mode: "insensitive" as const } },
        ];
      }),
    };
  }

  return null;
}

function safeStudent(student: any) {
  return {
    id: student.id,
    name: student.name,
    school: student.school,
    phone: student.phone,
    parentPhone: student.parentPhone,
    telegram: student.telegram,
    code: student.code,
    status: student.status,
    opportunities: student.opportunities,
    courseId: student.courseId,
    courseProgram: student.courseProgram,
    courseTerm: student.courseTerm,
    studyType: student.studyType,
    locationScope: student.locationScope,
    mainSite: student.mainSite,
    subSite: student.subSite,
  };
}

export async function POST(req: NextRequest) {
  const tokenError = requireBotToken(req);
  if (tokenError) return tokenError;

  try {
    const body = (await req.json()) as Record<string, unknown>;
    const where = buildStudentWhere(body);
    if (!where) return validationError("أرسل studentId أو code أو phone أو telegramUserId للبحث عن الطالب.");

    const student = await db.student.findFirst({
      where,
      include: { course: true },
      orderBy: { createdAt: "desc" },
    });

    if (!student) return NextResponse.json({ ok: true, student: null, matchType: "none" });

    const requestedTelegramId = readTelegramId(body);
    const requestedUsername = readTelegramUsername(body);
    const linkedTelegram = normalizeTelegramIdentifier(student.telegram);
    const telegramMatched = Boolean(
      linkedTelegram &&
        [requestedTelegramId, requestedUsername]
          .map((item) => normalizeTelegramIdentifier(item))
          .filter(Boolean)
          .includes(linkedTelegram),
    );

    const matchType = student.id === textValue(body.studentId ?? body.student_id, 120)
      ? "studentId"
      : student.code === textValue(body.studentCode ?? body.student_code ?? body.code, 120)
        ? "code"
        : telegramMatched
          ? "telegram"
          : "phone";

    return NextResponse.json({
      ok: true,
      matchType,
      alreadyLinked: Boolean(student.telegram),
      linkedToSameTelegram: telegramMatched,
      student: {
        ...safeStudent(student),
        courseName: student.course?.name || "",
      },
    });
  } catch (error) {
    return routeErrorResponse(error, "تعذر حل ربط الطالب للبوت حالياً.");
  }
}
