import type { Prisma } from "@prisma/client";

type ResetKind = "course-transfer" | "same-course-new-student";

type ArchiveResetInput = {
  studentId: string;
  targetCourseId: string;
  resetKind: ResetKind;
  reason: string;
  createdById?: string | null;
  createdByName?: string | null;
};

export type StudentEnrollmentArchiveSummary = {
  archiveId: string;
  fromCourseId: string;
  fromCourseName: string;
  toCourseId: string;
  toCourseName: string;
  resetKind: ResetKind;
  counts: {
    grades: number;
    opportunityLogs: number;
    studentLeaves: number;
    studentCalls: number;
    studentNotes: number;
    correctionSheets: number;
    telegramExamSubmissions: number;
    studentLeaveGradeBackups: number;
    auditLogs: number;
  };
};

function serializedSnapshot(value: unknown): string {
  return JSON.stringify(value, (_key, item) => {
    if (item instanceof Date) return item.toISOString();
    return item;
  });
}

/**
 * Archives the student's complete current operational/academic file and then
 * removes the live relations so the next enrollment starts with a clean slate.
 * Must be called inside the same transaction that updates the Student row.
 */
export async function archiveAndResetStudentEnrollment(
  tx: Prisma.TransactionClient,
  input: ArchiveResetInput,
): Promise<StudentEnrollmentArchiveSummary> {
  const student = await tx.student.findUnique({
    where: { id: input.studentId },
    include: { course: true },
  });
  if (!student) {
    throw Object.assign(new Error("student not found"), { code: "P2025" });
  }

  const targetCourse = await tx.course.findUnique({
    where: { id: input.targetCourseId },
    select: { id: true, name: true },
  });
  if (!targetCourse) {
    throw Object.assign(new Error("target course not found"), { code: "P2003" });
  }

  const [
    grades,
    opportunityLogs,
    studentLeaves,
    studentCalls,
    studentNotes,
    correctionSheets,
    telegramExamSubmissions,
    studentLeaveGradeBackups,
    activeCourseChapters,
    auditLogs,
  ] = await Promise.all([
    tx.grade.findMany({
      where: { studentId: input.studentId },
      include: { exam: true },
      orderBy: [{ updatedAt: "asc" }, { createdAt: "asc" }],
    }),
    tx.opportunityLog.findMany({
      where: { studentId: input.studentId },
      include: { exam: true, chapter: true },
      orderBy: [{ date: "asc" }, { id: "asc" }],
    }),
    tx.studentLeave.findMany({
      where: { studentId: input.studentId },
      include: { exam: true },
      orderBy: [{ date: "asc" }, { createdAt: "asc" }],
    }),
    tx.studentCall.findMany({
      where: { studentId: input.studentId },
      include: { exam: true },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    }),
    tx.studentNote.findMany({
      where: { studentId: input.studentId },
      orderBy: [{ date: "asc" }, { id: "asc" }],
    }),
    tx.correctionSheet.findMany({
      where: { studentId: input.studentId },
      include: {
        exam: true,
        corrector: { select: { id: true, name: true, username: true } },
      },
      orderBy: { id: "asc" },
    }),
    tx.telegramExamSubmission.findMany({
      where: { studentId: input.studentId },
      include: { exam: true },
      orderBy: [{ receivedAt: "asc" }, { id: "asc" }],
    }),
    tx.studentLeaveGradeBackup.findMany({
      where: { studentId: input.studentId },
      include: { exam: true },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    }),
    tx.courseChapter.findMany({
      where: { courseId: student.courseId, active: true, archived: false },
      include: { chapter: true },
    }),
    tx.auditLog.findMany({
      where: {
        OR: [
          { details: { contains: student.code, mode: "insensitive" } },
          { details: { contains: student.id, mode: "insensitive" } },
        ],
      },
      orderBy: [{ time: "asc" }, { id: "asc" }],
    }),
  ]);

  const counts = {
    grades: grades.length,
    opportunityLogs: opportunityLogs.length,
    studentLeaves: studentLeaves.length,
    studentCalls: studentCalls.length,
    studentNotes: studentNotes.length,
    correctionSheets: correctionSheets.length,
    telegramExamSubmissions: telegramExamSubmissions.length,
    studentLeaveGradeBackups: studentLeaveGradeBackups.length,
    auditLogs: auditLogs.length,
  };

  const snapshot = {
    version: 1,
    archivedAt: new Date().toISOString(),
    resetKind: input.resetKind,
    reason: input.reason,
    student,
    fromCourse: student.course,
    toCourse: targetCourse,
    activeCourseChapters,
    counts,
    grades,
    opportunityLogs,
    studentLeaves,
    studentCalls,
    studentNotes,
    correctionSheets,
    telegramExamSubmissions,
    studentLeaveGradeBackups,
    auditLogs,
  };

  const archive = await tx.studentEnrollmentArchive.create({
    data: {
      studentId: input.studentId,
      fromCourseId: student.courseId,
      fromCourseName: student.course?.name || "",
      toCourseId: targetCourse.id,
      toCourseName: targetCourse.name,
      resetKind: input.resetKind,
      reason: input.reason,
      snapshot: serializedSnapshot(snapshot),
      createdById: input.createdById || null,
      createdByName: input.createdByName || null,
    },
  });

  // Dependency-safe order. Every deletion and the Student update are part of
  // the caller's transaction, so a failure rolls the entire reset back.
  await tx.studentLeaveGradeBackup.deleteMany({
    where: { studentId: input.studentId },
  });
  await tx.telegramExamSubmission.deleteMany({
    where: { studentId: input.studentId },
  });
  await tx.correctionSheet.deleteMany({ where: { studentId: input.studentId } });
  await tx.grade.deleteMany({ where: { studentId: input.studentId } });
  await tx.studentLeave.deleteMany({ where: { studentId: input.studentId } });
  await tx.studentCall.deleteMany({ where: { studentId: input.studentId } });
  await tx.opportunityLog.deleteMany({ where: { studentId: input.studentId } });
  await tx.studentNote.deleteMany({ where: { studentId: input.studentId } });

  return {
    archiveId: archive.id,
    fromCourseId: student.courseId,
    fromCourseName: student.course?.name || "",
    toCourseId: targetCourse.id,
    toCourseName: targetCourse.name,
    resetKind: input.resetKind,
    counts,
  };
}

export function parseStudentEnrollmentArchiveSnapshot(snapshot: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(snapshot || "{}");
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}
