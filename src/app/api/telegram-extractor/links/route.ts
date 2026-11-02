export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { requirePermissionPrincipal } from "@/lib/server-auth";
import { readExtractorLinks } from "@/lib/telegram-extractor/config";

const NO_STORE = { "Cache-Control": "private, no-store, max-age=0" };

/**
 * The group links «استخراج من رسائل التليگرام» already knows. They live in the
 * TELEGRAM_EXTRACTOR_LINKS setting, not in the code (the repository is public),
 * and only reach staff who may add students.
 */
export async function GET(req: NextRequest) {
  const principal = await requirePermissionPrincipal(req, "students.add");
  if (principal instanceof NextResponse) return principal;
  let saved: unknown = null;
  try {
    saved = JSON.parse(process.env.TELEGRAM_EXTRACTOR_LINKS || "null");
  } catch {
    // A broken setting means no known links: each one is asked for once instead.
  }
  return NextResponse.json({ links: readExtractorLinks(saved) }, { headers: NO_STORE });
}
