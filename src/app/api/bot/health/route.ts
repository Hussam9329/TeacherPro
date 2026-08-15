export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireBotToken, readTelegramBotToken } from "@/lib/bot-integration-auth";

export async function GET(req: NextRequest) {
  const tokenError = requireBotToken(req);
  if (tokenError) return tokenError;

  try {
    await db.$queryRaw`SELECT 1`;
    return NextResponse.json({
      ok: true,
      database: "ok",
      telegramBotTokenConfigured: Boolean(readTelegramBotToken()),
      endpoints: [
        "/api/bot/students/resolve",
        "/api/bot/students/link",
        "/api/bot/exams",
        "/api/bot/opportunities",
        "/api/telegram-exam-submissions",
      ],
    });
  } catch (error) {
    console.error("[bot-health] database check failed", error);
    return NextResponse.json({ ok: false, database: "error" }, { status: 503 });
  }
}
