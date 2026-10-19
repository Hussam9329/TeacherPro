export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/server-auth";
import { routeErrorResponse } from "@/lib/route-helpers";
import { withDatabaseSchema } from "@/lib/schema-readiness";
import { isDismissalActionNote, isDismissalOpportunityLog } from "@/lib/dismissed-history";
import { BOT_NOTICE_SENT_ACTION, dismissalOutcome, dismissingExamLog, readBotNoticeDetails } from "@/lib/code-closure-dismissal";

/**
 * When each closed code was closed: the latest «اغلاق كود الطالب المفصول»
 * in «السجلات» since the student's current dismissal (every close goes
 * through setDismissedCheck, which writes that line). One read; a missing
 * date never blocks the list.
 */
async function codeClosedTimes(students: Array<{ id: string; lastDismissalAt: string | null }>): Promise<Map<string, string>> {
  const closedAt = new Map<string, string>();
  if (students.length === 0) return closedAt;
  const dismissedAt = new Map(students.map((student) => [student.id, student.lastDismissalAt ? Date.parse(student.lastDismissalAt) : 0]));
  const known = [...dismissedAt.values()];
  const since = known.every((time) => time > 0) ? new Date(Math.min(...known)) : null;
  const rows = await Promise.resolve().then(() => db.auditLog.findMany({
    where: { module: "سجل الطلاب", action: "اغلاق كود الطالب المفصول", ...(since ? { time: { gte: since } } : {}) },
    select: { time: true, details: true },
    orderBy: { time: "asc" },
  })).catch((error: unknown) => {
    console.error("[code-closures] closing dates from the log:", error);
    return [] as Array<{ time: Date; details: string | null }>;
  });
  for (const row of rows) {
    try {
      const studentId = String((JSON.parse(String(row.details || "")) as { studentId?: string } | null)?.studentId || "");
      const from = dismissedAt.get(studentId);
      if (from !== undefined && row.time.getTime() >= from) closedAt.set(studentId, row.time.toISOString());
    } catch {
      // A line that is not JSON names no student.
    }
  }
  return closedAt;
}

/**
 * When the bot delivered the dismissal notice to each student, for the
 * current dismissal episode only (a later dismissal starts unsent). One read;
 * a failed read never blocks the list.
 */
async function botNoticeSentTimes(students: Array<{ id: string; dismissedCheckEpoch: number }>): Promise<Map<string, string>> {
  const sentAt = new Map<string, string>();
  if (students.length === 0) return sentAt;
  const epochs = new Map(students.map((student) => [student.id, student.dismissedCheckEpoch]));
  const rows = await Promise.resolve().then(() => db.auditLog.findMany({
    where: { module: "سجل الطلاب", action: BOT_NOTICE_SENT_ACTION },
    select: { time: true, details: true },
    orderBy: { time: "asc" },
  })).catch((error: unknown) => {
    console.error("[code-closures] bot notices from the log:", error);
    return [] as Array<{ time: Date; details: string | null }>;
  });
  for (const row of rows) {
    const notice = readBotNoticeDetails(row.details);
    if (notice && epochs.get(notice.studentId) === notice.epoch) sentAt.set(notice.studentId, row.time.toISOString());
  }
  return sentAt;
}

export async function GET(req: NextRequest) {
  const authError = await requirePermission(req, "students.view");
  if (authError) return authError;

  try {
    // Return one complete snapshot, including existing checked flags. The dialog
    // filters this list locally; pagination or separate count queries could hide
    // pending students or produce counts from a different moment in time.
    const { sourceStudents, dismissingLogs, grades } = await withDatabaseSchema(async () => {
      const sourceStudents = await db.student.findMany({
        where: { status: "مفصول" },
        select: {
          id: true,
          name: true,
          code: true,
          phone: true,
          username: true,
          telegram: true,
          status: true,
          dismissedChecked: true,
          dismissedCheckEpoch: true,
          closurePlatformEpoch: true,
          closureTelegramEpoch: true,
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
            select: { action: true, reason: true, date: true, examId: true, exam: { select: { name: true, fullMark: true } } },
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
      });
      // The exam and result named in the Telegram notice.
      const dismissingLogs = new Map(sourceStudents.flatMap((student) => {
        const log = dismissingExamLog(student.opportunityLogs, student.dismissalReason);
        return log ? [[student.id, log] as const] : [];
      }));
      const grades = dismissingLogs.size ? await db.grade.findMany({
        where: { OR: [...dismissingLogs].map(([studentId, log]) => ({ studentId, examId: log.examId as string })) },
        select: { studentId: true, examId: true, status: true, score: true },
      }) : [];
      return { sourceStudents, dismissingLogs, grades };
    }, "Student");
    const students = sourceStudents.map(({ opportunityLogs, studentNotes, ...student }) => {
      // Use the same genuine dismissal evidence as dismissed management. Notes
      // may record the actual dismissal separately from when the note was added.
      // Never substitute registration or an unrelated update for a missing date.
      const times = [
        ...opportunityLogs.filter(isDismissalOpportunityLog).map((log) => log.date),
        ...studentNotes.filter(isDismissalActionNote).map((note) => note.dismissalDate || note.date),
      ].map((date) => date.getTime()).filter(Number.isFinite);
      const log = dismissingLogs.get(student.id);
      const grade = log && grades.find((item) => item.studentId === student.id && item.examId === log.examId);
      return {
        ...student,
        lastDismissalAt: times.length ? new Date(Math.max(...times)).toISOString() : null,
        dismissalExamName: log?.exam?.name ?? null,
        dismissalOutcome: log ? dismissalOutcome(grade, log) : null,
      };
    });
    const checkedCount = students.reduce((count, student) => count + Number(student.dismissedChecked), 0);
    const [closedAt, noticeSentAt] = await Promise.all([
      codeClosedTimes(students.filter((student) => student.dismissedChecked)),
      botNoticeSentTimes(students),
    ]);

    return NextResponse.json({
      students: students.map((student) => ({
        ...student,
        codeClosedAt: student.dismissedChecked ? closedAt.get(student.id) ?? null : null,
        botNoticeSentAt: noticeSentAt.get(student.id) ?? null,
      })),
      totalCount: students.length,
      checkedCount,
      uncheckedCount: students.length - checkedCount,
      generatedAt: new Date().toISOString(),
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return routeErrorResponse(error, "تعذر تحميل قائمة اغلاق الكودات.");
  }
}
