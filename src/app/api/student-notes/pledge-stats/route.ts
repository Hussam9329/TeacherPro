export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/server-auth";
import { db } from "@/lib/db";
import { withDatabaseSchema } from "@/lib/schema-readiness";
import { routeErrorResponse } from "@/lib/route-helpers";

const PLEDGE_NOTE_KIND = "تعهد ولي الأمر";

/** إحصائيات التعهدات وفق سياسة الفصل الموحدة. */
export async function GET(req: NextRequest) {
  const authError = await requirePermission(req, "follow-up.view");
  if (authError) return authError;

  try {
    const [dismissedStudents, pledgeNotes] = await withDatabaseSchema(
      () =>
        Promise.all([
          db.student.findMany({
            where: { status: "مفصول" },
            select: { id: true },
          }),
          db.studentNote.findMany({
            where: { kind: PLEDGE_NOTE_KIND },
            select: {
              studentId: true,
              student: { select: { id: true, status: true } },
            },
          }),
        ]),
      "PledgeStats",
    );

    const dismissedIds = new Set(dismissedStudents.map((student) => student.id));
    const pledgedDismissedIds = new Set(
      pledgeNotes
        .filter((note) => dismissedIds.has(note.studentId))
        .map((note) => note.studentId),
    );
    const reactivatedIds = new Set(
      pledgeNotes
        .filter(
          (note) =>
            note.student?.status &&
            !["مفصول", "مؤرشف"].includes(note.student.status),
        )
        .map((note) => note.studentId),
    );

    return NextResponse.json({
      dismissed: dismissedStudents.length,
      pledged: pledgeNotes.length,
      pending: Math.max(0, dismissedStudents.length - pledgedDismissedIds.size),
      reactivated: reactivatedIds.size,
      source: "database" as const,
      generatedAt: new Date().toISOString(),
    });
  } catch (error) {
    return routeErrorResponse(
      error,
      "تعذر تحميل إحصائيات التعهدات من بيانات النظام.",
    );
  }
}
