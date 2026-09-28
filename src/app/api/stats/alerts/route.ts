export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getAuthPrincipal, hasPermission, unauthorizedResponse, type AuthPrincipal } from "@/lib/server-auth";
import { routeErrorResponse } from "@/lib/route-helpers";
import { CALL_STUDENT_NOTE_CATEGORY, hasManualCallNote } from "@/lib/call-notes-filter";
import { studentScopeWhere } from "@/lib/student-scope";
import { baghdadTodayKey } from "@/lib/baghdad-time";
import { graceDateColumn } from "@/lib/grace-periods-server";
import { summarizeStudentLeaves, summaryMatchesFilter } from "@/lib/student-leave-status";

/**
 * GET /api/stats/alerts
 * The small numbers on the dashboard shortcuts and the sidebar. Each number
 * uses the same rule as the window it opens, and is sent only to someone
 * allowed to open that window; the others are null. Read-only.
 */
export type ShortcutAlerts = {
  /** Call notes not yet marked done («إدارة ملاحظات المكالمات»). */
  callNotesPending: number | null;
  /** Typed scores waiting for a decision (smart notes, status PENDING). */
  gradeReviewsPending: number | null;
  /** Students dismissed now. */
  dismissedStudents: number | null;
  /** Dismissed students whose code is not closed yet («اغلاق الكودات»). */
  codeClosuresPending: number | null;
  /** Students with a current or upcoming leave («إدارة الإجازات»). */
  currentLeaves: number | null;
  /** Grace periods running now or later («إدارة فترة السماح»). */
  currentGracePeriods: number | null;
  generatedAt: string;
};

function can(principal: AuthPrincipal, permissions: string[]) {
  return permissions.some((permission) => hasPermission(principal, permission));
}

export async function GET(req: NextRequest) {
  const principal = await getAuthPrincipal(req);
  if (!principal) return unauthorizedResponse();

  try {
    const today = baghdadTodayKey();
    const [callNotesPending, gradeReviewsPending, dismissedStudents, codeClosuresPending, currentLeaves, currentGracePeriods] =
      await Promise.all([
        can(principal, ["follow-up.calls.view", "follow-up.view"])
          ? db.studentCall.findMany({
              where: {
                category: CALL_STUDENT_NOTE_CATEGORY,
                noteResolved: false,
                notes: { not: "" },
                student: { is: studentScopeWhere("followup") },
              },
              select: { category: true, notes: true },
            }).then((notes) => notes.filter(hasManualCallNote).length)
          : null,
        can(principal, ["grades.view", "grades.add"])
          ? db.gradeSmartNote.count({ where: { status: "PENDING" } })
          : null,
        can(principal, ["students.view", "page.dismissed-students.view"])
          ? db.student.count({ where: { status: "مفصول" } })
          : null,
        can(principal, ["students.view"])
          ? db.student.count({ where: { status: "مفصول", dismissedChecked: false } })
          : null,
        can(principal, ["follow-up.leaves.view", "follow-up.view"])
          ? db.studentLeave.findMany({
              select: {
                studentId: true, leaveType: true, date: true, dateFrom: true, dateTo: true,
                exam: { select: { date: true } },
              },
            }).then((leaves) => {
              const byStudent = new Map<string, typeof leaves>();
              for (const leave of leaves) byStudent.set(leave.studentId, [...(byStudent.get(leave.studentId) || []), leave]);
              let current = 0;
              for (const studentLeaves of byStudent.values()) {
                const summary = summarizeStudentLeaves(
                  studentLeaves.map((leave) => ({ ...leave, examDate: leave.exam?.date || null })),
                  today,
                );
                if (summaryMatchesFilter(summary, "current")) current += 1;
              }
              return current;
            })
          : null,
        can(principal, ["students.view"])
          ? db.gracePeriod.count({ where: { cancelledAt: null, endDate: { gte: graceDateColumn(today) } } })
          : null,
      ]);

    const alerts: ShortcutAlerts = {
      callNotesPending,
      gradeReviewsPending,
      dismissedStudents,
      codeClosuresPending,
      currentLeaves,
      currentGracePeriods,
      generatedAt: new Date().toISOString(),
    };
    return NextResponse.json(alerts, { headers: { "Cache-Control": "private, no-store, max-age=0" } });
  } catch (error) {
    return routeErrorResponse(error, "تعذر تحميل أرقام الاختصارات حالياً.");
  }
}
