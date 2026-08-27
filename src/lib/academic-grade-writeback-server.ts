import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { getExamEntryAvailability, isExamOnOrAfterStudentRegistration } from "@/lib/exam-utils";
import {
  recalculateStudentsAcademicState,
  type AcademicServerRecalculationResult,
} from "@/lib/academic-recalculate-server";
import { isExamWithinStudentGraceWindow } from "@/lib/student-grace";
import { baghdadDateKey } from "@/lib/baghdad-time";
import {
  isPreRegistrationNumericGrade,
} from "@/lib/pre-registration-grade";
import { assertGradeStatusScoreConsistency } from "@/lib/grade-status-score-validation";
import { withSerializableTransaction } from "@/lib/serializable-transaction";
import { shouldEndGraceForNumericGrade } from "@/lib/grace-grade-activation";
import { endLeavesCoveringExamForGrade } from "@/lib/student-leave-grade-override-server";

// ----------------------------------------------------------------------------
// Stale Absence Notes — ROOT-CAUSE FIX
// ----------------------------------------------------------------------------
// Phrases that mark a Grade row as having been set by an AUTOMATIC batch
// operation (mark-missing-absent endpoint or a grace-period migration).
// When the teacher later corrects such a row to a real numeric grade, these
// phrases become stale and contradictory — the row now has status="درجة"
// with a real score, but a note saying "this student was absent".
//
// We detect and clear them whenever the row transitions from a non-"درجة"
// status to "درجة", unless the caller explicitly provided a new notes string
// that does NOT match any of these patterns.
const STALE_AUTOMATIC_ABSENCE_NOTES_PATTERNS = [
  "تسجيل جماعي كغائب",
  "تسجيل تلقائي: الامتحان يسبق تاريخ تسجيل الطالب",
  "تسجيل تلقائي: الطالب ضمن فترة السماح لهذا الامتحان",
  "تسجيل جماعي كغائب للطلاب غير المدخلة درجاتهم",
] as const;

function notesContainsStalePhrase(notes: string | null | undefined): boolean {
  if (!notes) return false;
  return STALE_AUTOMATIC_ABSENCE_NOTES_PATTERNS.some((phrase) =>
    notes.includes(phrase),
  );
}

/**
 * Decide what `notes` value to persist, given the previous state and the
 * caller-supplied next state. Returns one of:
 *
 *   - undefined    → caller did not provide notes, leave existing notes alone.
 *   - ""           → clear notes (write empty string).
 *   - "<text>"     → write this text.
 *
 * Rules:
 *
 *  1. If the status transitions from a non-"درجة" marker to "درجة"
 *     (teacher is correcting an absent/cheating row into a real grade),
 *     AND the caller-supplied notes are missing, empty, OR match the
 *     previous notes (echoed back unchanged) → replace with a fresh
 *     "تم تصحيح الدرجة يدوياً" note. This is the bug we are fixing.
 *
 *  2. Otherwise, return the caller-supplied notes unchanged. A user-typed
 *     note is always preserved exactly.
 *
 *  3. As an additional safety net: even if the status did NOT change,
 *     if the resulting notes string still contains one of the stale
 *     automatic-absence phrases AND the row's status is "درجة" with a
 *     real score → clear it. This catches any future regression that
 *     somehow leaks a stale phrase onto a graded row.
 */
function sanitizeStaleAbsenceNotes(input: {
  previousStatus: string | null;
  previousNotes: string | null;
  nextStatus: string;
  nextNotes: string | undefined;
  coercedToExcusedDueToLeave?: boolean;
  excusedLeaveReason?: string;
}): string | undefined {
  const {
    previousStatus,
    previousNotes,
    nextStatus,
    nextNotes,
    coercedToExcusedDueToLeave,
    excusedLeaveReason,
  } = input;

  // The caller's resolved notes value (may be undefined = no change).
  const callerNotes =
    nextNotes === undefined
      ? undefined
      : String(nextNotes || "");

  // Did the row transition from a non-"درجة" marker to "درجة"?
  const transitionedToScoredGrade =
    previousStatus &&
    previousStatus !== "درجة" &&
    nextStatus === "درجة";

  // Did the caller "echo back" the previous notes unchanged? This happens
  // when the grade-entry UI initializes draft.notes from the existing row
  // and then saves without the user touching the notes field.
  const echoedPreviousNotes =
    callerNotes !== undefined &&
    previousNotes !== null &&
    callerNotes === previousNotes;

  // Safety net: does the resulting notes still contain a stale phrase?
  const resultingNotesContainsStalePhrase =
    notesContainsStalePhrase(callerNotes) ||
    (callerNotes === undefined && notesContainsStalePhrase(previousNotes));

  // ROOT-CAUSE FIX (leave + absence coercion): if the caller tried to
  // mark an excused student as absent/cheating, we coerced the status to
  // "مجاز". Replace the stale absence note with an authoritative excused
  // note so the row never displays "تسجيل جماعي كغائب" on a "مجاز" record.
  if (coercedToExcusedDueToLeave) {
    const reason = excusedLeaveReason?.trim();
    return reason
      ? `الطالب مجاز من هذا الامتحان: ${reason}`
      : "الطالب مجاز من هذا الامتحان.";
  }

  // Rule 1: teacher corrected an absent/cheating row to a real grade,
  // and either didn't provide fresh notes, or echoed the old ones back.
  // Replace with a clean "corrected manually" note.
  if (
    transitionedToScoredGrade &&
    (callerNotes === undefined || callerNotes === "" || echoedPreviousNotes)
  ) {
    return "تم تصحيح الدرجة يدوياً بدلاً من التسجيل التلقائي السابق.";
  }

  // ROOT-CAUSE FIX (status="مجاز" with stale absence note): if the
  // resulting row is "مجاز" but the notes still contain a stale absence
  // phrase, replace it with the authoritative excused note. This catches
  // historical rows that already have the contradiction.
  if (
    nextStatus === "مجاز" &&
    resultingNotesContainsStalePhrase &&
    (callerNotes === undefined || callerNotes === "" || notesContainsStalePhrase(callerNotes))
  ) {
    if (callerNotes && !notesContainsStalePhrase(callerNotes)) {
      return callerNotes;
    }
    return "الطالب مجاز من هذا الامتحان.";
  }

  // Rule 3: safety net — clear any stale phrase that somehow ended up on
  // a graded row. This catches historical data even without a status change.
  if (
    nextStatus === "درجة" &&
    resultingNotesContainsStalePhrase &&
    (callerNotes === undefined || callerNotes === "" || notesContainsStalePhrase(callerNotes))
  ) {
    // If the caller explicitly provided a non-stale note, keep it.
    if (callerNotes && !notesContainsStalePhrase(callerNotes)) {
      return callerNotes;
    }
    // Otherwise clear it — the previous stale phrase has no business
    // sitting on a graded row.
    return callerNotes === "" ? "" : "تم تصحيح الدرجة يدوياً.";
  }

  // Rule 2: default — keep the caller's notes unchanged.
  return callerNotes;
}

export type AcademicGradeWritebackStatus =
  | "درجة"
  | "غائب"
  | "غش"
  | "مجاز"
  | "ضمن فترة السماح"
  | "قبل تسجيل الطالب";

type PrismaClientLike = typeof db | Prisma.TransactionClient;

export class AcademicGradeWritebackError extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = "AcademicGradeWritebackError";
    this.status = status;
  }
}

export interface AcademicGradeWritebackResult {
  grade: {
    id: string;
    studentId: string;
    examId: string;
    status: string;
    score: number | null;
    notes: string | null;
    academicAccountingChecked: boolean;
    academicEffectExcluded: boolean;
    academicEffectExclusionReason: string | null;
    academicEffectExclusionSource: string | null;
    smartNoteId: string | null;
    createdAt: Date;
    updatedAt: Date;
  };
  academicRecalculation: AcademicServerRecalculationResult;
  graceEnded: boolean;
  /** True when the exam predates registration and the student's registration
   *  date was moved back to the exam date so this numeric grade counts. */
  registrationBackdated: boolean;
  /** True when a typed numeric grade ended the leave(s) covering the exam. */
  leaveEndedByGrade: boolean;
}

export interface AcademicGradeWritebackInput {
  studentId: string;
  examId: string;
  status?: unknown;
  score?: unknown;
  notes?: unknown;
  academicAccountingChecked?: unknown;
  sourceLabel?: string;
  tx?: Prisma.TransactionClient;
  allowBlankGrade?: boolean;
  preserveExistingScoreWhenBlank?: boolean;
  blockOnLeave?: boolean;
  enforceExamAvailability?: boolean;
  allowDismissedExistingGradeCorrection?: boolean;
  deferAcademicRecalculation?: boolean;
}

export function normalizeAcademicGradeStatus(
  value: unknown,
  fallback: AcademicGradeWritebackStatus = "درجة",
): AcademicGradeWritebackStatus {
  const status = String(value ?? "").trim();
  return status === "غائب" ||
    status === "غش" ||
    status === "مجاز" ||
    status === "درجة" ||
    status === "ضمن فترة السماح" ||
    status === "قبل تسجيل الطالب"
    ? status
    : fallback;
}

function parseNumericScore(value: unknown): number | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || String(value).trim() === "") return null;
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    throw new AcademicGradeWritebackError("يجب إدخال درجة رقمية صحيحة.");
  }
  if (!Number.isInteger(numeric)) {
    throw new AcademicGradeWritebackError(
      "الدرجات الكسرية غير مدعومة. أدخل عدداً صحيحاً بدون أجزاء عشرية.",
    );
  }
  return numeric;
}

export function hasAcademicGradeWritebackPayload(
  body: Record<string, unknown>,
): boolean {
  return [
    "gradeStatus",
    "grade_status",
    "gradeScore",
    "grade_score",
    "score",
    "finalScore",
    "final_score",
    "academicAccountingChecked",
    "academic_accounting_checked",
  ].some((key) => body[key] !== undefined);
}

export function readAcademicGradeWritebackStatus(
  body: Record<string, unknown>,
  fallback: AcademicGradeWritebackStatus = "درجة",
): AcademicGradeWritebackStatus {
  return normalizeAcademicGradeStatus(
    body.gradeStatus ??
      body.grade_status ??
      body.gradeState ??
      body.grade_state,
    fallback,
  );
}

export function readAcademicGradeWritebackScore(
  body: Record<string, unknown>,
): unknown {
  if (body.gradeScore !== undefined) return body.gradeScore;
  if (body.grade_score !== undefined) return body.grade_score;
  if (body.finalScore !== undefined) return body.finalScore;
  if (body.final_score !== undefined) return body.final_score;
  if (body.score !== undefined) return body.score;
  return undefined;
}

function parseCourseIds(value: string | null | undefined): string[] {
  try {
    const parsed = JSON.parse(value || "[]");
    return Array.isArray(parsed) ? parsed.map(String).filter(Boolean) : [];
  } catch {
    return [];
  }
}

function dayStart(value: Date | string | null | undefined): Date | null {
  const key = baghdadDateKey(value);
  if (!key) return null;
  const date = new Date(`${key}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) ? date : null;
}

function dayEndExclusive(value: Date | string | null | undefined): Date | null {
  const start = dayStart(value);
  if (!start) return null;
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 1);
  return end;
}

async function hasBlockingLeave(
  client: PrismaClientLike,
  studentId: string,
  exam: { id: string; date: Date },
): Promise<boolean> {
  const examDayStart = dayStart(exam.date);
  const examDayEnd = dayEndExclusive(exam.date);
  const periodWhere: Prisma.StudentLeaveWhereInput[] = [];
  if (examDayStart && examDayEnd) {
    periodWhere.push({
      leaveType: "period",
      dateFrom: { lt: examDayEnd },
      dateTo: { gte: examDayStart },
    });
  }

  const leave = await client.studentLeave.findFirst({
    where: {
      studentId,
      OR: [{ examId: exam.id }, ...periodWhere],
    },
    select: { id: true },
  });
  return Boolean(leave);
}

export async function syncAcademicGradeWriteback(
  input: AcademicGradeWritebackInput,
): Promise<AcademicGradeWritebackResult | null> {
  const studentId = String(input.studentId || "").trim();
  const examId = String(input.examId || "").trim();
  if (!studentId || !examId) {
    throw new AcademicGradeWritebackError(
      "تعذر تحديد الطالب أو الامتحان لحفظ الدرجة.",
    );
  }

  // Every accepted grade write must be atomic, including callers that do not
  // already own a transaction. This guarantees that ending grace, replacing
  // the placeholder, and recalculating the student either all succeed or all
  // roll back together.
  if (!input.tx) {
    return withSerializableTransaction((tx) =>
      syncAcademicGradeWriteback({ ...input, tx }),
    );
  }

  const normalizedStatus = normalizeAcademicGradeStatus(input.status);
  let status: AcademicGradeWritebackStatus = normalizedStatus;
  // ROOT-CAUSE FIX (leave + absence contradiction): when the caller tries to
  // write a non-"درجة" marker status (غائب / غش) and the student has an
  // active leave, we coerce the status to "مجاز" instead of throwing. These
  // flags remember the coercion so we can also fix the notes field below.
  let coercedToExcusedDueToLeave = false;
  let excusedLeaveReason = "";
  /** True when a typed numeric grade ended the covering leave(s). */
  let leaveEndedByGrade = false;
  const scoreWasProvided = input.score !== undefined;

  // ROOT-CAUSE FIX: Enforce status/score consistency at the SINGLE writeback
  // chokepoint that every grade-writing path goes through. If the caller
  // passed a non-"درجة" status together with a non-null score, the assertion
  // throws an AcademicGradeWritebackError with a clear Arabic message. The DB
  // trigger (migration 20260820090000) and the CHECK constraint
  // `Grade_status_score_consistency` remain as the final safety nets.
  assertGradeStatusScoreConsistency(status, input.score);

  // Non-numeric states never consume or validate a stale numeric value from the client.
  const parsedScore =
    status === "درجة" ? parseNumericScore(input.score) : null;
  const score = parsedScore === undefined ? null : parsedScore;

  if (status === "درجة" && parsedScore === undefined && !input.allowBlankGrade) {
    return null;
  }

  const client = input.tx;
  const [student, exam] = await Promise.all([
    client.student.findUnique({
      where: { id: studentId },
      select: {
        id: true,
        courseId: true,
        status: true,
        createdAt: true,
        accountingGraceDays: true,
        gracePeriodStartDate: true,
        gracePeriodEndedAt: true,
      },
    }),
    client.exam.findUnique({
      where: { id: examId },
      select: {
        id: true,
        date: true,
        fullMark: true,
        courseIds: true,
        active: true,
        scheduledActivateAt: true,
      },
    }),
  ]);

  if (!student)
    throw new AcademicGradeWritebackError(
      "الطالب المرتبط بالدرجة غير موجود.",
      404,
    );
  if (!exam)
    throw new AcademicGradeWritebackError(
      "الامتحان المرتبط بالدرجة غير موجود.",
      404,
    );

  const studentCreatedAtStr = student.createdAt.toISOString();
  const examDateStr = exam.date.toISOString();
  const studentGraceStartStr = student.gracePeriodStartDate
    ? student.gracePeriodStartDate.toISOString()
    : null;
  const studentGraceEndedAtStr = student.gracePeriodEndedAt
    ? student.gracePeriodEndedAt.toISOString()
    : null;
  const examOnOrAfterRegistration = isExamOnOrAfterStudentRegistration(
    { createdAt: studentCreatedAtStr },
    { date: examDateStr },
  );
  const preRegistrationNumericGrade = isPreRegistrationNumericGrade({
    examOnOrAfterRegistration,
    status,
    score,
  });

  // CORE RULE: a successfully validated real numeric grade (zero included)
  // ends the student's currently active grace period immediately. Historical
  // pre-registration scores remain excluded and cannot establish continuity.
  // The same transaction then saves and recalculates this grade as the first
  // chargeable grade of the continuing student.
  const shouldEndGrace = shouldEndGraceForNumericGrade({
    student,
    status,
    score,
    examOnOrAfterRegistration,
  });
  let graceEnded = false;
  if (shouldEndGrace) {
    const endedAt = new Date();
    const ended = await client.student.updateMany({
      where: {
        id: studentId,
        gracePeriodEndedAt: null,
      },
      data: {
        accountingGraceDays: 0,
        gracePeriodStartDate: null,
        gracePeriodEndedAt: endedAt,
      },
    });
    graceEnded = ended.count > 0;

    // Retire legacy pending grace attempts for this student. Once grace is
    // explicitly ended they must not remain stuck as pending work, and they
    // are not promoted retroactively. Other smart-note categories and already
    // resolved historical records are untouched.
    await client.gradeSmartNote.updateMany({
      where: {
        studentId,
        category: "GRACE_SCORED",
        status: "PENDING",
      },
      data: {
        status: "REJECTED",
        resolution:
          "أُلغي التعليق لأن إدخال درجة رقمية أنهى فترة السماح واعتمد الدرجة للمحاسبة الأكاديمية.",
        resolvedAt: endedAt,
      },
    });
  }

  if (
    student.status === "مفصول" &&
    !input.allowDismissedExistingGradeCorrection &&
    !preRegistrationNumericGrade
  ) {
    throw new AcademicGradeWritebackError(
      "الطالب مفصول ولا يمكن اعتماد درجة جديدة له. أعد تفعيله أولاً من الإجراء المخصص.",
    );
  }
  if (student.status === "مؤرشف") {
    throw new AcademicGradeWritebackError(
      "الطالب مؤرشف ولا يمكن اعتماد درجات على ملفه المقروء فقط.",
    );
  }

  if (input.enforceExamAvailability !== false) {
    const availability = getExamEntryAvailability(exam);
    if (!availability.available) {
      throw new AcademicGradeWritebackError(
        `لا يمكن اعتماد الدرجة: ${availability.reason}`,
      );
    }
  }

  const courseIds = parseCourseIds(exam.courseIds);
  if (courseIds.length > 0 && !courseIds.includes(student.courseId)) {
    throw new AcademicGradeWritebackError("الطالب ليس ضمن دورات هذا الامتحان.");
  }

  if (status === "درجة") {
    if (score === null && !input.allowBlankGrade) {
      throw new AcademicGradeWritebackError(
        "يجب إدخال درجة رقمية صالحة قبل اعتماد الدرجة.",
      );
    }
    if (score !== null && score !== undefined) {
      const fullMark = Number(exam.fullMark || 0);
      if (score < 0 || score > fullMark) {
        throw new AcademicGradeWritebackError(
          `الدرجة يجب أن تكون رقماً بين 0 و ${fullMark}`,
        );
      }
    }
  }

  // PRE-REGISTRATION RULE: a numeric grade for an exam that predates the
  // student's registration moves the registration date back to the exam date,
  // ends any grace period, and is stored as a fully counted official grade.
  // Absence/cheating markers for such exams stay blocked; only manual numeric
  // grades establish this continuity.
  let registrationBackdated = false;
  if (preRegistrationNumericGrade) {
    const endedAt = new Date();
    const backdated = await client.student.updateMany({
      where: { id: studentId },
      data: {
        createdAt: exam.date,
        accountingGraceDays: 0,
        gracePeriodStartDate: null,
        gracePeriodEndedAt: endedAt,
      },
    });
    registrationBackdated = backdated.count > 0;

    // Historical pending pre-registration attempts for this student are
    // retired: the registration window now covers their exams and the grade
    // being saved here is the authoritative record.
    await client.gradeSmartNote.updateMany({
      where: {
        studentId,
        category: "BEFORE_REGISTRATION_PENDING",
        status: "PENDING",
      },
      data: {
        status: "REJECTED",
        resolution:
          "أُلغي التعليق لأن إدخال درجة رسمية قدّم تاريخ تسجيل الطالب إلى تاريخ الامتحان واعتمد الدرجة في سجله.",
        resolvedAt: endedAt,
      },
    });
  }

  if (
    input.blockOnLeave !== false &&
    (score !== undefined || status !== "درجة") &&
    !preRegistrationNumericGrade
  ) {
    const blockedByLeave = await hasBlockingLeave(client, studentId, exam);
    if (blockedByLeave) {
      // UNIFIED RULE: a real numeric grade (zero included) consciously
      // overrides the leave — the covering leave(s) end inside this same
      // transaction (مجاز markers cleared, backed-up grades restored) and the
      // typed grade is then stored counted below. Absence/cheating attempts
      // keep their coercion to "مجاز" so a leave can never be erased by a
      // non-numeric marker.
      if (status === "درجة" && typeof score === "number" && Number.isFinite(score)) {
        const leaveOverride = await endLeavesCoveringExamForGrade(
          client,
          studentId,
          exam,
        );
        leaveEndedByGrade = leaveOverride.endedLeaves > 0;
      } else if (status === "غائب" || status === "غش") {
        // ROOT-CAUSE FIX (leave + absence contradiction): silently COERCE the
        // status to "مجاز" so the row reflects the excused state. Notes are
        // sanitized below to remove the stale batch-absence phrase.
        const leaveRow = await client.studentLeave.findFirst({
          where: {
            studentId,
            OR: [{ examId }, { leaveType: "period" }],
          },
          select: { reason: true, leaveType: true },
        });
        coercedToExcusedDueToLeave = true;
        excusedLeaveReason = leaveRow?.reason || "";
        // Mutate `status` so the rest of the function (notes sanitization,
        // upsert, score handling) sees "مجاز".
        status = "مجاز";
      } else {
        throw new AcademicGradeWritebackError(
          "لا يمكن اعتماد درجة لطالب مجاز من هذا الامتحان.",
        );
      }
    }
  }

  // GRACE PERIOD & PRE-REGISTRATION PROTECTION:
  //
  // 1. PRE-REGISTRATION: A manually entered numeric score moves the student's
  //    registration date back to the exam date, ends grace, and is saved as a
  //    fully counted official Grade (see the backdating block above).
  //    Automatic absence/cheating remains blocked; the scoreless marker
  //    "قبل تسجيل الطالب" is still allowed for batch missing-entry protection.
  //
  // 2. GRACE PERIOD: If the exam falls within the student's grace
  //    period, block "غائب" and allow the server-generated
  //    "ضمن فترة السماح" marker instead. That marker is a real grade
  //    record but has no score and no academic accounting effect.
  //
  // "درجة" (actual score) and "غش" (cheating) are still allowed during
  // grace period.
  if (
    !examOnOrAfterRegistration &&
    status !== "قبل تسجيل الطالب" &&
    !preRegistrationNumericGrade
  ) {
    throw new AcademicGradeWritebackError(
      "لا يمكن تسجيل درجة أو غياب لهذا الطالب لأن الامتحان أقدم من تاريخ تسجيله. " +
      "الطالب لم يكن مسجلاً في النظام عند إجراء هذا الامتحان.",
      409,
    );
  }

  if (examOnOrAfterRegistration && status === "قبل تسجيل الطالب") {
    throw new AcademicGradeWritebackError(
      "لا يمكن تسجيل حالة قبل تسجيل الطالب لأن الامتحان ليس أقدم من تاريخ تسجيله.",
      409,
    );
  }

  if (
    status === "غائب" &&
    isExamWithinStudentGraceWindow(
      {
        createdAt: studentCreatedAtStr,
        accountingGraceDays: student.accountingGraceDays,
        gracePeriodStartDate: studentGraceStartStr,
        gracePeriodEndedAt: studentGraceEndedAtStr,
      },
      { date: examDateStr },
    )
  ) {
    throw new AcademicGradeWritebackError(
      "لا يمكن تسجيل غياب لهذا الطالب في هذا الامتحان لأنه ضمن فترة السماح. " +
      "فترة السماح تحمي الطالب من المحاسبة على الامتحانات خلالها.",
      409,
    );
  }

  if (
    status === "ضمن فترة السماح" &&
    !isExamWithinStudentGraceWindow(
      {
        createdAt: studentCreatedAtStr,
        accountingGraceDays: student.accountingGraceDays,
        gracePeriodStartDate: studentGraceStartStr,
        gracePeriodEndedAt: studentGraceEndedAtStr,
      },
      { date: examDateStr },
    )
  ) {
    throw new AcademicGradeWritebackError(
      "لا يمكن تسجيل حالة ضمن فترة السماح لأن الامتحان خارج فترة سماح الطالب.",
      409,
    );
  }

  const notes =
    input.notes === undefined
      ? input.sourceLabel
        ? `تم تحديث الدرجة من ${input.sourceLabel}.`
        : undefined
      : String(input.notes || "");

  // ROOT-CAUSE FIX (stale absence notes): When the teacher corrects an
  // absent / cheating / excused row into a real numeric grade, the previous
  // automatic "تسجيل جماعي كغائب" / "تسجيل تلقائي" note becomes stale and
  // contradictory (the row now has status="درجة" with a real score but a
  // note saying the student was absent). Detect this transition and replace
  // the stale note with a fresh "corrected manually" note.
  //
  // The fix only triggers when the caller did not provide a fresh notes
  // string (or echoed the same one back), so a user-typed note is always
  // preserved. This handles the production case where grade-entry.tsx
  // passes `notes: draft.notes` and draft.notes was initialized from the
  // existing row's stale absence note.
  const existingGrade = await client.grade.findUnique({
    where: { studentId_examId: { studentId, examId } },
    select: {
      status: true,
      notes: true,
      smartNoteId: true,
      academicEffectExclusionSource: true,
    },
  });

  if (
    graceEnded &&
    existingGrade?.smartNoteId &&
    String(existingGrade.academicEffectExclusionSource || "").startsWith(
      "GradeSmartNote:GRACE_SCORED:",
    )
  ) {
    await client.gradeSmartNote.updateMany({
      where: {
        id: existingGrade.smartNoteId,
        category: "GRACE_SCORED",
      },
      data: {
        status: "REJECTED",
        resolution:
          "استُبدلت الدرجة التاريخية بدرجة رسمية جديدة أنهت فترة السماح وبدأت المحاسبة الأكاديمية.",
        resolvedAt: new Date(),
      },
    });
  }
  const sanitizedNotes = sanitizeStaleAbsenceNotes({
    previousStatus: existingGrade?.status ?? null,
    previousNotes: existingGrade?.notes ?? null,
    nextStatus: status,
    nextNotes: notes,
    coercedToExcusedDueToLeave,
    excusedLeaveReason,
  });

  const shouldWriteScore =
    status !== "درجة" ||
    (scoreWasProvided &&
      !(
        input.preserveExistingScoreWhenBlank &&
        status === "درجة" &&
        score === null
      ));

  // A backdated pre-registration grade is a normal counted grade: after the
  // registration date moved to the exam date, no exclusion may remain (both
  // on this row and any older marker previously stored for the same exam).
  const registrationActivationData = registrationBackdated
    ? {
        academicEffectExcluded: false,
        academicEffectExclusionReason: null as string | null,
        academicEffectExclusionSource: null as string | null,
      }
    : {};
  if (registrationBackdated) {
    await client.grade.updateMany({
      where: {
        studentId,
        examId,
        academicEffectExcluded: true,
      },
      data: registrationActivationData,
    });
  }
  const graceActivationData = graceEnded
    ? {
        academicEffectExcluded: false,
        academicEffectExclusionReason: null,
        academicEffectExclusionSource: null,
        smartNoteId: null,
      }
    : {};

  const grade = await client.grade.upsert({
    where: { studentId_examId: { studentId, examId } },
    update: {
      status,
      ...(shouldWriteScore ? { score: status === "درجة" ? score : null } : {}),
      ...(sanitizedNotes !== undefined ? { notes: sanitizedNotes } : {}),
      ...(input.academicAccountingChecked !== undefined
        ? {
            academicAccountingChecked: Boolean(input.academicAccountingChecked),
          }
        : {}),
      ...registrationActivationData,
      ...graceActivationData,
    },
    create: {
      studentId,
      examId,
      status,
      score: status === "درجة" ? (score ?? null) : null,
      notes: sanitizedNotes || null,
      academicAccountingChecked: Boolean(input.academicAccountingChecked),
      ...registrationActivationData,
      ...graceActivationData,
    },
  });

  const academicRecalculation = input.deferAcademicRecalculation
    ? {
        studentIds: [studentId],
        students: [],
        opportunityLogs: [],
        automaticOpportunityLogs: [],
      }
    : await recalculateStudentsAcademicState(
        [studentId],
        input.tx ? { tx: input.tx } : {},
      );

  return {
    grade,
    academicRecalculation,
    graceEnded,
    registrationBackdated,
    leaveEndedByGrade,
  };
}
