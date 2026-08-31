import type { Prisma } from "@prisma/client";
import {
  getStudentGraceWindow,
  isDateWithinStudentGraceWindow,
  parseGraceDateOnly,
} from "@/lib/student-grace";
import { withSerializableTransaction } from "@/lib/serializable-transaction";

export type GracePendingGradeResolutionActor = {
  id?: string | null;
  name?: string | null;
};

export type GracePendingGradeMigrationResult = {
  processed: number;
  conflicts: number;
  rejected: number;
  stillInGrace: number;
  eligibleRemaining: number;
  processedNoteIds: string[];
  conflictNoteIds: string[];
  rejectedNoteIds: string[];
  gradeIds: string[];
};

export type ReconcileExpiredGracePendingGradesInput = {
  tx?: Prisma.TransactionClient;
  studentIds?: string[];
  examIds?: string[];
  noteIds?: string[];
  actor?: GracePendingGradeResolutionActor | null;
  now?: Date;
  batchSize?: number;
};

const GRACE_PLACEHOLDER_STATUS = "ضمن فترة السماح";

function uniqueIds(values: string[] | undefined): string[] {
  return Array.from(
    new Set((values || []).map((value) => String(value || "").trim()).filter(Boolean)),
  );
}

function emptyResult(): GracePendingGradeMigrationResult {
  return {
    processed: 0,
    conflicts: 0,
    rejected: 0,
    stillInGrace: 0,
    eligibleRemaining: 0,
    processedNoteIds: [],
    conflictNoteIds: [],
    rejectedNoteIds: [],
    gradeIds: [],
  };
}

function isGracePlaceholder(grade: {
  status: string;
  score: number | null;
  smartNoteId: string | null;
  academicEffectExcluded: boolean;
}): boolean {
  return (
    grade.status === GRACE_PLACEHOLDER_STATUS &&
    grade.score === null &&
    grade.smartNoteId === null &&
    grade.academicEffectExcluded === false
  );
}

/**
 * Finalizes numeric attempts captured while a student is inside their current
 * grace window. It is invoked only from write transactions and the protected
 * daily settlement job; ordinary read requests never mutate data. Until the
 * Baghdad calendar day reaches endExclusive, the attempt exists only as a
 * PENDING GradeSmartNote and therefore cannot affect opportunities,
 * dismissal, pass/fail, or averages.
 *
 * Once the window ends, the existing automatic "ضمن فترة السماح" placeholder
 * is upgraded in place. If no placeholder exists, a new Grade is inserted.
 * Any real Grade (numeric, absent, cheating, or another protected record) wins
 * and the note becomes CONFLICT without overwriting that Grade.
 *
 * The operation is idempotent and concurrency-safe. Callers already inside a
 * database transaction pass tx; other callers get a retried SERIALIZABLE
 * transaction automatically.
 */
export async function reconcileExpiredGracePendingGrades(
  input: ReconcileExpiredGracePendingGradesInput = {},
): Promise<GracePendingGradeMigrationResult> {

// GRACE_SCORED is historical-only. Normal recalculation and the old internal
// endpoint must never settle it implicitly; only the reviewed one-time
// migration command may run this converter.
if (process.env.ALLOW_LEGACY_GRACE_SCORED_MIGRATION !== "1") {
  return {
    legacyMigrationDisabled: true,
    processed: 0,
    message: "GRACE_SCORED settlement is available only through maintenance:grace:migrate",
  } as never;
}

  if (!input.tx) {
    return withSerializableTransaction((tx) =>
      reconcileExpiredGracePendingGrades({ ...input, tx }),
    );
  }

  const tx = input.tx;
  const studentIds = uniqueIds(input.studentIds);
  const examIds = uniqueIds(input.examIds);
  const noteIds = uniqueIds(input.noteIds);
  const result = emptyResult();
  const resolvedAt = input.now || new Date();
  const batchSize = Math.max(1, Math.min(500, Math.trunc(input.batchSize || 100)));
  const today = parseGraceDateOnly(resolvedAt);
  if (!today) return result;

  const notes = await tx.gradeSmartNote.findMany({
    where: {
      category: "GRACE_SCORED",
      status: "PENDING",
      ...(studentIds.length ? { studentId: { in: studentIds } } : {}),
      ...(examIds.length ? { examId: { in: examIds } } : {}),
      ...(noteIds.length ? { id: { in: noteIds } } : {}),
    },
    orderBy: [{ attemptedAt: "asc" }, { id: "asc" }],
    select: {
      id: true,
      studentId: true,
      examId: true,
      score: true,
      reason: true,
      examDateSnapshot: true,
      student: {
        select: {
          createdAt: true,
          accountingGraceDays: true,
          gracePeriodStartDate: true,
          gracePeriodEndedAt: true,
        },
      },
      exam: { select: { fullMark: true } },
    },
  });

  let eligibleSeen = 0;
  for (const note of notes) {
    const graceWindow = getStudentGraceWindow(note.student);
    // Missing/invalid source dates are not enough evidence to turn a pending
    // attempt into an official record. Leave it pending for explicit repair.
    const examSnapshotDate = parseGraceDateOnly(note.examDateSnapshot);
    const examStillInsideCurrentWindow = isDateWithinStudentGraceWindow(
      note.student,
      note.examDateSnapshot,
    );
    const windowEnded = Boolean(graceWindow && today >= graceWindow.endExclusive);
    const matured = Boolean(
      graceWindow &&
        (windowEnded ||
          Boolean(examSnapshotDate && !examStillInsideCurrentWindow)),
    );
    if (!matured) {
      result.stillInGrace += 1;
      continue;
    }
    eligibleSeen += 1;
    if (eligibleSeen > batchSize) {
      result.eligibleRemaining += 1;
      continue;
    }

    const fullMark = Number(note.exam.fullMark);
    if (
      note.score === null ||
      !Number.isInteger(note.score) ||
      !Number.isFinite(fullMark) ||
      note.score < 0 ||
      note.score > fullMark
    ) {
      const rejected = await tx.gradeSmartNote.updateMany({
        where: {
          id: note.id,
          category: "GRACE_SCORED",
          status: "PENDING",
        },
        data: {
          status: "REJECTED",
          resolution:
            "تعذر نقل المحاولة بعد انتهاء فترة السماح لأن الدرجة لم تعد ضمن نطاق الدرجة الكاملة الحالي للامتحان؛ لم يُنشأ سجل درجة.",
          resolutionById: input.actor?.id || null,
          resolutionByName: input.actor?.name || null,
          resolvedAt,
        },
      });
      if (rejected.count > 0) {
        result.rejected += 1;
        result.rejectedNoteIds.push(note.id);
      }
      continue;
    }

    const existingGrade = await tx.grade.findUnique({
      where: {
        studentId_examId: {
          studentId: note.studentId,
          examId: note.examId,
        },
      },
      select: {
        id: true,
        status: true,
        score: true,
        smartNoteId: true,
        academicEffectExcluded: true,
      },
    });

    const gradeData = {
      status: "درجة",
      score: note.score,
      notes: note.reason
        ? `درجة مؤجلة خلال فترة السماح: ${note.reason}`
        : "درجة مؤجلة خلال فترة سماح الطالب.",
      academicAccountingChecked: false,
      academicEffectExcluded: false,
      academicEffectExclusionReason: null,
      academicEffectExclusionSource: null,
      smartNoteId: note.id,
    } as const;

    let migratedGradeId: string | null = null;
    const existingGradeIsActual = Boolean(
      existingGrade && !isGracePlaceholder(existingGrade),
    );
    if (existingGrade && isGracePlaceholder(existingGrade)) {
      const upgraded = await tx.grade.updateMany({
        where: {
          id: existingGrade.id,
          status: GRACE_PLACEHOLDER_STATUS,
          score: null,
          smartNoteId: null,
          academicEffectExcluded: false,
        },
        data: gradeData,
      });
      if (upgraded.count > 0) migratedGradeId = existingGrade.id;
    } else if (!existingGrade) {
      await tx.grade.createMany({
        data: [
          {
            studentId: note.studentId,
            examId: note.examId,
            ...gradeData,
          },
        ],
        skipDuplicates: true,
      });
    }

    const migratedGrade = existingGradeIsActual
      ? null
      : migratedGradeId
        ? { id: migratedGradeId, smartNoteId: note.id }
        : await tx.grade.findUnique({
            where: {
              studentId_examId: {
                studentId: note.studentId,
                examId: note.examId,
              },
            },
            select: { id: true, smartNoteId: true },
          });

    if (!migratedGrade || migratedGrade.smartNoteId !== note.id) {
      const conflict = await tx.gradeSmartNote.updateMany({
        where: {
          id: note.id,
          category: "GRACE_SCORED",
          status: "PENDING",
        },
        data: {
          status: "CONFLICT",
          resolution:
            "لم تُنقل المحاولة بعد انتهاء فترة السماح لأن للطالب سجلاً فعلياً محفوظاً لهذا الامتحان؛ لم يُستبدل السجل الموجود.",
          resolutionById: input.actor?.id || null,
          resolutionByName: input.actor?.name || null,
          resolvedAt,
        },
      });
      if (conflict.count > 0) {
        result.conflicts += 1;
        result.conflictNoteIds.push(note.id);
      }
      continue;
    }

    const processed = await tx.gradeSmartNote.updateMany({
      where: {
        id: note.id,
        category: "GRACE_SCORED",
        status: "PENDING",
      },
      data: {
        status: "PROCESSED",
        resolution:
          "نُقلت الدرجة تلقائياً بعد انتهاء فترة السماح، وهي مستبعدة دائماً من الخصم والفصل والمحاسبة الأكاديمية.",
        resolutionById: input.actor?.id || null,
        resolutionByName: input.actor?.name || null,
        resolvedAt,
      },
    });
    if (processed.count > 0) {
      result.processed += 1;
      result.processedNoteIds.push(note.id);
      result.gradeIds.push(migratedGrade.id);
    }
  }

  return result;
}
