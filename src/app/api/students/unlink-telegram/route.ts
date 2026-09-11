export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getAuthPrincipal, forbiddenResponse, unauthorizedResponse } from "@/lib/server-auth";
import { routeErrorResponse } from "@/lib/route-helpers";
import { withSerializableTransaction } from "@/lib/serializable-transaction";
import { withStudentMutationToken } from "@/lib/student-mutation-token";

class TelegramUnlinkError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

export async function POST(req: NextRequest) {
  const principal = await getAuthPrincipal(req);
  if (!principal) return unauthorizedResponse();
  if (!principal.isAdmin) return forbiddenResponse();

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const studentId = String(body.studentId || "").trim();
  if (!studentId) {
    return NextResponse.json({ error: "تعذر تحديد الطالب المطلوب." }, { status: 400 });
  }
  if (typeof body.expectedTelegram !== "string") {
    return NextResponse.json(
      { error: "حدّث بيانات الطالب ثم أعد محاولة فك الارتباط." },
      { status: 400 },
    );
  }
  const expectedTelegram = body.expectedTelegram.trim();

  try {
    const result = await withSerializableTransaction(async (tx) => {
      const student = await tx.student.findUnique({ where: { id: studentId } });
      if (!student) throw new TelegramUnlinkError("الطالب غير موجود.", 404);

      const currentTelegram = String(student.telegram || "").trim();
      if (!currentTelegram && !student.telegramKey) {
        return { student, alreadyUnlinked: true };
      }
      if (currentTelegram !== expectedTelegram) {
        throw new TelegramUnlinkError(
          "تغير حساب تيليجرام المرتبط بعد فتح النافذة. حدّث بيانات الطالب ثم حاول مجدداً.",
          409,
        );
      }

      const updated = await tx.student.update({
        where: { id: studentId },
        data: { telegram: null, telegramKey: null },
      });
      await tx.auditLog.create({
        data: {
          module: "سجل الطلاب",
          action: "فك ارتباط تيليجرام",
          details: JSON.stringify({
            studentId: updated.id,
            studentName: updated.name,
            studentCode: updated.code,
            previousTelegram: currentTelegram,
            phonePreserved: true,
          }),
          userId: principal.id,
          userName: principal.name,
        },
      });
      return { student: updated, alreadyUnlinked: false };
    });

    return NextResponse.json({
      ok: true,
      unlinked: true,
      alreadyUnlinked: result.alreadyUnlinked,
      student: withStudentMutationToken(
        result.student as unknown as Record<string, unknown>,
      ),
      message: result.alreadyUnlinked
        ? "حساب تيليجرام غير مرتبط بهذا الطالب أصلاً."
        : "تم فك ارتباط تيليجرام مع إبقاء أرقام الهاتف كما هي.",
    });
  } catch (error) {
    if (error instanceof TelegramUnlinkError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return routeErrorResponse(error, "تعذر فك ارتباط حساب تيليجرام حالياً.");
  }
}
