export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { requireAuth } from "@/lib/server-auth";
import { routeErrorResponse } from "@/lib/route-helpers";
import { assertDatabaseSchemaReady } from "@/lib/schema-readiness";

// ============================================================================
// Every open tab polls this endpoint every 12 s. It used to COUNT(*) fourteen
// whole tables (Grade, AuditLog, OpportunityLog…) plus three MAX() on each
// poll, which loaded the database enough to slow or fail other requests.
//
// Now database triggers on those tables record each write statement as one
// row in "SyncChange" (migration 20261019120000_sync_change_markers), and this
// route reads, per scope, "SyncVersion"."folded" + the live SyncChange rows:
// fourteen small rows, whatever the size of the data. The response keeps the
// same keys (counts, maxDates, version) the client's inferChangedSyncScopes
// compares, but counts[key] is now a change counter that only grows, not the
// table's row count, and maxDates[key] is that scope's last change.
// ============================================================================

type SyncVersionRow = {
  scope: string;
  changes: bigint | number | string | null;
  changedAt: Date | string | null;
};

// Change rows older than this are folded into "SyncVersion"."folded", so
// "SyncChange" stays a few minutes of writes long.
const FOLD_AFTER_MINUTES = 10;
// At most one fold per server process per minute; polls in between only read.
const FOLD_EVERY_MS = 60_000;
let lastFoldAt = 0;

function toNumber(value: unknown): number {
  if (typeof value === "number") return value;
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "string") return Number(value) || 0;
  return 0;
}

function toIso(value: unknown): string {
  if (!value) return "";
  if (value instanceof Date) {
    return Number.isFinite(value.getTime()) ? value.toISOString() : "";
  }
  if (typeof value === "string") {
    const d = new Date(value);
    return Number.isFinite(d.getTime()) ? d.toISOString() : "";
  }
  return "";
}

// One statement, so a poll sees either the rows before the fold or the
// folded total, never both or neither: the counter does not move.
const FOLD_SQL = Prisma.sql`
  WITH "old" AS (
    DELETE FROM "SyncChange"
    WHERE "at" < CURRENT_TIMESTAMP - make_interval(mins => ${FOLD_AFTER_MINUTES})
    RETURNING "scope", "at"
  ),
  "agg" AS (
    SELECT "scope", COUNT(*) AS "n", MAX("at") AS "lastAt"
    FROM "old"
    GROUP BY "scope"
  )
  UPDATE "SyncVersion" AS v
  SET "folded" = v."folded" + "agg"."n",
      "changedAt" = GREATEST(v."changedAt", "agg"."lastAt")
  FROM "agg"
  WHERE v."scope" = "agg"."scope"
`;

const SYNC_VERSION_SQL = Prisma.sql`
  SELECT
    v."scope" AS "scope",
    v."folded" + COALESCE(c."n", 0) AS "changes",
    GREATEST(v."changedAt", c."lastAt") AS "changedAt"
  FROM "SyncVersion" AS v
  LEFT JOIN (
    SELECT "scope", COUNT(*) AS "n", MAX("at") AS "lastAt"
    FROM "SyncChange"
    GROUP BY "scope"
  ) AS c ON c."scope" = v."scope"
`;

async function foldOldChangesIfDue() {
  const now = Date.now();
  if (now - lastFoldAt < FOLD_EVERY_MS) return;
  lastFoldAt = now;
  try {
    await db.$executeRaw(FOLD_SQL);
  } catch {
    // Folding only keeps the change log short; the poll must not fail on it.
  }
}

export async function GET(req: NextRequest) {
  const authError = await requireAuth(req);
  if (authError) return authError;

  try {
    await assertDatabaseSchemaReady();
    await foldOldChangesIfDue();
    const rows = await db.$queryRaw<SyncVersionRow[]>(SYNC_VERSION_SQL);

    const counts: Record<string, number> = {};
    const maxDates: Record<string, string> = {};
    for (const row of rows) {
      counts[row.scope] = toNumber(row.changes);
      maxDates[row.scope] = toIso(row.changedAt);
    }

    const latestMs = Math.max(
      0,
      ...Object.values(maxDates).map((value) => {
        if (!value) return 0;
        const time = new Date(value).getTime();
        return Number.isFinite(time) ? time : 0;
      }),
    );

    const countFingerprint = Object.entries(counts)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, value]) => `${key}:${value}`)
      .join("|");
    const maxFingerprint = Object.entries(maxDates)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, value]) => `${key}:${value || "0"}`)
      .join("|");
    const version = `${latestMs}:${countFingerprint}:${maxFingerprint}`;

    return NextResponse.json({
      ok: true,
      version,
      latestAt: latestMs ? new Date(latestMs).toISOString() : null,
      counts,
      maxDates,
      source: "database",
      generatedAt: new Date().toISOString(),
    });
  } catch (error) {
    return routeErrorResponse(error, "تعذر فحص إصدار مزامنة البيانات.");
  }
}
