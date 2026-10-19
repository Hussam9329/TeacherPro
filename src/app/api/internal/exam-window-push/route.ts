export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { writeSystemAuditLog } from "@/lib/audit-log-server";
import { db } from "@/lib/db";
import { routeErrorResponse } from "@/lib/route-helpers";
import { pushDueExamWindows } from "@/lib/student-app/push-exam-window";
import { pushSendersFromEnv } from "@/lib/student-app/push-server";

function isAuthorizedCron(req: NextRequest): boolean {
  const secret = String(process.env.CRON_SECRET || "").trim();
  const authorization = String(req.headers.get("authorization") || "").trim();
  if (!secret || !authorization.startsWith("Bearer ")) return false;
  const left = Buffer.from(authorization.slice("Bearer ".length));
  const right = Buffer.from(secret);
  return left.length === right.length && timingSafeEqual(left, right);
}

/**
 * Vercel Cron, every minute: push «فتحت نافذة امتحان …» to the active
 * students of each exam whose Telegram window just opened. Idempotent: the
 * sent log claims each exam once. Without push keys nothing is claimed, so
 * the exams still inside the look-back go out once the keys are added.
 */
export async function GET(req: NextRequest) {
  if (!isAuthorizedCron(req)) {
    return NextResponse.json({ error: "غير مصرح بتشغيل إشعارات نوافذ الامتحانات." }, { status: 401 });
  }
  try {
    const senders = pushSendersFromEnv();
    if (!senders.configured) {
      return NextResponse.json({ ok: false, reason: "push-not-configured", missing: senders.missing });
    }
    const result = await pushDueExamWindows({ client: db, senders });
    for (const exam of result.notified) {
      await writeSystemAuditLog("إشعارات التطبيق", "إشعار فتح نافذة امتحان", exam);
    }
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return routeErrorResponse(error, "تعذر تشغيل إشعارات نوافذ الامتحانات.");
  }
}
