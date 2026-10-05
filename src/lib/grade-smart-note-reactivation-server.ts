import type { Prisma } from "@prisma/client";

export const DISMISSED_PENDING_GRADE_EXCLUSION_REASON =
  "أُدخلت الدرجة أثناء فصل الطالب، وحُفظت بعد إعادة التفعيل للتوثيق فقط دون أي خصم أو فصل أو محاسبة أكاديمية.";

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
 * A student who is not dismissed keeps no held grade. Each grade held while
 * the student was dismissed becomes a grade with no academic effect when the
 * exam has no official grade; when the exam already has one, the held grade
 * is deleted (the official grade stays as it is). A held score outside the
 * exam's current range is deleted too.
 *
 * Runs inside the transaction that ends the dismissal (a manual return, a
 * status action, or a recalculation that cancels it). createMany
 * (skipDuplicates) keeps a concurrent official grade authoritative.
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
      category: "DISMISSED_PENDING",
      status: { not: "PROCESSED" },
    },
    orderBy: [{ attemptedAt: "asc" }, { id: "asc" }],
    select: {
      id: true,
      examId: true,
      score: true,
      reason: true,
      exam: { select: { fullMark: true } },
    },
  });

  const remove = async (noteId: string) => {
    const deleted = await tx.gradeSmartNote.deleteMany({
      where: { id: noteId, category: "DISMISSED_PENDING", status: { not: "PROCESSED" } },
    });
    if (deleted.count > 0) {
      result.deleted += 1;
      result.deletedNoteIds.push(noteId);
    }
  };

  const markProcessed = async (noteId: string, gradeId: string) => {
    const processed = await tx.gradeSmartNote.updateMany({
      where: { id: noteId, category: "DISMISSED_PENDING", status: { not: "PROCESSED" } },
      data: {
        status: "PROCESSED",
        resolution:
          "نُقلت الدرجة بعد إعادة التفعيل للتوثيق فقط، وهي مستبعدة دائماً من الخصم والفصل والمحاسبة الأكاديمية.",
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
    const officialGrade = await tx.grade.findUnique({
      where: { studentId_examId: { studentId, examId: note.examId } },
      select: { id: true, smartNoteId: true },
    });

    if (officialGrade) {
      // Already this attempt's grade: only the note's status was behind.
      if (officialGrade.smartNoteId === note.id) await markProcessed(note.id, officialGrade.id);
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
          // نص قصير معتمد — البانر في الواجهة يشرح القصة كاملة
          notes: "درجة مؤجلة أثناء الفصل",
          academicAccountingChecked: false,
          academicEffectExcluded: true,
          academicEffectExclusionReason: DISMISSED_PENDING_GRADE_EXCLUSION_REASON,
          academicEffectExclusionSource: `GradeSmartNote:DISMISSED_PENDING:${note.id}`,
          smartNoteId: note.id,
        },
      ],
      skipDuplicates: true,
    });

    const migratedGrade = await tx.grade.findUnique({
      where: { studentId_examId: { studentId, examId: note.examId } },
      select: { id: true, smartNoteId: true },
    });
    if (migratedGrade?.smartNoteId === note.id) await markProcessed(note.id, migratedGrade.id);
    // An official grade arrived at the same moment: it wins, the held one goes.
    else await remove(note.id);
  }

  return result;
}

/**
 * After a recalculation: active students who still hold grades from a
 * dismissal (one the recalculation itself cancelled, or an older return)
 * have them settled. Dismissed students keep theirs; archived records are
 * read-only and are left alone.
 */
export async function settleHeldGradesOfActiveStudents(
  tx: Prisma.TransactionClient,
  studentIds: string[],
  actor: GradeSmartNoteResolutionActor = SYSTEM_RESOLUTION_ACTOR,
): Promise<DismissedPendingGradeMigrationResult[]> {
  if (studentIds.length === 0) return [];
  const held = await tx.gradeSmartNote.findMany({
    where: {
      studentId: { in: studentIds },
      category: "DISMISSED_PENDING",
      status: { not: "PROCESSED" },
      student: { status: "نشط" },
    },
    select: { studentId: true },
    distinct: ["studentId"],
  });
  const results: DismissedPendingGradeMigrationResult[] = [];
  for (const { studentId } of held) {
    results.push(await migrateDismissedPendingGradesAfterActivation(tx, studentId, actor));
  }
  return results;
}
