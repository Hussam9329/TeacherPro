export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/server-auth";
import { routeErrorResponse } from "@/lib/route-helpers";
import { withDatabaseSchema } from "@/lib/schema-readiness";
import { isDismissalActionNote, isDismissalOpportunityLog } from "@/lib/dismissed-history";

export async function GET(req: NextRequest) {
  const authError = await requirePermission(req, "students.view");
  if (authError) return authError;

  try {
    // Return one complete snapshot, including existing checked flags. The dialog
    // filters this list locally; pagination or separate count queries could hide
    // pending students or produce counts from a different moment in time.
    const sourceStudents = await withDatabaseSchema(() => db.student.findMany({
      where: { status: "مفصول" },
      select: {
        id: true,
        name: true,
        code: true,
        username: true,
        telegram: true,
        status: true,
        dismissedChecked: true,
        dismissedCheckEpoch: true,
        courseId: true,
        course: { select: { id: true, name: true } },
        dismissalReason: true,
        opportunityLogs: {
          where: {
            OR: [
              { action: "فصل تلقائي" },
              { action: "خصم", reason: { startsWith: "فصل الطالب" } },
            ],
          },
          select: { action: true, reason: true, date: true },
        },
        studentNotes: {
          where: {
            kind: "إجراء",
            OR: [
              { text: { startsWith: "فصل الطالب" } },
              { text: { startsWith: "تم فصل الطالب" } },
            ],
          },
          select: { kind: true, text: true, dismissalDate: true, date: true },
        },
      },
      orderBy: [{ name: "asc" }, { id: "asc" }],
    }), "Student");
    const students = sourceStudents.map(({ opportunityLogs, studentNotes, ...student }) => {
      // Use the same genuine dismissal evidence as dismissed management. Notes
      // may record the actual dismissal separately from when the note was added.
      // Never substitute registration or an unrelated update for a missing date.
      const times = [
        ...opportunityLogs.filter(isDismissalOpportunityLog).map((log) => log.date),
        ...studentNotes.filter(isDismissalActionNote).map((note) => note.dismissalDate || note.date),
      ].map((date) => date.getTime()).filter(Number.isFinite);
      return {
        ...student,
        lastDismissalAt: times.length ? new Date(Math.max(...times)).toISOString() : null,
      };
    });
    const checkedCount = students.reduce((count, student) => count + Number(student.dismissedChecked), 0);

    return NextResponse.json({
      students,
      totalCount: students.length,
      checkedCount,
      uncheckedCount: students.length - checkedCount,
      generatedAt: new Date().toISOString(),
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return routeErrorResponse(error, "تعذر تحميل قائمة اغلاق الكودات.");
  }
}
