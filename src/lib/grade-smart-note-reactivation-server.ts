import type { Prisma } from "@prisma/client";

export const DISMISSED_PENDING_GRADE_EXCLUSION_REASON =
  "أُدخلت الدرجة أثناء فصل الطالب، وحُفظت بعد إعادة التفعيل للتوثيق فقط دون أي خصم أو فصل أو محاسبة أكاديمية.";

export const ARCHIVED_PENDING_GRADE_EXCLUSION_REASON =
  "وصلت الدرجة من Mirmaz Pro والطالب مؤرشف، وحُفظت بعد استعادته من الأرشيف للتوثيق فقط دون أي خصم أو فصل أو محاسبة أكاديمية.";

/**
 * Grades held on a student's file while it could take none, each becoming a
 * grade with no academic effect once the student is active again:
 * - DISMISSED_PENDING: typed while the student was dismissed;
 * - ARCHIVED_PENDING: from Mirmaz Pro while the student was archived.
 */
const HELD = {
  DISMISSED_PENDING: {
    reason: DISMISSED_PENDING_GRADE_EXCLUSION_REASON,
    // نص قصير معتمد — البانر في الواجهة يشرح القصة كاملة
    note: "درجة مؤجلة أثناء الفصل",
    resolution: "نُقلت الدرجة بعد إعادة التفعيل للتوثيق فقط، وهي مستبعدة دائماً من الخصم والفصل والمحاسبة الأكاديمية.",
  },
  ARCHIVED_PENDING: {
    reason: ARCHIVED_PENDING_GRADE_EXCLUSION_REASON,
    note: "درجة مؤجلة أثناء الأرشفة",
    resolution: "نُقلت الدرجة بعد الاستعادة من الأرشيف للتوثيق فقط، وهي مستبعدة دائماً من الخصم والفصل والمحاسبة الأكاديمية.",
  },
} as const;
type HeldCategory = keyof typeof HELD;
const HELD_CATEGORIES = Object.keys(HELD) as HeldCategory[];

export type GradeSmartNoteResolutionActor = {
  id?: string | null;
  name?: string | null;
};

export type DismissedPendingGradeMigrationResult = {
  processed: number;
  deleted: number;
  processedNoteIds: string[];
  deletedNoteIds: string[];
  gradeIds: string[];
};

/** Who settles held grades when the system itself ends a dismissal. */
export const SYSTEM_RESOLUTION_ACTOR: GradeSmartNoteResolutionActor = { id: null, name: "النظام" };

/**
 * An active student keeps no held grade. Each grade held while the student
 * was dismissed or archived becomes a grade with no academic effect when the
 * exam has no official grade; when the exam already has one, the held grade
 * is deleted (the official grade stays as it is). A held score outside the
 * exam's current range is deleted too.
 *
 * Runs inside the transaction that ends the dismissal or the archiving (a
 * manual return, a status action, a restore from the archive, or a
 * recalculation). createMany (skipDuplicates) keeps a concurrent official
 * grade authoritative.
 */
export async function migrateDismissedPendingGradesAfterActivation(
  tx: Prisma.TransactionClient,
  studentId: string,
  actor: GradeSmartNoteResolutionActor,
  resolvedAt = new Date(),
): Promise<DismissedPendingGradeMigrationResult> {
  const result: DismissedPendingGradeMigrationResult = {
    processed: 0,
    deleted: 0,
    processedNoteIds: [],
    deletedNoteIds: [],
    gradeIds: [],
  };

  // Every held attempt not yet turned into a grade, including ones an older
  // version marked «تعارض» or «مرفوضة».
  const notes = await tx.gradeSmartNote.findMany({
    where: {
      studentId,
      category: { in: HELD_CATEGORIES },
      status: { not: "PROCESSED" },
    },
    orderBy: [{ attemptedAt: "asc" }, { id: "asc" }],
    select: {
      id: true,
      category: true,
      examId: true,
      score: true,
      reason: true,
      exam: { select: { fullMark: true } },
    },
  });

  const remove = async (noteId: string) => {
    const deleted = await tx.gradeSmartNote.deleteMany({
      where: { id: noteId, category: { in: HELD_CATEGORIES }, status: { not: "PROCESSED" } },
    });
    if (deleted.count > 0) {
      result.deleted += 1;
      result.deletedNoteIds.push(noteId);
    }
  };

  const markProcessed = async (noteId: string, category: HeldCategory, gradeId: string) => {
    const processed = await tx.gradeSmartNote.updateMany({
      where: { id: noteId, category, status: { not: "PROCESSED" } },
      data: {
        status: "PROCESSED",
        resolution: HELD[category].resolution,
        resolutionById: actor.id || null,
        resolutionByName: actor.name || null,
        resolvedAt,
      },
    });
    if (processed.count > 0) {
      result.processed += 1;
      result.processedNoteIds.push(noteId);
      result.gradeIds.push(gradeId);
    }
  };

  for (const note of notes) {
    const category = note.category as HeldCategory;
    const officialGrade = await tx.grade.findUnique({
      where: { studentId_examId: { studentId, examId: note.examId } },
      select: { id: true, smartNoteId: true },
    });

    if (officialGrade) {
      // Already this attempt's grade: only the note's status was behind.
      if (officialGrade.smartNoteId === note.id) await markProcessed(note.id, category, officialGrade.id);
      // Two grades for one exam: the official one stays, the held one goes.
      else await remove(note.id);
      continue;
    }

    if (
      note.score === null ||
      !Number.isInteger(note.score) ||
      note.score < 0 ||
      note.score > Number(note.exam.fullMark || 0)
    ) {
      await remove(note.id);
      continue;
    }

    await tx.grade.createMany({
      data: [
        {
          studentId,
          examId: note.examId,
          status: "درجة",
          score: note.score,
          notes: HELD[category].note,
          academicAccountingChecked: false,
          academicEffectExcluded: true,
          academicEffectExclusionReason: HELD[category].reason,
          academicEffectExclusionSource: `GradeSmartNote:${category}:${note.id}`,
          smartNoteId: note.id,
        },
      ],
      skipDuplicates: true,
    });

    const migratedGrade = await tx.grade.findUnique({
      where: { studentId_examId: { studentId, examId: note.examId } },
      select: { id: true, smartNoteId: true },
    });
    if (migratedGrade?.smartNoteId === note.id) await markProcessed(note.id, category, migratedGrade.id);
    // An official grade arrived at the same moment: it wins, the held one goes.
    else await remove(note.id);
  }

  return result;
}

/**
 * After a recalculation: active students who still hold grades from a
 * dismissal or an archiving (one the recalculation itself cancelled, a
 * restore from the archive, or an older return) have them settled.
 * Dismissed students keep theirs; archived records are read-only and are
 * left alone.
 */
export async function settleHeldGradesOfActiveStudents(
  tx: Prisma.TransactionClient,
  studentIds: string[],
  actor: GradeSmartNoteResolutionActor = SYSTEM_RESOLUTION_ACTOR,
): Promise<Array<DismissedPendingGradeMigrationResult & { studentId: string }>> {
  if (studentIds.length === 0) return [];
  const held = await tx.gradeSmartNote.findMany({
    where: {
      studentId: { in: studentIds },
      category: { in: HELD_CATEGORIES },
      status: { not: "PROCESSED" },
      student: { status: "نشط" },
    },
    select: { studentId: true },
    distinct: ["studentId"],
  });
  const results: Array<DismissedPendingGradeMigrationResult & { studentId: string }> = [];
  for (const { studentId } of held) {
    results.push({ ...(await migrateDismissedPendingGradesAfterActivation(tx, studentId, actor)), studentId });
  }
  return results;
}
