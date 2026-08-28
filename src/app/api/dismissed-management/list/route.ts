export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/server-auth";
import { db } from "@/lib/db";
import { routeErrorResponse } from "@/lib/route-helpers";
import { buildDismissedStudentWhere } from "@/lib/dismissed-student-filters-server";
import { attachStudentOpportunitySnapshots } from "@/lib/student-opportunity-snapshot-server";
import { withStudentMutationToken } from "@/lib/student-mutation-token";

function positiveInteger(
  searchParams: URLSearchParams,
  key: string,
  fallback: number,
): number {
  const value = Number(searchParams.get(key) ?? fallback);
  if (!Number.isFinite(value) || value <= 0) return fallback;
  return Math.trunc(value);
}

export async function GET(req: NextRequest) {
  const authError = await requirePermission(req, "students.view");
  if (authError) return authError;

  try {
    const searchParams = new URL(req.url).searchParams;
    const page = positiveInteger(searchParams, "page", 1);
    const pageSize = Math.min(
      100,
      positiveInteger(searchParams, "pageSize", 50),
    );
    const where = buildDismissedStudentWhere(searchParams);

    const [totalCount, students] = await db.$transaction([
      db.student.count({ where }),
      db.student.findMany({
        where,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
    const studentsWithOpportunity = await attachStudentOpportunitySnapshots(
      students,
    );
    const studentIds = students.map((student) => student.id);
    const [dismissalNotes, dismissalLogs] = studentIds.length
      ? await db.$transaction([
          db.studentNote.findMany({
            where: {
              studentId: { in: studentIds },
              kind: "إجراء",
              OR: [
                { text: { startsWith: "فصل الطالب" } },
                { text: { startsWith: "تم فصل الطالب" } },
              ],
            },
            select: {
              studentId: true,
              text: true,
              dismissalReason: true,
              dismissalDate: true,
              date: true,
            },
            orderBy: [{ date: "desc" }, { id: "desc" }],
          }),
          db.opportunityLog.findMany({
            where: {
              studentId: { in: studentIds },
              OR: [
                { action: "فصل تلقائي" },
                { action: "خصم", reason: { startsWith: "فصل الطالب" } },
              ],
            },
            select: { studentId: true, reason: true, date: true },
            orderBy: [{ date: "desc" }, { id: "desc" }],
          }),
        ])
      : [[], []] as const;

    const lastDismissalByStudentId = new Map<
      string,
      { reason: string; date: string; time: number }
    >();
    const rememberDismissal = (studentId: string, reason: string, date: Date | null) => {
      const time = date?.getTime() || 0;
      const previous = lastDismissalByStudentId.get(studentId);
      if (previous && previous.time >= time) return;
      lastDismissalByStudentId.set(studentId, {
        reason: reason
          .replace(/^تلقائي:\s*/u, "")
          .replace(/^فصل الطالب:\s*/u, "")
          .trim(),
        date: date?.toISOString() || "",
        time,
      });
    };
    for (const note of dismissalNotes) {
      rememberDismissal(
        note.studentId,
        String(note.dismissalReason || note.text || ""),
        note.dismissalDate || note.date,
      );
    }
    for (const log of dismissalLogs) {
      rememberDismissal(log.studentId, String(log.reason || ""), log.date);
    }

    return NextResponse.json({
      students: studentsWithOpportunity.map((student) => {
        const lastDismissal = lastDismissalByStudentId.get(student.id);
        return withStudentMutationToken({
          ...(student as unknown as Record<string, unknown>),
          wasDismissed: true,
          lastDismissalReason:
            student.dismissalReason || lastDismissal?.reason || "",
          lastDismissalAt: lastDismissal?.date || "",
        });
      }),
      totalCount,
      page,
      pageSize,
      totalPages,
      hasMore: page < totalPages,
      source: "database" as const,
    });
  } catch (error) {
    return routeErrorResponse(
      error,
      "تعذر تحميل قائمة الطلاب المفصولين من بيانات النظام.",
    );
  }
}
