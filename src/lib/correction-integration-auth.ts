import { NextRequest, NextResponse } from "next/server";
import { constantTimeEqual, readServerEnv } from "@/lib/bot-integration-auth";

/** Paths the Correction app calls with its own token instead of a browser session. */
export const CORRECTION_INTEGRATION_PATHS = [
  "/api/integrations/correction/grade",
  "/api/integrations/correction/submission-received",
];

/** A shorter secret is treated as not set: it could be guessed. */
const MIN_TOKEN_LENGTH = 32;

/** `Authorization: Bearer <CORRECTION_GRADES_TOKEN>`; checked in constant time. */
export function requireCorrectionToken(req: NextRequest): NextResponse | null {
  const configured = (readServerEnv("CORRECTION_GRADES_TOKEN") || "").trim();
  if (configured.length < MIN_TOKEN_LENGTH) {
    console.error(`[correction] CORRECTION_GRADES_TOKEN is missing or shorter than ${MIN_TOKEN_LENGTH} characters.`);
    return NextResponse.json({ ok: false, error: "ربط Correction غير مفعّل.", code: "CORRECTION_NOT_CONFIGURED" }, { status: 503 });
  }
  const auth = req.headers.get("authorization") || "";
  const token = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";
  if (!constantTimeEqual(token, configured)) {
    return NextResponse.json({ ok: false, error: "توكن Correction غير صحيح.", code: "BAD_TOKEN" }, { status: 401 });
  }
  return null;
}
