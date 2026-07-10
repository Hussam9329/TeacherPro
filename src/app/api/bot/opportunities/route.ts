export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireBotToken } from "@/lib/bot-integration-auth";
import { normalizeTelegramIdentifier } from "@/lib/student-utils";
import { routeErrorResponse, validationError } from "@/lib/route-helpers";

function textValue(value: unknown, max = 200): string {
  return String(value ?? "").trim().slice(0, max);
}

async function resolveStudent(body: Record<string, unknown>) {
  const studentId = textValue(body.studentId ?? body.student_id, 120);
  if (studentId) return db.student.findUnique({ where: { id: studentId } });

  const telegram = body.telegram as Record<string, unknown> | undefined;
  const telegramCandidates = [
    textValue(body.telegramUserId ?? body.telegram_user_id ?? telegram?.id, 80),
    textValue(body.telegramUsername ?? body.telegram_username ?? telegram?.username, 120),
  ]
    .map(normalizeTelegramIdentifier)
    .filter(Boolean);

  if (telegramCandidates.length === 0) return null;
  return db.student.findFirst({ where: { telegramKey: { in: telegramCandidates } } });
}

export async function POST(req: NextRequest) {
  const tokenError = requireBotToken(req);
  if (tokenError) return tokenError;

  try {
    const body = (await req.json()) as Record<string, unknown>;
    const student = await resolveStudent(body);
    if (!student) return validationError("الطالب غير مرتبط أو غير موجود في TeacherPro.", 404);

    const logs = await db.opportunityLog.findMany({
      where: { studentId: student.id },
      orderBy: { date: "desc" },
      take: 15,
    });

    return NextResponse.json({
      ok: true,
      student: {
        id: student.id,
        name: student.name,
        phone: student.phone,
        telegram: student.telegram,
        code: student.code,
        opportunities: student.opportunities,
      },
      opportunities: student.opportunities,
      logs: logs.map((log) => ({
        id: log.id,
        action: log.action,
        amount: log.amount,
        reason: log.reason,
        date: log.date,
        chapterId: log.chapterId,
        examId: log.examId,
      })),
    });
  } catch (error) {
    return routeErrorResponse(error, "تعذر تحميل فرص الطالب من TeacherPro حالياً.");
  }
}
