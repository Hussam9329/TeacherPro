import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { isExamOnOrAfterStudentRegistration } from "@/lib/exam-utils";
import { isExamWithinStudentGraceWindow } from "@/lib/student-grace";

type PrismaClientLike = typeof db | Prisma.TransactionClient;

type AbsenceCandidate = {
  id: string;
  studentId: string;
  examId: string;
  student: {
    createdAt: Date;
    accountingGraceDays: number;
    gracePeriodStartDate: Date | null;
  };
  exam: { date: Date };
};

export type GracePeriodRepairResult = {
  studentIds: string[];
  deletedGrades: number;
  deletedCalls: number;
};

function uniqueIds(values: Array<string | null | undefined>): string[] {
  return Array.from(
    new Set(values.map((value) => String(value || "").trim()).filter(Boolean)),
  );
}

function isProtectedOrPreRegistrationAbsence(grade: AbsenceCandidate): boolean {
  return (
    !isExamOnOrAfterStudentRegistration(grade.student, grade.exam) ||
    isExamWithinStudentGraceWindow(grade.student, grade.exam)
  );
}

/**
 * Removes impossible absence records and their call rows. Call this inside the
 * same transaction as grace/registration changes, before academic
 * recalculation, so no request can observe a protected student as absent.
 */
export async function removeProtectedAbsencesForStudents(
  client: PrismaClientLike,
  rawStudentIds: Array<string | null | undefined>,
): Promise<GracePeriodRepairResult> {
  const requestedStudentIds = uniqueIds(rawStudentIds);
  if (requestedStudentIds.length === 0) {
    return { studentIds: [], deletedGrades: 0, deletedCalls: 0 };
  }

  const candidates = (await client.grade.findMany({
    where: { studentId: { in: requestedStudentIds }, status: "غائب" },
    select: {
      id: true,
      studentId: true,
      examId: true,
      student: {
        select: {
          createdAt: true,
          accountingGraceDays: true,
          gracePeriodStartDate: true,
        },
      },
      exam: { select: { date: true } },
    },
  })) as AbsenceCandidate[];
  const invalid = candidates.filter(isProtectedOrPreRegistrationAbsence);
  if (invalid.length === 0) {
    return { studentIds: [], deletedGrades: 0, deletedCalls: 0 };
  }

  const affectedStudentIds = uniqueIds(invalid.map((grade) => grade.studentId));
  const callResult = await client.studentCall.deleteMany({
    where: {
      OR: invalid.map((grade) => ({
        studentId: grade.studentId,
        examId: grade.examId,
      })),
    },
  });
  const gradeResult = await client.grade.deleteMany({
    where: { id: { in: invalid.map((grade) => grade.id) } },
  });

  return {
    studentIds: affectedStudentIds,
    deletedGrades: gradeResult.count,
    deletedCalls: callResult.count,
  };
}
