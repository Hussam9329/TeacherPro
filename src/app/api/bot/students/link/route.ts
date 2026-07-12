export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireBotToken } from "@/lib/bot-integration-auth";
import { sanitizePhoneInput } from "@/lib/format";
import { normalizeTelegramIdentifier, sanitizeTelegramInput } from "@/lib/student-utils";
import { routeErrorResponse, validationError } from "@/lib/route-helpers";
import { writeSystemAuditLog } from "@/lib/audit-log-server";

function text(value: unknown, max = 200) { return String(value ?? "").trim().slice(0, max); }
function readTelegramId(body: Record<string, unknown>) { const tg = body.telegram as Record<string, unknown> | undefined; return text(body.telegramUserId ?? body.telegram_user_id ?? body.telegramId ?? body.telegram_id ?? tg?.id ?? tg?.userId, 80); }
function readTelegramUsername(body: Record<string, unknown>) { const tg = body.telegram as Record<string, unknown> | undefined; return sanitizeTelegramInput(text(body.telegramUsername ?? body.telegram_username ?? body.username ?? tg?.username, 120)); }

export async function POST(req: NextRequest) {
  const tokenError = requireBotToken(req); if (tokenError) return tokenError;
  try {
    const body = (await req.json()) as Record<string, unknown>;
    const studentId = text(body.studentId ?? body.student_id, 120);
    const studentCode = text(body.studentCode ?? body.student_code ?? body.code, 120);
    const phone = sanitizePhoneInput(text(body.phone ?? body.studentPhone ?? body.student_phone ?? body.parentPhone ?? body.parent_phone, 120));
    const confirmedName = text(body.confirmedStudentName ?? body.studentName, 200);
    const confirmedCourseId = text(body.confirmedCourseId ?? body.courseId, 120);
    const telegramUserId = readTelegramId(body);
    const telegramUsername = readTelegramUsername(body);
    if (!telegramUserId) return validationError("telegramUserId مطلوب لإتمام الربط.");
    if (!studentId && !studentCode && !phone) return validationError("أرسل studentId أو كود الطالب. رقم الهاتف وحده يحتاج تأكيد الاسم والدورة.");

    const where = studentId ? { id: studentId } : studentCode ? { code: studentCode } : { OR: [{ phone }, { phoneKey: phone }, { parentPhone: phone }] };
    const candidates = await db.student.findMany({ where, include: { course: true }, take: 10, orderBy: [{ createdAt: "desc" }, { id: "asc" }] });
    if (!candidates.length) return validationError("لم يتم العثور على الطالب المطلوب ربطه.", 404);
    let student = candidates[0];
    if (candidates.length > 1) {
      if (!studentCode && (!confirmedName || !confirmedCourseId)) {
        return NextResponse.json({ error: "رقم ولي الأمر مشترك بين أكثر من طالب. أرسل كود الطالب أو أكد الاسم والدورة قبل الربط.", ambiguous: true, candidates: candidates.map((item) => ({ id: item.id, name: item.name, code: item.code, courseId: item.courseId, courseName: item.course?.name || "", status: item.status })) }, { status: 409 });
      }
      const normalizedName = confirmedName.trim().toLocaleLowerCase("ar");
      const resolved = candidates.filter((item) => item.name.trim().toLocaleLowerCase("ar") === normalizedName && item.courseId === confirmedCourseId);
      if (resolved.length !== 1) return validationError("تعذر تأكيد طالب واحد بالاسم والدورة. استخدم كود الطالب.", 409);
      student = resolved[0];
    }
    if (student.status === "مفصول") return validationError("لا يمكن ربط طالب مفصول بالبوت قبل إعادة التفعيل.", 409);
    if (student.status === "مؤرشف") return validationError("لا يمكن ربط ملف طالب مؤرشف بالبوت.", 409);

    const normalizedTelegramId = normalizeTelegramIdentifier(telegramUserId);
    const normalizedUsername = normalizeTelegramIdentifier(telegramUsername);
    const conflict = await db.student.findFirst({ where: { id: { not: student.id }, OR: [
      { telegramKey: normalizedTelegramId }, ...(normalizedUsername ? [{ telegramKey: normalizedUsername }] : []),
      { telegram: { equals: sanitizeTelegramInput(telegramUserId), mode: "insensitive" } },
      ...(telegramUsername ? [{ telegram: { equals: telegramUsername, mode: "insensitive" as const } }] : []),
    ] }, select: { id: true, name: true, code: true } });
    if (conflict) return NextResponse.json({ error: "حساب تيليجرام مرتبط بطالب آخر.", conflictStudent: conflict }, { status: 409 });

    const updated = await db.student.update({ where: { id: student.id }, data: { telegram: sanitizeTelegramInput(telegramUserId), telegramKey: normalizedTelegramId }, include: { course: true } });
    await writeSystemAuditLog("بوت التيليجرام", "ربط طالب بحساب تيليجرام بعد تحقق فريد", { studentId: updated.id, studentCode: updated.code, studentName: updated.name, courseId: updated.courseId, telegramUserId, telegramUsername, previousTelegram: student.telegram || "" }, { userName: "Telegram Bot" });
    return NextResponse.json({ ok: true, linked: true, student: { id: updated.id, name: updated.name, phone: updated.phone, parentPhone: updated.parentPhone, telegram: updated.telegram, code: updated.code, status: updated.status, opportunities: updated.opportunities, courseId: updated.courseId, courseName: updated.course?.name || "" } });
  } catch (error) { return routeErrorResponse(error, "تعذر ربط الطالب بالبوت حالياً."); }
}
