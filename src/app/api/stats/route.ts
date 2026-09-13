export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

import { Prisma } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import {
  hasPermission,
  requirePermissionPrincipal,
} from "@/lib/server-auth";
import { db } from "@/lib/db";
import {
  databaseMigrationRequiredResponse,
  isMissingDatabaseObjectError,
  routeErrorResponse,
} from "@/lib/route-helpers";
import {
  extractAuditEntityIds,
  type AuditLogEntityLabels,
} from "@/lib/audit-log-display";
import { sanitizeDashboardAuditLog } from "@/lib/dashboard-stats";

type StatsClient = Prisma.TransactionClient;

async function readRecentDashboardLogs(
  tx: StatsClient,
  canViewLogs: boolean,
) {
  if (!canViewLogs) return [];
  const logs = await tx.auditLog.findMany({
    orderBy: [{ time: "desc" }, { id: "desc" }],
    take: 6,
    select: {
      id: true,
      module: true,
      action: true,
      details: true,
      userName: true,
      time: true,
    },
  });

  const studentIds = new Set<string>();
  const examIds = new Set<string>();
  for (const log of logs) {
    const ids = extractAuditEntityIds(log.details);
    ids.studentIds.forEach((id) => studentIds.add(id));
    ids.examIds.forEach((id) => examIds.add(id));
  }

  const [students, exams] = await Promise.all([
    studentIds.size
      ? tx.student.findMany({
          where: { id: { in: Array.from(studentIds) } },
          select: { id: true, name: true, code: true },
        })
      : Promise.resolve([]),
    examIds.size
      ? tx.exam.findMany({
          where: { id: { in: Array.from(examIds) } },
          select: { id: true, name: true },
        })
      : Promise.resolve([]),
  ]);
  const labels: AuditLogEntityLabels = {
    students: Object.fromEntries(
      students.map((student) => [
        student.id,
        student.code ? `${student.name} (${student.code})` : student.name,
      ]),
    ),
    exams: Object.fromEntries(exams.map((exam) => [exam.id, exam.name])),
  };
  return logs.map((log) => sanitizeDashboardAuditLog(log, labels));
}

/**
 * All dashboard numbers are read from one repeatable-read snapshot. This keeps
 * student counts and recent activity mutually consistent without locking or mutating any
 * production rows.
 */
export async function GET(req: NextRequest) {
  const principalOrError = await requirePermissionPrincipal(req, "system.dashboard");
  if (principalOrError instanceof NextResponse) return principalOrError;
  const canViewLogs = hasPermission(principalOrError, "logs.view");

  try {
    // Dashboard reads never materialize scheduled accounting mutations.
    const snapshot = await db.$transaction(
      async (tx) => {
        const now = new Date();
        const [activeCount, dismissedCount, totalCount, recentLogs] = await Promise.all([
          tx.student.count({ where: { status: "نشط" } }),
          tx.student.count({ where: { status: "مفصول" } }),
          tx.student.count(),
          readRecentDashboardLogs(tx, canViewLogs),
        ]);

        return {
          activeStudents: activeCount,
          dismissedStudents: dismissedCount,
          totalStudents: totalCount,
          recentLogs,
          canViewLogs,
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
