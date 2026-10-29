import type { Prisma } from "@prisma/client";
import { recalculateStudentsAcademicState } from "@/lib/academic-recalculate-server";
import { ARCHIVED_STUDENT_STATUS } from "@/lib/student-delete-impact";

export type ActiveChapterSnapshot = {
  id: string;
  name: string;
  opportunities: number;
};

export type ActiveChapterResolution =
  | { kind: "missing"; activeCount: 0 }
  | { kind: "conflict"; activeCount: number }
  | {
      kind: "zero-limit";
      activeCount: 1;
      chapter: ActiveChapterSnapshot;
      opportunities: 0;
    }
  | {
      kind: "ready";
      activeCount: 1;
      chapter: ActiveChapterSnapshot;
      opportunities: number;
    };

/** A refused restore: nothing was written. Answered as 409. */
export class ArchiveRestoreError extends Error {
  readonly statusCode = 409 as const;
  constructor(message: string, public readonly errorKind: string) {
    super(message);
    this.name = "ArchiveRestoreError";
  }
}

export async function getActiveChapterForCourse(
  tx: Prisma.TransactionClient,
  courseId: string,
): Promise<ActiveChapterResolution> {
  const links = await tx.courseChapter.findMany({
    where: { courseId, active: true, archived: false },
    select: {
      chapter: { select: { id: true, name: true, opportunities: true } },
    },
  });

  if (links.length === 0) {
    return { kind: "missing", activeCount: 0 };
  }
  if (links.length > 1) {
    return { kind: "conflict", activeCount: links.length };
  }

  const chapter = links[0].chapter;
  const opportunities = Math.max(
    0,
    Math.trunc(Number(chapter.opportunities || 0)),
  );
  if (opportunities <= 0) {
    return {
      kind: "zero-limit",
      activeCount: 1,
      chapter,
      opportunities: 0,
    };
  }
  return {
    kind: "ready",
    activeCount: 1,
    chapter,
    opportunities,
  };
}

export function chapterFromResolution(
  resolution: ActiveChapterResolution,
): ActiveChapterSnapshot | null {
  return resolution.kind === "ready" || resolution.kind === "zero-limit"
    ? resolution.chapter
    : null;
}

/**
 * The core of «استعادة من الأرشيف», inside the caller's transaction: the
 * student leaves the archive at the active chapter's balance and their file is
 * recalculated. Each caller writes its own note and audit line.
 *
 * `status` is the state the student returns to. «نشط» (the plain restore)
 * clears any dismissal; «مفصول» («الغاء الانسحاب» of a dismissed student)
 * keeps the stored dismissal at 0 opportunities, and the recalculation then
 * decides it exactly as for any dismissed student. `data` adds fields written
 * in the same update, such as the name.
 */
export async function restoreArchivedStudentInTransaction(
  tx: Prisma.TransactionClient,
  student: { id: string; courseId: string; status: string },
  options: {
    status?: "نشط" | "مفصول";
    data?: Prisma.StudentUpdateInput;
  } = {},
) {
  if (student.status !== ARCHIVED_STUDENT_STATUS) {
    throw new ArchiveRestoreError(
      "إجراء الاستعادة مخصص للطلاب المؤرشفين فقط. حدّث سجل الطالب ثم أعد المحاولة.",
      "not-archived",
    );
  }

  // The chapter state is authoritative only when read inside this same
  // serializable transaction. Never restore at a guessed zero balance:
  // the administrator must first resolve a missing, conflicting, or
  // zero-limit active chapter.
  const activeChapterResolution = await getActiveChapterForCourse(
    tx,
    student.courseId,
  );
  if (activeChapterResolution.kind === "missing") {
    throw new ArchiveRestoreError(
      "لا يمكن استعادة الطالب لأن دورته لا تحتوي على فصل نشط. فعّل فصلاً واحداً بفرص صالحة ثم أعد المحاولة.",
      "missing-active-chapter",
    );
  }
  if (activeChapterResolution.kind === "conflict") {
    throw new ArchiveRestoreError(
      `لا يمكن استعادة الطالب لأن دورته تحتوي على ${activeChapterResolution.activeCount} فصول نشطة متعارضة. أصلح التعارض واجعل فصلاً واحداً فقط نشطاً ثم أعد المحاولة.`,
      "conflicting-active-chapters",
    );
  }
  if (activeChapterResolution.kind === "zero-limit") {
    throw new ArchiveRestoreError(
      `لا يمكن استعادة الطالب لأن الفصل النشط «${activeChapterResolution.chapter.name}» سقف فرصه 0. عدّل فرص الفصل إلى قيمة صالحة ثم أعد المحاولة.`,
      "zero-opportunity-limit",
    );
  }

  const activeChapter = activeChapterResolution.chapter;
  const baseline = activeChapterResolution.opportunities;
  const statusData: Prisma.StudentUpdateInput =
    options.status === "مفصول"
      ? { status: "مفصول", opportunities: 0, baseOpportunities: baseline }
      : {
          status: "نشط",
          dismissalReason: "",
          dismissalNotes: "",
          opportunities: baseline,
          baseOpportunities: baseline,
        };
  await tx.student.update({
    where: { id: student.id },
    data: { ...options.data, ...statusData },
  });

  const academicRecalculation = await recalculateStudentsAcademicState(
    [student.id],
    { tx },
  );
  const updatedStudent = await tx.student.findUniqueOrThrow({
    where: { id: student.id },
  });
  return { updatedStudent, activeChapter, baseline, academicRecalculation };
}
