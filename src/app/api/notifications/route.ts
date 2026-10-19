export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

import { NextRequest, NextResponse } from "next/server";
import { writeRequestAuditLog } from "@/lib/audit-log-server";
import { db } from "@/lib/db";
import { routeErrorResponse, validationError } from "@/lib/route-helpers";
import { requirePermission, requirePermissionPrincipal } from "@/lib/server-auth";
import { pushSendersFromEnv, resolveAudience, sendAndLog, serializeLog } from "@/lib/student-app/push-server";

const PERMISSION = "notifications.send";
const TITLE_MAX = 80;
const BODY_MAX = 500;
const TARGETS = new Set(["all", "course", "course-chapter"]);

/** The sent log, newest first. */
export async function GET(req: NextRequest) {
  const denied = await requirePermission(req, PERMISSION);
  if (denied) return denied;
  try {
    const raw = Number(new URL(req.url).searchParams.get("limit") || 50);
    const limit = Math.min(200, Math.max(1, Number.isFinite(raw) ? Math.floor(raw) : 50));
    const logs = await db.studentPushLog.findMany({ orderBy: { createdAt: "desc" }, take: limit });
    return NextResponse.json({ logs: logs.map(serializeLog) });
  } catch (error) {
    return routeErrorResponse(error, "تعذر تحميل سجل الإشعارات حالياً.");
  }
}

/**
 * Send a notification to the student app. `dryRun: true` only counts who
 * would receive it, so the page can confirm «سيصل إلى N طالب» first.
 */
export async function POST(req: NextRequest) {
  const principal = await requirePermissionPrincipal(req, PERMISSION);
  if (principal instanceof NextResponse) return principal;
  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const target = String(body.target ?? "").trim();
    if (!TARGETS.has(target)) return validationError("اختر الجهة المستهدفة: الكل، دورة، أو دورة وفصل.");
    const title = String(body.title ?? "").replace(/\s+/g, " ").trim();
    const text = String(body.body ?? "").replace(/\r\n/g, "\n").trim();
    const dryRun = body.dryRun === true;
    if (!title) return validationError("عنوان الإشعار مطلوب.");
    if (title.length > TITLE_MAX) return validationError(`عنوان الإشعار يجب ألا يتجاوز ${TITLE_MAX} حرفاً.`);
    if (!text) return validationError("نص الإشعار مطلوب.");
    if (text.length > BODY_MAX) return validationError(`نص الإشعار يجب ألا يتجاوز ${BODY_MAX} حرف.`);

    let courseId: string | null = null;
    let courseName = "";
    let chapterId: string | null = null;
    let chapterName = "";
    if (target !== "all") {
      courseId = String(body.courseId ?? "").trim();
      if (!courseId) return validationError("اختر الدورة.");
      const course = await db.course.findUnique({ where: { id: courseId }, select: { id: true, name: true } });
      if (!course) return validationError("الدورة غير موجودة.");
      courseName = course.name;
    }
    if (target === "course-chapter") {
      chapterId = String(body.chapterId ?? "").trim();
      if (!chapterId) return validationError("اختر الفصل.");
      const link = await db.courseChapter.findFirst({
        where: { courseId: courseId as string, chapterId },
        select: { chapter: { select: { id: true, name: true } } },
      });
      if (!link) return validationError("الفصل غير مرتبط بهذه الدورة.");
      chapterName = link.chapter.name;
    }

    const audience = await resolveAudience(db, courseId ? [courseId] : null);
    const summary = { students: audience.students, reachable: audience.reachable, devices: audience.devices.length };
    if (dryRun) return NextResponse.json({ ok: true, dryRun: true, ...summary });

    const senders = pushSendersFromEnv();
    if (audience.devices.length > 0 && !senders.configured) {
      return NextResponse.json(
        { error: "خدمة الإشعارات غير مهيأة على الخادم بعد (مفاتيح الإشعارات ناقصة)." },
        { status: 503 },
      );
    }
    const result = await sendAndLog(
      db,
      { kind: "manual", target: target as "all" | "course" | "course-chapter", courseId, courseName, chapterId, chapterName, title, body: text, userName: principal.name || principal.username },
      audience,
      senders,
    );
    await writeRequestAuditLog(req, "إشعارات التطبيق", "إرسال إشعار", {
      target, courseName, chapterName, title, ...summary, sent: result.sent, failed: result.failed,
    });
    const log = await db.studentPushLog.findUnique({ where: { id: result.logId } });
    return NextResponse.json({ ok: true, ...summary, sent: result.sent, failed: result.failed, log: log ? serializeLog(log) : null });
  } catch (error) {
    return routeErrorResponse(error, "تعذر إرسال الإشعار حالياً.");
  }
}
