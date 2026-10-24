import { NextRequest, NextResponse } from "next/server";
import { constantTimeEqual, readServerEnv } from "@/lib/bot-integration-auth";

/** The path «Mirmaz Pro» (through its own server) calls with its token instead of a browser session. */
export const MIRMAZ_INTEGRATION_PATHS = ["/api/integrations/mirmaz/grade"];

/** A shorter secret is treated as not set: it could be guessed. */
const MIN_TOKEN_LENGTH = 32;

/** `Authorization: Bearer <MIRMAZ_GRADES_TOKEN>`; checked in constant time. */
export function requireMirmazToken(req: NextRequest): NextResponse | null {
  const configured = (readServerEnv("MIRMAZ_GRADES_TOKEN") || "").trim();
  if (configured.length < MIN_TOKEN_LENGTH) {
    console.error(`[mirmaz] MIRMAZ_GRADES_TOKEN is missing or shorter than ${MIN_TOKEN_LENGTH} characters.`);
    return NextResponse.json({ ok: false, error: "ربط Mirmaz Pro غير مفعّل.", code: "MIRMAZ_NOT_CONFIGURED" }, { status: 503 });
  }
  const auth = req.headers.get("authorization") || "";
  const token = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";
  if (!constantTimeEqual(token, configured)) {
    return NextResponse.json({ ok: false, error: "توكن Mirmaz Pro غير صحيح.", code: "BAD_TOKEN" }, { status: 401 });
  }
  return null;
}
