import type { Prisma } from "@prisma/client";

export const DISMISSED_PENDING_GRADE_EXCLUSION_REASON =
  "أُدخلت الدرجة أثناء فصل الطالب، وحُفظت بعد إعادة التفعيل للتوثيق فقط دون أي خصم أو فصل أو محاسبة أكاديمية.";

export type GradeSmartNoteResolutionActor = {
  id?: string | null;
  name?: string | null;
};

export type DismissedPendingGradeMigrationResult = {
  processed: number;
  conflicts: number;
  processedNoteIds: string[];
  conflictNoteIds: string[];
  gradeIds: string[];
};

/**
 * Converts only unresolved DISMISSED_PENDING attempts after a student becomes
 * active. The created Grade is an immutable accounting exception: it remains
 * visible as a score but every academic engine must ignore it permanently.
 *
 * This function must run inside the same SERIALIZABLE transaction that
 * reactivates/restores the student. createMany(skipDuplicates) makes a
 * concurrent official grade authoritative without ever overwriting it.
 */
export async function migrateDismissedPendingGradesAfterActivation(
  tx: Prisma.TransactionClient,
  studentId: string,
  actor: GradeSmartNoteResolutionActor,
  resolvedAt = new Date(),
): Promise<DismissedPendingGradeMigrationResult> {
  const result: DismissedPendingGradeMigrationResult = {
    processed: 0,
    conflicts: 0,
    processedNoteIds: [],
    conflictNoteIds: [],
    gradeIds: [],
  };

  const notes = await tx.gradeSmartNote.findMany({
    where: {
      studentId,
      category: "DISMISSED_PENDING",
      status: "PENDING",
    },
    orderBy: [{ attemptedAt: "asc" }, { id: "asc" }],
    select: {
      id: true,
      examId: true,
      score: true,
      reason: true,
    },
  });

  for (const note of notes) {
    const officialGrade = await tx.grade.findUnique({
      where: {
        studentId_examId: { studentId, examId: note.examId },
      },
      select: { id: true, smartNoteId: true },
    });

    if (officialGrade) {
      const conflict = await tx.gradeSmartNote.updateMany({
        where: {
          id: note.id,
          category: "DISMISSED_PENDING",
          status: "PENDING",
        },
        data: {
          status: "CONFLICT",
          resolution:
            "لم تُنقل المحاولة لأن للطالب درجة رسمية محفوظة لهذا الامتحان؛ لم تُستبدل الدرجة الرسمية.",
          resolutionById: actor.id || null,
          resolutionByName: actor.name || null,
          resolvedAt,
        },
      });
      if (conflict.count > 0) {
        result.conflicts += 1;
        result.conflictNoteIds.push(note.id);
      }
      continue;
    }

    if (note.score === null || !Number.isInteger(note.score)) {
      const rejected = await tx.gradeSmartNote.updateMany({
        where: {
          id: note.id,
          category: "DISMISSED_PENDING",
          status: "PENDING",
        },
        data: {
          status: "REJECTED",
          resolution:
            "تعذر نقل المحاولة لأنها لا تحتوي على درجة رقمية صحيحة؛ لم يُنشأ سجل درجة.",
          resolutionById: actor.id || null,
          resolutionByName: actor.name || null,
          resolvedAt,
        },
      });
      if (rejected.count > 0) {
        result.conflicts += 1;
        result.conflictNoteIds.push(note.id);
      }
      continue;
    }

    if (!officialGrade) {
      await tx.grade.createMany({
        data: [
          {
            studentId,
            examId: note.examId,
            status: "درجة",
            score: note.score,
            notes: note.reason
              ? `درجة مؤجلة أثناء الفصل: ${note.reason}`
              : "درجة مؤجلة أثناء فصل الطالب.",
            academicAccountingChecked: false,
            academicEffectExcluded: true,
            academicEffectExclusionReason:
              DISMISSED_PENDING_GRADE_EXCLUSION_REASON,
            academicEffectExclusionSource: `GradeSmartNote:DISMISSED_PENDING:${note.id}`,
            smartNoteId: note.id,
          },
        ],
        skipDuplicates: true,
      });
    }

    const migratedGrade = await tx.grade.findUnique({
      where: {
        studentId_examId: { studentId, examId: note.examId },
      },
      select: { id: true, smartNoteId: true },
    });

    if (!migratedGrade || migratedGrade.smartNoteId !== note.id) {
      const conflict = await tx.gradeSmartNote.updateMany({
        where: {
          id: note.id,
          category: "DISMISSED_PENDING",
          status: "PENDING",
        },
        data: {
          status: "CONFLICT",
          resolution:
            "ظهرت درجة رسمية متزامنة لهذا الامتحان؛ احتُفظ بها ولم تُستبدل بالمحاولة المؤجلة.",
          resolutionById: actor.id || null,
          resolutionByName: actor.name || null,
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
        category: "DISMISSED_PENDING",
        status: "PENDING",
      },
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
      result.processedNoteIds.push(note.id);
      result.gradeIds.push(migratedGrade.id);
    }
  }

  return result;
}
