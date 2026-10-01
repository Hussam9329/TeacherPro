export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/server-auth";
import { routeErrorResponse } from "@/lib/route-helpers";
import { withDatabaseSchema } from "@/lib/schema-readiness";
import { isDismissalActionNote, isDismissalOpportunityLog } from "@/lib/dismissed-history";

type DismissalLog = {
  action: string;
  reason: string | null;
  date: Date;
  examId: string | null;
  exam: { name: string; fullMark: number } | null;
};

/** The automatic dismissal behind the recorded reason, else the latest one with an exam. */
function dismissingExamLog(logs: DismissalLog[], dismissalReason: string | null): DismissalLog | null {
  const withExam = logs.filter((log) => log.action === "فصل تلقائي" && log.examId && log.exam);
  const recorded = `تلقائي: ${dismissalReason || ""}`.trim();
  return withExam.find((log) => String(log.reason || "").trim() === recorded) ||
    withExam.reduce<DismissalLog | null>((latest, log) => (!latest || log.date > latest.date ? log : latest), null);
}

/** «غياب», «غش» or «12 من 100»; null when neither the grade nor the reason says. */
function dismissalOutcome(
  grade: { status: string; score: number | null } | undefined,
  log: DismissalLog,
): string | null {
  const fullMark = log.exam?.fullMark;
  if (grade?.status === "غائب") return "غياب";
  if (grade?.status === "غش") return "غش";
  if (grade?.status === "درجة" && typeof grade.score === "number") return `${grade.score} من ${fullMark}`;
  const reason = String(log.reason || "");
  if (reason.includes("غش")) return "غش";
  if (reason.includes("غياب")) return "غياب";
  const score = reason.match(/\((\d+)\)/)?.[1] ?? (reason.includes("درجة صفر") ? "0" : null);
  return score === null ? null : `${score} من ${fullMark}`;
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
