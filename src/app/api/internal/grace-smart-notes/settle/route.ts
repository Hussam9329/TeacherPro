export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { reconcileExpiredGracePendingGrades } from "@/lib/grade-smart-note-grace-expiry-server";
import { routeErrorResponse } from "@/lib/route-helpers";

function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return (
    leftBuffer.length === rightBuffer.length &&
    timingSafeEqual(leftBuffer, rightBuffer)
  );
}

function isAuthorizedCron(req: NextRequest): boolean {
  const secret = String(process.env.CRON_SECRET || "").trim();
  const authorization = String(req.headers.get("authorization") || "").trim();
  if (!secret || !authorization.startsWith("Bearer ")) return false;
  return safeEqual(authorization.slice("Bearer ".length), secret);
}

/**
 * Vercel invokes cron routes with GET. This internal, secret-protected route is
 * deliberately the only read-shaped endpoint allowed to settle grace notes;
 * ordinary page/profile GET requests remain strictly read-only.
 */
export async function GET(req: NextRequest) {
  if (!isAuthorizedCron(req)) {
    return NextResponse.json(
      { error: "غير مصرح بتشغيل تسوية درجات السماح." },
      { status: 401 },
    );
  }

  try {
    const aggregate = {
      processed: 0,
      conflicts: 0,
      rejected: 0,
      stillInGrace: 0,
      eligibleRemaining: 0,
      processedNoteIds: [] as string[],
      conflictNoteIds: [] as string[],
      rejectedNoteIds: [] as string[],
      gradeIds: [] as string[],
      batches: 0,
    };
    // Keep every transaction bounded. Successfully committed batches remain
    // settled even if a very large backlog needs another scheduled run.
    for (let batch = 0; batch < 20; batch += 1) {
      const result = await reconcileExpiredGracePendingGrades({
        actor: { name: "TeacherPro - التسوية اليومية لفترة السماح" },
        batchSize: 100,
      });
      aggregate.processed += result.processed;
      aggregate.conflicts += result.conflicts;
      aggregate.rejected += result.rejected;
      aggregate.stillInGrace = result.stillInGrace;
      aggregate.eligibleRemaining = result.eligibleRemaining;
      aggregate.processedNoteIds.push(...result.processedNoteIds);
      aggregate.conflictNoteIds.push(...result.conflictNoteIds);
      aggregate.rejectedNoteIds.push(...result.rejectedNoteIds);
      aggregate.gradeIds.push(...result.gradeIds);
      aggregate.batches += 1;
      if (result.eligibleRemaining === 0) break;
    }
    return NextResponse.json(
      { ok: true, ...aggregate, settledAt: new Date().toISOString() },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return routeErrorResponse(
      error,
      "تعذر إكمال التسوية اليومية لدرجات فترة السماح.",
    );
  }
}
