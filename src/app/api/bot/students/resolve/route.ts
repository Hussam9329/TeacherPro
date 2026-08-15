export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { requireBotToken } from "@/lib/bot-integration-auth";
import { sanitizePhoneInput } from "@/lib/format";
import { normalizeTelegramIdentifier, sanitizeTelegramInput } from "@/lib/student-utils";
import { validationError, routeErrorResponse } from "@/lib/route-helpers";

function text(value: unknown, max = 200) { return String(value ?? "").trim().slice(0, max); }
function telegramId(body: Record<string, unknown>) {
  const telegram = body.telegram as Record<string, unknown> | undefined;
  return text(body.telegramUserId ?? body.telegram_user_id ?? body.telegramId ?? body.telegram_id ?? telegram?.id ?? telegram?.userId, 80);
}
function telegramUsername(body: Record<string, unknown>) {
  const telegram = body.telegram as Record<string, unknown> | undefined;
  return sanitizeTelegramInput(text(body.telegramUsername ?? body.telegram_username ?? body.username ?? telegram?.username, 120));
}
function safe(student: any) {
  return { id: student.id, name: student.name, school: student.school, phone: student.phone,
    parentPhone: student.parentPhone, telegram: student.telegram, code: student.code,
    status: student.status, opportunities: student.opportunities, courseId: student.courseId,
    courseName: student.course?.name || "", courseProgram: student.courseProgram,
    courseTerm: student.courseTerm, studyType: student.studyType, locationScope: student.locationScope,
    mainSite: student.mainSite, subSite: student.subSite };
}

export async function POST(req: NextRequest) {
  const tokenError = requireBotToken(req); if (tokenError) return tokenError;
  try {
    const body = (await req.json()) as Record<string, unknown>;
    const studentId = text(body.studentId ?? body.student_id, 120);
    const code = text(body.studentCode ?? body.student_code ?? body.code, 120);
    const phone = sanitizePhoneInput(text(body.phone ?? body.studentPhone ?? body.student_phone ?? body.parentPhone ?? body.parent_phone, 120));
    const tgCandidates = [telegramId(body), telegramUsername(body)].map(normalizeTelegramIdentifier).filter(Boolean);
    let where: Prisma.StudentWhereInput | null = null;
    let matchType = "none";
    if (studentId) { where = { id: studentId }; matchType = "studentId"; }
    else if (code) { where = { code }; matchType = "code"; }
    else if (tgCandidates.length) { where = { telegramKey: { in: tgCandidates } }; matchType = "telegram"; }
    else if (phone) { where = { OR: [{ phone }, { phoneKey: phone }, { parentPhone: phone }] }; matchType = "phone"; }
    if (!where) return validationError("أرسل studentId أو code أو phone أو telegramUserId للبحث عن الطالب.");

    const matches = await db.student.findMany({ where, include: { course: true }, orderBy: [{ createdAt: "desc" }, { id: "asc" }], take: 10 });
    if (!matches.length) return NextResponse.json({ ok: true, student: null, matchType: "none" });
    if (matches.length > 1) {
      return NextResponse.json({
        ok: false, ambiguous: true, matchType,
        error: "بيانات البحث تطابق أكثر من طالب. لا يجوز اختيار أول طالب تلقائياً؛ اطلب كود الطالب أو أكد الاسم والدورة.",
        candidates: matches.map(safe),
      }, { status: 409 });
    }
    const student = matches[0];
    const requestedTelegram = [telegramId(body), telegramUsername(body)].map(normalizeTelegramIdentifier).filter(Boolean);
    const linked = normalizeTelegramIdentifier(student.telegram);
    return NextResponse.json({ ok: true, matchType, alreadyLinked: Boolean(student.telegram), linkedToSameTelegram: Boolean(linked && requestedTelegram.includes(linked)), student: safe(student) });
  } catch (error) { return routeErrorResponse(error, "تعذر حل ربط الطالب للبوت حالياً."); }
}
