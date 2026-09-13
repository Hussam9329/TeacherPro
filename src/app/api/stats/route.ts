export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

import { Prisma } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { requirePermissionPrincipal } from "@/lib/server-auth";
import { db } from "@/lib/db";
import {
  databaseMigrationRequiredResponse,
  isMissingDatabaseObjectError,
  routeErrorResponse,
} from "@/lib/route-helpers";

/**
 * All dashboard numbers are read from one repeatable-read snapshot. This keeps
 * student counts mutually consistent without locking or mutating production rows.
 */
export async function GET(req: NextRequest) {
  const principalOrError = await requirePermissionPrincipal(req, "system.dashboard");
  if (principalOrError instanceof NextResponse) return principalOrError;

  try {
    // Dashboard reads never materialize scheduled accounting mutations.
    const snapshot = await db.$transaction(
      async (tx) => {
        const now = new Date();
        const [activeCount, dismissedCount, totalCount] = await Promise.all([
          tx.student.count({ where: { status: "نشط" } }),
          tx.student.count({ where: { status: "مفصول" } }),
          tx.student.count(),
        ]);

        return {
          activeStudents: activeCount,
          dismissedStudents: dismissedCount,
          totalStudents: totalCount,
          source: "database" as const,
          generatedAt: now.toISOString(),
        };
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
        maxWait: 10_000,
        timeout: 55_000,
      },
    );

    return NextResponse.json(snapshot, {
      headers: { "Cache-Control": "private, no-store, max-age=0" },
    });
  } catch (error) {
    if (isMissingDatabaseObjectError(error)) {
      return databaseMigrationRequiredResponse(
        "بيانات لوحة النظام غير جاهزة بعد وتحتاج تحديث مخطط البيانات بواسطة مسؤول النظام. لم تتغير أي بيانات.",
      );
    }
    return routeErrorResponse(
      error,
      "تعذر تحميل إحصائيات لوحة النظام حالياً. لم تتغير أي بيانات.",
    );
  }
}
