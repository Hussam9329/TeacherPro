export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

import { NextRequest, NextResponse } from "next/server";
import { requirePermissionPrincipal } from "@/lib/server-auth";
import { db } from "@/lib/db";
import { baghdadDateKey, baghdadTodayKey, parseBaghdadDateTime } from "@/lib/baghdad-time";
import { isDismissalActionNote, isDismissalOpportunityLog } from "@/lib/dismissed-history";
import {
  buildStudentTrend,
  parseStudentTrendRange,
  studentTrendDayKeys,
  type StudentTrend,
} from "@/lib/student-trend";
import {
  databaseMigrationRequiredResponse,
  isMissingDatabaseObjectError,
  routeErrorResponse,
} from "@/lib/route-helpers";

/**
 * GET /api/stats/trend?range=week|month|30d|90d
 * «إحصائيات الطلبة»: registrations, dismissals and active students per Baghdad
 * day. Same permission as the dashboard numbers. Read-only.
 */
export async function GET(req: NextRequest) {
  const principalOrError = await requirePermissionPrincipal(req, "system.dashboard");
  if (principalOrError instanceof NextResponse) return principalOrError;

  try {
    const range = parseStudentTrendRange(req.nextUrl.searchParams.get("range"));
    const now = new Date();
    const dayKeys = studentTrendDayKeys(range, baghdadTodayKey(now));
    const since = parseBaghdadDateTime(`${dayKeys[0]}T00:00`) as Date;

    const [activeNow, students, logs, notes] = await Promise.all([
      db.student.count({ where: { status: "نشط" } }),
      db.student.findMany({
        where: { createdAt: { gte: since }, status: { not: "مؤرشف" } },
        select: { id: true, createdAt: true },
      }),
      db.opportunityLog.findMany({
        where: {
          date: { gte: since },
          OR: [
            { action: "فصل تلقائي" },
            { action: "خصم", reason: { startsWith: "فصل الطالب" } },
            { action: "إعادة تفعيل" },
          ],
        },
        select: { studentId: true, action: true, reason: true, date: true },
      }),
      db.studentNote.findMany({
        where: {
          kind: "إجراء",
          OR: [{ text: { startsWith: "فصل الطالب" } }, { text: { startsWith: "تم فصل الطالب" } }],
          AND: [{ OR: [{ dismissalDate: { gte: since } }, { dismissalDate: null, date: { gte: since } }] }],
        },
        select: { studentId: true, kind: true, text: true, date: true, dismissalDate: true },
      }),
    ]);

    const trend: StudentTrend = {
      range,
      generatedAt: now.toISOString(),
      days: buildStudentTrend({
        dayKeys,
        activeNow,
        registrations: students.map((student) => ({ studentId: student.id, day: baghdadDateKey(student.createdAt) })),
        dismissals: [
          ...logs.filter(isDismissalOpportunityLog).map((log) => ({ studentId: log.studentId, day: baghdadDateKey(log.date) })),
          ...notes.filter(isDismissalActionNote).map((note) => ({ studentId: note.studentId, day: baghdadDateKey(note.dismissalDate || note.date) })),
        ],
        reactivations: logs
          .filter((log) => log.action === "إعادة تفعيل")
          .map((log) => ({ studentId: log.studentId, day: baghdadDateKey(log.date) })),
      }),
    };

    return NextResponse.json(trend, { headers: { "Cache-Control": "private, no-store, max-age=0" } });
  } catch (error) {
    if (isMissingDatabaseObjectError(error)) {
      return databaseMigrationRequiredResponse(
        "بيانات إحصائيات الطلبة غير جاهزة بعد وتحتاج تحديث مخطط البيانات بواسطة مسؤول النظام. لم تتغير أي بيانات.",
      );
    }
    return routeErrorResponse(error, "تعذر تحميل إحصائيات الطلبة حالياً. لم تتغير أي بيانات.");
  }
}
