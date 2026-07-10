import { NextRequest, NextResponse } from "next/server";

export function readServerEnv(name: string): string | undefined {
  return (
    globalThis as unknown as {
      process?: { env?: Record<string, string | undefined> };
    }
  ).process?.env?.[name];
}

export function readBotIngestToken(): string {
  return (readServerEnv("TEACHERPRO_BOT_INGEST_TOKEN") || "").trim();
}

export function readTelegramBotToken(): string {
  return (
    readServerEnv("TEACHERPRO_BOT_TOKEN") ||
    readServerEnv("TEACHERPRO_TELEGRAM_BOT_TOKEN") ||
    readServerEnv("TELEGRAM_BOT_TOKEN") ||
    readServerEnv("BOT_TOKEN") ||
    ""
  ).trim();
}

export function constantTimeEqual(left: string, right: string): boolean {
  if (!left || !right || left.length !== right.length) return false;
  let diff = 0;
  for (let i = 0; i < left.length; i += 1) {
    diff |= left.charCodeAt(i) ^ right.charCodeAt(i);
  }
  return diff === 0;
}

export function getRequestBotToken(req: NextRequest): string {
  const auth = req.headers.get("authorization") || "";
  const bearerToken = auth.toLowerCase().startsWith("bearer ")
    ? auth.slice(7).trim()
    : "";
  const headerToken = req.headers.get("x-teacherpro-bot-token") || "";
  const legacyHeaderToken = req.headers.get("x-ingest-token") || "";
  return bearerToken || headerToken || legacyHeaderToken;
}

export function requireBotToken(req: NextRequest): NextResponse | null {
  const configuredToken = readBotIngestToken();
  if (!configuredToken) {
    return NextResponse.json(
      { error: "TEACHERPRO_BOT_INGEST_TOKEN غير مفعّل في إعدادات النظام." },
      { status: 503 },
    );
  }

  const token = getRequestBotToken(req);
  if (!constantTimeEqual(token, configuredToken)) {
    return NextResponse.json({ error: "توكن البوت غير صحيح." }, { status: 401 });
  }

  return null;
}
