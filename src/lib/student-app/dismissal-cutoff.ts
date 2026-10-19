/**
 * Read TeacherPro dismissal evidence for a student whose status is exactly
 * "مفصول"; never recalculate status or alter grades. A port of the Telegram
 * bot's `student_grade_visibility.py` so both clients hide the same grades:
 * the dismissal exam and everything after it, within the latest activation
 * period, chosen by exam chronology rather than grade-entry time.
 */
import type { Prisma } from "@prisma/client";

export type DismissalCutoff = {
  at: Date;
  examId: string | null;
  examName: string | null;
};

type LogRow = {
  id: string;
  studentId: string;
  examId: string | null;
  action: string;
  reason: string | null;
  date: Date;
  settledGradeIds: string | null;
  reversalOfLogId: string | null;
};
type ExamRow = { id: string; name: string; date: Date | null };
type GradeRow = { id: string; examId: string };
type NoteRow = {
  id: string;
  kind: string;
  text: string;
  date: Date;
  dismissalReason: string | null;
  dismissalDate: Date | null;
};

export type DismissalCutoffClient = {
  opportunityLog: { findMany(args: { where: { studentId: string } }): Promise<LogRow[]> };
  exam: { findMany(args: { where: { id: { in: string[] } } }): Promise<ExamRow[]> };
  grade: { findMany(args: { where: { studentId: string; id: { in: string[] } } }): Promise<GradeRow[]> };
  studentNote: { findMany(args: { where: { studentId: string } }): Promise<NoteRow[]> };
};

const REACTIVATION_ACTIONS = new Set(["إعادة تفعيل", "رصيد إعادة التفعيل", "رصيد بعد تعهد"]);
const AUTOMATIC_ACTIONS = new Set(["خصم تلقائي", "فصل تلقائي"]);

function utc(value: unknown): Date | null {
  return value instanceof Date && !Number.isNaN(value.getTime()) ? value : null;
}

/** Baghdad (UTC+3) calendar day key. */
function day(value: Date): string {
  return new Date(value.getTime() + 3 * 3600 * 1000).toISOString().slice(0, 10);
}

function reasonText(value: unknown): string {
  const text = String(value ?? "").replace(/ـ/g, "").replace(/\s+/g, " ").trim();
  return text.replace(/^(?:تلقائي|فصل الطالب|تم فصل الطالب)\s*:\s*/, "");
}

function isReactivation(log: LogRow): boolean {
  const reason = String(log.reason ?? "");
  return REACTIVATION_ACTIONS.has(log.action)
    || reason.includes("تثبيت إعادة التفعيل")
    || reason.includes("فرصتين بعد التعهد");
}

function isDismissalNote(note: NoteRow): boolean {
  return note.kind === "إجراء"
    && /^(?:فصل الطالب|تم فصل الطالب)(?:\s|$|\(|:)/.test(String(note.text ?? "").trim());
}

type Event = { when: Date; id: string; reason: string; cutoff: DismissalCutoff | null };

export async function loadDismissalCutoff(
  client: DismissalCutoffClient,
  student: { id: string; dismissalReason: string | null },
): Promise<DismissalCutoff | null> {
  const currentReason = reasonText(student.dismissalReason);
  const logs = await client.opportunityLog.findMany({ where: { studentId: student.id } });
  const examIds = [...new Set(logs.map((l) => l.examId).filter((id): id is string => Boolean(id)))];
  const exams = new Map(
    (examIds.length ? await client.exam.findMany({ where: { id: { in: examIds } } }) : []).map((e) => [e.id, e]),
  );
  const notes = await client.studentNote.findMany({ where: { studentId: student.id } });

  const recoveries = logs.filter((l) => isReactivation(l) && utc(l.date));
  const reactivatedAt = recoveries.reduce<Date | null>(
    (max, l) => (!max || l.date > max ? l.date : max), null);

  const settledIds = new Set<string>();
  const exemptExamIds = new Set<string>();
  const exemptLogIds = new Set<string>();
  if (reactivatedAt) {
    for (const log of recoveries) {
      if (day(log.date) !== day(reactivatedAt)) continue;
      if (log.settledGradeIds) {
        let ids: unknown;
        try { ids = JSON.parse(log.settledGradeIds); } catch { return null; }
        if (!Array.isArray(ids) || !ids.every((v) => typeof v === "string")) return null;
        for (const id of ids as string[]) settledIds.add(id);
      }
      const link = /\[academic-reactivation-link:([^\]]+)\]/.exec(String(log.reason ?? ""));
      if (link) {
        const values = new URLSearchParams(link[1]);
        values.getAll("sourceExamId").forEach((v) => exemptExamIds.add(v));
        values.getAll("sourceGradeId").forEach((v) => settledIds.add(v));
        values.getAll("sourceAutomaticLogId").forEach((v) => exemptLogIds.add(v));
      }
    }
  }
  if (settledIds.size) {
    const settled = await client.grade.findMany({ where: { studentId: student.id, id: { in: [...settledIds] } } });
    settled.forEach((g) => exemptExamIds.add(g.examId));
  }

  const reversedIds = new Set<string>();
  for (const log of logs) {
    if (AUTOMATIC_ACTIONS.has(log.action) || String(log.reason ?? "").startsWith("تلقائي:")) continue;
    const legacy = /\[undo-ref:([^\]]+)\]/.exec(String(log.reason ?? ""));
    const reference = log.reversalOfLogId || (legacy ? legacy[1] : null);
    if (reference) reversedIds.add(reference);
  }

  const events: Event[] = [];
  for (const log of logs) {
    const exam = log.examId ? exams.get(log.examId) ?? null : null;
    const reason = String(log.reason ?? "");
    const automatic = log.action === "فصل تلقائي";
    const manual = log.action === "خصم" && reason.trim().startsWith("فصل الطالب");
    const deductionReason = reasonText(`مخالفة بعد انتهاء الفرص - خصم يدوي: ${log.reason || "بدون سبب مسجل"}`);
    const deduction = log.action === "خصم" && currentReason === deductionReason && !reversedIds.has(log.id);
    if (!(automatic || manual || deduction)) continue;
    const when = (automatic && exam ? utc(exam.date) : null) ?? utc(log.date);
    if (!when) continue;
    if (reactivatedAt && (automatic ? day(when) < day(reactivatedAt) : when < reactivatedAt)) continue;
    let cutoff: DismissalCutoff | null;
    if (automatic) {
      if ((log.examId && exemptExamIds.has(log.examId)) || exemptLogIds.has(log.id)) continue;
      const examDate = exam ? utc(exam.date) : null;
      cutoff = exam && examDate ? { at: examDate, examId: exam.id, examName: exam.name } : null;
    } else {
      cutoff = { at: when, examId: null, examName: null };
    }
    events.push({ when, id: String(log.id), reason: deduction ? deductionReason : reasonText(log.reason), cutoff });
  }
  for (const note of notes) {
    if (!isDismissalNote(note)) continue;
    const when = utc(note.dismissalDate) ?? utc(note.date);
    if (!when || (reactivatedAt && when < reactivatedAt)) continue;
    const reason = note.dismissalReason || String(note.text ?? "").split(" - ملاحظة:")[0];
    events.push({ when, id: String(note.id), reason: reasonText(reason), cutoff: { at: when, examId: null, examName: null } });
  }

  const candidates = currentReason ? events.filter((e) => e.reason === currentReason) : events;
  if (!candidates.length) return null;
  const key = (e: Event): [number, string, string] => [e.when.getTime(), e.cutoff?.examId ?? "", e.id];
  const winner = candidates.reduce((best, e) => {
    const [a, b] = [key(e), key(best)];
    const greater = a[0] !== b[0] ? a[0] > b[0] : a[1] !== b[1] ? a[1] > b[1] : a[2] > b[2];
    return greater ? e : best;
  });
  return winner.cutoff;
}

/** Apply before `take`: hidden newer rows must not crowd out older grades. */
export function gradeBeforeCutoff(cutoff: DismissalCutoff): Prisma.GradeWhereInput {
  if (!cutoff.examId) return { exam: { date: { lt: cutoff.at } } };
  return {
    examId: { not: cutoff.examId },
    exam: { OR: [{ date: { lt: cutoff.at } }, { date: cutoff.at, id: { lt: cutoff.examId } }] },
  };
}
