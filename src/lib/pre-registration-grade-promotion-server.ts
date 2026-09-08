import { parseCourseIds } from "@/lib/exam-course-links";
import { splitSelection, studentMatchesExamMainSites } from "@/lib/exam-utils";
import { baghdadDateKey } from "@/lib/baghdad-time";
import { normalizeStudentLeave } from "@/lib/academic-engine";
import type { Prisma } from "@prisma/client";
import { recalculateStudentsAcademicState } from "@/lib/academic-recalculate-server";

const BATCH_SIZE = 500;

export type PreRegistrationGradePromotionResult = {
  promoted: number;
  normalizedExisting: number;
  conflicts: number;
  invalid: number;
  remainingPending: number;
  studentIds: string[];
};

function unique(values: string[]) {
  return Array.from(new Set(values));
}

function processedResolution(existing = false) {
  return existing
    ? "الدرجة موجودة في سجل الطالب؛ قُدّم تاريخ تسجيله إلى تاريخ الامتحان واعتُمدت الدرجة محتسبة وأُغلقت الملاحظة القديمة."
    : "تم تقديم تاريخ تسجيل الطالب إلى تاريخ الامتحان واعتماد الدرجة محتسبةً في سجله.";
}

export async function promotePendingPreRegistrationGrades(
  tx: Prisma.TransactionClient,
  actor: { id?: string | null; name?: string | null } = {},
): Promise<PreRegistrationGradePromotionResult> {
  const notes = await tx.gradeSmartNote.findMany({
    where: {
      category: "BEFORE_REGISTRATION_PENDING",
      status: "PENDING",
    },
    orderBy: [{ attemptedAt: "asc" }, { id: "asc" }],
    take: BATCH_SIZE,
    include: { exam: { select: { fullMark: true, date: true, courseIds: true, mainSite: true } } },
  });

  let promoted = 0;
  let normalizedExisting = 0;
  let conflicts = 0;
  let invalid = 0;
  const affectedStudentIds: string[] = [];
  const now = new Date();

  for (const note of notes) {
    const score = Number(note.score);
    const fullMark = Number(note.exam.fullMark || 0);
    if (
      note.score === null ||
      !Number.isInteger(score) ||
      score < 0 ||
      score > fullMark
    ) {
      invalid += 1;
      await tx.gradeSmartNote.update({
        where: { id: note.id },
        data: {
          status: "CONFLICT",
          resolution:
            "تعذر نقل المحاولة لأن الدرجة فارغة أو خارج الدرجة الكاملة للامتحان.",
          resolutionById: actor.id || null,
          resolutionByName: actor.name || null,
          resolvedAt: now,
        },
      });
      continue;
    }

    const existing = await tx.grade.findUnique({
      where: {
        studentId_examId: {
          studentId: note.studentId,
          examId: note.examId,
        },
      },
    });

    const student = await tx.student.findUnique({ where: { id: note.studentId } });
    const courseIds = parseCourseIds(note.exam.courseIds);
    const examDay = baghdadDateKey(note.exam.date);
    const leaves = (await tx.studentLeave.findMany({ where: { studentId: note.studentId } }))
      .map(leave => normalizeStudentLeave(leave))
      .filter(leave => leave.leaveType === "exam" ? leave.examId === note.examId : examDay >= leave.dateFrom && examDay <= leave.dateTo);
    if (
      !student || student.status !== "نشط" || !courseIds.includes(student.courseId) || leaves.length > 0 ||
      !studentMatchesExamMainSites(student, splitSelection(note.exam.mainSite || "")) ||
      (existing && !(existing.status === "قبل تسجيل الطالب" && existing.score === null) &&
       !(existing.status === "درجة" && existing.score === score))
    ) {
      conflicts += 1;
      await tx.gradeSmartNote.update({
        where: { id: note.id },
        data: {
          status: "CONFLICT",
          resolution:
            "لم تُستبدل المحاولة لأن هناك حالة مختلفة محفوظة لهذا الطالب في الامتحان.",
          resolutionById: actor.id || null,
          resolutionByName: actor.name || null,
          resolvedAt: now,
        },
      });
      continue;
    }

    // Resolve all conflicts before changing the student's accounting window.
    // Conditional update can move registration backward only, even across notes.
    await tx.student.updateMany({
      where: { id: note.studentId, createdAt: { gt: note.exam.date } },
      data: { createdAt: note.exam.date },
    });
    await tx.student.update({
      where: { id: note.studentId },
      data: { accountingGraceDays: 0, gracePeriodStartDate: null, gracePeriodEndedAt: student.gracePeriodEndedAt || now },
    });
    if (existing?.status === "درجة" && existing.score !== null) {
      await tx.grade.update({
        where: { id: existing.id },
        data: {
          academicEffectExcluded: false,
          academicEffectExclusionReason: null,
          academicEffectExclusionSource: null,
          ...(existing.smartNoteId ? {} : { smartNoteId: note.id }),
        },
      });
      await tx.gradeSmartNote.update({
        where: { id: note.id },
        data: {
          status: "PROCESSED",
          resolution: processedResolution(true),
          resolutionById: actor.id || note.attemptedById || null,
          resolutionByName: actor.name || note.attemptedByName || null,
          resolvedAt: now,
        },
      });
      normalizedExisting += 1;
      affectedStudentIds.push(note.studentId);
      continue;
    }

    const gradeData = {
      status: "درجة",
      score,
      notes:
        "درجة مدخلة يدوياً لامتحان سابق لتسجيل الطالب؛ قُدّم تاريخ التسجيل إلى تاريخ الامتحان واعتُمدت الدرجة محتسبة.",
      academicEffectExcluded: false,
      academicEffectExclusionReason: null,
      academicEffectExclusionSource: null,
      smartNoteId: note.id,
    } as const;

    if (existing) {
      await tx.grade.update({ where: { id: existing.id }, data: gradeData });
    } else {
      await tx.grade.create({
        data: {
          ...gradeData,
          studentId: note.studentId,
          examId: note.examId,
        },
      });
    }
    await tx.gradeSmartNote.update({
      where: { id: note.id },
      data: {
        status: "PROCESSED",
        resolution: processedResolution(false),
        resolutionById: actor.id || note.attemptedById || null,
        resolutionByName: actor.name || note.attemptedByName || null,
        resolvedAt: now,
      },
    });
    promoted += 1;
    affectedStudentIds.push(note.studentId);
  }

  const studentIds = unique(affectedStudentIds);
  if (studentIds.length > 0) {
    await recalculateStudentsAcademicState(studentIds, { tx });
  }

  const remainingPending = await tx.gradeSmartNote.count({
    where: {
      category: "BEFORE_REGISTRATION_PENDING",
      status: "PENDING",
    },
  });

  return {
    promoted,
    normalizedExisting,
    conflicts,
    invalid,
    remainingPending,
    studentIds,
  };
}
