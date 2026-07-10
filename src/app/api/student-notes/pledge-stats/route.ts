export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/server-auth";
import { db } from "@/lib/db";
import { withFollowupTables } from "@/lib/followup-schema";
import { routeErrorResponse } from "@/lib/route-helpers";

const PLEDGE_NOTE_KIND = "تعهد ولي الأمر";

function dismissalGroupFromType(
  type: string | null | undefined,
): "temporary" | "final" {
  const text = String(type || "");
  if (text.includes("نهائي") || text.includes("دائم")) return "final";
  return "temporary";
}

/**
 * إحصائيات التعهدات من بيانات النظام مباشرة.
 * لا تستخدم قائمة الطلاب المحملة في الواجهة لأنها قد تكون صفحة واحدة فقط.
 */
export async function GET(req: NextRequest) {
  const authError = await requirePermission(req, "follow-up.view");
  if (authError) return authError;

  try {
    const [dismissedStudents, pledgeNotes] = await withFollowupTables(
      () =>
        Promise.all([
          db.student.findMany({
            where: { status: "مفصول" },
            select: { id: true, dismissalType: true },
          }),
          db.studentNote.findMany({
            where: { kind: PLEDGE_NOTE_KIND },
            select: {
              studentId: true,
              dismissalType: true,
              student: { select: { id: true, status: true } },
            },
          }),
        ]),
      "PledgeStats",
    );

    const dismissedIds = new Set(
      dismissedStudents.map((student) => student.id),
    );
    const pledgedDismissedIds = new Set(
      pledgeNotes
        .filter((note) => dismissedIds.has(note.studentId))
        .map((note) => note.studentId),
    );

    const temporary = dismissedStudents.filter(
      (student) =>
        dismissalGroupFromType(student.dismissalType || "فصل مؤقت") ===
        "temporary",
    ).length;
    const final = dismissedStudents.filter(
      (student) =>
        dismissalGroupFromType(student.dismissalType || "فصل مؤقت") === "final",
    ).length;
    const reactivated = pledgeNotes.filter(
      (note) =>
        note.student?.status &&
        !["مفصول", "مؤرشف"].includes(note.student.status),
    ).length;

    return NextResponse.json({
      dismissed: dismissedStudents.length,
      temporary,
      final,
      pledged: pledgeNotes.length,
      pending: Math.max(0, dismissedStudents.length - pledgedDismissedIds.size),
      reactivated,
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
