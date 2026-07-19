export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/server-auth";
import { db } from "@/lib/db";
import { baghdadDateKey } from "@/lib/baghdad-time";

const PLEDGE_NOTE_KIND = "تعهد ولي الأمر";

function dayKey(value: Date | string | null | undefined): string {
  return baghdadDateKey(value);
}

function normalizeDismissalText(value: string | null | undefined): string {
  return String(value || "")
    .replace(/\s+/g, " ")
    .replace(/[ـ]/g, "")
    .trim()
    .toLowerCase();
}

function isLikelyDismissalLog(log: { action: string; reason: string | null }, dismissalReason: string): boolean {
  const rawReason = String(log.reason || "");
  const logReason = normalizeDismissalText(rawReason);
  const normalizedReason = normalizeDismissalText(dismissalReason);
  return (
    log.action === "فصل تلقائي" ||
    (log.action === "خصم" && rawReason.startsWith("فصل الطالب")) ||
    Boolean(normalizedReason && logReason.includes(normalizedReason))
  );
}

export async function GET(req: NextRequest) {
  const authError = await requirePermission(req, "students.view");
  if (authError) return authError;

  const searchParams = new URL(req.url).searchParams;
  const requestedIds = String(searchParams.get("ids") || "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);

  const students = await db.student.findMany({
    where: {
      status: "مفصول",
      ...(requestedIds.length ? { id: { in: requestedIds } } : {}),
    },
    select: {
      id: true,
      dismissalType: true,
      dismissalReason: true,
      dismissalNotes: true,
      createdAt: true,
    },
    orderBy: { createdAt: "desc" },
  });

  if (students.length === 0) return NextResponse.json({ details: [] });

  const studentIds = students.map((student) => student.id);

  const [logs, grades, pledgeNotes, actionNotes] = await db.$transaction([
    db.opportunityLog.findMany({
      where: { studentId: { in: studentIds } },
      include: { exam: { select: { id: true, name: true, date: true, fullMark: true, type: true } } },
      orderBy: { date: "desc" },
    }),
    db.grade.findMany({
      where: { studentId: { in: studentIds } },
      include: { exam: { select: { id: true, name: true, date: true, fullMark: true, type: true } } },
      orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
    }),
    db.studentNote.findMany({
      where: { studentId: { in: studentIds }, kind: PLEDGE_NOTE_KIND },
      orderBy: { date: "desc" },
    }),
    db.studentNote.findMany({
      where: { studentId: { in: studentIds }, kind: "إجراء" },
      orderBy: { date: "desc" },
    }),
  ]);

  const logsByStudent = new Map<string, typeof logs>();
  for (const log of logs) {
    const list = logsByStudent.get(log.studentId) || [];
    list.push(log);
    logsByStudent.set(log.studentId, list);
  }

  const gradesByStudent = new Map<string, typeof grades>();
  for (const grade of grades) {
    const list = gradesByStudent.get(grade.studentId) || [];
    list.push(grade);
    gradesByStudent.set(grade.studentId, list);
  }

  const pledgeNotesByStudent = new Map<string, typeof pledgeNotes>();
  for (const note of pledgeNotes) {
    const list = pledgeNotesByStudent.get(note.studentId) || [];
    list.push(note);
    pledgeNotesByStudent.set(note.studentId, list);
  }

  const actionNotesByStudent = new Map<string, typeof actionNotes>();
  for (const note of actionNotes) {
    const list = actionNotesByStudent.get(note.studentId) || [];
    list.push(note);
    actionNotesByStudent.set(note.studentId, list);
  }

  const details = students.map((student) => {
    const type = student.dismissalType || "مفصول";
    const reason = student.dismissalReason || "لا يوجد سبب مسجل";
    const studentLogs = logsByStudent.get(student.id) || [];
    const dismissalLog =
      studentLogs.find((log) => log.action === "فصل تلقائي") ||
      studentLogs.find((log) => isLikelyDismissalLog(log, reason)) ||
      null;

    const studentGrades = gradesByStudent.get(student.id) || [];
    const linkedGrade = dismissalLog?.examId
      ? studentGrades.find((grade) => grade.examId === dismissalLog.examId) || null
      : null;
    const reasonGrade = linkedGrade || studentGrades.find((grade) => {
      const examName = normalizeDismissalText(grade.exam?.name || "");
      return Boolean(examName && normalizeDismissalText(reason).includes(examName));
    }) || null;

    const sourceNote = (actionNotesByStudent.get(student.id) || []).find((note) => {
      const text = normalizeDismissalText(note.text);
      return text.includes("فصل الطالب") || text.includes(normalizeDismissalText(reason));
    }) || null;

    const sourceType = dismissalLog ? "opportunity-log" : sourceNote ? "student-note" : "student-dismissal";
    const sourceId = dismissalLog?.id || sourceNote?.id || student.id;
    const dismissalDate = dayKey(dismissalLog?.date || sourceNote?.date || student.createdAt);
    const normalizedReason = normalizeDismissalText(reason);
    const pledgeNote = (pledgeNotesByStudent.get(student.id) || []).find((note) => {
      if (note.sourceType && note.sourceId) return note.sourceType === sourceType && note.sourceId === sourceId;
      const noteReason = normalizeDismissalText(note.dismissalReason || note.text);
      return !noteReason || noteReason.includes(normalizedReason) || normalizedReason.includes(noteReason);
    }) || (pledgeNotesByStudent.get(student.id) || [])[0] || null;

    const exam = dismissalLog?.exam || reasonGrade?.exam || null;

    return {
      studentId: student.id,
      type,
      reason,
      notes: student.dismissalNotes || "",
      dismissalDate,
      sourceType,
      sourceId,
      examName: exam?.name || "",
      examType: exam?.type || "",
      examDate: dayKey(exam?.date),
      lastGrade: reasonGrade
        ? {
            status: reasonGrade.status,
            score: reasonGrade.score,
            fullMark: reasonGrade.exam?.fullMark ?? null,
            notes: reasonGrade.notes || "",
            updatedAt: reasonGrade.updatedAt ? reasonGrade.updatedAt.toISOString() : "",
          }
        : null,
      hasPledge: Boolean(pledgeNote),
      pledgeText: pledgeNote?.text || "",
      pledgeDate: dayKey(pledgeNote?.date),
    };
  });

  return NextResponse.json({ details });
}
