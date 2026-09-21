import type { Prisma, StudentCall } from "@prisma/client";
import { CALL_STUDENT_NOTE_CATEGORY, hasManualCallNote } from "@/lib/call-notes-filter";

type NoteActor = { id: string; name: string };

export class CallNoteMutationError extends Error {
  constructor(message: string, readonly status = 409, readonly studentCall?: StudentCall | null) {
    super(message);
  }
}

export function readExpectedNoteRevision(value: unknown): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new CallNoteMutationError("نسخة الملاحظة غير صالحة. حدّث القائمة وحاول مجدداً.", 400);
  }
  return value;
}

function assertNoteRevision(note: StudentCall | null, expectedRevision?: number) {
  if (expectedRevision !== undefined && (note?.noteRevision ?? 0) !== expectedRevision) {
    throw new CallNoteMutationError("تغيّرت الملاحظة لدى مستخدم آخر. راجع النسخة الجديدة ثم أعد المحاولة.", 409, note);
  }
}

async function lockNoteStudent(tx: Prisma.TransactionClient, studentId: string) {
  // This lock is also used for contact actions. It serializes edits, completion,
  // and nullable legacy note upserts without touching the student's own values.
  const students = await tx.$queryRaw<Array<{ id: string; courseId: string }>>`
    SELECT "id", "courseId" FROM "Student" WHERE "id" = ${studentId} FOR UPDATE
  `;
  if (!students.length) throw new CallNoteMutationError("الطالب غير موجود.", 404);
  return students[0];
}

async function auditNote(
  tx: Prisma.TransactionClient,
  actor: NoteActor,
  action: string,
  before: StudentCall | null,
  after: StudentCall | null,
) {
  await tx.auditLog.create({ data: {
    module: "المكالمات",
    action,
    userId: actor.id,
    userName: actor.name,
    details: JSON.stringify({ source: "call-note-management", before, after }),
  } });
}

async function writeNoteText(
  tx: Prisma.TransactionClient,
  actor: NoteActor,
  existing: StudentCall | null,
  input: { studentId: string; examId: string | null; notes: string; expectedRevision?: number },
) {
  const notes = input.notes.trim();
  if (existing && existing.notes.trim() === notes) {
    // Retried/same-text saves must not put a completed task back in the queue.
    return { studentCall: existing, deleted: false };
  }
  if (existing && input.expectedRevision === undefined) {
    throw new CallNoteMutationError("حدّث الملاحظة قبل تعديلها ثم أعد المحاولة.", 409, existing);
  }
  assertNoteRevision(existing, input.expectedRevision);
  if (!notes) {
    if (existing) {
      await tx.studentCall.delete({ where: { id: existing.id } });
      await auditNote(tx, actor, "حذف ملاحظة مكالمات", existing, null);
    }
    return { studentCall: null, deleted: true };
  }
  const studentCall = existing
    ? await tx.studentCall.update({ where: { id: existing.id }, data: {
        notes, noteResolved: false, noteRevision: { increment: 1 },
      } })
    : await tx.studentCall.create({ data: {
        studentId: input.studentId, examId: input.examId,
        category: CALL_STUDENT_NOTE_CATEGORY, notes,
        noteResolved: false, noteRevision: 1,
      } });
  await auditNote(tx, actor, existing ? "تعديل ملاحظة مكالمات" : "إضافة ملاحظة مكالمات", existing, studentCall);
  return { studentCall, deleted: false };
}

/** New notes are exam-specific. Historical general notes retain their own identity. */
export async function upsertExamCallNote(
  tx: Prisma.TransactionClient,
  actor: NoteActor,
  input: { studentId: string; examId: string | null; notes: string; expectedRevision?: number; expectedNoteId?: string | null },
) {
  if (!input.examId) throw new CallNoteMutationError("اختر الامتحان قبل حفظ الملاحظة.", 400);
  const student = await lockNoteStudent(tx, input.studentId);
  const examCourse = await tx.examCourse.findFirst({
    where: { examId: input.examId, courseId: student.courseId }, select: { id: true },
  });
  if (!examCourse) throw new CallNoteMutationError("الامتحان غير مرتبط بدورة الطالب.", 400);
  const existing = await tx.studentCall.findFirst({ where: {
    studentId: input.studentId, examId: input.examId, category: CALL_STUDENT_NOTE_CATEGORY,
  }, orderBy: [{ createdAt: "desc" }, { id: "desc" }] });
  // A revision alone is insufficient after delete/recreate: a fresh row can
  // have the same revision as the old one. Pin the row ID as well as its text version.
  const sameText = existing && existing.notes.trim() === input.notes.trim();
  if (!sameText && (existing?.id ?? null) !== (input.expectedNoteId ?? null)) {
    throw new CallNoteMutationError("تغيّرت الملاحظة لدى مستخدم آخر. راجع النسخة الجديدة ثم أعد المحاولة.", 409, existing);
  }
  return writeNoteText(tx, actor, existing, input);
}

/** A note may be edited by ID without moving a legacy general note to an exam. */
export async function editCallNote(
  tx: Prisma.TransactionClient,
  actor: NoteActor,
  input: { id: string; notes: string; expectedRevision?: number },
) {
  const initial = await tx.studentCall.findUnique({ where: { id: input.id } });
  if (!initial || initial.category !== CALL_STUDENT_NOTE_CATEGORY) {
    throw new CallNoteMutationError("ملاحظة المكالمات غير موجودة.", 404);
  }
  await lockNoteStudent(tx, initial.studentId);
  const existing = await tx.studentCall.findUnique({ where: { id: input.id } });
  if (!existing || existing.category !== CALL_STUDENT_NOTE_CATEGORY) {
    throw new CallNoteMutationError("تغيّرت الملاحظة. حدّث القائمة وحاول مجدداً.", 409, null);
  }
  return writeNoteText(tx, actor, existing, {
    studentId: existing.studentId, examId: existing.examId,
    notes: input.notes, expectedRevision: input.expectedRevision,
  });
}

export async function setCallNoteResolved(
  tx: Prisma.TransactionClient,
  actor: NoteActor,
  input: { id: string; expectedRevision: number; resolved: boolean },
) {
  const initial = await tx.studentCall.findUnique({ where: { id: input.id } });
  if (!initial || !hasManualCallNote(initial)) {
    throw new CallNoteMutationError("ملاحظة المكالمات غير موجودة.", 404);
  }
  await lockNoteStudent(tx, initial.studentId);
  const existing = await tx.studentCall.findUnique({ where: { id: input.id } });
  if (!existing || !hasManualCallNote(existing)) {
    throw new CallNoteMutationError("تغيّرت الملاحظة. حدّث القائمة وحاول مجدداً.", 409, null);
  }
  assertNoteRevision(existing, input.expectedRevision);
  if (existing.noteResolved === input.resolved) return existing;
  const studentCall = await tx.studentCall.update({
    where: { id: existing.id }, data: { noteResolved: input.resolved },
  });
  await auditNote(tx, actor, input.resolved ? "إنجاز ملاحظة مكالمات" : "إعادة فتح ملاحظة مكالمات", existing, studentCall);
  return studentCall;
}
